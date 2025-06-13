import { Job, Worker as BullWorker } from 'bullmq';
import logger from '@/utils/logger';
import config from '@/config';
import { createWorker, DATA_QUEUE_NAME, dataQueue, broadcastJobCounts } from '@/config/queue';
import * as okxService from '@/services/okxService';
import * as bybitService from '@/services/bybitService';
import { dataService } from '@/services/dataService';
import { broadcast } from '@/websocket';
import { runBacktest, runPortfolioBacktest } from '@/modules/backtester/backtester';
import type { BacktestRunParameters, PortfolioBacktestRunParameters } from '@/modules/backtester/backtester.types';
import type { CandleData } from '@/interfaces/marketData.interface';
import { CandleRequest } from '@/services/optimizedCandleFetcher';
import fs from 'fs';
import path from 'path';
import process from 'process';
import { getPortfolioResultsDirectory, getPortfolioResultsFilePath } from '@/utils/paths';

// Константы для имен задач
export const JOB_TYPES = {
  FETCH_PAIRS: 'fetch-pairs',
  FETCH_CANDLES: 'fetch-candles',
  FETCH_CANDLES_AND_RUN_BACKTEST: 'fetch-candles-and-run-backtest',
  FETCH_PORTFOLIO_DATA_AND_RUN_BACKTEST: 'FETCH_PORTFOLIO_DATA_AND_RUN_BACKTEST',
} as const;

// Интерфейсы для данных задач
interface FetchPairsJobData {
  exchange?: string; // НОВОЕ: поддержка биржи
  isUserPaused?: boolean;
}

interface FetchCandlesJobData {
  symbol: string;
  timeframe: string;
  startTime?: number;
  endTime?: number;
  limit?: number;
  exchange?: string; // НОВОЕ: поддержка биржи
  isUserPaused?: boolean;
}

interface FetchCandlesAndRunBacktestJobData {
  symbol: string;
  timeframe: string;
  startTime: number;
  endTime: number;
  backtestParams: BacktestRunParameters;
  exchange?: string; // НОВОЕ: поддержка биржи
  isUserPaused?: boolean;
}

interface FetchPortfolioDataAndRunBacktestJobData {
  portfolioParams: PortfolioBacktestRunParameters;
  pairsNeedingData: string[];
  startTimestamp: number;
  endTimestamp: number;
  exchange?: string; // НОВОЕ: поддержка биржи
  isUserPaused?: boolean;
}

type DataJobData = FetchPairsJobData | FetchCandlesJobData | FetchCandlesAndRunBacktestJobData | FetchPortfolioDataAndRunBacktestJobData;

/**
 * Получает API сервис для указанной биржи
 */
function getExchangeService(exchange: string = 'okx') {
  switch (exchange) {
    case 'bybit':
      return bybitService;
    case 'okx':
    default:
      return okxService;
  }
}

/**
 * Получает доступный диапазон торговли для символа на указанной бирже
 */
async function getTradingDateRange(symbol: string, exchange: string): Promise<{ startTime: number | null; endTime: number; launchTime?: number }> {
  try {
    const exchangeService = getExchangeService(exchange);
    
    // Проверяем, есть ли метод getTradingDateRange у сервиса биржи
    if ('getTradingDateRange' in exchangeService && typeof exchangeService.getTradingDateRange === 'function') {
      return await exchangeService.getTradingDateRange(symbol);
    } else {
      logger.warn(`[getTradingDateRange] Exchange ${exchange} does not support getTradingDateRange method`);
      return {
        startTime: null,
        endTime: Date.now()
      };
    }
  } catch (error: any) {
    logger.error(`[getTradingDateRange] Error getting trading range for ${symbol} on ${exchange}:`, error.message);
    return {
      startTime: null,
      endTime: Date.now()
    };
  }
}

/**
 * Обработчик задачи получения и сохранения списка торговых пар.
 */
const processFetchPairs = async (job: Job<FetchPairsJobData>) => {
  const { exchange = 'okx' } = job.data;
  logger.info(`Processing job ${JOB_TYPES.FETCH_PAIRS} (ID: ${job.id}) for exchange: ${exchange}`);
  
  try {
    logger.info(`Starting processFetchPairs for job ID: ${job.id}, exchange: ${exchange}`);
    
    const exchangeService = getExchangeService(exchange);
    const pairs = await exchangeService.getFuturesPairs();
    logger.debug(`[Job ${job.id}] Fetched ${pairs.length} pairs from ${exchange}.`);

    await dataService.saveOrUpdateTradingPairs(pairs, exchange);
    logger.debug(`[Job ${job.id}] Finished dataService.saveOrUpdateTradingPairs for ${exchange}.`);

    logger.info(`Finished processFetchPairs for job ID: ${job.id} successfully.`);

    return {
      success: true,
      exchange,
      pairsProcessed: pairs.length,
      message: `Successfully processed ${pairs.length} pairs for ${exchange}`
    };

  } catch (error: any) {
    logger.error(`Error processing job ${JOB_TYPES.FETCH_PAIRS} (ID: ${job.id}) for ${exchange}:`, error);
    throw error;
  }
};

/**
 * Обработчик задачи получения и сохранения исторических свечей.
 */
