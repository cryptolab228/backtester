import axios from 'axios';
import logger from '@/utils/logger';
import { OptimizedCandleFetcher, CandleRequest } from './optimizedCandleFetcher';
import { globalRateLimiter, OPTIMAL_LIMIT_PER_REQUEST } from './rateLimiter';

// Базовый URL для публичного API OKX
const BASE_URL = 'https://www.okx.com';

// Функция-задержка для обхода Rate Limits (DEPRECATED - используется в legacy коде)
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Глобальный экземпляр оптимизированного fetcher
const optimizedFetcher = new OptimizedCandleFetcher(globalRateLimiter);

// Интерфейс для ответа API свечей
interface OkxCandleResponse {
  code: string;
  msg: string;
  data: string[][]; // [mts, o, h, l, c, vol, volCcy]
}

// Интерфейс для ответа API инструментов (пар)
interface OkxInstrumentsResponse {
  code: string;
  msg: string;
  data: OkxInstrument[];
}

interface OkxInstrument {
  instType: string; // Тип инструмента, нам нужны 'SWAP' и 'FUTURES'
  instId: string;   // ID инструмента (символ), например BTC-USDT-SWAP
  uly: string;      // Базовый актив для фьючерсов/опционов
  category: string; // Категория (1: деривативы 1го поколения, 2: 2го...)
  baseCcy: string;  // Базовая валюта
  quoteCcy: string; // Валюта котировки
  ctVal: string;    // Стоимость контракта
  ctMult: string;   // Множитель контракта
  listTime: string; // Время листинга (timestamp)
  // ... другие поля
}

// Наша структура свечи
export interface CandleData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number; // Объем в базовой валюте (или контрактах)
  volumeQuote?: number; // Объем в валюте котировки (опционально)
}

// Наша структура торговой пары
export interface TradingPairInfo {
  symbol: string;
  baseCurrency: string;
  quoteCurrency: string;
  instrumentType: string;
}

// Маппинг наших таймфреймов на OKX API `bar` параметр
const TIMEFRAME_MAP: { [key: string]: string } = {
  '1m': '1m',
  '3m': '3m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1H',
  '2h': '2H',
  '4h': '4H',
  '6h': '6H',
  '12h': '12H',
  '1d': '1D',
  '1w': '1W',
  '1M': '1M',
  // Добавьте другие по необходимости
};

/**
 * Получает список фьючерсных и SWAP пар с OKX.
 * Фильтрует только SWAP (бессрочные) и FUTURES (срочные) контракты.
 */
export async function getFuturesPairs(): Promise<TradingPairInfo[]> {
  const futuresUrl = `${BASE_URL}/api/v5/public/instruments?instType=FUTURES`;
  const swapUrl = `${BASE_URL}/api/v5/public/instruments?instType=SWAP`;
  const pairs: TradingPairInfo[] = [];

  try {
    logger.info('Fetching FUTURES pairs from OKX...');
    const futuresResponse = await axios.get<OkxInstrumentsResponse>(futuresUrl);
    if (futuresResponse.data && futuresResponse.data.code === '0') {
      // Логируем часть сырых данных для отладки
      logger.debug('Raw FUTURES data sample:', futuresResponse.data.data?.slice(0, 5));
      const futuresPairs = futuresResponse.data.data
        // .filter(inst => inst.baseCcy && inst.quoteCcy) // Временно убираем фильтр
        .map(inst => ({
          symbol: inst.instId,
          baseCurrency: inst.baseCcy || inst.uly || '', // Пытаемся взять базовую валюту или андерлаинг
          quoteCurrency: inst.quoteCcy || '', // Пытаемся взять валюту котировки
          instrumentType: inst.instType,
        }));
      pairs.push(...futuresPairs);
      logger.info(`Fetched ${futuresPairs.length} FUTURES pairs (before filtering).`);
    } else {
      logger.error('Error fetching FUTURES pairs:', futuresResponse.data?.msg || 'Unknown error');
    }

    await delay(500); // Небольшая задержка перед следующим запросом

    logger.info('Fetching SWAP pairs from OKX...');
    const swapResponse = await axios.get<OkxInstrumentsResponse>(swapUrl);
    if (swapResponse.data && swapResponse.data.code === '0') {
      // Логируем часть сырых данных для отладки
      logger.debug('Raw SWAP data sample:', swapResponse.data.data?.slice(0, 5));
      const swapPairs = swapResponse.data.data
        // .filter(inst => inst.baseCcy && inst.quoteCcy) // Временно убираем фильтр
        .map(inst => ({
          symbol: inst.instId,
          baseCurrency: inst.baseCcy || inst.uly || '',
          quoteCurrency: inst.quoteCcy || '',
          instrumentType: inst.instType,
        }));
      pairs.push(...swapPairs);
      logger.info(`Fetched ${swapPairs.length} SWAP pairs (before filtering).`);
    } else {
      logger.error('Error fetching SWAP pairs:', swapResponse.data?.msg || 'Unknown error');
    }

  } catch (error: any) {
    logger.error('Error fetching instruments from OKX:', error.message || error);
  }

  logger.info(`Total pairs fetched: ${pairs.length}`);
  return pairs;
}

