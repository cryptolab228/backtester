// Файл для функций расчета технических индикаторов (ATR, Volume Profile, NWE и т.д.)

export interface CandleData {
  high: number;
  low: number;
  close: number;
  volume: number; // Сделаем volume обязательным для VP и других индикаторов, где он нужен
  open?: number; // open не используется в ATR, но может быть в объекте свечи
  timestamp?: number; // timestamp не используется в ATR
  // ... могут быть и другие поля
}

export const calculateATR = (candles: CandleData[], period: number): number[] => {
  if (!candles || candles.length < period) {
    // Возвращаем массив нулей той же длины, если данных недостаточно
    // или можно выбросить ошибку, в зависимости от предпочтений.
    return new Array(candles?.length || 0).fill(0);
  }

  const atrValues: number[] = new Array(candles.length).fill(0);
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
    atrValues[i] = (atrValues[i - 1] * (period - 1) + trueRanges[i]) / period;
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
  const result: VolumeProfileResult = {
    poc: null,
    vah: null,
    val: null,
    profile: [],
    totalVolume: 0,
  };

  if (!candles || candles.length === 0) {
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

  if (result.totalVolume === 0) return result; // Если общий объем 0, профиль не построить
  if (minOverallLow === maxOverallHigh) { // Если все цены одинаковы
    result.poc = minOverallLow;
    result.vah = minOverallLow;
    result.val = minOverallLow;
    result.profile.push({ price: minOverallLow, volume: result.totalVolume });
    return result;
  }

  const binSize = (maxOverallHigh - minOverallLow) / numBins;
  const bins: { price: number; volume: number; midPrice: number }[] = [];

  for (let i = 0; i < numBins; i++) {
    const binStartPrice = minOverallLow + i * binSize;
    bins.push({
      price: binStartPrice, // Используем начало корзины как ее представление цену для простоты группировки
      midPrice: binStartPrice + binSize / 2, // Средняя цена корзины для отображения
      volume: 0,
    });
  }
  // Последняя корзина должна доходить до maxOverallHigh
  if (bins.length > 0 && binSize > 0) {
      bins[bins.length -1].midPrice = Math.min(bins[bins.length-1].midPrice, maxOverallHigh); 
      // Корректируем последнюю цену, чтобы она не превышала maxOverallHigh если binStart + binSize/2 выходит за рамки.
      // Цена самой корзины (bins[bins.length-1].price) должна корректно покрывать maxOverallHigh
  }


  for (const candle of candles) {
    const candleTypicalPrice = (candle.high + candle.low + candle.close) / 3;
    let targetBinIndex = 0;
    if (binSize > 0) { // Избегаем деления на ноль если все цены одинаковы
        targetBinIndex = Math.floor((candleTypicalPrice - minOverallLow) / binSize);
    } else { // Если binSize = 0, значит все цены в одной точке minOverallLow
        targetBinIndex = 0;
    }

    if (targetBinIndex >= numBins) targetBinIndex = numBins - 1; 
    if (targetBinIndex < 0) targetBinIndex = 0; 
    
    if (bins[targetBinIndex]) {
        bins[targetBinIndex].volume += candle.volume;
    }
  }

  result.profile = bins.map(b => ({ price: b.midPrice, volume: b.volume })).filter(b => b.volume > 0);
  if (result.profile.length === 0 && result.totalVolume > 0 && minOverallLow === maxOverallHigh) {
      // Если весь объем был на одной цене, но из-за биннинга не попал в профиль (маловероятно с текущей логикой, но предосторожность)
      result.profile.push({ price: minOverallLow, volume: result.totalVolume });
  } else if (result.profile.length === 0) {
      return result; 
  }
  
  let maxVolume = 0;
  result.poc = result.profile[0].price; // Инициализация POC первой точкой профиля
  for (const point of result.profile) {
    if (point.volume > maxVolume) {
      maxVolume = point.volume;
      result.poc = point.price;
    }
  }

  // Рассчитать Value Area
  const sortedByVolume = [...result.profile].sort((a, b) => b.volume - a.volume);
  let volumeForVA = 0;
  const vaThreshold = result.totalVolume * vaPercentage;
  const pricesInVA: number[] = [];

  for (const point of sortedByVolume) {
    if (volumeForVA >= vaThreshold && pricesInVA.length > 0) break;
    volumeForVA += point.volume;
    pricesInVA.push(point.price);
    if (volumeForVA >= vaThreshold && pricesInVA.length > 0) break; // Проверка после добавления, чтобы включить последнюю точку
  }

  if (pricesInVA.length > 0) {
    result.vah = Math.max(...pricesInVA);
    result.val = Math.min(...pricesInVA);
  } else if (result.profile.length > 0) { // Если VA не сформировалась, но профиль есть
      result.vah = result.profile[0].price;
      result.val = result.profile[0].price;
  }
  
  // Если POC, VAH, VAL не были установлены (например, одна точка в профиле)
  if (result.profile.length === 1) {
      result.poc = result.profile[0].price;
      result.vah = result.profile[0].price;
      result.val = result.profile[0].price;
  }

  return result;
};

// Интерфейс для параметров NWE, используемых в calculateNWE
export interface NWECalculationParams {
  lookbackPeriod: number;
  atrPeriod: number;
  atrMultiplier: number;
}

export interface NWEResultPoint {
  nweUpper: number | null;
  nweLower: number | null;
}

export const calculateNWE = (
  candles: CandleData[],
  params: NWECalculationParams
): NWEResultPoint[] => {
  const { lookbackPeriod, atrPeriod, atrMultiplier } = params;
  const numCandles = candles.length;

  if (numCandles === 0) {
    return [];
  }

  const atrValues = calculateATR(candles, atrPeriod);
  const nweResults: NWEResultPoint[] = new Array(numCandles).fill(null).map(() => ({ nweUpper: null, nweLower: null }));

  // Начинаем расчет с индекса, где достаточно данных для первого ATR и lookbackPeriod
  // Первый ATR рассчитывается для свечи с индексом (atrPeriod - 1)
  // Первый полный lookback возможен для свечи с индексом (lookbackPeriod - 1)
  const startIdx = Math.max(atrPeriod - 1, lookbackPeriod - 1);

  for (let i = 0; i < numCandles; i++) {
    if (i < startIdx || atrValues[i] === 0) {
      // Недостаточно данных или ATR равен 0, оставляем null
      continue;
    }

    const lookbackStart = Math.max(0, i - lookbackPeriod + 1);
    const currentLookbackCandles = candles.slice(lookbackStart, i + 1);

    if (currentLookbackCandles.length === 0) {
        continue;
    }

    let highestHighInLookback = currentLookbackCandles[0].high;
    let lowestLowInLookback = currentLookbackCandles[0].low;

    for (let j = 1; j < currentLookbackCandles.length; j++) {
      if (currentLookbackCandles[j].high > highestHighInLookback) {
        highestHighInLookback = currentLookbackCandles[j].high;
      }
      if (currentLookbackCandles[j].low < lowestLowInLookback) {
        lowestLowInLookback = currentLookbackCandles[j].low;
      }
    }

    const atrOffset = atrValues[i] * atrMultiplier;
    nweResults[i] = {
      nweUpper: highestHighInLookback + atrOffset,
      nweLower: lowestLowInLookback - atrOffset,
    };
  }

  return nweResults;
};

export const calculateAvgVolume = (candles: CandleData[], period: number): number[] => {
  if (!candles || candles.length < period || period <= 0) {
    return new Array(candles?.length || 0).fill(0);
  }

  const avgVolumeValues: number[] = new Array(candles.length).fill(0);
  let currentSum = 0;

  // Рассчитать сумму для первого окна
  for (let i = 0; i < period; i++) {
    currentSum += candles[i].volume;
  }
  avgVolumeValues[period - 1] = currentSum / period;

  // Рассчитать скользящее среднее для остальных свечей
  for (let i = period; i < candles.length; i++) {
    currentSum = currentSum - candles[i - period].volume + candles[i].volume;
    avgVolumeValues[i] = currentSum / period;
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