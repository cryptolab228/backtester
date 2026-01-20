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
import { ExecutionProfile, DEFAULT_EXECUTION_PROFILE } from '../execution/executionProfile';

// НОВОЕ: Импорт модулей фьючерсов и профилей
import { getStrategyProfile, detectProfile, type ExtendedStrategyParameters } from '../strategy_logic/profiles';
import { 
  leverageManager, 
  fundingManager, 
  futuresPositionSizer,
  liquidationCalculator,
  type FuturesBacktestStats,
  type PositionDirection 
} from '../futures';
import {
  initializeFuturesContext,
  calculateFuturesPositionSize,
  checkLiquidation,
  applyFundingRate,
  openFuturesPosition,
  closeFuturesPosition,
  updateLiquidationDistance,
  finalizeFuturesStats,
  type FuturesBacktestContext
} from './backtester.futures';

// TODO: Переместить в utils или использовать библиотеку для генерации ID, если uuid не доступен в Node.js по умолчанию без доп. настроек
// import {战略生成Id} from '../../utils/idGenerator'; 

// Вспомогательная функция для расчета размера позиции
type InternalTrade = Trade & { margin?: number };

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

interface PendingBacktestSignal {
  direction: TradeDirection;
  entryPrice: number;
  stopLoss?: number;
  takeProfit?: number;
  detectedAt: number;
  detectionCandle: StrategyCandle;
  attempts: number;
}

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
  const executionProfile: ExecutionProfile = {
    ...DEFAULT_EXECUTION_PROFILE,
    ...(params.executionProfile || {}),
  };
  const simulateConfirmation = params.simulateConfirmation ?? false;

  // НОВОЕ: Получить профиль стратегии и инициализировать futures контекст
  let effectiveParams: ExtendedStrategyParameters;
  if (params.strategyProfile) {
    effectiveParams = getStrategyProfile(params.strategyProfile);
  } else if (params.extendedParameters) {
    effectiveParams = params.extendedParameters;
  } else {
    // Обратная совместимость - используем существующие параметры
    effectiveParams = params.strategyParameters as ExtendedStrategyParameters;
    const detectedProfile = detectProfile(effectiveParams);
    effectiveParams.profileName = detectedProfile;
  }

  // Инициализировать контекст фьючерсов (если применимо)
  const futuresContext = initializeFuturesContext(effectiveParams);
  const isFuturesMode = futuresContext !== null;
  
  logger.info(`[RunBacktest] Trading Mode: ${isFuturesMode ? '🔥 FUTURES' : '📊 SPOT'}`, {
    profileName: effectiveParams.profileName,
    leverage: futuresContext?.leverage || executionProfile.leverage,
    trackFunding: futuresContext?.trackFunding || false,
    trackLiquidation: futuresContext?.trackLiquidation || false
  });

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
  let activeTrade: InternalTrade | null = null;
  let peakCapital = params.initialCapital;
  let maxDrawdown = 0;
  let tradesOpenedToday = 0;
  let currentDayKey: string | null = null;
  const equityCurve: Array<{ timestamp: number; capital: number }> = [
    { timestamp: candles[0]?.timestamp ?? new Date(params.startDate).getTime() ?? 0, capital: params.initialCapital }
  ];
  let pendingSignal: PendingBacktestSignal | null = null;
  let totalMarginUsed = 0; // НОВОЕ: Для расчета capital efficiency в futures
  // logger.debug(`[RunBacktest] Initial equity point: ${JSON.stringify(equityCurve[0])}`);

  // 3. Итерация по свечам для симуляции торговли
  logger.info(`[RunBacktest] Starting simulation loop over ${strategyCandles.length} strategy candles.`);
  for (let i = 0; i < strategyCandles.length; i++) {
    const currentCandle = strategyCandles[i];
    const prevCandle = i > 0 ? strategyCandles[i - 1] : null;

    // Обновляем счётчик сделок в рамках суток (UTC)
    const dayKey = new Date(currentCandle.timestamp).toISOString().slice(0, 10);
    if (currentDayKey !== dayKey) {
      currentDayKey = dayKey;
      tradesOpenedToday = 0;
    }

    // if (i < 5 || i > strategyCandles.length - 5) {
    //     logger.debug(`[RunBacktest-Loop ${i}] Candle TS: ${currentCandle.timestamp}, O: ${currentCandle.open}, H: ${currentCandle.high}, L: ${currentCandle.low}, C: ${currentCandle.close}, V: ${currentCandle.volume}, ATR: ${currentCandle.atr}, EntryL: ${currentCandle.entryConditionLong}, EntryS: ${currentCandle.entryConditionShort}`);
    // }

    // Логика управления рисками и размером позиции
    const riskSettings = params.strategyParameters?.risk;
    
    // НОВОЕ: Проверка ликвидации и funding для фьючерсов (ПЕРЕД всеми другими проверками)
    if (activeTrade && isFuturesMode && futuresContext) {
      // 1. Проверка ликвидации - КРИТИЧНО: делается первой!
      const { liquidated, liquidationPrice } = checkLiquidation(currentCandle.close, futuresContext);
      
      if (liquidated) {
        // Ликвидация - теряем всю маржу
        const { pnl } = closeFuturesPosition(liquidationPrice, futuresContext);
        
        activeTrade.exitPrice = liquidationPrice;
        activeTrade.exitTimestamp = currentCandle.timestamp;
        activeTrade.exitReason = 'LIQUIDATION';
        activeTrade.pnl = pnl;
        activeTrade.status = 'closed';
        
        // При ликвидации маржа НЕ возвращается (уже потеряна)
        // currentCapital остается без изменений
        
        const exitFee = liquidationPrice * activeTrade.size * executionProfile.tradingFeeRate;
        currentCapital -= exitFee; // Дополнительно платим комиссию за ликвидацию
        activeTrade.fees = (activeTrade.fees || 0) + exitFee;
        
        // Обновляем drawdown
        peakCapital = Math.max(peakCapital, currentCapital);
        const drawdown = peakCapital > 0 ? ((peakCapital - currentCapital) / peakCapital) * 100 : 0;
        maxDrawdown = Math.max(maxDrawdown, drawdown);
        
        const { margin: _ignoredMargin, ...tradeRecord } = activeTrade;
        trades.push({ ...tradeRecord });
        
        if (activeTrade.exitTimestamp) {
          equityCurve.push({ timestamp: activeTrade.exitTimestamp, capital: currentCapital });
        }
        
        logger.error(`[RunBacktest] ❌ LIQUIDATION! Pair: ${params.pairSymbol}, Price: ${liquidationPrice.toFixed(6)}, Loss: ${pnl.toFixed(2)}`);
        
        activeTrade = null;
        continue; // Пропускаем остальные проверки для этой свечи
      }
      
      // 2. Обновление расстояния до ликвидации
      updateLiquidationDistance(currentCandle.close, futuresContext);
      
      // 3. Применение funding rate (каждые 8 часов)
      if (futuresContext.trackFunding) {
        const fundingCost = await applyFundingRate(
          currentCandle.timestamp,
          futuresContext,
          params.pairSymbol,
          (params.exchange as 'bybit' | 'okx') || 'bybit'
        );
        
        if (fundingCost !== 0) {
          currentCapital -= fundingCost;
          
          logger.debug(`[RunBacktest] Funding applied: ${fundingCost > 0 ? '-' : '+'}${Math.abs(fundingCost).toFixed(4)}, Capital: ${currentCapital.toFixed(2)}`);
        }
      }
    }
    
    // Закрытие/сопровождение активной сделки
    if (activeTrade) {
      let exitReason: string | undefined = undefined;
      let exitPrice: number | undefined = undefined;

      // --- Trailing Stop (переключаемый) ---
      const useTrailing = !!riskSettings?.useTrailingStop;
      const atrForTS = currentCandle.atr || 0;
      const tsOffsetMult = riskSettings?.trailingStopOffsetMultiplier || 0;
      const tsStepMult = riskSettings?.trailingStopStepMultiplier || 0;

      if (useTrailing && atrForTS > 0 && tsOffsetMult > 0) {
        const offset = atrForTS * tsOffsetMult;
        const step = tsStepMult > 0 ? atrForTS * tsStepMult : 0; // шаг может быть 0 (плавное сопровождение)

        // Инициализация trailingStop при первом проходе, если не задано
        if (activeTrade.trailingStop === undefined) {
          if (activeTrade.direction === TradeDirection.LONG) {
            activeTrade.trailingStop = activeTrade.entryPrice - offset;
          } else {
            activeTrade.trailingStop = activeTrade.entryPrice + offset;
          }
        }

        // Обновление trailingStop от экстремума с момента входа
        if (activeTrade.direction === TradeDirection.LONG) {
          // Находим максимум High с момента входа
          let highestHighSinceEntry = currentCandle.high;
          for (let b = i; b >= 0; b--) {
            const c = strategyCandles[b];
            if (!c) break;
            highestHighSinceEntry = Math.max(highestHighSinceEntry, c.high);
            if (c.timestamp <= (activeTrade.entryTimestamp || c.timestamp)) break;
          }
          const candidate = highestHighSinceEntry - offset;
          const shouldTrail = candidate > (activeTrade.trailingStop || -Infinity) + step;
          if (shouldTrail) {
            const prev = activeTrade.trailingStop;
            activeTrade.trailingStop = candidate;
            logger.debug(`[RunBacktest] Trail up (LONG): prev=${prev?.toFixed(6)}, cand=${candidate.toFixed(6)}, step=${step.toFixed(6)}, close=${currentCandle.close}`);
          }
        } else {
          // SHORT: минимум Low с момента входа
          let lowestLowSinceEntry = currentCandle.low;
          for (let b = i; b >= 0; b--) {
            const c = strategyCandles[b];
            if (!c) break;
            lowestLowSinceEntry = Math.min(lowestLowSinceEntry, c.low);
            if (c.timestamp <= (activeTrade.entryTimestamp || c.timestamp)) break;
          }
          const candidate = lowestLowSinceEntry + offset;
          const shouldTrail = candidate < (activeTrade.trailingStop || Infinity) - step;
          if (shouldTrail) {
            const prev = activeTrade.trailingStop;
            activeTrade.trailingStop = candidate;
            logger.debug(`[RunBacktest] Trail down (SHORT): prev=${prev?.toFixed(6)}, cand=${candidate.toFixed(6)}, step=${step.toFixed(6)}, close=${currentCandle.close}`);
          }
        }

        // Проверка срабатывания трейлинг-стопа
        if (activeTrade.direction === TradeDirection.LONG && activeTrade.trailingStop !== undefined && currentCandle.low <= activeTrade.trailingStop) {
          exitReason = 'TRAIL';
          exitPrice = activeTrade.trailingStop;
          logger.info(`[RunBacktest] CLOSED ${activeTrade.direction} trade (TRAIL). Exit=${exitPrice.toFixed(6)} Close=${currentCandle.close.toFixed(6)} Low=${currentCandle.low.toFixed(6)} TS=${activeTrade.trailingStop.toFixed(6)}`);
        } else if (activeTrade.direction === TradeDirection.SHORT && activeTrade.trailingStop !== undefined && currentCandle.high >= activeTrade.trailingStop) {
          exitReason = 'TRAIL';
          exitPrice = activeTrade.trailingStop;
          logger.info(`[RunBacktest] CLOSED ${activeTrade.direction} trade (TRAIL). Exit=${exitPrice.toFixed(6)} Close=${currentCandle.close.toFixed(6)} High=${currentCandle.high.toFixed(6)} TS=${activeTrade.trailingStop.toFixed(6)}`);
        }
      }

      // Проверка Stop Loss
      if (!exitReason && activeTrade.direction === TradeDirection.LONG && activeTrade.stopLoss && currentCandle.low <= activeTrade.stopLoss) {
        exitReason = 'SL';
        exitPrice = activeTrade.stopLoss;
      } else if (!exitReason && activeTrade.direction === TradeDirection.SHORT && activeTrade.stopLoss && currentCandle.high >= activeTrade.stopLoss) {
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
      
      // Выход по противоположному сигналу (опционально)
      if (!exitReason && riskSettings?.exitOnOppositeSignal) {
        const oppositeSignal = activeTrade.direction === TradeDirection.LONG
          ? currentCandle.entryConditionShort
          : currentCandle.entryConditionLong;
        if (oppositeSignal) {
          exitReason = 'OPPOSITE';
          exitPrice = currentCandle.close; // Закрываем по close текущей свечи
          logger.debug(`[RunBacktest] Exit on OPPOSITE signal detected for ${params.pairSymbol || 'unknown'} at candle ${i}. Direction: ${activeTrade.direction}, Close: ${currentCandle.close}`);
        }
      }

      if (exitReason && exitPrice !== undefined && typeof currentCandle.timestamp === 'number') {
        activeTrade.exitTimestamp = currentCandle.timestamp;
        activeTrade.exitPrice = exitPrice;
        activeTrade.exitReason = exitReason;

        let pnl = 0;
        const marginToRelease = activeTrade.margin || 0;
        
        // НОВОЕ: Использовать futures логику для закрытия, если в futures режиме
        if (isFuturesMode && futuresContext) {
          const { pnl: futuresPnl, pnlWithLeverage } = closeFuturesPosition(exitPrice, futuresContext);
          pnl = futuresPnl;
          
          // Возвращаем маржу при нормальном закрытии
          currentCapital += marginToRelease;
          
          logger.debug(`[RunBacktest] Futures position closed: PnL=${pnl.toFixed(2)}, PnL w/Leverage=${pnlWithLeverage.toFixed(2)}`);
        } else {
          // Существующая логика для spot
          if (activeTrade.direction === TradeDirection.LONG) {
            pnl = (activeTrade.exitPrice - activeTrade.entryPrice) * activeTrade.size;
          } else { // SHORT
            pnl = (activeTrade.entryPrice - activeTrade.exitPrice) * activeTrade.size;
          }
          
          // Возвращаем маржу
          currentCapital += marginToRelease;
        }

        const exitFee = activeTrade.exitPrice * activeTrade.size * executionProfile.tradingFeeRate;
        const totalFee = (activeTrade.fees || 0) + exitFee;

        pnl -= exitFee;
        currentCapital += pnl;

        activeTrade.fees = totalFee;
        activeTrade.pnl = pnl;
        activeTrade.exitTimestamp = currentCandle.timestamp;
        activeTrade.status = 'closed';

        peakCapital = Math.max(peakCapital, currentCapital);
        const drawdown = peakCapital > 0 ? ((peakCapital - currentCapital) / peakCapital) * 100 : 0;
        maxDrawdown = Math.max(maxDrawdown, drawdown);

        const { margin: _ignoredMargin, ...tradeRecord } = activeTrade;
        trades.push({ ...tradeRecord });
        if (activeTrade.exitTimestamp) {
          equityCurve.push({ timestamp: activeTrade.exitTimestamp, capital: currentCapital });
        }
        activeTrade = null;
      }
    } else {
      // Открытие новой сделки
      if (pendingSignal && simulateConfirmation) {
        const confirmCandle = currentCandle;
        const priceHit = pendingSignal.direction === TradeDirection.LONG
          ? confirmCandle.high >= pendingSignal.entryPrice
          : confirmCandle.low <= pendingSignal.entryPrice;

        const stopHit = pendingSignal.stopLoss !== undefined && (
          (pendingSignal.direction === TradeDirection.LONG && confirmCandle.low <= pendingSignal.stopLoss) ||
          (pendingSignal.direction === TradeDirection.SHORT && confirmCandle.high >= pendingSignal.stopLoss)
        );

        if (priceHit && !stopHit) {
          const entryPrice = pendingSignal.entryPrice;
          const direction = pendingSignal.direction;
          const riskSettings = params.strategyParameters?.risk;
          const slippageFactor = 1 + (executionProfile.slippageBps / 10_000) * (direction === TradeDirection.LONG ? 1 : -1);
          const fillPrice = entryPrice * slippageFactor;
          
          let positionSizeBase: number;
          let size: number;
          let requiredMargin: number;
          let liquidationPrice: number | undefined;
          
          // НОВОЕ: Использовать futures логику для расчета позиции
          if (isFuturesMode && futuresContext && pendingSignal.stopLoss) {
            const positionCalc = calculateFuturesPositionSize(
              currentCapital,
              fillPrice,
              pendingSignal.stopLoss,
              (riskSettings?.maxRiskPerTradePercentage || 0.01) * 100, // Конвертируем в проценты
              futuresContext.leverage
            );
            
            size = positionCalc.contracts;
            
            // Открыть futures позицию и получить маржу/ликвидацию
            const openResult = openFuturesPosition(
              fillPrice,
              direction,
              size,
              futuresContext.leverage,
              futuresContext
            );
            
            requiredMargin = openResult.requiredMargin;
            liquidationPrice = openResult.liquidationPrice;
            totalMarginUsed += requiredMargin;
            
            logger.debug(`[RunBacktest] Futures position opened (conf): Size=${size.toFixed(4)}, Margin=${requiredMargin.toFixed(2)}, LiqPrice=${liquidationPrice.toFixed(6)}`);
          } else {
            // Существующая логика для spot
            positionSizeBase = calculatePositionSize(currentCapital, fillPrice, confirmCandle, riskSettings);
            size = positionSizeBase * executionProfile.leverage;
            requiredMargin = fillPrice * size / Math.max(executionProfile.leverage, 1);
          }

          if (size > 0) {
            activeTrade = {
              id: uuidv4(),
              pair: params.pairSymbol,
              direction,
              entryTimestamp: confirmCandle.timestamp,
              entryPrice: fillPrice,
              size,
              stopLoss: pendingSignal.stopLoss,
              takeProfit: pendingSignal.takeProfit,
              status: 'active',
            };

            const entryFee = fillPrice * size * executionProfile.tradingFeeRate;
            currentCapital -= requiredMargin;
            currentCapital -= entryFee;
            activeTrade.fees = (activeTrade.fees || 0) + entryFee;
            activeTrade.margin = requiredMargin;
            tradesOpenedToday += 1;
          }

          pendingSignal = null;
          continue;
        } else {
          pendingSignal.attempts += 1;
          const attemptsLimit = executionProfile.maxConfirmationAttempts;
          if (pendingSignal.attempts >= attemptsLimit || stopHit) {
            pendingSignal = null;
          }
        }
      }

      if (simulateConfirmation && !pendingSignal) {
        let candidateDirection: TradeDirection | undefined;
        if (currentCandle.entryConditionLong) {
          candidateDirection = TradeDirection.LONG;
        } else if (currentCandle.entryConditionShort) {
          candidateDirection = TradeDirection.SHORT;
        }

        if (candidateDirection) {
          const riskSettings = params.strategyParameters?.risk;
          const atrForTrade = currentCandle.atr;
          let stopLossPrice: number | undefined;
          let takeProfitPrice: number | undefined;

          if (riskSettings?.stopLossMultiplier && atrForTrade) {
            stopLossPrice = candidateDirection === TradeDirection.LONG
              ? currentCandle.low - atrForTrade * riskSettings.stopLossMultiplier
              : currentCandle.high + atrForTrade * riskSettings.stopLossMultiplier;
          }

          if (riskSettings?.takeProfitMultiplier && atrForTrade) {
            takeProfitPrice = candidateDirection === TradeDirection.LONG
              ? currentCandle.close + atrForTrade * riskSettings.takeProfitMultiplier
              : currentCandle.close - atrForTrade * riskSettings.takeProfitMultiplier;
          }

          pendingSignal = {
            direction: candidateDirection,
            entryPrice: currentCandle.close,
            stopLoss: stopLossPrice,
            takeProfit: takeProfitPrice,
            detectedAt: currentCandle.timestamp,
            detectionCandle: currentCandle,
            attempts: 0,
          };
          continue;
        }
      }

      let direction: TradeDirection | undefined = undefined;
      if (currentCandle.entryConditionLong) {
        direction = TradeDirection.LONG;
      } else if (currentCandle.entryConditionShort) {
        direction = TradeDirection.SHORT;
      }

      if (!simulateConfirmation && direction && currentCandle.atr && currentCandle.atr > 0) {
        // Лимит сделок в день
        const maxPerDay = params.strategyParameters?.risk?.maxTradesPerDay;
        if (typeof maxPerDay === 'number' && maxPerDay > 0 && tradesOpenedToday >= maxPerDay) {
          // Пропускаем открытие новой сделки из-за лимита
        } else {
          const entryPrice = currentCandle.close;
          const slippageFactor = 1 + (executionProfile.slippageBps / 10_000) * (direction === TradeDirection.LONG ? 1 : -1);
          const fillPrice = entryPrice * slippageFactor;
          
          let positionSize: number;
          let requiredMargin: number;
          let stopLossPrice: number | undefined;
          let takeProfitPrice: number | undefined;
          const atrForTrade = currentCandle.atr;

          // Рассчитать SL/TP сначала
          if (riskSettings?.stopLossMultiplier && atrForTrade && atrForTrade > 0) {
            if (direction === TradeDirection.LONG) {
              stopLossPrice = currentCandle.low - atrForTrade * riskSettings.stopLossMultiplier;
            } else { // SHORT
              stopLossPrice = currentCandle.high + atrForTrade * riskSettings.stopLossMultiplier;
            }
          }

          if (riskSettings?.takeProfitMultiplier && atrForTrade && atrForTrade > 0) {
            if (direction === TradeDirection.LONG) {
              takeProfitPrice = currentCandle.close + atrForTrade * riskSettings.takeProfitMultiplier;
            } else { // SHORT
              takeProfitPrice = currentCandle.close - atrForTrade * riskSettings.takeProfitMultiplier;
            }
          }

          // НОВОЕ: Использовать futures логику для расчета позиции
          if (isFuturesMode && futuresContext && stopLossPrice) {
            const positionCalc = calculateFuturesPositionSize(
              currentCapital,
              fillPrice,
              stopLossPrice,
              (riskSettings?.maxRiskPerTradePercentage || 0.01) * 100,
              futuresContext.leverage
            );
            
            positionSize = positionCalc.contracts;
            
            // Открыть futures позицию
            const openResult = openFuturesPosition(
              fillPrice,
              direction,
              positionSize,
              futuresContext.leverage,
              futuresContext
            );
            
            requiredMargin = openResult.requiredMargin;
            totalMarginUsed += requiredMargin;
            
            logger.debug(`[RunBacktest] Futures position opened: Size=${positionSize.toFixed(4)}, Margin=${requiredMargin.toFixed(2)}, LiqPrice=${openResult.liquidationPrice.toFixed(6)}`);
          } else {
            // Существующая логика для spot
            positionSize = calculatePositionSize(currentCapital, fillPrice, currentCandle, riskSettings);
            requiredMargin = fillPrice * positionSize / Math.max(executionProfile.leverage, 1);
          }

          if (positionSize > 0) {
            const newTradeId = uuidv4();
            activeTrade = {
              id: newTradeId,
              pair: params.pairSymbol,
              direction: direction,
              entryTimestamp: currentCandle.timestamp,
              entryPrice: fillPrice,
              size: positionSize,
              stopLoss: stopLossPrice,
              takeProfit: takeProfitPrice,
              status: 'active',
            } as InternalTrade;

            // Инициализация trailing stop при открытии, если включено
            if (riskSettings?.useTrailingStop && atrForTrade && atrForTrade > 0 && riskSettings.trailingStopOffsetMultiplier && riskSettings.trailingStopOffsetMultiplier > 0) {
              const offset = atrForTrade * riskSettings.trailingStopOffsetMultiplier;
              if (direction === TradeDirection.LONG) {
                activeTrade.trailingStop = fillPrice - offset;
              } else {
                activeTrade.trailingStop = fillPrice + offset;
              }
            }

            const entryFee = fillPrice * positionSize * executionProfile.tradingFeeRate;
            currentCapital -= requiredMargin;
            currentCapital -= entryFee;
            activeTrade.fees = (activeTrade.fees || 0) + entryFee;
            activeTrade.margin = requiredMargin;

            tradesOpenedToday += 1;
          } else {
            logger.warn(`[RunBacktest-Loop ${i}] Position size is 0 or less, no trade opened.`);
          }
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
  // ЕДИНИЦЫ: winRate возвращаем в процентах (0..100), а для внутренних расчетов используем десятичное значение
  const winRateDecimal = trades.length > 0 ? winningTradesCount / trades.length : 0;
  const winRate = winRateDecimal * 100;
  
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
    const lossRate = 1 - winRateDecimal;
    expectancy = (winRateDecimal * avgWinningTrade) - (lossRate * avgLosingTrade);
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
    
    // НОВОЕ: Добавляем futures метрики, если это futures режим
    futuresStats: isFuturesMode && futuresContext
      ? finalizeFuturesStats(futuresContext, totalPnl, params.initialCapital, totalMarginUsed)
      : undefined
  };

  logger.info(`[RunBacktest] Finished. Total Trades: ${metrics.totalTrades}, PnL: ${metrics.totalPnl.toFixed(2)} (${metrics.totalPnlPercentage.toFixed(2)}%). Duration: ${metrics.durationMs}ms`);
  
  // НОВОЕ: Логировать futures статистику, если есть
  if (metrics.futuresStats) {
    logger.info(`[RunBacktest] Futures Stats: Liquidations=${metrics.futuresStats.liquidations}, NetFunding=${metrics.futuresStats.netFunding.toFixed(2)}, EffectiveROI=${metrics.futuresStats.effectiveROI.toFixed(2)}%, CapitalEfficiency=${metrics.futuresStats.capitalEfficiency.toFixed(2)}%`);
  }

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
  const riskSettingsPortfolio = params.strategyParameters?.risk;
  logger.info(`[RunPortfolioBacktest] Risk settings: useTrailingStop=${!!riskSettingsPortfolio?.useTrailingStop}, offsetMult=${riskSettingsPortfolio?.trailingStopOffsetMultiplier}, stepMult=${riskSettingsPortfolio?.trailingStopStepMultiplier}, slMult=${riskSettingsPortfolio?.stopLossMultiplier}, tpMult=${riskSettingsPortfolio?.takeProfitMultiplier}`);
  logger.info(`[RunPortfolioBacktest] Additional risk settings: exitOnOppositeSignal=${!!riskSettingsPortfolio?.exitOnOppositeSignal}, maxTradesPerDay=${riskSettingsPortfolio?.maxTradesPerDay || 0}`);

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
      throw new Error(`No candles provided for pair ${pairSymbol} in portfolio backtest`);
    }
  }

  // 2. Применяем логику стратегии к каждой паре индивидуально
  const strategyCandlesByPair: Record<string, StrategyCandle[]> = {};
  
  for (const pairSymbol of params.pairSymbols) {
    const candles = candlesByPair[pairSymbol] || [];
    logger.info(`[RunPortfolioBacktest] Applying strategy logic to ${pairSymbol} (${candles.length} candles)`);
    const strategyResult = applyStrategyLogic(candles, params.strategyParameters);
    strategyCandlesByPair[pairSymbol] = strategyResult.strategyCandles;
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

  // Проверяем наличие данных и сортируем по времени
  if (allSynchronizedCandles.length === 0) {
    throw new Error('No strategy candles generated for portfolio backtest. Check input data.');
  }

  allSynchronizedCandles.sort((a, b) => a.timestamp - b.timestamp);
  logger.info(`[RunPortfolioBacktest] Created synchronized stream of ${allSynchronizedCandles.length} candles`);

  const firstStrategyTimestamp = allSynchronizedCandles[0].timestamp;
  const expectedFirstTimestamp = new Date(params.startDate).getTime();
  if (firstStrategyTimestamp > expectedFirstTimestamp) {
    logger.warn(`[RunPortfolioBacktest] Strategy data starts later than requested period. Start TS=${firstStrategyTimestamp}, expected >= ${expectedFirstTimestamp}`);
  }
  const lastStrategyTimestamp = allSynchronizedCandles[allSynchronizedCandles.length - 1].timestamp;
  const expectedLastTimestamp = new Date(params.endDate).getTime();
  if (lastStrategyTimestamp < expectedLastTimestamp) {
    logger.warn(`[RunPortfolioBacktest] Strategy data ends earlier than requested period. Last TS=${lastStrategyTimestamp}, expected >= ${expectedLastTimestamp}`);
  }

  // 4. Инициализация переменных для портфельного бэктестинга
  const tradesByPair: Record<string, Trade[]> = {};
  let currentPortfolioCapital = params.initialPortfolioCapital;
  const activeTradesPortfolio: Map<string, Trade> = new Map(); // Ключ = pairSymbol
  let peakPortfolioCapital = params.initialPortfolioCapital;
  let maxPortfolioDrawdown = 0;
  const portfolioEquityCurve: EquityDataPoint[] = [
    { timestamp: allSynchronizedCandles[0].timestamp, capital: params.initialPortfolioCapital }
  ];

  // Инициализируем массивы сделок для каждой пары
  for (const pairSymbol of params.pairSymbols) {
    tradesByPair[pairSymbol] = [];
  }

  // Настройки портфеля
  const maxConcurrentTrades = Math.max(0, params.portfolioSettings?.maxConcurrentTradesPortfolio ?? Infinity);

  const executionProfile: ExecutionProfile = {
    ...DEFAULT_EXECUTION_PROFILE,
    ...(params.executionProfile || {}),
  };
  const simulateConfirmation = params.simulateConfirmation ?? false;

  // Метрики для отслеживания одновременных сделок
  let totalConcurrentTradesSum = 0;
  let concurrentTradesCount = 0;
  let peakConcurrentTrades = 0;

  // 5. Основной цикл портфельного бэктестинга
  logger.info(`[RunPortfolioBacktest] Starting simulation loop over ${allSynchronizedCandles.length} synchronized candles`);
  
  let currentTimestamp = allSynchronizedCandles[0].timestamp;
  let currentDayKey: string | null = null;
  let pendingSignalsAtTimestamp: PotentialSignal[] = [];
  const pendingMap: Map<string, PendingBacktestSignal | null> = new Map();

  for (let i = 0; i < allSynchronizedCandles.length; i++) {
    const currentCandle = allSynchronizedCandles[i];
    const pairSymbol = currentCandle.pairSymbol;

    // Если это новый timestamp, обрабатываем накопленные сигналы с предыдущего timestamp
    if (currentCandle.timestamp !== currentTimestamp) {
      // Обрабатываем сигналы с предыдущего timestamp (если есть)
      if (pendingSignalsAtTimestamp.length > 0) {
        // НОВОЕ: Проверка критического недостатка капитала перед обработкой сигналов
        const minimalRequiredCapital = params.initialPortfolioCapital * 0.05; // 5% от первоначального капитала
        if (currentPortfolioCapital < minimalRequiredCapital && activeTradesPortfolio.size === 0) {
          logger.error(`[RunPortfolioBacktest] КРИТИЧЕСКИЙ НЕДОСТАТОК КАПИТАЛА: ${currentPortfolioCapital.toFixed(2)} < ${minimalRequiredCapital.toFixed(2)} (5% от ${params.initialPortfolioCapital}). Остановка бэктеста.`);
          logger.error(`[RunPortfolioBacktest] Портфельный бэктест остановлен досрочно из-за критической потери капитала на свече ${i+1}/${allSynchronizedCandles.length}`);
          
          // Досрочное завершение с текущими результатами
          break;
        }
        
        currentPortfolioCapital = await processPortfolioPendingSignals(
          pendingSignalsAtTimestamp,
          currentPortfolioCapital,
          activeTradesPortfolio,
          maxConcurrentTrades,
          tradesByPair,
          params.strategyParameters?.risk,
          executionProfile,
          simulateConfirmation
        );
        pendingSignalsAtTimestamp = [];
      }
      
      currentTimestamp = currentCandle.timestamp;
      currentDayKey = null;
    }

    // A. Закрытие активных сделок для текущей пары
    let activeTrade = activeTradesPortfolio.get(pairSymbol) as InternalTrade | undefined;
    if (activeTrade) {
      let exitReason: string | undefined = undefined;
      let exitPrice: number | undefined = undefined;

      // === Trailing Stop (переключаемый для портфеля) ===
      const useTrailing = !!riskSettingsPortfolio?.useTrailingStop;
      const atrForTS = currentCandle.atr || 0;
      const tsOffsetMult = riskSettingsPortfolio?.trailingStopOffsetMultiplier || 0;
      const tsStepMult = riskSettingsPortfolio?.trailingStopStepMultiplier || 0;

      if (useTrailing && atrForTS > 0 && tsOffsetMult > 0) {
        const offset = atrForTS * tsOffsetMult;
        const step = tsStepMult > 0 ? atrForTS * tsStepMult : 0;

        // Инициализация, если не задано
        if (activeTrade.trailingStop === undefined) {
          if (activeTrade.direction === TradeDirection.LONG) {
            activeTrade.trailingStop = activeTrade.entryPrice - offset;
            logger.debug(`[RunPortfolioBacktest] [${pairSymbol}] Init TRAIL (LONG): entry=${activeTrade.entryPrice}, offset=${offset.toFixed(6)}, ts=${activeTrade.trailingStop.toFixed(6)}`);
          } else {
            activeTrade.trailingStop = activeTrade.entryPrice + offset;
            logger.debug(`[RunPortfolioBacktest] [${pairSymbol}] Init TRAIL (SHORT): entry=${activeTrade.entryPrice}, offset=${offset.toFixed(6)}, ts=${activeTrade.trailingStop.toFixed(6)}`);
          }
        }

        // Обновление trailing уровня - ИСПРАВЛЕНО: Используем экстремумы как в одиночном бэктесте
        if (activeTrade.direction === TradeDirection.LONG) {
          // Найти максимум High с момента входа (как в одиночном бэктесте)
          let highestHighSinceEntry = currentCandle.high;
          for (let b = i; b >= 0; b--) {
            const c = allSynchronizedCandles[b];
            if (!c || c.pairSymbol !== pairSymbol) continue;
            highestHighSinceEntry = Math.max(highestHighSinceEntry, c.high);
            if (c.timestamp <= (activeTrade.entryTimestamp || c.timestamp)) break;
          }
          const candidate = highestHighSinceEntry - offset;
          const shouldTrail = candidate > (activeTrade.trailingStop || -Infinity) + step;
          if (shouldTrail) {
            const prev = activeTrade.trailingStop;
            activeTrade.trailingStop = candidate;
            logger.debug(`[RunPortfolioBacktest] [${pairSymbol}] Trail up (LONG): prev=${prev?.toFixed(6)}, cand=${candidate.toFixed(6)}, step=${step.toFixed(6)}, highestHigh=${highestHighSinceEntry.toFixed(6)}, close=${currentCandle.close}`);
          }
        } else {
          // Найти минимум Low с момента входа (как в одиночном бэктесте)
          let lowestLowSinceEntry = currentCandle.low;
          for (let b = i; b >= 0; b--) {
            const c = allSynchronizedCandles[b];
            if (!c || c.pairSymbol !== pairSymbol) continue;
            lowestLowSinceEntry = Math.min(lowestLowSinceEntry, c.low);
            if (c.timestamp <= (activeTrade.entryTimestamp || c.timestamp)) break;
          }
          const candidate = lowestLowSinceEntry + offset;
          const shouldTrail = candidate < (activeTrade.trailingStop || Infinity) - step;
          if (shouldTrail) {
            const prev = activeTrade.trailingStop;
            activeTrade.trailingStop = candidate;
            logger.debug(`[RunPortfolioBacktest] [${pairSymbol}] Trail down (SHORT): prev=${prev?.toFixed(6)}, cand=${candidate.toFixed(6)}, step=${step.toFixed(6)}, lowestLow=${lowestLowSinceEntry.toFixed(6)}, close=${currentCandle.close}`);
          }
        }

        // Срабатывание
        if (activeTrade.direction === TradeDirection.LONG && activeTrade.trailingStop !== undefined && currentCandle.low <= activeTrade.trailingStop) {
          exitReason = 'TRAIL';
          exitPrice = activeTrade.trailingStop;
          logger.info(`[RunPortfolioBacktest] CLOSED ${activeTrade.direction} trade for ${pairSymbol} (TRAIL). Exit=${exitPrice.toFixed(6)} Close=${currentCandle.close.toFixed(6)} Low=${currentCandle.low.toFixed(6)} TS=${activeTrade.trailingStop.toFixed(6)}`);
        } else if (activeTrade.direction === TradeDirection.SHORT && activeTrade.trailingStop !== undefined && currentCandle.high >= activeTrade.trailingStop) {
          exitReason = 'TRAIL';
          exitPrice = activeTrade.trailingStop;
          logger.info(`[RunPortfolioBacktest] CLOSED ${activeTrade.direction} trade for ${pairSymbol} (TRAIL). Exit=${exitPrice.toFixed(6)} Close=${currentCandle.close.toFixed(6)} High=${currentCandle.high.toFixed(6)} TS=${activeTrade.trailingStop.toFixed(6)}`);
        }
      }

      // Проверка Stop Loss
      if (!exitReason && activeTrade.stopLoss !== undefined) {
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

        const fees = activeTrade.fees || 0;
        const margin = (activeTrade as InternalTrade).margin || 0;
        const pnlRaw = activeTrade.direction === TradeDirection.LONG
          ? (exitPrice - activeTrade.entryPrice) * activeTrade.size
          : (activeTrade.entryPrice - exitPrice) * activeTrade.size;
        const exitFee = exitPrice * activeTrade.size * executionProfile.tradingFeeRate;
        const pnlNet = pnlRaw - exitFee;

        activeTrade.exitTimestamp = currentCandle.timestamp;
        activeTrade.exitPrice = exitPrice;
        activeTrade.exitReason = activeTrade.exitReason || 'external';
        activeTrade.fees = fees + exitFee;
        activeTrade.pnl = pnlNet;
        activeTrade.status = 'closed';
        activeTrade.margin = undefined;

        currentPortfolioCapital += margin;
        currentPortfolioCapital += pnlNet;

        peakPortfolioCapital = Math.max(peakPortfolioCapital, currentPortfolioCapital);
        const drawdown = peakPortfolioCapital > 0 ? ((peakPortfolioCapital - currentPortfolioCapital) / peakPortfolioCapital) * 100 : 0;
        maxPortfolioDrawdown = Math.max(maxPortfolioDrawdown, drawdown);

        const { margin: _ignoredMargin2, ...finalTradeRecord } = activeTrade;
        tradesByPair[pairSymbol].push({ ...finalTradeRecord });
        activeTradesPortfolio.delete(pairSymbol);
        logger.info(`[RunPortfolioBacktest] CLOSED ${activeTrade.direction} trade for ${pairSymbol} by external event. PnL: ${pnlNet.toFixed(2)}`);
      }
    }

    // B. Сбор потенциальных сигналов на вход для текущей пары
    if (!activeTradesPortfolio.has(pairSymbol)) {
      const dayKey = new Date(currentCandle.timestamp).toISOString().slice(0, 10);
      if (currentDayKey !== dayKey) {
        currentDayKey = dayKey;
      }

      if (simulateConfirmation) {
        const pending = pendingMap.get(pairSymbol);
        if (pending) {
          const priceHit = pending.direction === TradeDirection.LONG
            ? currentCandle.high >= pending.entryPrice
            : currentCandle.low <= pending.entryPrice;
          const stopHit = pending.stopLoss !== undefined && (
            (pending.direction === TradeDirection.LONG && currentCandle.low <= pending.stopLoss) ||
            (pending.direction === TradeDirection.SHORT && currentCandle.high >= pending.stopLoss)
          );

          if (priceHit && !stopHit) {
            const slippageFactor = 1 + (executionProfile.slippageBps / 10_000) * (pending.direction === TradeDirection.LONG ? 1 : -1);
            const fillPrice = pending.entryPrice * slippageFactor;
            const positionSizeBase = calculatePositionSize(currentPortfolioCapital, fillPrice, currentCandle, params.strategyParameters?.risk);
            const size = positionSizeBase * (executionProfile.leverage ?? 1);

            if (size > 0) {
              const newTrade: InternalTrade = {
                id: uuidv4(),
                pair: pairSymbol,
                direction: pending.direction,
                entryTimestamp: currentCandle.timestamp,
                entryPrice: fillPrice,
                size,
                stopLoss: pending.stopLoss,
                takeProfit: pending.takeProfit,
                status: 'active',
              };

              if (riskSettingsPortfolio?.useTrailingStop && currentCandle.atr && currentCandle.atr > 0 && riskSettingsPortfolio.trailingStopOffsetMultiplier && riskSettingsPortfolio.trailingStopOffsetMultiplier > 0) {
                const offset = currentCandle.atr * riskSettingsPortfolio.trailingStopOffsetMultiplier;
                newTrade.trailingStop = pending.direction === TradeDirection.LONG
                  ? fillPrice - offset
                  : fillPrice + offset;
              }

              const requiredMargin = fillPrice * size / Math.max(executionProfile.leverage ?? 1, 1);
              const entryFee = fillPrice * size * (executionProfile.tradingFeeRate ?? 0);
              currentPortfolioCapital -= requiredMargin;
              currentPortfolioCapital -= entryFee;
              newTrade.margin = requiredMargin;
              newTrade.fees = entryFee;

              activeTradesPortfolio.set(pairSymbol, newTrade);
              logger.info(`[RunPortfolioBacktest] CONFIRMED ${newTrade.direction} trade for ${pairSymbol}. Entry=${fillPrice}, Size=${size}`);
            }

            pendingMap.set(pairSymbol, null);
            continue;
          }

          pending.attempts += 1;
          if (pending.attempts >= (executionProfile.maxConfirmationAttempts || 3) || stopHit) {
            pendingMap.set(pairSymbol, null);
          }
        }

        if (!pendingMap.get(pairSymbol)) {
          let direction: TradeDirection | undefined;
          let signalStrength = 0;

          if (currentCandle.entryConditionLong && currentCandle.signalStrength) {
            direction = TradeDirection.LONG;
            signalStrength = currentCandle.signalStrength;
          } else if (currentCandle.entryConditionShort && currentCandle.signalStrength) {
            direction = TradeDirection.SHORT;
            signalStrength = currentCandle.signalStrength;
          }

          if (direction && signalStrength > 0) {
            let stopLossPrice: number | undefined;
            let takeProfitPrice: number | undefined;
            const atr = currentCandle.atr;

            if (riskSettingsPortfolio?.stopLossMultiplier && atr) {
              stopLossPrice = direction === TradeDirection.LONG
                ? currentCandle.low - atr * riskSettingsPortfolio.stopLossMultiplier
                : currentCandle.high + atr * riskSettingsPortfolio.stopLossMultiplier;
            }

            if (riskSettingsPortfolio?.takeProfitMultiplier && atr) {
              takeProfitPrice = direction === TradeDirection.LONG
                ? currentCandle.close + atr * riskSettingsPortfolio.takeProfitMultiplier
                : currentCandle.close - atr * riskSettingsPortfolio.takeProfitMultiplier;
            }

            pendingMap.set(pairSymbol, {
              direction,
              entryPrice: currentCandle.close,
              stopLoss: stopLossPrice,
              takeProfit: takeProfitPrice,
              detectedAt: currentCandle.timestamp,
              detectionCandle: currentCandle,
              attempts: 0,
            });
          }
        }
      } else {
        let direction: TradeDirection | undefined = undefined;
        let signalStrength = 0;

        if (currentCandle.entryConditionLong && currentCandle.signalStrength !== null && currentCandle.signalStrength !== undefined && currentCandle.signalStrength > 0) {
          direction = TradeDirection.LONG;
          signalStrength = currentCandle.signalStrength;
        } else if (currentCandle.entryConditionShort && currentCandle.signalStrength !== null && currentCandle.signalStrength !== undefined && currentCandle.signalStrength > 0) {
          direction = TradeDirection.SHORT;
          signalStrength = currentCandle.signalStrength;
        }

        if (direction && signalStrength > 0) {
          pendingSignalsAtTimestamp.push({
            pairSymbol,
            direction,
            signalStrength,
            candle: currentCandle,
          });
        }
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
    // НОВОЕ: Финальная проверка капитала перед обработкой последних сигналов
    const minimalRequiredCapital = params.initialPortfolioCapital * 0.05; // 5% от первоначального капитала
    if (currentPortfolioCapital >= minimalRequiredCapital || activeTradesPortfolio.size > 0) {
      currentPortfolioCapital = await processPortfolioPendingSignals(
        pendingSignalsAtTimestamp,
        currentPortfolioCapital,
        activeTradesPortfolio,
        maxConcurrentTrades,
        tradesByPair,
        params.strategyParameters?.risk,
        executionProfile,
        simulateConfirmation
      );
    } else {
      logger.warn(`[RunPortfolioBacktest] Пропущена финальная обработка ${pendingSignalsAtTimestamp.length} сигналов из-за недостатка капитала (${currentPortfolioCapital.toFixed(2)} < ${minimalRequiredCapital.toFixed(2)})`);
    }
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
  // ЕДИНИЦЫ: наружу проценты, внутри формул десятичные значения
  const portfolioWinRateDecimal = allTrades.length > 0 ? portfolioWinningTrades / allTrades.length : 0;
  const portfolioWinRate = portfolioWinRateDecimal * 100;

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
    
    const lossRate = 1 - portfolioWinRateDecimal;
    portfolioExpectancy = (portfolioWinRateDecimal * avgWinningTrade) - (lossRate * avgLosingTrade);
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
  riskSettings?: RiskManagementSettings,
  executionProfile: ExecutionProfile = DEFAULT_EXECUTION_PROFILE,
  simulateConfirmation = false
): Promise<number> {
  let updatedCapital = currentPortfolioCapital;
  
  // Важное логирование для отслеживания лимита
  logger.info(`[ProcessPortfolioSignals] Processing ${signals.length} signals with capital ${currentPortfolioCapital}. Active trades: ${activeTradesPortfolio.size}/${maxConcurrentTrades}`);
  
  // Сортируем сигналы по силе (по убыванию)
  signals.sort((a, b) => b.signalStrength - a.signalStrength);

  let signalsProcessed = 0;
  let signalsSkippedDueToLimit = 0;
  let signalsSkippedDueToATR = 0;
  let signalsSkippedDueToCapital = 0;

  for (const signal of signals) {
    signalsProcessed++;
    
    // Проверяем лимит одновременных сделок
    if (activeTradesPortfolio.size >= maxConcurrentTrades) {
      signalsSkippedDueToLimit++;
      // ВАЖНО: Логируем каждый пропущенный сигнал из-за лимита
      logger.info(`[ProcessPortfolioSignals] SKIPPED signal ${signalsProcessed}/${signals.length} for ${signal.pairSymbol} (${signal.direction}, strength: ${signal.signalStrength.toFixed(2)}) - Max concurrent trades limit (${maxConcurrentTrades}) reached. Active: ${activeTradesPortfolio.size}`);
      continue; // Изменено с break на continue для учета всех пропусков
    }

    logger.debug(`[ProcessPortfolioSignals] Processing signal ${signalsProcessed}/${signals.length} for ${signal.pairSymbol}: ${signal.direction}, strength: ${signal.signalStrength}`);

    if (!signal.candle.atr || signal.candle.atr <= 0) {
      signalsSkippedDueToATR++;
      logger.debug(`[ProcessPortfolioSignals] No valid ATR for ${signal.pairSymbol}. ATR: ${signal.candle.atr}. Skipping signal.`);
      continue;
    }

    const entryPrice = signal.candle.close;
    const slippageFactor = executionProfile ? 1 + (executionProfile.slippageBps / 10_000) * (signal.direction === TradeDirection.LONG ? 1 : -1) : 1;
    const fillPrice = entryPrice * slippageFactor;
    const positionSize = calculatePositionSize(updatedCapital, fillPrice, signal.candle, riskSettings);

    logger.debug(`[ProcessPortfolioSignals] Calculated position size for ${signal.pairSymbol}: ${positionSize}, entry price: ${entryPrice}, capital: ${updatedCapital}`);

    if (positionSize <= 0) {
      signalsSkippedDueToCapital++;
      logger.debug(`[ProcessPortfolioSignals] Position size is 0 or negative for ${signal.pairSymbol}. Insufficient capital.`);
      continue;
    }

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

    const newTrade: InternalTrade = {
      id: uuidv4(),
      pair: signal.pairSymbol,
      direction: signal.direction,
      entryTimestamp: signal.candle.timestamp,
      entryPrice: fillPrice,
      size: positionSize,
      stopLoss: stopLossPrice,
      takeProfit: takeProfitPrice,
      status: 'active',
    };

    if (riskSettings?.useTrailingStop && signal.candle.atr && signal.candle.atr > 0 && riskSettings.trailingStopOffsetMultiplier && riskSettings.trailingStopOffsetMultiplier > 0) {
      const offset = signal.candle.atr * riskSettings.trailingStopOffsetMultiplier;
      if (newTrade.direction === TradeDirection.LONG) {
        newTrade.trailingStop = fillPrice - offset;
      } else {
        newTrade.trailingStop = fillPrice + offset;
      }
    }

    if (simulateConfirmation) {
      newTrade.margin = undefined;
      newTrade.fees = newTrade.fees || 0;
    }

    const requiredMargin = fillPrice * positionSize / Math.max(executionProfile?.leverage ?? 1, 1);
    const entryFee = fillPrice * positionSize * (executionProfile?.tradingFeeRate ?? 0);
    updatedCapital -= requiredMargin;
    updatedCapital -= entryFee;
    newTrade.margin = requiredMargin;
    newTrade.fees = (newTrade.fees || 0) + entryFee;

    activeTradesPortfolio.set(signal.pairSymbol, newTrade);

    logger.info(`[ProcessPortfolioSignals] OPENED ${signal.direction} trade for ${signal.pairSymbol}. Signal strength: ${signal.signalStrength.toFixed(2)}, Entry: ${entryPrice}, Size: ${positionSize}, SL: ${stopLossPrice}, TP: ${takeProfitPrice}. Active trades: ${activeTradesPortfolio.size}/${maxConcurrentTrades}`);
  }

  logger.info(`[ProcessPortfolioSignals] Finished processing signals. Active trades: ${activeTradesPortfolio.size}/${maxConcurrentTrades}. Signals stats: Processed=${signalsProcessed}, SkippedLimit=${signalsSkippedDueToLimit}, SkippedATR=${signalsSkippedDueToATR}, SkippedCapital=${signalsSkippedDueToCapital}`);
  
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
  // ЕДИНИЦЫ: проценты наружу, десятичные для внутренних формул
  const winRateDecimal = totalTrades > 0 ? winningTrades / totalTrades : 0;
  const winRate = winRateDecimal * 100;

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

  const lossRate = 1 - winRateDecimal;
  const expectancy = (winRateDecimal * avgWinningTrade) - (lossRate * avgLosingTrade);

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
// const closeActiveTrade = (...) => { ... }; 