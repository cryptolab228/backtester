/**
 * Типы и интерфейсы для модулей фьючерсной торговли
 */

// Направление позиции
export type PositionDirection = 'long' | 'short';

// Режим плеча
export type LeverageMode = 'fixed' | 'dynamic';

// Настройки плеча
export interface LeverageSettings {
  enabled: boolean;           // Использовать ли плечо
  value: number;              // Размер плеча (1-100x)
  mode: LeverageMode;         // Фиксированное или динамическое
  maxLeverage: number;        // Максимальное плечо для dynamic
}

// Настройки ликвидации
export interface LiquidationSettings {
  bufferPercent: number;      // Буфер до цены ликвидации (%)
  autoAdjust: boolean;        // Авто-снижение плеча при риске
  warningThreshold: number;   // Порог предупреждения (%)
}

// Настройки финансирования
export interface FundingSettings {
  enabled: boolean;           // Учитывать ли funding rate
  maxRate: number;            // Макс. приемлемая ставка (%)
  avoidHighFunding: boolean;  // Избегать позиций с высоким funding
  favorDirection: boolean;    // Входить по направлению funding
}

// Настройки размера позиции
export interface PositionSizingSettings {
  mode: 'capital' | 'risk' | 'kelly'; // Метод расчета
  riskPerTrade: number;       // Риск на сделку (% от капитала)
  maxPositionSize: number;    // Макс. размер позиции (% капитала)
  useEffectiveLeverage: boolean; // Использовать эффективное плечо
}

// Комплексные настройки фьючерсов
export interface FuturesSettings {
  leverage: LeverageSettings;
  liquidation: LiquidationSettings;
  funding: FundingSettings;
  positionSizing?: PositionSizingSettings;
}

// Результат расчета плеча
export interface LeverageCalculation {
  recommendedLeverage: number;    // Рекомендуемое плечо
  effectiveLeverage: number;      // Эффективное плечо
  liquidationPrice: number;       // Цена ликвидации
  distanceToLiquidation: number;  // Расстояние до ликвидации (%)
  isSafe: boolean;                // Безопасно ли
  riskLevel: 'low' | 'medium' | 'high' | 'extreme'; // Уровень риска
}

// Результат расчета позиции
export interface PositionCalculation {
  contracts: number;          // Количество контрактов
  notionalValue: number;      // Номинальная стоимость
  requiredMargin: number;     // Требуемая маржа
  effectiveLeverage: number;  // Эффективное плечо
  maxLoss: number;            // Максимальный убыток при SL
  riskRewardRatio: number;    // Соотношение риск/прибыль
}

// Данные о funding rate
export interface FundingRateData {
  rate: number;               // Ставка финансирования (в долях, например 0.0001 = 0.01%)
  nextFundingTime: number;    // Время следующего funding (timestamp)
  predictedRate?: number;     // Прогнозируемая ставка
}

// Результат расчета funding cost
export interface FundingCostCalculation {
  cost: number;               // Стоимость funding
  rate: number;               // Использованная ставка
  positionValue: number;      // Стоимость позиции
  timestamp: number;          // Время расчета
  shouldAvoid: boolean;       // Рекомендация избегать позицию
}

// Данные о ликвидации
export interface LiquidationData {
  price: number;              // Цена ликвидации
  distance: number;           // Расстояние до ликвидации (%)
  maintenanceMarginRate: number; // Ставка поддерживающей маржи
  isAtRisk: boolean;          // Риск ликвидации
  bufferAmount: number;       // Буфер в валюте
}

// Статистика фьючерсов для бектеста
export interface FuturesBacktestStats {
  averageLeverage: number;           // Средний размер плеча
  maxLeverage: number;               // Максимальный размер плеча
  liquidations: number;              // Количество ликвидаций
  fundingPaid: number;               // Сумма уплаченного funding
  fundingReceived: number;           // Сумма полученного funding
  netFunding: number;                // Чистый funding (received - paid)
  effectiveROI: number;              // ROI с учетом плеча
  capitalEfficiency: number;         // Прибыль / использованная маржа
  averageDistanceToLiquidation: number; // Среднее расстояние до ликвидации
  minDistanceToLiquidation: number;  // Минимальное расстояние
  marginCallsAvoided: number;        // Избежано margin calls
}

// Параметры для расчета Kelly Criterion
export interface KellyParams {
  winRate: number;            // Процент прибыльных сделок
  avgWin: number;             // Средний выигрыш
  avgLoss: number;            // Средний проигрыш
  leverage: number;           // Используемое плечо
  maxKelly: number;           // Максимальный коэффициент Kelly (обычно 0.25)
}