/**
 * Проверяет доступность торговой пары на OKX.
 * @param symbol - ID инструмента (например, BTC-USDT-SWAP)
 * @returns true если пара доступна, false если нет
 */
export async function validateTradingPair(symbol: string): Promise<boolean> {
  try {
    const url = `${BASE_URL}/api/v5/public/instruments`;
    
    // Определяем тип инструмента по символу
    let instType = '';
    if (symbol.includes('-SWAP')) {
      instType = 'SWAP';
    } else if (symbol.match(/-\d{6}$/)) { // Паттерн для фьючерсов с датой
      instType = 'FUTURES';
    } else {
      logger.warn(`Cannot determine instrument type for ${symbol}`);
      return false;
    }
    
    const params = { instType };
    const response = await axios.get<OkxInstrumentsResponse>(url, { params });
    
    if (response.data && response.data.code === '0') {
      const exists = response.data.data.some(inst => inst.instId === symbol);
      if (!exists) {
        logger.warn(`Trading pair ${symbol} not found in OKX ${instType} instruments`);
      }
      return exists;
    } else {
      logger.error(`Error validating trading pair ${symbol}: ${response.data?.msg || 'Unknown error'}`);
      return false;
    }
  } catch (error: any) {
    logger.error(`Exception validating trading pair ${symbol}:`, error.message || error);
    return false;
  }
}

/**
 * Получает информацию о доступном диапазоне торговли для символа в OKX
 * Возвращает дату начала торговли и текущую дату
 */
