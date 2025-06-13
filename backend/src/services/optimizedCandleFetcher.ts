import axios from 'axios';
import logger from '@/utils/logger';
import { CandleData } from './okxService';
import { 
  SmartRateLimiter, 
  OPTIMAL_LIMIT_PER_REQUEST,
  REQUEST_DELAY_MS 
} from './rateLimiter';

// Базовый URL для публичного API OKX
const BASE_URL = 'https://www.okx.com';

// Маппинг наших таймфреймов на OKX API `bar` параметр
const TIMEFRAME_MAP: { [key: string]: string } = {
  '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m',
  '1h': '1H', '2h': '2H', '4h': '4H', '6h': '6H', '12h': '12H',
  '1d': '1D', '1w': '1W', '1M': '1M',
};

export interface CandleRequest {
  symbol: string;
  timeframe: string;
  startTime?: number;
  endTime?: number;
  limit?: number;
}

export interface OptimizedFetchResult {
  symbol: string;
  candles: CandleData[];
  requestsCount: number;
  fetchTimeMs: number;
  success: boolean;
  error?: string;
}

/**
 * Адаптивная система retry с умными задержками
 */
class AdaptiveRetrySystem {
  private readonly maxRetries = 3;
  
  async fetchWithRetry(
    url: string,
    params: any,
    symbol: string,
    attempt: number = 1
  ): Promise<any> {
    try {
      const response = await axios.get(url, { params });
      
      if (response.status === 429) {
        // Too Many Requests - адаптивная задержка
        const backoffDelay = this.calculateBackoffDelay(attempt, symbol);
        logger.warn(`[AdaptiveRetry] Rate limit hit for ${symbol}, backing off for ${backoffDelay}ms (attempt ${attempt})`);
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
        return this.fetchWithRetry(url, params, symbol, attempt + 1);
      }
      
      return response;
    } catch (error: any) {
      if (attempt < this.maxRetries) {
        const retryDelay = Math.min(1000 * Math.pow(2, attempt), 30000);
        logger.warn(`[AdaptiveRetry] Request failed for ${symbol}, retrying in ${retryDelay}ms (attempt ${attempt}/${this.maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        return this.fetchWithRetry(url, params, symbol, attempt + 1);
      }
      
      logger.error(`[AdaptiveRetry] Max retries exceeded for ${symbol}:`, error.message);
      throw error;
    }
  }
  
  private calculateBackoffDelay(attempt: number, symbol: string): number {
    // Для ошибок по инструменту - ждем до следующей минуты
    const baseDelay = 1000; // 1 секунда
    const instrumentBackoff = 60000 / 55; // ~1.1 сек (безопасный интервал)
    const exponentialBackoff = baseDelay * Math.pow(2, attempt - 1);
    
    return Math.min(Math.max(instrumentBackoff, exponentialBackoff), 30000);
  }
}

/**
 * Оптимизированный fetcher свечей с умным rate limiting и параллельной обработкой
 */
export class OptimizedCandleFetcher {
  private rateLimiter: SmartRateLimiter;
  private retrySystem = new AdaptiveRetrySystem();
  
  constructor(rateLimiter: SmartRateLimiter) {
    this.rateLimiter = rateLimiter;
  }
  
  /**
   * Параллельная загрузка свечей для множественных символов
   * @param requests - Массив запросов на загрузку
   * @param concurrentLimit - Лимит одновременных запросов (по умолчанию 3)
   */
  async fetchCandlesParallel(
    requests: CandleRequest[], 
    concurrentLimit: number = 3
  ): Promise<Record<string, OptimizedFetchResult>> {
    const results: Record<string, OptimizedFetchResult> = {};
    
    // Группируем запросы по символам для оптимального распределения
    const requestsBySymbol = this.groupRequestsBySymbol(requests);
    
    logger.info(`[OptimizedFetcher] Starting parallel fetch for ${Object.keys(requestsBySymbol).length} symbols with concurrency ${concurrentLimit}`);
    
    // Создаем очередь для контроля параллельности
    const activePromises: Promise<void>[] = [];
    const symbolEntries = Array.from(requestsBySymbol.entries());
    
    for (let i = 0; i < symbolEntries.length; i++) {
      const [symbol, symbolRequests] = symbolEntries[i];
      
      // Ждем если достигнут лимит параллельности
      if (activePromises.length >= concurrentLimit) {
        await Promise.race(activePromises);
        // Удаляем завершенные промисы
        for (let j = activePromises.length - 1; j >= 0; j--) {
          if (await this.isPromiseResolved(activePromises[j])) {
            activePromises.splice(j, 1);
          }
        }
      }
      
      // Создаем промис для загрузки символа
      const fetchPromise = this.fetchCandlesForSymbol(symbol, symbolRequests[0])
        .then(result => {
          results[symbol] = result;
        })
        .catch(error => {
          results[symbol] = {
            symbol,
            candles: [],
            requestsCount: 0,
            fetchTimeMs: 0,
            success: false,
            error: error.message
          };
        });
      
      activePromises.push(fetchPromise);
    }
    
    // Ждем завершения всех оставшихся промисов
    await Promise.all(activePromises);
    
    const totalCandles = Object.values(results).reduce((sum, r) => sum + r.candles.length, 0);
    const successCount = Object.values(results).filter(r => r.success).length;
    
    logger.info(`[OptimizedFetcher] Parallel fetch completed. Success: ${successCount}/${Object.keys(results).length}, Total candles: ${totalCandles}`);
    
    return results;
  }
  
  /**
   * Загружает свечи для одного символа с оптимизированными параметрами
   * Автоматически разбивает большие запросы на чанки для избежания rate limit timeout
   */
  async fetchCandlesForSymbol(symbol: string, request: CandleRequest): Promise<OptimizedFetchResult> {
    const startTime = Date.now();
    let totalRequestsCount = 0;
    const allCandles: CandleData[] = [];
    
    try {
      const okxTimeframe = TIMEFRAME_MAP[request.timeframe];
      if (!okxTimeframe) {
        throw new Error(`Unsupported timeframe: ${request.timeframe}`);
      }

      // Проверяем размер запроса и разбиваем на чанки если нужно
      const timeRange = request.endTime && request.startTime ? request.endTime - request.startTime : 0;
      const maxChunkSize = 30 * 24 * 60 * 60 * 1000; // 30 дней в миллисекундах
      
      if (timeRange > maxChunkSize) {
        logger.info(`[OptimizedFetcher] Large request detected for ${symbol} (${Math.floor(timeRange / (24 * 60 * 60 * 1000))} days). Splitting into chunks.`);
        
        const chunks = this.splitRequestIntoChunks(request, maxChunkSize);
        logger.info(`[OptimizedFetcher] Split into ${chunks.length} chunks for ${symbol}`);
        
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          logger.info(`[OptimizedFetcher] Processing chunk ${i + 1}/${chunks.length} for ${symbol}: ${new Date(chunk.startTime!).toISOString()} to ${new Date(chunk.endTime!).toISOString()}`);
          
          const chunkResult = await this.fetchSingleChunk(symbol, chunk);
          
          allCandles.push(...chunkResult.candles);
          totalRequestsCount += chunkResult.requestsCount;
          
          // Добавляем задержку между чанками
          if (i < chunks.length - 1) {
            logger.info(`[OptimizedFetcher] Waiting 2 seconds before next chunk for ${symbol}...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
        
        // Финальная сортировка и лимитирование
        allCandles.sort((a, b) => a.timestamp - b.timestamp);
        const finalCandles = request.limit ? allCandles.slice(-Math.min(request.limit, allCandles.length)) : allCandles;
        
        const fetchTimeMs = Date.now() - startTime;
        logger.info(`[OptimizedFetcher] Completed chunked fetch for ${symbol}: ${finalCandles.length} candles, ${totalRequestsCount} requests, ${fetchTimeMs}ms`);
        
        return {
          symbol,
          candles: finalCandles,
          requestsCount: totalRequestsCount,
          fetchTimeMs,
          success: true
        };
      } else {
        // Обычная загрузка для небольших запросов
        return await this.fetchSingleChunk(symbol, request);
      }
      
    } catch (error: any) {
      const fetchTimeMs = Date.now() - startTime;
      logger.error(`[OptimizedFetcher] Failed to fetch candles for ${symbol}:`, error.message);
      
      return {
        symbol,
        candles: allCandles, // Возвращаем что успели загрузить
        requestsCount: totalRequestsCount,
        fetchTimeMs,
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Разбивает большой запрос на чанки по времени
   */
  private splitRequestIntoChunks(request: CandleRequest, maxChunkSize: number): CandleRequest[] {
    if (!request.startTime || !request.endTime) {
      return [request];
    }
    
    const chunks: CandleRequest[] = [];
    let currentStart = request.startTime;
    
    while (currentStart < request.endTime) {
      const currentEnd = Math.min(currentStart + maxChunkSize, request.endTime);
      
      chunks.push({
        ...request,
        startTime: currentStart,
        endTime: currentEnd
      });
      
      currentStart = currentEnd;
    }
    
    return chunks;
  }

  /**
   * Загружает один чанк данных
   */
  private async fetchSingleChunk(symbol: string, request: CandleRequest): Promise<OptimizedFetchResult> {
    const startTime = Date.now();
    let requestsCount = 0;
    const allCandles: CandleData[] = [];

    const okxTimeframe = TIMEFRAME_MAP[request.timeframe];
    let currentAfterForAPI = request.endTime ? request.endTime + 1 : undefined;
    
    logger.info(`[OptimizedFetcher] Starting fetch chunk for ${symbol} (${request.timeframe}) for period ${request.startTime ? new Date(request.startTime).toISOString() : 'earliest'} to ${request.endTime ? new Date(request.endTime).toISOString() : 'latest'}`);
    
    while (true) {
      // Ждем разрешения на запрос от rate limiter
      await this.rateLimiter.waitForRateLimit(symbol);
      
      const url = `${BASE_URL}/api/v5/market/history-candles`;
      const params: any = {
        instId: symbol,
        bar: okxTimeframe,
        limit: OPTIMAL_LIMIT_PER_REQUEST, // Используем оптимизированный лимит 250
      };
      
      if (currentAfterForAPI) {
        params.after = currentAfterForAPI;
      }
      
      // Выполняем запрос с retry логикой
      const response = await this.retrySystem.fetchWithRetry(url, params, symbol);
      requestsCount++;
      
      // Записываем выполненный запрос в rate limiter
      this.rateLimiter.recordRequest(symbol);
      
      // Добавляем минимальную задержку для соблюдения лимитов
      await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS));
      
      if (response.data && response.data.code === '0' && response.data.data.length > 0) {
        // Обрабатываем полученные данные
        let fetchedBatch = response.data.data.map((c: string[]) => ({
          timestamp: parseInt(c[0], 10),
          open: parseFloat(c[1]),
          high: parseFloat(c[2]),
          low: parseFloat(c[3]),
          close: parseFloat(c[4]),
          volume: parseFloat(c[5]), 
          volumeQuote: parseFloat(c[6]) 
        }));
        
        // Разворачиваем для обработки от старых к новым
        fetchedBatch.reverse();
        
        // Фильтрация по временному диапазону
        let candlesToProcess = fetchedBatch;
        if (request.startTime) {
          candlesToProcess = candlesToProcess.filter((c: CandleData) => c.timestamp >= request.startTime!);
        }
        if (request.endTime) {
          candlesToProcess = candlesToProcess.filter((c: CandleData) => c.timestamp <= request.endTime!);
        }
        
        if (candlesToProcess.length > 0) {
          allCandles.unshift(...candlesToProcess);
          currentAfterForAPI = parseInt(response.data.data[response.data.data.length - 1][0], 10);
          
          logger.debug(`[OptimizedFetcher] Added ${candlesToProcess.length} candles for ${symbol}. Total: ${allCandles.length}`);
        } else if (response.data.data.length > 0) {
          currentAfterForAPI = parseInt(response.data.data[response.data.data.length - 1][0], 10);
        }
        
        // Условия выхода
        const oldestTimestamp = candlesToProcess.length > 0 ? candlesToProcess[0].timestamp : null;
        const achievedStartTime = request.startTime && oldestTimestamp && oldestTimestamp <= request.startTime;
        const achievedLimit = request.limit && allCandles.length >= request.limit;
        
        // ИСПРАВЛЕНИЕ: Убираем неправильное условие noMoreData
        // OKX может возвращать пачки менее чем OPTIMAL_LIMIT_PER_REQUEST для старых данных
        // Правильная проверка: если получена пустая пачка ИЛИ все свечи вне диапазона
        const actuallyNoMoreData = response.data.data.length === 0;
        
        logger.debug(`[OptimizedFetcher] Exit conditions for ${symbol}: achievedStartTime=${achievedStartTime}, achievedLimit=${achievedLimit}, actuallyNoMoreData=${actuallyNoMoreData}`);
        
        if (achievedStartTime || achievedLimit || actuallyNoMoreData) {
          if (achievedStartTime) {
            logger.debug(`[OptimizedFetcher] Exiting: reached startTime (${oldestTimestamp} <= ${request.startTime})`);
          }
          if (achievedLimit) {
            logger.debug(`[OptimizedFetcher] Exiting: reached limit (${allCandles.length} >= ${request.limit})`);
          }
          if (actuallyNoMoreData) {
            logger.debug(`[OptimizedFetcher] Exiting: no more data available from API`);
          }
          break;
        }
        
      } else if (response.data && response.data.code !== '0') {
        throw new Error(`OKX API error: ${response.data.msg} (Code: ${response.data.code})`);
      } else {
        // Нет данных
        break;
      }
    }
    
    // Финальная сортировка и лимитирование
    allCandles.sort((a, b) => a.timestamp - b.timestamp);
    const finalCandles = request.limit ? allCandles.slice(-Math.min(request.limit, allCandles.length)) : allCandles;
    
    const fetchTimeMs = Date.now() - startTime;
    
    logger.info(`[OptimizedFetcher] Completed chunk fetch for ${symbol}: ${finalCandles.length} candles, ${requestsCount} requests, ${fetchTimeMs}ms`);
    
    return {
      symbol,
      candles: finalCandles,
      requestsCount,
      fetchTimeMs,
      success: true
    };
  }
  
  private groupRequestsBySymbol(requests: CandleRequest[]): Map<string, CandleRequest[]> {
    const grouped = new Map<string, CandleRequest[]>();
    
    for (const request of requests) {
      if (!grouped.has(request.symbol)) {
        grouped.set(request.symbol, []);
      }
      grouped.get(request.symbol)!.push(request);
    }
    
    return grouped;
  }
  
  private async isPromiseResolved(promise: Promise<void>): Promise<boolean> {
    try {
      await Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 0))
      ]);
      return true;
    } catch {
      return false;
    }
  }
} 