import { StrategyParameters as ImportedStrategyParameters, StrategyCandle as ImportedStrategyCandle, RiskManagementSettings } from '../strategy_logic/strategy';
import { ExecutionProfile } from '../execution/executionProfile';
import type { ProfileName, ExtendedStrategyParameters } from '../strategy_logic/profiles';
import type { FuturesBacktestStats } from '../futures/types';

// Re-exporting for wider use within the module and by other modules like config
export type StrategyParameters = ImportedStrategyParameters;
export type StrategyCandle = ImportedStrategyCandle;

// Параметры для запуска одного бэктеста
export interface BacktestRunParameters {
  pairSymbol: string;
  timeframe: string; // Например, '15m', '1h', '1d'
  startDate: string; // ISO string date
  endDate: string;   // ISO string date
  initialCapital: number;
  strategyParameters: StrategyParameters;
  exchange?: string; // НОВОЕ: поддержка биржи (okx | bybit)
  useGPU?: boolean; // НОВОЕ: флаг использования GPU ускорения
  executionProfile?: ExecutionProfile;
  simulateConfirmation?: boolean;
  
  // НОВОЕ: Поддержка профилей стратегий
  strategyProfile?: ProfileName; // 'spot' | 'futures'
  extendedParameters?: ExtendedStrategyParameters; // Расширенные параметры с futures настройками
}

// Детали одной сделки
export enum TradeDirection {
  LONG = 'long',
  SHORT = 'short',
}

export interface Trade {
  id: string; // UUID
  pair: string; // Символ пары, для которой была совершена сделка
  entryTimestamp: number;
  exitTimestamp?: number;
  direction: TradeDirection;
  entryPrice: number;
  exitPrice?: number;
  size: number; // Количество контрактов/монет
  pnl?: number; // Profit and Loss
  pnlPercentage?: number;
  stopLoss?: number;
  takeProfit?: number;
  trailingStop?: number;
  entryReason?: string;
  exitReason?: string; // Например, 'SL', 'TP', 'Market Close', 'Signal Reversed'
  fees?: number;
  status?: 'active' | 'closed' | 'cancelled'; // Статус сделки
  // Optional fields from backend calculation if available from frontend definition
  commission?: number;
  slippage?: number;
  duration?: number; // in milliseconds or seconds
  profitPercentage?: number; // This was pnlPercentage, ensure consistency
  riskRewardRatio?: number;
}

// Основные метрики по результатам бэктеста
export interface BacktestMetrics {
  totalPnl: number;
  totalPnlPercentage: number; // This could be derived or directly stored
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  /**
   * Win rate в ПРОЦЕНТАХ (0..100).
   * Внутренние формулы (expectancy и т.п.) используют десятичную форму 0..1,
   * но наружу и в API всегда возвращаем проценты для единообразия UI.
   */
  winRate: number;
  maxDrawdown: number; // Максимальная просадка в %, ensure consistency (0.1 or 10)
  profitFactor: number; // Gross Profit / Gross Loss
  avgTradePnl?: number;
  avgWinningTrade?: number;
  avgLosingTrade?: number;
  sharpeRatio?: number; 
  sortinoRatio?: number; 
  expectancy?: number; 
  durationMs?: number; // Время выполнения бэктеста
  equityCurve?: Array<{ timestamp: number; capital: number }>; // Динамика капитала
  // Added from frontend type definition for consistency
  grossProfit?: number;
  grossLoss?: number;
  initialCapital?: number; // Added, as it's part of metrics in frontend type
  finalCapital?: number;   // Added
  
  // НОВОЕ: Метрики для фьючерсов
  futuresStats?: FuturesBacktestStats;
  
  [key: string]: any; 
}

// Полный результат одного бэктеста
export interface BacktestResult {
  jobId?: string; 
  status?: 'queued' | 'running' | 'completed' | 'failed';
  message?: string; 
  metrics: BacktestMetrics;
  trades: Trade[];
  logs?: string[]; 
  configUsed?: BacktestRunParameters; 
  // Опционально можно возвращать свечи с индикаторами для отладки/графиков
  strategyCandles?: StrategyCandle[]; 
}

