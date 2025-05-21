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
import logger from '../../utils/logger'; // Импорт логгера

export interface DLCSettings {
  period?: number; // Период для расчета Volume Profile (например, дневной)
  dlcPeriod?: number; // <--- ДОБАВЛЕНО: Период окна для динамического VP (аналог dlc_period в Pine)
  pocLookback?: number; // <--- ДОБАВЛЕНО: Период для определения направления POC (аналог poc_lookback в Pine)
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
    dlcPeriod: 40, // <--- ДОБАВЛЕНО: Значение по умолчанию как в Pine
    pocLookback: 5,  // <--- ДОБАВЛЕНО: Значение по умолчанию как в Pine
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
    positionSizePercentage: 0.01, // 1% от капитала
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
  candlesInput: CandleData[], // Переименовано для ясности
  params: StrategyParameters
): StrategyLogicResult => {
  if (!candlesInput || candlesInput.length === 0) {
    return { strategyCandles: [], volumeProfile: null };
  }

  // Гарантируем, что все данные OHLCV являются числовыми для всех вычислений
  const candles: CandleData[] = candlesInput.map(c => ({
    timestamp: Number(c.timestamp), // Уже должно быть числом, но для согласованности
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
    volume: Number(c.volume),
    // volumeQuote также может нуждаться в преобразовании, если присутствует и используется
    ...(typeof (c as any).volumeQuote === 'string' || typeof (c as any).volumeQuote === 'number' 
        ? { volumeQuote: Number((c as any).volumeQuote) } 
        : {}),
  }));

  const globalAtrPeriod = params.globalAtrPeriod ?? params.risk?.atrPeriod ?? 14;
  const nweAtrPeriod = params.nwe?.atrPeriod ?? globalAtrPeriod ?? 10;
  const nweLookbackPeriod = params.nwe?.lookbackPeriod ?? 20;
  const nweAtrMultiplier = params.nwe?.atrMultiplier ?? 2;
  const vpNumBins = params.dlc?.numBins ?? 20;
  const vpVaPercentage = params.dlc?.vaPercentage ?? 0.7;
  const avgVolPeriod = params.clusters?.lookbackPeriod ?? params.avgVolumePeriod ?? 20;
  const clusterSource = params.clusters?.source ?? 'volume';
  const clusterThresholdMultiplier = params.clusters?.thresholdMultiplier ?? 2;
  const dlcPeriod = params.dlc?.dlcPeriod ?? 40; // <--- ДОБАВЛЕНО: Используем новый параметр
  const pocLookback = params.dlc?.pocLookback ?? 5; // <--- ДОБАВЛЕНО: Используем новый параметр

  logger.debug(`[ApplyStrategyLogic] Params: globalAtrPeriod=${globalAtrPeriod}, nweAtrPeriod=${nweAtrPeriod}, nweLookback=${nweLookbackPeriod}, nweMultiplier=${nweAtrMultiplier}, vpBins=${vpNumBins}, vpVA%=${vpVaPercentage}, avgVolPeriod=${avgVolPeriod}, clusterSrc=${clusterSource}, clusterMultiplier=${clusterThresholdMultiplier}, dlcPeriod=${dlcPeriod}, pocLookback=${pocLookback}`);

  const atrValues = calculateATR(candles, globalAtrPeriod);
  const nweValues = calculateNWE(candles, {
    lookbackPeriod: nweLookbackPeriod,
    atrPeriod: nweAtrPeriod,
    atrMultiplier: nweAtrMultiplier,
  });
  const avgVolumeValues = calculateAvgVolume(candles, avgVolPeriod);
  const approxDeltaValues = calculateApproxDelta(candles);
  
  // Логирование перед вызовом calculateVolumeProfile
  if (candles && candles.length > 0) { // Используем преобразованный массив 'candles'
    let minSliceLow = candles[0].low;
    let maxSliceHigh = candles[0].high;
    for (let k = 1; k < candles.length; k++) {
      if (candles[k].low < minSliceLow) minSliceLow = candles[k].low;
      if (candles[k].high > maxSliceHigh) maxSliceHigh = candles[k].high;
    }
    logger.debug(`[ApplyStrategyLogic] Before calling calculateVolumeProfile for the entire dataset (${candles.length} candles): MinLow=${minSliceLow}, MaxHigh=${maxSliceHigh}`);
    if (minSliceLow > maxSliceHigh) {
        logger.error(`[ApplyStrategyLogic] ANOMALY DETECTED in full dataset before VP: minLow (${minSliceLow}) > maxHigh (${maxSliceHigh}).`);
    }
  }

  const pocHistory: number[] = []; // <--- ДОБАВЛЕНО: История POC для pocDirection
  const strategyCandles: StrategyCandle[] = []; // Будем заполнять в цикле

  for (let index = 0; index < candles.length; index++) {
    const candle = candles[index];
    const currentAtr = atrValues[index];
    const nwePoint: NWEResultPoint | undefined = nweValues[index];
    const avgVolume = avgVolumeValues[index];
    const approxDelta = approxDeltaValues[index];

    let dynamicPoc: number | null = null;
    let dynamicVah: number | null = null;
    let dynamicVal: number | null = null;
    let pocDirection = 0;
    let currentVolumeProfile: VolumeProfileResult | null = null;

    if (index >= dlcPeriod -1) {
      const candleSliceForVP = candles.slice(index - dlcPeriod + 1, index + 1);
      if (candleSliceForVP.length === dlcPeriod) {
        currentVolumeProfile = calculateVolumeProfile(candleSliceForVP, vpNumBins, vpVaPercentage);
        if (currentVolumeProfile.poc !== null) {
          dynamicPoc = currentVolumeProfile.poc;
          dynamicVah = currentVolumeProfile.vah;
          dynamicVal = currentVolumeProfile.val;

          // Обновление истории POC и расчет pocDirection
          if (pocHistory.length >= pocLookback) {
            pocHistory.shift(); // Удаляем самый старый POC
          }
          pocHistory.push(dynamicPoc);

          if (pocHistory.length === pocLookback) {
            if (pocHistory[pocLookback - 1] > pocHistory[0]) {
              pocDirection = 1;
            } else if (pocHistory[pocLookback - 1] < pocHistory[0]) {
              pocDirection = -1;
            }
          }
        }
      }
    }
    
    let isVolumeCluster = false;
    let volumeClusterStrength: number | undefined = undefined;

    if (clusterSource === 'volume' && avgVolume > 0 && candle.volume > 0) {
      const threshold = avgVolume * clusterThresholdMultiplier;
      if (candle.volume > threshold) {
        isVolumeCluster = true;
        volumeClusterStrength = candle.volume / avgVolume;
        // Логирование кластера (можно оставить или изменить)
        // logger.debug(`[StrategyCandle-${index}] Volume Cluster DETECTED...`);
      }
    }

    // --- НАЧАЛО: Новые условия входа на основе Pine Script ---
    let entryConditionLong = false;
    let entryConditionShort = false;

    // NWE сигналы (аналогично Pine)
    const nweBuySignal = nwePoint?.nweLower !== null && candle.close > (nwePoint?.nweLower ?? -Infinity);
    const nweSellSignal = nwePoint?.nweUpper !== null && candle.close < (nwePoint?.nweUpper ?? Infinity);

    // Кластерные сигналы с учетом VAH/VAL (аналогично Pine, bullish_cluster / bearish_cluster)
    // Pine: bullish_cluster = high_volume and delta > 0 and strong_delta and low < val_price and close > open
    // Pine: bearish_cluster = high_volume and delta < 0 and strong_delta and high > vah_price and close < open
    // Для isVolumeCluster мы уже имеем high_volume. Добавим проверку дельты и VAH/VAL
    // strong_delta не реализован напрямую, но isVolumeCluster уже подразумевает значимость.
    // Мы можем упростить или добавить расчет strong_delta если потребуется.
    
    const approxDeltaRatio = avgVolume > 0 ? Math.abs(approxDelta) / candle.volume : 0; // Простая аппроксимация delta_ratio
    const strongDeltaThresholdPine = 0.7; // Из Pine
    const isStrongDelta = approxDeltaRatio > strongDeltaThresholdPine;

    let bullishClusterSignal = false;
    if (dynamicVal !== null && isVolumeCluster && approxDelta > 0 /*&& isStrongDelta*/ && candle.low < dynamicVal && candle.close > candle.open) {
        bullishClusterSignal = true;
    }

    let bearishClusterSignal = false;
    if (dynamicVah !== null && isVolumeCluster && approxDelta < 0 /*&& isStrongDelta*/ && candle.high > dynamicVah && candle.close < candle.open) {
        bearishClusterSignal = true;
    }
    
    if (pocDirection > 0) { // Тренд вверх по POC
      if (bullishClusterSignal || (nweBuySignal && (params.nwe?.lookbackPeriod ?? 0) > 0) ) { // Добавил условие, что NWE используется (lookbackPeriod > 0), как в Pine `use_nwe`
        entryConditionLong = true;
      }
    } else if (pocDirection < 0) { // Тренд вниз по POC
      if (bearishClusterSignal || (nweSellSignal && (params.nwe?.lookbackPeriod ?? 0) > 0) ) {
        entryConditionShort = true;
      }
    }
    // --- КОНЕЦ: Новые условия входа ---

    // Логирование для отладки динамического POC и условий
    if (dynamicPoc !== null && (index < dlcPeriod + 5 || index > candles.length - 5 || entryConditionLong || entryConditionShort)) {
        logger.debug(`[Candle-${index}] Time: ${new Date(candle.timestamp).toISOString()}, DynPOC: ${dynamicPoc?.toFixed(2)}, DynVAH: ${dynamicVah?.toFixed(2)}, DynVAL: ${dynamicVal?.toFixed(2)}, POCDir: ${pocDirection}, BullClust: ${bullishClusterSignal}, BearClust: ${bearishClusterSignal}, NWELong: ${nweBuySignal}, NWEShort: ${nweSellSignal}, LongCond: ${entryConditionLong}, ShortCond: ${entryConditionShort}`);
    }


    strategyCandles.push({
      ...candle,
      atr: currentAtr,
      nweUpper: nwePoint?.nweUpper,
      nweLower: nwePoint?.nweLower,
      avgVolume: avgVolume,
      approxDelta: approxDelta,
      isVolumeCluster: isVolumeCluster, // Это все еще старый isVolumeCluster, нужно подумать, как его совместить с bullish/bearishClusterSignal
      volumeClusterStrength: volumeClusterStrength,
      // Можно добавить поля для динамического POC, VAH, VAL если нужно их видеть в каждой свече
      // dynamicPoc: dynamicPoc, 
      // dynamicVah: dynamicVah,
      // dynamicVal: dynamicVal,
      entryConditionLong: entryConditionLong,
      entryConditionShort: entryConditionShort,
    });
  } // Конец цикла for по свечам

  // logger.info(`[ApplyStrategyLogic] Processed ${strategyCandles.length} candles.`);
  // Возвращаем volumeProfile: null, так как теперь он динамический
  return { strategyCandles, volumeProfile: null }; 
}; 