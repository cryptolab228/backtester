import { CandleData } from '../strategy_logic/indicators';
import { applyStrategyLogic, StrategyParameters, StrategyCandle, RiskManagementSettings } from '../strategy_logic/strategy';
import {
  BacktestRunParameters,
  BacktestResult,
  BacktestMetrics,
  Trade,
  TradeDirection,
  PortfolioBacktestRunParameters,
  PortfolioBacktestResult,
  PortfolioMetrics,
  PortfolioSettings,
  EquityDataPoint,
} from './backtester.types';
import { v4 as uuidv4 } from 'uuid';
import logger from '../../utils/logger';

// TODO: Переместить в utils или использовать библиотеку для генерации ID, если uuid не доступен в Node.js по умолчанию без доп. настроек
// import {战略生成Id} from '../../utils/idGenerator'; 

// Вспомогательная функция для расчета размера позиции
export const calculatePositionSize = (
  currentCapital: number,
  entryPrice: number,
  currentCandle: StrategyCandle, // Добавлена текущая свеча для доступа к ATR
  riskSettings?: RiskManagementSettings
): number => {
  // logger.debug(`[CalcPosSize] Input: capital=${currentCapital}, entryPrice=${entryPrice}, ATR=${currentCandle.atr}`, riskSettings);
  if (!riskSettings) {
    logger.debug('[CalcPosSize] No risk settings, returning default size 1.');
    return 1; 
  }

  // Вариант 2: На основе риска ATR (приоритетный, если есть все данные)
  if (
    riskSettings.maxRiskPerTradePercentage &&
    riskSettings.maxRiskPerTradePercentage > 0 &&
    riskSettings.stopLossMultiplier &&
    riskSettings.stopLossMultiplier > 0 &&
    currentCandle.atr &&
    currentCandle.atr > 0 &&
    entryPrice > 0 
  ) {
    const riskPerTradeCapital = currentCapital * riskSettings.maxRiskPerTradePercentage;
    const atrBasedStopLossAmountPerUnit = currentCandle.atr * riskSettings.stopLossMultiplier;
    // logger.debug(`[CalcPosSize-ATR] riskCapital=${riskPerTradeCapital}, slAmountPerUnit=${atrBasedStopLossAmountPerUnit}`);

    if (atrBasedStopLossAmountPerUnit > 0) {
      const size = riskPerTradeCapital / atrBasedStopLossAmountPerUnit;
      logger.debug(`[CalcPosSize-ATR] Calculated size: ${size}`);
      return Math.max(0, size > 0 ? size : 0); 
    }
  }

  // Вариант 1: Процент от капитала (используется, если Вариант 2 не сработал)
  if (riskSettings.positionSizePercentage && riskSettings.positionSizePercentage > 0 && entryPrice > 0) {
    const capitalToRiskForPosition = currentCapital * riskSettings.positionSizePercentage;
    const size = capitalToRiskForPosition / entryPrice;
    logger.debug(`[CalcPosSize-Capital%] capitalToRisk=${capitalToRiskForPosition}, calculated size: ${size}`);
    return Math.max(0, size > 0 ? size : 0);
  }

  logger.debug('[CalcPosSize] No suitable method found or data invalid, returning default size 1.');
  return 1; 
};

