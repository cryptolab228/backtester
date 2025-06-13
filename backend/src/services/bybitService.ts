import axios from 'axios';
import logger from '@/utils/logger';
import { bybitGlobalRateLimiter } from './smartRateLimiter';
import config from '@/config';

// Константы Bybit API
const BYBIT_BASE_URL = process.env.BYBIT_API_URL || 'https://api.bybit.com';
const BYBIT_MAX_KLINES_PER_REQUEST = 1000; // Bybit поддерживает до 1000 свечей за запрос
const BYBIT_CATEGORY = 'linear'; // Фьючерсные контракты

// Интерфейсы для Bybit API
interface BybitCandleResponse {
  retCode: number;
  retMsg: string;
  result: {
    symbol: string;
    category: string;
    list: string[][]; // [startTime, openPrice, highPrice, lowPrice, closePrice, volume, turnover]
  };
  retExtInfo: {};
  time: number;
}

interface BybitInstrumentsResponse {
  retCode: number;
  retMsg: string;
  result: {
    category: string;
    list: BybitInstrument[];
    nextPageCursor?: string;
  };
}

interface BybitInstrument {
  symbol: string;
  contractType: string;
  status: string;
  baseCoin: string;
  quoteCoin: string;
  launchTime: string;
  deliveryTime?: string;
  deliveryFeeRate?: string;
  priceScale: string;
  leverageFilter: {
    minLeverage: string;
    maxLeverage: string;
    leverageStep: string;
  };
  priceFilter: {
    minPrice: string;
    maxPrice: string;
    tickSize: string;
  };
  lotSizeFilter: {
    maxOrderQty: string;
    maxMktOrderQty: string;
    minOrderQty: string;
    qtyStep: string;
    postOnlyMaxOrderQty?: string;
  };
  unifiedMarginTrade: boolean;
  fundingInterval: number;
  settleCoin: string;
}

// Наша унифицированная структура свечи
export interface CandleData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  volumeQuote?: number;
}

// Наша унифицированная структура торговой пары
export interface TradingPairInfo {
  symbol: string;
  baseCurrency: string;
  quoteCurrency: string;
  instrumentType: string;
}

// Маппинг наших таймфреймов на Bybit API интервалы
const TIMEFRAME_MAP: { [key: string]: string } = {
  '1m': '1',
  '3m': '3',
  '5m': '5',
  '15m': '15',
  '30m': '30',
  '1h': '60',
  '2h': '120',
  '4h': '240',
  '6h': '360',
  '12h': '720',
  '1d': 'D',
  '1w': 'W',
  '1M': 'M',
};

/**
 * Получает список фьючерсных пар с Bybit
 */
export async function getFuturesPairs(): Promise<TradingPairInfo[]> {
  const pairs: TradingPairInfo[] = [];
  let cursor = '';
  
  try {
    logger.info('Fetching futures pairs from Bybit...');
    
    do {
      // Ожидаем слот в RateLimiter
      await bybitGlobalRateLimiter.waitForSlot();
      
      const url = `${BYBIT_BASE_URL}/v5/market/instruments-info`;
      const params: any = {
        category: BYBIT_CATEGORY,
        limit: 1000, // Максимум за запрос
      };
      
      if (cursor) {
        params.cursor = cursor;
      }
      
      const response = await axios.get<BybitInstrumentsResponse>(url, { params });
      
      // Записываем факт запроса
      await bybitGlobalRateLimiter.recordRequest();
      
      if (response.data && response.data.retCode === 0) {
        const instrumentPairs = response.data.result.list
          .filter(inst => inst.status === 'Trading') // Только активные пары
          .map(inst => ({
            symbol: inst.symbol,
            baseCurrency: inst.baseCoin,
            quoteCurrency: inst.quoteCoin,
            instrumentType: 'FUTURES', // Bybit linear futures
          }));
        
        pairs.push(...instrumentPairs);
        cursor = response.data.result.nextPageCursor || '';
        
        logger.debug(`Fetched ${instrumentPairs.length} pairs from Bybit, total: ${pairs.length}`);
      } else {
        logger.error('Error fetching pairs from Bybit:', response.data?.retMsg || 'Unknown error');
        break;
      }
    } while (cursor);
    
    logger.info(`Successfully fetched ${pairs.length} futures pairs from Bybit`);
    return pairs;
    
  } catch (error: any) {
    logger.error('Error fetching instruments from Bybit:', error.message || error);
    return [];
  }
}

