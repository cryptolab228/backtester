import { Request, Response } from 'express';
import { runBacktest, runPortfolioBacktest } from './backtester'; // Основная логика бэктестинга
import { BacktestRunParameters, BacktestResult, StrategyParameters, PortfolioBacktestRunParameters, PortfolioBacktestResult, Trade } from './backtester.types'; // Предполагается, что эти типы определены или будут определены
import { CandleData } from '../../interfaces/marketData.interface'; // Исправленный путь
import { getDefaultStrategyParameters } from '../../config/defaultStrategyParameters'; // Исправленный путь
import { dataService } from '../../services/dataService'; // <-- Импорт dataService
import logger from '../../utils/logger'; // <-- Импорт logger
import { dataQueue } from '../../config/queue'; // Исправленный импорт dataQueue
import { JOB_TYPES } from '../../jobs/dataWorker'; // Исправленный импорт JOB_TYPES
import { savePortfolioBacktestResult } from '@/utils/portfolioResultsSaver';
import { runGPUBacktest, runOptimizedGPUBacktest, runGPUBacktestValidation, shouldUseGPU, checkGPUServiceHealth } from '../../services/gpuService'; // НОВОЕ: GPU сервис
import { testResultsLogger } from '../../services/testResultsLogger'; // НОВОЕ: логирование результатов тестов

// Моковые данные свечей УДАЛЕНЫ

