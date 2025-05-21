import { Request, Response } from 'express';
import { runBacktest } from './backtester'; // Основная логика бэктестинга
import { BacktestRunParameters, BacktestResult, StrategyParameters } from './backtester.types'; // Предполагается, что эти типы определены или будут определены
import { CandleData } from '../../interfaces/marketData.interface'; // Исправленный путь
import { getDefaultStrategyParameters } from '../../config/defaultStrategyParameters'; // Исправленный путь
import { dataService } from '../../services/dataService'; // <-- Импорт dataService
import logger from '../../utils/logger'; // <-- Импорт logger

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

    // Загрузка исторических данных
    logger.info(`[BacktesterCtrl] Fetching candles for ${incomingParams.pairSymbol}, ${incomingParams.timeframe} from ${new Date(startTimestamp)} to ${new Date(endTimestamp)}`);
    const candlesFromDB = await dataService.getCandles(incomingParams.pairSymbol, incomingParams.timeframe, startTimestamp, endTimestamp);

    if (!candlesFromDB || candlesFromDB.length === 0) {
      logger.warn(`[BacktesterCtrl] No candles found for ${incomingParams.pairSymbol} (${incomingParams.timeframe}) in the given range.`);
      res.status(404).json({ message: `No candles found for ${incomingParams.pairSymbol} (${incomingParams.timeframe}) in the specified date range.` });
      return;
    }
    logger.info(`[BacktesterCtrl] Fetched ${candlesFromDB.length} candles from DB.`);

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