// Основная функция для проведения бэктеста
export const runBacktest = async (
  params: BacktestRunParameters,
  candles: CandleData[] // Пока принимаем свечи напрямую, позже будем загружать из БД
): Promise<BacktestResult> => {
  logger.info(`[RunBacktest] Starting for ${params.pairSymbol} on ${params.timeframe}. Candles received: ${candles.length}`);
  
  // Изменяем способ логирования, чтобы точно увидеть содержимое
  if (params.strategyParameters) {
    // logger.debug('[RunBacktest] Strategy Parameters (raw):', params.strategyParameters);
    // logger.debug('[RunBacktest] Strategy Parameters (JSON): ' + JSON.stringify(params.strategyParameters, null, 2));
    if (params.strategyParameters.risk) {
      // logger.debug('[RunBacktest] Risk Settings (raw):', params.strategyParameters.risk);
      // logger.debug('[RunBacktest] Risk Settings (JSON): ' + JSON.stringify(params.strategyParameters.risk, null, 2));
    } else {
      logger.warn('[RunBacktest] Risk settings are missing within strategyParameters.');
    }
  } else {
    logger.error('[RunBacktest] strategyParameters is undefined or null on entry to runBacktest function!');
  }

  const startTime = Date.now();

  // 1. Применить логику стратегии ко всем свечам
  logger.info('[RunBacktest] Applying strategy logic...');
  const strategyLogicResult = applyStrategyLogic(candles, params.strategyParameters);
  const { strategyCandles, volumeProfile } = strategyLogicResult;
  logger.info(`[RunBacktest] Strategy logic applied. StrategyCandles count: ${strategyCandles?.length ?? 0}`);

  // Добавим детальное логирование первых и последних нескольких strategyCandles
  if (strategyCandles && strategyCandles.length > 0) {
    const logCount = Math.min(5, strategyCandles.length);
    // logger.debug('[RunBacktest] First few strategy candles:');
    // for (let k = 0; k < logCount; k++) {
    //   logger.debug(`[Candle-${k}] ${JSON.stringify(strategyCandles[k])}`);
    // }
    // if (strategyCandles.length > logCount * 2) { // Если свечей много, логируем и последние
    //   logger.debug('[RunBacktest] Last few strategy candles:');
    //   for (let k = strategyCandles.length - logCount; k < strategyCandles.length; k++) {
    //     logger.debug(`[Candle-${k}] ${JSON.stringify(strategyCandles[k])}`);
    //   }
    // }
  } else {
    logger.warn('[RunBacktest] No strategy candles available after applyStrategyLogic.');
  }

  if (!strategyCandles || strategyCandles.length === 0) {
    logger.warn('[RunBacktest] No strategy candles generated or returned empty. Aborting.');
    // Возвращаем пустой результат, если нет свечей или они не обработаны
    const emptyMetrics: BacktestMetrics = {
      totalPnl: 0,
      totalPnlPercentage: 0,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      maxDrawdown: 0,
      profitFactor: 0,
      initialCapital: params.initialCapital,
      finalCapital: params.initialCapital,
      grossProfit: 0,
      grossLoss: 0,
      averageTradePnl: 0,
      avgWinningTrade: 0,
      avgLosingTrade: 0,
      expectancy: 0,
      equityCurve: [{ timestamp: new Date(params.startDate).getTime() || Date.now(), capital: params.initialCapital }],
      durationMs: Date.now() - startTime,
    };
    return {
      configUsed: params,
      metrics: emptyMetrics,
      trades: [],
      strategyCandles: [],
    };
  }

  // 2. Инициализация переменных для бэктестинга
  const trades: Trade[] = [];
  let currentCapital = params.initialCapital;
  let activeTrade: Trade | null = null;
  let peakCapital = params.initialCapital;
  let maxDrawdown = 0;
  const equityCurve: Array<{ timestamp: number; capital: number }> = [
    { timestamp: candles[0]?.timestamp ?? new Date(params.startDate).getTime() ?? 0, capital: params.initialCapital }
  ];
  // logger.debug(`[RunBacktest] Initial equity point: ${JSON.stringify(equityCurve[0])}`);

  // 3. Итерация по свечам для симуляции торговли
  logger.info(`[RunBacktest] Starting simulation loop over ${strategyCandles.length} strategy candles.`);
  for (let i = 0; i < strategyCandles.length; i++) {
    const currentCandle = strategyCandles[i];
    const prevCandle = i > 0 ? strategyCandles[i - 1] : null;

    // if (i < 5 || i > strategyCandles.length - 5) {
    //     logger.debug(`[RunBacktest-Loop ${i}] Candle TS: ${currentCandle.timestamp}, O: ${currentCandle.open}, H: ${currentCandle.high}, L: ${currentCandle.low}, C: ${currentCandle.close}, V: ${currentCandle.volume}, ATR: ${currentCandle.atr}, EntryL: ${currentCandle.entryConditionLong}, EntryS: ${currentCandle.entryConditionShort}`);
    // }

    // Логика управления рисками и размером позиции
    const riskSettings = params.strategyParameters?.risk;
    
    // Закрытие активной сделки
    if (activeTrade) {
      let exitReason: string | undefined = undefined;
      let exitPrice: number | undefined = undefined;

      // Проверка Stop Loss
      if (activeTrade.direction === TradeDirection.LONG && activeTrade.stopLoss && currentCandle.low <= activeTrade.stopLoss) {
        exitReason = 'SL';
        exitPrice = activeTrade.stopLoss;
      } else if (activeTrade.direction === TradeDirection.SHORT && activeTrade.stopLoss && currentCandle.high >= activeTrade.stopLoss) {
        exitReason = 'SL';
        exitPrice = activeTrade.stopLoss;
      }

      // Проверка Take Profit (только если SL не сработал на этой же свече)
      if (!exitReason && activeTrade.takeProfit) {
        if (activeTrade.direction === TradeDirection.LONG && currentCandle.high >= activeTrade.takeProfit) {
          exitReason = 'TP';
          exitPrice = activeTrade.takeProfit;
        } else if (activeTrade.direction === TradeDirection.SHORT && currentCandle.low <= activeTrade.takeProfit) {
          exitReason = 'TP';
          exitPrice = activeTrade.takeProfit;
        }
      }
      
      // TODO: Добавить логику выхода по противоположному сигналу, если это требуется
      // TODO: Добавить логику трейлинг-стопа, если это требуется

      if (exitReason && exitPrice !== undefined && typeof currentCandle.timestamp === 'number') {
        activeTrade.exitTimestamp = currentCandle.timestamp;
        activeTrade.exitPrice = exitPrice;
        activeTrade.exitReason = exitReason;

        let pnl = 0;
        if (activeTrade.direction === TradeDirection.LONG) {
          pnl = (activeTrade.exitPrice - activeTrade.entryPrice) * activeTrade.size;
        } else { // SHORT
          pnl = (activeTrade.entryPrice - activeTrade.exitPrice) * activeTrade.size;
        }
        activeTrade.pnl = pnl;
        currentCapital += pnl;
        // logger.info(`[RunBacktest-TradeClose] ID: ${activeTrade.id}, PnL: ${pnl.toFixed(2)}, Capital: ${currentCapital.toFixed(2)}`);
        
        peakCapital = Math.max(peakCapital, currentCapital);
        const drawdown = peakCapital > 0 ? ((peakCapital - currentCapital) / peakCapital) * 100 : 0;
        maxDrawdown = Math.max(maxDrawdown, drawdown);

        trades.push({ ...activeTrade });
        if (activeTrade.exitTimestamp) {
          equityCurve.push({ timestamp: activeTrade.exitTimestamp, capital: currentCapital });
          // logger.info(`[RunBacktest-TradeClose][${new Date(activeTrade.exitTimestamp).toISOString()}] Closed ${activeTrade.direction} trade. Entry: ${activeTrade.entryPrice}, Exit: ${activeTrade.exitPrice}, Size: ${activeTrade.size}, SL: ${activeTrade.stopLoss}, TP: ${activeTrade.takeProfit}, Reason: ${activeTrade.exitReason}, PnL: ${activeTrade.pnl?.toFixed(2)}, Capital: ${currentCapital.toFixed(2)}`);
        }
        activeTrade = null;
      }
    } else {
      // Открытие новой сделки
      let direction: TradeDirection | undefined = undefined;
      if (currentCandle.entryConditionLong) {
        direction = TradeDirection.LONG;
      } else if (currentCandle.entryConditionShort) {
        direction = TradeDirection.SHORT;
      }

      if (direction && currentCandle.atr && currentCandle.atr > 0) {
        const entryPrice = currentCandle.close; // Вход по цене закрытия свечи сигнала
        const positionSize = calculatePositionSize(currentCapital, entryPrice, currentCandle, riskSettings);

        if (positionSize > 0) {
          let stopLossPrice: number | undefined;
          let takeProfitPrice: number | undefined;
          const atrForTrade = currentCandle.atr;

          if (riskSettings?.stopLossMultiplier && atrForTrade > 0) {
            if (direction === TradeDirection.LONG) {
              stopLossPrice = currentCandle.low - atrForTrade * riskSettings.stopLossMultiplier; // От Low свечи сигнала
            } else { // SHORT
              stopLossPrice = currentCandle.high + atrForTrade * riskSettings.stopLossMultiplier; // От High свечи сигнала
            }
          }

          if (riskSettings?.takeProfitMultiplier && atrForTrade > 0) {
            if (direction === TradeDirection.LONG) {
              // takeProfitPrice = entryPrice + atrForTrade * riskSettings.takeProfitMultiplier; // Старая логика от entryPrice
              takeProfitPrice = currentCandle.close + atrForTrade * riskSettings.takeProfitMultiplier; // Новая логика от Close свечи сигнала (аналогично Pine)
            } else { // SHORT
              // takeProfitPrice = entryPrice - atrForTrade * riskSettings.takeProfitMultiplier; // Старая логика от entryPrice
              takeProfitPrice = currentCandle.close - atrForTrade * riskSettings.takeProfitMultiplier; // Новая логика от Close свечи сигнала (аналогично Pine)
            }
          }

          const newTradeId = uuidv4();
          activeTrade = {
            id: newTradeId,
            pair: params.pairSymbol,
            direction: direction,
            entryTimestamp: currentCandle.timestamp,
            entryPrice,
            size: positionSize,
            stopLoss: stopLossPrice,
            takeProfit: takeProfitPrice,
            status: 'active',
          };
          // logger.info(`[RunBacktest-TradeOpen][${new Date(activeTrade.entryTimestamp).toISOString()}] New ${activeTrade.direction} trade opened. Price: ${activeTrade.entryPrice}, Size: ${activeTrade.size}, SL: ${activeTrade.stopLoss}, TP: ${activeTrade.takeProfit}`);
        } else {
          logger.warn(`[RunBacktest-Loop ${i}] Position size is 0 or less, no trade opened.`);
        }
      }
    }
  }
  logger.info('[RunBacktest] Simulation loop finished.');

  // 4. Расчет итоговых метрик
  const finalCapital = currentCapital;
  const totalPnl = finalCapital - params.initialCapital;
  const totalPnlPercentage = params.initialCapital > 0 ? (totalPnl / params.initialCapital) * 100 : 0;
  const winningTradesCount = trades.filter(t => t.pnl && t.pnl > 0).length;
  const losingTradesCount = trades.filter(t => t.pnl && t.pnl < 0).length;
  const winRate = trades.length > 0 ? winningTradesCount / trades.length : 0;
  
  const grossProfit = trades.filter(t => t.pnl && t.pnl > 0).reduce((sum, t) => sum + (t.pnl || 0), 0);
  const grossLoss = Math.abs(trades.filter(t => t.pnl && t.pnl < 0).reduce((sum, t) => sum + (t.pnl || 0), 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);

  let averageTradePnl = 0;
  let avgWinningTrade = 0;
  let avgLosingTrade = 0;
  let expectancy = 0;

  if (trades.length > 0) {
    averageTradePnl = totalPnl / trades.length;
    const winningPnlArray = trades.filter(t => t.pnl && t.pnl > 0).map(t => t.pnl || 0);
    const losingPnlArray = trades.filter(t => t.pnl && t.pnl < 0).map(t => t.pnl || 0);
    
    if (winningTradesCount > 0) {
      avgWinningTrade = winningPnlArray.reduce((sum, pnl) => sum + pnl, 0) / winningTradesCount;
    }
    if (losingTradesCount > 0) {
      avgLosingTrade = Math.abs(losingPnlArray.reduce((sum, pnl) => sum + pnl, 0) / losingTradesCount);
    }
    // Expectancy = (Win Rate * Average Win) - (Loss Rate * Average Loss)
    const lossRate = 1 - winRate;
    expectancy = (winRate * avgWinningTrade) - (lossRate * avgLosingTrade);
  } else {
    // Если сделок нет, все эти метрики равны 0, что было установлено при инициализации
  }
  
  // logger.debug(`[RunBacktest-Metrics] Calculated: totalPnl=${totalPnl.toFixed(2)}, totalPnlPercentage=${totalPnlPercentage.toFixed(2)}%, totalTrades=${trades.length}, winRate=${(winRate * 100).toFixed(2)}%, avgPnl=${averageTradePnl.toFixed(2)}, avgWin=${avgWinningTrade.toFixed(2)}, avgLoss=${avgLosingTrade.toFixed(2)}, expectancy=${expectancy.toFixed(2)}`);

  const metrics: BacktestMetrics = {
    totalPnl,
    totalPnlPercentage,
    totalTrades: trades.length,
    winningTrades: winningTradesCount,
    losingTrades: losingTradesCount,
    winRate,
    maxDrawdown,
    profitFactor,
    initialCapital: params.initialCapital,
    finalCapital: currentCapital,
    grossProfit,
    grossLoss,
    averageTradePnl,
    avgWinningTrade,
    avgLosingTrade,
    expectancy,
    equityCurve,
    durationMs: Date.now() - startTime,
  };

  logger.info(`[RunBacktest] Finished. Total Trades: ${metrics.totalTrades}, PnL: ${metrics.totalPnl.toFixed(2)} (${metrics.totalPnlPercentage.toFixed(2)}%). Duration: ${metrics.durationMs}ms`);

  return {
    configUsed: params,
    metrics,
    trades,
    strategyCandles: strategyCandles, // Возвращаем обработанные свечи
  };
};

// === НОВАЯ ФУНКЦИЯ: МУЛЬТИ-БЕКТЕСТЕР (ПОРТФЕЛЬНЫЙ БЕКТЕСТЕР) ===

/**
 * Вспомогательный интерфейс для синхронизированной свечи
 */
interface SynchronizedCandle extends StrategyCandle {
  pairSymbol: string; // Добавляем информацию о паре
}

/**
 * Вспомогательный интерфейс для потенциального сигнала
 */
interface PotentialSignal {
  pairSymbol: string;
  direction: TradeDirection;
  signalStrength: number;
  candle: StrategyCandle;
}

/**
 * Функция для проведения портфельного бэктеста на нескольких торговых парах
 * @param params Параметры портфельного бэктеста
 * @param candlesByPair Свечи для каждой пары: Record<pairSymbol, CandleData[]>
 * @returns Результат портфельного бэктеста
 */
export const runPortfolioBacktest = async (
  params: PortfolioBacktestRunParameters,
  candlesByPair: Record<string, CandleData[]>
): Promise<PortfolioBacktestResult> => {
  const startTime = Date.now();
  logger.info(`[RunPortfolioBacktest] Starting portfolio backtest for ${params.pairSymbols.length} pairs: ${params.pairSymbols.join(', ')}`);

  // 1. Валидация входных данных
  if (!params.pairSymbols || params.pairSymbols.length === 0) {
    throw new Error('No pair symbols provided for portfolio backtest');
  }

  if (params.initialPortfolioCapital <= 0) {
    throw new Error('Initial portfolio capital must be positive');
  }

  // Проверяем, что для всех пар есть данные
  for (const pairSymbol of params.pairSymbols) {
    if (!candlesByPair[pairSymbol] || candlesByPair[pairSymbol].length === 0) {
      logger.warn(`[RunPortfolioBacktest] No candles found for pair ${pairSymbol}`);
    }
  }

  // 2. Применяем логику стратегии к каждой паре индивидуально
  const strategyCandlesByPair: Record<string, StrategyCandle[]> = {};
  
  for (const pairSymbol of params.pairSymbols) {
    const candles = candlesByPair[pairSymbol] || [];
    if (candles.length > 0) {
      logger.info(`[RunPortfolioBacktest] Applying strategy logic to ${pairSymbol} (${candles.length} candles)`);
      const strategyResult = applyStrategyLogic(candles, params.strategyParameters);
      strategyCandlesByPair[pairSymbol] = strategyResult.strategyCandles;
    } else {
      strategyCandlesByPair[pairSymbol] = [];
    }
  }

  // 3. Создаем синхронизированный поток всех свечей, отсортированный по времени
  const allSynchronizedCandles: SynchronizedCandle[] = [];
  
  for (const pairSymbol of params.pairSymbols) {
    const strategyCandles = strategyCandlesByPair[pairSymbol] || [];
    for (const candle of strategyCandles) {
      allSynchronizedCandles.push({
        ...candle,
        pairSymbol,
      });
    }
  }

  // Сортируем все свечи по timestamp для хронологической обработки
  allSynchronizedCandles.sort((a, b) => a.timestamp - b.timestamp);
  logger.info(`[RunPortfolioBacktest] Created synchronized stream of ${allSynchronizedCandles.length} candles`);

  // 4. Инициализация переменных для портфельного бэктестинга
  const tradesByPair: Record<string, Trade[]> = {};
  let currentPortfolioCapital = params.initialPortfolioCapital;
  const activeTradesPortfolio: Map<string, Trade> = new Map(); // Ключ = pairSymbol
  let peakPortfolioCapital = params.initialPortfolioCapital;
  let maxPortfolioDrawdown = 0;
  const portfolioEquityCurve: EquityDataPoint[] = [
    { timestamp: allSynchronizedCandles[0]?.timestamp || new Date(params.startDate).getTime(), capital: params.initialPortfolioCapital }
  ];

  // Инициализируем массивы сделок для каждой пары
  for (const pairSymbol of params.pairSymbols) {
    tradesByPair[pairSymbol] = [];
  }

  // Настройки портфеля
  const maxConcurrentTrades = params.portfolioSettings?.maxConcurrentTradesPortfolio || Infinity;
  
  // Метрики для отслеживания одновременных сделок
  let totalConcurrentTradesSum = 0;
  let concurrentTradesCount = 0;
  let peakConcurrentTrades = 0;

  // 5. Основной цикл портфельного бэктестинга
  logger.info(`[RunPortfolioBacktest] Starting simulation loop over ${allSynchronizedCandles.length} synchronized candles`);
  
  let currentTimestamp = -1;
  let pendingSignalsAtTimestamp: PotentialSignal[] = [];

  for (let i = 0; i < allSynchronizedCandles.length; i++) {
    const currentCandle = allSynchronizedCandles[i];
    const pairSymbol = currentCandle.pairSymbol;

    // Если это новый timestamp, обрабатываем накопленные сигналы с предыдущего timestamp
    if (currentCandle.timestamp !== currentTimestamp) {
      // Обрабатываем сигналы с предыдущего timestamp (если есть)
      if (pendingSignalsAtTimestamp.length > 0) {
        currentPortfolioCapital = await processPortfolioPendingSignals(
          pendingSignalsAtTimestamp,
          currentPortfolioCapital,
          activeTradesPortfolio,
          maxConcurrentTrades,
          tradesByPair,
          params.strategyParameters?.risk
        );
        pendingSignalsAtTimestamp = [];
      }
      
      currentTimestamp = currentCandle.timestamp;
    }

    // A. Закрытие активных сделок для текущей пары
    const activeTrade = activeTradesPortfolio.get(pairSymbol);
    if (activeTrade) {
      let exitReason: string | undefined = undefined;
      let exitPrice: number | undefined = undefined;

      // Проверка Stop Loss
      if (activeTrade.stopLoss !== undefined) {
        if (
          (activeTrade.direction === TradeDirection.LONG && currentCandle.low <= activeTrade.stopLoss) ||
          (activeTrade.direction === TradeDirection.SHORT && currentCandle.high >= activeTrade.stopLoss)
        ) {
          exitReason = 'SL';
          exitPrice = activeTrade.stopLoss;
        }
      }

      // Проверка Take Profit (если SL не сработал)
      if (!exitReason && activeTrade.takeProfit !== undefined) {
        if (
          (activeTrade.direction === TradeDirection.LONG && currentCandle.high >= activeTrade.takeProfit) ||
          (activeTrade.direction === TradeDirection.SHORT && currentCandle.low <= activeTrade.takeProfit)
        ) {
          exitReason = 'TP';
          exitPrice = activeTrade.takeProfit;
        }
      }

      // Если есть причина для закрытия, закрываем сделку
      if (exitReason && exitPrice !== undefined) {
        activeTrade.exitTimestamp = currentCandle.timestamp;
        activeTrade.exitPrice = exitPrice;
        activeTrade.exitReason = exitReason;

        // Расчет PnL
        let pnl = 0;
        if (activeTrade.direction === TradeDirection.LONG) {
          pnl = (activeTrade.exitPrice - activeTrade.entryPrice) * activeTrade.size;
        } else { // SHORT
          pnl = (activeTrade.entryPrice - activeTrade.exitPrice) * activeTrade.size;
        }
        activeTrade.pnl = pnl;
        currentPortfolioCapital += pnl;

        // Обновляем метрики drawdown
        peakPortfolioCapital = Math.max(peakPortfolioCapital, currentPortfolioCapital);
        const drawdown = peakPortfolioCapital > 0 ? ((peakPortfolioCapital - currentPortfolioCapital) / peakPortfolioCapital) * 100 : 0;
        maxPortfolioDrawdown = Math.max(maxPortfolioDrawdown, drawdown);

        // Добавляем сделку в результаты и удаляем из активных
        tradesByPair[pairSymbol].push({ ...activeTrade });
        activeTradesPortfolio.delete(pairSymbol);
        
        // Обновляем кривую эквити
        portfolioEquityCurve.push({ timestamp: activeTrade.exitTimestamp, capital: currentPortfolioCapital });

        logger.debug(`[RunPortfolioBacktest] Closed ${activeTrade.direction} trade for ${pairSymbol}. PnL: ${pnl.toFixed(2)}, Portfolio Capital: ${currentPortfolioCapital.toFixed(2)}`);
      }
    }

    // B. Сбор потенциальных сигналов на вход для текущей пары
    if (!activeTradesPortfolio.has(pairSymbol)) { // Только если нет активной сделки для этой пары
      let direction: TradeDirection | undefined = undefined;
      let signalStrength = 0;

      if (currentCandle.entryConditionLong && currentCandle.signalStrength !== null && currentCandle.signalStrength !== undefined && currentCandle.signalStrength > 0) {
        direction = TradeDirection.LONG;
        signalStrength = currentCandle.signalStrength;
      } else if (currentCandle.entryConditionShort && currentCandle.signalStrength !== null && currentCandle.signalStrength !== undefined && currentCandle.signalStrength > 0) {
        direction = TradeDirection.SHORT;
        signalStrength = currentCandle.signalStrength;
      }

      // Если есть сигнал, добавляем его в список ожидающих сигналов
      if (direction && signalStrength > 0) {
        pendingSignalsAtTimestamp.push({
          pairSymbol,
          direction,
          signalStrength,
          candle: currentCandle,
        });
        logger.debug(`[RunPortfolioBacktest] Found ${direction} signal for ${pairSymbol} with strength ${signalStrength}`);
      }
    }

    // C. Обновляем метрики одновременных сделок
    const currentActiveTrades = activeTradesPortfolio.size;
    totalConcurrentTradesSum += currentActiveTrades;
    concurrentTradesCount++;
    peakConcurrentTrades = Math.max(peakConcurrentTrades, currentActiveTrades);
  }

  // Обрабатываем последние накопленные сигналы
  if (pendingSignalsAtTimestamp.length > 0) {
    currentPortfolioCapital = await processPortfolioPendingSignals(
      pendingSignalsAtTimestamp,
      currentPortfolioCapital,
      activeTradesPortfolio,
      maxConcurrentTrades,
      tradesByPair,
      params.strategyParameters?.risk
    );
  }

  logger.info('[RunPortfolioBacktest] Simulation loop finished.');

  // 6. Расчет портфельных метрик
  const finalPortfolioCapital = currentPortfolioCapital;
  const totalPortfolioPnl = finalPortfolioCapital - params.initialPortfolioCapital;
  const totalPortfolioPnlPercentage = params.initialPortfolioCapital > 0 ? (totalPortfolioPnl / params.initialPortfolioCapital) * 100 : 0;

  // Собираем все сделки для расчета общих метрик
  const allTrades: Trade[] = [];
  for (const pairSymbol of params.pairSymbols) {
    allTrades.push(...tradesByPair[pairSymbol]);
  }

  const portfolioWinningTrades = allTrades.filter(t => t.pnl && t.pnl > 0).length;
  const portfolioLosingTrades = allTrades.filter(t => t.pnl && t.pnl < 0).length;
  const portfolioWinRate = allTrades.length > 0 ? portfolioWinningTrades / allTrades.length : 0;

  const portfolioGrossProfit = allTrades.filter(t => t.pnl && t.pnl > 0).reduce((sum, t) => sum + (t.pnl || 0), 0);
  const portfolioGrossLoss = Math.abs(allTrades.filter(t => t.pnl && t.pnl < 0).reduce((sum, t) => sum + (t.pnl || 0), 0));
  const portfolioProfitFactor = portfolioGrossLoss > 0 ? portfolioGrossProfit / portfolioGrossLoss : (portfolioGrossProfit > 0 ? Infinity : 0);

  const portfolioAverageTradePnl = allTrades.length > 0 ? totalPortfolioPnl / allTrades.length : 0;

  // Расчет Expectancy
  let portfolioExpectancy = 0;
  if (allTrades.length > 0) {
    const winningPnlArray = allTrades.filter(t => t.pnl && t.pnl > 0).map(t => t.pnl || 0);
    const losingPnlArray = allTrades.filter(t => t.pnl && t.pnl < 0).map(t => t.pnl || 0);
    
    const avgWinningTrade = portfolioWinningTrades > 0 ? winningPnlArray.reduce((sum, pnl) => sum + pnl, 0) / portfolioWinningTrades : 0;
    const avgLosingTrade = portfolioLosingTrades > 0 ? Math.abs(losingPnlArray.reduce((sum, pnl) => sum + pnl, 0) / portfolioLosingTrades) : 0;
    
    const lossRate = 1 - portfolioWinRate;
    portfolioExpectancy = (portfolioWinRate * avgWinningTrade) - (lossRate * avgLosingTrade);
  }

  // Расчет Sharpe Ratio (упрощенный, без risk-free rate)
  const sharpeRatioPortfolio = calculatePortfolioSharpeRatio(portfolioEquityCurve);

  // Расчет средних одновременных сделок
  const avgConcurrentTrades = concurrentTradesCount > 0 ? totalConcurrentTradesSum / concurrentTradesCount : 0;

  // 7. Расчет метрик для каждой пары отдельно
  const metricsByPair: Record<string, BacktestMetrics> = {};
  for (const pairSymbol of params.pairSymbols) {
    const pairTrades = tradesByPair[pairSymbol];
    metricsByPair[pairSymbol] = calculateIndividualPairMetrics(pairTrades, params.initialPortfolioCapital, startTime);
  }

  // 8. Формируем результат
  const overallMetrics: PortfolioMetrics = {
    totalPortfolioPnl,
    totalPortfolioPnlPercentage,
    totalPortfolioTrades: allTrades.length,
    portfolioWinningTrades,
    portfolioLosingTrades,
    portfolioWinRate,
    portfolioProfitFactor,
    portfolioMaxDrawdown: maxPortfolioDrawdown,
    portfolioGrossProfit,
    portfolioGrossLoss,
    portfolioAverageTradePnl,
    portfolioExpectancy,
    sharpeRatioPortfolio,
    avgConcurrentTrades,
    peakConcurrentTrades,
    initialPortfolioCapital: params.initialPortfolioCapital,
    finalPortfolioCapital,
    portfolioEquityCurve,
    durationMs: Date.now() - startTime,
  };

  logger.info(`[RunPortfolioBacktest] Finished. Total Portfolio Trades: ${allTrades.length}, Portfolio PnL: ${totalPortfolioPnl.toFixed(2)} (${totalPortfolioPnlPercentage.toFixed(2)}%). Duration: ${overallMetrics.durationMs}ms`);

  return {
    overallMetrics,
    tradesByPair,
    metricsByPair,
    configUsed: params,
    strategyCandlesByPair,
  };
};

// === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ МУЛЬТИ-БЕКТЕСТЕРА ===

/**
 * Обрабатывает ожидающие сигналы для портфеля, приоритизируя по силе сигнала
 * @returns Обновленный капитал портфеля
 */
async function processPortfolioPendingSignals(
  signals: PotentialSignal[],
  currentPortfolioCapital: number,
  activeTradesPortfolio: Map<string, Trade>,
  maxConcurrentTrades: number,
  tradesByPair: Record<string, Trade[]>,
  riskSettings?: RiskManagementSettings
): Promise<number> {
  let updatedCapital = currentPortfolioCapital;
  
  logger.debug(`[ProcessPortfolioSignals] Processing ${signals.length} signals with capital ${currentPortfolioCapital}`);
  
  // Сортируем сигналы по силе (по убыванию)
  signals.sort((a, b) => b.signalStrength - a.signalStrength);

  for (const signal of signals) {
    logger.debug(`[ProcessPortfolioSignals] Processing signal for ${signal.pairSymbol}: ${signal.direction}, strength: ${signal.signalStrength}`);
    
    // Проверяем лимит одновременных сделок
    if (activeTradesPortfolio.size >= maxConcurrentTrades) {
      logger.debug(`[ProcessPortfolioSignals] Max concurrent trades limit (${maxConcurrentTrades}) reached. Skipping remaining signals.`);
      break;
    }

    // Проверяем, что у нас есть ATR для расчета позиции
    if (!signal.candle.atr || signal.candle.atr <= 0) {
      logger.debug(`[ProcessPortfolioSignals] No valid ATR for ${signal.pairSymbol}. ATR: ${signal.candle.atr}. Skipping signal.`);
      continue;
    }

    const entryPrice = signal.candle.close;
    const positionSize = calculatePositionSize(updatedCapital, entryPrice, signal.candle, riskSettings);

    logger.debug(`[ProcessPortfolioSignals] Calculated position size for ${signal.pairSymbol}: ${positionSize}, entry price: ${entryPrice}, capital: ${updatedCapital}`);

    if (positionSize <= 0) {
      logger.debug(`[ProcessPortfolioSignals] Position size is 0 or negative for ${signal.pairSymbol}. Insufficient capital.`);
      continue;
    }

    // Рассчитываем SL и TP
    let stopLossPrice: number | undefined;
    let takeProfitPrice: number | undefined;
    const atrForTrade = signal.candle.atr;

    if (riskSettings?.stopLossMultiplier && atrForTrade > 0) {
      if (signal.direction === TradeDirection.LONG) {
        stopLossPrice = signal.candle.low - atrForTrade * riskSettings.stopLossMultiplier;
      } else { // SHORT
        stopLossPrice = signal.candle.high + atrForTrade * riskSettings.stopLossMultiplier;
      }
    }

    if (riskSettings?.takeProfitMultiplier && atrForTrade > 0) {
      if (signal.direction === TradeDirection.LONG) {
        takeProfitPrice = signal.candle.close + atrForTrade * riskSettings.takeProfitMultiplier;
      } else { // SHORT
        takeProfitPrice = signal.candle.close - atrForTrade * riskSettings.takeProfitMultiplier;
      }
    }

    // Создаем и открываем сделку
    const newTrade: Trade = {
      id: uuidv4(),
      pair: signal.pairSymbol,
      direction: signal.direction,
      entryTimestamp: signal.candle.timestamp,
      entryPrice,
      size: positionSize,
      stopLoss: stopLossPrice,
      takeProfit: takeProfitPrice,
      status: 'active',
    };

    activeTradesPortfolio.set(signal.pairSymbol, newTrade);
    logger.debug(`[ProcessPortfolioSignals] Opened ${signal.direction} trade for ${signal.pairSymbol}. Signal strength: ${signal.signalStrength.toFixed(2)}, Entry: ${entryPrice}, Size: ${positionSize}, SL: ${stopLossPrice}, TP: ${takeProfitPrice}`);

    // ИСПРАВЛЕНО: НЕ добавляем сделку в tradesByPair здесь - только после закрытия
    // Сделка будет добавлена в tradesByPair только когда закроется в основном цикле
  }

  logger.debug(`[ProcessPortfolioSignals] Finished processing signals. Active trades: ${activeTradesPortfolio.size}`);
  return updatedCapital;
}

/**
 * Рассчитывает упрощенный Sharpe Ratio для портфеля
 */
function calculatePortfolioSharpeRatio(equityCurve: EquityDataPoint[]): number {
  if (equityCurve.length < 2) return 0;

  // Рассчитываем дневные доходности
  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prevCapital = equityCurve[i - 1].capital;
    const currentCapital = equityCurve[i].capital;
    if (prevCapital > 0) {
      returns.push((currentCapital - prevCapital) / prevCapital);
    }
  }

  if (returns.length < 2) return 0;

  // Среднее и стандартное отклонение доходностей
  const meanReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length;
  const stdDeviation = Math.sqrt(variance);

  // Sharpe Ratio (без risk-free rate)
  return stdDeviation > 0 ? meanReturn / stdDeviation : 0;
}

