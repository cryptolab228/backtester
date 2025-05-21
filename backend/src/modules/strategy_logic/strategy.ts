// Файл для основной логики стратегии

import {
  CandleData,
  calculateATR,
  calculateVolumeProfile,
  VolumeProfileResult,
  calculateNWE,
  NWEResultPoint,
  calculateAvgVolume,
  calculateApproxDelta,
} from './indicators';

export interface DLCSettings {
  period?: number; // Период для расчета Volume Profile (например, дневной)
  numProfiles?: number; // Количество профилей для отображения/расчета (например, 1 для текущего, 2 для текущего и предыдущего)
  pocColor?: string;
  vahColor?: string;
  valColor?: string;
  numBins?: number;
  vaPercentage?: number;
}

export interface NWESettings {
  lookbackPeriod?: number; // Период для поиска экстремумов NWE (уже было nweLookback)
  atrPeriod?: number; // Период ATR для определения силы волны NWE
  atrMultiplier?: number; // Множитель ATR для порога NWE
  upColor?: string;
  downColor?: string;
}

export interface ClusterSettings {
  source?: 'delta' | 'volume'; // Источник для кластеров (дельты или объема)
  thresholdMultiplier?: number; // Множитель для определения значительного кластера (например, от среднего объема/дельты)
  lookbackPeriod?: number; // Период для расчета базового значения (среднего объема/дельты)
  confirmationBars?: number; // Количество баров для подтверждения кластера
  buyColor?: string;
  sellColor?: string;
}

export interface RiskManagementSettings {
  atrPeriod?: number; // Период ATR для расчета SL/TP (уже было atrPeriod)
  stopLossMultiplier?: number; // Множитель ATR для стоп-лосса
  takeProfitMultiplier?: number; // Множитель ATR для тейк-профита
  useTrailingStop?: boolean; // Использовать ли трейлинг-стоп
  trailingStopOffsetMultiplier?: number; // Множитель ATR для смещения трейлинг-стопа
  maxTradesPerDay?: number; // Максимальное количество сделок в день
  positionSizePercentage?: number; // Процент от капитала на сделку
  maxRiskPerTradePercentage?: number; // Максимальный риск на сделку в процентах от капитала (например, 0.01 для 1%)
}

export interface StrategyParameters {
  dlc?: DLCSettings;
  nwe?: NWESettings;
  clusters?: ClusterSettings;
  risk?: RiskManagementSettings;
  globalAtrPeriod?: number; // Общий период ATR, если нужен одинаковый для разных модулей
  avgVolumePeriod?: number; // Период для AvgVolume
}

// Добавляем экспорт настроек по умолчанию
export const DefaultStrategyParameters: StrategyParameters = {
  dlc: {
    period: undefined, // Например, можно не устанавливать по умолчанию или задать конкретное значение, если оно всегда нужно
    numProfiles: 1,
    pocColor: '#FF0000',
    vahColor: '#00FF00',
    valColor: '#0000FF',
    numBins: 20,
    vaPercentage: 0.7,
  },
  nwe: {
    lookbackPeriod: 20,
    atrPeriod: 10, // Может наследоваться от globalAtrPeriod или risk.atrPeriod
    atrMultiplier: 2,
    upColor: '#00FFFF',
    downColor: '#FFFF00',
  },
  clusters: {
    source: 'volume',
    thresholdMultiplier: 2,
    lookbackPeriod: 20, // Для среднего объема
    confirmationBars: 0, // Пока не используется активно
    buyColor: '#00FF00',
    sellColor: '#FF0000',
  },
  risk: {
    atrPeriod: 14,
    stopLossMultiplier: 1.5,
    takeProfitMultiplier: 3,
    useTrailingStop: false,
    trailingStopOffsetMultiplier: 1,
    maxTradesPerDay: 0, // 0 - без ограничений
    positionSizePercentage: 0.01, // 1% от капитала, если ATR метод не сработает
    maxRiskPerTradePercentage: 0.01, // 1% риска на сделку
  },
  globalAtrPeriod: 14,
  avgVolumePeriod: 20,
};

