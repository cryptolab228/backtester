import crypto from 'crypto';

import config from '@/config';
import { CandleData } from '@/interfaces/marketData.interface';
import logger from '@/utils/logger';

import {
  ConfirmedSignal,
  PendingSignal,
  RuntimeScannerConfig,
  ScannerServiceOptions,
  SignalContext,
  SignalMetadata,
  ConfirmationJobPayload,
  ConfirmationJobResult,
  SignalDirection,
} from './scanner.types';
import signalQueue from './signalQueue';
import scannerConfigService from './scannerConfig.service';
import { confirmationQueueManager } from './confirmationQueue';
import { healthMonitor } from './healthMonitor';
import { executionManager as sharedExecutionManager } from './adapters';

const SERVICE_LOG = logger.child({ module: 'ScannerService' });

const TIMEFRAME_DURATIONS: Record<string, number> = {
  '1m': 60_000,
  '3m': 3 * 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 60 * 60_000,
  '2h': 2 * 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '6h': 6 * 60 * 60_000,
  '8h': 8 * 60 * 60_000,
  '12h': 12 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
  '1w': 7 * 24 * 60 * 60_000,
  '1M': 30 * 24 * 60 * 60_000,
};

const unrefTimer = (handle: ReturnType<typeof setTimeout>): void => {
  const timer = handle as { unref?: () => void };
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
};

export class ScannerService {
  private static readonly CANDLE_HISTORY_LIMIT = 600
  private static readonly DUPLICATE_COOLDOWN_MS = 5 * 60 * 1000
  private static readonly INSUFFICIENT_CAPITAL_COOLDOWN_MS = 10 * 60 * 1000
  private static readonly TIMEFRAME_SETTINGS: Record<string, { confirmationDelayMs: number; maxAttempts: number; confirmWindowSize?: number }> = {
    '1m': { confirmationDelayMs: 15_000, maxAttempts: 8, confirmWindowSize: 2 },
    '3m': { confirmationDelayMs: 30_000, maxAttempts: 8, confirmWindowSize: 2 },
    '5m': { confirmationDelayMs: 60_000, maxAttempts: 8, confirmWindowSize: 2 },
    '15m': { confirmationDelayMs: 180_000, maxAttempts: 8, confirmWindowSize: 2 },
    '30m': { confirmationDelayMs: 300_000, maxAttempts: 8, confirmWindowSize: 2 },
    '1h': { confirmationDelayMs: 900_000, maxAttempts: 8, confirmWindowSize: 2 },
    '2h': { confirmationDelayMs: 1_800_000, maxAttempts: 8, confirmWindowSize: 2 },
    '4h': { confirmationDelayMs: 2_700_000, maxAttempts: 6, confirmWindowSize: 2 },
    '6h': { confirmationDelayMs: 3_600_000, maxAttempts: 6, confirmWindowSize: 2 },
    '8h': { confirmationDelayMs: 4_500_000, maxAttempts: 6, confirmWindowSize: 2 },
    '12h': { confirmationDelayMs: 5_400_000, maxAttempts: 5, confirmWindowSize: 2 },
    '1d': { confirmationDelayMs: 10_800_000, maxAttempts: 5, confirmWindowSize: 2 },
  }

  private readonly marketDataSource = this.options.marketDataSource
  private readonly engineManager = this.options.engineManager
  private readonly signalPublisher = this.options.signalPublisher
  private readonly executionAdapter = this.options.executionAdapter
  private readonly riskGateway = this.options.riskGateway
  private readonly portfolioAllocator = this.options.portfolioAllocator
  private readonly executionManager = this.options.executionManager
  private readonly testnetExecutionManager = this.options.testnetExecutionManager
  private readonly demoExecutionManager = this.options.demoExecutionManager

  private readonly confirmWindowSize: number
  private readonly riskScoreThreshold: number

  private running = false
  private readonly intervalHandles = new Map<string, ReturnType<typeof setInterval>>()
  private currentConfig: RuntimeScannerConfig
  private unsubscribeConfig?: () => void
  private readonly recoveryLog = logger.child({ module: 'ScannerRecovery' })
  private readonly recentSignalTracker = new Map<string, number>()
  private readonly pendingTracker = new Map<string, { count: number; lastUpdated: number; maxRefreshes: number }>()

  constructor(private readonly options: ScannerServiceOptions) {
    this.confirmWindowSize = options.confirmWindowSize;
    this.riskScoreThreshold = options.riskScoreThreshold;
    this.currentConfig = options.runtimeConfig || (config.scanner as unknown as RuntimeScannerConfig);
    confirmationQueueManager.registerHandler((payload) => this.handleConfirmationJob(payload));
  }

