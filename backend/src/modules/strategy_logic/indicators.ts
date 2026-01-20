// Файл для функций расчета технических индикаторов (ATR, Volume Profile, NWE и т.д.)

import logger from '../../utils/logger'; // Убедимся, что логгер импортирован

export interface CandleData {
  high: number;
  low: number;
  close: number;
  volume: number; // Сделаем volume обязательным для VP и других индикаторов, где он нужен
  open: number; // <--- СДЕЛАНО ОБЯЗАТЕЛЬНЫМ
  timestamp: number; // <--- СДЕЛАНО ОБЯЗАТЕЛЬНЫМ
  // ... могут быть и другие поля
}

export const calculateATR = (candles: CandleData[], period: number): (number | undefined)[] => {
  if (!candles || candles.length === 0) { // Проверка на пустой массив свечей
    return [];
  }
  // Если свечей меньше, чем нужно для первого расчета ATR, возвращаем undefined для всех
  if (candles.length < period) {
    return new Array(candles.length).fill(undefined);
  }

  const atrValues: (number | undefined)[] = new Array(candles.length).fill(undefined);
  const trueRanges: number[] = new Array(candles.length).fill(0);

  // 1. Рассчитать True Range (TR) для каждой свечи
  for (let i = 0; i < candles.length; i++) {
    const high = Number(candles[i].high);
    const low = Number(candles[i].low);
    const prevClose = i > 0 ? Number(candles[i - 1].close) : high; // Для первой свечи используем high, т.к. нет prevClose

    const tr1 = high - low;
    const tr2 = Math.abs(high - prevClose);
    const tr3 = Math.abs(low - prevClose);
    trueRanges[i] = Math.max(tr1, tr2, tr3);
  }

  // 2. Рассчитать ATR
  // Первый ATR (для свечи с индексом period - 1) - это простое среднее первых 'period' TR
  let sumTR = 0;
  for (let i = 0; i < period; i++) {
    sumTR += trueRanges[i];
  }
  atrValues[period - 1] = sumTR / period;

  // Последующие ATR рассчитываются по формуле Wilder's smoothing
  // Current ATR = ((Previous ATR * (period - 1)) + Current TR) / period
  for (let i = period; i < candles.length; i++) {
    atrValues[i] = (atrValues[i - 1]! * (period - 1) + trueRanges[i]) / period; // Добавлен non-null assertion т.к. atrValues[i-1] должен быть числом на этом этапе
  }

  return atrValues;
};

export interface VolumeProfilePoint {
  price: number;
  volume: number;
}

export interface VolumeProfileResult {
  poc: number | null;
  vah: number | null;
  val: number | null;
  profile: VolumeProfilePoint[];
  totalVolume: number;
}

