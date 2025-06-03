import { Job, Worker as BullWorker } from 'bullmq';
import logger from '@/utils/logger';
import config from '@/config';
import { createWorker, DATA_QUEUE_NAME, dataQueue, broadcastJobCounts } from '@/config/queue';
import * as okxService from '@/services/okxService';
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
  isUserPaused?: boolean;
}

interface FetchCandlesJobData {
  symbol: string;
  timeframe: string;
  startTime?: number;
  endTime?: number;
  limit?: number;
  isUserPaused?: boolean;
}

interface FetchCandlesAndRunBacktestJobData {
  symbol: string;
  timeframe: string;
  startTime: number;
  endTime: number;
  backtestParams: BacktestRunParameters;
  isUserPaused?: boolean;
}

interface FetchPortfolioDataAndRunBacktestJobData {
  portfolioParams: PortfolioBacktestRunParameters;
  pairsNeedingData: string[];
  startTimestamp: number;
  endTimestamp: number;
  isUserPaused?: boolean;
}

type DataJobData = FetchPairsJobData | FetchCandlesJobData | FetchCandlesAndRunBacktestJobData | FetchPortfolioDataAndRunBacktestJobData;

/**
 * Обработчик задачи получения и сохранения списка торговых пар.
 */
const processFetchPairs = async (job: Job<FetchPairsJobData>) => {
  logger.info(`Processing job ${JOB_TYPES.FETCH_PAIRS} (ID: ${job.id}) with data:`, job.data);
  try {
    logger.info(`Starting processFetchPairs for job ID: ${job.id}`);
    const pairs = await okxService.getFuturesPairs();
    logger.debug(`[Job ${job.id}] Fetched ${pairs.length} pairs from OKX.`);

    await dataService.saveOrUpdateTradingPairs(pairs);
    logger.debug(`[Job ${job.id}] Finished dataService.saveOrUpdateTradingPairs.`);

    logger.info(`Finished processFetchPairs for job ID: ${job.id} successfully.`);

  } catch (error: any) {
    logger.error(`Error processing job ${JOB_TYPES.FETCH_PAIRS} (ID: ${job.id}):`, error);
    throw error;
  }
};

/**
 * Обработчик задачи получения и сохранения исторических свечей.
 */
const processFetchCandles = async (job: Job<FetchCandlesJobData>) => {
  const { symbol, timeframe, startTime, endTime, limit } = job.data;
  // <-- Лог самого начала обработки
  logger.info(`[Worker] Received job ${JOB_TYPES.FETCH_CANDLES} (ID: ${job.id}) for ${symbol} (${timeframe}). Starting processing...`);

  logger.info(`Processing job ${JOB_TYPES.FETCH_CANDLES} (ID: ${job.id}) with data:`, job.data);
  try {
    logger.info(`Starting processFetchCandles for job ID: ${job.id}, symbol: ${symbol}, timeframe: ${timeframe}`);
    logger.debug(`[Job ${job.id}] Calling okxService.getHistoricalCandlesOptimized for ${symbol}...`);
    
    // Добавляем таймаут для предотвращения зависания при загрузке данных
    const fetchPromise = okxService.getHistoricalCandlesOptimized(symbol, timeframe, startTime, endTime, limit);
    const timeoutPromise = new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error(`OKX API timeout for ${symbol} after 5 minutes`)), 5 * 60 * 1000)
    );
    
    const candles = await Promise.race([fetchPromise, timeoutPromise]);
    logger.debug(`[Job ${job.id}] Fetched ${candles.length} candles for ${symbol} from OKX.`);

    if (candles.length > 0) {
      logger.debug(`[Job ${job.id}] Calling dataService.saveCandles for ${symbol}...`);
      await dataService.saveCandles(symbol, timeframe, candles);
      logger.debug(`[Job ${job.id}] Finished dataService.saveCandles for ${symbol}.`);
    } else {
      logger.info(`[Job ${job.id}] No candles fetched for ${symbol}, skipping database save.`);
    }

    logger.info(`Finished processFetchCandles for job ID: ${job.id} successfully.`);
    
    // Явно возвращаем результат для правильного завершения задачи
    return {
      success: true,
      symbol,
      timeframe,
      candlesProcessed: candles.length,
      message: `Successfully processed ${candles.length} candles for ${symbol} (${timeframe})`
    };

  } catch (error: any) {
    logger.error(`Error processing job ${JOB_TYPES.FETCH_CANDLES} (ID: ${job.id}) for ${symbol} (${timeframe}): ${error.message}`, {
      stack: error.stack,
      symbol,
      timeframe,
      startTime,
      endTime,
      limit
    });
    throw error;
  }
};