/**
 * Рассчитывает метрики для отдельной пары в портфеле
 */
function calculateIndividualPairMetrics(trades: Trade[], initialCapital: number, startTime: number): BacktestMetrics {
  const totalTrades = trades.length;
  const winningTrades = trades.filter(t => t.pnl && t.pnl > 0).length;
  const losingTrades = trades.filter(t => t.pnl && t.pnl < 0).length;
  const winRate = totalTrades > 0 ? winningTrades / totalTrades : 0;

  const totalPnl = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const totalPnlPercentage = initialCapital > 0 ? (totalPnl / initialCapital) * 100 : 0;

  const grossProfit = trades.filter(t => t.pnl && t.pnl > 0).reduce((sum, t) => sum + (t.pnl || 0), 0);
  const grossLoss = Math.abs(trades.filter(t => t.pnl && t.pnl < 0).reduce((sum, t) => sum + (t.pnl || 0), 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);

  const averageTradePnl = totalTrades > 0 ? totalPnl / totalTrades : 0;

  let avgWinningTrade = 0;
  let avgLosingTrade = 0;
  if (winningTrades > 0) {
    avgWinningTrade = grossProfit / winningTrades;
  }
  if (losingTrades > 0) {
    avgLosingTrade = grossLoss / losingTrades;
  }

  const lossRate = 1 - winRate;
  const expectancy = (winRate * avgWinningTrade) - (lossRate * avgLosingTrade);

  // Упрощенная кривая эквити для отдельной пары
  const equityCurve: Array<{ timestamp: number; capital: number }> = [];
  let runningCapital = initialCapital;
  for (const trade of trades) {
    if (trade.exitTimestamp) {
      runningCapital += (trade.pnl || 0);
      equityCurve.push({ timestamp: trade.exitTimestamp, capital: runningCapital });
    }
  }

  // Упрощенный расчет максимальной просадки для пары
  let maxDrawdown = 0;
  let peakCapital = initialCapital;
  for (const point of equityCurve) {
    peakCapital = Math.max(peakCapital, point.capital);
    const drawdown = peakCapital > 0 ? ((peakCapital - point.capital) / peakCapital) * 100 : 0;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
  }

  return {
    totalPnl,
    totalPnlPercentage,
    totalTrades,
    winningTrades,
    losingTrades,
    winRate,
    maxDrawdown,
    profitFactor,
    initialCapital,
    finalCapital: initialCapital + totalPnl,
    grossProfit,
    grossLoss,
    averageTradePnl,
    avgWinningTrade,
    avgLosingTrade,
    expectancy,
    equityCurve,
    durationMs: Date.now() - startTime,
  };
}

// Вспомогательные функции (будут добавлены позже)
// const calculatePositionSize = (...) => { ... };
// const openLongTrade = (...) => { ... };
// const openShortTrade = (...) => { ... };
// const closeActiveTrade = (...) => { ... }; 