export const calculateVolumeProfile = (
  candles: CandleData[],
  numBins: number = 20, // Количество ценовых уровней (корзин) в профиле
  vaPercentage: number = 0.7 // Процент для расчета Value Area (области стоимости)
): VolumeProfileResult => {
  // logger.debug(`[CalcVP] Called with ${candles?.length} candles, numBins: ${numBins}, vaPercentage: ${vaPercentage}`);
  const result: VolumeProfileResult = {
    poc: null,
    vah: null,
    val: null,
    profile: [],
    totalVolume: 0,
  };

  if (!candles || candles.length === 0) {
    logger.warn('[CalcVP] No candles provided or empty array.');
    return result;
  }

  let minOverallLow = candles[0].low;
  let maxOverallHigh = candles[0].high;
  let totalVolumeFromCandles = 0;

  for (const candle of candles) {
    if (candle.low < minOverallLow) minOverallLow = candle.low;
    if (candle.high > maxOverallHigh) maxOverallHigh = candle.high;
    totalVolumeFromCandles += candle.volume;
  }
  result.totalVolume = totalVolumeFromCandles;
  // logger.debug(`[CalcVP] minOverallLow: ${minOverallLow}, maxOverallHigh: ${maxOverallHigh}, totalVolumeFromCandles: ${totalVolumeFromCandles}`);

  // Новое логирование для аномальных срезов
  if (typeof minOverallLow === 'number' && typeof maxOverallHigh === 'number' && minOverallLow > maxOverallHigh) {
    logger.error(`[CalcVP] ANOMALY DETECTED: minOverallLow (${minOverallLow}) > maxOverallHigh (${maxOverallHigh}). This will result in a negative binSize.`);
    logger.error(`[CalcVP] Dumping candles from the problematic slice (length: ${candles.length}):`);
    // Логируем первые 3 и последние 3 свечи из проблемного среза для анализа
    const logLimit = 3;
    if (candles.length <= logLimit * 2) {
      candles.forEach((candle, idx) => {
        logger.error(`[CalcVP-SliceCandle-${idx}] ${JSON.stringify(candle)}`);
      });
    } else {
      for (let k = 0; k < logLimit; k++) {
        logger.error(`[CalcVP-SliceCandle-start-${k}] ${JSON.stringify(candles[k])}`);
      }
      logger.error(`[CalcVP-SliceCandle] ... middle candles omitted ...`);
      for (let k = candles.length - logLimit; k < candles.length; k++) {
        logger.error(`[CalcVP-SliceCandle-end-${k}] ${JSON.stringify(candles[k])}`);
      }
    }
  }

  if (result.totalVolume === 0) {
    logger.warn('[CalcVP] Total volume from candles is 0. Returning empty profile.');
    return result;
  }
  if (minOverallLow === maxOverallHigh) { 
    logger.info('[CalcVP] All candle prices are identical (minLow === maxHigh).');
    result.poc = minOverallLow;
    result.vah = minOverallLow;
    result.val = minOverallLow;
    result.profile.push({ price: minOverallLow, volume: result.totalVolume });
    // logger.debug('[CalcVP] Profile for identical prices:', result);
    return result;
  }

  const binSize = (maxOverallHigh - minOverallLow) / numBins;
  // logger.debug(`[CalcVP] Calculated binSize: ${binSize}`);
  if (binSize <= 0) {
    logger.error(`[CalcVP] binSize is ${binSize}. This should not happen if minOverallLow !== maxOverallHigh. Defaulting to failsafe.`);
    // Failsafe, though the previous check minOverallLow === maxOverallHigh should catch this.
    // If it still happens, it implies an issue with price data (e.g. NaN or Infinity)
    // For now, return current result which will be empty/null POC.
    return result;
  }
  
  const bins: { price: number; volume: number; midPrice: number }[] = [];

  for (let i = 0; i < numBins; i++) {
    const binStartPrice = minOverallLow + i * binSize;
    bins.push({
      price: binStartPrice, 
      midPrice: binStartPrice + binSize / 2, 
      volume: 0,
    });
  }
  
  if (bins.length > 0) {
    // logger.debug(`[CalcVP] First bin: price=${bins[0].price.toFixed(4)}, midPrice=${bins[0].midPrice.toFixed(4)}. Last bin: price=${bins[bins.length-1].price.toFixed(4)}, midPrice=${bins[bins.length-1].midPrice.toFixed(4)}`);
  }


  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    const candleTypicalPrice = (candle.high + candle.low + candle.close) / 3;
    let targetBinIndex = Math.floor((candleTypicalPrice - minOverallLow) / binSize);

    if (targetBinIndex >= numBins) targetBinIndex = numBins - 1; 
    if (targetBinIndex < 0) targetBinIndex = 0; 
    
    if (bins[targetBinIndex]) {
        bins[targetBinIndex].volume += candle.volume;
        // Log for a few candles to see distribution
        if (i < 3 || i > candles.length - 4) {
            // logger.debug(`[CalcVP-DistCandle-${i}] TypicalPrice: ${candleTypicalPrice.toFixed(4)}, Volume: ${candle.volume}, TargetBinIndex: ${targetBinIndex}, BinMidPrice: ${bins[targetBinIndex].midPrice.toFixed(4)}, BinVolumeAfter: ${bins[targetBinIndex].volume}`);
        }
    } else {
        logger.warn(`[CalcVP-DistCandle-${i}] No target bin for index ${targetBinIndex}! TypicalPrice: ${candleTypicalPrice.toFixed(4)}`);
    }
  }
  
  // Log total volume in bins
  const totalVolumeInBins = bins.reduce((acc, b) => acc + b.volume, 0);
  // logger.debug(`[CalcVP] Total volume from candles: ${totalVolumeFromCandles}. Total volume distributed in bins: ${totalVolumeInBins}`);
  if (Math.abs(totalVolumeFromCandles - totalVolumeInBins) > 1e-3 * totalVolumeFromCandles) {
      logger.warn(`[CalcVP] Discrepancy between total candle volume (${totalVolumeFromCandles}) and total volume in bins (${totalVolumeInBins}).`);
  }

  result.profile = bins.map(b => ({ price: b.midPrice, volume: b.volume })).filter(b => b.volume > 0);
  if (result.profile.length === 0) {
      logger.warn('[CalcVP] Profile is empty after filtering zero-volume bins. Skipping POC/VA calculation.');
      if (result.totalVolume > 0 && minOverallLow === maxOverallHigh) {
          result.profile.push({ price: minOverallLow, volume: result.totalVolume });
          result.poc = minOverallLow;
          result.vah = minOverallLow;
          result.val = minOverallLow;
      }
      return result;
  }

  if (result.profile.length === 0 && result.totalVolume > 0 && minOverallLow === maxOverallHigh) {
      logger.info('[CalcVP] Readjusting profile for single price point (already handled, but as a fallback log).');
      result.profile.push({ price: minOverallLow, volume: result.totalVolume });
  } else if (result.profile.length === 0) {
      logger.warn('[CalcVP] Profile is empty after filtering. No POC can be calculated. Returning.');
      return result; 
  }
  
  let maxVolume = 0;
  // Initialize POC with the price of the first point in the filtered profile, if profile is not empty
  result.poc = result.profile[0].price; 
  for (const point of result.profile) {
    if (point.volume > maxVolume) {
      maxVolume = point.volume;
      result.poc = point.price;
    }
  }
  // logger.debug(`[CalcVP] POC calculated: Price=${result.poc}, Volume=${maxVolume}`);

  const sortedByVolume = [...result.profile].sort((a, b) => b.volume - a.volume);
  let volumeForVA = 0;
  const vaThreshold = result.totalVolume * vaPercentage;
  const pricesInVA: number[] = [];
  // logger.debug(`[CalcVP] Calculating VA. Threshold: ${vaThreshold.toFixed(2)} (totalVolume: ${result.totalVolume}, vaPercentage: ${vaPercentage})`);

  for (const point of sortedByVolume) {
    if (volumeForVA >= vaThreshold && pricesInVA.length > 0) break;
    volumeForVA += point.volume;
    pricesInVA.push(point.price);
    // Log first few points added to VA
    if (pricesInVA.length <= 3) {
        // logger.debug(`[CalcVP-VAcalc] Added to VA: Price=${point.price.toFixed(4)}, Volume=${point.volume}. volumeForVA_now=${volumeForVA.toFixed(2)}`);
    }
    if (volumeForVA >= vaThreshold && pricesInVA.length > 0) {
        // logger.debug(`[CalcVP-VAcalc] VA threshold reached. volumeForVA=${volumeForVA.toFixed(2)}, pricesInVA count=${pricesInVA.length}`);
        break;
    }
  }

  if (pricesInVA.length > 0) {
    result.vah = Math.max(...pricesInVA);
    result.val = Math.min(...pricesInVA);
    // logger.debug(`[CalcVP] VAH: ${result.vah}, VAL: ${result.val}`);
  } else if (result.profile.length > 0) { 
      logger.warn('[CalcVP] pricesInVA is empty, but profile has data. Setting VAH/VAL to first profile point.');
      result.vah = result.profile[0].price;
      result.val = result.profile[0].price;
  } else {
      logger.warn('[CalcVP] pricesInVA is empty and profile is also empty. VAH/VAL will be null.');
  }
  
  if (result.profile.length === 1) {
      logger.info('[CalcVP] Profile has only one point. Setting POC/VAH/VAL to this point.');
      result.poc = result.profile[0].price;
      result.vah = result.profile[0].price;
      result.val = result.profile[0].price;
  }
  
  // logger.debug('[CalcVP] Final result:', JSON.stringify(result, null, 2));
  return result;
};

