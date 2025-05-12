import axios from 'axios';
import logger from '@/utils/logger';

// Базовый URL для публичного API OKX
const BASE_URL = 'https://www.okx.com';

// Функция-задержка для обхода Rate Limits
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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
  startTime?: number,
  endTime?: number,
  limit?: number
): Promise<CandleData[]> {
  const okxTimeframe = TIMEFRAME_MAP[timeframe];
  if (!okxTimeframe) {
    logger.error(`Unsupported timeframe: ${timeframe}`);
    return [];
  }

  const allCandles: CandleData[] = [];
  let currentEndTime = endTime;
  const maxLimitPerRequest = 100;
  const requestDelay = 250; // Задержка между запросами (ms) для обхода Rate Limit

  logger.info(`Fetching candles for ${symbol} (${timeframe}) starting from ${startTime ? new Date(startTime) : 'earliest'} up to ${endTime ? new Date(endTime) : 'now'}`);

  try {
    while (true) {
      const url = `${BASE_URL}/api/v5/market/history-candles`;
      const params: any = {
        instId: symbol,
        bar: okxTimeframe,
        limit: maxLimitPerRequest,
      };

      if (currentEndTime) {
        params.after = currentEndTime; // Загружаем свечи ДО указанного времени
      }
      if (startTime) {
         // OKX API не имеет прямого параметра `before` (start time) в этом эндпоинте,
         // но `after` позволяет двигаться назад во времени.
         // Мы будем фильтровать результат позже, если startTime задан.
      }

      const response = await axios.get<OkxCandleResponse>(url, { params });
      await delay(requestDelay);

      if (response.data && response.data.code === '0' && response.data.data.length > 0) {
        const candles = response.data.data.map(c => ({
          timestamp: parseInt(c[0], 10),
          open: parseFloat(c[1]),
          high: parseFloat(c[2]),
          low: parseFloat(c[3]),
          close: parseFloat(c[4]),
          volume: parseFloat(c[5]), // Объем в контрактах или базовой валюте
          volumeQuote: parseFloat(c[6]) // Объем в валюте котировки
        }));

        // Фильтруем по startTime, если он задан
        const filteredCandles = startTime ? candles.filter(c => c.timestamp >= startTime) : candles;

        // OKX возвращает свечи от новых к старым, переворачиваем для добавления
        filteredCandles.reverse();
        allCandles.unshift(...filteredCandles); // Добавляем в начало массива

        const oldestTimestamp = filteredCandles[0]?.timestamp;

        logger.debug(`Fetched ${filteredCandles.length} candles for ${symbol} up to ${new Date(oldestTimestamp)}`);

        // Условие выхода:
        // 1. Достигли startTime
        // 2. Загрузили нужное количество limit
        // 3. OKX вернул меньше 100 свечей (значит, достигли начала истории)
        // 4. Получили пустой массив (на всякий случай)
        if ( (startTime && oldestTimestamp && oldestTimestamp <= startTime) || 
             (limit && allCandles.length >= limit) ||
             candles.length < maxLimitPerRequest ||
             filteredCandles.length === 0
            ) {
          logger.info(`Finished fetching candles for ${symbol}. Total fetched: ${allCandles.length}`);
          break;
        }

        // Устанавливаем новое `endTime` для следующего запроса пагинации
        currentEndTime = oldestTimestamp;

      } else if (response.data.code !== '0') {
        logger.error(`Error fetching candles for ${symbol}: ${response.data.msg} (Code: ${response.data.code})`);
        break;
      } else {
        // Код '0', но data пустая - достигли конца
        logger.info(`Finished fetching candles for ${symbol}. No more data received. Total fetched: ${allCandles.length}`);
        break;
      }
    } // end while

  } catch (error: any) {
    logger.error(`Error in getHistoricalCandles for ${symbol}:`, error.message || error);
  }

  // Если был задан лимит, обрезаем массив
  if (limit && allCandles.length > limit) {
    // Так как мы добавляли в начало, берем последние limit элементов
    return allCandles.slice(-limit);
  }

  return allCandles;
} 