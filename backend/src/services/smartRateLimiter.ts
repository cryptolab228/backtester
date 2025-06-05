import Redis from 'ioredis';
import logger from '@/utils/logger';
import config from '@/config';

// Конфигурация лимитов для разных бирж
export const EXCHANGE_LIMITS = {
  okx: {
    requestsPerSecond: 30,
    requestsPerMinutePerInstrument: 60,
    maxRequestsInWindow: 58, // Буфер безопасности
    windowSizeMs: 2000, // 2 секунды для глобального лимита
    instrumentWindowSizeMs: 60000, // 1 минута для лимита по инструменту
  },
  bybit: {
    requestsPerSecond: 120,
    requestsPerMinutePerInstrument: 200,
    maxRequestsInWindow: 115, // Буфер безопасности
    windowSizeMs: 1000, // 1 секунда для глобального лимита
    instrumentWindowSizeMs: 60000, // 1 минута для лимита по инструменту
  }
} as const;

export type ExchangeName = keyof typeof EXCHANGE_LIMITS;

interface RateLimitConfig {
  requestsPerSecond: number;
  requestsPerMinutePerInstrument: number;
  maxRequestsInWindow: number;
  windowSizeMs: number;
  instrumentWindowSizeMs: number;
}

/**
 * Redis-based RateLimiter для координации между множественными воркерами
 * Поддерживает разные лимиты для разных бирж
 */
export class SmartRateLimiter {
  private redis: Redis;
  private exchange: ExchangeName;
  private config: RateLimitConfig;
  private globalKey: string;
  private instrumentKeyPrefix: string;

