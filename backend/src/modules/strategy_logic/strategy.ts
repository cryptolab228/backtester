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
  period?: number; 
  dlcPeriod?: number; 
  pocLookback?: number; 
  numProfiles?: number; 
  pocColor?: string;
  vahColor?: string;
  valColor?: string;
  numBins?: number; // Будет 100 по умолчанию
  vaPercentage?: number; // Будет 0.7 по умолчанию
}

export interface NWESettings {
  enabled?: boolean; // Новый параметр
  bandwidth?: number; // Новый параметр (h)
  multiplier?: number; // Переименовано с atrMultiplier (mult)
  source?: 'open' | 'high' | 'low' | 'close'; // Новый параметр (nwe_src)
  repaint?: boolean; // Новый параметр
  // lookbackPeriod и atrPeriod удалены из настроек NWE, т.к. в Pine они внутренние или не настраиваются для NWE напрямую
  upColor?: string;
  downColor?: string;
}

export interface ClusterSettings {
  source?: 'delta' | 'volume'; 
  minVolumeThresholdMultiplier?: number; // Переименовано с thresholdMultiplier
  deltaThreshold?: number; // Новый параметр
  lookbackPeriod?: number; // Для среднего объема/дельты
  confirmationBars?: number; // Для подтверждения кластера
  buyColor?: string;
  sellColor?: string;
}

export interface RiskManagementSettings {
  atrPeriod?: number; 
  stopLossMultiplier?: number; 
  takeProfitMultiplier?: number; 
  useTrailingStop?: boolean; 
  trailingStopOffsetMultiplier?: number; 
  trailingStopStepMultiplier?: number; // Новый параметр
  maxTradesPerDay?: number; 
  positionSizePercentage?: number; 
  maxRiskPerTradePercentage?: number; 
}

export interface StrategyParameters {
  dlc?: DLCSettings;
  nwe?: NWESettings;
  clusters?: ClusterSettings;
  risk?: RiskManagementSettings;
  // globalAtrPeriod и avgVolumePeriod удалены
}