  private buildDedupKey(signal: SignalMetadata | PendingSignal): string {
    return `${signal.pairSymbol}:${signal.timeframe}:${signal.direction}`;
  }

  private registerSignalForDedup(signal: SignalMetadata): void {
    const key = this.buildDedupKey(signal);
    this.recentSignalTracker.set(key, signal.detectedAt);
    const timer = setTimeout(() => {
      const current = this.recentSignalTracker.get(key);
      if (current && current <= signal.detectedAt) {
        this.recentSignalTracker.delete(key);
      }
    }, ScannerService.DUPLICATE_COOLDOWN_MS);
    unrefTimer(timer);
  }

  private unregisterSignalFromDedup(signal: SignalMetadata | PendingSignal): void {
    const key = this.buildDedupKey(signal);
    this.recentSignalTracker.delete(key);
  }

  private isDuplicateSignal(signal: SignalMetadata): boolean {
    const key = this.buildDedupKey(signal);
    const previous = this.recentSignalTracker.get(key);
    return !!previous && signal.detectedAt - previous <= ScannerService.DUPLICATE_COOLDOWN_MS;
  }

  private calculateMaxRefreshes(timeframe?: string): number {
    const delay = this.calculateConfirmationDelay(timeframe);
    const interval = Math.max(this.currentConfig.refreshIntervalMs, 1_000);
    const windowSize = Math.max(delay, interval);
    const rawLimit = Math.ceil(windowSize / interval) + 2;
    if (!timeframe) {
      return Math.max(rawLimit, 8);
    }

    const settings = ScannerService.TIMEFRAME_SETTINGS[timeframe];
    if (settings) {
      const timeframeLimit = Math.ceil(settings.confirmationDelayMs / interval) + 2;
      return Math.max(8, timeframeLimit);
    }

    return Math.max(rawLimit, 6);
  }

  private trackPending(signal: PendingSignal, reset = false): void {
    const key = this.buildDedupKey(signal);
    const record = this.pendingTracker.get(key);
    if (reset || !record) {
      this.pendingTracker.set(key, {
        count: 1,
        lastUpdated: Date.now(),
        maxRefreshes: this.calculateMaxRefreshes(signal.timeframe),
      });
    } else {
      this.pendingTracker.set(key, {
        count: record.count + 1,
        lastUpdated: Date.now(),
        maxRefreshes: record.maxRefreshes,
      });
    }
  }

  private untrackPending(signal: PendingSignal): void {
    const key = this.buildDedupKey(signal);
    this.pendingTracker.delete(key);
  }

  async start(): Promise<void> {
    SERVICE_LOG.info('Starting scanner service');
    this.running = true;
    this.clearTrackingCaches();
    this.setupConfigSubscription();
    await this.syncEngines();
    this.scheduleAllPairs();
    await this.restorePendingState();
    await this.executionManager.broadcastSnapshot?.();
    if (this.currentConfig.executionMode === 'testnet' && this.testnetExecutionManager) {
      try {
        await this.testnetExecutionManager.start();
      } catch (error: any) {
        SERVICE_LOG.error('Failed to start testnet execution manager', { error: error?.message || error });
      }
    }
    if (this.currentConfig.executionMode === 'demo' && this.demoExecutionManager) {
      try {
        await this.demoExecutionManager.start();
      } catch (error: any) {
        SERVICE_LOG.error('Failed to start demo execution manager', { error: error?.message || error });
      }
    }
  }

  stop(): void {
    SERVICE_LOG.info('Stopping scanner service');
    this.running = false;
    this.intervalHandles.forEach((handle) => clearInterval(handle));
    this.intervalHandles.clear();
    this.clearTrackingCaches();
    if (this.unsubscribeConfig) {
      this.unsubscribeConfig();
      this.unsubscribeConfig = undefined;
    }
    void confirmationQueueManager.shutdown().catch((error) => {
      SERVICE_LOG.error('Failed to shutdown confirmation queue manager', { error });
    });
    if (this.testnetExecutionManager) {
      try {
        this.testnetExecutionManager.stop();
      } catch (error: any) {
        SERVICE_LOG.error('Failed to stop testnet execution manager', { error: error?.message || error });
      }
    }
    if (this.demoExecutionManager) {
      try {
        this.demoExecutionManager.stop();
      } catch (error: any) {
        SERVICE_LOG.error('Failed to stop demo execution manager', { error: error?.message || error });
      }
    }
  }

  get isRunning(): boolean {
    return this.running;
  }

  private async syncEngines(): Promise<void> {
    try {
      await this.engineManager.sync(this.currentConfig.engines);
    } catch (error) {
      SERVICE_LOG.error('Failed to sync signal engines', { error });
    }
  }