// Обработчик для новой задачи FETCH_CANDLES_AND_RUN_BACKTEST
const processFetchCandlesAndRunBacktest = async (job: Job<FetchCandlesAndRunBacktestJobData>) => {
  const { symbol, timeframe, startTime, endTime, backtestParams } = job.data;
  const jobId = job.id;
  logger.info(`[Worker] Received job ${JOB_TYPES.FETCH_CANDLES_AND_RUN_BACKTEST} (ID: ${jobId}) for ${symbol} (${timeframe}).`);
  logger.debug(`[Job ${jobId}] Backtest params:`, backtestParams);

  try {
    // 1. Загрузка свечей
    logger.info(`[Job ${jobId}] Calling okxService.getHistoricalCandlesOptimized for ${symbol} (${timeframe}) from ${new Date(startTime)} to ${new Date(endTime)}.`);
    const candlesFromAPI = await okxService.getHistoricalCandlesOptimized(symbol, timeframe, startTime, endTime);
    logger.info(`[Job ${jobId}] Fetched ${candlesFromAPI.length} candles from API for ${symbol}.`);

    // 2. Сохранение свечей
    if (candlesFromAPI.length > 0) {
      logger.info(`[Job ${jobId}] Calling dataService.saveCandles for ${symbol}.`);
      await dataService.saveCandles(symbol, timeframe, candlesFromAPI);
      logger.info(`[Job ${jobId}] Finished dataService.saveCandles for ${symbol}.`);
    } else {
      logger.warn(`[Job ${jobId}] No candles fetched from API for ${symbol}. Backtest might not have enough data.`);
      // Можно решить, прерывать ли здесь, если свечей 0. Пока продолжим.
    }

    // 3. Получение свечей из БД для бэктеста (чтобы убедиться в их наличии и формате)
    logger.info(`[Job ${jobId}] Fetching candles from DB for backtest: ${symbol} (${timeframe}) from ${new Date(startTime)} to ${new Date(endTime)}`);
    const candlesFromDB = await dataService.getCandles(symbol, timeframe, startTime, endTime);
    logger.info(`[Job ${jobId}] Fetched ${candlesFromDB.length} candles from DB for backtest.`);

    if (!candlesFromDB || candlesFromDB.length === 0) {
      logger.error(`[Job ${jobId}] No candles found in DB for ${symbol} (${timeframe}) in range after fetch. Cannot run backtest.`);
      throw new Error(`No candles in DB for ${symbol} after fetch attempt.`);
    }

    // 4. Адаптация данных для бэктеста
    const candlesToBacktest: CandleData[] = candlesFromDB.map((c: any) => ({
      timestamp: Number(c.timestamp),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      // volumeQuote можно будет добавить, если он есть в Candle модели и нужен для бэктеста
    }));
    logger.info(`[Job ${jobId}] Prepared ${candlesToBacktest.length} candles for backtest execution.`);

    // 5. Запуск бэктеста
    logger.info(`[Job ${jobId}] Starting backtest for ${symbol} with params:`, backtestParams);
    const backtestResult = await runBacktest(backtestParams, candlesToBacktest);
    logger.info(`[Job ${jobId}] Backtest finished for ${symbol}. Trades: ${backtestResult.metrics.totalTrades}.`);
    logger.debug(`[Job ${jobId}] Backtest result for ${symbol}:`, backtestResult);

    // Отправляем результат через WebSocket
    broadcast({
      type: 'BACKTEST_COMPLETED',
      payload: {
        jobId,
        symbol,
        timeframe,
        backtestParams, // Исходные параметры, с которыми запускался
        result: backtestResult
      }
    });
    logger.info(`[Job ${jobId}] Broadcasted BACKTEST_COMPLETED event.`);

    logger.info(`Finished job ${JOB_TYPES.FETCH_CANDLES_AND_RUN_BACKTEST} (ID: ${jobId}) successfully.`);

  } catch (error: any) {
    logger.error(`Error processing job ${JOB_TYPES.FETCH_CANDLES_AND_RUN_BACKTEST} (ID: ${jobId}) for ${symbol} (${timeframe}):`, error);
    // Отправляем уведомление об ошибке через WebSocket
    broadcast({
      type: 'BACKTEST_FAILED',
      payload: {
        jobId,
        symbol,
        timeframe,
        backtestParams,
        error: { 
          message: error.message,
          // Можно добавить и другие детали ошибки, если это безопасно и полезно для фронтенда
          // stack: error.stack // Не рекомендуется слать полный stacktrace на фронтенд
        }
      }
    });
    logger.info(`[Job ${jobId}] Broadcasted BACKTEST_FAILED event.`);
    throw error; // Перебрасываем ошибку, чтобы задача была помечена как failed
  }
};