export async function getTradingDateRange(symbol: string): Promise<{ startTime: number | null; endTime: number; launchTime?: number }> {
  try {
    // 1. Получаем listTime из instruments API
    const url = `${BASE_URL}/api/v5/public/instruments`;
    
    // Определяем тип инструмента по символу
    let instType = '';
    if (symbol.includes('-SWAP')) {
      instType = 'SWAP';
    } else if (symbol.match(/-\d{6}$/)) {
      instType = 'FUTURES';
    } else {
      logger.warn(`[getTradingDateRange] Cannot determine instrument type for ${symbol}`);
      return { startTime: null, endTime: Date.now() };
    }
    
    const params = { instType };
    const response = await axios.get<OkxInstrumentsResponse>(url, { params });
    
    let launchTime: number | undefined;
    
    if (response.data && response.data.code === '0') {
      const instrument = response.data.data.find(inst => inst.instId === symbol);
      if (instrument && instrument.listTime) {
        launchTime = parseInt(instrument.listTime);
        logger.debug(`[getTradingDateRange] ${symbol} listTime from API: ${new Date(launchTime).toISOString()}`);
      }
    }
    
    // 2. Если listTime недоступен, пробуем получить первую свечу через исторические данные  
    let firstAvailableTime: number | null = null;
    
    if (!launchTime) {
      try {
        // Используем очень раннюю дату как начальную точку для поиска первой свечи
        const veryEarlyDate = new Date('2017-01-01').getTime();
        const recentDate = Date.now();
        
        const candleUrl = `${BASE_URL}/api/v5/market/history-candles`;
        const candleParams = {
          instId: symbol,
          bar: '1D', // Используем дневные свечи для определения начала
          after: recentDate,
          limit: 100, // Максимум для одного запроса
        };
        
        // Пытаемся получить старые данные, идя назад во времени
        let allCandles: { timestamp: number }[] = [];
        let currentAfter = recentDate;
        let attempts = 0;
        const maxAttempts = 10; // Ограничиваем количество запросов
        
        while (attempts < maxAttempts) {
          const candleResponse = await axios.get<OkxCandleResponse>(candleUrl, { 
            params: { ...candleParams, after: currentAfter }
          });
          await delay(250); // Respect rate limits
          
          if (candleResponse.data && candleResponse.data.code === '0' && candleResponse.data.data.length > 0) {
            const batchCandles = candleResponse.data.data.map(c => ({
              timestamp: parseInt(c[0], 10)
            }));
            
            allCandles.unshift(...batchCandles.reverse()); // Добавляем в правильном порядке
            
            // Берем самую старую свечу из этой пачки для следующего запроса
            const oldestTimestamp = parseInt(candleResponse.data.data[candleResponse.data.data.length - 1][0], 10);
            
            // Если мы достигли очень раннюю дату или получили меньше данных чем ожидали
            if (oldestTimestamp <= veryEarlyDate || candleResponse.data.data.length < 100) {
              break;
            }
            
            currentAfter = oldestTimestamp;
            attempts++;
          } else {
            break;
          }
        }
        
        if (allCandles.length > 0) {
          firstAvailableTime = allCandles[0].timestamp;
          logger.debug(`[getTradingDateRange] ${symbol} first available candle from historical data: ${new Date(firstAvailableTime).toISOString()}`);
        }
        
      } catch (candleError: any) {
        logger.warn(`[getTradingDateRange] Could not get first candle for ${symbol}: ${candleError.message}`);
      }
    }
    
    const endTime = Date.now();
    const startTime = launchTime || firstAvailableTime;
    
    logger.info(`[getTradingDateRange] ${symbol} trading range: ${startTime ? new Date(startTime).toISOString() : 'unknown'} to ${new Date(endTime).toISOString()}`);
    
    return {
      startTime,
      endTime,
      launchTime
    };
    
  } catch (error: any) {
    logger.error(`[getTradingDateRange] Error getting trading range for ${symbol}:`, error.message || error);
    return {
      startTime: null,
      endTime: Date.now()
    };
  }
}

/**
 * Получает исторические свечи для указанного символа и таймфрейма.
 * Автоматически обрабатывает пагинацию и Rate Limits OKX (100 свечей за раз, лимит запросов).
 * @param symbol - ID инструмента (например, BTC-USDT-SWAP)
 * @param timeframe - Наш таймфрейм ('15m', '1h', '4h', '1d')
 * @param startTime - Начальное время (timestamp ms), необязательно
 * @param endTime - Конечное время (timestamp ms), необязательно
 * @param limit - Максимальное количество свечей для загрузки (по умолчанию загружает все доступные в диапазоне)
 * @returns Массив объектов CandleData
 */