// Интерфейс для параметров NWE, используемых в calculateNWE
export interface NWECalculationParams {
  source: 'open' | 'high' | 'low' | 'close' | 'hl2' | 'hlc3' | 'ohlc4';
  bandwidth: number;
  multiplier: number; // Этот параметр используется для ATR в NWE
  lookbackPeriod: number;
  atrPeriod: number; // Этот параметр используется для ATR в NWE
  // atrMultiplier не нужен здесь, т.к. multiplier уже есть для NWE Bands
}

export interface NWEResultPoint {
  nweUpper: number | null;
  nweLower: number | null;
  nweMiddle: number | null; // Added Basis (Middle Line)
  params: NWECalculationParams
}

export const calculateNWE = (
  candles: CandleData[],
  params: NWECalculationParams
): NWEResultPoint[] => {
  if (!candles || candles.length === 0) return [];

  const atrValues = calculateATR(candles, params.atrPeriod);
  const results: NWEResultPoint[] = [];

  // Простая скользящая средняя для базовой линии NWE
  const sma = (data: number[], period: number): (number | null)[] => {
    const out: (number | null)[] = new Array(data.length).fill(null);
    if (data.length < period) return out;
    let sum = 0;
    for (let i = 0; i < period; i++) {
      sum += data[i];
    }
    out[period - 1] = sum / period;
    for (let i = period; i < data.length; i++) {
      sum = sum - data[i - period] + data[i];
      out[i] = sum / period;
    }
    return out;
  };

  const getSourceData = (candle: CandleData): number => {
    switch (params.source) {
      case 'open': return candle.open;
      case 'high': return candle.high;
      case 'low': return candle.low;
      case 'hl2': return (candle.high + candle.low) / 2;
      case 'hlc3': return (candle.high + candle.low + candle.close) / 3;
      case 'ohlc4': return (candle.open + candle.high + candle.low + candle.close) / 4;
      case 'close':
      default: return candle.close;
    }
  };

  const sourcePrices = candles.map(getSourceData);
  const baseLineSma = sma(sourcePrices, params.lookbackPeriod); // Используем lookbackPeriod для SMA

  for (let i = 0; i < candles.length; i++) {
    const atr = atrValues[i];
    const baseSma = baseLineSma[i];

    if (atr === undefined || atr === null || atr === 0 || baseSma === null) {
      results.push({ nweUpper: null, nweLower: null, nweMiddle: null, params });
      continue;
    }

    // Расчет Nadaraya-Watson Kernel Regression (упрощенный для NWE Bands)
    // В классическом NWE используется более сложный kernel. Здесь мы просто используем SMA как базовую линию.
    // и добавляем/вычитаем ATR, умноженный на params.multiplier и params.bandwidth.
    // params.bandwidth здесь может влиять на чувствительность канала.
    const offset = atr * params.multiplier * params.bandwidth; 
    results.push({
      nweUpper: baseSma + offset,
      nweLower: baseSma - offset,
      nweMiddle: baseSma,
      params,
    });
  }
  return results;
};