/**
 * Проверяет доступность торговой пары на Bybit
 */
export async function validateTradingPair(symbol: string): Promise<boolean> {
  try {
    await bybitGlobalRateLimiter.waitForSlot();
    
    const url = `${BYBIT_BASE_URL}/v5/market/instruments-info`;
    const params = {
      category: BYBIT_CATEGORY,
      symbol: symbol,
    };
    
    const response = await axios.get<BybitInstrumentsResponse>(url, { params });
    await bybitGlobalRateLimiter.recordRequest();
    
    if (response.data && response.data.retCode === 0) {
      const exists = response.data.result.list.some(inst => 
        inst.symbol === symbol && inst.status === 'Trading'
      );
      
      if (!exists) {
        logger.warn(`Trading pair ${symbol} not found or not trading on Bybit`);
      }
      return exists;
    } else {
      logger.error(`Error validating trading pair ${symbol}: ${response.data?.retMsg || 'Unknown error'}`);
      return false;
    }
  } catch (error: any) {
    logger.error(`Exception validating trading pair ${symbol}:`, error.message || error);
    return false;
  }
}

/**
 * Получает информацию о доступном диапазоне торговли для символа
 * Возвращает дату начала торговли и текущую дату
 */
export async function getTradingDateRange(symbol: string): Promise<{ startTime: number | null; endTime: number; launchTime?: number }> {
  try {
    // 1. Получаем launchTime из instruments-info
    await bybitGlobalRateLimiter.waitForSlot();
    
    const instrumentUrl = `${BYBIT_BASE_URL}/v5/market/instruments-info`;
    const instrumentParams = {
      category: BYBIT_CATEGORY,
      symbol: symbol,
    };
    
    const instrumentResponse = await axios.get<BybitInstrumentsResponse>(instrumentUrl, { params: instrumentParams });
    await bybitGlobalRateLimiter.recordRequest();
    
    let launchTime: number | undefined;
    
    if (instrumentResponse.data && instrumentResponse.data.retCode === 0) {
      const instrument = instrumentResponse.data.result.list.find(inst => inst.symbol === symbol);
      if (instrument && instrument.launchTime) {
        launchTime = parseInt(instrument.launchTime);
        logger.debug(`[getTradingDateRange] ${symbol} launchTime from API: ${new Date(launchTime).toISOString()}`);
      }
    }
    
    // 2. Если launchTime недоступен, пробуем получить первую свечу через API
    let firstAvailableTime: number | null = null;
    
    if (!launchTime) {
      try {
        await bybitGlobalRateLimiter.waitForSlot();
        
        const candleUrl = `${BYBIT_BASE_URL}/v5/market/kline`;
        const candleParams = {
          category: BYBIT_CATEGORY,
          symbol: symbol,
          interval: '1D', // Используем дневные свечи для определения начала
          limit: 1,
          // Не указываем start/end - получим самые последние свечи
        };
        
        const candleResponse = await axios.get<BybitCandleResponse>(candleUrl, { params: candleParams });
        await bybitGlobalRateLimiter.recordRequest();
        
        if (candleResponse.data && candleResponse.data.retCode === 0 && candleResponse.data.result.list.length > 0) {
          // Получаем первую доступную свечу, запросив исторические данные назад
          // Используем очень раннюю дату как начальную точку
          const veryEarlyDate = new Date('2017-01-01').getTime();
          const recentDate = Date.now();
          
          await bybitGlobalRateLimiter.waitForSlot();
          const historicalParams = {
            category: BYBIT_CATEGORY,
            symbol: symbol,
            interval: '1D',
            start: veryEarlyDate,
            end: recentDate,
            limit: 1, // Получаем только первую свечу
          };
          
          const historicalResponse = await axios.get<BybitCandleResponse>(candleUrl, { params: historicalParams });
          await bybitGlobalRateLimiter.recordRequest();
          
          if (historicalResponse.data && historicalResponse.data.retCode === 0 && historicalResponse.data.result.list.length > 0) {
            firstAvailableTime = parseInt(historicalResponse.data.result.list[0][0]);
            logger.debug(`[getTradingDateRange] ${symbol} first available candle: ${new Date(firstAvailableTime).toISOString()}`);
          }
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
 * Получает исторические свечи для указанного символа и таймфрейма (оптимизированный алгоритм Bybit)
 * 
 * КЛЮЧЕВЫЕ ОТЛИЧИЯ ОТ OKX:
 * - 1000 свечей за запрос (vs 300 у OKX) = 3.3x меньше запросов
 * - 120 запросов/сек (vs 30 у OKX) = 4x выше лимиты
 * - Пагинация через end/start параметры (vs before/after у OKX)
 * 
 * @param symbol - Символ инструмента (например, BTCUSDT)
 * @param timeframe - Наш таймфрейм ('15m', '1h', '4h', '1d')
 * @param targetStartDateMs - Начальное время (timestamp ms)
 * @param targetEndDateMs - Конечное время (timestamp ms)
 * @param limit - Максимальное количество свечей
 */
export async function getHistoricalCandlesForSymbolBybit(
  symbol: string,
  timeframe: string,
  targetStartDateMs?: number,
  targetEndDateMs?: number,
  limit?: number
): Promise<CandleData[]> {
  const bybitInterval = TIMEFRAME_MAP[timeframe];
  if (!bybitInterval) {
    logger.error(`Unsupported timeframe for Bybit: ${timeframe}`);
    return [];
  }

  // Валидация торговой пары
  const isValidPair = await validateTradingPair(symbol);
  if (!isValidPair) {
    logger.error(`Trading pair ${symbol} is not available on Bybit. Skipping data fetch.`);
    return [];
  }

  const allKlines: CandleData[] = [];
  let currentBatchEndTimeMs = targetEndDateMs || Date.now();
  let totalFetched = 0;

  logger.info(`Fetching Bybit candles for ${symbol} (${timeframe}) for period ${targetStartDateMs ? new Date(targetStartDateMs).toISOString() : 'earliest'} to ${new Date(currentBatchEndTimeMs).toISOString()}`);

  try {
    while (true) {
      // Проверка лимита
      if (limit && totalFetched >= limit) {
        logger.info(`Reached limit ${limit} for ${symbol}. Stopping fetch.`);
        break;
      }

      // Ожидаем слот в RateLimiter с учетом символа
      await bybitGlobalRateLimiter.waitForSlot(symbol);

      const url = `${BYBIT_BASE_URL}/v5/market/kline`;
      const params: any = {
        category: BYBIT_CATEGORY,
        symbol: symbol,
        interval: bybitInterval,
        end: currentBatchEndTimeMs,
        limit: Math.min(BYBIT_MAX_KLINES_PER_REQUEST, limit ? limit - totalFetched : BYBIT_MAX_KLINES_PER_REQUEST),
      };

      // Устанавливаем start для оптимизации запроса, если указан targetStartDateMs
      if (targetStartDateMs) {
        params.start = Math.max(targetStartDateMs, currentBatchEndTimeMs - (BYBIT_MAX_KLINES_PER_REQUEST * getIntervalMs(timeframe)));
      }

      logger.debug(`[Bybit] Requesting ${params.limit} candles for ${symbol} ending at ${new Date(currentBatchEndTimeMs).toISOString()}`);

      const response = await axios.get<BybitCandleResponse>(url, { params });
      
      // Записываем факт запроса
      await bybitGlobalRateLimiter.recordRequest(symbol);

      if (response.data && response.data.retCode === 0) {
        const klines = response.data.result.list;
        
        if (!klines || klines.length === 0) {
          logger.info(`No more candles available for ${symbol}. Stopping fetch.`);
          break;
        }

        // Конвертируем данные Bybit в наш формат
        const convertedKlines = klines.map(k => ({
          timestamp: parseInt(k[0], 10), // startTime
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
          volume: parseFloat(k[5]),
          volumeQuote: parseFloat(k[6]), // turnover
        })).filter(k => {
          // Фильтруем по диапазону
          const withinRange = (!targetStartDateMs || k.timestamp >= targetStartDateMs) &&
                             (!targetEndDateMs || k.timestamp <= targetEndDateMs);
          return withinRange;
        }).sort((a, b) => a.timestamp - b.timestamp); // Сортируем по возрастанию

        // Добавляем к общему массиву (в начало, так как идем от новых к старым)
        allKlines.unshift(...convertedKlines);
        totalFetched += convertedKlines.length;

        logger.debug(`[Bybit] Fetched ${convertedKlines.length} candles for ${symbol}. Total: ${totalFetched}`);

        // Определяем условия остановки
        const oldestTsInBatch = Math.min(...klines.map(k => parseInt(k[0], 10)));
        const reachedStart = targetStartDateMs && oldestTsInBatch <= targetStartDateMs;
        const noMoreData = klines.length < params.limit;
        const reachedLimit = limit && totalFetched >= limit;

        if (reachedStart || noMoreData || reachedLimit) {
          if (reachedStart) logger.info(`Reached start time for ${symbol}. Oldest: ${new Date(oldestTsInBatch).toISOString()}`);
          if (noMoreData) logger.info(`API returned ${klines.length} candles (less than requested ${params.limit}) for ${symbol}.`);
          if (reachedLimit) logger.info(`Reached limit ${limit} for ${symbol}.`);
          break;
        }

        // Устанавливаем конец следующего батча (исключаем последнюю полученную свечу)
        currentBatchEndTimeMs = oldestTsInBatch - 1;

      } else {
        logger.error(`Error fetching candles for ${symbol}: ${response.data?.retMsg || 'Unknown error'} (Code: ${response.data?.retCode})`);
        break;
      }
    }

    // Финальная сортировка и фильтрация
    const finalCandles = allKlines
      .filter((candle, index, arr) => {
        // Удаляем дубликаты по timestamp
        return index === 0 || candle.timestamp !== arr[index - 1].timestamp;
      })
      .sort((a, b) => a.timestamp - b.timestamp);

    logger.info(`Successfully fetched ${finalCandles.length} candles for ${symbol} (${timeframe}) from Bybit`);
    return finalCandles;

  } catch (error: any) {
    logger.error(`Error fetching historical candles for ${symbol} from Bybit:`, error.message || error);
    return [];
  }
}

/**
 * Получает размер интервала в миллисекундах
 */
function getIntervalMs(timeframe: string): number {
  const intervals: { [key: string]: number } = {
    '1m': 60 * 1000,
    '3m': 3 * 60 * 1000,
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '30m': 30 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '2h': 2 * 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
    '6h': 6 * 60 * 60 * 1000,
    '12h': 12 * 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000,
    '1w': 7 * 24 * 60 * 60 * 1000,
    '1M': 30 * 24 * 60 * 60 * 1000, // Приблизительно
  };
  return intervals[timeframe] || 60 * 1000;
}

/**
 * Получает исторические свечи с поддержкой параллельных запросов
 * (для совместимости с существующим кодом)
 */
export async function getHistoricalCandles(
  symbol: string,
  timeframe: string,
  startTime?: number,
  endTime?: number,
  limit?: number
): Promise<CandleData[]> {
  return getHistoricalCandlesForSymbolBybit(symbol, timeframe, startTime, endTime, limit);
}

/**
 * Получает исторические свечи (оптимизированная версия для совместимости)
 */
export async function getHistoricalCandlesOptimized(
  symbol: string,
  timeframe: string,
  startTime?: number,
  endTime?: number,
  limit?: number
): Promise<CandleData[]> {
  return getHistoricalCandlesForSymbolBybit(symbol, timeframe, startTime, endTime, limit);
} 