import { CandleData } from '../strategy_logic/indicators';
import { applyStrategyLogic, StrategyParameters, StrategyCandle, RiskManagementSettings } from '../strategy_logic/strategy';
import {
  BacktestRunParameters,
  BacktestResult,
  BacktestMetrics,
  Trade,
  TradeDirection,
} from './backtester.types';
import { v4 as uuidv4 } from 'uuid';
import logger from '../../utils/logger';

// TODO: Переместить в utils или использовать библиотеку для генерации ID, если uuid не доступен в Node.js по умолчанию без доп. настроек
// import {战略生成Id} from '../../utils/idGenerator'; 

// Вспомогательная функция для расчета размера позиции
const calculatePositionSize = (
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
    logger.debug('[RunBacktest] Strategy Parameters (raw):', params.strategyParameters);
    logger.debug('[RunBacktest] Strategy Parameters (JSON): ' + JSON.stringify(params.strategyParameters, null, 2));
    if (params.strategyParameters.risk) {
      logger.debug('[RunBacktest] Risk Settings (raw):', params.strategyParameters.risk);
      logger.debug('[RunBacktest] Risk Settings (JSON): ' + JSON.stringify(params.strategyParameters.risk, null, 2));
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
  logger.debug(`[RunBacktest] Initial equity point: ${JSON.stringify(equityCurve[0])}`);

  // 3. Итерация по свечам для симуляции торговли
  logger.info(`[RunBacktest] Starting simulation loop over ${strategyCandles.length} strategy candles.`);
  for (let i = 0; i < strategyCandles.length; i++) {
    const currentCandle = strategyCandles[i];
    const prevCandle = i > 0 ? strategyCandles[i - 1] : null;

    if (i < 5 || i > strategyCandles.length - 5) {
        logger.debug(`[RunBacktest-Loop ${i}] Candle TS: ${currentCandle.timestamp}, O: ${currentCandle.open}, H: ${currentCandle.high}, L: ${currentCandle.low}, C: ${currentCandle.close}, V: ${currentCandle.volume}, ATR: ${currentCandle.atr}, EntryL: ${currentCandle.entryConditionLong}, EntryS: ${currentCandle.entryConditionShort}`);
    }

    // Логика управления рисками и размером позиции
    const riskSettings = params.strategyParameters?.risk; 
    
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
        logger.info(`[RunBacktest-TradeClose] ID: ${activeTrade.id}, PnL: ${pnl.toFixed(2)}, Capital: ${currentCapital.toFixed(2)}`);
        
        // Обновление пикового капитала и максимальной просадки
        peakCapital = Math.max(peakCapital, currentCapital);
        const drawdown = peakCapital > 0 ? ((peakCapital - currentCapital) / peakCapital) * 100 : 0;
        maxDrawdown = Math.max(maxDrawdown, drawdown);

        trades.push({ ...activeTrade });
        // Добавляем точку в кривую эквити после закрытия сделки
        if (activeTrade.exitTimestamp) {
          equityCurve.push({ timestamp: activeTrade.exitTimestamp, capital: currentCapital });
        }
        logger.info(`[RunBacktest-TradeClose][${new Date(activeTrade.exitTimestamp!).toISOString()}] Closed ${activeTrade.direction} trade. Entry: ${activeTrade.entryPrice}, Exit: ${activeTrade.exitPrice}, Size: ${activeTrade.size}, SL: ${activeTrade.stopLoss}, TP: ${activeTrade.takeProfit}, Reason: ${activeTrade.exitReason}, PnL: ${activeTrade.pnl?.toFixed(2)}, Capital: ${currentCapital.toFixed(2)}`);
        activeTrade = null;
      }
    }

    // Проверка условий входа и открытие новых сделок
    if (!activeTrade) {
      // logger.debug(`[RunBacktest-Loop ${i}] No active trade. Checking entry conditions...`);
      let entryPrice = 0;
      let positionSize = 0;
      let newTrade: Trade | null = null;
      let calculatedSl: number | undefined = undefined;
      let calculatedTp: number | undefined = undefined;

      if (currentCandle.entryConditionLong) {
        logger.debug(`[RunBacktest-Loop ${i}] EntryConditionLong met.`);
        entryPrice = currentCandle.close; // Пример: вход по цене закрытия сигнальной свечи
        positionSize = calculatePositionSize(currentCapital, entryPrice, currentCandle, riskSettings);
        logger.debug(`[RunBacktest-Loop ${i}] Calculated position size for LONG: ${positionSize}`);

        if (typeof currentCandle.timestamp === 'number') {
            if (positionSize > 0 && 
                riskSettings && 
                typeof currentCandle.atr === 'number' && 
                currentCandle.atr > 0 && 
                typeof riskSettings.stopLossMultiplier === 'number' &&
                typeof riskSettings.takeProfitMultiplier === 'number'
            ) {
              const atrValue: number = currentCandle.atr;
              const slMultiplier: number = riskSettings.stopLossMultiplier;
              const tpMultiplier: number = riskSettings.takeProfitMultiplier;

              calculatedSl = entryPrice - atrValue * slMultiplier;
              calculatedTp = entryPrice + atrValue * tpMultiplier;
              logger.debug(`[RunBacktest-Loop ${i}] For LONG: Entry=${entryPrice}, ATR=${atrValue}, SLMult=${slMultiplier}, TPMult=${tpMultiplier} => SL=${calculatedSl}, TP=${calculatedTp}`);

              newTrade = {
                id: uuidv4(),
                direction: TradeDirection.LONG,
                entryTimestamp: currentCandle.timestamp,
                entryPrice,
                size: positionSize,
                stopLoss: calculatedSl,
                takeProfit: calculatedTp,
                entryReason: 'Long Signal',
              };
            }
        } else {
            logger.warn(`[RunBacktest-Loop ${i}] Candle (index ${i}, time: ${new Date(currentCandle.timestamp ?? 0).toISOString()}) missing or invalid timestamp. Cannot create Long trade.`);
        }
      } else if (currentCandle.entryConditionShort) {
        // Аналогично для короткой позиции
        // logger.debug(`[RunBacktest-Loop ${i}] EntryConditionShort met.`);
        entryPrice = currentCandle.close;
        positionSize = calculatePositionSize(currentCapital, entryPrice, currentCandle, riskSettings);
        logger.debug(`[RunBacktest-Loop ${i}] Calculated position size for SHORT: ${positionSize}`);

        if (typeof currentCandle.timestamp === 'number') {
            if (positionSize > 0 && 
                riskSettings && 
                typeof currentCandle.atr === 'number' && 
                currentCandle.atr > 0 && 
                typeof riskSettings.stopLossMultiplier === 'number' &&
                typeof riskSettings.takeProfitMultiplier === 'number'
            ) {
                const atrValue: number = currentCandle.atr;
                const slMultiplier: number = riskSettings.stopLossMultiplier;
                const tpMultiplier: number = riskSettings.takeProfitMultiplier;

                calculatedSl = entryPrice + atrValue * slMultiplier;
                calculatedTp = entryPrice - atrValue * tpMultiplier;
                logger.debug(`[RunBacktest-Loop ${i}] For SHORT: Entry=${entryPrice}, ATR=${atrValue}, SLMult=${slMultiplier}, TPMult=${tpMultiplier} => SL=${calculatedSl}, TP=${calculatedTp}`);

                newTrade = {
                  id: uuidv4(),
                  direction: TradeDirection.SHORT,
                  entryTimestamp: currentCandle.timestamp,
                  entryPrice,
                  size: positionSize,
                  stopLoss: calculatedSl,
                  takeProfit: calculatedTp,
                  entryReason: 'Short Signal',
                };
            }
        } else {
            logger.warn(`[RunBacktest-Loop ${i}] Candle (index ${i}, time: ${new Date(currentCandle.timestamp ?? 0).toISOString()}) missing or invalid timestamp. Cannot create Short trade.`);
        }
      }

      if (newTrade && typeof currentCandle.timestamp === 'number') {
        activeTrade = newTrade;
        trades.push({ ...activeTrade });
        // Добавляем точку в кривую эквити при открытии сделки
        equityCurve.push({ timestamp: activeTrade.entryTimestamp, capital: currentCapital }); // Капитал еще не изменился
        // console.log(`[${new Date(activeTrade.entryTimestamp).toISOString()}] Opened ${activeTrade.direction} trade. Entry: ${activeTrade.entryPrice}, Size: ${activeTrade.size}, SL: ${activeTrade.stopLoss}, TP: ${activeTrade.takeProfit}`);
        logger.info(`[RunBacktest-TradeOpen][${new Date(activeTrade.entryTimestamp).toISOString()}] Opened ${activeTrade.direction} trade. Entry: ${activeTrade.entryPrice}, Size: ${activeTrade.size}, SL: ${activeTrade.stopLoss}, TP: ${activeTrade.takeProfit}, Capital (before trade): ${currentCapital.toFixed(2)}`);
      }
    } else {
      // Обновляем кривую эквити на каждой свече, если нет активной сделки или сделка не была закрыта/открыта на этой свече
      // Это нужно, чтобы кривая эквити отражала текущий капитал даже без сделок
      // Проверяем, что последняя точка в кривой не на этой же свече (избегаем дубликатов)
      if (currentCandle.timestamp && equityCurve[equityCurve.length - 1]?.timestamp !== currentCandle.timestamp) {
        equityCurve.push({ timestamp: currentCandle.timestamp, capital: currentCapital });
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
  
  logger.debug(`[RunBacktest-Metrics] Calculated: totalPnl=${totalPnl.toFixed(2)}, totalPnlPercentage=${totalPnlPercentage.toFixed(2)}%, totalTrades=${trades.length}, winRate=${(winRate * 100).toFixed(2)}%, avgPnl=${averageTradePnl.toFixed(2)}, avgWin=${avgWinningTrade.toFixed(2)}, avgLoss=${avgLosingTrade.toFixed(2)}, expectancy=${expectancy.toFixed(2)}`);

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

// Вспомогательные функции (будут добавлены позже)
// const calculatePositionSize = (...) => { ... };
// const openLongTrade = (...) => { ... };
// const openShortTrade = (...) => { ... };
// const closeActiveTrade = (...) => { ... }; 