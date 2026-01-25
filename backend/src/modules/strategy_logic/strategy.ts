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
  calculateCumulativeDelta,
  calculateADX,
  calculateSwingPoints,
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

export interface VPASettings {
  enabled?: boolean;
  maxSpreadAtrMultiplier?: number; // Максимальный спред (в xATR) для определения "Absorption" (останавливающий объем)
  minSpreadAtrMultiplier?: number; // Минимальный спред (в xATR) для определения "Impulse" (игнорируем такие развороты)
}

export interface RiskManagementSettings {
  atrPeriod?: number;
  stopLossMultiplier?: number;
  takeProfitMultiplier?: number;
  useTrailingStop?: boolean;
  trailingStopOffsetMultiplier?: number;
  trailingStopStepMultiplier?: number;
  maxTradesPerDay?: number;
  positionSizePercentage?: number;
  maxRiskPerTradePercentage?: number;
  exitOnOppositeSignal?: boolean;
  
  // ТЗ 2.1: Фильтр R:R - минимальное соотношение Reward:Risk для входа
  minRewardRiskRatio?: number; // По умолчанию 2.0
  
  // ТЗ 2.2: ADX Regime Filter
  useRegimeFilter?: boolean; // Включить фильтрацию по ADX
  adxPeriod?: number; // Период ADX, по умолчанию 14
  adxTrendThreshold?: number; // ADX > этого = TREND режим, по умолчанию 25
  adxRangeThreshold?: number; // ADX < этого = RANGE режим, по умолчанию 20
}

export interface StrategyParameters {
  dlc?: DLCSettings;
  nwe?: NWESettings;
  clusters?: ClusterSettings;
  vpa?: VPASettings;
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
  vpa: {
    enabled: true,
    maxSpreadAtrMultiplier: 0.5, // Если спред < 0.5 ATR при высоком объеме -> это Absorption (сигнал)
    minSpreadAtrMultiplier: 1.5, // Если спред > 1.5 ATR -> это Impulse/Panic (фильтруем лонги на красных свечах)
  },
  risk: {
    atrPeriod: 14, // Pine: atr_period
    positionSizePercentage: 0.02, // Pine: risk_percent (2.0 / 100)
    stopLossMultiplier: 2.0, // Pine: stop_loss_atr
    takeProfitMultiplier: 5.0, // Pine: take_profit_atr
    useTrailingStop: false, // Pine: use_trailing_stop
    trailingStopOffsetMultiplier: 1.5, // Pine: trail_offset_mult
    trailingStopStepMultiplier: 0.25, // Pine: trailing_step (ATR множитель для шага)
    maxTradesPerDay: 2, // Pine: max_trades_per_day
    maxRiskPerTradePercentage: 0.02, // ИЗМЕНЕНО с 0.01 на 0.02 для соответствия positionSizePercentage
  },
  // globalAtrPeriod и avgVolumePeriod удалены
};

export interface StrategyCandle extends CandleData {
  atr?: number;
  nweUpper?: number | null;
  nweLower?: number | null;
  nweMiddle?: number | null; // Added Middle Line
  avgVolume?: number;
  approxDelta?: number;
  cumulativeDelta?: number;
  poc?: number | null;
  vah?: number | null;
  val?: number | null;
  isVolumeCluster?: boolean;
  isAbsorption?: boolean; // New: VPA Absorption detected
  isWideSpread?: boolean; // New: VPA Wide Spread detected
  isDeltaDivergence?: boolean; // New: Delta Divergence detected
  volumeClusterStrength?: number | undefined;
  entryConditionLong?: boolean;
  entryConditionShort?: boolean;
  signal?: 0 | 1 | -1;
  signalStrength?: number | null;
  stopLoss?: number;
  takeProfit?: number;
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

