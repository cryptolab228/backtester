/**
 * Типы для системы сессий сканера
 */

export type SessionSource = 'scanner' | 'backtester';
export type SessionStatus = 'running' | 'completed' | 'failed' | 'interrupted';

export interface TradingSession {
  id: string;
  source: SessionSource;
  mode: string;
  strategyVersion: string;
  strategyParamsHash: string;
  strategyParamsSnapshot: Record<string, any>;
  exchange: string;
  pairs: string[];
  timeframes: string[];
  portfolioMode: boolean;
  configSnapshot: Record<string, any>;
  riskSettingsSnapshot?: Record<string, any>;
  allocatorConfigSnapshot?: Record<string, any>;
  startedAt: string;
  endedAt?: string;
  status: SessionStatus;
  name?: string;
  notes?: string;
  autoStarted: boolean;
  createdAt: string;
  createdBy: string;
}

export interface SessionMetrics {
  id: string;
  sessionId: string;
  totalTrades: number;
  openTrades: number;
  closedTrades: number;
  winningTrades: number;
  losingTrades: number;
  totalPnl: number;
  totalPnlPct: number;
  winRate: number;
  avgWinPct: number;
  avgLossPct: number;
  profitFactor: number;
  sharpeRatio?: number;
  maxDrawdown?: number;
  maxDrawdownPct?: number;
  avgTradeDuration?: number;
  totalFees: number;
  updatedAt: string;
}

export interface SessionTrade {
  id: string;
  sessionId: string;
  source: SessionSource;
  mode?: string;
  pair: string;
  timeframe?: string;
  direction?: string;
  exchange?: string;
  strategyId?: string;
  signalId?: string;
  allocationId?: string;
  orderLinkId?: string;
  entryTimestamp?: string;
  entryPrice?: number;
  entryFee?: number;
  entryReason?: string;
  exitTimestamp?: string;
  exitPrice?: number;
  exitFee?: number;
  exitReason?: string;
  positionSize?: number;
  leverage?: number;
  realizedPnl?: number;
  realizedPnlPct?: number;
  maxFavorableExcursion?: number;
  maxAdverseExcursion?: number;
  stopLoss?: number;
  takeProfit?: number;
  trailingStop?: number;
  riskScore?: number;
  confirmationAttempts?: number;
  latencyMs?: number;
  status: 'open' | 'closed' | 'cancelled';
  extra?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSessionParams {
  name: string;
  notes?: string;
  exchange?: string;
  pairs?: string[];
  timeframes?: string[];
}

export interface SessionFilters {
  source?: SessionSource;
  status?: SessionStatus;
  fromDate?: string;
  toDate?: string;
  limit?: number;
}

export interface ScannerStatus {
  isRunning: boolean;
  activeSessionId?: string;
  startedAt?: string;
}

