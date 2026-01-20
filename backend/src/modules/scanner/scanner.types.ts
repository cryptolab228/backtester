import { CandleData } from '@/interfaces/marketData.interface'

export type ExchangeName = 'bybit' | 'okx'

export type SignalDirection = 'long' | 'short'

export interface SignalEngineConfig {
  id: string
  enabled: boolean
  options?: Record<string, any>
}

export interface SignalEngineRuntimeMetrics {
  id: string
  enabled: boolean
  evaluations: number
  signalsEmitted: number
  errors: number
  lastDurationMs: number
  avgDurationMs: number
  lastError?: string
  lastUpdatedAt?: number
}

export interface SignalEngineManagerContract {
  sync(configs: SignalEngineConfig[]): Promise<void>
  evaluateAll(candles: CandleData[], context: SignalContext): Promise<SignalMetadata[]>
  getMetrics(): SignalEngineRuntimeMetrics[]
  getActiveEngineIds(): string[]
}

export interface SignalMetadata {
  id?: string
  pairSymbol: string
  timeframe: string
  exchange?: ExchangeName
  detectedAt: number
  strategyId: string
  strength: number
  direction: SignalDirection
  entryPrice: number
  stopLoss?: number
  takeProfit?: number
  additionalData?: Record<string, any>
  correlationId?: string
  lastCandleTimestamp?: number
  lastCandlePrice?: number
  confirmationTargetPrice?: number
  currentPrice?: number
  priceDelta?: number
  priceDeltaPct?: number
  confirmationExpiresAt?: number
  timeElapsedMs?: number
  timeToConfirmMs?: number
}

export interface ConfirmedSignal extends SignalMetadata {
  confirmedAt: number
  riskScore: number
  recommendedOrderType: 'market' | 'limit'
  recommendedSize: number
  allocationId?: string
  allocationTimestamp?: number
  confirmationAttempts?: number
}

export type PendingSignalStatus = 'waiting' | 'confirmed' | 'cancelled'

export interface PendingSignal extends SignalMetadata {
  status: PendingSignalStatus
  riskScore?: number
  lastUpdatedAt: number
  recommendedSize?: number
  confirmationAttempts?: number
  maxConfirmationAttempts?: number
  confirmWindowSize?: number
  correlationId?: string
}

export interface ConfirmationJobPayload {
  signalId: string
  pairSymbol: string
  timeframe: string
  exchange?: ExchangeName
  triggeredAt: number
  attempt: number
}

export interface ConfirmationJobResult {
  status: 'confirm' | 'cancel' | 'retry'
  reason?: string
}

export interface ConfirmationQueueManagerContract {
  registerHandler(handler: (payload: ConfirmationJobPayload) => Promise<ConfirmationJobResult> | ConfirmationJobResult): void
  scheduleConfirmation(signal: PendingSignal, delayMs: number): Promise<void>
  cancelConfirmation(signalId: string): Promise<void>
  clearAll(): Promise<void>
  shutdown(): Promise<void>
  getStats(): Promise<{ scheduled: number; active: number; failed: number }>
}

export interface SignalQueue {
  enqueue(signal: PendingSignal): Promise<void>
  markAsConfirmed(signalId: string, riskScore: number): Promise<void>
  markAsCancelled(signalId: string, reason: string): Promise<void>
  getPendingSignals(pairSymbol?: string): Promise<PendingSignal[]>
  get(signalId: string): Promise<PendingSignal | null>
  clearAll(): Promise<void>
}

export interface SignalContext {
  pairSymbol: string
  timeframe: string
  exchange?: ExchangeName
}

export interface MarketDataSourceOptions {
  exchange?: ExchangeName
}

export interface MarketDataSource {
  getLatestCandles(
    pairSymbol: string,
    timeframe: string,
    limit: number,
    options?: MarketDataSourceOptions,
  ): Promise<CandleData[]>
}

export interface SignalEngine {
  id: string
  evaluate(candles: CandleData[], context: SignalContext): Promise<SignalMetadata | SignalMetadata[] | null>
}

export interface RiskGateway {
  shouldAllow(signal: SignalMetadata): Promise<boolean>
  computeRiskScore(signal: SignalMetadata): Promise<number>
  registerExecution(signal: ConfirmedSignal): Promise<void>
}

export interface AllocationDecision {
  approved: boolean
  size: number
  reason?: string
}

export interface PortfolioState {
  maxConcurrentTrades: number
  basePositionSize: number
  availableCapital: number
  active: Array<{
    id: string
    pairSymbol: string
    timeframe: string
    exchange?: ExchangeName
    size: number
    timestamp: number
  }>
}

export interface PortfolioAllocator {
  requestAllocation(signal: PendingSignal): Promise<AllocationDecision>
  releaseAllocation(signalId: string, reason?: string): Promise<void>
  resetState(): Promise<void>
  getState(): Promise<PortfolioState>
  syncWithTrades(trades: Array<{
    id: string
    pair: string
    timeframe?: string | null
    entryPrice?: number | null
    positionSize?: number | null
    exchange?: string | null
  }>): Promise<void>
}