export const calculateAvgVolume = (candles: CandleData[], period: number): (number | undefined)[] => {
  if (!candles || candles.length === 0) { // Проверка на пустой массив
    return [];
  }
  
  // Проверка на некорректный период
  if (period <= 0) {
    return new Array(candles.length).fill(0);
  }
  
  if (candles.length < period) {
    return new Array(candles.length).fill(undefined);
  }

  const avgVolumeValues: (number | undefined)[] = new Array(candles.length).fill(undefined);
  let sumVolume = 0;

  for (let i = 0; i < period -1; i++) { // Суммируем объемы для первых period-1 свечей
    sumVolume += candles[i].volume;
  }

  for (let i = period - 1; i < candles.length; i++) {
    sumVolume += candles[i].volume;
    avgVolumeValues[i] = sumVolume / period;
    sumVolume -= candles[i - (period - 1)].volume; // Вычитаем самый старый объем из суммы
  }

  return avgVolumeValues;
};

// Функция для расчета приблизительной дельты на основе CLV
export const calculateApproxDelta = (candles: CandleData[]): number[] => {
  if (!candles || candles.length === 0) {
    return [];
  }

  const approxDeltaValues: number[] = new Array(candles.length).fill(0);

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    const high = Number(candle.high);
    const low = Number(candle.low);
    const close = Number(candle.close);
    const volume = Number(candle.volume);

    if (isNaN(high) || isNaN(low) || isNaN(close) || isNaN(volume)) {
      approxDeltaValues[i] = 0; // или другое значение по умолчанию/ошибка
      continue;
    }

    const range = high - low;
    let clv = 0;

    if (range > 0) {
      clv = ((close - low) - (high - close)) / range;
    }
    // Если range === 0, clv остается 0, что корректно (нет движения, нет доминирующей силы)

    // Убедимся, что CLV находится в диапазоне [-1, 1], хотя формула это обычно гарантирует для валидных HLC.
    clv = Math.max(-1, Math.min(1, clv)); 
    
    approxDeltaValues[i] = clv * volume;
  }

  return approxDeltaValues;
};

export const calculateCumulativeDelta = (approxDelta: number[]): number[] => {
  if (!approxDelta || approxDelta.length === 0) return [];
  
  const cvd: number[] = new Array(approxDelta.length).fill(0);
  let runningSum = 0;
  
  for (let i = 0; i < approxDelta.length; i++) {
    runningSum += approxDelta[i];
    cvd[i] = runningSum;
  }
  
  return cvd;
};