// === НОВЫЕ ТИПЫ ДЛЯ МУЛЬТИ-БЕКТЕСТЕРА ===

// Параметры для запуска портфельного бэктеста
export interface PortfolioBacktestRunParameters {
  pairSymbols: string[]; // Массив торговых пар
  timeframe: string;
  startDate: string;
  endDate: string;
  initialPortfolioCapital: number;
  strategyParameters: StrategyParameters;
  portfolioSettings?: PortfolioSettings;
  exchange?: string; // НОВОЕ: поддержка биржи (okx | bybit)
  useGPU?: boolean; // НОВОЕ: флаг использования GPU ускорения
  executionProfile?: ExecutionProfile;
  simulateConfirmation?: boolean;
}

// Настройки для портфельного бектеста
export interface PortfolioSettings {
  maxConcurrentTradesPortfolio?: number; // Максимальное количество одновременных сделок в портфеле
  maxConcurrentTrades?: number; // ИСПРАВЛЕНИЕ: Альтернативное название для совместимости с GPU модулем
}

// Точка данных для кривой эквити портфеля
export interface EquityDataPoint {
  timestamp: number;
  capital: number;
}

// Метрики портфеля (расширенные метрики для мульти-бектеста)
export interface PortfolioMetrics {
  totalPortfolioPnl: number;
  totalPortfolioPnlPercentage: number;
  totalPortfolioTrades: number;
  portfolioWinningTrades: number;
  portfolioLosingTrades: number;
  portfolioWinRate: number;
  portfolioProfitFactor: number;
  portfolioMaxDrawdown: number;
  portfolioGrossProfit: number;
  portfolioGrossLoss: number;
  portfolioAverageTradePnl: number;
  portfolioExpectancy: number;
  
  // Новые специфичные для портфеля метрики
  sharpeRatioPortfolio: number; // Коэффициент Шарпа портфеля
  avgConcurrentTrades: number; // Среднее количество одновременных сделок
  peakConcurrentTrades: number; // Пиковое количество одновременных сделок
  
  initialPortfolioCapital: number;
  finalPortfolioCapital: number;
  portfolioEquityCurve: EquityDataPoint[];
  durationMs: number;
}

// Результат портфельного бектеста
export interface PortfolioBacktestResult {
  jobId?: string;
  status?: 'queued' | 'running' | 'completed' | 'failed';
  message?: string;
  
  // Общие метрики портфеля
  overallMetrics: PortfolioMetrics;
  
  // Детализация по парам
  tradesByPair: Record<string, Trade[]>; // Ключ = символ пары, значение = массив сделок
  metricsByPair: Record<string, BacktestMetrics>; // Метрики по каждой паре отдельно
  
  // Конфигурация и метаданные
  configUsed?: PortfolioBacktestRunParameters;
  logs?: string[];
  
  // Опционально: детальные данные по свечам для каждой пары
  strategyCandlesByPair?: Record<string, StrategyCandle[]>;
}

// === КОНЕЦ НОВЫХ ТИПОВ ===

// === СОБЫТИЙНАЯ АРХИТЕКТУРА ===

// Типы событий бэктестера
export enum BacktestEventType {
  // События данных
  ON_BAR = 'onBar',
  ON_TICK = 'onTick',

  // События сигналов
  ON_SIGNAL = 'onSignal',

  // События ордеров
  ON_ORDER_CREATED = 'onOrderCreated',
  ON_ORDER_FILLED = 'onOrderFilled',
  ON_ORDER_REJECTED = 'onOrderRejected',
  ON_ORDER_CANCELLED = 'onOrderCancelled',

  // События позиций
  ON_POSITION_OPENED = 'onPositionOpened',
  ON_POSITION_CLOSED = 'onPositionClosed',
  ON_POSITION_UPDATED = 'onPositionUpdated',

  // События риск-менеджмента
  ON_RISK_CHECK = 'onRiskCheck',
  ON_RISK_VIOLATION = 'onRiskViolation',

