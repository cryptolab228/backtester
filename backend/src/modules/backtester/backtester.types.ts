import { StrategyParameters as ImportedStrategyParameters, StrategyCandle as ImportedStrategyCandle } from '../strategy_logic/strategy';

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
  winRate: number; // winningTrades / totalTrades
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
}

// Настройки для портфельного бектеста
export interface PortfolioSettings {
  maxConcurrentTradesPortfolio?: number; // Максимальное количество одновременных сделок в портфеле
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

// Типы ошибок для API
export interface BacktestError {
  message: string;
  details?: any;
} 