/**
 * Типы для модуля Walk-Forward Optimizer
 * ТЗ: Разработка модуля «Walk-Forward Optimizer»
 * 
 * Алгоритм скользящего окна:
 * - In-Sample (обучение): 12 месяцев - перебор комбинаций
 * - Out-of-Sample (тест): 3 месяца - проверка лучших настроек
 * - Сдвиг: окна сдвигаются на 3 месяца и процесс повторяется
 */

// Диапазон параметра для оптимизации (min/max/step согласно ТЗ)
export interface ParameterRange {
  min: number;
  max: number;
  step: number;
}

// Дискретные значения параметра (например, take_profit_type)
export interface ParameterValues {
  values: (number | string)[];
}

// Параметр может быть диапазоном или набором значений
export type ParameterDefinition = ParameterRange | ParameterValues;

// Конфигурация параметров для оптимизации (ТЗ 3.1)
export interface OptimizationParameterGrid {
  // Risk Management
  risk_per_trade?: ParameterDefinition;        // % риска на сделку
  stop_loss_atr_multiplier?: ParameterDefinition;  // SL множитель ATR
  take_profit_atr_multiplier?: ParameterDefinition; // TP множитель ATR
  min_reward_risk_ratio?: ParameterDefinition;  // Минимальный R:R
  
  // Regime Filter (ADX)
  adx_period?: ParameterDefinition;
  adx_trend_threshold?: ParameterDefinition;    // ADX > X = TREND
  adx_range_threshold?: ParameterDefinition;    // ADX < X = RANGE
  
  // NWE Parameters
  nwe_multiplier?: ParameterDefinition;
  nwe_period?: ParameterDefinition;
  
  // Volume Profile / DLC
  dlc_period?: ParameterDefinition;
  
  // Cluster Parameters
  cluster_volume_threshold?: ParameterDefinition;
  cluster_delta_threshold?: ParameterDefinition;
  
  // Любые дополнительные параметры
  [key: string]: ParameterDefinition | undefined;
}

// Набор конкретных значений параметров для одного прогона
export interface ParameterSet {
  risk_per_trade: number;
  stop_loss_atr_multiplier: number;
  take_profit_atr_multiplier: number;
  min_reward_risk_ratio: number;
  adx_period: number;
  adx_trend_threshold: number;
  adx_range_threshold: number;
  nwe_multiplier: number;
  nwe_period: number;
  dlc_period: number;
  cluster_volume_threshold: number;
  cluster_delta_threshold: number;
  [key: string]: number;
}

// Результат одного прогона оптимизации
export interface OptimizationRunResult {
  id: string;
  parameters: ParameterSet;
  
  // Основные метрики
  netProfit: number;
  netProfitPercent: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  
  // Целевые метрики (ТЗ 3.2)
  calmarRatio: number;        // Net Profit / Max Drawdown
  recoveryFactor: number;     // Net Profit / Max Drawdown
  sharpeRatio?: number;
  
  // Walk-Forward результаты (ТЗ 3.3)
  inSampleResult?: {
    netProfitPercent: number;
    maxDrawdownPercent: number;
    winRate: number;
  };
  outOfSampleResult?: {
    netProfitPercent: number;
    maxDrawdownPercent: number;
    winRate: number;
  };
  oosPerformanceDrop?: number;  // % падения на OOS
  oosStatus: 'passed' | 'failed' | 'not_tested';
  
  // Статус валидации (ТЗ 3.2 Hard Constraints)
  isValid: boolean;
  invalidReasons: string[];
  
  // Время выполнения
  executionTimeMs: number;
}

// Hard Constraints для отсева (ТЗ 3 - Критерии оценки)
export interface OptimizationConstraints {
  maxDrawdownLimit: number;      // default: 25% (безопасность депозита)
  minTradesCount: number;        // default: 30 сделок за год (избежать случайных удач)
  minWinRate: number;            // default: 40%
  maxOosPerformanceDrop: number; // default: 50%
}

// Конфигурация Walk-Forward Analysis (ТЗ 2.1 - Алгоритм скользящего окна)
export interface WalkForwardConfig {
  enabled: boolean;
  trainWindowMonths: number;     // Окно оптимизации (In-Sample), default: 12 месяцев
  testWindowMonths: number;      // Окно теста (Out-of-Sample), default: 3 месяца
  stepMonths: number;            // Сдвиг окна, default: 3 месяца (= testWindowMonths)
}

// Основная конфигурация оптимизатора
export interface OptimizerConfig {
  // Параметры для перебора
  parameterGrid: OptimizationParameterGrid;
  
  // Ограничения
  constraints: OptimizationConstraints;
  
  // Walk-Forward настройки
  walkForward: WalkForwardConfig;
  
  // Целевая функция для сортировки
  objectiveFunction: 'calmar_ratio' | 'recovery_factor' | 'profit_factor' | 'sharpe_ratio';
  
  // Лимиты
  maxCombinations?: number;      // Максимум комбинаций для перебора
  parallelRuns?: number;         // Параллельные прогоны
  
  // Данные
  pairSymbols: string[];
  timeframe: string;
  startDate: string;
  endDate: string;
  exchange: string;
  