  constructor(exchange: ExchangeName, redis?: Redis) {
    this.exchange = exchange;
    this.config = EXCHANGE_LIMITS[exchange];
    this.redis = redis || new Redis({
      host: config.redis.host,
      port: config.redis.port,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
    
    this.globalKey = `rate_limit:${exchange}:global`;
    this.instrumentKeyPrefix = `rate_limit:${exchange}:instrument:`;

    logger.info(`[SmartRateLimiter] Initialized for ${exchange} with limits:`, this.config);
  }

  /**
   * Ожидает доступного слота для выполнения запроса
   * @param symbol - торговый символ (опционально, для лимита по инструменту)
   * @param maxWaitMs - максимальное время ожидания
   */
  async waitForSlot(symbol?: string, maxWaitMs: number = 600000): Promise<void> {
    const startTime = Date.now();
    let attempts = 0;

    while (Date.now() - startTime < maxWaitMs) {
      attempts++;
      
      const canProceed = await this.checkLimits(symbol);
      if (canProceed) {
        logger.debug(`[SmartRateLimiter] Slot available for ${this.exchange}${symbol ? ` symbol ${symbol}` : ''} after ${attempts} attempts`);
        return;
      }

      // Вычисляем оптимальную задержку
      const delay = this.calculateOptimalDelay();
      
      if (attempts % 10 === 0) { // Логируем каждые 10 попыток
        logger.info(`[SmartRateLimiter] Waiting for rate limit reset for ${this.exchange}${symbol ? ` symbol ${symbol}` : ''}... ${Math.floor((Date.now() - startTime)/1000)}s elapsed`);
      }

      await this.sleep(delay);
    }

    logger.warn(`[SmartRateLimiter] Rate limit wait timeout for ${this.exchange}${symbol ? ` symbol ${symbol}` : ''} after ${maxWaitMs/1000}s`);
    throw new Error(`Rate limit timeout for ${this.exchange}`);
  }

  /**
   * Записывает факт выполнения запроса
   * @param symbol - торговый символ (опционально)
   */
  async recordRequest(symbol?: string): Promise<void> {
    const now = Date.now();
    const pipeline = this.redis.pipeline();

    // Записываем глобальный запрос
    pipeline.zadd(this.globalKey, now, `${now}-${Math.random()}`);
    pipeline.expire(this.globalKey, Math.ceil(this.config.windowSizeMs / 1000) + 1);

    // Записываем запрос по инструменту, если указан
    if (symbol) {
      const instrumentKey = `${this.instrumentKeyPrefix}${symbol}`;
      pipeline.zadd(instrumentKey, now, `${now}-${Math.random()}`);
      pipeline.expire(instrumentKey, Math.ceil(this.config.instrumentWindowSizeMs / 1000) + 1);
    }

    await pipeline.exec();
    
    logger.debug(`[SmartRateLimiter] Recorded request for ${this.exchange}${symbol ? ` symbol ${symbol}` : ''}`);
  }

  /**
   * Проверяет, можно ли выполнить запрос согласно лимитам
   */
  private async checkLimits(symbol?: string): Promise<boolean> {
    const now = Date.now();
    
    // Проверяем глобальный лимит
    const globalWindowStart = now - this.config.windowSizeMs;
    const globalCount = await this.redis.zcount(this.globalKey, globalWindowStart, '+inf');
    
    if (globalCount >= this.config.maxRequestsInWindow) {
      logger.debug(`[SmartRateLimiter] Global rate limit exceeded for ${this.exchange}: ${globalCount}/${this.config.maxRequestsInWindow}`);
      return false;
    }

    // Проверяем лимит по инструменту, если указан
    if (symbol) {
      const instrumentKey = `${this.instrumentKeyPrefix}${symbol}`;
      const instrumentWindowStart = now - this.config.instrumentWindowSizeMs;
      const instrumentCount = await this.redis.zcount(instrumentKey, instrumentWindowStart, '+inf');
      
      if (instrumentCount >= this.config.requestsPerMinutePerInstrument) {
        logger.debug(`[SmartRateLimiter] Instrument rate limit exceeded for ${this.exchange} ${symbol}: ${instrumentCount}/${this.config.requestsPerMinutePerInstrument}`);
        return false;
      }
    }

    return true;
  }

  /**
   * Очищает старые записи для экономии памяти
   */
  async cleanup(): Promise<void> {
    const now = Date.now();
    const pipeline = this.redis.pipeline();

    // Очищаем старые глобальные записи
    const globalCutoff = now - (this.config.windowSizeMs * 2);
    pipeline.zremrangebyscore(this.globalKey, '-inf', globalCutoff);

    // Очищаем старые записи по инструментам
    const instrumentCutoff = now - (this.config.instrumentWindowSizeMs * 2);
    const instrumentKeys = await this.redis.keys(`${this.instrumentKeyPrefix}*`);
    
    for (const key of instrumentKeys) {
      pipeline.zremrangebyscore(key, '-inf', instrumentCutoff);
    }

    await pipeline.exec();
    logger.debug(`[SmartRateLimiter] Cleaned up old entries for ${this.exchange}`);
  }

  /**
   * Получает статистику использования лимитов
   */
  async getStats(): Promise<{
    exchange: string;
    global: { current: number; limit: number; percentage: number };
    instruments: Record<string, { current: number; limit: number; percentage: number }>;
  }> {
    const now = Date.now();
    
    // Глобальная статистика
    const globalWindowStart = now - this.config.windowSizeMs;
    const globalCount = await this.redis.zcount(this.globalKey, globalWindowStart, '+inf');
    
    // Статистика по инструментам
    const instrumentKeys = await this.redis.keys(`${this.instrumentKeyPrefix}*`);
    const instrumentStats: Record<string, { current: number; limit: number; percentage: number }> = {};
    
    const instrumentWindowStart = now - this.config.instrumentWindowSizeMs;
    
    for (const key of instrumentKeys) {
      const symbol = key.replace(this.instrumentKeyPrefix, '');
      const count = await this.redis.zcount(key, instrumentWindowStart, '+inf');
      
      instrumentStats[symbol] = {
        current: count,
        limit: this.config.requestsPerMinutePerInstrument,
        percentage: Math.round((count / this.config.requestsPerMinutePerInstrument) * 100)
      };
    }

    return {
      exchange: this.exchange,
      global: {
        current: globalCount,
        limit: this.config.maxRequestsInWindow,
        percentage: Math.round((globalCount / this.config.maxRequestsInWindow) * 100)
      },
      instruments: instrumentStats
    };
  }

  /**
   * Вычисляет оптимальную задержку на основе текущей загрузки
   */
  private calculateOptimalDelay(): number {
    // Базовая задержка основана на частоте запросов
    const baseDelay = Math.ceil(1000 / this.config.requestsPerSecond);
    
    // Добавляем небольшой jitter для избежания синхронизации воркеров
    const jitter = Math.random() * 200; // 0-200ms
    
    return baseDelay + jitter;
  }

  /**
   * Утилита для сна
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Закрывает соединение с Redis
   */
  async disconnect(): Promise<void> {
    await this.redis.disconnect();
  }
}

// Глобальные экземпляры для переиспользования
export const okxGlobalRateLimiter = new SmartRateLimiter('okx');
export const bybitGlobalRateLimiter = new SmartRateLimiter('bybit');

// Утилита для получения правильного RateLimiter по бирже
export function getRateLimiter(exchange: ExchangeName): SmartRateLimiter {
  switch (exchange) {
    case 'okx':
      return okxGlobalRateLimiter;
    case 'bybit':
      return bybitGlobalRateLimiter;
    default:
      throw new Error(`Unsupported exchange: ${exchange}`);
  }
} 