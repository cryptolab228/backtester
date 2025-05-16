import { StrategyParameters, StrategyCandle } from '../strategy_logic/strategy';

// Параметры для запуска одного бэктеста
export interface BacktestRunParameters {
  pairSymbol: string;
  timeframe: string; // Например, '15m', '1h', '1d'
  startDate: Date; // Или string, если будем парсить
  endDate: Date;   // Или string
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
}

// Основные метрики по результатам бэктеста
export interface BacktestMetrics {
  totalPnl: number;
  totalPnlPercentage: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number; // winningTrades / totalTrades
  maxDrawdown?: number; // Максимальная просадка в %
  profitFactor?: number; // Gross Profit / Gross Loss
  avgTradePnl?: number;
  avgWinningTrade?: number;
  avgLosingTrade?: number;
  sharpeRatio?: number; // (Пока можно опустить, требует Risk-Free Rate)
  sortinoRatio?: number; // (Пока можно опустить)
  expectancy?: number; // (Win Rate (0-1) * Avg Win) - (Loss Rate (0-1) * Avg Loss)
  durationMs?: number; // Время выполнения бэктеста
  equityCurve?: Array<{ timestamp: number; capital: number }>; // Динамика капитала
}

// Полный результат одного бэктеста
export interface BacktestResult {
  parameters: BacktestRunParameters;
  metrics: BacktestMetrics;
  trades: Trade[];
  // Опционально можно возвращать свечи с индикаторами для отладки/графиков
  strategyCandles?: StrategyCandle[]; 
} 