export const runBacktestHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const incomingParams: BacktestRunParameters = req.body;
    logger.info(`[BacktesterCtrl] Received backtest request for ${incomingParams.pairSymbol}. Use GPU: ${incomingParams.useGPU}`);
    logger.info(`[BacktesterCtrl] Received backtest request for ${incomingParams.pairSymbol} from ${incomingParams.startDate} to ${incomingParams.endDate}`);
    logger.debug('[BacktesterCtrl] Full incoming req.body:', req.body);

    // Валидация базовых параметров
    if (!incomingParams.pairSymbol || !incomingParams.timeframe || !incomingParams.startDate || !incomingParams.endDate || !incomingParams.initialCapital) {
      logger.warn('[BacktesterCtrl] Missing basic parameters for backtest.', incomingParams);
      res.status(400).json({ message: 'Missing required basic backtest parameters.' });
      return;
    }

    // Получаем и валидируем параметры стратегии
    let strategyParamsToUse: StrategyParameters;
    if (incomingParams.strategyParameters && 
        typeof incomingParams.strategyParameters === 'object' && 
        Object.keys(incomingParams.strategyParameters).length > 0 &&
        incomingParams.strategyParameters.dlc && // Проверка наличия хотя бы одного ключа верхнего уровня
        incomingParams.strategyParameters.risk   // и настроек риска
    ) {
      logger.info('[BacktesterCtrl] Using strategyParameters from request body.');
      // Создаем глубокую копию, чтобы избавиться от возможного Proxy
      try {
        strategyParamsToUse = JSON.parse(JSON.stringify(incomingParams.strategyParameters));
        // Изменяем способ логирования, чтобы точно увидеть содержимое
        logger.debug('[BacktesterCtrl] Successfully deep copied strategyParameters from request. Content: ' + JSON.stringify(strategyParamsToUse, null, 2));
        if (strategyParamsToUse && strategyParamsToUse.risk) {
            logger.debug('[BacktesterCtrl] Copied risk settings: ' + JSON.stringify(strategyParamsToUse.risk, null, 2));
        }
      } catch (e: any) {
        logger.error('[BacktesterCtrl] Failed to deep copy strategyParameters from request. Using defaults.', e.message);
        strategyParamsToUse = getDefaultStrategyParameters();
      }
    } else {
      logger.warn('[BacktesterCtrl] strategyParameters missing, empty, or incomplete in request. Using default strategy parameters.', incomingParams.strategyParameters);
      strategyParamsToUse = getDefaultStrategyParameters();
    }

    // Преобразование дат в timestamp
    const startTimestamp = new Date(incomingParams.startDate).getTime();
    const endTimestamp = new Date(incomingParams.endDate).getTime();

    if (isNaN(startTimestamp) || isNaN(endTimestamp)) {
        logger.warn('[BacktesterCtrl] Invalid date format for startDate or endDate.', { startDate: incomingParams.startDate, endDate: incomingParams.endDate });
        res.status(400).json({ message: 'Invalid date format for start or end date.' });
        return;
    }

    // Проверка логики дат - дата начала должна быть раньше даты окончания
    if (startTimestamp >= endTimestamp) {
        logger.warn('[BacktesterCtrl] Invalid date range: startDate must be before endDate.', { 
            startDate: incomingParams.startDate, 
            endDate: incomingParams.endDate,
            startTimestamp,
            endTimestamp
        });
        res.status(400).json({ message: 'Invalid date range: start date must be before end date.' });
        return;
    }

    // 0. Проверяем существование торговой пары
    const tradingPair = await dataService.getTradingPairBySymbol(incomingParams.pairSymbol);
    if (!tradingPair) {
      logger.warn(`[BacktesterCtrl] Trading pair ${incomingParams.pairSymbol} not found in DB. Cannot run backtest or fetch candles.`);
      res.status(404).json({ message: `Trading pair ${incomingParams.pairSymbol} not found. Please add it first.` });
      return;
    }

    // 1. Загрузка исторических данных
    logger.info(`[BacktesterCtrl] Fetching candles for ${incomingParams.pairSymbol}, ${incomingParams.timeframe} from ${new Date(startTimestamp)} to ${new Date(endTimestamp)} on ${incomingParams.exchange || 'any exchange'}`);
    const candlesFromDB = await dataService.getCandles(incomingParams.pairSymbol, incomingParams.timeframe, startTimestamp, endTimestamp, incomingParams.exchange);
    logger.info(`[BacktesterCtrl] Fetched ${candlesFromDB.length} candles from DB for ${incomingParams.pairSymbol} (${incomingParams.timeframe}).`);

    // 2. Проверка достаточности данных и при необходимости инициирование загрузки
    const firstCandleTime = candlesFromDB.length > 0 ? Number(candlesFromDB[0].timestamp) : null;
    const lastCandleTime = candlesFromDB.length > 0 ? Number(candlesFromDB[candlesFromDB.length - 1].timestamp) : null;

    // Определяем временной допуск в зависимости от таймфрейма для консистентности с портфольным бэктестом
    let timeframeTolerance = 0;
    switch (incomingParams.timeframe) {
      case '1m': timeframeTolerance = 5 * 60 * 1000; break;      // 5 минут для 1m
      case '5m': timeframeTolerance = 15 * 60 * 1000; break;     // 15 минут для 5m
      case '15m': timeframeTolerance = 30 * 60 * 1000; break;    // 30 минут для 15m
      case '1h': timeframeTolerance = 2 * 60 * 60 * 1000; break; // 2 часа для 1h
      case '4h': timeframeTolerance = 8 * 60 * 60 * 1000; break; // 8 часов для 4h
      case '1d': timeframeTolerance = 24 * 60 * 60 * 1000; break; // 1 день для 1d
      default: timeframeTolerance = 3 * 60 * 60 * 1000; break;   // 3 часа по умолчанию
    }

    // Определяем, нужно ли дозагружать данные
    // Нужно, если:
    // - свечей нет совсем
    // - первая свеча позже запрашиваемого начала (с учетом допуска)
    // - последняя свеча раньше запрашиваемого конца (с учетом допуска)
    const needsFetching = candlesFromDB.length === 0 || 
                          (firstCandleTime && firstCandleTime > startTimestamp + timeframeTolerance) || 
                          (lastCandleTime && lastCandleTime < endTimestamp - timeframeTolerance);

    if (needsFetching) {
      logger.warn(`[BacktesterCtrl] Insufficient candle data for ${incomingParams.pairSymbol} (${incomingParams.timeframe}) in range. Attempting to queue a fetch job.`);
      
      const jobData = {
        symbol: incomingParams.pairSymbol,
        timeframe: incomingParams.timeframe,
        // Запрашиваем весь диапазон, т.к. okxService сам определит, что уже есть, и загрузит недостающее (если сервис так умеет)
        // Либо, если okxService не умеет так, то нужно будет передать ему только недостающие диапазоны.
        // Для простоты пока запрашиваем весь диапазон.
        startTime: startTimestamp,
        endTime: endTimestamp,
        exchange: incomingParams.exchange || 'bybit',
        // Добавляем параметры бэктеста, чтобы воркер мог запустить его после загрузки
        backtestParams: { ...incomingParams, strategyParameters: strategyParamsToUse } 
      };

      try {
        const job = await dataQueue.add(JOB_TYPES.FETCH_CANDLES_AND_RUN_BACKTEST, jobData); // Используем новый тип задачи или передаем флаг
        logger.info(`[BacktesterCtrl] Successfully queued job ${JOB_TYPES.FETCH_CANDLES_AND_RUN_BACKTEST} for ${incomingParams.pairSymbol} (${incomingParams.timeframe}).`);
        res.status(202).json({ 
          message: `Candle data for ${incomingParams.pairSymbol} (${incomingParams.timeframe}) is being fetched. Backtest will run automatically once data is ready.`,
          jobDetails: { 
            jobId: job.id,
            symbol: jobData.symbol, 
            timeframe: jobData.timeframe, 
            range: `${new Date(startTimestamp)} - ${new Date(endTimestamp)}` 
          }
        });
      } catch (queueError: any) {
        logger.error(`[BacktesterCtrl] Failed to queue fetch job for ${incomingParams.pairSymbol}: ${queueError.message}`, queueError);
        res.status(500).json({ message: 'Failed to queue data fetching job. Please try again later.' });
      }
      return; // Завершаем обработку, так как данные будут загружены фоново
    }

    // Если дошли сюда, значит, свечи есть и их достаточно
    logger.info(`[BacktesterCtrl] Sufficient candle data found in DB for ${incomingParams.pairSymbol} (${incomingParams.timeframe}). Proceeding with backtest.`);

    // Адаптация Candle[] (из DB) к CandleData[] (ожидаемому runBacktest)
    const candlesToBacktest: CandleData[] = candlesFromDB.map(c => ({
      timestamp: Number(c.timestamp),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));

    const runParamsForService: BacktestRunParameters = {
        pairSymbol: incomingParams.pairSymbol,
        timeframe: incomingParams.timeframe,
        startDate: incomingParams.startDate, 
        endDate: incomingParams.endDate,     
        initialCapital: incomingParams.initialCapital,
        strategyParameters: strategyParamsToUse, // Используем проверенные/дефолтные параметры
        useGPU: incomingParams.useGPU, // НОВОЕ: передаем флаг GPU
    };
    
    logger.debug('[BacktesterCtrl] Parameters being sent to runBacktest service:', runParamsForService);
    logger.debug('[BacktesterCtrl] strategyParameters part specifically:', runParamsForService.strategyParameters);
    if (runParamsForService.strategyParameters) {
        logger.debug('[BacktesterCtrl] risk settings part specifically:', runParamsForService.strategyParameters.risk);
    // Явно логируем флаг exitOnOppositeSignal для диагностики
    logger.info(`[BacktesterCtrl] Risk flags for single backtest: exitOnOppositeSignal=${!!runParamsForService.strategyParameters?.risk?.exitOnOppositeSignal}, useTrailingStop=${!!runParamsForService.strategyParameters?.risk?.useTrailingStop}`);
    }

    // НОВОЕ: Выбор между GPU и CPU бэктестом
    let result: BacktestResult;
    const useGPUForBacktest = shouldUseGPU(runParamsForService, candlesToBacktest.length);
    
    if (useGPUForBacktest) {
      logger.info(`[BacktesterCtrl] Starting GPU backtest execution for ${incomingParams.pairSymbol} with ${candlesToBacktest.length} candles...`);
      try {
        // ВАЛИДАЦИОННЫЙ ЗАПУСК: сначала строим strategyCandles на CPU, чтобы сравнить сделки
        const cpuPreview = await runBacktest(runParamsForService, candlesToBacktest);
        result = await runGPUBacktestValidation(runParamsForService, cpuPreview.strategyCandles || []);
        logger.info(`[BacktesterCtrl] GPU backtest finished for ${incomingParams.pairSymbol}. Trades: ${result.metrics.totalTrades}`);
      } catch (gpuError: any) {
        logger.warn(`[BacktesterCtrl] GPU backtest failed, falling back to CPU: ${gpuError.message}`);
        logger.info('[BacktesterCtrl] Starting CPU backtest execution as fallback...');
        result = await runBacktest(runParamsForService, candlesToBacktest);
        logger.info(`[BacktesterCtrl] CPU backtest (fallback) finished for ${incomingParams.pairSymbol}. Trades: ${result.metrics.totalTrades}`);
      }
    } else {
      logger.info(`[BacktesterCtrl] Starting CPU backtest execution for ${incomingParams.pairSymbol}...`);
      result = await runBacktest(runParamsForService, candlesToBacktest);
      logger.info(`[BacktesterCtrl] CPU backtest finished for ${incomingParams.pairSymbol}. Trades: ${result.metrics.totalTrades}`);
    }

    // НОВОЕ: Логируем результат теста для анализа
    const testType = useGPUForBacktest ? 'GPU' : 'CPU';
    try {
      if (testType === 'GPU') {
        await testResultsLogger.logGPUSingleTest(result, {
          pairSymbol: incomingParams.pairSymbol,
          timeframe: incomingParams.timeframe,
          startDate: incomingParams.startDate,
          endDate: incomingParams.endDate,
          initialCapital: incomingParams.initialCapital,
          candlesCount: candlesToBacktest.length,
          executionSource: 'IMMEDIATE'
        });
      } else {
        await testResultsLogger.logCPUSingleTest(result, {
          pairSymbol: incomingParams.pairSymbol,
          timeframe: incomingParams.timeframe,
          startDate: incomingParams.startDate,
          endDate: incomingParams.endDate,
          initialCapital: incomingParams.initialCapital,
          candlesCount: candlesToBacktest.length,
          executionSource: 'IMMEDIATE'
        });
      }
    } catch (logError: any) {
      logger.warn(`[BacktesterCtrl] Failed to log test result: ${logError.message}`);
    }

    const responsePayload: BacktestResult = {
      metrics: result.metrics,
      trades: result.trades,
      configUsed: runParamsForService, // Добавляем использованную конфигурацию в ответ
      // strategyCandles: result.strategyCandles, // Опционально, если нужно на фронте
      jobId: undefined, // sessionId больше не используется
    };

    res.status(200).json(responsePayload);

  } catch (error: any) {
    logger.error('[BacktesterCtrl] Error during backtest execution:', { message: error.message, stack: error.stack, requestBody: req.body });
    res.status(500).json({ message: 'Internal server error during backtest', error: error.message });
  }
}; 