  // События портфеля
  ON_PORTFOLIO_UPDATED = 'onPortfolioUpdated',

  // События завершения
  ON_BACKTEST_START = 'onBacktestStart',
  ON_BACKTEST_END = 'onBacktestEnd',
  ON_BACKTEST_ERROR = 'onBacktestError'
}

// Базовый интерфейс события
export interface BacktestEvent {
  type: BacktestEventType;
  timestamp: number;
  data: any;
}

// Union type для всех событий
export type AnyBacktestEvent = BacktestEvent;

// === МОДЕЛИ КОМИССИЙ И ПРОСКАЛЬЗЫВАНИЯ ===

// Модель комиссии
export interface CommissionModel {
  calculate(order: Order, executionPrice: number): number;
}

// Фиксированная комиссия за сделку
export interface PerTradeCommission extends CommissionModel {
  fixedFee: number;
}

// Комиссия за акцию/контракт
export interface PerShareCommission extends CommissionModel {
  costPerShare: number;
  minCost?: number;
}

// Процентная комиссия
export interface PerDollarCommission extends CommissionModel {
  rate: number; // 0.001 = 0.1%
}

// Модель проскальзывания
export interface SlippageModel {
  calculate(order: Order, barPrice: number): number;
}

// Фиксированное проскальзывание
export interface FixedSlippage extends SlippageModel {
  spread: number; // Фиксированное значение
}

// Пропорциональное проскальзывание
export interface VolumeShareSlippage extends SlippageModel {
  volumeLimit: number;
  priceImpact: number;
}

// === УЛУЧШЕННЫЕ ТИПЫ ДЛЯ ОРДЕРОВ И ПОЗИЦИЙ ===

// Ордер
export interface Order {
  id: string;
  symbol: string;
  type: 'market' | 'limit' | 'stop' | 'stop_limit';
  side: 'buy' | 'sell';
  quantity: number;
  price?: number; // Для limit/stop ордеров
  stopPrice?: number; // Для stop ордеров
  timeInForce: 'gtc' | 'ioc' | 'fok';
  status: 'pending' | 'open' | 'filled' | 'cancelled' | 'rejected';
  createdAt: number;
  filledAt?: number;
  filledQuantity?: number;
  filledPrice?: number;
  fees?: number;
  slippage?: number;
}

// Позиция
export interface Position {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  quantity: number;
  averagePrice: number;
  marketValue: number;
  unrealizedPnL: number;
  realizedPnL: number;
  openedAt: number;
  updatedAt: number;
  trades: Trade[];
  stopLoss?: number;
  takeProfit?: number;
  trailingStop?: {
    offset: number;
    step: number;
    activated: boolean;
  };
}

// === ОБРАБОТЧИКИ СОБЫТИЙ ===

// Интерфейс обработчика событий
export interface EventHandler {
  handle(event: AnyBacktestEvent): Promise<void> | void;
  getPriority(): number; // Для определения порядка обработки
}

// Регистр обработчиков событий
export interface EventHandlerRegistry {
  register(eventType: BacktestEventType, handler: EventHandler): void;
  unregister(eventType: BacktestEventType, handler: EventHandler): void;
  getHandlers(eventType: BacktestEventType): EventHandler[];
  emit(event: AnyBacktestEvent): Promise<void>;
}

// === КОНТЕКСТ БЭКТЕСТА ===
export interface BacktestContext {
  // Данные
  candles: StrategyCandle[];
  currentIndex: number;
  currentCandle: StrategyCandle;

  // Состояние
  portfolio: {
    cash: number;
    positions: Map<string, Position>;
    totalValue: number;
    totalReturn: number;
  };

  // Конфигурация
  initialCapital: number;
  commissionModel: CommissionModel;
  slippageModel: SlippageModel;
  riskSettings: RiskManagementSettings;

  // События
  events: EventHandlerRegistry;

  // Метаданные
  startTime: number;
  currentTime: number;
}

// Типы ошибок для API
export interface BacktestError {
  message: string;
  details?: any;
} 