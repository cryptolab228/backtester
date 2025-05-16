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

// TODO: Переместить в utils или использовать библиотеку для генерации ID, если uuid не доступен в Node.js по умолчанию без доп. настроек
// import {战略生成Id} from '../../utils/idGenerator'; 

// Вспомогательная функция для расчета размера позиции
const calculatePositionSize = (
  currentCapital: number,
  entryPrice: number,
  currentCandle: StrategyCandle, // Добавлена текущая свеча для доступа к ATR
  riskSettings?: RiskManagementSettings
): number => {
  if (!riskSettings) {
    return 1; // Размер по умолчанию, если настройки риска отсутствуют
  }

  // Вариант 2: На основе риска ATR (приоритетный, если есть все данные)
  if (
    riskSettings.maxRiskPerTradePercentage &&
    riskSettings.maxRiskPerTradePercentage > 0 &&
    riskSettings.stopLossMultiplier &&
    riskSettings.stopLossMultiplier > 0 &&
    currentCandle.atr &&
    currentCandle.atr > 0 &&
    entryPrice > 0 // Убедимся, что цена входа валидна
  ) {
    const riskPerTradeCapital = currentCapital * riskSettings.maxRiskPerTradePercentage;
    // Сумма, которую мы готовы потерять на одну единицу контракта/акции, если сработает SL
    const atrBasedStopLossAmountPerUnit = currentCandle.atr * riskSettings.stopLossMultiplier;

    if (atrBasedStopLossAmountPerUnit > 0) {
      const size = riskPerTradeCapital / atrBasedStopLossAmountPerUnit;
      // Важно: на данном этапе мы не учитываем комиссию или минимальный размер лота.
      // Также, размер позиции здесь это количество "единиц", PnL потом будет (цена выхода - цена входа) * размер.
      // Необходимо убедиться, что у нас достаточно капитала для такой позиции,
      // но т.к. currentCapital используется для расчета риска, это косвенно учтено.
      // Для фьючерсов может потребоваться более сложный расчет с учетом плеча и маржи.
      // Пока оставляем так для простоты.
      return Math.max(0, size > 0 ? size : 0); // Возвращаем 0, если расчетный размер <= 0
    }
  }

  // Вариант 1: Процент от капитала (используется, если Вариант 2 не сработал)
  if (riskSettings.positionSizePercentage && riskSettings.positionSizePercentage > 0 && entryPrice > 0) {
    const capitalToRiskForPosition = currentCapital * riskSettings.positionSizePercentage;
    const size = capitalToRiskForPosition / entryPrice;
    return Math.max(0, size > 0 ? size : 0);
  }

  return 1; // Размер по умолчанию, если ни один из методов не сработал или данные некорректны
};