export async function getHistoricalCandles(
  symbol: string,
  timeframe: string,
  startTime?: number, // inclusive start
  endTime?: number,   // inclusive end (время открытия последней желаемой свечи)
  limit?: number
): Promise<CandleData[]> {
  const okxTimeframe = TIMEFRAME_MAP[timeframe];
  if (!okxTimeframe) {
    logger.error(`Unsupported timeframe: ${timeframe}`);
    return [];
  }

  // Валидация существования торговой пары перед запросом данных
  const isValidPair = await validateTradingPair(symbol);
  if (!isValidPair) {
    logger.error(`Trading pair ${symbol} is not available on OKX. Skipping data fetch.`);
    return [];
  }

  const allCandles: CandleData[] = [];
  // currentAfterForAPI будет временем открытия самой СТАРОЙ свечи из предыдущей пачки,
  // или endTime + 1 для самого первого запроса, чтобы включить свечу с timestamp === endTime.
  // OKX 'after=ts' -> отдает свечи СТАРШЕ ts (т.е. timestamp < ts)
  let currentAfterForAPI = endTime ? endTime + 1 : undefined; 
  const maxLimitPerRequest = 100;
  const requestDelay = 250;

  logger.info(`Fetching candles for ${symbol} (${timeframe}) for period ${startTime ? new Date(startTime).toISOString() : 'earliest'} to ${endTime ? new Date(endTime).toISOString() : 'latest available'}`);

  try {
    while (true) {
      const url = `${BASE_URL}/api/v5/market/history-candles`;
      const params: any = {
        instId: symbol,
        bar: okxTimeframe,
        limit: maxLimitPerRequest,
      };

      if (currentAfterForAPI) {
        params.after = currentAfterForAPI;
      }
      // startTime будет использован для фильтрации ниже.

      const response = await axios.get<OkxCandleResponse>(url, { params });
      await delay(requestDelay);

      if (response.data && response.data.code === '0' && response.data.data.length > 0) {
        // API возвращает свечи от новых к старым (по убыванию timestamp)
        let fetchedBatchApiResponse = response.data.data.map(c => ({
          timestamp: parseInt(c[0], 10),
          open: parseFloat(c[1]),
          high: parseFloat(c[2]),
          low: parseFloat(c[3]),
          close: parseFloat(c[4]),
          volume: parseFloat(c[5]), 
          volumeQuote: parseFloat(c[6]) 
        }));

        // Разворачиваем, чтобы обрабатывать от старых к новым в этой пачке
        fetchedBatchApiResponse.reverse();

        let candlesToProcessThisBatch = fetchedBatchApiResponse;

        // Фильтруем по startTime (включительно)
        if (startTime) {
          candlesToProcessThisBatch = candlesToProcessThisBatch.filter(c => c.timestamp >= startTime);
        }
        // Фильтруем по endTime (включительно)
        if (endTime) {
          candlesToProcessThisBatch = candlesToProcessThisBatch.filter(c => c.timestamp <= endTime);
        }
        
        if (candlesToProcessThisBatch.length > 0) {
          allCandles.unshift(...candlesToProcessThisBatch); // Добавляем в начало общего массива (т.к. пачки идут от новых к старым)
          // Новый 'after' для API будет timestamp самой старой свечи из *оригинального* ответа API этой пачки,
          // чтобы не пропустить данные при следующем запросе, если фильтрация отсекла самые старые.
          // response.data.data[response.data.data.length - 1] это самая старая свеча в ответе API (до reverse)
          currentAfterForAPI = parseInt(response.data.data[response.data.data.length - 1][0], 10);
          logger.debug(`Added ${candlesToProcessThisBatch.length} candles for ${symbol}. Oldest in batch: ${new Date(candlesToProcessThisBatch[0].timestamp)}. Next API 'after' will be: ${new Date(currentAfterForAPI)}`);
        } else {
           // Если после фильтрации пачка пуста, но API еще что-то вернул,
           // нужно обновить currentAfterForAPI, чтобы продолжить пагинацию назад
           if (response.data.data.length > 0) {
             currentAfterForAPI = parseInt(response.data.data[response.data.data.length - 1][0], 10);
           }
        }

        // Условия выхода:
        const oldestProcessedTimestamp = candlesToProcessThisBatch.length > 0 ? candlesToProcessThisBatch[0].timestamp : (allCandles.length > 0 ? allCandles[0].timestamp : null);
        
        const achievedStartTime = startTime && oldestProcessedTimestamp && oldestProcessedTimestamp <= startTime;
        const achievedLimit = limit && allCandles.length >= limit;
        // Если API вернул меньше, чем мы просили, значит, это все данные в этом направлении
        const noMoreDataFromApi = response.data.data.length < maxLimitPerRequest; 
        // Если после фильтрации ничего не осталось, и API больше ничего не дал, тоже выходим
        const emptyFilteredBatchAndApiReturnedLessThanMax = candlesToProcessThisBatch.length === 0 && noMoreDataFromApi;


        if (achievedStartTime || achievedLimit || noMoreDataFromApi || emptyFilteredBatchAndApiReturnedLessThanMax) {
          if(achievedStartTime) logger.info(`Stop reason: Achieved startTime for ${symbol}. Oldest processed: ${oldestProcessedTimestamp ? new Date(oldestProcessedTimestamp) : 'N/A'}`);
          if(achievedLimit) logger.info(`Stop reason: Achieved limit (${allCandles.length}/${limit}) for ${symbol}.`);
          if(noMoreDataFromApi) logger.info(`Stop reason: API returned ${response.data.data.length} (less than max ${maxLimitPerRequest}) for ${symbol}.`);
          if(emptyFilteredBatchAndApiReturnedLessThanMax) logger.info(`Stop reason: Empty batch after filtering and API has no more data for ${symbol}.`);
          break;
        }

      } else if (response.data && response.data.code !== '0') {
        logger.error(`Error fetching candles for ${symbol}: ${response.data.msg} (Code: ${response.data.code})`);
        break;
      } else {
        // Код '0', но data пустая или отсутствует - достигли конца истории или ошибка без сообщения
        logger.info(`Finished fetching candles for ${symbol}. No more data received or data array empty. Total fetched before this: ${allCandles.length}`);
        break;
      }
    } // end while

  } catch (error: any) {
    logger.error(`Exception in getHistoricalCandles for ${symbol}:`, error.message || error);
  }

  // Финальная сортировка, так как unshift мог выполняться для разных пачек не строго последовательно по времени
  allCandles.sort((a, b) => a.timestamp - b.timestamp);
  
  // Если был задан лимит, возвращаем только последние 'limit' свечей (самые новые)
  // Если allCandles короче, вернет все что есть.
  return limit ? allCandles.slice(-Math.min(limit, allCandles.length)) : allCandles;
}

