import { applyStrategyLogic, DefaultStrategyParameters } from '@/modules/strategy_logic/strategy';
import { getDefaultStrategyParameters } from '@/config/defaultStrategyParameters';

import { SignalContext, SignalEngine, SignalMetadata } from '../scanner.types';

export interface BasicSignalEngineOptions {
  strategyParamsOverride?: Record<string, any>;
}

export class BasicSignalEngine implements SignalEngine {
  readonly id = 'basic-strategy-engine';

  constructor(private readonly options: BasicSignalEngineOptions = {}) {}

  async evaluate(candles: any[], context: SignalContext): Promise<SignalMetadata | SignalMetadata[] | null> {
    const strategyParams =
      typeof this.options.strategyParamsOverride === 'object'
        ? { ...getDefaultStrategyParameters(), ...this.options.strategyParamsOverride }
        : getDefaultStrategyParameters();

    if (!Array.isArray(candles) || candles.length === 0) {
      return null;
    }

    const validCandles = candles.filter((candle) => typeof candle.timestamp === 'number' && candle.timestamp > 0);
    if (validCandles.length < 2) {
      console.warn('[BasicSignalEngine] Not enough valid candles with timestamps - skipping evaluation', {
        pair: context.pairSymbol,
        timeframe: context.timeframe,
        received: candles.length,
        valid: validCandles.length,
      });
      return null;
    }

    const normalizedCandles = validCandles.map((candle) => ({
      ...candle,
      timestamp: Math.floor(Number(candle.timestamp)),
    }));

    const strategyResult = applyStrategyLogic(normalizedCandles, strategyParams);
    const lastCandle = strategyResult.strategyCandles?.[strategyResult.strategyCandles.length - 1];

    if (!lastCandle) {
      return null;
    }

    const direction = lastCandle.entryConditionLong
      ? 'long'
      : lastCandle.entryConditionShort
      ? 'short'
      : null;

    if (!direction) {
      return null;
    }

    const strength = typeof lastCandle.signalStrength === 'number'
      ? Math.max(0, Math.min(1, lastCandle.signalStrength))
      : 0.5;

    const entryPrice = lastCandle.close;
    const atrValue = typeof lastCandle.atr === 'number' && Number.isFinite(lastCandle.atr) ? lastCandle.atr : undefined;
    const configStopLossMultiplier = strategyParams.risk?.stopLossMultiplier
      ?? DefaultStrategyParameters.risk?.stopLossMultiplier
      ?? 2;
    const configTakeProfitMultiplier = strategyParams.risk?.takeProfitMultiplier
      ?? DefaultStrategyParameters.risk?.takeProfitMultiplier
      ?? 5;
    const stopLossMultiplier = this.options.strategyParamsOverride?.risk?.stopLossMultiplier ?? configStopLossMultiplier;
    const takeProfitMultiplier = this.options.strategyParamsOverride?.risk?.takeProfitMultiplier ?? configTakeProfitMultiplier;

    let stopLoss: number | undefined;
    let takeProfit: number | undefined;

    if (atrValue && atrValue > 0) {
      if (direction === 'long') {
        stopLoss = entryPrice - atrValue * stopLossMultiplier;
        takeProfit = entryPrice + atrValue * takeProfitMultiplier;
      } else {
        stopLoss = entryPrice + atrValue * stopLossMultiplier;
        takeProfit = entryPrice - atrValue * takeProfitMultiplier;
      }
      // предотвращаем отрицательные или нулевые значения
      if (stopLoss <= 0) stopLoss = undefined;
      if (takeProfit <= 0) takeProfit = undefined;
    }

    const candleTimestamp = lastCandle.timestamp ? Math.floor(Number(lastCandle.timestamp)) : undefined;
    const detectedAtValue = Date.now();
    
    console.log('[BasicSignalEngine] Signal detection:', {
      pair: context.pairSymbol,
      timeframe: context.timeframe,
      direction,
      lastCandleTimestamp: candleTimestamp,
      lastCandleTimestampDate: candleTimestamp ? new Date(candleTimestamp).toISOString() : null,
      detectedAt: detectedAtValue,
      detectedAtDate: new Date(detectedAtValue).toISOString(),
      entryPrice,
    });

    const signal: SignalMetadata = {
      pairSymbol: context.pairSymbol,
      timeframe: context.timeframe,
      exchange: context.exchange,
      detectedAt: detectedAtValue, // ✅ Timestamp свечи, на которой обнаружен сигнал
      strategyId: this.id,
      strength,
      direction,
      entryPrice,
      stopLoss,
      takeProfit,
      additionalData: {
        signalStrength: lastCandle.signalStrength,
        atr: lastCandle.atr,
        candleTimestamp, // Сохраняем исходный timestamp свечи
      },
    };

    return signal;
  }
}

export default BasicSignalEngine;