const processFetchCandles = async (job: Job<FetchCandlesJobData>) => {
  const { symbol, timeframe, startTime, endTime, limit, exchange = 'okx' } = job.data;
  
  logger.info(`[Worker] Received job ${JOB_TYPES.FETCH_CANDLES} (ID: ${job.id}) for ${symbol} (${timeframe}) on ${exchange}. Starting processing...`);

  try {
    logger.info(`Starting processFetchCandles for job ID: ${job.id}, symbol: ${symbol}, timeframe: ${timeframe}, exchange: ${exchange}`);
    logger.debug(`[Job ${job.id}] Calling ${exchange}Service.getHistoricalCandlesOptimized for ${symbol}...`);
    
    const exchangeService = getExchangeService(exchange);
    
    // Добавляем таймаут для предотвращения зависания при загрузке данных
    const fetchPromise = exchange === 'bybit' 
      ? bybitService.getHistoricalCandlesOptimized(symbol, timeframe, startTime, endTime, limit)
      : okxService.getHistoricalCandlesOptimized(symbol, timeframe, startTime, endTime, limit);
      
    const timeoutPromise = new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error(`${exchange.toUpperCase()} API timeout for ${symbol} after 5 minutes`)), 5 * 60 * 1000)
    );
    
    const candles = await Promise.race([fetchPromise, timeoutPromise]);
    logger.debug(`[Job ${job.id}] Fetched ${candles.length} candles for ${symbol} from ${exchange}.`);

    if (candles.length > 0) {
      logger.debug(`[Job ${job.id}] Calling dataService.saveCandles for ${symbol} on ${exchange}...`);
      await dataService.saveCandles(symbol, timeframe, candles, exchange);
      logger.debug(`[Job ${job.id}] Finished dataService.saveCandles for ${symbol} on ${exchange}.`);
    } else {
      logger.info(`[Job ${job.id}] No candles fetched for ${symbol} on ${exchange}, skipping database save.`);
    }

    logger.info(`Finished processFetchCandles for job ID: ${job.id} successfully.`);
    
    return {
      success: true,
      symbol,
      timeframe,
      exchange,
      candlesProcessed: candles.length,
      message: `Successfully processed ${candles.length} candles for ${symbol} (${timeframe}) on ${exchange}`
    };

  } catch (error: any) {
    logger.error(`Error processing job ${JOB_TYPES.FETCH_CANDLES} (ID: ${job.id}) for ${symbol} (${timeframe}) on ${exchange}: ${error.message}`, {
      stack: error.stack,
      symbol,
      timeframe,
      exchange,
      startTime,
      endTime,
      limit
    });
    throw error;
  }
};

