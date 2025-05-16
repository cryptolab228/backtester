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
  riskSettings?: RiskManagementSettings,
  // currentCandle?: StrategyCandle // Пока не используется для Варианта 1, но понадобится для Варианта 2
): number => {
  if (!riskSettings) {
    return 1; // Размер по умолчанию, если настройки риска отсутствуют
  }

  // Вариант 1: Процент от капитала
  if (riskSettings.positionSizePercentage && riskSettings.positionSizePercentage > 0 && entryPrice > 0) {
    const capitalToRisk = currentCapital * riskSettings.positionSizePercentage;
    // Убедимся, что размер позиции не отрицательный и не NaN
    const size = Math.max(0, capitalToRisk / entryPrice);
    return size > 0 ? size : 0; // Возвращаем 0, если расчетный размер <= 0
  }

  // TODO: Вариант 2 (На основе риска ATR)
  // if (riskSettings.maxRiskPerTradePercentage && riskSettings.stopLossMultiplier && currentCandle?.atr) {
  //   const riskPerTrade = currentCapital * riskSettings.maxRiskPerTradePercentage;
  //   const atrBasedStopLossAmount = currentCandle.atr * riskSettings.stopLossMultiplier;
  //   if (atrBasedStopLossAmount > 0) {
  //     const size = Math.max(0, riskPerTrade / atrBasedStopLossAmount);
  //     return size > 0 ? size : 0;
  //   }
  // }

  return 1; // Размер по умолчанию, если ни один из методов не сработал
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
  // ... другие переменные для расчета метрик (например, grossProfit, grossLoss)

  // 3. Итерация по свечам для симуляции торговли
  for (let i = 0; i < strategyCandles.length; i++) {
    const currentCandle = strategyCandles[i];
    const prevCandle = i > 0 ? strategyCandles[i - 1] : null;

    // Логика управления рисками и размером позиции
    const riskSettings = params.strategyParameters.risk;
    
    // TODO: Проверка и обработка активной сделки (выход по SL/TP/сигналу)
    if (activeTrade) {
      // ...логика выхода будет здесь (пункт B.2)...
    }

    // Проверка условий входа и открытие новых сделок
    if (!activeTrade) {
      let entryPrice = 0;
      let positionSize = 0;
      let newTrade: Trade | null = null;

      const atrFromCandle = currentCandle.atr; // Извлекаем ATR заранее

      if (currentCandle.entryConditionLong) {
        entryPrice = currentCandle.close; // Пример: вход по цене закрытия сигнальной свечи
        positionSize = calculatePositionSize(currentCapital, entryPrice, riskSettings);

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
        positionSize = calculatePositionSize(currentCapital, entryPrice, riskSettings);

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
  // ... на основе списка trades ...
  const totalPnl = trades.reduce((sum, trade) => sum + (trade.pnl || 0), 0);
  const winningTradesCount = trades.filter(t => t.pnl && t.pnl > 0).length;
  const losingTradesCount = trades.filter(t => t.pnl && t.pnl < 0).length;

  const finalMetrics: BacktestMetrics = {
    totalPnl,
    totalPnlPercentage: (totalPnl / params.initialCapital) * 100,
    totalTrades: trades.length,
    winningTrades: winningTradesCount,
    losingTrades: losingTradesCount,
    winRate: trades.length > 0 ? (winningTradesCount / trades.length) * 100 : 0,
    // maxDrawdown, // Рассчитать корректно
    durationMs: Date.now() - startTime,
    // ... другие метрики
  };

  console.log(`Backtest for ${params.pairSymbol} completed in ${finalMetrics.durationMs}ms. Trades: ${finalMetrics.totalTrades}, PnL: ${finalMetrics.totalPnl.toFixed(2)}`);

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