// Добавляем экспорт настроек по умолчанию
export const DefaultStrategyParameters: StrategyParameters = {
  dlc: {
    period: 40, // Pine: dlc_period
    dlcPeriod: 40, // Используем period для основного окна VP, dlcPeriod уже был, оставляем для совместимости если где-то использовался, но Pine dlc_period -> period
    pocLookback: 5,  // Pine: poc_lookback
    numProfiles: 1,
    pocColor: '#FF0000',
    vahColor: '#00FF00',
    valColor: '#0000FF',
    numBins: 100, // Pine: внутренне 100 для VP
    vaPercentage: 0.7, // Pine: value_area_percent (70.0 / 100)
  },
  nwe: {
    enabled: true, // Pine: use_nwe
    bandwidth: 8.0, // Pine: h
    multiplier: 3.0, // Pine: mult
    source: 'close', // Pine: nwe_src
    repaint: false, // Pine: repaint
    upColor: '#00FFFF',
    downColor: '#FFFF00',
  },
  clusters: {
    source: 'volume', // Pine: Cluster source (volume/delta based on logic)
    minVolumeThresholdMultiplier: 1.5, // Pine: min_volume_threshold
    deltaThreshold: 0.7, // Pine: delta_threshold
    lookbackPeriod: 20, // Pine: avg_volume = ta.sma(volume, 20)
    confirmationBars: 1, // Pine: bullish_cluster[1]
    buyColor: '#00FF00',
    sellColor: '#FF0000',
  },
  risk: {
    atrPeriod: 14, // Pine: atr_period
    positionSizePercentage: 0.02, // Pine: risk_percent (2.0 / 100)
    stopLossMultiplier: 2.0, // Pine: stop_loss_atr
    takeProfitMultiplier: 5.0, // Pine: take_profit_atr
    useTrailingStop: true, // Pine: use_trailing_stop
    trailingStopOffsetMultiplier: 2.0, // Pine: trail_offset_mult
    trailingStopStepMultiplier: 1.0, // Pine: trailing_step (ATR множитель для шага)
    maxTradesPerDay: 2, // Pine: max_trades_per_day
    maxRiskPerTradePercentage: 0.01, // Остается для доп. контроля
  },
  // globalAtrPeriod и avgVolumePeriod удалены
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

  // Обновленное извлечение параметров
  const atrPeriodForRisk = params.risk?.atrPeriod ?? 14;
  
  // Параметры NWE
  const nweEnabled = params.nwe?.enabled ?? true;
  const nweBandwidth = params.nwe?.bandwidth ?? 8.0;
  const nweMultiplier = params.nwe?.multiplier ?? 3.0;
  const nweSource = params.nwe?.source ?? 'close';
  // const nweRepaint = params.nwe?.repaint ?? false; // Пока не используется в вызове calculateNWE

  const vpNumBins = params.dlc?.numBins ?? 100;
  const vpVaPercentage = params.dlc?.vaPercentage ?? 0.7;
  const avgVolPeriod = params.clusters?.lookbackPeriod ?? 20;
  const clusterSource = params.clusters?.source ?? 'volume';
  const clusterMinVolumeThresholdMultiplier = params.clusters?.minVolumeThresholdMultiplier ?? 1.5;
  const clusterConfirmationBars = params.clusters?.confirmationBars ?? 1;
  const clusterDeltaThreshold = params.clusters?.deltaThreshold ?? 0.7;

  const dlcPeriod = params.dlc?.dlcPeriod ?? 40; 
  const pocLookback = params.dlc?.pocLookback ?? 5; 

  logger.debug(`[ApplyStrategyLogic] Params: atrPeriodForRisk=${atrPeriodForRisk}, nweEnabled=${nweEnabled}, nweBandwidth=${nweBandwidth}, nweMultiplier=${nweMultiplier}, nweSource=${nweSource}, vpBins=${vpNumBins}, vpVA%=${vpVaPercentage}, avgVolPeriod=${avgVolPeriod}, clusterSrc=${clusterSource}, clusterMinVolMultiplier=${clusterMinVolumeThresholdMultiplier}, clusterConfirmBars=${clusterConfirmationBars}, clusterDeltaThreshold=${clusterDeltaThreshold}, dlcPeriod=${dlcPeriod}, pocLookback=${pocLookback}`);

  const atrValues = calculateATR(candles, atrPeriodForRisk);
  
  let nweValues: NWEResultPoint[] = [];
  if (nweEnabled) {
    // Используем параметры, которые ожидает текущая реализация calculateNWE
    // lookbackPeriod и atrPeriod для NWE могут потребовать уточнения для точного соответствия Pine.
    // В Pine NWE `h` (bandwidth) и `mult` (multiplier) - ключевые. 
    // `lookbackPeriod` в Pine NWE обычно большой (около 500), `atrPeriod` не используется напрямую NWE.
    const nweCalcParams = {
      lookbackPeriod: 500, // Временное значение, близкое к Pine NWE, если ваша функция его использует.
      atrPeriod: atrPeriodForRisk, // Используем общий ATR период, если calculateNWE его ожидает.
      atrMultiplier: nweMultiplier // Используем новый nweMultiplier из параметров
    };
    logger.debug('[ApplyStrategyLogic] Calling calculateNWE with params:', nweCalcParams);
    nweValues = calculateNWE(candles, nweCalcParams);
  } else {
    // Если NWE отключен, создаем пустой массив с корректными полями NWEResultPoint
    nweValues = candles.map(() => ({ nweUpper: null, nweLower: null }));
  }

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
    
    let isClusterSignal = false;
    // volumeClusterStrength больше не используется напрямую в условиях входа Pine, но может быть полезен для логов
    // let volumeClusterStrength: number | undefined = undefined; 

    if (clusterSource === 'volume' && avgVolume > 0 && candle.volume > 0) {
      const threshold = avgVolume * clusterMinVolumeThresholdMultiplier; // Используем новое имя параметра
      if (candle.volume > threshold) {
        // isVolumeCluster = true; // переименовано в isClusterSignal или будет частью логики ниже
        // volumeClusterStrength = candle.volume / avgVolume;
      }
    }
    // TODO: Добавить логику для clusterSource === 'delta' с использованием approxDelta и clusterDeltaThreshold
    

    // --- НАЧАЛО: Новые условия входа на основе Pine Script ---
    let entryConditionLong = false;
    let entryConditionShort = false;

    // NWE сигналы (аналогично Pine)
    // Убедимся, что nwePoint корректно обрабатывается, если NWE отключен (nweValues будет содержать nulls)
    const currentNwePoint = nweValues[index];
    const nweBuySignal = nweEnabled && currentNwePoint?.nweLower !== null && candle.close > (currentNwePoint?.nweLower ?? -Infinity);
    const nweSellSignal = nweEnabled && currentNwePoint?.nweUpper !== null && candle.close < (currentNwePoint?.nweUpper ?? Infinity);

    // Кластерные сигналы с учетом VAH/VAL (аналогично Pine, bullish_cluster / bearish_cluster)
    // Pine: bullish_cluster = high_volume and delta > 0 and strong_delta and low < val_price and close > open
    // Pine: bearish_cluster = high_volume and delta < 0 and strong_delta and high > vah_price and close < open
    
    // high_volume условие:
    const isHighVolume = candle.volume > (avgVolume * clusterMinVolumeThresholdMultiplier);
    // strong_delta условие (приблизительно):
    // В Pine: delta_ratio = math.abs(delta) / volume; strong_delta = delta_ratio > delta_threshold
    // У нас есть approxDelta. Если volume = 0, delta_ratio будет NaN или Infinity.
    const deltaRatio = candle.volume !== 0 ? Math.abs(approxDelta) / candle.volume : 0;
    const isStrongDelta = deltaRatio > clusterDeltaThreshold;

    let bullishCluster = false;
    if (dynamicVal !== null && pocDirection > 0) { // Добавлена проверка pocDirection > 0
        bullishCluster = isHighVolume && approxDelta > 0 && isStrongDelta && candle.low < dynamicVal && candle.close > candle.open;
    }

    let bearishCluster = false;
    if (dynamicVah !== null && pocDirection < 0) { // Добавлена проверка pocDirection < 0
        bearishCluster = isHighVolume && approxDelta < 0 && isStrongDelta && candle.high > dynamicVah && candle.close < candle.open;
    }
    
    // Подтверждение кластера (если confirmationBars > 0)
    if (clusterConfirmationBars > 0 && index >= clusterConfirmationBars) {
        let prevBullishCluster = true;
        let prevBearishCluster = true;
        for (let k = 1; k <= clusterConfirmationBars; k++) {
            const prevCandleSignals = strategyCandles[index - k]; // Предполагаем, что strategyCandles содержит поля для кластеров
            // TODO: Нужно будет добавить поля bullishClusterSignal / bearishClusterSignal в StrategyCandle
            // и заполнять их перед этой проверкой, или пересчитывать условия кластера для предыдущих свечей здесь.
            // Пока что эта логика не будет работать корректно без хранения сигналов кластера.
            // Для упрощения, пока уберем эту сложную часть подтверждения и вернемся к ней.
            // bullishCluster = bullishCluster && prevCandleSignals.isBullishClusterConfirmed; // Пример
            // bearishCluster = bearishCluster && prevCandleSignals.isBearishClusterConfirmed; // Пример
        }
        // В Pine: bullish_reaction = bullish_cluster[1] and close > open 
        // Это означает, что сам кластер был на предыдущей свече, а текущая свеча - реакция.
        // Текущая логика `bullishCluster` и `bearishCluster` определяет кластер НА ТЕКУЩЕЙ свече.
        // Нужно будет сдвинуть эту логику или проверку на 1 бар назад для соответствия `cluster[1]`
    }

    // Условия для входа в позицию (Pine: (poc_direction > 0 and bullish_cluster) or (poc_direction > 0 and nwe_buy_signal))
    if (pocDirection > 0 && (bullishCluster || nweBuySignal)) {
      entryConditionLong = true;
    }

    // Pine: (poc_direction < 0 and bearish_cluster) or (poc_direction < 0 and nwe_sell_signal)
    if (pocDirection < 0 && (bearishCluster || nweSellSignal)) {
      entryConditionShort = true;
    }

    // --- КОНЕЦ: Новые условия входа --- 

    // Логирование для отладки динамического POC и условий
    if (dynamicPoc !== null && (index < dlcPeriod + 5 || index > candles.length - 5 || entryConditionLong || entryConditionShort)) {
        logger.debug(`[Candle-${index}] Time: ${new Date(candle.timestamp).toISOString()}, DynPOC: ${dynamicPoc?.toFixed(2)}, DynVAH: ${dynamicVah?.toFixed(2)}, DynVAL: ${dynamicVal?.toFixed(2)}, POCDir: ${pocDirection}, BullClust: ${bullishCluster}, BearClust: ${bearishCluster}, NWELong: ${nweBuySignal}, NWEShort: ${nweSellSignal}, LongCond: ${entryConditionLong}, ShortCond: ${entryConditionShort}`);
    }


    strategyCandles.push({
      ...candle,
      atr: currentAtr,
      nweUpper: currentNwePoint?.nweUpper, // Используем nweUpper
      nweLower: currentNwePoint?.nweLower, // Используем nweLower
      avgVolume: avgVolume,
      approxDelta: approxDelta,
      isVolumeCluster: isClusterSignal, // Это все еще старый isVolumeCluster, нужно подумать, как его совместить с bullish/bearishClusterSignal
      volumeClusterStrength: isClusterSignal ? 1 : undefined,
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