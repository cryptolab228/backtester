// Файл для основной логики стратегии

import logger from '../../utils/logger'; // Импорт логгера
import {
  CandleData,
  calculateATR,
  calculateVolumeProfile,
  VolumeProfileResult,
  calculateNWE,
  NWEResultPoint,
  calculateAvgVolume,
  calculateApproxDelta,
  NWECalculationParams
} from './indicators';

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
    maxRiskPerTradePercentage: 0.02, // ИЗМЕНЕНО с 0.01 на 0.02 для соответствия positionSizePercentage
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
  volumeClusterStrength?: number | undefined;
  entryConditionLong?: boolean;
  entryConditionShort?: boolean;
  signalStrength?: number | null;
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
  const atrPeriodForRisk = params.risk?.atrPeriod ?? DefaultStrategyParameters.risk!.atrPeriod!;
  
  // Параметры NWE
  const nweEnabled = params.nwe?.enabled ?? DefaultStrategyParameters.nwe!.enabled!;
  const nweBandwidth = params.nwe?.bandwidth ?? DefaultStrategyParameters.nwe!.bandwidth!;
  const nweMultiplier = params.nwe?.multiplier ?? DefaultStrategyParameters.nwe!.multiplier!;
  const nweSource = params.nwe?.source ?? DefaultStrategyParameters.nwe!.source!;
  // const nweRepaint = params.nwe?.repaint ?? DefaultStrategyParameters.nwe!.repaint!; // Параметр repaint пока не используется в вызове calculateNWE

  const vpNumBins = params.dlc?.numBins ?? DefaultStrategyParameters.dlc!.numBins!;
  const vpVaPercentage = params.dlc?.vaPercentage ?? DefaultStrategyParameters.dlc!.vaPercentage!;
  const avgVolPeriod = params.clusters?.lookbackPeriod ?? 20;
  const clusterSource = params.clusters?.source ?? 'volume';
  const clusterMinVolumeThresholdMultiplier = params.clusters?.minVolumeThresholdMultiplier ?? 1.5;
  const clusterConfirmationBars = params.clusters?.confirmationBars ?? 1;
  const clusterDeltaThreshold = params.clusters?.deltaThreshold ?? 0.7;

  const dlcPeriod = params.dlc?.dlcPeriod ?? 40; 
  const pocLookback = params.dlc?.pocLookback ?? 5; 

  const atrValues = calculateATR(candles, atrPeriodForRisk);
  
  let nweValues: NWEResultPoint[] = [];
  if (nweEnabled) {
    // Используем параметры, которые ожидает текущая реализация calculateNWE,
    // а также пытаемся передать ключевые параметры NWE (source, bandwidth),
    // предполагая, что calculateNWE сможет их использовать.
    const nweCalcParamsForIndicator = {
      // Параметры, которые, возможно, ожидает текущая версия calculateNWE:
      lookbackPeriod: 500, // Фиксированное значение, возможно, специфичное для текущей реализации calculateNWE
      atrPeriod: atrPeriodForRisk, // Используем общий ATR период, если calculateNWE его ожидает для внутренних нужд
      
      // Ключевые параметры NWE, которые должны использоваться:
      source: nweSource,           // Источник цены (например, 'close')
      bandwidth: nweBandwidth,       // Параметр 'h' для NWE
      atrMultiplier: nweMultiplier,  // Основной множитель для NWE (в params.nwe называется 'multiplier')
      // repaint: nweRepaint       // Если/когда calculateNWE будет поддерживать repaint
    };
    
    // Вызов calculateNWE. Если его сигнатура строго определена и не принимает source/bandwidth напрямую,
    // эти поля будут проигнорированы им, если не используется 'as any' или подобное.
    // Важно, чтобы реализация calculateNWE соответствовала ожиданиям по этим параметрам.
    nweValues = calculateNWE(candles, nweCalcParamsForIndicator as any); // Используем 'as any' для гибкости передачи параметров, если сигнатура calculateNWE строгая
  } else {
    // Если NWE отключен, создаем пустой массив с корректными полями NWEResultPoint
    // Создаем фиктивные параметры для соответствия интерфейсу
    const dummyParams: NWECalculationParams = {
      source: 'close',
      bandwidth: 1,
      multiplier: 1,
      lookbackPeriod: 1,
      atrPeriod: 1
    };
    nweValues = candles.map(() => ({ nweUpper: null, nweLower: null, params: dummyParams }));
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
    if (minSliceLow > maxSliceHigh) {
        logger.error(`[ApplyStrategyLogic] ANOMALY DETECTED in full dataset before VP: minLow (${minSliceLow}) > maxHigh (${maxSliceHigh}).`);
    }
  }

  const pocHistory: (number | null)[] = [];
  const vahHistory: (number | null)[] = [];
  const valHistory: (number | null)[] = [];

  // === ОПТИМИЗАЦИЯ VOLUME PROFILE ===
  // Кэш для Volume Profile результатов чтобы избежать дублирующих вычислений
  const vpCache = new Map<string, VolumeProfileResult>();
  const VP_CACHE_MAX_SIZE = 1000; // Максимум 1000 кэшированных результатов
  const VP_CALCULATION_INTERVAL = 10; // Вычисляем VP только каждые 10 свечей
  
  // Основной цикл по свечам для применения логики
  const strategyCandles = candles.map((candle, index) => {
    const currentAtr = atrValues[index];
    const currentNwe = nweEnabled ? nweValues[index] : { nweUpper: null, nweLower: null };
    const currentAvgVolume = avgVolumeValues[index];
    const currentApproxDelta = approxDeltaValues[index];

    const strategyCandle: StrategyCandle = {
      ...candle,
      atr: currentAtr,
      nweUpper: currentNwe?.nweUpper,
      nweLower: currentNwe?.nweLower,
      avgVolume: currentAvgVolume,
      approxDelta: currentApproxDelta,
      entryConditionLong: false,
      entryConditionShort: false,
      signalStrength: null,
      isVolumeCluster: false, 
      volumeClusterStrength: undefined,
    };

    // --- ОПТИМИЗИРОВАННЫЙ расчет Volume Profile ---
    let currentVpResult: VolumeProfileResult | null = null;
    
    // Вычисляем VP только при достаточных данных и с интервалом
    if (index >= dlcPeriod - 1 && (index % VP_CALCULATION_INTERVAL === 0 || index === candles.length - 1)) {
      const vpSlice = candles.slice(index - dlcPeriod + 1, index + 1);
      
      // Создаем кэш-ключ на основе временного диапазона и размера среза
      const cacheKey = `${vpSlice[0].timestamp}-${vpSlice[vpSlice.length - 1].timestamp}-${vpSlice.length}`;
      
      // Проверяем кэш
      if (vpCache.has(cacheKey)) {
        currentVpResult = vpCache.get(cacheKey)!;
      } else {
        // Вычисляем только если данных достаточно для осмысленного профиля
        if (vpSlice.length >= 10) { // Минимум 10 свечей для профиля
          try {
      currentVpResult = calculateVolumeProfile(vpSlice, vpNumBins, vpVaPercentage);
            
            // Сохраняем в кэш с ограничением размера
            if (vpCache.size >= VP_CACHE_MAX_SIZE) {
              // Удаляем самый старый элемент
              const firstKey = vpCache.keys().next().value;
              if (firstKey) {
                vpCache.delete(firstKey);
              }
            }
            vpCache.set(cacheKey, currentVpResult);
          } catch (error: any) {
            // logger.warn(`VP calculation failed for slice at index ${index}: ${error.message}`);
            currentVpResult = null;
          }
        }
      }
    }
    
    // Используем последний вычисленный результат, если текущий не вычислялся
    if (!currentVpResult && index > 0) {
      // Ищем последний доступный VP результат в предыдущих свечах
      for (let lookback = 1; lookback <= Math.min(VP_CALCULATION_INTERVAL, index); lookback++) {
        const prevIndex = index - lookback;
        if (prevIndex >= 0) {
          const vpSlice = candles.slice(Math.max(0, prevIndex - dlcPeriod + 1), prevIndex + 1);
          const cacheKey = `${vpSlice[0].timestamp}-${vpSlice[vpSlice.length - 1].timestamp}-${vpSlice.length}`;
          if (vpCache.has(cacheKey)) {
            currentVpResult = vpCache.get(cacheKey)!;
            break;
          }
        }
      }
    }
    
    // Значения POC/VAH/VAL (с защитой от null)
    const currentPoc = currentVpResult?.poc ?? null; 
    const currentVah = currentVpResult?.vah ?? null;
    const currentVal = currentVpResult?.val ?? null;

    // --- Логика Кластеров ---
    // (Уже есть в вашем коде, но может потребовать доработки для силы кластера)
    // Пример:
    if (currentAvgVolume !== undefined && currentAvgVolume > 0 && candle.volume > currentAvgVolume * clusterMinVolumeThresholdMultiplier) {
      strategyCandle.isVolumeCluster = true;
      strategyCandle.volumeClusterStrength = (candle.volume / currentAvgVolume) - clusterMinVolumeThresholdMultiplier;
      // Здесь нужно определить, бычий это кластер или медвежий, например, по дельте или свече
    } else {
      // Если кластера нет, оставляем volumeClusterStrength как undefined
      strategyCandle.volumeClusterStrength = undefined;
    }
    // --- Конец Логики Кластеров ---
    
    // --- Логика определения сигналов и их силы ---
    let calculatedSignalStrength = 0;
    let isLongSignal = false;
    let isShortSignal = false;

    let dlcLongActive = false;
    let nweLongActive = false;
    let clusterLongActive = false; // Подразумевается бычий кластер

    let dlcShortActive = false;
    let nweShortActive = false;
    let clusterShortActive = false; // Подразумевается медвежий кластер

    // Условия для LONG сигналов
    // 1. DLC - Long (пример: отбой от VAL или POC снизу)
    if (currentVal !== null && candle.low <= currentVal && candle.close > currentVal) {
        dlcLongActive = true;
    } else if (currentPoc !== null && candle.low <= currentPoc && candle.close > currentPoc && candle.open > currentPoc) { // Более строгий отбой от POC
        dlcLongActive = true;
    }
    // Можно добавить ложный пробой VAL/POC

    // 2. NWE - Long (пример: отбой от nweLower)
    if (nweEnabled && strategyCandle.nweLower !== null && strategyCandle.nweLower !== undefined && candle.low <= strategyCandle.nweLower && candle.close > strategyCandle.nweLower) {
        nweLongActive = true;
    }
    // Можно добавить ложный пробой nweLower

    // 3. Cluster - Long (пример: бычий кластер на поддержке)
    // Здесь нужна более точная логика определения "бычьего" кластера
    // Например, isVolumeCluster + (currentApproxDelta > 0) или свеча закрылась вверх
    if (strategyCandle.isVolumeCluster && currentAvgVolume !== undefined && currentApproxDelta > (clusterDeltaThreshold * (currentAvgVolume * 0.01))) { // Пример использования дельты
        clusterLongActive = true;
    }
    
    // --- Расчет силы для LONG ---
    if (dlcLongActive || nweLongActive || clusterLongActive) { // Если есть хотя бы один компонент
        isLongSignal = true; // Базовое условие входа (уточнить по вашей стратегии)
        if (dlcLongActive) calculatedSignalStrength += 1.0;
        if (nweLongActive) calculatedSignalStrength += 1.0;
        if (clusterLongActive) {
            calculatedSignalStrength += 1.0;
            calculatedSignalStrength += (strategyCandle.volumeClusterStrength ?? 0) * 0.2; // Добавляем силу самого кластера
        }

        // Бонусы за конфлюентность
        let confBonusLong = 0;
        const longSignalsCount = (dlcLongActive ? 1:0) + (nweLongActive ? 1:0) + (clusterLongActive ? 1:0);
        if (longSignalsCount === 2) confBonusLong = 1.0;
        if (longSignalsCount === 3) confBonusLong = 1.5; 
        calculatedSignalStrength += confBonusLong;
    }


    // Условия для SHORT сигналов
    // 1. DLC - Short (пример: отбой от VAH или POC сверху)
    if (currentVah !== null && candle.high >= currentVah && candle.close < currentVah) {
        dlcShortActive = true;
    } else if (currentPoc !== null && candle.high >= currentPoc && candle.close < currentPoc && candle.open < currentPoc) {
        dlcShortActive = true;
    }

    // 2. NWE - Short (пример: отбой от nweUpper)
    if (nweEnabled && strategyCandle.nweUpper !== null && strategyCandle.nweUpper !== undefined && candle.high >= strategyCandle.nweUpper && candle.close < strategyCandle.nweUpper) {
        nweShortActive = true;
    }
    
    // 3. Cluster - Short (пример: медвежий кластер на сопротивлении)
    if (strategyCandle.isVolumeCluster && currentAvgVolume !== undefined && currentApproxDelta < (-clusterDeltaThreshold * (currentAvgVolume * 0.01))) {
        clusterShortActive = true;
    }

    // --- Расчет силы для SHORT ---
    // Важно: если уже есть Long сигнал на этой свече, обычно Short не рассматриваем (или наоборот)
    // Для простоты, сейчас позволим им быть независимыми, но в реальной системе это нужно будет разруливать
    if (!isLongSignal && (dlcShortActive || nweShortActive || clusterShortActive)) {
        isShortSignal = true; 
        calculatedSignalStrength = 0; // Сбрасываем, если был расчет для лонга, но лонг не активировался
        if (dlcShortActive) calculatedSignalStrength += 1.0;
        if (nweShortActive) calculatedSignalStrength += 1.0;
        if (clusterShortActive) {
            calculatedSignalStrength += 1.0;
            calculatedSignalStrength += (strategyCandle.volumeClusterStrength ?? 0) * 0.2;
        }
        
        let confBonusShort = 0;
        const shortSignalsCount = (dlcShortActive ? 1:0) + (nweShortActive ? 1:0) + (clusterShortActive ? 1:0);
        if (shortSignalsCount === 2) confBonusShort = 1.0;
        if (shortSignalsCount === 3) confBonusShort = 1.5;
        calculatedSignalStrength += confBonusShort;
    }
    
    // Если в итоге нет ни Long ни Short сигнала, сбрасываем силу
    if (!isLongSignal && !isShortSignal) {
        calculatedSignalStrength = 0;
    }

    strategyCandle.entryConditionLong = isLongSignal;
    strategyCandle.entryConditionShort = isShortSignal;
    strategyCandle.signalStrength = calculatedSignalStrength > 0 ? calculatedSignalStrength : null;
    
    // --- Конец Логики определения сигналов ---

    // Обновление истории POC, VAH, VAL для следующей итерации (если используется pocLookback)
    // pocHistory.push(currentPoc);
    // vahHistory.push(currentVah);
    // valHistory.push(currentVal);
    // if (pocHistory.length > pocLookback) pocHistory.shift(); // и т.д.

    return strategyCandle;
  });

  // Расчет основного Volume Profile для всего периода (если это нужно где-то еще)
  const overallVolumeProfile = candles.length > 0 ? calculateVolumeProfile(candles, vpNumBins, vpVaPercentage) : null;
  
  const result = { strategyCandles, volumeProfile: overallVolumeProfile };
  
  // Возвращаем volumeProfile для всего периода
  return result;
}; 