// Основная функция для проведения бэктеста
export const runBacktest = async (
  params: BacktestRunParameters,
  candles: CandleData[] // Пока принимаем свечи напрямую, позже будем загружать из БД
): Promise<BacktestResult> => {
  console.log(`Starting backtest for ${params.pairSymbol} on ${params.timeframe}...`);
  const startTime = Date.now();

  // 1. Применить логику стратегии ко всем свечам
  const strategyLogicResult = applyStrategyLogic(candles, params.strategyParameters);
  const { strategyCandles, volumeProfile } = strategyLogicResult;

  if (!strategyCandles || strategyCandles.length === 0) {
    // Возвращаем пустой результат, если нет свечей или они не обработаны
    const emptyMetrics: BacktestMetrics = {
      totalPnl: 0,
      totalPnlPercentage: 0,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      durationMs: Date.now() - startTime,
    };
    return {
      parameters: params,
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
    // Начальная точка капитала
    // Используем params.startDate, если доступно, иначе первую свечу или 0
    { timestamp: candles[0]?.timestamp ?? new Date(params.startDate).getTime() ?? 0, capital: params.initialCapital }
  ];
  // ... другие переменные для расчета метрик (например, grossProfit, grossLoss)

  // 3. Итерация по свечам для симуляции торговли
  for (let i = 0; i < strategyCandles.length; i++) {
    const currentCandle = strategyCandles[i];
    const prevCandle = i > 0 ? strategyCandles[i - 1] : null;

    // Логика управления рисками и размером позиции
    const riskSettings = params.strategyParameters.risk;
    
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
        
        // Обновление пикового капитала и максимальной просадки
        peakCapital = Math.max(peakCapital, currentCapital);
        const drawdown = peakCapital > 0 ? ((peakCapital - currentCapital) / peakCapital) * 100 : 0;
        maxDrawdown = Math.max(maxDrawdown, drawdown);

        trades.push({ ...activeTrade });
        // Добавляем точку в кривую эквити после закрытия сделки
        if (activeTrade.exitTimestamp) {
          equityCurve.push({ timestamp: activeTrade.exitTimestamp, capital: currentCapital });
        }
        console.log(`[${new Date(activeTrade.exitTimestamp!).toISOString()}] Closed ${activeTrade.direction} trade. Exit: ${activeTrade.exitPrice}, Reason: ${activeTrade.exitReason}, PnL: ${activeTrade.pnl?.toFixed(2)}, Capital: ${currentCapital.toFixed(2)}`);
        activeTrade = null;
      }
    }

    // Проверка условий входа и открытие новых сделок
    if (!activeTrade) {
      let entryPrice = 0;
      let positionSize = 0;
      let newTrade: Trade | null = null;

      if (currentCandle.entryConditionLong) {
        entryPrice = currentCandle.close; // Пример: вход по цене закрытия сигнальной свечи
        positionSize = calculatePositionSize(currentCapital, entryPrice, currentCandle, riskSettings);

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

              const stopLossPrice = entryPrice - atrValue * slMultiplier;
              const takeProfitPrice = entryPrice + atrValue * tpMultiplier;
              
              newTrade = {
                id: uuidv4(),
                direction: TradeDirection.LONG,
                entryTimestamp: currentCandle.timestamp,
                entryPrice,
                size: positionSize,
                stopLoss: stopLossPrice,
                takeProfit: takeProfitPrice,
                entryReason: 'Long Signal',
              };
            }
        } else {
            console.warn(`[Backtester] Candle (index ${i}, time: ${new Date(currentCandle.timestamp ?? 0).toISOString()}) missing or invalid timestamp. Cannot create Long trade.`);
        }
      } else if (currentCandle.entryConditionShort) {
        entryPrice = currentCandle.close; // Пример: вход по цене закрытия сигнальной свечи
        positionSize = calculatePositionSize(currentCapital, entryPrice, currentCandle, riskSettings);

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

              const stopLossPrice = entryPrice + atrValue * slMultiplier;
              const takeProfitPrice = entryPrice - atrValue * tpMultiplier;

              newTrade = {
                id: uuidv4(),
                direction: TradeDirection.SHORT,
                entryTimestamp: currentCandle.timestamp,
                entryPrice,
                size: positionSize,
                stopLoss: stopLossPrice,
                takeProfit: takeProfitPrice,
                entryReason: 'Short Signal',
              };
            }
        } else {
            console.warn(`[Backtester] Candle (index ${i}, time: ${new Date(currentCandle.timestamp ?? 0).toISOString()}) missing or invalid timestamp. Cannot create Short trade.`);
        }
      }

      if (newTrade) {
        activeTrade = newTrade;
        // TODO: Уменьшить currentCapital на стоимость открытия позиции, если это необходимо (например, для фьючерсов с маржой)
        // Пока не делаем, т.к. PnL считается по закрытию.
        console.log(`[${new Date(activeTrade.entryTimestamp).toISOString()}] Opened ${activeTrade.direction} trade. Entry: ${activeTrade.entryPrice}, Size: ${activeTrade.size}, SL: ${activeTrade.stopLoss}, TP: ${activeTrade.takeProfit}`);
      }
    }
    
    // Обновление максимальной просадки
    // currentCapital должен обновляться после каждой сделки или на каждом баре для mark-to-market
    // peakCapital = Math.max(peakCapital, currentCapital);
    // const drawdown = ((peakCapital - currentCapital) / peakCapital) * 100;
    // maxDrawdown = Math.max(maxDrawdown, drawdown);
  }

  // 4. Расчет финальных метрик
  const totalPnl = trades.reduce((sum, trade) => sum + (trade.pnl || 0), 0);
  const winningTradesCount = trades.filter(t => t.pnl && t.pnl > 0).length;
  const losingTradesCount = trades.filter(t => t.pnl && t.pnl < 0).length;

  let grossProfit = 0;
  let grossLoss = 0;
  trades.forEach(trade => {
    if (trade.pnl && trade.pnl > 0) {
      grossProfit += trade.pnl;
    }
    if (trade.pnl && trade.pnl < 0) {
      grossLoss += trade.pnl; // grossLoss будет отрицательным
    }
  });

  const avgTradePnl = trades.length > 0 ? totalPnl / trades.length : 0;
  const profitFactor = grossLoss !== 0 ? Math.abs(grossProfit / grossLoss) : grossProfit > 0 ? Infinity : 0;

  const avgWinningTrade = winningTradesCount > 0 ? grossProfit / winningTradesCount : 0;
  const avgLosingTrade = losingTradesCount > 0 ? grossLoss / losingTradesCount : 0; // grossLoss отрицательный, так что avgLosingTrade тоже будет

  const winRateDecimal = trades.length > 0 ? winningTradesCount / trades.length : 0;
  const lossRateDecimal = trades.length > 0 ? losingTradesCount / trades.length : 0;
  // Для expectancy используем абсолютное значение среднего убытка
  const expectancy = (winRateDecimal * avgWinningTrade) - (lossRateDecimal * Math.abs(avgLosingTrade));

  const finalMetrics: BacktestMetrics = {
    totalPnl,
    totalPnlPercentage: params.initialCapital > 0 ? (totalPnl / params.initialCapital) * 100 : 0,
    totalTrades: trades.length,
    winningTrades: winningTradesCount,
    losingTrades: losingTradesCount,
    winRate: trades.length > 0 ? (winningTradesCount / trades.length) * 100 : 0,
    maxDrawdown: parseFloat(maxDrawdown.toFixed(2)), // Округляем для консистентности
    avgTradePnl: parseFloat(avgTradePnl.toFixed(2)),
    profitFactor: parseFloat(profitFactor.toFixed(2)), // Также округляем
    avgWinningTrade: parseFloat(avgWinningTrade.toFixed(2)),
    avgLosingTrade: parseFloat(avgLosingTrade.toFixed(2)), // Будет отрицательным или 0
    expectancy: parseFloat(expectancy.toFixed(2)),
    durationMs: Date.now() - startTime,
    equityCurve: equityCurve.length > 1 ? equityCurve : undefined, // Возвращаем кривую, если есть хотя бы одна сделка
  };

  console.log(`Backtest for ${params.pairSymbol} completed in ${finalMetrics.durationMs}ms. Trades: ${finalMetrics.totalTrades}, PnL: ${finalMetrics.totalPnl.toFixed(2)}, Max DD: ${finalMetrics.maxDrawdown}%, Expectancy: ${finalMetrics.expectancy?.toFixed(2)}`);

  return {
    parameters: params,
    metrics: finalMetrics,
    trades,
    strategyCandles: strategyCandles, // Возвращаем для анализа
  };
};

// Вспомогательные функции (будут добавлены позже)
// const calculatePositionSize = (...) => { ... };
// const openLongTrade = (...) => { ... };
// const openShortTrade = (...) => { ... };
// const closeActiveTrade = (...) => { ... }; 