export interface StrategyCandle extends CandleData {
  atr?: number;
  nweUpper?: number | null;
  nweLower?: number | null;
  avgVolume?: number;
  approxDelta?: number;
  isVolumeCluster?: boolean;
  volumeClusterStrength?: number;
  entryConditionLong?: boolean;
  entryConditionShort?: boolean;
}

export interface StrategyLogicResult {
  strategyCandles: StrategyCandle[];
  volumeProfile: VolumeProfileResult | null;
}

export const applyStrategyLogic = (
  candles: CandleData[],
  params: StrategyParameters
): StrategyLogicResult => {
  if (!candles || candles.length === 0) {
    return { strategyCandles: [], volumeProfile: null };
  }

  const globalAtrPeriod = params.globalAtrPeriod ?? params.risk?.atrPeriod ?? 14;
  const nweAtrPeriod = params.nwe?.atrPeriod ?? globalAtrPeriod ?? 10;
  const nweLookbackPeriod = params.nwe?.lookbackPeriod ?? 20;
  const nweAtrMultiplier = params.nwe?.atrMultiplier ?? 2;
  const vpNumBins = params.dlc?.numBins ?? 20;
  const vpVaPercentage = params.dlc?.vaPercentage ?? 0.7;
  const avgVolPeriod = params.clusters?.lookbackPeriod ?? params.avgVolumePeriod ?? 20;
  const clusterSource = params.clusters?.source ?? 'volume';
  const clusterThresholdMultiplier = params.clusters?.thresholdMultiplier ?? 2;

  const atrValues = calculateATR(candles, globalAtrPeriod);
  const nweValues = calculateNWE(candles, {
    lookbackPeriod: nweLookbackPeriod,
    atrPeriod: nweAtrPeriod,
    atrMultiplier: nweAtrMultiplier,
  });
  const avgVolumeValues = calculateAvgVolume(candles, avgVolPeriod);
  const approxDeltaValues = calculateApproxDelta(candles);
  
  const volumeProfileResult = calculateVolumeProfile(candles, vpNumBins, vpVaPercentage);

  const strategyCandles: StrategyCandle[] = candles.map((candle, index) => {
    const nwePoint: NWEResultPoint | undefined = nweValues[index];
    let isVolumeCluster = false;
    let volumeClusterStrength: number | undefined = undefined;
    let entryConditionLong = false;
    let entryConditionShort = false;

    if (clusterSource === 'volume' && avgVolumeValues[index] > 0 && candle.volume > 0) {
      const threshold = avgVolumeValues[index] * clusterThresholdMultiplier;
      if (candle.volume > threshold) {
        isVolumeCluster = true;
        volumeClusterStrength = candle.volume / avgVolumeValues[index];
      }
    }

    if (volumeProfileResult && volumeProfileResult.poc !== null) {
      const { poc } = volumeProfileResult;

      if (
        candle.close > poc &&
        isVolumeCluster &&
        (nwePoint?.nweLower === null || candle.close > (nwePoint?.nweLower ?? -Infinity))
      ) {
        entryConditionLong = true;
      }

      if (
        candle.close < poc &&
        isVolumeCluster &&
        (nwePoint?.nweUpper === null || candle.close < (nwePoint?.nweUpper ?? Infinity))
      ) {
        entryConditionShort = true;
      }
    }

    return {
      ...candle,
      atr: atrValues[index] > 0 ? atrValues[index] : undefined,
      nweUpper: nwePoint?.nweUpper,
      nweLower: nwePoint?.nweLower,
      avgVolume: avgVolumeValues[index] > 0 ? avgVolumeValues[index] : undefined,
      approxDelta: approxDeltaValues[index],
      isVolumeCluster,
      volumeClusterStrength,
      entryConditionLong,
      entryConditionShort,
    };
  });

  return {
    strategyCandles,
    volumeProfile: volumeProfileResult,
  };
}; 