import logger from '@/utils/logger';

// Константы для оптимизированного API access
export const OPTIMAL_LIMIT_PER_REQUEST = 250; // Увеличено с 100 до 250
export const REQUEST_DELAY_MS = 200; // Уменьшено с 250ms до 200ms (5 запросов/сек)
export const MAX_REQUESTS_PER_SECOND = 9; // Безопасный буфер под лимит 10/сек
export const MAX_REQUESTS_PER_MINUTE_PER_INSTRUMENT = 55; // Безопасный буфер под лимит 60/мин

interface InstrumentRateTracker {
  symbol: string;
  requestsThisMinute: number;
  lastRequestTime: number;
  requestTimeSlots: number[]; // Времена запросов за последнюю минуту
}

/**
 * Умный лимитер запросов с учетом глобальных и инструментальных ограничений OKX API
 */
export class SmartRateLimiter {
  private instrumentTrackers: Map<string, InstrumentRateTracker> = new Map();
  private globalRequestTimes: number[] = []; // Времена всех запросов за последние 2 секунды
  
  /**
   * Проверяет можно ли сделать запрос для указанного символа
   * @param symbol - Торговый символ (например, BTC-USDT-SWAP)
   * @returns true если запрос можно выполнить, false если нужно подождать
   */
  canMakeRequest(symbol: string): boolean {
    const now = Date.now();
    
    // Проверка глобального лимита (20 за 2 сек = 10/сек)
    this.cleanOldGlobalRequests(now);
    if (this.globalRequestTimes.length >= 18) { // Буфер на 2 запроса
      logger.debug(`[RateLimiter] Global rate limit near capacity: ${this.globalRequestTimes.length}/20`);
      return false;
    }
    
    // Проверка лимита по инструменту (60/мин)
    const tracker = this.getOrCreateTracker(symbol);
    this.cleanOldInstrumentRequests(tracker, now);
    if (tracker.requestsThisMinute >= MAX_REQUESTS_PER_MINUTE_PER_INSTRUMENT) {
      logger.debug(`[RateLimiter] Instrument ${symbol} rate limit reached: ${tracker.requestsThisMinute}/${MAX_REQUESTS_PER_MINUTE_PER_INSTRUMENT}`);
      return false;
    }
    
    return true;
  }
  
  /**
   * Записывает выполненный запрос в статистику
   * @param symbol - Торговый символ
   */
  recordRequest(symbol: string): void {
    const now = Date.now();
    this.globalRequestTimes.push(now);
    
    const tracker = this.getOrCreateTracker(symbol);
    tracker.requestTimeSlots.push(now);
    tracker.requestsThisMinute++;
    tracker.lastRequestTime = now;
    
    logger.debug(`[RateLimiter] Recorded request for ${symbol}. Global: ${this.globalRequestTimes.length}, Instrument: ${tracker.requestsThisMinute}`);
  }
  
  /**
   * Ожидает пока не станет возможно сделать запрос
   * @param symbol - Торговый символ
   * @param maxWaitMs - Максимальное время ожидания
   */
  async waitForRateLimit(symbol: string, maxWaitMs: number = 600000): Promise<void> {
    const startTime = Date.now();
    
    while (!this.canMakeRequest(symbol)) {
      const waitTime = Date.now() - startTime;
      if (waitTime > maxWaitMs) {
        logger.warn(`[RateLimiter] Rate limit wait timeout for ${symbol} after ${maxWaitMs/1000}s. Continuing with reduced performance.`);
        // Вместо исключения, возвращаемся и позволяем продолжить
        return;
      }
      
      // Логируем прогресс каждые 10 секунд
      if (waitTime > 0 && waitTime % 10000 === 0) {
        logger.info(`[RateLimiter] Waiting for rate limit reset for ${symbol}... ${Math.floor(waitTime/1000)}s elapsed`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000)); // Увеличиваем интервал проверки до 1 секунды
    }
  }
  
  /**
   * Получает статистику использования лимитов
   */
  getStats(): { global: number; instruments: Record<string, number> } {
    const now = Date.now();
    this.cleanOldGlobalRequests(now);
    
    const instrumentStats: Record<string, number> = {};
    for (const [symbol, tracker] of this.instrumentTrackers) {
      this.cleanOldInstrumentRequests(tracker, now);
      instrumentStats[symbol] = tracker.requestsThisMinute;
    }
    
    return {
      global: this.globalRequestTimes.length,
      instruments: instrumentStats
    };
  }
  
  private getOrCreateTracker(symbol: string): InstrumentRateTracker {
    if (!this.instrumentTrackers.has(symbol)) {
      this.instrumentTrackers.set(symbol, {
        symbol,
        requestsThisMinute: 0,
        lastRequestTime: 0,
        requestTimeSlots: []
      });
    }
    return this.instrumentTrackers.get(symbol)!;
  }
  
  private cleanOldGlobalRequests(now: number): void {
    // Удаляем запросы старше 2 секунд
    const twoSecondsAgo = now - 2000;
    this.globalRequestTimes = this.globalRequestTimes.filter(time => time > twoSecondsAgo);
  }
  
  private cleanOldInstrumentRequests(tracker: InstrumentRateTracker, now: number): void {
    // Удаляем запросы старше 1 минуты
    const oneMinuteAgo = now - 60000;
    tracker.requestTimeSlots = tracker.requestTimeSlots.filter(time => time > oneMinuteAgo);
    tracker.requestsThisMinute = tracker.requestTimeSlots.length;
  }
}

/**
 * Глобальный экземпляр rate limiter для переиспользования
 */
export const globalRateLimiter = new SmartRateLimiter(); 