// === МУЛЬТИ-БЕКТЕСТЕР (ПОРТФЕЛЬНЫЙ БЕКТЕСТЕР) ===

export const runPortfolioBacktestHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const incomingParams: PortfolioBacktestRunParameters = req.body;
    
    logger.info(`[PortfolioBacktesterCtrl] Received portfolio backtest request. Use GPU: ${incomingParams.useGPU}`);
    // Важный лог: что реально пришло в risk
    try {
      const rawRisk = (incomingParams as any)?.strategyParameters?.risk;
      logger.info('[PortfolioBacktesterCtrl] Incoming risk flags (raw):', {
        useTrailingStop: !!rawRisk?.useTrailingStop,
        trailingStopOffsetMultiplier: rawRisk?.trailingStopOffsetMultiplier,
        trailingStopStepMultiplier: rawRisk?.trailingStopStepMultiplier,
        stopLossMultiplier: rawRisk?.stopLossMultiplier,
        takeProfitMultiplier: rawRisk?.takeProfitMultiplier,
        atrPeriod: rawRisk?.atrPeriod
      });
    } catch {}
    logger.info(`[PortfolioBacktesterCtrl] Received portfolio backtest request for pairs: ${incomingParams.pairSymbols?.join(', ')} from ${incomingParams.startDate} to ${incomingParams.endDate}`);

    // Валидация
    if (!incomingParams.pairSymbols || !Array.isArray(incomingParams.pairSymbols) || incomingParams.pairSymbols.length === 0 || !incomingParams.timeframe || !incomingParams.startDate || !incomingParams.endDate || !incomingParams.initialPortfolioCapital) {
      res.status(400).json({ message: 'Missing required portfolio backtest parameters.' });
      return;
    }

    // Параметры стратегии
    let strategyParamsToUse: StrategyParameters = incomingParams.strategyParameters && Object.keys(incomingParams.strategyParameters).length > 0
      ? JSON.parse(JSON.stringify(incomingParams.strategyParameters))
      : getDefaultStrategyParameters();

    if (!strategyParamsToUse || Object.keys(strategyParamsToUse).length === 0) {
      logger.warn('[PortfolioBacktesterCtrl] strategyParameters missing, empty, or incomplete in request. Using default strategy parameters.');
      strategyParamsToUse = getDefaultStrategyParameters();
    }

    // Диагностика: логируем ключевые risk-поля для подтверждения доставки флагов
    logger.info('[PortfolioBacktesterCtrl] Risk flags received:', {
      useTrailingStop: !!strategyParamsToUse?.risk?.useTrailingStop,
      exitOnOppositeSignal: !!strategyParamsToUse?.risk?.exitOnOppositeSignal,
      trailingStopOffsetMultiplier: strategyParamsToUse?.risk?.trailingStopOffsetMultiplier,
      trailingStopStepMultiplier: strategyParamsToUse?.risk?.trailingStopStepMultiplier,
      stopLossMultiplier: strategyParamsToUse?.risk?.stopLossMultiplier,
      takeProfitMultiplier: strategyParamsToUse?.risk?.takeProfitMultiplier,
      atrPeriod: strategyParamsToUse?.risk?.atrPeriod
    });

    // Проверка наличия данных для портфельного бэктеста
    const { startDate, endDate, timeframe, exchange } = incomingParams;
    const startTimestamp = new Date(startDate).getTime();
    const endTimestamp = new Date(endDate).getTime();
    const allCandles = new Map<string, CandleData[]>();
    const pairsWithData: string[] = [];
    const pairsNeedingData: string[] = [];

    // Стандартизируем exchange для всех запросов
    const targetExchange = exchange || 'bybit';
    logger.info(`[PortfolioBacktesterCtrl] Checking data availability for ${incomingParams.pairSymbols.length} pairs on ${targetExchange}...`);
    logger.info(`[PortfolioBacktesterCtrl] Параметры запроса: startTimestamp=${startTimestamp} (${new Date(startTimestamp)}), endTimestamp=${endTimestamp} (${new Date(endTimestamp)}), timeframe=${timeframe}, exchange=${targetExchange}`);
    
    // Проверка параметров запуска
    logger.info(`[PortfolioBacktesterCtrl] STARTUP CHECK: Запрос выполняется с параметрами: exchange=${targetExchange}, timeframe=${timeframe}, pairsCount=${incomingParams.pairSymbols.length}, useGPU=${incomingParams.useGPU || false}`);
    // Проверка использования параметра exchange
    if (incomingParams.exchange !== targetExchange) {
      logger.warn(`[PortfolioBacktesterCtrl] WARNING: Exchange parameter mismatch! incomingParams.exchange=${incomingParams.exchange}, targetExchange=${targetExchange}. Используем targetExchange для запросов к БД.`);
    }

    for (const pairSymbol of incomingParams.pairSymbols) {
      // ИСПРАВЛЕНО: Передаем биржу при поиске торговой пары
      const tradingPair = await dataService.getTradingPairBySymbol(pairSymbol, targetExchange);
      if (!tradingPair) {
        logger.warn(`[PortfolioBacktesterCtrl] Trading pair ${pairSymbol} on ${targetExchange} not found, skipping.`);
        continue;
      }

      // ИСПРАВЛЕНО: Передаем стандартизированный параметр биржи при поиске свечей
      const candles = await dataService.getCandles(pairSymbol, timeframe, startTimestamp, endTimestamp, targetExchange);
      if (candles.length > 0) {
        // Проверяем, достаточно ли данных (простая проверка - есть ли данные близко к началу и концу периода)
        const firstCandleTime = Number(candles[0].timestamp);
        const lastCandleTime = Number(candles[candles.length - 1].timestamp);
        // ИСПРАВЛЕНО: Используем ту же логику, что и в обычном бэктесте
        // Определяем временной допуск в зависимости от таймфрейма
        let timeframeTolerance = 0;
        switch (timeframe) {
          case '1m': timeframeTolerance = 5 * 60 * 1000; break;      // 5 минут для 1m
          case '5m': timeframeTolerance = 15 * 60 * 1000; break;     // 15 минут для 5m
          case '15m': timeframeTolerance = 30 * 60 * 1000; break;    // 30 минут для 15m
          case '1h': timeframeTolerance = 2 * 60 * 60 * 1000; break; // 2 часа для 1h
          case '4h': timeframeTolerance = 8 * 60 * 60 * 1000; break; // 8 часов для 4h
          case '1d': timeframeTolerance = 24 * 60 * 60 * 1000; break; // 1 день для 1d
          default: timeframeTolerance = 3 * 60 * 60 * 1000; break;   // 3 часа по умолчанию
        }
        
        // Проверяем, покрывают ли данные запрашиваемый временной диапазон с учетом допуска
        const missingAtStart = firstCandleTime > startTimestamp + timeframeTolerance;
        const missingAtEnd = lastCandleTime < endTimestamp - timeframeTolerance;
        
        // ИСПРАВЛЕНО: Используем простую логику как в обычном бэктесте
        const needsFetching = candles.length === 0 || missingAtStart || missingAtEnd;
        
        // Логируем результаты проверки
        logger.info(`[PortfolioBacktesterCtrl] ${pairSymbol}: Результаты проверки данных: свечей=${candles.length}, missingAtStart=${missingAtStart}, missingAtEnd=${missingAtEnd}, needsFetching=${needsFetching}`);
        logger.info(`[PortfolioBacktesterCtrl] ${pairSymbol}: Временной диапазон данных: ${new Date(firstCandleTime)} - ${new Date(lastCandleTime)}, запрашиваемый: ${new Date(startTimestamp)} - ${new Date(endTimestamp)}`);
        

        if (needsFetching) {
          logger.info(`[PortfolioBacktesterCtrl] ${pairSymbol}: Данные неполные (${candles.length} свечей), необходимы дополнительные данные. Диапазон данных: ${new Date(firstCandleTime)} - ${new Date(lastCandleTime)}, запрашиваемый диапазон: ${new Date(startTimestamp)} - ${new Date(endTimestamp)}`);
          pairsNeedingData.push(pairSymbol);
        } else {
          logger.info(`[PortfolioBacktesterCtrl] ${pairSymbol}: Данные полные (${candles.length} свечей). Диапазон данных: ${new Date(firstCandleTime)} - ${new Date(lastCandleTime)}, запрашиваемый диапазон: ${new Date(startTimestamp)} - ${new Date(endTimestamp)}`);
          allCandles.set(pairSymbol, candles.map(c => ({ ...c, timestamp: Number(c.timestamp) })));
          pairsWithData.push(pairSymbol);
        }
      } else {
        logger.info(`[PortfolioBacktesterCtrl] ${pairSymbol}: No data found, needs fetching`);
        pairsNeedingData.push(pairSymbol);
      }
    }

    logger.info(`[PortfolioBacktesterCtrl] Data check results: ${pairsWithData.length} pairs ready, ${pairsNeedingData.length} pairs need data`);

    // Если всем парам нужна загрузка данных OR если есть пары без данных, создаем задачу в очереди
    if (pairsNeedingData.length > 0) {
      logger.info(`[PortfolioBacktesterCtrl] Data needs to be fetched for ${pairsNeedingData.length} pairs. Creating queue job...`);
      
      const jobData = {
        portfolioParams: { ...incomingParams, strategyParameters: strategyParamsToUse }, // ВАЖНО: сохраняем useGPU флаг
        pairsNeedingData,
        startTimestamp,
        endTimestamp,
        exchange: targetExchange
      };

      try {
        const job = await dataQueue.add(JOB_TYPES.FETCH_PORTFOLIO_DATA_AND_RUN_BACKTEST, jobData);
        logger.info(`[PortfolioBacktesterCtrl] Successfully queued portfolio data fetch job ${job.id} for ${pairsNeedingData.length} pairs.`);
        res.status(202).json({
          message: `Portfolio backtest queued. Data fetching for ${pairsNeedingData.length} pairs in progress. Results will be available via WebSocket.`,
          jobDetails: {
            jobId: job.id,
            pairsNeedingData,
            pairsWithData,
            useGPU: incomingParams.useGPU,
            totalPairs: incomingParams.pairSymbols.length,
            timeframe: incomingParams.timeframe,
            exchange: targetExchange
          }
        });
        return;
      } catch (queueError: any) {
        logger.error(`[PortfolioBacktesterCtrl] Failed to queue portfolio data fetch job: ${queueError.message}`, queueError);
        res.status(500).json({ message: 'Failed to queue portfolio data fetching job. Please try again later.' });
        return;
      }
    }

    // Если все данные готовы, запускаем портфельный бэктест сразу
    if (pairsWithData.length === incomingParams.pairSymbols.length) {
      logger.info(`[PortfolioBacktesterCtrl] All ${pairsWithData.length} pairs have complete data. Running portfolio backtest immediately...`);
      
      const runParams: PortfolioBacktestRunParameters = { ...incomingParams, strategyParameters: strategyParamsToUse };
      let portfolioResult: PortfolioBacktestResult;

      // ОТКЛЮЧЕНО: GPU для портфельного бэктеста НЕ является настоящим портфельным тестом
      // Текущая реализация запускает отдельные тесты и агрегирует - это дает неверные результаты
      if (false && incomingParams.useGPU) {
        logger.warn(`[PortfolioBacktesterCtrl] GPU portfolio test disabled - incorrect implementation (runs individual tests, not true portfolio)`);
        logger.info(`[PortfolioBacktesterCtrl] Attempting to run PORTFOLIO backtest on GPU for ${allCandles.size} pairs.`);
        const individualResults: BacktestResult[] = [];
        for (const [pairSymbol, candles] of allCandles.entries()) {
          const singleRunParams: BacktestRunParameters = { 
            ...runParams, 
            pairSymbol, 
            initialCapital: runParams.initialPortfolioCapital / allCandles.size 
          };
          try {
            logger.info(`[PortfolioBacktesterCtrl-GPU] Running GPU backtest for ${pairSymbol} with ${candles.length} candles...`);
            const result = await runGPUBacktest(singleRunParams, candles);
            individualResults.push(result);
            logger.info(`[PortfolioBacktesterCtrl-GPU] GPU backtest completed for ${pairSymbol}. Trades: ${result.metrics.totalTrades}`);
          } catch (error: any) {
            logger.error(`[PortfolioBacktesterCtrl-GPU] GPU backtest failed for ${pairSymbol}: ${error.message}. Skipping this pair.`);
          }
        }

        if (individualResults.length === 0) {
          throw new Error('All GPU backtests failed. No results to return.');
        }
        
        // Агрегация результатов GPU бэктестов
        const totalPnl = individualResults.reduce((sum, r) => sum + r.metrics.totalPnl, 0);
        const totalTrades = individualResults.reduce((sum, r) => sum + r.metrics.totalTrades, 0);
        const totalPnlPercentage = runParams.initialPortfolioCapital > 0 ? (totalPnl / runParams.initialPortfolioCapital) * 100 : 0;
        
        portfolioResult = {
            overallMetrics: {
                totalPortfolioPnl: totalPnl,
                totalPortfolioTrades: totalTrades,
                totalPortfolioPnlPercentage: totalPnlPercentage,
                portfolioWinningTrades: individualResults.reduce((sum, r) => sum + (r.metrics.winningTrades || 0), 0),
                portfolioLosingTrades: individualResults.reduce((sum, r) => sum + (r.metrics.losingTrades || 0), 0),
                // Возвращаем проценты 0..100
                portfolioWinRate: totalTrades > 0 ? (individualResults.reduce((sum, r) => sum + (r.metrics.winningTrades || 0), 0) / totalTrades) * 100 : 0,
                portfolioProfitFactor: individualResults.reduce((sum, r) => sum + (r.metrics.profitFactor || 0), 0) / individualResults.length,
                portfolioMaxDrawdown: Math.max(...individualResults.map(r => r.metrics.maxDrawdown || 0)),
                sharpeRatioPortfolio: individualResults.reduce((sum, r) => sum + (r.metrics.sharpeRatio || 0), 0) / individualResults.length,
                portfolioGrossProfit: individualResults.reduce((sum, r) => sum + Math.max(r.metrics.totalPnl, 0), 0),
                portfolioGrossLoss: Math.abs(individualResults.reduce((sum, r) => sum + Math.min(r.metrics.totalPnl, 0), 0)),
                portfolioAverageTradePnl: totalTrades > 0 ? totalPnl / totalTrades : 0,
                portfolioExpectancy: 0, // TODO: Implement proper expectancy calculation
                avgConcurrentTrades: 0, // TODO: Implement from individual results
                peakConcurrentTrades: 0, // TODO: Implement from individual results
                initialPortfolioCapital: runParams.initialPortfolioCapital,
                finalPortfolioCapital: runParams.initialPortfolioCapital + totalPnl,
                portfolioEquityCurve: [], // TODO: Implement from individual results
                durationMs: individualResults.reduce((sum, r) => sum + (r.metrics.durationMs || 0), 0),
            },
            tradesByPair: individualResults.reduce((acc, r) => r.configUsed ? { ...acc, [r.configUsed.pairSymbol]: r.trades } : acc, {}),
            metricsByPair: individualResults.reduce((acc, r) => r.configUsed ? { ...acc, [r.configUsed.pairSymbol]: r.metrics } : acc, {}),
            configUsed: runParams,
            strategyCandlesByPair: {},
        };
        logger.info(`[PortfolioBacktesterCtrl-GPU] Finished GPU portfolio backtest. Total PnL: ${totalPnl.toFixed(2)} (${totalPnlPercentage.toFixed(2)}%)`);
        
        // НОВОЕ: Логируем результат GPU портфельного теста
        try {
          const totalCandles = Array.from(allCandles.values()).reduce((sum, candles) => sum + candles.length, 0);
          
          await testResultsLogger.logGPUPortfolioTest(portfolioResult, {
            pairSymbols: incomingParams.pairSymbols,
            timeframe: incomingParams.timeframe,
            startDate: incomingParams.startDate,
            endDate: incomingParams.endDate,
            initialPortfolioCapital: incomingParams.initialPortfolioCapital,
            totalCandlesCount: totalCandles,
            executionSource: 'IMMEDIATE'
          });
        } catch (logError: any) {
          logger.warn(`[PortfolioBacktesterCtrl-GPU] Failed to log GPU portfolio test result: ${logError.message}`);
        }
      } else {
        logger.info('[PortfolioBacktesterCtrl] Running portfolio backtest on CPU...');
        const candlesByPairRecord = Object.fromEntries(allCandles);
        portfolioResult = await runPortfolioBacktest(runParams, candlesByPairRecord);
        logger.info(`[PortfolioBacktesterCtrl-CPU] Finished CPU portfolio backtest. Total PnL: ${portfolioResult.overallMetrics.totalPortfolioPnl.toFixed(2)}`);

        try {
          const fileInfo = await savePortfolioBacktestResult(portfolioResult, {
            jobId: 'controller'
          });
          logger.info('[PortfolioBacktesterCtrl] Portfolio backtest results saved to file.', fileInfo);
        } catch (saveError: any) {
          logger.error('[PortfolioBacktesterCtrl] Failed to save portfolio backtest results', saveError);
        }
      }

      // НОВОЕ: Логируем результат портфельного теста
      try {
        const totalCandles = Array.from(allCandles.values()).reduce((sum, candles) => sum + candles.length, 0);
        
        await testResultsLogger.logCPUPortfolioTest(portfolioResult, {
          pairSymbols: incomingParams.pairSymbols,
          timeframe: incomingParams.timeframe,
          startDate: incomingParams.startDate,
          endDate: incomingParams.endDate,
          initialPortfolioCapital: incomingParams.initialPortfolioCapital,
          totalCandlesCount: totalCandles,
          executionSource: 'IMMEDIATE'
        });
      } catch (logError: any) {
        logger.warn(`[PortfolioBacktesterCtrl] Failed to log portfolio test result: ${logError.message}`);
      }

      const responsePayload: PortfolioBacktestResult = {
        ...portfolioResult,
        jobId: undefined, // sessionId больше не используется
      };

      res.status(200).json(responsePayload);

    } else {
      // Это не должно происходить с новой логикой, но на всякий случай
      res.status(400).json({ 
        message: `Unexpected state: ${pairsWithData.length} pairs ready, ${pairsNeedingData.length} pairs need data, but no action taken.` 
      });
    }
  } catch (error: any) {
    logger.error('[PortfolioBacktesterCtrl] Error during portfolio backtest:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Internal server error during portfolio backtest', error: error.message });
  }
};