export interface ExecutionRecord {
  id: string
  positionKey?: string
  pairSymbol: string
  timeframe: string
  exchange?: ExchangeName
  direction: SignalDirection
  entryPrice: number
  riskScore: number
  size: number
  executedAt: number
  status: 'open' | 'closed'
  stopLoss?: number
  takeProfit?: number
  exitAt?: number
  exitPrice?: number
  exitReason?: 'take_profit' | 'stop_loss' | 'manual'
  pnl?: number
  pnlPercentage?: number
  mode?: ExecutionAdapter['mode']
  external?: ExternalExecutionDetails
  legs?: ExecutionLeg[]
  timeframes?: string[]
  sessionId?: string  // НОВОЕ: Для изоляции позиций между сессиями
  source?: string     // НОВОЕ: Источник создания (для restore)
}

export interface ExecutionLeg {
  id: string
  signalId?: string
  orderId?: string
  orderLinkId?: string
  tradeId?: string
  timeframe?: string
  strategyId?: string
  allocationId?: string
  allocationTimestamp?: number
  allocationSize?: number
  confirmedAt: number
  entryPrice: number
  size: number
  stopLoss?: number
  takeProfit?: number
}

export interface ExecutionManager {
  recordExecution(signal: ConfirmedSignal): Promise<void>
  updatePositionRecord(positionId: string, updates: Partial<ExecutionRecord>, options?: ExecutionAggregationOptions): Promise<ExecutionRecord | null>
  getExecutions(limit?: number): Promise<ExecutionRecord[]>
  getExecutionsBySession(sessionId: string, limit?: number): Promise<ExecutionRecord[]>
  getOpenPositions(): Promise<ExecutionRecord[]>
  getOpenPositionsBySession(sessionId: string): Promise<ExecutionRecord[]>
  closePosition(positionId: string, payload: { exitPrice: number; exitAt: number; exitReason: 'take_profit' | 'stop_loss' | 'manual' }): Promise<ExecutionRecord | null>
  checkForAutoCloses(context: SignalContext, candles: CandleData[]): Promise<ExecutionRecord[]>
  attachExternalOrder(positionId: string, details: ExternalExecutionDetails): Promise<void>
  broadcastSnapshot(): Promise<void>
  clearAll(): Promise<void>
}

export interface ExternalExecutionDetails {
  orderId?: string
  orderLinkId?: string
  closeOrderId?: string
  executionId?: string
  exchange: ExchangeName
  mode: ExecutionAdapter['mode']
  leverage?: number
  status?: string
  filledQty?: number
  avgPrice?: number
  fee?: number
  feeEstimated?: boolean
  feeCurrency?: string
  closeFee?: number
  closeFeeEstimated?: boolean
  totalFee?: number
  markPrice?: number
  unrealizedPnl?: number
  pnlPercentage?: number
  liqPrice?: number
  margin?: number
  positionValue?: number
  initialMargin?: number
  maintenanceMargin?: number
  walletBalance?: number
  availableBalance?: number
  positionIdx?: number
  updatedAt: number
}

export interface ExecutionAggregationOptions {
  mergeBySymbol?: boolean
  combineTimeframes?: boolean
  updateSizeFromExchange?: boolean
  setPositionKey?: boolean
}

export interface ExecutionAdapter {
  mode: 'dry-run' | 'paper' | 'shadow' | 'testnet' | 'demo' | 'live'
  execute(signal: ConfirmedSignal): Promise<void>
}

export interface ExecutionController {
  start(): Promise<void>
  stop(): void
}

export interface SignalPublisher {
  publishDetected(signal: SignalMetadata): Promise<void>
  publishConfirmed(signal: ConfirmedSignal): Promise<void>
  publishCancelled(signalId: string, reason: string): Promise<void>
  publishUpdated?(signal: PendingSignal): Promise<void>
  publishStatus(config: any): Promise<void>
}

export interface RuntimeScannerConfig {
  enabled: boolean
  executionMode: ExecutionAdapter['mode']
  confirmWindowSize: number
  confirmRetries: number
  engines: SignalEngineConfig[]
  pairs: Array<{
    symbol: string
    timeframes: string[]
    exchange?: ExchangeName
  }>
  refreshIntervalMs: number
  confirmRetryDelayMs: number
  riskScoreThreshold: number
  maxConcurrentTrades: number
  basePositionSize: number
  initialCapital: number
  riskPerTrade?: number
}

export interface ScannerServiceOptions {
  marketDataSource: MarketDataSource
  signalPublisher: SignalPublisher
  executionAdapter: ExecutionAdapter
  riskGateway: RiskGateway
  confirmWindowSize: number
  riskScoreThreshold: number
  portfolioAllocator: PortfolioAllocator
  executionManager: ExecutionManager
  engineManager: SignalEngineManagerContract
  testnetExecutionManager?: ExecutionController
  demoExecutionManager?: ExecutionController
  runtimeConfig?: RuntimeScannerConfig
}


