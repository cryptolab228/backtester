import { Request, Response } from 'express';
import { runBacktest, runPortfolioBacktest } from './backtester'; // Основная логика бэктестинга
import { BacktestRunParameters, BacktestResult, StrategyParameters, PortfolioBacktestRunParameters, PortfolioBacktestResult } from './backtester.types'; // Предполагается, что эти типы определены или будут определены
import { CandleData } from '../../interfaces/marketData.interface'; // Исправленный путь
import { getDefaultStrategyParameters } from '../../config/defaultStrategyParameters'; // Исправленный путь
import { dataService } from '../../services/dataService'; // <-- Импорт dataService
import logger from '../../utils/logger'; // <-- Импорт logger
import { dataQueue } from '../../config/queue'; // Исправленный импорт dataQueue
import { JOB_TYPES } from '../../jobs/dataWorker'; // Исправленный импорт JOB_TYPES

// Моковые данные свечей УДАЛЕНЫ

export const runBacktestHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const incomingParams: BacktestRunParameters = req.body;
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
    logger.info(`[BacktesterCtrl] Fetching candles for ${incomingParams.pairSymbol}, ${incomingParams.timeframe} from ${new Date(startTimestamp)} to ${new Date(endTimestamp)}`);
    const candlesFromDB = await dataService.getCandles(incomingParams.pairSymbol, incomingParams.timeframe, startTimestamp, endTimestamp);
    logger.info(`[BacktesterCtrl] Fetched ${candlesFromDB.length} candles from DB for ${incomingParams.pairSymbol} (${incomingParams.timeframe}).`);

    // 2. Проверка достаточности данных и при необходимости инициирование загрузки
    const firstCandleTime = candlesFromDB.length > 0 ? Number(candlesFromDB[0].timestamp) : null;
    const lastCandleTime = candlesFromDB.length > 0 ? Number(candlesFromDB[candlesFromDB.length - 1].timestamp) : null;

    // Определяем, нужно ли дозагружать данные
    // Нужно, если:
    // - свечей нет совсем
    // - первая свеча позже запрашиваемого начала
    // - последняя свеча раньше запрашиваемого конца
    const needsFetching = candlesFromDB.length === 0 || 
                          (firstCandleTime && firstCandleTime > startTimestamp) || 
                          (lastCandleTime && lastCandleTime < endTimestamp);

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
    };
    
    logger.debug('[BacktesterCtrl] Parameters being sent to runBacktest service:', runParamsForService);
    logger.debug('[BacktesterCtrl] strategyParameters part specifically:', runParamsForService.strategyParameters);
    if (runParamsForService.strategyParameters) {
        logger.debug('[BacktesterCtrl] risk settings part specifically:', runParamsForService.strategyParameters.risk);
    }

    logger.info('[BacktesterCtrl] Starting backtest service execution...');
    const result = await runBacktest(runParamsForService, candlesToBacktest);
    logger.info(`[BacktesterCtrl] Backtest service finished for ${incomingParams.pairSymbol}. Trades: ${result.metrics.totalTrades}`);

    const responsePayload: BacktestResult = {
      metrics: result.metrics,
      trades: result.trades,
      configUsed: runParamsForService, // Добавляем использованную конфигурацию в ответ
      // strategyCandles: result.strategyCandles, // Опционально, если нужно на фронте
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
    logger.info(`[PortfolioBacktesterCtrl] Received portfolio backtest request for pairs: ${incomingParams.pairSymbols?.join(', ')} from ${incomingParams.startDate} to ${incomingParams.endDate}`);
    logger.debug('[PortfolioBacktesterCtrl] Full incoming req.body:', req.body);

    // Валидация базовых параметров
    if (!incomingParams.pairSymbols || !Array.isArray(incomingParams.pairSymbols) || incomingParams.pairSymbols.length === 0) {
      logger.warn('[PortfolioBacktesterCtrl] No pair symbols provided or empty array.');
      res.status(400).json({ message: 'pairSymbols must be a non-empty array of trading pair symbols.' });
      return;
    }

    if (!incomingParams.timeframe || !incomingParams.startDate || !incomingParams.endDate || !incomingParams.initialPortfolioCapital) {
      logger.warn('[PortfolioBacktesterCtrl] Missing basic parameters for portfolio backtest.', incomingParams);
      res.status(400).json({ message: 'Missing required basic portfolio backtest parameters.' });
      return;
    }

    if (incomingParams.initialPortfolioCapital <= 0) {
      logger.warn('[PortfolioBacktesterCtrl] Initial portfolio capital must be positive.', { capital: incomingParams.initialPortfolioCapital });
      res.status(400).json({ message: 'Initial portfolio capital must be positive.' });
      return;
    }

    // Получаем и валидируем параметры стратегии
    let strategyParamsToUse: StrategyParameters;
    if (incomingParams.strategyParameters && 
        typeof incomingParams.strategyParameters === 'object' && 
        Object.keys(incomingParams.strategyParameters).length > 0 &&
        incomingParams.strategyParameters.dlc && 
        incomingParams.strategyParameters.risk   
    ) {
      logger.info('[PortfolioBacktesterCtrl] Using strategyParameters from request body.');
      try {
        strategyParamsToUse = JSON.parse(JSON.stringify(incomingParams.strategyParameters));
        logger.debug('[PortfolioBacktesterCtrl] Successfully deep copied strategyParameters from request.');
      } catch (e: any) {
        logger.error('[PortfolioBacktesterCtrl] Failed to deep copy strategyParameters from request. Using defaults.', e.message);
        strategyParamsToUse = getDefaultStrategyParameters();
      }
    } else {
      logger.warn('[PortfolioBacktesterCtrl] strategyParameters missing, empty, or incomplete in request. Using default strategy parameters.');
      strategyParamsToUse = getDefaultStrategyParameters();
    }

    // Преобразование дат в timestamp
    const startTimestamp = new Date(incomingParams.startDate).getTime();
    const endTimestamp = new Date(incomingParams.endDate).getTime();

    if (isNaN(startTimestamp) || isNaN(endTimestamp)) {
        logger.warn('[PortfolioBacktesterCtrl] Invalid date format for startDate or endDate.', { startDate: incomingParams.startDate, endDate: incomingParams.endDate });
        res.status(400).json({ message: 'Invalid date format for start or end date.' });
        return;
    }

    // Проверка логики дат - дата начала должна быть раньше даты окончания
    if (startTimestamp >= endTimestamp) {
        logger.warn('[PortfolioBacktesterCtrl] Invalid date range: startDate must be before endDate.', { 
            startDate: incomingParams.startDate, 
            endDate: incomingParams.endDate,
            startTimestamp,
            endTimestamp
        });
        res.status(400).json({ message: 'Invalid date range: start date must be before end date.' });
        return;
    }

    // Проверяем существование всех торговых пар
    const existingPairs: string[] = [];
    const missingPairs: string[] = [];
    
    for (const pairSymbol of incomingParams.pairSymbols) {
      const tradingPair = await dataService.getTradingPairBySymbol(pairSymbol);
      if (tradingPair) {
        existingPairs.push(pairSymbol);
      } else {
        missingPairs.push(pairSymbol);
      }
    }

    if (missingPairs.length > 0) {
      logger.warn(`[PortfolioBacktesterCtrl] Some trading pairs not found in DB: ${missingPairs.join(', ')}`);
      res.status(404).json({ 
        message: `Trading pairs not found: ${missingPairs.join(', ')}. Please add them first.`,
        existingPairs,
        missingPairs
      });
      return;
    }

    // Загрузка данных для всех пар
    const candlesByPair: Record<string, CandleData[]> = {};
    const pairsNeedingData: string[] = [];

    logger.info(`[PortfolioBacktesterCtrl] Fetching candles for ${existingPairs.length} pairs from ${new Date(startTimestamp)} to ${new Date(endTimestamp)}`);

    for (const pairSymbol of existingPairs) {
      const candlesFromDB = await dataService.getCandles(pairSymbol, incomingParams.timeframe, startTimestamp, endTimestamp);
      logger.info(`[PortfolioBacktesterCtrl] Fetched ${candlesFromDB.length} candles for ${pairSymbol} (${incomingParams.timeframe}).`);

      // Проверка достаточности данных
      const firstCandleTime = candlesFromDB.length > 0 ? Number(candlesFromDB[0].timestamp) : null;
      const lastCandleTime = candlesFromDB.length > 0 ? Number(candlesFromDB[candlesFromDB.length - 1].timestamp) : null;

      const needsFetching = candlesFromDB.length === 0 || 
                            (firstCandleTime && firstCandleTime > startTimestamp) || 
                            (lastCandleTime && lastCandleTime < endTimestamp);

      if (needsFetching) {
        pairsNeedingData.push(pairSymbol);
        logger.warn(`[PortfolioBacktesterCtrl] Insufficient candle data for ${pairSymbol} (${incomingParams.timeframe}) in range.`);
      } else {
        // Адаптация данных
        candlesByPair[pairSymbol] = candlesFromDB.map(c => ({
          timestamp: Number(c.timestamp),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        }));
      }
    }

    // Если нужно дозагрузить данные для некоторых пар
    if (pairsNeedingData.length > 0) {
      logger.warn(`[PortfolioBacktesterCtrl] Some pairs need data fetching: ${pairsNeedingData.join(', ')}. Queuing portfolio backtest job.`);
      
      const jobData = {
        portfolioParams: { ...incomingParams, strategyParameters: strategyParamsToUse },
        pairsNeedingData,
        startTimestamp,
        endTimestamp
      };

      try {
        // Создадим новый тип задачи для портфельного бектестинга
        const job = await dataQueue.add('FETCH_PORTFOLIO_DATA_AND_RUN_BACKTEST', jobData);
        logger.info(`[PortfolioBacktesterCtrl] Successfully queued portfolio backtest job for pairs: ${pairsNeedingData.join(', ')}`);
        res.status(202).json({ 
          message: `Portfolio backtest queued. Data is being fetched for pairs: ${pairsNeedingData.join(', ')}.`,
          jobDetails: { 
            jobId: job.id,
            pairsNeedingData, 
            pairsReady: existingPairs.filter(p => !pairsNeedingData.includes(p)),
            timeframe: incomingParams.timeframe, 
            range: `${new Date(startTimestamp)} - ${new Date(endTimestamp)}` 
          }
        });
      } catch (queueError: any) {
        logger.error(`[PortfolioBacktesterCtrl] Failed to queue portfolio backtest job: ${queueError.message}`, queueError);
        res.status(500).json({ message: 'Failed to queue portfolio backtest job. Please try again later.' });
      }
      return;
    }

    // Если все данные готовы, запускаем портфельный бектест
    logger.info(`[PortfolioBacktesterCtrl] All candle data ready. Running portfolio backtest for ${existingPairs.length} pairs.`);

    const portfolioParams: PortfolioBacktestRunParameters = {
      pairSymbols: existingPairs,
      timeframe: incomingParams.timeframe,
      startDate: incomingParams.startDate, 
      endDate: incomingParams.endDate,     
      initialPortfolioCapital: incomingParams.initialPortfolioCapital,
      strategyParameters: strategyParamsToUse,
      portfolioSettings: incomingParams.portfolioSettings || {}
    };
    
    logger.debug('[PortfolioBacktesterCtrl] Parameters being sent to runPortfolioBacktest:', portfolioParams);

    logger.info('[PortfolioBacktesterCtrl] Starting portfolio backtest execution...');
    const result = await runPortfolioBacktest(portfolioParams, candlesByPair);
    logger.info(`[PortfolioBacktesterCtrl] Portfolio backtest finished. Total trades: ${result.overallMetrics.totalPortfolioTrades}, Total PnL: ${result.overallMetrics.totalPortfolioPnl}`);

    const responsePayload: PortfolioBacktestResult = {
      overallMetrics: result.overallMetrics,
      tradesByPair: result.tradesByPair,
      metricsByPair: result.metricsByPair,
      configUsed: portfolioParams,
      strategyCandlesByPair: result.strategyCandlesByPair
    };

    res.status(200).json(responsePayload);

  } catch (error: any) {
    logger.error('[PortfolioBacktesterCtrl] Error during portfolio backtest execution:', { message: error.message, stack: error.stack, requestBody: req.body });
    res.status(500).json({ message: 'Internal server error during portfolio backtest', error: error.message });
  }
}; 