/**
 * Получает статус GPU-сервиса, включая информацию о доступности и статистику.
 */
export const getGPUServiceStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const status = await checkGPUServiceHealth();
    res.status(200).json(status);
  } catch (error: any) {
    logger.error('[GPUServiceCtrl] Error getting GPU service status:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Internal server error getting GPU service status', error: error.message });
  }
}; 

/**
 * Сравнение результатов CPU и GPU на одном и том же входе с использованием валидационного режима GPU
 */
export const compareCpuGpuHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const incomingParams: BacktestRunParameters = req.body;
    if (!incomingParams?.pairSymbol || !incomingParams?.timeframe || !incomingParams?.startDate || !incomingParams?.endDate || !incomingParams?.initialCapital) {
      res.status(400).json({ message: 'Missing required parameters' });
      return;
    }

    // Получаем свечи из БД
    const startTimestamp = new Date(incomingParams.startDate).getTime();
    const endTimestamp = new Date(incomingParams.endDate).getTime();
    const candlesFromDB = await dataService.getCandles(incomingParams.pairSymbol, incomingParams.timeframe, startTimestamp, endTimestamp, incomingParams.exchange);
    const candlesToBacktest = candlesFromDB.map(c => ({
      timestamp: Number(c.timestamp), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume
    }));

    const strategyParams = incomingParams.strategyParameters && Object.keys(incomingParams.strategyParameters).length > 0
      ? JSON.parse(JSON.stringify(incomingParams.strategyParameters))
      : getDefaultStrategyParameters();

    const runParams: BacktestRunParameters = { ...incomingParams, strategyParameters: strategyParams };

    // CPU
    const cpu = await runBacktest(runParams, candlesToBacktest);
    // GPU (validation): используем strategyCandles из CPU
    const gpu = await runGPUBacktestValidation(runParams, cpu.strategyCandles || []);

    // Сводка сравнения
    const summary = {
      cpu: {
        totalTrades: cpu.metrics.totalTrades,
        totalPnl: cpu.metrics.totalPnl,
        winRate: cpu.metrics.winRate,
        maxDrawdown: cpu.metrics.maxDrawdown
      },
      gpu: {
        totalTrades: gpu.metrics.totalTrades,
        totalPnl: gpu.metrics.totalPnl,
        winRate: gpu.metrics.winRate,
        maxDrawdown: gpu.metrics.maxDrawdown
      },
      diffs: {
        trades: Math.abs(cpu.metrics.totalTrades - gpu.metrics.totalTrades),
        pnlAbs: Math.abs(cpu.metrics.totalPnl - gpu.metrics.totalPnl),
        winRateAbs: Math.abs(cpu.metrics.winRate - gpu.metrics.winRate),
        maxDrawdownAbs: Math.abs(cpu.metrics.maxDrawdown - gpu.metrics.maxDrawdown)
      }
    };

    res.json({ success: true, summary, cpu, gpu });

  } catch (error: any) {
    logger.error('[BacktesterCtrl] compareCpuGpuHandler error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};