  private async restorePendingState(): Promise<void> {
    try {
      const pendingSignals = await signalQueue.getPendingSignals();
      if (pendingSignals.length === 0) {
        return;
      }

      const waitingSignals = pendingSignals.filter((signal) => signal.status === 'waiting');
      if (waitingSignals.length === 0) {
        this.recoveryLog.info('No waiting signals to restore', { total: pendingSignals.length });
        return;
      }

      this.recoveryLog.info('Restoring pending signals after startup', {
        total: pendingSignals.length,
        waiting: waitingSignals.length,
      });

      for (const pending of waitingSignals) {
        if (!pending.id) {
          this.recoveryLog.warn('Skipping pending signal without id', {
            pair: pending.pairSymbol,
            timeframe: pending.timeframe,
          });
          continue;
        }

        try {
          pending.confirmWindowSize = this.getConfirmWindowSize(pending.timeframe);
          pending.maxConfirmationAttempts = this.getMaxConfirmationAttempts(pending.timeframe);
          await signalQueue.enqueue({ ...pending });
          const delay = this.calculateConfirmationDelay(pending.timeframe);
          await confirmationQueueManager.scheduleConfirmation(pending, delay);
          this.trackPending(pending, true);
        } catch (error) {
          this.recoveryLog.error('Failed to reschedule pending signal', {
            signalId: pending.id,
            pair: pending.pairSymbol,
            timeframe: pending.timeframe,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } catch (error) {
      this.recoveryLog.error('Failed to restore pending state', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  private setupConfigSubscription(): void {
    if (this.unsubscribeConfig) {
      return;
    }

    this.unsubscribeConfig = scannerConfigService.subscribe(async (configUpdate) => {
      SERVICE_LOG.info('Runtime scanner config updated', configUpdate);
      this.currentConfig = configUpdate;
      this.signalPublisher.publishStatus?.(configUpdate).catch((error) => {
        SERVICE_LOG.warn('Failed to publish scanner status update', { error });
      });
      await this.syncEngines();
      this.reschedule();
    });
  }

  private reschedule(): void {
    this.intervalHandles.forEach((handle) => clearInterval(handle));
    this.intervalHandles.clear();
    this.clearTrackingCaches();
    this.scheduleAllPairs();
  }

  private scheduleAllPairs(): void {
    if (!this.running) {
      return;
    }

    const pairs = this.currentConfig.pairs.length > 0 ? this.currentConfig.pairs : config.scanner.pairs;
    const refreshMs = this.currentConfig.refreshIntervalMs || config.scanner.refreshIntervalMs;

    pairs.forEach((pairConfig) => {
      pairConfig.timeframes.forEach((timeframe) => {
        const key = `${pairConfig.symbol}::${timeframe}`;
        if (this.intervalHandles.has(key)) {
          return;
        }
        const interval = setInterval(() => {
          if (!this.running) {
            return;
          }
          void this.executeCycle({ pairSymbol: pairConfig.symbol, timeframe, exchange: pairConfig.exchange || 'bybit' });
        }, refreshMs);
        this.intervalHandles.set(key, interval);
      });
    });
  }

  private async executeCycle(context: SignalContext): Promise<void> {
    const cycleId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const start = Date.now();
    SERVICE_LOG.debug('Starting scanner cycle', { ...context, cycleId });
    try {
      const candles = await this.marketDataSource.getLatestCandles(context.pairSymbol, context.timeframe, ScannerService.CANDLE_HISTORY_LIMIT, {
        exchange: context.exchange,
      });
      if (!candles || candles.length === 0) {
        SERVICE_LOG.warn('No candles returned for scan', { ...context, cycleId });
        healthMonitor.recordFailure(context, new Error('no_candles'), cycleId);
        return;
      }

      await sharedExecutionManager.checkForAutoCloses(context, candles);
      const engineSignals = await this.engineManager.evaluateAll(candles, context);
      for (const signal of engineSignals) {
        signal.exchange = context.exchange;
        if (!signal.correlationId) {
          signal.correlationId = `${cycleId}-${signal.strategyId}`;
        }
        await this.processSignal(signal, candles);
      }

      await this.evaluatePendingSignals(context, candles);
      const duration = Date.now() - start;
      healthMonitor.recordSuccessfulCycle(context, candles.length, duration, cycleId);
    } catch (error) {
      SERVICE_LOG.error('Error during scanner cycle', { ...context, error, cycleId });
      healthMonitor.recordFailure(context, error, cycleId);
    }
  }

  private async processSignal(signal: SignalMetadata, candles: CandleData[]): Promise<void> {
    const pendingSignals = await signalQueue.getPendingSignals(signal.pairSymbol);
    const waitingSameTimeframe = pendingSignals.filter((pending) => pending.status === 'waiting'
      && pending.timeframe === signal.timeframe);

    let cancelledOpposite = false;
    for (const pending of waitingSameTimeframe) {
      if (pending.direction !== signal.direction) {
        cancelledOpposite = true;
        SERVICE_LOG.info('Cancelling pending signal due to opposite direction', {
          pair: pending.pairSymbol,
          timeframe: pending.timeframe,
          existingDirection: pending.direction,
          newDirection: signal.direction,
          existingId: pending.id,
        });
        await this.cancelPendingSignal(pending, 'opposite_signal');
      }
    }

    const pendingPool = cancelledOpposite ? await signalQueue.getPendingSignals(signal.pairSymbol) : pendingSignals;
    const overlappingPending = pendingPool.find((pending) => pending.status === 'waiting'
      && pending.timeframe === signal.timeframe
      && pending.direction === signal.direction);

    if (overlappingPending) {
      SERVICE_LOG.debug('Refreshing existing pending signal with latest data', {
        pair: signal.pairSymbol,
        timeframe: signal.timeframe,
        direction: signal.direction,
        detectedAt: signal.detectedAt,
        existingDetectedAt: overlappingPending.detectedAt,
        existingId: overlappingPending.id,
      });
      await this.refreshPendingSignal(overlappingPending, signal, candles);
      return;
    }

    if (this.isDuplicateSignal(signal)) {
      SERVICE_LOG.debug('Duplicate signal detected via cooldown cache, skipping', {
        pair: signal.pairSymbol,
        timeframe: signal.timeframe,
        direction: signal.direction,
        detectedAt: signal.detectedAt,
      });
      return;
    }

    const signalId = signal.id ?? this.buildSignalId(signal);

    const allow = await this.riskGateway.shouldAllow(signal);
    if (!allow) {
      SERVICE_LOG.debug('Signal blocked by RiskGateway', {
        pair: signal.pairSymbol,
        timeframe: signal.timeframe,
        correlationId: signal.correlationId,
      });
      await this.signalPublisher.publishCancelled(signalId, 'blocked_by_risk_gateway');
      return;
    }

    const riskScore = await this.riskGateway.computeRiskScore(signal);
    const targetPrice = this.calculateConfirmationTarget(signal.direction, signal.entryPrice);

    const confirmDelay = this.calculateConfirmationDelay(signal.timeframe);

    const pendingEntity: PendingSignal = {
      ...signal,
      id: signalId,
      status: 'waiting',
      riskScore,
      lastUpdatedAt: Date.now(),
      confirmationAttempts: 0,
      maxConfirmationAttempts: this.getMaxConfirmationAttempts(signal.timeframe),
      confirmWindowSize: this.getConfirmWindowSize(signal.timeframe),
      confirmationTargetPrice: targetPrice,
    };

    const latestCandle = candles[candles.length - 1] ?? null;
    this.applyPendingMetrics(pendingEntity, latestCandle, confirmDelay);

    if (!pendingEntity.stopLoss && pendingEntity.additionalData?.atr && pendingEntity.entryPrice) {
      const atr = Number(pendingEntity.additionalData.atr);
      if (Number.isFinite(atr) && atr > 0) {
        const stopMultiplier = 3;
        pendingEntity.stopLoss = pendingEntity.direction === 'long'
          ? pendingEntity.entryPrice - atr * stopMultiplier
          : pendingEntity.entryPrice + atr * stopMultiplier;
      }
    }

    const allocationDecision = await this.portfolioAllocator.requestAllocation(pendingEntity);
    if (!allocationDecision.approved) {
      SERVICE_LOG.warn('Signal rejected by PortfolioAllocator', {
        signalId,
        reason: allocationDecision.reason,
        correlationId: signal.correlationId,
      });
      await this.signalPublisher.publishCancelled(signalId, allocationDecision.reason || 'allocation_rejected');
      const rejectionKey = this.buildDedupKey(signal);
      this.recentSignalTracker.set(rejectionKey, Date.now());
      const timer = setTimeout(() => {
        const stored = this.recentSignalTracker.get(rejectionKey);
        if (stored && Date.now() - stored >= ScannerService.INSUFFICIENT_CAPITAL_COOLDOWN_MS) {
          this.recentSignalTracker.delete(rejectionKey);
        }
      }, ScannerService.INSUFFICIENT_CAPITAL_COOLDOWN_MS);
      unrefTimer(timer);
      return;
    }

    pendingEntity.recommendedSize = allocationDecision.size;

    await signalQueue.enqueue(pendingEntity);
    await this.signalPublisher.publishDetected(pendingEntity);
    await confirmationQueueManager.scheduleConfirmation(pendingEntity, confirmDelay);
    this.registerSignalForDedup(signal);
    this.trackPending(pendingEntity, true);

    if (riskScore < this.riskScoreThreshold) {
      SERVICE_LOG.debug('Signal riskScore below threshold', {
        pair: signal.pairSymbol,
        timeframe: signal.timeframe,
        riskScore,
        correlationId: signal.correlationId,
      });
      await this.cancelPendingSignal(pendingEntity, 'risk_score_below_threshold');
    }
  }

  private buildSignalId(signal: SignalMetadata): string {
    return signal.id || crypto.createHash('md5').update(`${signal.exchange || 'bybit'}-${signal.pairSymbol}-${signal.timeframe}-${signal.detectedAt}-${signal.strategyId}`).digest('hex');
  }

  private async evaluatePendingSignals(context: SignalContext, candles: CandleData[]): Promise<void> {
    const pendingSignals = await signalQueue.getPendingSignals(context.pairSymbol);
    if (!pendingSignals.length) {
      return;
    }

    const seen = new Set<string>();

    for (const pending of pendingSignals) {
      if (pending.timeframe !== context.timeframe || pending.status !== 'waiting') {
        continue;
      }

      if (pending.id) {
        if (seen.has(pending.id)) {
          SERVICE_LOG.warn('Duplicate pending signal detected, cancelling extra entry', {
            signalId: pending.id,
            pair: pending.pairSymbol,
            timeframe: pending.timeframe,
          });
          await this.cancelPendingSignal(pending, 'duplicate_pending');
          continue;
        }
        seen.add(pending.id);
      }

      const decision = this.evaluatePendingSignal(pending, candles);

      if (decision === 'confirm') {
        await this.confirmPendingSignal(pending);
      } else if (decision !== 'waiting') {
        await this.cancelPendingSignal(pending, decision);
      } else {
        await signalQueue.enqueue({ ...pending });
        // ✅ Broadcast обновленных метрик на фронтенд
        await this.signalPublisher.publishUpdated?.(pending);
      }
    }
  }

  private async handleConfirmationJob(payload: ConfirmationJobPayload): Promise<ConfirmationJobResult> {
    const pending = await signalQueue.get(payload.signalId);
    if (!pending || pending.status !== 'waiting') {
      return { status: 'cancel', reason: 'signal_not_found' };
    }

    pending.confirmationAttempts = (pending.confirmationAttempts ?? 0) + 1;
    await signalQueue.enqueue({ ...pending });

    if (pending.maxConfirmationAttempts && pending.confirmationAttempts >= pending.maxConfirmationAttempts) {
      await this.cancelPendingSignal(pending, 'confirmation_timeout');
      return { status: 'cancel', reason: 'confirmation_timeout' };
    }

    let candles: CandleData[] = [];
    try {
      candles = await this.marketDataSource.getLatestCandles(
        pending.pairSymbol,
        pending.timeframe,
        ScannerService.CANDLE_HISTORY_LIMIT,
        { exchange: pending.exchange },
      );
    } catch (error: any) {
      SERVICE_LOG.warn('Failed to fetch candles for confirmation job, retrying', {
        signalId: pending.id,
        pair: pending.pairSymbol,
        timeframe: pending.timeframe,
        attempt: pending.confirmationAttempts,
        error: error?.message || error,
      });

      await confirmationQueueManager.scheduleConfirmation(
        pending,
        this.calculateConfirmationDelay(pending.timeframe),
      );

      return { status: 'retry' };
    }

    if (candles.length) {
      const latest = candles[candles.length - 1];
      this.applyPendingMetrics(pending, latest);
    } else {
      this.applyPendingMetrics(pending, null);
    }

    await signalQueue.enqueue({ ...pending });
    // ✅ Broadcast обновленных метрик после confirmation job
    await this.signalPublisher.publishUpdated?.(pending);

    const decision = this.evaluatePendingSignal(pending, candles);

    if (decision === 'confirm') {
      await this.confirmPendingSignal(pending);
      return { status: 'confirm', reason: 'confirmed', riskScore: pending.riskScore } as ConfirmationJobResult & { riskScore?: number };
    }

    if (decision === 'waiting') {
      await confirmationQueueManager.scheduleConfirmation(pending, this.calculateConfirmationDelay(pending.timeframe));
      return { status: 'retry' };
    }

    await this.cancelPendingSignal(pending, decision);
    return { status: 'cancel', reason: decision };
  }

  private evaluatePendingSignal(pending: PendingSignal, candles: CandleData[]): 'waiting' | 'stop_loss_hit' | 'confirmation_failed' | 'confirm' {
    // ✅ Всегда обновляем currentPrice самой свежей свечой для корректного отображения
    const latestCandle = candles.length > 0 ? candles[candles.length - 1] : null;
    this.applyPendingMetrics(pending, latestCandle);

    // ✅ Ищем свечи для подтверждения:
    // 1. Закрытые свечи ПОСЛЕ обнаружения (timestamp > detectedAt)
    // 2. Текущая незакрытая свеча (последняя), если сигнал обнаружен на ней
    const candleDuration = TIMEFRAME_DURATIONS[pending.timeframe] || 3600000; // default 1h
    
    const candlesAfterDetection = candles.filter((candle, index) => {
      // Закрытая свеча после обнаружения
      if (candle.timestamp > pending.detectedAt) return true;
      
      // Последняя свеча (незакрытая), если сигнал обнаружен на ней
      const isLastCandle = index === candles.length - 1;
      const candleContainsDetection = candle.timestamp <= pending.detectedAt && pending.detectedAt < candle.timestamp + candleDuration;
      if (isLastCandle && candleContainsDetection) {
        return true;
      }
      
      return false;
    });
    
    SERVICE_LOG.debug('Evaluating pending signal', {
      signalId: pending.id,
      pair: pending.pairSymbol,
      timeframe: pending.timeframe,
      direction: pending.direction,
      detectedAt: pending.detectedAt,
      detectedAtDate: new Date(pending.detectedAt).toISOString(),
      totalCandles: candles.length,
      lastCandleTimestamp: latestCandle?.timestamp ?? null,
      lastCandleDate: latestCandle ? new Date(latestCandle.timestamp).toISOString() : null,
      lastCandleClose: latestCandle?.close ?? null,
      currentPrice: pending.currentPrice,
      candlesAfterDetection: candlesAfterDetection.length,
      confirmationAttempts: pending.confirmationAttempts,
    });

    if (!candlesAfterDetection.length) {
      SERVICE_LOG.debug('No candles after detection, waiting', {
        signalId: pending.id,
        pair: pending.pairSymbol,
      });
      return 'waiting';
    }

    if (this.isStopLossHit(pending, candlesAfterDetection)) {
      SERVICE_LOG.info('Stop loss hit during confirmation', {
        signalId: pending.id,
        pair: pending.pairSymbol,
        stopLoss: pending.stopLoss,
      });
      return 'stop_loss_hit';
    }

    const latestConfirmationCandle = candlesAfterDetection[candlesAfterDetection.length - 1];
    const confirmationOk = this.directionSatisfied(pending, latestConfirmationCandle);
    
    SERVICE_LOG.debug('Direction check result', {
      signalId: pending.id,
      pair: pending.pairSymbol,
      direction: pending.direction,
      entryPrice: pending.entryPrice,
      confirmationTargetPrice: pending.confirmationTargetPrice,
      currentPrice: pending.currentPrice,
      latestConfirmationCandleHigh: latestConfirmationCandle.high,
      latestConfirmationCandleLow: latestConfirmationCandle.low,
      latestConfirmationCandleClose: latestConfirmationCandle.close,
      confirmationOk,
    });

    if (confirmationOk) {
      SERVICE_LOG.info('Signal confirmed!', {
        signalId: pending.id,
        pair: pending.pairSymbol,
        direction: pending.direction,
      });
      return 'confirm';
    }

    const requiredWindow = pending.confirmWindowSize
      ?? this.getConfirmWindowSize(pending.timeframe);
    
    if (candlesAfterDetection.length < requiredWindow) {
      SERVICE_LOG.debug('Not enough candles for confirmation window, waiting', {
        signalId: pending.id,
        pair: pending.pairSymbol,
        candlesAfterDetection: candlesAfterDetection.length,
        requiredWindow,
      });
      return 'waiting';
    }

    SERVICE_LOG.info('Confirmation failed - target not reached within window', {
      signalId: pending.id,
      pair: pending.pairSymbol,
      candlesAfterDetection: candlesAfterDetection.length,
      requiredWindow,
      confirmationTargetPrice: pending.confirmationTargetPrice,
    });
    return 'confirmation_failed';
  }

  private async confirmPendingSignal(pending: PendingSignal): Promise<void> {
    const confirmedSignal: ConfirmedSignal = {
      ...pending,
      confirmedAt: Date.now(),
      riskScore: pending.riskScore ?? this.riskScoreThreshold,
      recommendedOrderType: 'market',
      recommendedSize: pending.recommendedSize ?? 0,
    };

    await this.signalPublisher.publishConfirmed(confirmedSignal);
    await signalQueue.markAsConfirmed(pending.id!, confirmedSignal.riskScore);
    await confirmationQueueManager.cancelConfirmation(pending.id!);
    await this.riskGateway.registerExecution(confirmedSignal);
    await this.executionManager.recordExecution(confirmedSignal);
    await this.executionAdapter.execute(confirmedSignal);
    await sharedExecutionManager.recordExecution(confirmedSignal);
    this.untrackPending(pending);
  }

  private async cancelPendingSignal(pending: PendingSignal, reason: string): Promise<void> {
    await this.signalPublisher.publishCancelled(pending.id!, reason);
    await signalQueue.markAsCancelled(pending.id!, reason);
    await confirmationQueueManager.cancelConfirmation(pending.id!);
    await this.portfolioAllocator.releaseAllocation(pending.id!, reason);
    if (['refresh_limit_reached', 'opposite_signal', 'confirmation_timeout', 'duplicate_pending'].includes(reason)) {
      this.unregisterSignalFromDedup(pending);
    }
    SERVICE_LOG.info('Pending signal cancelled', {
      signalId: pending.id,
      reason,
      correlationId: pending.correlationId,
    });
    this.untrackPending(pending);
  }

  private isStopLossHit(pending: PendingSignal, candles: CandleData[]): boolean {
    if (!pending.stopLoss) return false;
    for (const candle of candles) {
      if (pending.direction === 'long' && candle.low <= pending.stopLoss) return true;
      if (pending.direction === 'short' && candle.high >= pending.stopLoss) return true;
    }
    return false;
  }

  private directionSatisfied(pending: PendingSignal, latestCandle: CandleData): boolean {
    const target = pending.confirmationTargetPrice ?? this.calculateConfirmationTarget(pending.direction, pending.entryPrice);
    const high = typeof latestCandle.high === 'number' ? latestCandle.high : latestCandle.close;
    const low = typeof latestCandle.low === 'number' ? latestCandle.low : latestCandle.close;

    if (pending.direction === 'long') {
      return high >= target;
    }
    return low <= target;
  }

  private getConfirmWindowSize(timeframe?: string): number {
    if (!timeframe) {
      return this.confirmWindowSize;
    }

    const settings = ScannerService.TIMEFRAME_SETTINGS[timeframe];
    if (settings?.confirmWindowSize) {
      return settings.confirmWindowSize;
    }

    if (timeframe.endsWith('h') || timeframe.endsWith('d') || timeframe.endsWith('w')) {
      return Math.max(1, Math.round(this.confirmWindowSize / 2));
    }

    return this.confirmWindowSize;
  }

  private getMaxConfirmationAttempts(timeframe?: string): number {
    if (!timeframe) {
      return 3;
    }

    const settings = ScannerService.TIMEFRAME_SETTINGS[timeframe];
    if (settings) {
      return settings.maxAttempts;
    }

    if (timeframe.endsWith('h') || timeframe.endsWith('d') || timeframe.endsWith('w')) {
      return 4;
    }

    return 3;
  }

  private calculateConfirmationDelay(timeframe?: string): number {
    const base = Math.max(this.confirmWindowSize * this.currentConfig.refreshIntervalMs, 1000);
    if (!timeframe) {
      return base;
    }

    const settings = ScannerService.TIMEFRAME_SETTINGS[timeframe];
    if (settings) {
      return settings.confirmationDelayMs;
    }

    if (timeframe.endsWith('h') || timeframe.endsWith('d') || timeframe.endsWith('w')) {
      const multiplier = timeframe.endsWith('h') ? 4 : timeframe.endsWith('d') ? 6 : 8;
      return base * multiplier;
    }

    return base;
  }

  private calculateConfirmationTarget(direction: SignalDirection, entryPrice: number): number {
    // ✅ Подтверждение при движении цены на 0.05% от точки входа в нужном направлении
    // Это гарантирует реальное движение, а не просто касание уровня
    const confirmationThreshold = 0.0005; // 0.05%
    
    if (direction === 'long') {
      // Для LONG: цена должна подняться выше entry
      return entryPrice * (1 + confirmationThreshold);
    } else {
      // Для SHORT: цена должна упасть ниже entry
      return entryPrice * (1 - confirmationThreshold);
    }
  }

  private applyPendingMetrics(pending: PendingSignal, latestCandle: CandleData | null | undefined, confirmationDelayMs?: number): void {
    if (latestCandle) {
      pending.lastCandleTimestamp = latestCandle.timestamp;
      pending.lastCandlePrice = latestCandle.close;
    }

    const now = Date.now();
    const entryPrice = Number(pending.entryPrice) || 0;
    const priceSource = latestCandle?.close ?? pending.lastCandlePrice ?? entryPrice;
    const previousPrice = pending.currentPrice;
    pending.currentPrice = priceSource;

    if (previousPrice !== priceSource && latestCandle) {
      SERVICE_LOG.debug('Updated current price for pending signal', {
        signalId: pending.id,
        pair: pending.pairSymbol,
        previousPrice,
        newPrice: priceSource,
        candleTimestamp: latestCandle.timestamp,
        candleClose: latestCandle.close,
      });
    }

    if (entryPrice !== 0 && Number.isFinite(priceSource)) {
      const delta = priceSource - entryPrice;
      pending.priceDelta = delta;
      pending.priceDeltaPct = (delta / entryPrice) * 100;
    } else {
      pending.priceDelta = pending.priceDelta ?? 0;
      pending.priceDeltaPct = pending.priceDeltaPct ?? 0;
    }

    const confirmationDelay = confirmationDelayMs ?? this.calculateConfirmationDelay(pending.timeframe);
    if (Number.isFinite(confirmationDelay) && confirmationDelay > 0) {
      const expiresAt = pending.confirmationExpiresAt ?? (pending.detectedAt + confirmationDelay);
      pending.confirmationExpiresAt = expiresAt;
    }

    pending.timeElapsedMs = Math.max(now - pending.detectedAt, 0);
    if (typeof pending.confirmationExpiresAt === 'number') {
      pending.timeToConfirmMs = Math.max(pending.confirmationExpiresAt - now, 0);
    } else {
      pending.timeToConfirmMs = Math.max((pending.detectedAt + confirmationDelay) - now, 0);
    }

    if (!pending.confirmationTargetPrice) {
      pending.confirmationTargetPrice = this.calculateConfirmationTarget(pending.direction, entryPrice);
    }
  }

  private clearTrackingCaches(): void {
    this.recentSignalTracker.clear();
    this.pendingTracker.clear();
  }

  private async refreshPendingSignal(existing: PendingSignal, signal: SignalMetadata, candles: CandleData[]): Promise<void> {
    if (!existing.id) {
      SERVICE_LOG.warn('Attempted to refresh pending signal without id', {
        pair: signal.pairSymbol,
        timeframe: signal.timeframe,
        direction: signal.direction,
      });
      return;
    }

    const key = this.buildDedupKey(existing);
    const record = this.pendingTracker.get(key);
    if (record && record.count >= (record.maxRefreshes ?? this.calculateMaxRefreshes(existing.timeframe))) {
      SERVICE_LOG.info('Refresh limit reached for pending signal, cancelling', {
        pair: existing.pairSymbol,
        timeframe: existing.timeframe,
        direction: existing.direction,
        signalId: existing.id,
        refreshCount: record.count,
        maxRefreshes: record.maxRefreshes,
      });
      await this.cancelPendingSignal(existing, 'refresh_limit_reached');
      return;
    }

    const signalId = existing.id;
    const riskScore = await this.riskGateway.computeRiskScore(signal);
    const confirmationTarget = this.calculateConfirmationTarget(signal.direction, signal.entryPrice);

    const confirmDelay = this.calculateConfirmationDelay(signal.timeframe);

    const nowTimestamp = Date.now();

    const refreshed: PendingSignal = {
      ...existing,
      strength: signal.strength,
      additionalData: signal.additionalData ?? existing.additionalData,
      strategyId: signal.strategyId ?? existing.strategyId,
      lastUpdatedAt: nowTimestamp,
      status: 'waiting',
      riskScore,
      confirmationAttempts: existing.confirmationAttempts ?? 0,
      maxConfirmationAttempts: this.getMaxConfirmationAttempts(signal.timeframe),
      confirmWindowSize: this.getConfirmWindowSize(signal.timeframe),
      confirmationTargetPrice: confirmationTarget,
      stopLoss: signal.stopLoss ?? existing.stopLoss,
      takeProfit: signal.takeProfit ?? existing.takeProfit,
      lastCandleTimestamp: signal.lastCandleTimestamp ?? existing.lastCandleTimestamp,
      lastCandlePrice: signal.lastCandlePrice ?? existing.lastCandlePrice,
      recommendedSize: existing.recommendedSize,
      entryPrice: existing.entryPrice ?? signal.entryPrice,
    };

    const latestCandle = candles[candles.length - 1] ?? null;
    this.applyPendingMetrics(refreshed, latestCandle, confirmDelay);

    // ✅ НЕ отменяем таймер подтверждения при refresh - пусть он продолжает работать!
    // Только обновляем данные сигнала в очереди
    await signalQueue.enqueue(refreshed);
    // ✅ Broadcast обновленных метрик на фронтенд
    await this.signalPublisher.publishUpdated?.(refreshed);
    this.registerSignalForDedup(signal);
    this.trackPending(refreshed);

    SERVICE_LOG.debug('Refreshed pending signal with latest data', {
      pair: signal.pairSymbol,
      timeframe: signal.timeframe,
      direction: signal.direction,
      signalId,
      currentPrice: refreshed.currentPrice,
      priceDelta: refreshed.priceDelta,
    });
  }
}

export default ScannerService;