  // Базовые параметры стратегии (не оптимизируемые)
  baseStrategyParameters?: Record<string, any>;
}

// Статус оптимизации
export type OptimizationStatus = 
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

// Прогресс оптимизации
export interface OptimizationProgress {
  jobId: string;
  status: OptimizationStatus;
  totalCombinations: number;
  completedCombinations: number;
  progressPercent: number;
  currentParameters?: ParameterSet;
  estimatedTimeRemaining?: number;
  startTime: number;
  elapsedTime: number;
  bestResultSoFar?: OptimizationRunResult;
  errors: string[];
}

// Итоговый результат оптимизации
export interface OptimizationResult {
  jobId: string;
  config: OptimizerConfig;
  status: OptimizationStatus;
  
  // Все результаты
  allResults: OptimizationRunResult[];
  
  // Топ результаты (отсортированные по objective function)
  topResults: OptimizationRunResult[];
  
  // Лучший результат
  bestResult?: OptimizationRunResult;
  
  // Статистика
  totalCombinations: number;
  validCombinations: number;
  invalidCombinations: number;
  
  // Время
  startTime: number;
  endTime: number;
  totalExecutionTimeMs: number;
  
  // Ошибки
  errors: string[];
}

// Дефолтные значения согласно ТЗ
export const DEFAULT_CONSTRAINTS: OptimizationConstraints = {
  maxDrawdownLimit: 25,    // Max Drawdown: Не более 25%
  minTradesCount: 30,      // Min Trades: Не менее 30 сделок за год
  minWinRate: 40,          // Win Rate: Не менее 40%
  maxOosPerformanceDrop: 50
};

export const DEFAULT_WALK_FORWARD: WalkForwardConfig = {
  enabled: true,
  trainWindowMonths: 12,   // 12 месяцев обучения
  testWindowMonths: 3,     // 3 месяца теста
  stepMonths: 3            // Сдвиг на 3 месяца
};

// Хелпер для проверки типа параметра
export function isParameterRange(param: ParameterDefinition): param is ParameterRange {
  return 'min' in param && 'max' in param && 'step' in param;
}

export function isParameterValues(param: ParameterDefinition): param is ParameterValues {
  return 'values' in param;
}

// ============================================
// Walk-Forward Analysis (WFA) типы
// ============================================

// Одна итерация Walk-Forward (ТЗ 2.1)
export interface WFAIteration {
  iterationNumber: number;
  
  // Периоды
  trainStart: string;      // Начало In-Sample
  trainEnd: string;        // Конец In-Sample
  testStart: string;       // Начало Out-of-Sample
  testEnd: string;         // Конец Out-of-Sample
  
  // Лучшие параметры найденные на In-Sample
  bestParameters: ParameterSet;
  
  // Результаты In-Sample (обучение)
  inSampleMetrics: {
    netProfitPercent: number;
    maxDrawdownPercent: number;
    calmarRatio: number;
    winRate: number;
    totalTrades: number;
    profitFactor: number;
  };
  
  // Результаты Out-of-Sample (тест)
  outOfSampleMetrics: {
    netProfitPercent: number;
    maxDrawdownPercent: number;
    calmarRatio: number;
    winRate: number;
    totalTrades: number;
    profitFactor: number;
  };
  
  // Сравнение IS vs OOS
  performanceDrop: number;  // % падения Calmar на OOS
  isStable: boolean;        // performanceDrop < maxOosPerformanceDrop
}

// Точка эквити для графика (ТЗ 4.Б)
export interface EquityPoint {
  timestamp: number;
  date: string;
  equity: number;
  equityPercent: number;
  drawdown: number;
  drawdownPercent: number;
  isOutOfSample: boolean;   // true = OOS период, false = IS период
  iterationNumber?: number;
}

// Данные для Heatmap стабильности (ТЗ 4.А)
export interface HeatmapCell {
  param1Value: number | string;
  param2Value: number | string;
  calmarRatio: number;
  netProfitPercent: number;
  maxDrawdownPercent: number;
  winRate: number;
  totalTrades: number;
  isValid: boolean;
}

export interface HeatmapData {
  param1Name: string;
  param1Values: (number | string)[];
  param2Name: string;
  param2Values: (number | string)[];
  cells: HeatmapCell[][];
  bestCell: { row: number; col: number };
}

// Расширенный результат WFA оптимизации
export interface WFAOptimizationResult extends OptimizationResult {
  // Walk-Forward итерации
  wfaIterations: WFAIteration[];
  
  // Склеенная OOS эквити (ТЗ 4.Б)
  walkForwardEquity: EquityPoint[];
  
  // Heatmap данные (ТЗ 4.А)
  heatmapData?: HeatmapData;
  
  // Агрегированные WFA метрики
  wfaSummary: {
    totalIterations: number;
    stableIterations: number;
    stabilityRatio: number;           // stableIterations / totalIterations
    averageOosCalmar: number;
    averageOosProfit: number;
    averageOosDrawdown: number;
    combinedOosProfit: number;        // Итоговый профит по всем OOS
    combinedOosMaxDrawdown: number;   // Макс просадка по всем OOS
    recommendedParameters: ParameterSet;  // Наиболее стабильные параметры
  };
}
