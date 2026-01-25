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
import { savePortfolioBacktestResult } from '@/utils/portfolioResultsSaver';
import { diagnosticManager, ErrorType } from '@/diagnostics/TestDiagnosticManager';
import { connection as redis } from '@/config/queue';

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
    // Сохраняем время начала бэктеста
    const backtestStartTime = Date.now();
    
    // Отправляем начальный прогресс
    broadcast({
      type: 'BACKTEST_PROGRESS',
      payload: {
        jobId: jobId?.toString() || 'unknown',
        stage: 'initializing',
        stageDescription: 'Инициализация бэктеста...',
        processedItems: 0,
        totalItems: 100,
        startTime: backtestStartTime,
        stageBreakdown: [
          { name: 'Инициализация', status: 'active', progress: 10 },
          { name: 'Загрузка данных', status: 'pending', progress: 0 },
          { name: 'Расчет индикаторов', status: 'pending', progress: 0 },
          { name: 'Выполнение бэктеста', status: 'pending', progress: 0 },
          { name: 'Расчет метрик', status: 'pending', progress: 0 },
          { name: 'Сохранение результатов', status: 'pending', progress: 0 }
        ]
      }
    });

    // 1. Загрузка свечей
    logger.info(`[Job ${jobId}] Calling ${exchange}Service.getHistoricalCandlesOptimized for ${symbol} (${timeframe}) from ${new Date(startTime)} to ${new Date(endTime)}.`);
    
    // Отправляем прогресс загрузки данных
    broadcast({
      type: 'BACKTEST_PROGRESS',
      payload: {
        jobId: jobId?.toString() || 'unknown',
        stage: 'loading_data',
        stageDescription: `Загрузка данных для ${symbol}...`,
        processedItems: 20,
        totalItems: 100,
        stageBreakdown: [
          { name: 'Инициализация', status: 'completed', progress: 100 },
          { name: 'Загрузка данных', status: 'active', progress: 30 },
          { name: 'Расчет индикаторов', status: 'pending', progress: 0 },
          { name: 'Выполнение бэктеста', status: 'pending', progress: 0 },
          { name: 'Расчет метрик', status: 'pending', progress: 0 },
          { name: 'Сохранение результатов', status: 'pending', progress: 0 }
        ]
      }
    });
    
    // ОПТИМИЗАЦИЯ: Проверяем что уже есть в БД и загружаем только недостающие части
    const existingCandles = await dataService.getCandles(symbol, timeframe, startTime, endTime, exchange);
    
    let finalStart = startTime;
    let finalEnd = endTime;
    let shouldFetchPartial = false;
    
    if (existingCandles.length > 0) {
      const firstCandleTime = Number(existingCandles[0].timestamp);
      const lastCandleTime = Number(existingCandles[existingCandles.length - 1].timestamp);
      
      // Определяем временной допуск в зависимости от таймфрейма
      let timeframeTolerance = 0;
      switch (timeframe) {
        case '1m': timeframeTolerance = 5 * 60 * 1000; break;      
        case '5m': timeframeTolerance = 15 * 60 * 1000; break;     
        case '15m': timeframeTolerance = 30 * 60 * 1000; break;    
        case '1h': timeframeTolerance = 2 * 60 * 60 * 1000; break; 
        case '4h': timeframeTolerance = 8 * 60 * 60 * 1000; break; 
        case '1d': timeframeTolerance = 24 * 60 * 60 * 1000; break; 
        default: timeframeTolerance = 3 * 60 * 60 * 1000; break;   
      }
      
      const needsStartData = firstCandleTime > startTime + timeframeTolerance;
      const needsEndData = lastCandleTime < endTime - timeframeTolerance;
      
      if (needsStartData && needsEndData) {
        logger.info(`[Job ${jobId}] ${symbol}: Missing both START and END data, loading full range`);
        shouldFetchPartial = false;
      } else if (needsStartData) {
        finalEnd = firstCandleTime + timeframeTolerance;
        shouldFetchPartial = true;
        logger.info(`[Job ${jobId}] ${symbol}: Loading PARTIAL START data (${new Date(finalStart)} to ${new Date(finalEnd)})`);
      } else if (needsEndData) {
        finalStart = lastCandleTime - timeframeTolerance;
        shouldFetchPartial = true;
        logger.info(`[Job ${jobId}] ${symbol}: Loading PARTIAL END data (${new Date(finalStart)} to ${new Date(finalEnd)})`);
      } else {
        logger.info(`[Job ${jobId}] ${symbol}: Data seems sufficient, loading full range for safety`);
        shouldFetchPartial = false;
      }
    } else {
      logger.info(`[Job ${jobId}] ${symbol}: No existing data, loading full range`);
      shouldFetchPartial = false;
    }
    
    const exchangeService = getExchangeService(exchange);
    const candlesFromAPI = exchange === 'bybit' 
      ? await bybitService.getHistoricalCandlesOptimized(symbol, timeframe, finalStart, finalEnd)
      : await okxService.getHistoricalCandlesOptimized(symbol, timeframe, finalStart, finalEnd);
      
    logger.info(`[Job ${jobId}] Fetched ${candlesFromAPI.length} ${shouldFetchPartial ? 'NEW' : 'TOTAL'} candles from API for ${symbol} on ${exchange}.`);

    // 2. Сохранение свечей
    if (candlesFromAPI.length > 0) {
      logger.info(`[Job ${jobId}] Calling dataService.saveCandles for ${symbol} on ${exchange}.`);
      await dataService.saveCandles(symbol, timeframe, candlesFromAPI, exchange);
      logger.info(`[Job ${jobId}] Finished dataService.saveCandles for ${symbol} on ${exchange}.`);
    } else {
      logger.warn(`[Job ${jobId}] No candles fetched from API for ${symbol} on ${exchange}. Backtest might not have enough data.`);
    }

    // Прогресс после загрузки данных
    broadcast({
      type: 'BACKTEST_PROGRESS',
      payload: {
        jobId: jobId?.toString() || 'unknown',
        stage: 'loading_data',
        stageDescription: `Данные загружены: ${candlesFromAPI.length} свечей`,
        processedItems: 40,
        totalItems: 100,
        stageBreakdown: [
          { name: 'Инициализация', status: 'completed', progress: 100 },
          { name: 'Загрузка данных', status: 'active', progress: 80 },
          { name: 'Расчет индикаторов', status: 'pending', progress: 0 },
          { name: 'Выполнение бэктеста', status: 'pending', progress: 0 },
          { name: 'Расчет метрик', status: 'pending', progress: 0 },
          { name: 'Сохранение результатов', status: 'pending', progress: 0 }
        ]
      }
    });

    // 3. ОПТИМИЗАЦИЯ: Получаем полный набор данных из БД после сохранения недостающих частей
    logger.info(`[Job ${jobId}] Loading complete dataset from DB after saving new data...`);
    
    const completeCandles = await dataService.getCandles(symbol, timeframe, startTime, endTime, exchange);
    logger.info(`[Job ${jobId}] Complete dataset: ${completeCandles.length} total candles (includes ${candlesFromAPI.length} newly fetched).`);

    if (!completeCandles || completeCandles.length === 0) {
      logger.error(`[Job ${jobId}] No complete candles available for ${symbol} (${timeframe}) on ${exchange}. Cannot run backtest.`);
      throw new Error(`No complete candles available for ${symbol} on ${exchange}.`);
    }

    // 4. Адаптация данных для бэктеста (используем полные данные из БД)
    const candlesToBacktest: CandleData[] = completeCandles.map((c: any) => ({
      timestamp: Number(c.timestamp),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));
    logger.info(`[Job ${jobId}] Prepared ${candlesToBacktest.length} candles for backtest execution.`);

    // Прогресс перед началом бэктеста
    broadcast({
      type: 'BACKTEST_PROGRESS',
      payload: {
        jobId: jobId?.toString() || 'unknown',
        stage: 'processing_indicators',
        stageDescription: 'Подготовка индикаторов и данных...',
        processedItems: 50,
        totalItems: 100,
        stageBreakdown: [
          { name: 'Инициализация', status: 'completed', progress: 100 },
          { name: 'Загрузка данных', status: 'completed', progress: 100 },
          { name: 'Расчет индикаторов', status: 'active', progress: 50 },
          { name: 'Выполнение бэктеста', status: 'pending', progress: 0 },
          { name: 'Расчет метрик', status: 'pending', progress: 0 },
          { name: 'Сохранение результатов', status: 'pending', progress: 0 }
        ]
      }
    });

    // 5. Запуск бэктеста
    logger.info(`[Job ${jobId}] Starting backtest for ${symbol} on ${exchange} with params:`, backtestParams);
    
    // Прогресс начала бэктеста
    broadcast({
      type: 'BACKTEST_PROGRESS',
      payload: {
        jobId: jobId?.toString() || 'unknown',
        stage: 'running_backtest',
        stageDescription: `Выполнение бэктеста для ${symbol}...`,
        processedItems: 70,
        totalItems: 100,
        stageBreakdown: [
          { name: 'Инициализация', status: 'completed', progress: 100 },
          { name: 'Загрузка данных', status: 'completed', progress: 100 },
          { name: 'Расчет индикаторов', status: 'completed', progress: 100 },
          { name: 'Выполнение бэктеста', status: 'active', progress: 60 },
          { name: 'Расчет метрик', status: 'pending', progress: 0 },
          { name: 'Сохранение результатов', status: 'pending', progress: 0 }
        ]
      }
    });
    
    const backtestResult = await runBacktest(backtestParams, candlesToBacktest);
    logger.info(`[Job ${jobId}] Backtest finished for ${symbol} on ${exchange}. Trades: ${backtestResult.metrics.totalTrades}.`);

    // Прогресс расчета метрик
    broadcast({
      type: 'BACKTEST_PROGRESS',
      payload: {
        jobId: jobId?.toString() || 'unknown',
        stage: 'calculating_metrics',
        stageDescription: `Расчет метрик: ${backtestResult.metrics.totalTrades} сделок`,
        processedItems: 90,
        totalItems: 100,
        stageBreakdown: [
          { name: 'Инициализация', status: 'completed', progress: 100 },
          { name: 'Загрузка данных', status: 'completed', progress: 100 },
          { name: 'Расчет индикаторов', status: 'completed', progress: 100 },
          { name: 'Выполнение бэктеста', status: 'completed', progress: 100 },
          { name: 'Расчет метрик', status: 'active', progress: 80 },
          { name: 'Сохранение результатов', status: 'pending', progress: 0 }
        ]
      }
    });

    // Финальный прогресс
    broadcast({
      type: 'BACKTEST_PROGRESS',
      payload: {
        jobId: jobId?.toString() || 'unknown',
        stage: 'saving_results',
        stageDescription: 'Сохранение результатов...',
        processedItems: 95,
        totalItems: 100,
        stageBreakdown: [
          { name: 'Инициализация', status: 'completed', progress: 100 },
          { name: 'Загрузка данных', status: 'completed', progress: 100 },
          { name: 'Расчет индикаторов', status: 'completed', progress: 100 },
          { name: 'Выполнение бэктеста', status: 'completed', progress: 100 },
          { name: 'Расчет метрик', status: 'completed', progress: 100 },
          { name: 'Сохранение результатов', status: 'active', progress: 90 }
        ]
      }
    });

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

    // Завершающий прогресс
    broadcast({
      type: 'BACKTEST_PROGRESS',
      payload: {
        jobId: jobId?.toString() || 'unknown',
        stage: 'completed',
        stageDescription: 'Бэктест завершен успешно!',
        processedItems: 100,
        totalItems: 100,
        stageBreakdown: [
          { name: 'Инициализация', status: 'completed', progress: 100 },
          { name: 'Загрузка данных', status: 'completed', progress: 100 },
          { name: 'Расчет индикаторов', status: 'completed', progress: 100 },
          { name: 'Выполнение бэктеста', status: 'completed', progress: 100 },
          { name: 'Расчет метрик', status: 'completed', progress: 100 },
          { name: 'Сохранение результатов', status: 'completed', progress: 100 }
        ]
      }
    });

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
  logger.info(`[Job-OPT ${jobId}] Стандартизированный параметр биржи для работы с данными: ${targetExchange}`)
  
  logger.info(`[Worker-OPTIMIZED] Received job ${JOB_TYPES.FETCH_PORTFOLIO_DATA_AND_RUN_BACKTEST} (ID: ${jobId}) for ${pairsNeedingData.length} pairs using OPTIMIZED algorithm on ${targetExchange.toUpperCase()}.`);

  // НОВОЕ: Предварительный анализ портфеля через диагностическую систему
  try {
    const portfolioAnalysis = await diagnosticManager.analyzePortfolioData(
      portfolioParams.pairSymbols,
      portfolioParams.timeframe,
      new Date(startTimestamp),
      new Date(endTimestamp),
      targetExchange
    );

    logger.info(`[Job-OPT ${jobId}] Portfolio diagnostic analysis: ${portfolioAnalysis.availablePairs.length}/${portfolioAnalysis.totalPairs} pairs available, warning level: ${portfolioAnalysis.warningLevel}`);
    
    // Отправляем диагностику через WebSocket
    broadcast({
      type: 'portfolio_diagnostics',
      jobId: jobId?.toString(),
      analysis: portfolioAnalysis,
      timestamp: new Date().toISOString()
    });

    // ИСПРАВЛЕНО: Проверяем критические проблемы и флаг canProceed
    if (!portfolioAnalysis.canProceed) {
      // Критическая ошибка: превышение памяти, отсутствие данных или другие блокирующие проблемы
      const errorMsg = portfolioAnalysis.warningLevel === 'critical' && portfolioAnalysis.availablePairs.length === 0
        ? `Portfolio analysis failed: No data available for any pairs. ${portfolioAnalysis.recommendations[0]?.description || 'Critical data issues detected'}`
        : `Portfolio analysis failed: ${portfolioAnalysis.recommendations[0]?.description || 'Critical system issues detected (canProceed=false)'}`;
      
      logger.error(`[Job-OPT ${jobId}] CRITICAL ERROR: ${errorMsg}`);
      logger.error(`[Job-OPT ${jobId}] Analysis details: warningLevel=${portfolioAnalysis.warningLevel}, availablePairs=${portfolioAnalysis.availablePairs.length}/${portfolioAnalysis.totalPairs}, memoryEstimate=${portfolioAnalysis.memoryEstimate}MB`);
      
      // БОЛЬШЕ НЕ ПАДАЕМ: Просто логируем критическую ошибку и продолжаем,
      // так как основной цикл обработки теперь будет пропускать проблемные пары.
      logger.warn(`[Job-OPT ${jobId}] CONTINUING despite critical pre-check. The worker will attempt to process available pairs.`);
    }
    
    // Дополнительная проверка для случаев критических предупреждений
    if (portfolioAnalysis.warningLevel === 'critical') {
      logger.warn(`[Job-OPT ${jobId}] CRITICAL WARNING detected but canProceed=true. Proceeding with caution: ${portfolioAnalysis.recommendations[0]?.description || 'Check system resources'}`);
    }

  } catch (analysisError: any) {
    logger.error(`[Job-OPT ${jobId}] Portfolio diagnostic analysis failed:`, analysisError);
    
    // ИСПРАВЛЕНО: Если это критическая ошибка, выбрасываем исключение и завершаем задание
    if (analysisError.message.includes('Portfolio analysis failed') && !analysisError.message.includes('canProceed=false')) {
      // Регистрируем критическую ошибку
      await diagnosticManager.registerError({
        type: ErrorType.PORTFOLIO_INCOMPLETE,
        testId: jobId?.toString() || 'unknown',
        testType: 'portfolio',
        description: `CRITICAL: Portfolio diagnostic analysis failed: ${analysisError.message}`,
        context: {
          jobId,
          pairSymbols: portfolioParams.pairSymbols,
          timeframe: portfolioParams.timeframe,
          exchange: targetExchange,
          totalPairs: portfolioParams.pairSymbols.length,
          severity: 'critical'
        }
      });
      
      // Завершаем задание с ошибкой
      throw analysisError;
    }
    
    // Для некритических ошибок регистрируем ошибку но продолжаем выполнение
    await diagnosticManager.registerError({
      type: ErrorType.PORTFOLIO_INCOMPLETE,
      testId: jobId?.toString() || 'unknown',
      testType: 'portfolio',
      description: `Portfolio diagnostic analysis failed: ${analysisError.message}`,
      context: {
        jobId,
        pairSymbols: portfolioParams.pairSymbols,
        timeframe: portfolioParams.timeframe,
        exchange: targetExchange,
        totalPairs: portfolioParams.pairSymbols.length
      }
    });
  }
  
  // ИСПРАВЛЕНО: Получаем правильный сервис биржи
  const exchangeService = getExchangeService(targetExchange);
  logger.info(`[Job-OPT ${jobId}] Using ${targetExchange.toUpperCase()} exchange service for data fetching.`);
  
  // ДЕБАГ: Логируем временной диапазон
  logger.info(`[Job-OPT ${jobId}] DEBUG: Time range requested: ${new Date(startTimestamp)} - ${new Date(endTimestamp)} (${Math.round((endTimestamp - startTimestamp) / (24 * 60 * 60 * 1000))} days)`);
  logger.info(`[Job-OPT ${jobId}] DEBUG: Portfolio params: ${JSON.stringify({ timeframe: portfolioParams.timeframe, pairSymbols: portfolioParams.pairSymbols.length + ' pairs' })}`);
  logger.info(`[Job-OPT ${jobId}] DEBUG: Pairs needing data: ${pairsNeedingData.slice(0, 5).join(', ')}${pairsNeedingData.length > 5 ? '...' : ''}`);

  try {
    // Сохраняем время начала портфельного бэктеста
    const portfolioBacktestStartTime = Date.now();
    
    // === РЕАЛЬНЫЙ ТРЕКИНГ ПРОГРЕССА ===
    let processedPairsCount = 0;
    let totalCandlesLoaded = 0;
    let currentProcessingPair = '';
    const completedPairs: string[] = [];
    const failedPairs: { symbol: string; error: string }[] = [];
    
    // Функция для отправки обновления прогресса с реальными данными
    const sendProgressUpdate = (stage: string, stageDescription: string, stageProgress: number) => {
      const totalPairs = portfolioParams.pairSymbols.length;
      const pairsProgress = totalPairs > 0 ? Math.round((processedPairsCount / totalPairs) * 100) : 0;
      const elapsedMs = Date.now() - portfolioBacktestStartTime;
      const pairsPerMinute = elapsedMs > 0 ? (processedPairsCount / (elapsedMs / 60000)) : 0;
      
      // Рассчитываем оставшееся время
      const remainingPairs = totalPairs - processedPairsCount;
      const estimatedRemainingMs = pairsPerMinute > 0 ? (remainingPairs / pairsPerMinute) * 60000 : 0;
      
      broadcast({
        type: 'BACKTEST_PROGRESS',
        payload: {
          jobId: jobId?.toString() || 'unknown',
          stage,
          stageDescription,
          processedItems: stageProgress,
          totalItems: 100,
          startTime: portfolioBacktestStartTime,
          estimatedCompletion: estimatedRemainingMs,
          stageBreakdown: [
            { name: 'Инициализация', status: stage === 'initializing' ? 'active' : 'completed', progress: 100 },
            { name: 'Загрузка данных', status: stage === 'loading_data' ? 'active' : (stageProgress > 30 ? 'completed' : 'pending'), progress: stage === 'loading_data' ? Math.min(pairsProgress, 100) : (stageProgress > 30 ? 100 : 0) },
            { name: 'Расчет индикаторов', status: stage === 'processing_indicators' ? 'active' : (stageProgress > 60 ? 'completed' : 'pending'), progress: stageProgress > 60 ? 100 : 0 },
            { name: 'Выполнение бэктеста', status: stage === 'running_backtest' ? 'active' : (stageProgress > 80 ? 'completed' : 'pending'), progress: stageProgress > 80 ? 100 : 0 },
            { name: 'Расчет метрик', status: stage === 'calculating_metrics' ? 'active' : (stageProgress > 90 ? 'completed' : 'pending'), progress: stageProgress > 90 ? 100 : 0 },
            { name: 'Сохранение результатов', status: stage === 'saving_results' ? 'active' : (stageProgress >= 100 ? 'completed' : 'pending'), progress: stageProgress >= 100 ? 100 : 0 }
          ],
          portfolioStats: {
            totalPairs,
            processedPairs: processedPairsCount,
            totalTrades: 0,
            dataLoaded: `${pairsProgress}%`,
            currentPair: currentProcessingPair,
            pairsWithData: completedPairs.length,
            pairsNeedingData: remainingPairs,
            apiCallsMade: processedPairsCount,
            dbQueriesMade: processedPairsCount
          },
          loadingQueue: {
            totalPairs,
            completedPairs: processedPairsCount,
            activePairs: currentProcessingPair ? [{
              symbol: currentProcessingPair,
              status: 'loading' as const,
              progress: 50,
              exchange: targetExchange,
              timeframe: portfolioParams.timeframe
            }] : [],
            queuedPairs: portfolioParams.pairSymbols.slice(processedPairsCount + 1, processedPairsCount + 7),
            failedPairs: failedPairs.map(f => ({
              symbol: f.symbol,
              status: 'error' as const,
              progress: 0,
              errorMessage: f.error
            })),
            totalCandlesExpected: totalPairs * 5000,
            totalCandlesLoaded,
            totalDataSize: totalCandlesLoaded * 50, // ~50 bytes per candle
            estimatedTimePerPair: processedPairsCount > 0 ? elapsedMs / processedPairsCount : 5000,
            currentThroughput: pairsPerMinute,
            peakThroughput: pairsPerMinute,
            averagePairLoadTime: processedPairsCount > 0 ? elapsedMs / processedPairsCount / 1000 : 0
          }
        }
      });
    };
    
    // Отправляем начальный прогресс для портфельного бэктеста
    sendProgressUpdate('initializing', `Инициализация портфельного бэктеста для ${portfolioParams.pairSymbols.length} пар...`, 5);

    // ИСПРАВЛЕНИЕ: Используем контроллерную логику - загружаем из БД только пары, которые НЕ нуждаются в дозагрузке
    const pairsAlreadyInDB = portfolioParams.pairSymbols.filter(pair => !pairsNeedingData.includes(pair));
    const totalPairsToProcess = portfolioParams.pairSymbols.length;
    
    logger.info(`[Job-OPT ${jobId}] Controller analysis: ${pairsNeedingData.length} pairs need API fetch, ${pairsAlreadyInDB.length} pairs should be in DB`);
    logger.info(`[Job-OPT ${jobId}] Pairs needing API fetch: ${pairsNeedingData.join(', ')}`);
    logger.info(`[Job-OPT ${jobId}] Pairs expected in DB: ${pairsAlreadyInDB.join(', ')}`);
    
    // Прогресс анализа данных
    broadcast({
      type: 'BACKTEST_PROGRESS',
      payload: {
        jobId: jobId?.toString() || 'unknown',
        stage: 'loading_data',
        stageDescription: `Анализ данных: ${pairsNeedingData.length} пар требуют загрузки, ${pairsAlreadyInDB.length} пар в БД`,
        processedItems: 15,
        totalItems: 100,
        stageBreakdown: [
          { name: 'Инициализация', status: 'completed', progress: 100 },
          { name: 'Загрузка данных', status: 'active', progress: 20 },
          { name: 'Расчет индикаторов', status: 'pending', progress: 0 },
          { name: 'Выполнение бэктеста', status: 'pending', progress: 0 },
          { name: 'Расчет метрик', status: 'pending', progress: 0 },
          { name: 'Сохранение результатов', status: 'pending', progress: 0 }
        ],
        portfolioStats: {
          totalPairs: portfolioParams.pairSymbols.length,
          processedPairs: 0,
          totalTrades: 0,
          dataLoaded: '15%'
        }
      }
    });
    
    // 1. Загружаем данные из БД для пар, которые НЕ требуют API дозагрузки
    const candlesFromDB: Record<string, CandleData[]> = {};
    let totalCandlesFromDB = 0;
    
    logger.info(`[Job-OPT ${jobId}] Loading existing data from DATABASE for ${pairsAlreadyInDB.length} pairs...`);
    
    // МАСШТАБИРУЕМАЯ ОБРАБОТКА: Поддержка больших портфолио через батчинг
    const ENABLE_LARGE_PORTFOLIO_MODE = process.env.ENABLE_LARGE_PORTFOLIO_MODE === 'true' || totalPairsToProcess > 100;
    
    // ВЫСОКОПРОИЗВОДИТЕЛЬНАЯ КОНФИГУРАЦИЯ: 3 CPU cores + 6GB RAM
    const MAX_PAIRS_LIMIT = ENABLE_LARGE_PORTFOLIO_MODE ? 1000 : 100; // До 1000 пар в специальном режиме
    const MAX_CANDLES_PER_PAIR = ENABLE_LARGE_PORTFOLIO_MODE ? 40000 : 50000; // Увеличено благодаря большему RAM
    const MAX_TOTAL_CANDLES = ENABLE_LARGE_PORTFOLIO_MODE ? 35000000 : 1000000; // До 35М свечей с 6GB RAM
    const BATCH_SIZE = ENABLE_LARGE_PORTFOLIO_MODE ? 50 : 100; // Размер батча для больших портфолио
    
    logger.info(`[Job-OPT ${jobId}] Portfolio mode: ${ENABLE_LARGE_PORTFOLIO_MODE ? 'LARGE' : 'STANDARD'} (${totalPairsToProcess} pairs)`);
    logger.info(`[Job-OPT ${jobId}] Limits: MAX_PAIRS=${MAX_PAIRS_LIMIT}, MAX_CANDLES_PER_PAIR=${MAX_CANDLES_PER_PAIR}, MAX_TOTAL_CANDLES=${MAX_TOTAL_CANDLES}, BATCH_SIZE=${BATCH_SIZE}`);
    
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
        
        // Добавляем детальное логирование временного диапазона
        if (candles.length > 0) {
          const firstTs = Number(candles[0].timestamp);
          const lastTs = Number(candles[candles.length - 1].timestamp);
          logger.info(`[Job-OPT ${jobId}] Данные из БД для ${symbol}: диапазон ${new Date(firstTs)} - ${new Date(lastTs)}. Запрашиваемый диапазон: ${new Date(effectiveStartTime)} - ${new Date(effectiveEndTime)}.`);
        }
        
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
      
      // БАТЧИНГ: Обрабатываем пары батчами для больших портфолио
      const batchSize = ENABLE_LARGE_PORTFOLIO_MODE ? BATCH_SIZE : pairsNeedingData.length;
      const totalBatches = Math.ceil(pairsNeedingData.length / batchSize);
      
      logger.info(`[Job-OPT ${jobId}] Processing ${pairsNeedingData.length} pairs in ${totalBatches} batches of ${batchSize} each`);
      
      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        // <<<< НОВАЯ ПРОВЕРКА ОТМЕНЫ >>>>
        try {
          await checkJobCancellation(job);
        } catch (cancellationError) {
          logger.warn(`[Job-OPT ${jobId}] Cancellation detected during batch processing. Aborting.`);
          throw cancellationError; // Перебрасываем ошибку, чтобы остановить весь воркер
        }
        // <<<< КОНЕЦ ПРОВЕРКИ >>>>
        
        const startIdx = batchIndex * batchSize;
        const endIdx = Math.min(startIdx + batchSize, pairsNeedingData.length);
        const batch = pairsNeedingData.slice(startIdx, endIdx);
        
        logger.info(`[Job-OPT ${jobId}] Processing batch ${batchIndex + 1}/${totalBatches}: ${batch.length} pairs (${batch.join(', ')})`);
        
        // Прогресс батча с реальными данными
        const batchProgress = 15 + Math.round((processedPairsCount / portfolioParams.pairSymbols.length) * 50);
        sendProgressUpdate('loading_data', `Batch ${batchIndex + 1}/${totalBatches}: загрузка ${batch.length} пар...`, batchProgress);

      for (const symbol of batch) {
        // Обновляем текущую обрабатываемую пару
        currentProcessingPair = symbol;
        // <<<< НОВАЯ, БОЛЕЕ ЧАСТАЯ ПРОВЕРКА ОТМЕНЫ >>>>
        try {
          await checkJobCancellation(job);
        } catch (cancellationError) {
          logger.warn(`[Job-OPT ${jobId}] Cancellation detected while processing symbol ${symbol}. Aborting.`);
          throw cancellationError; // Перебрасываем ошибку, чтобы остановить весь воркер
        }
        // <<<< КОНЕЦ ПРОВЕРКИ >>>>

        try {
          // Получаем существующие данные из БД для определения недостающих диапазонов
          const existingCandles = await dataService.getCandles(symbol, portfolioParams.timeframe, startTimestamp, endTimestamp, targetExchange);
          
          let missingStart = startTimestamp;
          let missingEnd = endTimestamp;
          let shouldFetchPartial = false;
          
          if (existingCandles.length > 0) {
            const firstCandleTime = Number(existingCandles[0].timestamp);
            const lastCandleTime = Number(existingCandles[existingCandles.length - 1].timestamp);
            
            // Определяем временной допуск в зависимости от таймфрейма
            let timeframeTolerance = 0;
            switch (portfolioParams.timeframe) {
              case '1m': timeframeTolerance = 5 * 60 * 1000; break;      // 5 минут для 1m
              case '5m': timeframeTolerance = 15 * 60 * 1000; break;     // 15 минут для 5m
              case '15m': timeframeTolerance = 30 * 60 * 1000; break;    // 30 минут для 15m
              case '1h': timeframeTolerance = 2 * 60 * 60 * 1000; break; // 2 часа для 1h
              case '4h': timeframeTolerance = 8 * 60 * 60 * 1000; break; // 8 часов для 4h
              case '1d': timeframeTolerance = 24 * 60 * 60 * 1000; break; // 1 день для 1d
              default: timeframeTolerance = 3 * 60 * 60 * 1000; break;   // 3 часа по умолчанию
            }
            
            // Проверяем какие части данных недостают
            const needsStartData = firstCandleTime > startTimestamp + timeframeTolerance;
            const needsEndData = lastCandleTime < endTimestamp - timeframeTolerance;
            
            if (needsStartData && needsEndData) {
              // Недостает и начальные и конечные данные - загружаем весь диапазон
              logger.info(`[OptimizedFetcher] ${symbol}: Missing both START and END data, loading MAXIMUM AVAILABLE range`);
              shouldFetchPartial = false;
              
              // В больших портфолио пытаемся загружать максимально доступный диапазон
              if (ENABLE_LARGE_PORTFOLIO_MODE) {
                // Используем расширенный диапазон для поиска максимально доступных данных
                missingStart = Math.max(startTimestamp - (365 * 24 * 60 * 60 * 1000), 946684800000); // Не раньше 2000 года
                missingEnd = Math.min(endTimestamp + (30 * 24 * 60 * 60 * 1000), Date.now()); // Не позже текущего момента + 30 дней
                logger.info(`[OptimizedFetcher] ${symbol}: LARGE PORTFOLIO MODE - Extended search range: ${new Date(missingStart).toISOString()} to ${new Date(missingEnd).toISOString()}`);
              }
            } else if (needsStartData) {
              // Недостает только начальных данных
              missingEnd = firstCandleTime + timeframeTolerance; // Небольшое перекрытие
              shouldFetchPartial = true;
              
              // В больших портфолио расширяем поиск назад для получения максимума данных
              if (ENABLE_LARGE_PORTFOLIO_MODE) {
                missingStart = Math.max(startTimestamp - (180 * 24 * 60 * 60 * 1000), 946684800000); // Ищем до 6 месяцев назад
                logger.info(`[OptimizedFetcher] ${symbol}: LARGE PORTFOLIO - Extended START search: ${new Date(missingStart).toISOString()} to ${new Date(missingEnd).toISOString()}`);
              } else {
                logger.info(`[OptimizedFetcher] ${symbol}: Missing START data only - loading ${new Date(missingStart).toISOString()} to ${new Date(missingEnd).toISOString()} (${Math.round((missingEnd - missingStart) / (24 * 60 * 60 * 1000))} days)`);
              }
            } else if (needsEndData) {
              // Недостает только конечных данных
              missingStart = lastCandleTime - timeframeTolerance; // Небольшое перекрытие
              shouldFetchPartial = true;
              
              // В больших портфолио расширяем поиск вперед
              if (ENABLE_LARGE_PORTFOLIO_MODE) {
                missingEnd = Math.min(endTimestamp + (30 * 24 * 60 * 60 * 1000), Date.now()); // До текущего момента + 30 дней
                logger.info(`[OptimizedFetcher] ${symbol}: LARGE PORTFOLIO - Extended END search: ${new Date(missingStart).toISOString()} to ${new Date(missingEnd).toISOString()}`);
              } else {
                logger.info(`[OptimizedFetcher] ${symbol}: Missing END data only - loading ${new Date(missingStart).toISOString()} to ${new Date(missingEnd).toISOString()} (${Math.round((missingEnd - missingStart) / (24 * 60 * 60 * 1000))} days)`);
              }
            } else {
              // Данных достаточно - контроллер ошибся, но загружаем для безопасности
              logger.warn(`[OptimizedFetcher] ${symbol}: Controller marked as needing data but ranges seem sufficient. Loading full range for safety.`);
              shouldFetchPartial = false;
            }
          } else {
            // Данных нет совсем - загружаем весь диапазон
            logger.info(`[OptimizedFetcher] ${symbol}: No existing data, loading full range (${Math.round((endTimestamp - startTimestamp) / (24 * 60 * 60 * 1000))} days)`);
            shouldFetchPartial = false;
          }
          
          const finalStart = shouldFetchPartial ? missingStart : startTimestamp;
          const finalEnd = shouldFetchPartial ? missingEnd : endTimestamp;
          
          logger.info(`[OptimizedFetcher] Fetching ${shouldFetchPartial ? 'PARTIAL' : 'FULL'} data for ${symbol}: ${new Date(finalStart).toISOString()} to ${new Date(finalEnd).toISOString()}`);
          
          // Увеличенный таймаут для больших портфолио
          const timeoutMs = ENABLE_LARGE_PORTFOLIO_MODE ? 300000 : 120000; // 5 минут для больших портфолио
          
          const fetchPromise = exchangeService.getHistoricalCandles(
            symbol,
            portfolioParams.timeframe,
            finalStart,
            finalEnd
          );
          
          const timeoutPromise = new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error(`API timeout for ${symbol} after ${timeoutMs/1000}s`)), timeoutMs)
          );
          
          const newCandles = await Promise.race([fetchPromise, timeoutPromise]);
          
          logger.info(`[OptimizedFetcher] Fetched ${newCandles.length} NEW candles for ${symbol}`);
          
          // Сохраняем ТОЛЬКО новые данные в БД
          if (newCandles.length > 0) {
            await dataService.saveCandles(symbol, portfolioParams.timeframe, newCandles, targetExchange);
            logger.debug(`[Job-OPT ${jobId}] Saved ${newCandles.length} NEW candles for ${symbol} on ${targetExchange}.`);
          }
          
          // Получаем ПОЛНЫЙ набор данных из БД после загрузки недостающих частей
          const completeCandles = await dataService.getCandles(symbol, portfolioParams.timeframe, startTimestamp, endTimestamp, targetExchange);
          logger.info(`[OptimizedFetcher] Complete dataset for ${symbol}: ${completeCandles.length} total candles (${existingCandles.length} existing + ${newCandles.length} new)`);
          
          // НОВАЯ ПРОВЕРКА: Пропускаем пару, если после всех попыток данных все равно нет
          if (completeCandles.length === 0) {
            logger.warn(`[OptimizedFetcher] SKIPPING pair ${symbol} due to inability to fetch any candle data.`);
            continue; // Переходим к следующей паре в батче
          }

          missingPairsData[symbol] = completeCandles;
          
          // Обновляем счётчики прогресса
          processedPairsCount++;
          totalCandlesLoaded += completeCandles.length;
          completedPairs.push(symbol);
          
          // Отправляем обновление прогресса после каждой пары
          const pairProgress = 15 + Math.round((processedPairsCount / portfolioParams.pairSymbols.length) * 50);
          sendProgressUpdate('loading_data', `Загружено ${processedPairsCount}/${portfolioParams.pairSymbols.length} пар (${symbol})`, pairProgress);
          
        } catch (error: any) {
          logger.error(`[OptimizedFetcher] Failed to fetch ${symbol}: ${error.message}`);
          // В случае ошибки пытаемся использовать существующие данные из БД
          try {
            const fallbackCandles = await dataService.getCandles(symbol, portfolioParams.timeframe, startTimestamp, endTimestamp, targetExchange);
            missingPairsData[symbol] = fallbackCandles;
            logger.warn(`[OptimizedFetcher] Using ${fallbackCandles.length} existing candles for ${symbol} as fallback`);
          } catch (fallbackError) {
            logger.error(`[OptimizedFetcher] Fallback also failed for ${symbol}: ${fallbackError}`);
            missingPairsData[symbol] = [];
          }
        }
      }
      
      // Очистка памяти и мониторинг ресурсов между батчами в больших портфолио
      if (ENABLE_LARGE_PORTFOLIO_MODE && batchIndex < totalBatches - 1) {
        logger.info(`[Job-OPT ${jobId}] Batch ${batchIndex + 1}/${totalBatches} completed. Memory management...`);
        
        // Мониторинг использования памяти
        const memUsage = process.memoryUsage();
        const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
        const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
        const rssMB = Math.round(memUsage.rss / 1024 / 1024);
        
        logger.info(`[Job-OPT ${jobId}] Memory usage: Heap ${heapUsedMB}/${heapTotalMB}MB, RSS ${rssMB}MB`);
        
        // КРИТИЧЕСКИЕ ЛИМИТЫ: 10GB RAM доступно, 8GB heap
        if (heapUsedMB > 7000 || rssMB > 8500) { // 7GB heap или 8.5GB RSS - КРИТИЧНО!
          logger.error(`[Job-OPT ${jobId}] CRITICAL memory usage detected (${heapUsedMB}MB heap / ${rssMB}MB RSS). EMERGENCY garbage collection!`);
          if (global.gc) {
            global.gc();
            global.gc(); 
            global.gc(); // Тройная очистка при критической нагрузке!
          }
          // Увеличенная пауза для стабилизации
          await new Promise(resolve => setTimeout(resolve, 5000));
          
          // Проверяем эффективность очистки
          const memAfter = process.memoryUsage();
          const heapAfterMB = Math.round(memAfter.heapUsed / 1024 / 1024);
          logger.warn(`[Job-OPT ${jobId}] Memory after emergency GC: ${heapAfterMB}MB (freed: ${heapUsedMB - heapAfterMB}MB)`);
          
          if (heapAfterMB > 6000) { // Все еще критично после GC
            throw new Error(`CRITICAL MEMORY LEAK: Unable to free memory (${heapAfterMB}MB still used). Aborting to prevent crash.`);
          }
          
        } else if (heapUsedMB > 5000 || rssMB > 7000) { // 5GB heap или 7GB RSS - высокое потребление
          logger.warn(`[Job-OPT ${jobId}] High memory usage detected (${heapUsedMB}MB/${rssMB}MB). Aggressive garbage collection...`);
          if (global.gc) {
            global.gc();
            global.gc(); // Двойная очистка при высокой нагрузке
          }
          await new Promise(resolve => setTimeout(resolve, 3000));
        } else if (heapUsedMB > 3000 || rssMB > 5000) { // 3GB heap или 5GB RSS - среднее потребление
          logger.info(`[Job-OPT ${jobId}] Moderate memory usage (${heapUsedMB}MB/${rssMB}MB). Standard garbage collection...`);
          if (global.gc) {
            global.gc();
          }
          await new Promise(resolve => setTimeout(resolve, 2000));
        } else {
          // Обычная сборка мусора при низкой нагрузке
          if (global.gc) {
            global.gc();
          }
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        // Проверка после очистки
        const memUsageAfter = process.memoryUsage();
        const heapUsedAfterMB = Math.round(memUsageAfter.heapUsed / 1024 / 1024);
        logger.info(`[Job-OPT ${jobId}] Memory after cleanup: ${heapUsedAfterMB}MB (freed ${heapUsedMB - heapUsedAfterMB}MB)`);
        
        // Адаптивная скорость обработки на основе производительности системы
        const processedPairs = Object.keys(missingPairsData).length;
        const avgTimePerPair = (Date.now() - portfolioBacktestStartTime) / Math.max(processedPairs, 1);
        
        if (avgTimePerPair > 30000) { // Более 30 секунд на пару
          logger.warn(`[Job-OPT ${jobId}] Slow processing detected (${Math.round(avgTimePerPair/1000)}s per pair). Adding extra delay...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      }
      
      const totalCompleteCandles = Object.values(missingPairsData).reduce((sum, candles) => sum + candles.length, 0);
      logger.info(`[Job-OPT ${jobId}] PARTIAL fetch completed: ${totalCompleteCandles} complete datasets prepared for ${pairsNeedingData.length} pairs (combining existing DB data + new API data).`);

      // Комбинируем данные из БД и API
      finalCandlesData = { ...candlesFromDB, ...missingPairsData };
      
      logger.info(`[Job-OPT ${jobId}] Combined data: ${Object.keys(candlesFromDB).length} pairs from DB + ${Object.keys(missingPairsData).length} pairs from API = ${Object.keys(finalCandlesData).length} total pairs`);
    }

    // 4. Запуск портфельного бэктеста с финальными данными
    const totalFinalCandles = Object.values(finalCandlesData).reduce((sum, candles) => sum + candles.length, 0);
    const successfulFinalPairs = Object.values(finalCandlesData).filter(candles => candles.length > 0).length;
    
    // Прогресс перед началом бэктеста
    broadcast({
      type: 'BACKTEST_PROGRESS',
      payload: {
        jobId: jobId?.toString() || 'unknown',
        stage: 'running_backtest',
        stageDescription: `Запуск портфельного бэктеста для ${successfulFinalPairs} пар...`,
        processedItems: 70,
        totalItems: 100,
        stageBreakdown: [
          { name: 'Инициализация', status: 'completed', progress: 100 },
          { name: 'Загрузка данных', status: 'completed', progress: 100 },
          { name: 'Расчет индикаторов', status: 'completed', progress: 100 },
          { name: 'Выполнение бэктеста', status: 'active', progress: 60 },
          { name: 'Расчет метрик', status: 'pending', progress: 0 },
          { name: 'Сохранение результатов', status: 'pending', progress: 0 }
        ],
        portfolioStats: {
          totalPairs: portfolioParams.pairSymbols.length,
          processedPairs: successfulFinalPairs,
          totalTrades: 0,
          dataLoaded: '100%'
        }
      }
    });
    
    logger.info(`[Job-OPT ${jobId}] Starting OPTIMIZED portfolio backtest with ${totalFinalCandles} total candles across ${successfulFinalPairs} pairs.`);
    
    const portfolioBacktestResult = await runPortfolioBacktest(portfolioParams, finalCandlesData);
    logger.info(`[Job-OPT ${jobId}] OPTIMIZED portfolio backtest finished. Total trades: ${portfolioBacktestResult.overallMetrics.totalPortfolioTrades}, Total PnL: ${portfolioBacktestResult.overallMetrics.totalPortfolioPnl}.`);

    // Прогресс после завершения бэктеста
    broadcast({
      type: 'BACKTEST_PROGRESS',
      payload: {
        jobId: jobId?.toString() || 'unknown',
        stage: 'calculating_metrics',
        stageDescription: `Расчет метрик: ${portfolioBacktestResult.overallMetrics.totalPortfolioTrades} сделок`,
        processedItems: 90,
        totalItems: 100,
        stageBreakdown: [
          { name: 'Инициализация', status: 'completed', progress: 100 },
          { name: 'Загрузка данных', status: 'completed', progress: 100 },
          { name: 'Расчет индикаторов', status: 'completed', progress: 100 },
          { name: 'Выполнение бэктеста', status: 'completed', progress: 100 },
          { name: 'Расчет метрик', status: 'active', progress: 80 },
          { name: 'Сохранение результатов', status: 'pending', progress: 0 }
        ],
        portfolioStats: {
          totalPairs: portfolioParams.pairSymbols.length,
          processedPairs: successfulFinalPairs,
          totalTrades: portfolioBacktestResult.overallMetrics.totalPortfolioTrades,
          dataLoaded: '100%'
        }
      }
    });

    // Проверяем размер результатов перед отправкой
    const saveOptions = {
      jobId,
      portfolioParams,
      serializedResult: JSON.stringify(portfolioBacktestResult),
      timestamp: Date.now()
    };

    let fileInfo;
    try {
      fileInfo = await savePortfolioBacktestResult(portfolioBacktestResult, saveOptions);
    } catch (writeError: any) {
      logger.error(`[Job-OPT ${jobId}] Failed to write portfolio results file: ${writeError.message}`, writeError);

      logger.warn(`[Job-OPT ${jobId}] Attempting WebSocket fallback for failed file save`);

      try {
        broadcast({
          type: 'PORTFOLIO_BACKTEST_COMPLETED',
          payload: {
            jobId,
            portfolioParams,
            result: portfolioBacktestResult,
            metadata: {
              totalPairs: portfolioParams.pairSymbols.length,
              processedPairs: successfulFinalPairs,
              totalTrades: portfolioBacktestResult.overallMetrics.totalPortfolioTrades,
              resultSize: `${(saveOptions.serializedResult.length / (1024 * 1024)).toFixed(2)}MB`,
              fileSaveError: true,
              fallbackMethod: 'websocket'
            }
          }
        });

        logger.warn(`[Job-OPT ${jobId}] WebSocket fallback successful`);

        return;
      } catch (fallbackError: any) {
        logger.error(`[Job-OPT ${jobId}] WebSocket fallback also failed: ${fallbackError.message}`);
        throw new Error(`Failed to save portfolio results to file AND WebSocket fallback failed: ${writeError.message} | ${fallbackError.message}`);
      }
    }

    logger.info(`[Job-OPT ${jobId}] Portfolio backtest results saved to file: ${fileInfo.filename}`);

    broadcast({
      type: 'BACKTEST_PROGRESS',
      payload: {
        jobId: jobId?.toString() || 'unknown',
        stage: 'saving_results',
        stageDescription: `Результаты сохранены в файл: ${fileInfo.filename}`,
        processedItems: 95,
        totalItems: 100,
        stageBreakdown: [
          { name: 'Инициализация', status: 'completed', progress: 100 },
          { name: 'Загрузка данных', status: 'completed', progress: 100 },
          { name: 'Расчет индикаторов', status: 'completed', progress: 100 },
          { name: 'Выполнение бэктеста', status: 'completed', progress: 100 },
          { name: 'Расчет метрик', status: 'completed', progress: 100 },
          { name: 'Сохранение результатов', status: 'active', progress: 90 }
        ],
        portfolioStats: {
          totalPairs: portfolioParams.pairSymbols.length,
          processedPairs: successfulFinalPairs,
          totalTrades: portfolioBacktestResult.overallMetrics.totalPortfolioTrades,
          dataLoaded: '100%'
        }
      }
    });

    const downloadUrl = fileInfo.downloadUrl;
    const resultSizeMB = fileInfo.sizeMB;

    if (resultSizeMB > 10) {
      logger.info(`[Job-OPT ${jobId}] Portfolio backtest results are large (${resultSizeMB.toFixed(2)}MB). Sending preview via WebSocket.`);

      broadcast({
        type: 'PORTFOLIO_BACKTEST_COMPLETED',
        payload: {
          jobId,
          portfolioParams,
          result: {
            overallMetrics: portfolioBacktestResult.overallMetrics,
            metricsByPair: portfolioBacktestResult.metricsByPair,
            tradesByPair: Object.fromEntries(
              Object.entries(portfolioBacktestResult.tradesByPair || {}).map(([pair, trades]) => [
                pair,
                Array.isArray(trades) ? trades.slice(0, 1000) : []
              ])
            ),
            _largeDataSavedToFile: true,
            _downloadUrl: downloadUrl,
            _fullDataSize: `${resultSizeMB.toFixed(2)}MB`,
            _previewNote: 'This is a preview. Download the full results using the link above.'
          },
          optimized: true,
          fileInfo,
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
      logger.info(`[Job-OPT ${jobId}] Sending portfolio results via WebSocket with data reduction...`);

      const reducedResult = {
        overallMetrics: portfolioBacktestResult.overallMetrics,
        metricsByPair: portfolioBacktestResult.metricsByPair,
        tradesByPair: Object.fromEntries(
          Object.entries(portfolioBacktestResult.tradesByPair || {}).map(([pair, trades]) => [
            pair,
            Array.isArray(trades) ? trades.slice(0, 500) : []
          ])
        ),
        _dataReduced: true,
        _originalTradesCount: portfolioBacktestResult.overallMetrics.totalPortfolioTrades,
        _downloadUrl: downloadUrl,
        _fileSize: `${resultSizeMB.toFixed(2)}MB`,
        _note: 'Data reduced for WebSocket transmission'
      };

      broadcast({
        type: 'PORTFOLIO_BACKTEST_COMPLETED',
        payload: {
          jobId,
          portfolioParams,
          result: reducedResult,
          optimized: true,
          fileInfo,
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

    // Завершающий прогресс
    broadcast({
      type: 'BACKTEST_PROGRESS',
      payload: {
        jobId: jobId?.toString() || 'unknown',
        stage: 'completed',
        stageDescription: 'Портфельный бэктест завершен успешно!',
        processedItems: 100,
        totalItems: 100,
        stageBreakdown: [
          { name: 'Инициализация', status: 'completed', progress: 100 },
          { name: 'Загрузка данных', status: 'completed', progress: 100 },
          { name: 'Расчет индикаторов', status: 'completed', progress: 100 },
          { name: 'Выполнение бэктеста', status: 'completed', progress: 100 },
          { name: 'Расчет метрик', status: 'completed', progress: 100 },
          { name: 'Сохранение результатов', status: 'completed', progress: 100 }
        ],
        portfolioStats: {
          totalPairs: portfolioParams.pairSymbols.length,
          processedPairs: successfulFinalPairs,
          totalTrades: portfolioBacktestResult.overallMetrics.totalPortfolioTrades,
          dataLoaded: '100%'
        }
      }
    });

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

// Helper function для проверки отмены задачи через Redis
const checkJobCancellation = async (job: Job<DataJobData>): Promise<void> => {
  const killKey = `job:${job.id}:kill`;
  const killSignal = await redis.get(killKey);

  if (killSignal) {
    // Удаляем ключ, чтобы не было повторных срабатываний
    await redis.del(killKey);
    throw new Error(`Job ${job.id} was force killed by user signal`);
  }
};

// Главный процессор задач для очереди данных
const dataProcessor = async (job: Job<DataJobData>) => {
  logger.debug(`[Worker] Picked up job ${job.name} (ID: ${job.id}).`); // Лог получения задачи воркером

  // ---> НОВОЕ: Проверка force-kill в самом начале <---
  try {
    await checkJobCancellation(job);
  } catch (cancellationError: any) {
    logger.info(`[Worker] Job ${job.id} was cancelled before processing started`);
    return; // Мягко завершаем без ошибки
  }

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

  // Основная обработка с периодическими проверками отмены
  try {
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
  } catch (error: any) {
    if (error.message && error.message.includes('force killed')) {
      logger.info(`[Worker] Job ${job.id} was successfully cancelled: ${error.message}`);
      // ИСПРАВЛЕНИЕ: Перебрасываем ошибку, чтобы задача получила статус 'failed'
      throw error;
    }
    // Для всех остальных ошибок - перебрасываем
    throw error;
  }
};

// Создаем инстанс воркера
const worker = createWorker<DataJobData>(DATA_QUEUE_NAME, dataProcessor);

const cleanupKillSignal = async (jobId: string | undefined) => {
  if (jobId) {
      const killKey = `job:${jobId}:kill`;
      await redis.del(killKey);
  }
};

// --- Добавляем слушателей событий к созданному воркеру --- 
worker.on('completed', async (job: Job, result: any) => {
  await cleanupKillSignal(job?.id);
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
  await cleanupKillSignal(job?.id);
  const jobId = job?.id;
  const jobName = job?.name || 'unknown';
  logger.error(`[Queue Events][Worker] Job ${jobName} (ID: ${jobId || 'unknown'}) failed:`, error);
  
  // НОВОЕ: Регистрация ошибки в диагностической системе
  try {
    await diagnosticManager.registerError({
      type: classifyJobError(error, jobName),
      testId: jobId?.toString() || 'unknown',
      testType: determineJobTestType(jobName),
      description: `Job ${jobName} failed: ${error.message}`,
      context: {
        jobId,
        jobName,
        jobData: job?.data,
        attemptsMade: job?.attemptsMade,
        exchange: job?.data?.exchange,
        symbol: job?.data?.symbol || job?.data?.pairSymbol,
        timeframe: job?.data?.timeframe
      },
      stackTrace: error.stack,
      metadata: {
        timestamp: new Date().toISOString(),
        source: 'dataWorker',
        jobType: jobName,
        queueName: DATA_QUEUE_NAME
      }
    });
  } catch (diagnosticError) {
    logger.warn(`[Worker Listener - failed] Failed to register diagnostic error for job ${jobId}:`, diagnosticError);
  }
  
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

/**
 * Классификация ошибок заданий для диагностической системы
 */
function classifyJobError(error: Error, jobName: string): ErrorType {
  const message = error.message?.toLowerCase() || '';
  
  // Ошибки сети
  if (message.includes('econnrefused') || message.includes('timeout') || message.includes('connection')) {
    return ErrorType.NETWORK_ERROR;
  }
  
  // Ошибки данных
  if (message.includes('no data') || message.includes('not found') || message.includes('empty')) {
    return ErrorType.DATA_MISSING;
  }
  
  // Ошибки памяти
  if (message.includes('memory') || message.includes('heap') || message.includes('out of memory')) {
    return ErrorType.MEMORY_OVERFLOW;
  }
  
  // Ошибки API лимитов
  if (message.includes('rate limit') || message.includes('too many requests') || message.includes('429')) {
    return ErrorType.API_RATE_LIMIT;
  }
  
  // Ошибки валидации
  if (message.includes('validation') || message.includes('invalid') || message.includes('400')) {
    return ErrorType.VALIDATION_FAILED;
  }
  
  // GPU ошибки
  if (message.includes('gpu') || message.includes('cuda') || jobName.includes('gpu')) {
    return ErrorType.GPU_SERVICE_DOWN;
  }
  
  // Ошибки портфеля
  if (jobName.includes('portfolio') || jobName.includes('PORTFOLIO')) {
    return ErrorType.PORTFOLIO_INCOMPLETE;
  }
  
  // По умолчанию - ошибка расчетов
  return ErrorType.CALCULATION_ERROR;
}

/**
 * Определение типа теста по имени задания
 */
function determineJobTestType(jobName: string): 'single' | 'portfolio' | 'gpu' | 'system' {
  if (jobName.includes('portfolio') || jobName.includes('PORTFOLIO')) {
    return 'portfolio';
  } else if (jobName.includes('gpu') || jobName.includes('GPU')) {
    return 'gpu';
  } else if (jobName.includes('backtest') || jobName.includes('BACKTEST')) {
    return 'single';
  } else {
    return 'system';
  }
}

// Экспортируем сам воркер, если он нужен где-то еще (хотя обычно достаточно импорта файла)
export { worker as dataWorker };

// Экспортируем типы задач для использования в контроллере
export type { FetchCandlesJobData, FetchPairsJobData, FetchPortfolioDataAndRunBacktestJobData }; 