// Обработчик для портфельного бектестинга FETCH_PORTFOLIO_DATA_AND_RUN_BACKTEST
const processFetchPortfolioDataAndRunBacktest = async (job: Job<FetchPortfolioDataAndRunBacktestJobData>) => {
  const { portfolioParams, pairsNeedingData, startTimestamp, endTimestamp } = job.data;
  const jobId = job.id;
  logger.info(`[Worker] Received job ${JOB_TYPES.FETCH_PORTFOLIO_DATA_AND_RUN_BACKTEST} (ID: ${jobId}) for portfolio backtest with ${pairsNeedingData.length} pairs needing data.`);
  logger.debug(`[Job ${jobId}] Portfolio params:`, portfolioParams);
  logger.debug(`[Job ${jobId}] Pairs needing data:`, pairsNeedingData);

  try {
    const candlesByPair: Record<string, CandleData[]> = {};

    // 1. Загрузка данных для пар, которым нужны данные
    for (const pairSymbol of pairsNeedingData) {
      logger.info(`[Job ${jobId}] Fetching data for pair: ${pairSymbol}`);
      
      // 1.1 Загружаем исторические свечи через API (если нужно)
      const candlesFromAPI = await okxService.getHistoricalCandles(
        pairSymbol, 
        portfolioParams.timeframe, 
        startTimestamp, 
        endTimestamp
      );
      logger.info(`[Job ${jobId}] Fetched ${candlesFromAPI.length} candles from API for ${pairSymbol}.`);

      // 1.2 Сохраняем свечи в базу данных
      if (candlesFromAPI.length > 0) {
        await dataService.saveCandles(pairSymbol, portfolioParams.timeframe, candlesFromAPI);
        logger.info(`[Job ${jobId}] Saved ${candlesFromAPI.length} candles to DB for ${pairSymbol}.`);
    }

      // 2. Получаем свечи из БД для портфельного бэктеста
      logger.info(`[Job ${jobId}] Fetching candles from DB for ${pairSymbol} (${portfolioParams.timeframe}) from ${new Date(startTimestamp)} to ${new Date(endTimestamp)}`);
      const candlesFromDB = await dataService.getCandles(
        pairSymbol, 
        portfolioParams.timeframe, 
        startTimestamp, 
        endTimestamp
      );
      
      if (candlesFromDB && candlesFromDB.length > 0) {
        // Адаптация данных для портфельного бектестера
        candlesByPair[pairSymbol] = candlesFromDB.map((c: any) => ({
          timestamp: Number(c.timestamp),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        }));
        logger.info(`[Job ${jobId}] Prepared ${candlesByPair[pairSymbol].length} candles for ${pairSymbol}.`);
      } else {
        logger.warn(`[Job ${jobId}] No candles found in DB for ${pairSymbol} after fetch attempt.`);
        // Устанавливаем пустой массив для пар без данных
        candlesByPair[pairSymbol] = [];
      }
    }

    // 3. Запуск портфельного бектеста
    const totalCandlesLoaded = Object.values(candlesByPair).reduce((sum, candles) => sum + candles.length, 0);
    logger.info(`[Job ${jobId}] Starting portfolio backtest with ${totalCandlesLoaded} total candles across ${Object.keys(candlesByPair).length} pairs.`);
    logger.debug(`[Job ${jobId}] Candles by pair summary:`, Object.fromEntries(
      Object.entries(candlesByPair).map(([pair, candles]) => [pair, candles.length])
    ));

    const portfolioBacktestResult = await runPortfolioBacktest(portfolioParams, candlesByPair);
    logger.info(`[Job ${jobId}] Portfolio backtest finished. Total trades: ${portfolioBacktestResult.overallMetrics.totalPortfolioTrades}, Total PnL: ${portfolioBacktestResult.overallMetrics.totalPortfolioPnl}.`);

    // 4. Отправляем результат через WebSocket
    broadcast({
      type: 'PORTFOLIO_BACKTEST_COMPLETED',
      payload: {
        jobId,
        portfolioParams,
        result: portfolioBacktestResult
      }
    });
    logger.info(`[Job ${jobId}] Broadcasted PORTFOLIO_BACKTEST_COMPLETED event.`);

    logger.info(`Finished job ${JOB_TYPES.FETCH_PORTFOLIO_DATA_AND_RUN_BACKTEST} (ID: ${jobId}) successfully.`);

  } catch (error: any) {
    logger.error(`Error processing job ${JOB_TYPES.FETCH_PORTFOLIO_DATA_AND_RUN_BACKTEST} (ID: ${jobId}):`, error);
    
    // Отправляем уведомление об ошибке через WebSocket
    broadcast({
      type: 'PORTFOLIO_BACKTEST_FAILED',
      payload: {
        jobId,
        portfolioParams,
        error: { 
          message: error.message,
        }
      }
    });
    logger.info(`[Job ${jobId}] Broadcasted PORTFOLIO_BACKTEST_FAILED event.`);
    throw error; // Перебрасываем ошибку, чтобы задача была помечена как failed
  }
};