// Обработчик для новой задачи FETCH_CANDLES_AND_RUN_BACKTEST
const processFetchCandlesAndRunBacktest = async (job: Job<FetchCandlesAndRunBacktestJobData>) => {
  const { symbol, timeframe, startTime, endTime, backtestParams, exchange = 'okx' } = job.data;
  const jobId = job.id;
  logger.info(`[Worker] Received job ${JOB_TYPES.FETCH_CANDLES_AND_RUN_BACKTEST} (ID: ${jobId}) for ${symbol} (${timeframe}) on ${exchange}.`);
  logger.debug(`[Job ${jobId}] Backtest params:`, backtestParams);

  try {
    // 1. Загрузка свечей
    logger.info(`[Job ${jobId}] Calling ${exchange}Service.getHistoricalCandlesOptimized for ${symbol} (${timeframe}) from ${new Date(startTime)} to ${new Date(endTime)}.`);
    
    const exchangeService = getExchangeService(exchange);
    const candlesFromAPI = exchange === 'bybit' 
      ? await bybitService.getHistoricalCandlesOptimized(symbol, timeframe, startTime, endTime)
      : await okxService.getHistoricalCandlesOptimized(symbol, timeframe, startTime, endTime);
      
    logger.info(`[Job ${jobId}] Fetched ${candlesFromAPI.length} candles from API for ${symbol} on ${exchange}.`);

    // 2. Сохранение свечей
    if (candlesFromAPI.length > 0) {
      logger.info(`[Job ${jobId}] Calling dataService.saveCandles for ${symbol} on ${exchange}.`);
      await dataService.saveCandles(symbol, timeframe, candlesFromAPI, exchange);
      logger.info(`[Job ${jobId}] Finished dataService.saveCandles for ${symbol} on ${exchange}.`);
    } else {
      logger.warn(`[Job ${jobId}] No candles fetched from API for ${symbol} on ${exchange}. Backtest might not have enough data.`);
    }

    // 3. Получение свечей из БД для бэктеста
    logger.info(`[Job ${jobId}] Fetching candles from DB for backtest: ${symbol} (${timeframe}) on ${exchange} from ${new Date(startTime)} to ${new Date(endTime)}`);
    const candlesFromDB = await dataService.getCandles(symbol, timeframe, startTime, endTime, exchange);
    logger.info(`[Job ${jobId}] Fetched ${candlesFromDB.length} candles from DB for backtest.`);

    if (!candlesFromDB || candlesFromDB.length === 0) {
      logger.error(`[Job ${jobId}] No candles found in DB for ${symbol} (${timeframe}) on ${exchange} in range after fetch. Cannot run backtest.`);
      throw new Error(`No candles in DB for ${symbol} on ${exchange} after fetch attempt.`);
    }

    // 4. Адаптация данных для бэктеста
    const candlesToBacktest: CandleData[] = candlesFromDB.map((c: any) => ({
      timestamp: Number(c.timestamp),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));
    logger.info(`[Job ${jobId}] Prepared ${candlesToBacktest.length} candles for backtest execution.`);

    // 5. Запуск бэктеста
    logger.info(`[Job ${jobId}] Starting backtest for ${symbol} on ${exchange} with params:`, backtestParams);
    const backtestResult = await runBacktest(backtestParams, candlesToBacktest);
    logger.info(`[Job ${jobId}] Backtest finished for ${symbol} on ${exchange}. Trades: ${backtestResult.metrics.totalTrades}.`);

    // Отправляем результат через WebSocket
    broadcast({
      type: 'BACKTEST_COMPLETED',
      payload: {
        jobId,
        symbol,
        timeframe,
        exchange,
        backtestParams,
        result: backtestResult
      }
    });
    logger.info(`[Job ${jobId}] Broadcasted BACKTEST_COMPLETED event.`);

    logger.info(`Finished job ${JOB_TYPES.FETCH_CANDLES_AND_RUN_BACKTEST} (ID: ${jobId}) successfully.`);

  } catch (error: any) {
    logger.error(`Error processing job ${JOB_TYPES.FETCH_CANDLES_AND_RUN_BACKTEST} (ID: ${jobId}) for ${symbol} (${timeframe}) on ${exchange}:`, error);
    throw error;
  }
};

// НОВАЯ оптимизированная функция для портфельной загрузки с параллельной обработкой
const processFetchPortfolioDataOptimized = async (job: Job<FetchPortfolioDataAndRunBacktestJobData>) => {
  const { portfolioParams, pairsNeedingData, startTimestamp, endTimestamp, exchange } = job.data;
  const jobId = job.id;
  const targetExchange = exchange || 'bybit'; // ИСПРАВЛЕНО: Используем exchange из job.data или default bybit
  
  logger.info(`[Worker-OPTIMIZED] Received job ${JOB_TYPES.FETCH_PORTFOLIO_DATA_AND_RUN_BACKTEST} (ID: ${jobId}) for ${pairsNeedingData.length} pairs using OPTIMIZED algorithm on ${targetExchange.toUpperCase()}.`);
  
  // ИСПРАВЛЕНО: Получаем правильный сервис биржи
  const exchangeService = getExchangeService(targetExchange);
  logger.info(`[Job-OPT ${jobId}] Using ${targetExchange.toUpperCase()} exchange service for data fetching.`);
  
  // ДЕБАГ: Логируем временной диапазон
  logger.info(`[Job-OPT ${jobId}] DEBUG: Time range requested: ${new Date(startTimestamp)} - ${new Date(endTimestamp)} (${Math.round((endTimestamp - startTimestamp) / (24 * 60 * 60 * 1000))} days)`);
  logger.info(`[Job-OPT ${jobId}] DEBUG: Portfolio params: ${JSON.stringify({ timeframe: portfolioParams.timeframe, pairSymbols: portfolioParams.pairSymbols.length + ' pairs' })}`);
  logger.info(`[Job-OPT ${jobId}] DEBUG: Pairs needing data: ${pairsNeedingData.slice(0, 5).join(', ')}${pairsNeedingData.length > 5 ? '...' : ''}`);

  try {
    // ИСПРАВЛЕНИЕ: Используем контроллерную логику - загружаем из БД только пары, которые НЕ нуждаются в дозагрузке
    const pairsAlreadyInDB = portfolioParams.pairSymbols.filter(pair => !pairsNeedingData.includes(pair));
    const totalPairsToProcess = portfolioParams.pairSymbols.length;
    
    logger.info(`[Job-OPT ${jobId}] Controller analysis: ${pairsNeedingData.length} pairs need API fetch, ${pairsAlreadyInDB.length} pairs should be in DB`);
    logger.info(`[Job-OPT ${jobId}] Pairs needing API fetch: ${pairsNeedingData.join(', ')}`);
    logger.info(`[Job-OPT ${jobId}] Pairs expected in DB: ${pairsAlreadyInDB.join(', ')}`);
    
    // 1. Загружаем данные из БД для пар, которые НЕ требуют API дозагрузки
    const candlesFromDB: Record<string, CandleData[]> = {};
    let totalCandlesFromDB = 0;
    
    logger.info(`[Job-OPT ${jobId}] Loading existing data from DATABASE for ${pairsAlreadyInDB.length} pairs...`);
    
    // ВАЖНО: Ограничиваем количество пар для предотвращения перегрузки
    const MAX_PAIRS_LIMIT = 50; // Максимум 50 пар за раз
    const MAX_CANDLES_PER_PAIR = 30000; // Увеличено до 30К свечей на пару (для 3+ лет 1h данных ~26300 свечей)
    const MAX_TOTAL_CANDLES = 500000; // Увеличено до 500К свечей всего
    
    let actualPairsAlreadyInDB = pairsAlreadyInDB;
    
    if (totalPairsToProcess > MAX_PAIRS_LIMIT) {
      logger.warn(`[Job-OPT ${jobId}] Too many pairs requested (${totalPairsToProcess}). Limiting portfolio to first ${MAX_PAIRS_LIMIT} pairs.`);
      portfolioParams.pairSymbols = portfolioParams.pairSymbols.slice(0, MAX_PAIRS_LIMIT);
      // Пересчитываем списки после ограничения
      const limitedPairsNeedingData = pairsNeedingData.filter(pair => portfolioParams.pairSymbols.includes(pair));
      actualPairsAlreadyInDB = portfolioParams.pairSymbols.filter(pair => !limitedPairsNeedingData.includes(pair));
      logger.warn(`[Job-OPT ${jobId}] After limiting: ${limitedPairsNeedingData.length} need API, ${actualPairsAlreadyInDB.length} from DB`);
    }
    
    for (const symbol of actualPairsAlreadyInDB) {
      try {
        // ИСПРАВЛЕНО: Убираем принудительное ограничение временного диапазона для пар из БД
        // Контроллер уже проанализировал покрытие данных, поэтому используем полный запрошенный диапазон
        let effectiveStartTime = startTimestamp;
        let effectiveEndTime = endTimestamp;
        
        const timeRangeMs = endTimestamp - startTimestamp;
        const timeRangeDays = Math.round(timeRangeMs / (24 * 60 * 60 * 1000));
        logger.debug(`[Job-OPT ${jobId}] Loading ${symbol} for full requested range: ${timeRangeDays} days (${new Date(effectiveStartTime)} - ${new Date(effectiveEndTime)})`);
        
        logger.debug(`[Job-OPT ${jobId}] Loading ${symbol} from DB: ${new Date(effectiveStartTime)} - ${new Date(effectiveEndTime)}`);
        // ИСПРАВЛЕНО: Передаем exchange в dataService
        const candles = await dataService.getCandles(symbol, portfolioParams.timeframe, effectiveStartTime, effectiveEndTime, targetExchange);
        logger.debug(`[Job-OPT ${jobId}] DB returned ${candles.length} candles for ${symbol}`);
        
        // ДИАГНОСТИКА: Проверяем структуру и типы данных первой свечи
        if (candles.length > 0) {
          const firstCandle = candles[0];
          logger.info(`[Job-OPT ${jobId}] 🔍 DATA TYPES DIAGNOSIS for ${symbol}:`);
          logger.info(`[Job-OPT ${jobId}]   timestamp: ${firstCandle.timestamp} (type: ${typeof firstCandle.timestamp})`);
          logger.info(`[Job-OPT ${jobId}]   open: ${firstCandle.open} (type: ${typeof firstCandle.open})`);
          logger.info(`[Job-OPT ${jobId}]   high: ${firstCandle.high} (type: ${typeof firstCandle.high})`);
          logger.info(`[Job-OPT ${jobId}]   low: ${firstCandle.low} (type: ${typeof firstCandle.low})`);
          logger.info(`[Job-OPT ${jobId}]   close: ${firstCandle.close} (type: ${typeof firstCandle.close})`);
          logger.info(`[Job-OPT ${jobId}]   volume: ${firstCandle.volume} (type: ${typeof firstCandle.volume})`);
          
          // Проверяем арифметические операции
          const openNum = parseFloat(firstCandle.open as any);
          const closeNum = parseFloat(firstCandle.close as any);
          logger.info(`[Job-OPT ${jobId}]   🧮 ARITHMETIC TEST: open + close = ${firstCandle.open} + ${firstCandle.close} = ${(firstCandle.open as any) + (firstCandle.close as any)} (direct)`);
          logger.info(`[Job-OPT ${jobId}]   🧮 ARITHMETIC TEST: parseFloat(open) + parseFloat(close) = ${openNum} + ${closeNum} = ${openNum + closeNum} (parsed)`);
        }
        
        // Ограничиваем количество свечей на пару
        let limitedCandles = candles;
        if (candles.length > MAX_CANDLES_PER_PAIR) {
          limitedCandles = candles.slice(-MAX_CANDLES_PER_PAIR); // Берем последние свечи
          logger.warn(`[Job-OPT ${jobId}] Too many candles for ${symbol} (${candles.length}). Limited to ${MAX_CANDLES_PER_PAIR} recent candles.`);
          
          // Дополнительная диагностика после ограничения
          if (limitedCandles.length > 0) {
            const firstLimited = limitedCandles[0];
            const lastLimited = limitedCandles[limitedCandles.length - 1];
            logger.debug(`[Job-OPT ${jobId}] After limiting ${symbol}: first candle timestamp=${firstLimited.timestamp} (${typeof firstLimited.timestamp}), last candle timestamp=${lastLimited.timestamp} (${typeof lastLimited.timestamp})`);
          }
        }
        
        // ДЕБАГ: Логируем временной диапазон свечей
        if (limitedCandles.length > 0) {
          try {
            // ИСПРАВЛЕНО: Правильная обработка timestamp (может быть в секундах или миллисекундах)
            const firstTimestamp = limitedCandles[0].timestamp;
            const lastTimestamp = limitedCandles[limitedCandles.length - 1].timestamp;
            
            // Проверяем, что timestamp - числа
            if (typeof firstTimestamp !== 'number' || typeof lastTimestamp !== 'number') {
              logger.warn(`[Job-OPT ${jobId}] Invalid timestamp types for ${symbol}: first=${typeof firstTimestamp}, last=${typeof lastTimestamp}`);
            } else {
              // Если timestamp в секундах (меньше 10^12), то умножаем на 1000
              const firstMs = firstTimestamp < 1e12 ? firstTimestamp * 1000 : firstTimestamp;
              const lastMs = lastTimestamp < 1e12 ? lastTimestamp * 1000 : lastTimestamp;
              
              // Проверяем диапазон валидных timestamp (от 1970 до 2100 года)
              const minValidTime = new Date('1970-01-01').getTime();
              const maxValidTime = new Date('2100-01-01').getTime();
              
              if (firstMs >= minValidTime && firstMs <= maxValidTime && 
                  lastMs >= minValidTime && lastMs <= maxValidTime) {
                const firstCandle = new Date(firstMs);
                const lastCandle = new Date(lastMs);
                logger.debug(`[Job-OPT ${jobId}] ${symbol} DB data range: ${firstCandle.toISOString()} - ${lastCandle.toISOString()} (${limitedCandles.length} candles)`);
              } else {
                logger.warn(`[Job-OPT ${jobId}] Invalid timestamp range for ${symbol}: first=${firstMs}, last=${lastMs}. Raw values: first=${firstTimestamp}, last=${lastTimestamp}`);
              }
            }
          } catch (timeError: any) {
            logger.warn(`[Job-OPT ${jobId}] Failed to process timestamps for ${symbol}: ${timeError.message}. First=${limitedCandles[0]?.timestamp}, Last=${limitedCandles[limitedCandles.length - 1]?.timestamp}`);
          }
        }
        
        candlesFromDB[symbol] = limitedCandles;
        totalCandlesFromDB += limitedCandles.length;
        
        // Проверяем общий лимит свечей
        if (totalCandlesFromDB > MAX_TOTAL_CANDLES) {
          logger.warn(`[Job-OPT ${jobId}] Total candles limit (${MAX_TOTAL_CANDLES}) reached. Stopping data loading.`);
          break;
        }
        
        if (limitedCandles.length > 0) {
          logger.debug(`[Job-OPT ${jobId}] Loaded ${limitedCandles.length} candles from DB for ${symbol}.`);
        } else {
          logger.warn(`[Job-OPT ${jobId}] No data in DB for ${symbol} - this should not happen for pairs marked as ready in controller.`);
        }
      } catch (error: any) {
        logger.warn(`[Job-OPT ${jobId}] Failed to load ${symbol} from DB: ${error.message}`);
        candlesFromDB[symbol] = [];
      }
    }
    
    logger.info(`[Job-OPT ${jobId}] DATABASE load completed: ${actualPairsAlreadyInDB.length} pairs loaded from DB with ${totalCandlesFromDB} total candles.`);

    // 2. Загружаем данные через API только для пар, указанных контроллером как требующих дозагрузки
    let finalCandlesData: Record<string, CandleData[]>;
    
    if (pairsNeedingData.length === 0) {
      // Все данные уже в БД
      logger.info(`[Job-OPT ${jobId}] All pairs already in DB. Using DATABASE data only (100% coverage). Skipping API fetch.`);
      finalCandlesData = candlesFromDB;
    } else {
      // Догружаем только пары требующие дозагрузки, комбинируем с БД данными
      logger.info(`[Job-OPT ${jobId}] Fetching data for ${pairsNeedingData.length} pairs via API as determined by controller...`);
      
      const missingPairsData: Record<string, CandleData[]> = {};
      
      // Загружаем данные только для пар требующих дозагрузки согласно анализу контроллера
      for (const symbol of pairsNeedingData) {
        try {
          logger.info(`[OptimizedFetcher] Fetching data for ${symbol} (${Math.round((endTimestamp - startTimestamp) / (24 * 60 * 60 * 1000))} days)...`);
          
          const candles = await exchangeService.getHistoricalCandles(
            symbol,
            portfolioParams.timeframe,
            startTimestamp,
            endTimestamp
          );
          
          logger.info(`[OptimizedFetcher] Completed fetch for ${symbol}: ${candles.length} candles`);
          missingPairsData[symbol] = candles;
          
          // Сохраняем в БД
          if (candles.length > 0) {
            await dataService.saveCandles(symbol, portfolioParams.timeframe, candles, targetExchange);
            logger.debug(`[Job-OPT ${jobId}] Saved ${candles.length} candles for ${symbol} on ${targetExchange}.`);
          }
        } catch (error: any) {
          logger.error(`[OptimizedFetcher] Failed to fetch ${symbol}: ${error.message}`);
          missingPairsData[symbol] = [];
        }
      }
      
      const totalCandlesFromAPI = Object.values(missingPairsData).reduce((sum, candles) => sum + candles.length, 0);
      logger.info(`[Job-OPT ${jobId}] API fetch completed: ${totalCandlesFromAPI} total candles loaded for ${pairsNeedingData.length} pairs from ${targetExchange.toUpperCase()} API.`);

      // Комбинируем данные из БД и API
      finalCandlesData = { ...candlesFromDB, ...missingPairsData };
      
      logger.info(`[Job-OPT ${jobId}] Combined data: ${Object.keys(candlesFromDB).length} pairs from DB + ${Object.keys(missingPairsData).length} pairs from API = ${Object.keys(finalCandlesData).length} total pairs`);
    }

    // 4. Запуск портфельного бэктеста с финальными данными
    const totalFinalCandles = Object.values(finalCandlesData).reduce((sum, candles) => sum + candles.length, 0);
    const successfulFinalPairs = Object.values(finalCandlesData).filter(candles => candles.length > 0).length;
    
    logger.info(`[Job-OPT ${jobId}] Starting OPTIMIZED portfolio backtest with ${totalFinalCandles} total candles across ${successfulFinalPairs} pairs.`);
    
    const portfolioBacktestResult = await runPortfolioBacktest(portfolioParams, finalCandlesData);
    logger.info(`[Job-OPT ${jobId}] OPTIMIZED portfolio backtest finished. Total trades: ${portfolioBacktestResult.overallMetrics.totalPortfolioTrades}, Total PnL: ${portfolioBacktestResult.overallMetrics.totalPortfolioPnl}.`);

    // Проверяем размер результатов перед отправкой
    const resultString = JSON.stringify(portfolioBacktestResult);
    const resultSizeMB = resultString.length / (1024 * 1024);
    logger.info(`[Job-OPT ${jobId}] Portfolio backtest results size: ${resultSizeMB.toFixed(2)}MB`);
    
    // Если результаты слишком большие (>10MB), сохраняем в файл
    if (resultSizeMB > 10) {
      logger.info(`[Job-OPT ${jobId}] Portfolio backtest results are large (${resultSizeMB.toFixed(2)}MB). Saving to file instead of WebSocket.`);
      
      // Создаем имя файла с jobId и timestamp
      const timestamp = Date.now();
      const filename = `portfolio-backtest-${jobId}-${timestamp}.json`;
      const portfolioResultsDir = getPortfolioResultsDirectory();
      const filepath = getPortfolioResultsFilePath(filename);
      
      // Создаем директорию если она не существует
      try {
        await fs.promises.mkdir(portfolioResultsDir, { recursive: true });
        logger.debug(`[Job-OPT ${jobId}] Portfolio results directory created/verified: ${portfolioResultsDir}`);
        
        // Проверяем права доступа к директории
        await fs.promises.access(portfolioResultsDir, fs.constants.W_OK);
        logger.debug(`[Job-OPT ${jobId}] Portfolio results directory is writable: ${portfolioResultsDir}`);
      } catch (mkdirError: any) {
        logger.error(`[Job-OPT ${jobId}] Failed to create portfolio results directory: ${mkdirError.message}`);
        throw new Error(`Failed to create directory for saving results: ${mkdirError.message}`);
      }
      
      // Сохраняем полные результаты в файл с улучшенной обработкой ошибок
      try {
        logger.info(`[Job-OPT ${jobId}] Starting file write: ${filepath} (${resultSizeMB.toFixed(2)}MB)`);
        
        // Проверяем доступное место на диске
        try {
          const diskStats = await fs.promises.statfs(portfolioResultsDir);
          const availableSpaceGB = (diskStats.bavail * diskStats.bsize) / (1024 * 1024 * 1024);
          const requiredSpaceMB = resultSizeMB * 1.1; // 10% запас
          logger.info(`[Job-OPT ${jobId}] Disk space check: available ${availableSpaceGB.toFixed(2)}GB, required ${requiredSpaceMB.toFixed(2)}MB`);
          
          if (availableSpaceGB * 1024 < requiredSpaceMB) {
            throw new Error(`Insufficient disk space: available ${availableSpaceGB.toFixed(2)}GB, required ${requiredSpaceMB.toFixed(2)}MB`);
          }
        } catch (diskError: any) {
          logger.warn(`[Job-OPT ${jobId}] Could not check disk space: ${diskError.message}`);
          // Продолжаем выполнение, так как statfs может не поддерживаться на всех системах
        }
        
        await fs.promises.writeFile(filepath, resultString, 'utf8');
        logger.info(`[Job-OPT ${jobId}] File write completed: ${filepath}`);
        
        // Проверяем что файл действительно создался
        const stats = await fs.promises.stat(filepath);
        logger.info(`[Job-OPT ${jobId}] File verification successful: ${filename}, size: ${stats.size} bytes`);
        
        // Проверяем что содержимое файла корректно
        const testRead = await fs.promises.readFile(filepath, 'utf8');
        if (testRead.length === resultString.length) {
          logger.info(`[Job-OPT ${jobId}] File content verification successful: ${filename}`);
        } else {
          logger.error(`[Job-OPT ${jobId}] File content verification failed: expected ${resultString.length} bytes, got ${testRead.length} bytes`);
          throw new Error(`File content verification failed for ${filename}`);
        }
        
      } catch (writeError: any) {
        logger.error(`[Job-OPT ${jobId}] Failed to write portfolio results file: ${writeError.message}`, {
          filepath,
          filename,
          error: writeError,
          stack: writeError.stack
        });
        throw new Error(`Failed to save portfolio results to file: ${writeError.message}`);
      }
      
      logger.info(`[Job-OPT ${jobId}] Portfolio backtest results saved to file: ${filename}`);
      
      // Отправляем метаданные и ссылку на скачивание
      broadcast({
        type: 'PORTFOLIO_BACKTEST_COMPLETED',
        payload: {
          jobId,
          portfolioParams,
          result: {
            overallMetrics: portfolioBacktestResult.overallMetrics,
            metricsByPair: portfolioBacktestResult.metricsByPair,
            // Увеличиваем набор сделок для превью до 1000 на пару
            tradesByPair: Object.fromEntries(
              Object.entries(portfolioBacktestResult.tradesByPair || {}).map(([pair, trades]) => [
                pair,
                Array.isArray(trades) ? trades.slice(0, 1000) : [] // Увеличено с 100 до 1000
              ])
            ),
            _largeDataSavedToFile: true,
            _downloadUrl: `/api/portfolio-results/${filename}`,
            _fullDataSize: `${resultSizeMB.toFixed(2)}MB`,
            _previewNote: 'This is a preview. Download the full results using the link above.'
          },
          optimized: true,
          fileInfo: {
            filename,
            downloadUrl: `/api/portfolio-results/${filename}`,
            sizeBytes: resultString.length,
            sizeMB: resultSizeMB.toFixed(2)
          },
          stats: {
            totalCandlesLoaded: totalFinalCandles,
            successfulPairs: successfulFinalPairs,
            totalPairs: portfolioParams.pairSymbols.length,
            fetchMethod: pairsNeedingData.length === 0 ? 'database-only' : 'hybrid-db-api',
            pairsFromDB: actualPairsAlreadyInDB.length,
            pairsFromAPI: pairsNeedingData.length,
            candlesFromDB: totalCandlesFromDB
          }
        }
      });
    } else {
      // Результаты достаточно малы для WebSocket передачи
      logger.info(`[Job-OPT ${jobId}] Sending portfolio results via WebSocket with data reduction...`);
      
      // Создаем сжатую версию результатов  
      const reducedResult = {
        overallMetrics: portfolioBacktestResult.overallMetrics,
        metricsByPair: portfolioBacktestResult.metricsByPair,
        // Увеличиваем лимит сделок до 500 на пару для лучшего отображения
        tradesByPair: Object.fromEntries(
          Object.entries(portfolioBacktestResult.tradesByPair || {}).map(([pair, trades]) => [
            pair,
            Array.isArray(trades) ? trades.slice(0, 500) : [] // Увеличено с 20 до 500
          ])
        ),
        _dataReduced: true,
        _originalTradesCount: portfolioBacktestResult.overallMetrics.totalPortfolioTrades,
        _note: 'Data reduced for WebSocket transmission'
      };
      
      // Отправляем сжатую версию
      broadcast({
        type: 'PORTFOLIO_BACKTEST_COMPLETED',
        payload: {
          jobId,
          portfolioParams,
          result: reducedResult,
          optimized: true,
          stats: {
            totalCandlesLoaded: totalFinalCandles,
            successfulPairs: successfulFinalPairs,
            totalPairs: portfolioParams.pairSymbols.length,
            fetchMethod: pairsNeedingData.length === 0 ? 'database-only' : 'hybrid-db-api',
            pairsFromDB: actualPairsAlreadyInDB.length,
            pairsFromAPI: pairsNeedingData.length,
            candlesFromDB: totalCandlesFromDB
          }
        }
      });
    }

    // ДОПОЛНИТЕЛЬНО: Отправляем событие о завершении задачи для обновления UI
    setTimeout(() => {
      broadcast({
        type: 'JOB_COMPLETED',
        payload: {
          jobId,
          jobType: 'FETCH_PORTFOLIO_DATA_AND_RUN_BACKTEST',
          status: 'completed',
          timestamp: new Date().toISOString()
        }
      });
      logger.info(`[Job-OPT ${jobId}] Sent JOB_COMPLETED event to update UI state.`);
    }, 500); // Небольшая задержка чтобы результаты пришли первыми
    
    logger.info(`[Job-OPT ${jobId}] Broadcasted OPTIMIZED PORTFOLIO_BACKTEST_COMPLETED event.`);

    logger.info(`Finished OPTIMIZED job ${JOB_TYPES.FETCH_PORTFOLIO_DATA_AND_RUN_BACKTEST} (ID: ${jobId}) successfully.`);

  } catch (error: any) {
    logger.error(`Error processing OPTIMIZED job ${JOB_TYPES.FETCH_PORTFOLIO_DATA_AND_RUN_BACKTEST} (ID: ${jobId}):`, error);
    
    broadcast({
      type: 'PORTFOLIO_BACKTEST_FAILED',
      payload: {
        jobId,
        portfolioParams,
        error: { 
          message: error.message,
        },
        optimized: true
      }
    });
    logger.info(`[Job-OPT ${jobId}] Broadcasted OPTIMIZED PORTFOLIO_BACKTEST_FAILED event.`);
    throw error;
  }
};

// Главный процессор задач для очереди данных
const dataProcessor = async (job: Job<DataJobData>) => {
  logger.debug(`[Worker] Picked up job ${job.name} (ID: ${job.id}).`); // Лог получения задачи воркером

  // ---> Проверка флага isUserPaused <--- 
  if (job.data?.isUserPaused === true) {
    logger.info(`[Worker] Job ${job.id} (${job.name}) is paused by user. Attempting to move to delayed state and skipping processing.`);
    try {
      // Проверяем текущее состояние задачи
      const currentState = await job.getState();
      logger.debug(`[Worker] Job ${job.id} current state before delay: ${currentState}`);
      
      // Перемещаем в delayed на очень долгий срок (имитация паузы)
      const VERY_LARGE_DELAY = 24 * 60 * 60 * 1000 * 365 * 10; // 10 лет
      await (job as any).moveToDelayed(Date.now() + VERY_LARGE_DELAY, undefined, true); // Добавлен токен и флаг
      logger.info(`[Worker] Job ${job.id} successfully moved to delayed state due to user pause.`);
      return; // Важно! Завершаем обработку этой задачи воркером
    } catch (delayError: any) {
      logger.error(`[Worker] Failed to move user-paused job ${job.id} to delayed state: ${delayError.message}. Job will remain in its current state but processing will be skipped.`, { stack: delayError.stack });
      // Даже если не удалось переместить, не обрабатываем ее
      return; 
    }
  } else {
    // Логируем, что задача не на паузе
    logger.debug(`[Worker] Job ${job.id} (${job.name}) is not paused, proceeding with processing.`);
  }
  // -------------------------------------

  switch (job.name) {
    case JOB_TYPES.FETCH_PAIRS:
      await processFetchPairs(job as Job<FetchPairsJobData>);
      break;
    case JOB_TYPES.FETCH_CANDLES:
      await processFetchCandles(job as Job<FetchCandlesJobData>);
      break;
    case JOB_TYPES.FETCH_CANDLES_AND_RUN_BACKTEST:
      await processFetchCandlesAndRunBacktest(job as Job<FetchCandlesAndRunBacktestJobData>);
      break;
    case JOB_TYPES.FETCH_PORTFOLIO_DATA_AND_RUN_BACKTEST:
      await processFetchPortfolioDataOptimized(job as Job<FetchPortfolioDataAndRunBacktestJobData>);
      break;
    default:
      logger.warn(`Unknown job type: ${job.name}`);
      // Для неизвестных типов лучше выбросить ошибку, чтобы задача не считалась успешной
      throw new Error(`Unknown job type: ${job.name}`);
  }
};

// Создаем инстанс воркера
const worker = createWorker<DataJobData>(DATA_QUEUE_NAME, dataProcessor);

// --- Добавляем слушателей событий к созданному воркеру --- 
worker.on('completed', async (job: Job, result: any) => {
  const jobId = job?.id; // Определяем jobId здесь
  const jobName = job?.name || 'unknown';
  logger.info(`[Queue Events][Worker] Job ${jobName} (ID: ${jobId || 'unknown'}) completed successfully.`);

  try {
    if (typeof jobId === 'string') { // Проверяем, что jobId это строка
      const currentJob = await dataQueue.getJob(jobId); // <--- ИСПОЛЬЗУЕМ ПРОВЕРЕННЫЙ jobId
      if (currentJob) {
        // ... остальная логика broadcast ...
        broadcast({
          type: 'job_updated',
          jobId: currentJob.id, // ID из currentJob
          name: currentJob.name,
          status: 'completed',
          timestamp: currentJob.timestamp ? new Date(currentJob.timestamp).toISOString() : new Date().toISOString(),
          data: currentJob.data,
          opts: currentJob.opts,
          attemptsMade: currentJob.attemptsMade,
          processedOn: currentJob.processedOn ? new Date(currentJob.processedOn).toISOString() : null,
          finishedOn: currentJob.finishedOn ? new Date(currentJob.finishedOn).toISOString() : new Date().toISOString(),
          failedReason: currentJob.failedReason,
          progress: currentJob.progress,
          returnValue: result
        });
        logger.debug(`[Worker Listener - completed] Broadcast sent for job ${jobId}.`);
      } else {
        logger.warn(`[Worker Listener - completed] Could not get job ${jobId} from queue for broadcasting.`);
      }
    } else {
      logger.warn(`[Worker Listener - completed] Job ID is undefined. Skipping broadcast for job object:`, job);
    }
    broadcastJobCounts();
  } catch (error) {
    logger.error(`[Worker Listener - completed] Error during broadcast for job ${jobId || 'unknown'}:`, error);
    broadcastJobCounts();
  }
});

// --- Обработчик 'failed' --- 
worker.on('failed', async (job: Job | undefined, error: Error) => {
  const jobId = job?.id;
  const jobName = job?.name || 'unknown';
  logger.error(`[Queue Events][Worker] Job ${jobName} (ID: ${jobId || 'unknown'}) failed:`, error);
  try {
    let jobDataToSend: any;
    let currentJob: Job | null = null;
    if (job && job.id) {
       currentJob = await dataQueue.getJob(job.id); 
    }
    
    if(currentJob) {
      jobDataToSend = {
        type: 'job_updated',
        jobId: currentJob.id,
        name: currentJob.name,
        status: 'failed', 
        timestamp: currentJob.timestamp ? new Date(currentJob.timestamp).toISOString() : null,
        processedOn: currentJob.processedOn ? new Date(currentJob.processedOn).toISOString() : null,
        finishedOn: currentJob.finishedOn ? new Date(currentJob.finishedOn).toISOString() : new Date().toISOString(),
        failedReason: currentJob.failedReason || error.message,
        stacktrace: currentJob.stacktrace || (error.stack ? error.stack.split('\n') : null),
        data: currentJob.data,
        opts: currentJob.opts,
        attemptsMade: currentJob.attemptsMade
      };
      logger.debug(`[Worker Listener - failed] Broadcast sent for job ${jobId || 'unknown'}.`);
    } else {
      logger.warn(`[Worker Listener - failed] Could not get job ${jobId || 'unknown'} from queue. Broadcasting minimal info.`);
       jobDataToSend = {
        type: 'job_updated',
        jobId: jobId || 'unknown',
        name: jobName,
        status: 'failed',
        failedReason: error.message,
        timestamp: new Date().toISOString() 
      };
    }
    broadcast(jobDataToSend);
    
    logger.debug(`[Worker Listener - failed] Broadcasting job counts after attempting to process job ${jobId || 'unknown'}.`);
    broadcastJobCounts(); 

  } catch(broadcastError) { 
    logger.error(`[Worker Listener - failed] Error during broadcast for job ${jobId || 'unknown'}:`, broadcastError);
    // ---> Убираем if (typeof jobId === 'string') вокруг broadcastJobCounts <--- 
    // Вызываем broadcastJobCounts в любом случае, т.к. он не зависит от jobId.
    logger.debug(`[Worker Listener - failed] Attempting to broadcast job counts despite broadcast error for job ${jobId || 'unknown'}.`);
    broadcastJobCounts(); 
  }
});

worker.on('error', (error: Error) => {
  // Ошибка самого воркера, не связанная с конкретной задачей
  logger.error('[Worker Error] Worker encountered an error:', error);
});

worker.on('stalled', (jobId: string) => {
  // Задача была активна слишком долго и помечена как stalled
  logger.warn(`[Queue Events] Job (ID: ${jobId}) has stalled.`);
});

// Слушатели для самой очереди (dataQueue) тоже могут быть полезны
dataQueue.on('waiting', (jobId: string) => {
  // Этот лог сработает, когда задача добавляется в очередь и ожидает обработки
  logger.debug(`[Queue Events] Job (ID: ${jobId}) is waiting in the queue.`);
});
// -----------------------------------------------------------

logger.info('Data Worker instance created and listeners attached.');

// Экспортируем сам воркер, если он нужен где-то еще (хотя обычно достаточно импорта файла)
export { worker as dataWorker };

// Экспортируем типы задач для использования в контроллере
export type { FetchCandlesJobData, FetchPairsJobData, FetchPortfolioDataAndRunBacktestJobData }; 