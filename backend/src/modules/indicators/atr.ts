import { ATR } from 'technicalindicators';
import { CandleData } from '@/services/okxService'; // Используем наш интерфейс

/**
 * Рассчитывает Average True Range (ATR) для массива свечей.
 * @param candles - Массив свечей (требуются high, low, close)
 * @param period - Период для расчета ATR
 * @returns Массив значений ATR или пустой массив, если входных данных недостаточно.
 */
export function calculateATR(candles: CandleData[], period: number): number[] {
  if (candles.length < period) {
    return []; // Недостаточно данных для расчета
  }

  const atrInput = {
    high: candles.map(c => c.high),
    low: candles.map(c => c.low),
    close: candles.map(c => c.close),
    period: period,
  };

  // Рассчитываем ATR
  const atrResult = ATR.calculate(atrInput);

  // Дополняем начало массива значениями NaN или 0, чтобы длина совпадала с candles
  // technicalindicators возвращает массив короче на (period - 1)
  const padding = Array(period - 1).fill(NaN); // Заполняем NaN или можно 0

  return [...padding, ...atrResult];
} 