/**
 * НОВАЯ ОПТИМИЗИРОВАННАЯ функция получения свечей с умным rate limiting
 * Рекомендуется использовать вместо getHistoricalCandles для новых реализаций
 * @param symbol - ID инструмента
 * @param timeframe - Таймфрейм
 * @param startTime - Начальное время
 * @param endTime - Конечное время  
 * @param limit - Лимит свечей
 * @returns Promise<CandleData[]>
 */
export async function getHistoricalCandlesOptimized(
  symbol: string,
  timeframe: string,
  startTime?: number,
  endTime?: number,
  limit?: number
): Promise<CandleData[]> {
  logger.info(`[OKX-Optimized] Fetching candles for ${symbol} using optimized algorithm`);
  
  const request: CandleRequest = {
    symbol,
    timeframe,
    startTime,
    endTime,
    limit
  };
  
  const result = await optimizedFetcher.fetchCandlesForSymbol(symbol, request);
  
  if (result.success) {
    logger.info(`[OKX-Optimized] Successfully fetched ${result.candles.length} candles for ${symbol} in ${result.fetchTimeMs}ms using ${result.requestsCount} requests`);
    // Логируем статистику rate limiter
    const stats = globalRateLimiter.getStats();
    logger.debug(`[OKX-Optimized] Rate limiter stats - Global: ${stats.global}/18, Instruments: ${JSON.stringify(stats.instruments)}`);
    
    return result.candles;
  } else {
    logger.error(`[OKX-Optimized] Failed to fetch candles for ${symbol}: ${result.error}`);
    return result.candles; // Возвращаем частичные данные если есть
  }
}

/**
 * НОВАЯ функция параллельной загрузки для портфельных бэктестов
 * Значительно ускоряет загрузку данных для множественных символов
 * @param requests - Массив запросов на загрузку
 * @param concurrentLimit - Лимит параллельных запросов (по умолчанию 3)
 * @returns Promise<Record<string, CandleData[]>>
 */
export async function getHistoricalCandlesParallel(
  requests: CandleRequest[],
  concurrentLimit: number = 3
): Promise<Record<string, CandleData[]>> {
  logger.info(`[OKX-Parallel] Starting parallel fetch for ${requests.length} requests with concurrency ${concurrentLimit}`);
  
  const results = await optimizedFetcher.fetchCandlesParallel(requests, concurrentLimit);
  
  // Преобразуем результаты в формат Record<string, CandleData[]>
  const candlesBySymbol: Record<string, CandleData[]> = {};
  let totalCandles = 0;
  let successCount = 0;
  
  for (const [symbol, result] of Object.entries(results)) {
    candlesBySymbol[symbol] = result.candles;
    totalCandles += result.candles.length;
    if (result.success) successCount++;
    
    if (!result.success) {
      logger.warn(`[OKX-Parallel] Failed to fetch data for ${symbol}: ${result.error}`);
    }
  }
  
  logger.info(`[OKX-Parallel] Parallel fetch completed. Success: ${successCount}/${Object.keys(results).length}, Total candles: ${totalCandles}`);
  
  // Логируем итоговую статистику rate limiter
  const stats = globalRateLimiter.getStats();
  logger.info(`[OKX-Parallel] Final rate limiter stats - Global: ${stats.global}/18, Active instruments: ${Object.keys(stats.instruments).length}`);
  
  return candlesBySymbol;
} 