  const vpaEnabled = params.vpa?.enabled ?? DefaultStrategyParameters.vpa!.enabled!;
  const vpaMaxSpreadAtr = params.vpa?.maxSpreadAtrMultiplier ?? DefaultStrategyParameters.vpa!.maxSpreadAtrMultiplier!;
  const vpaMinSpreadAtr = params.vpa?.minSpreadAtrMultiplier ?? DefaultStrategyParameters.vpa!.minSpreadAtrMultiplier!;

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
    nweValues = candles.map(() => ({ nweUpper: null, nweLower: null, nweMiddle: null, params: dummyParams }));
  }

  const avgVolumeValues = calculateAvgVolume(candles, avgVolPeriod);
  const approxDeltaValues = calculateApproxDelta(candles);
  const cumulativeDeltaValues = calculateCumulativeDelta(approxDeltaValues);
  
  // ТЗ 2.2: Расчёт ADX для Regime Filter
  const useRegimeFilter = params.risk?.useRegimeFilter ?? false;
  const adxPeriod = params.risk?.adxPeriod ?? 14;
  const adxTrendThreshold = params.risk?.adxTrendThreshold ?? 25;
  const adxRangeThreshold = params.risk?.adxRangeThreshold ?? 20;
  const adxValues = useRegimeFilter ? calculateADX(candles, adxPeriod) : [];
  
  // ТЗ 2.3: Расчёт Swing Points для технического SL
  const swingPoints = calculateSwingPoints(candles, 5);
  
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
    const currentNwe = nweEnabled ? nweValues[index] : { nweUpper: null, nweLower: null, nweMiddle: null };
    const currentAvgVolume = avgVolumeValues[index];
    const currentApproxDelta = approxDeltaValues[index];
    const currentCumulativeDelta = cumulativeDeltaValues[index];

    // --- VPA Analysis ---
    const spread = Math.abs(candle.high - candle.low);
    const spreadRatio = (currentAtr && currentAtr > 0) ? spread / currentAtr : 0;
    
    // Absorption: High Volume but Small Spread (effort vs no result)
    const isAbsorption = vpaEnabled 
      ? (spreadRatio < vpaMaxSpreadAtr)
      : false; // If VPA disabled, we don't mark absorption
    
    // Wide Spread: Panic/Impulse candle
    const isWideSpread = vpaEnabled
      ? (spreadRatio > vpaMinSpreadAtr)
      : false;

    // --- Delta Divergence Analysis ---
    let isDeltaDivergenceLong = false;
    let isDeltaDivergenceShort = false;
    
    const DIV_LOOKBACK = 20;
    if (index >= DIV_LOOKBACK) {
        // Bullish Divergence: Price makes lower low, but CVD makes higher low
        // Find pivot low in lookback
        let lowestPrice = candle.low;
        let lowestPriceIndex = index;
        
        // Check if current bar is the lowest in recent history (or close to it)
        // Simplification: Compare with lowest low of previous 20 bars
        let prevLowestLow = candles[index - 1].low;
        let prevLowestIndex = index - 1;
        
        for (let i = 1; i <= DIV_LOOKBACK; i++) {
             if (candles[index - i].low < prevLowestLow) {
                 prevLowestLow = candles[index - i].low;
                 prevLowestIndex = index - i;
             }
        }
        
        // If current low is lower than previous lowest low (New Low)
        if (candle.low < prevLowestLow) {
            // Check delta at previous lowest low
            const prevCVD = cumulativeDeltaValues[prevLowestIndex];
            const currentCVD = currentCumulativeDelta;
            
            // If current CVD is HIGHER than CVD at previous lowest low -> Bullish Divergence
            if (currentCVD > prevCVD) {
                isDeltaDivergenceLong = true;
            }
        }
        
        // Bearish Divergence: Price makes higher high, but CVD makes lower high
        let prevHighestHigh = candles[index - 1].high;
        let prevHighestIndex = index - 1;
        
        for (let i = 1; i <= DIV_LOOKBACK; i++) {
             if (candles[index - i].high > prevHighestHigh) {
                 prevHighestHigh = candles[index - i].high;
                 prevHighestIndex = index - i;
             }
        }
        
        // If current high is higher than previous highest high (New High)
        if (candle.high > prevHighestHigh) {
            const prevCVD = cumulativeDeltaValues[prevHighestIndex];
            const currentCVD = currentCumulativeDelta;
            
            // If current CVD is LOWER than CVD at previous highest high -> Bearish Divergence
            if (currentCVD < prevCVD) {
                isDeltaDivergenceShort = true;
            }
        }
    }

    const strategyCandle: StrategyCandle = {
      ...candle,
      atr: currentAtr,
      nweUpper: currentNwe?.nweUpper,
      nweLower: currentNwe?.nweLower,
      nweMiddle: currentNwe?.nweMiddle,
      avgVolume: currentAvgVolume,
      approxDelta: currentApproxDelta,
      cumulativeDelta: currentCumulativeDelta,
      entryConditionLong: false,
      entryConditionShort: false,
      signalStrength: null,
      isVolumeCluster: false, 
      isAbsorption: isAbsorption,
      isWideSpread: isWideSpread,
      isDeltaDivergence: isDeltaDivergenceLong || isDeltaDivergenceShort,
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
    let trendPullbackLongActive = false; // New: Trend Pullback
    let clusterLongActive = false; // Подразумевается бычий кластер

    let dlcShortActive = false;
    let nweShortActive = false;
    let trendPullbackShortActive = false; // New: Trend Pullback
    let clusterShortActive = false; // Подразумевается медвежий кластер

    // --- Trend Pullback Logic (Scenario B) ---
    // Check if we are in a strong trend (recently breached NWE Upper/Lower)
    // And now price is touching Middle Line
    if (nweEnabled && strategyCandle.nweMiddle !== null && strategyCandle.nweMiddle !== undefined) {
      const TREND_LOOKBACK = 10;
      const middleLine = strategyCandle.nweMiddle;
      const middleZone = (strategyCandle.nweUpper! - strategyCandle.nweLower!) * 0.1; // 10% tolerance around middle

      // Uptrend Pullback
      // 1. Was price > Upper Band recently?
      let recentUpperBreach = false;
      for (let i = Math.max(0, index - TREND_LOOKBACK); i < index; i++) {
        if (nweValues[i].nweUpper !== null && candles[i].high > nweValues[i].nweUpper!) {
          recentUpperBreach = true;
          break;
        }
      }
      
      // 2. Is current low touching Middle Line?
      const touchingMiddle = candle.low <= middleLine + middleZone && candle.high >= middleLine - middleZone;
      
      if (recentUpperBreach && touchingMiddle && candle.close > middleLine) {
        trendPullbackLongActive = true;
      }

      // Downtrend Pullback
      // 1. Was price < Lower Band recently?
      let recentLowerBreach = false;
      for (let i = Math.max(0, index - TREND_LOOKBACK); i < index; i++) {
        if (nweValues[i].nweLower !== null && candles[i].low < nweValues[i].nweLower!) {
          recentLowerBreach = true;
          break;
        }
      }

      // 2. Is current high touching Middle Line?
      if (recentLowerBreach && touchingMiddle && candle.close < middleLine) {
        trendPullbackShortActive = true;
      }
    }


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
    // VPA FIX: Фильтруем "Falling Knife" (Wide Spread Down Candle)
    const isFallingKnife = isWideSpread && (candle.close < candle.open); 
    
    // Если включен VPA, мы требуем, чтобы это НЕ был падающий нож для кластерного входа
    if (strategyCandle.isVolumeCluster && currentAvgVolume !== undefined) {
        const deltaCondition = currentApproxDelta > (clusterDeltaThreshold * (currentAvgVolume * 0.01));
        
        // VPA Logic:
        // Если это Absorption (маленький спред + большой объем) -> Это очень сильный сигнал
        // Если это Falling Knife (большой спред вниз) -> Игнорируем или требуем сильного подтверждения (которого у нас пока нет)
        
        if (!isFallingKnife) { 
             if (deltaCondition || (isAbsorption && candle.close >= candle.open)) {
                 clusterLongActive = true;
             }
        }
    }
    
    // --- ТЗ 2.2: Regime Filter (ADX) ---
    // Определяем режим рынка: TREND (ADX > 25), RANGE (ADX < 20), или NEUTRAL (20-25)
    const currentADX = useRegimeFilter && adxValues.length > index ? adxValues[index] : undefined;
    const isTrendMode = currentADX !== undefined && currentADX > adxTrendThreshold;
    const isRangeMode = currentADX !== undefined && currentADX < adxRangeThreshold;
    
    // --- Расчет силы для LONG ---
    // ТЗ 2.2: В TREND режиме разрешены только Trend Pullback, запрещены NWE Extremum
    // В RANGE режиме разрешены NWE Extremum и Absorption, запрещены пробойные
    
    let longSignalAllowed = false;
    
    if (useRegimeFilter) {
        if (isTrendMode) {
            // TREND: только Trend Pullback
            longSignalAllowed = trendPullbackLongActive || (dlcLongActive && clusterLongActive);
        } else if (isRangeMode) {
            // RANGE: NWE Extremum, Absorption, DLC
            longSignalAllowed = nweLongActive || (isAbsorption && clusterLongActive) || dlcLongActive;
        } else {
            // NEUTRAL: любой сигнал с подтверждением
            longSignalAllowed = dlcLongActive || nweLongActive || clusterLongActive || trendPullbackLongActive || isDeltaDivergenceLong;
        }
    } else {
        // Без Regime Filter - любой сигнал
        longSignalAllowed = dlcLongActive || nweLongActive || clusterLongActive || trendPullbackLongActive || isDeltaDivergenceLong;
    }
    
    if (longSignalAllowed) {
        isLongSignal = true;
        
        // VPA Filter: отфильтруем "плохие" ножи
        if (vpaEnabled && isWideSpread && candle.close < candle.open) {
             const range = candle.high - candle.low;
             const rejection = candle.close - candle.low;
             if (range > 0 && (rejection / range) < 0.25) {
                 isLongSignal = false;
             }
        }

        if (isLongSignal) {
            if (dlcLongActive) calculatedSignalStrength += 1.0;
            if (nweLongActive) calculatedSignalStrength += 1.0;
            if (trendPullbackLongActive) calculatedSignalStrength += 1.5; // Бонус за тренд
            if (isDeltaDivergenceLong) calculatedSignalStrength += 1.5;
            if (clusterLongActive) {
                calculatedSignalStrength += 1.0;
                calculatedSignalStrength += (strategyCandle.volumeClusterStrength ?? 0) * 0.2;
                if (isAbsorption) calculatedSignalStrength += 0.5;
            }
        }
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
    const isRocketUp = isWideSpread && (candle.close > candle.open); // "Ракета" вверх - опасно шортить
    
    if (strategyCandle.isVolumeCluster && currentAvgVolume !== undefined) {
         const deltaCondition = currentApproxDelta < (-clusterDeltaThreshold * (currentAvgVolume * 0.01));
         
         if (!isRocketUp) {
             if (deltaCondition || (isAbsorption && candle.close <= candle.open)) {
                 clusterShortActive = true;
             }
         }
    }

    // --- Расчет силы для SHORT с Regime Filter ---
    let shortSignalAllowed = false;
    
    if (useRegimeFilter) {
        if (isTrendMode) {
            shortSignalAllowed = trendPullbackShortActive || (dlcShortActive && clusterShortActive);
        } else if (isRangeMode) {
            shortSignalAllowed = nweShortActive || (isAbsorption && clusterShortActive) || dlcShortActive;
        } else {
            shortSignalAllowed = dlcShortActive || nweShortActive || clusterShortActive || trendPullbackShortActive || isDeltaDivergenceShort;
        }
    } else {
        shortSignalAllowed = dlcShortActive || nweShortActive || clusterShortActive || trendPullbackShortActive || isDeltaDivergenceShort;
    }
    
    if (!isLongSignal && shortSignalAllowed) {
        isShortSignal = true;
        
        // VPA Filter
        if (vpaEnabled && isWideSpread && candle.close > candle.open) {
             const range = candle.high - candle.low;
             const rejection = candle.high - candle.close;
             if (range > 0 && (rejection / range) < 0.25) {
                 isShortSignal = false;
             }
        }
        
        if (isShortSignal) {
            calculatedSignalStrength = 0;
            if (dlcShortActive) calculatedSignalStrength += 1.0;
            if (nweShortActive) calculatedSignalStrength += 1.0;
            if (trendPullbackShortActive) calculatedSignalStrength += 1.5;
            if (isDeltaDivergenceShort) calculatedSignalStrength += 1.5;
            if (clusterShortActive) {
                calculatedSignalStrength += 1.0;
                calculatedSignalStrength += (strategyCandle.volumeClusterStrength ?? 0) * 0.2;
                if (isAbsorption) calculatedSignalStrength += 0.5;
            }
        }
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