// НОВАЯ оптимизированная функция для портфельной загрузки с параллельной обработкой
const processFetchPortfolioDataOptimized = async (job: Job<FetchPortfolioDataAndRunBacktestJobData>) => {
  const { portfolioParams, pairsNeedingData, startTimestamp, endTimestamp } = job.data;
  const jobId = job.id;
  logger.info(`[Worker-OPTIMIZED] Received job ${JOB_TYPES.FETCH_PORTFOLIO_DATA_AND_RUN_BACKTEST} (ID: ${jobId}) for ${pairsNeedingData.length} pairs using OPTIMIZED algorithm.`);
  
  // ДЕБАГ: Логируем временной диапазон
  logger.info(`[Job-OPT ${jobId}] DEBUG: Time range requested: ${new Date(startTimestamp)} - ${new Date(endTimestamp)} (${Math.round((endTimestamp - startTimestamp) / (24 * 60 * 60 * 1000))} days)`);
  logger.info(`[Job-OPT ${jobId}] DEBUG: Portfolio params: ${JSON.stringify({ timeframe: portfolioParams.timeframe, pairSymbols: portfolioParams.pairSymbols.length + ' pairs' })}`);
  logger.info(`[Job-OPT ${jobId}] DEBUG: Pairs needing data: ${pairsNeedingData.slice(0, 5).join(', ')}${pairsNeedingData.length > 5 ? '...' : ''}`);

  try {
    // 1. ПРИОРИТЕТ: Сначала загружаем данные из БД для всех пар
    const candlesFromDB: Record<string, CandleData[]> = {};
    let totalCandlesFromDB = 0;
    let pairsWithCompleteData: string[] = [];
    
    logger.info(`[Job-OPT ${jobId}] Loading existing data from DATABASE for ${portfolioParams.pairSymbols.length} pairs...`);
    
    // ВАЖНО: Ограничиваем количество пар для предотвращения перегрузки
    const MAX_PAIRS_LIMIT = 50; // Максимум 50 пар за раз
    const MAX_CANDLES_PER_PAIR = 20000; // Увеличено до 20К свечей на пару (для 2 лет 1h данных ~17500 свечей)
    const MAX_TOTAL_CANDLES = 500000; // Увеличено до 500К свечей всего
    
    if (portfolioParams.pairSymbols.length > MAX_PAIRS_LIMIT) {
      logger.warn(`[Job-OPT ${jobId}] Too many pairs requested (${portfolioParams.pairSymbols.length}). Limiting to first ${MAX_PAIRS_LIMIT} pairs.`);
      portfolioParams.pairSymbols = portfolioParams.pairSymbols.slice(0, MAX_PAIRS_LIMIT);
    }
    
    for (const symbol of portfolioParams.pairSymbols) {
      try {
        // Ограничиваем временной период для предотвращения загрузки слишком большого объема данных
        const timeRangeMs = endTimestamp - startTimestamp;
        const maxTimeRangeMs = 2 * 365 * 24 * 60 * 60 * 1000; // Увеличено до 2 лет
        
        let effectiveStartTime = startTimestamp;
        let effectiveEndTime = endTimestamp;
        
        if (timeRangeMs > maxTimeRangeMs) {
          effectiveStartTime = endTimestamp - maxTimeRangeMs;
          logger.warn(`[Job-OPT ${jobId}] Time range too large for ${symbol}. Limiting to last 2 years: ${new Date(effectiveStartTime)} - ${new Date(effectiveEndTime)}`);
        }
        
        logger.debug(`[Job-OPT ${jobId}] Loading ${symbol} from DB: ${new Date(effectiveStartTime)} - ${new Date(effectiveEndTime)}`);
        const candles = await dataService.getCandles(symbol, portfolioParams.timeframe, effectiveStartTime, effectiveEndTime);
        logger.debug(`[Job-OPT ${jobId}] DB returned ${candles.length} candles for ${symbol}`);
        
        // Ограничиваем количество свечей на пару
        let limitedCandles = candles;
        if (candles.length > MAX_CANDLES_PER_PAIR) {
          limitedCandles = candles.slice(-MAX_CANDLES_PER_PAIR); // Берем последние свечи
          logger.warn(`[Job-OPT ${jobId}] Too many candles for ${symbol} (${candles.length}). Limited to ${MAX_CANDLES_PER_PAIR} recent candles.`);
        }
        
        // ДЕБАГ: Логируем временной диапазон свечей
        if (limitedCandles.length > 0) {
          const firstCandle = new Date(limitedCandles[0].timestamp);
          const lastCandle = new Date(limitedCandles[limitedCandles.length - 1].timestamp);
          logger.debug(`[Job-OPT ${jobId}] ${symbol} DB data range: ${firstCandle} - ${lastCandle} (${limitedCandles.length} candles)`);
        }
        
        candlesFromDB[symbol] = limitedCandles;
        totalCandlesFromDB += limitedCandles.length;
        
        // Проверяем общий лимит свечей
        if (totalCandlesFromDB > MAX_TOTAL_CANDLES) {
          logger.warn(`[Job-OPT ${jobId}] Total candles limit (${MAX_TOTAL_CANDLES}) reached. Stopping data loading.`);
          break;
        }
        
        if (limitedCandles.length > 0) {
          pairsWithCompleteData.push(symbol);
          logger.debug(`[Job-OPT ${jobId}] Loaded ${limitedCandles.length} candles from DB for ${symbol}.`);
        } else {
          logger.warn(`[Job-OPT ${jobId}] No data in DB for ${symbol} - may need API fetch.`);
        }
      } catch (error: any) {
        logger.warn(`[Job-OPT ${jobId}] Failed to load ${symbol} from DB: ${error.message}`);
        candlesFromDB[symbol] = [];
      }
    }
    
    logger.info(`[Job-OPT ${jobId}] DATABASE load completed: ${pairsWithCompleteData.length}/${portfolioParams.pairSymbols.length} pairs have data, ${totalCandlesFromDB} total candles from DB.`);
    logger.info(`[Job-OPT ${jobId}] DB data ratio: ${(pairsWithCompleteData.length / portfolioParams.pairSymbols.length * 100).toFixed(1)}% (threshold: 50%)`);

    // 2. Если большинство пар имеют данные в БД, используем их. Иначе догружаем через API
    const dbDataRatio = pairsWithCompleteData.length / portfolioParams.pairSymbols.length;
    
    let finalCandlesData: Record<string, CandleData[]>;
    
    if (dbDataRatio >= 0.5) { // Снижено с 80% до 50% - если 50%+ пар имеют данные в БД
      logger.info(`[Job-OPT ${jobId}] Using DATABASE data (${(dbDataRatio * 100).toFixed(1)}% coverage). Skipping API fetch for performance.`);
      finalCandlesData = candlesFromDB;
    } else {
      // 3. Если данных в БД недостаточно, загружаем через API (как раньше)
      logger.info(`[Job-OPT ${jobId}] DB data insufficient (${(dbDataRatio * 100).toFixed(1)}% coverage). Fetching via API...`);
      
      const requests: CandleRequest[] = pairsNeedingData.map(symbol => ({
        symbol,
        timeframe: portfolioParams.timeframe,
        startTime: startTimestamp,
        endTime: endTimestamp
      }));

      const parallelResults = await okxService.getHistoricalCandlesParallel(requests, 3);
      const totalCandlesFromAPI = Object.values(parallelResults).reduce((sum, candles) => sum + candles.length, 0);
      
      logger.info(`[Job-OPT ${jobId}] API fetch completed: ${totalCandlesFromAPI} total candles loaded from API.`);

      // Сохранение новых данных в БД
      for (const [symbol, candles] of Object.entries(parallelResults)) {
        if (candles.length > 0) {
          await dataService.saveCandles(symbol, portfolioParams.timeframe, candles);
          logger.debug(`[Job-OPT ${jobId}] Saved ${candles.length} candles for ${symbol}.`);
        }
      }
      
      finalCandlesData = parallelResults;
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
            // Ограниченный набор сделок для предварительного просмотра
            tradesByPair: Object.fromEntries(
              Object.entries(portfolioBacktestResult.tradesByPair || {}).map(([pair, trades]) => [
                pair,
                Array.isArray(trades) ? trades.slice(0, 10) : []
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
            fetchMethod: dbDataRatio >= 0.5 ? 'database-primary' : 'api-fallback',
            dbDataRatio: Math.round(dbDataRatio * 100),
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
        // Ограничиваем сделки - только первые 20 на пару
        tradesByPair: Object.fromEntries(
          Object.entries(portfolioBacktestResult.tradesByPair || {}).map(([pair, trades]) => [
            pair,
            Array.isArray(trades) ? trades.slice(0, 20) : []
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
            fetchMethod: dbDataRatio >= 0.5 ? 'database-primary' : 'api-fallback',
            dbDataRatio: Math.round(dbDataRatio * 100),
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