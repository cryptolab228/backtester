import { performance } from 'perf_hooks';

import logger from '@/utils/logger';

import { ExchangeName, SignalContext } from './scanner.types';

const HEALTH_LOG = logger.child({ module: 'ScannerHealthMonitor' });

export interface CycleRecord {
  contextKey: string;
  pairSymbol: string;
  timeframe: string;
  exchange?: ExchangeName;
  lastSuccessAt: number;
  lastDurationMs: number;
  avgDurationMs: number;
  candlesProcessed: number;
  consecutiveFailures: number;
  lastError?: string;
  lastErrorAt?: number;
  lastCycleId?: string;
}

export interface HealthSnapshot {
  startedAt: number;
  contexts: CycleRecord[];
  totalCycles: number;
  totalErrors: number;
}

class ScannerHealthMonitor {
  private readonly records = new Map<string, CycleRecord>();
  private startedAt = performance.timeOrigin || Date.now();
  private totalCycles = 0;
  private totalErrors = 0;

  buildKey(context: SignalContext): string {
    return `${context.exchange || 'bybit'}::${context.pairSymbol}::${context.timeframe}`;
  }

  recordSuccessfulCycle(context: SignalContext, candlesProcessed: number, durationMs: number, cycleId: string): void {
    const key = this.buildKey(context);
    const existing = this.records.get(key);
    const record: CycleRecord = {
      contextKey: key,
      pairSymbol: context.pairSymbol,
      timeframe: context.timeframe,
      exchange: context.exchange,
      lastSuccessAt: Date.now(),
      lastDurationMs: durationMs,
      avgDurationMs: existing
        ? existing.avgDurationMs * 0.8 + durationMs * 0.2
        : durationMs,
      candlesProcessed,
      consecutiveFailures: 0,
      lastError: existing?.lastError,
      lastErrorAt: existing?.lastErrorAt,
      lastCycleId: cycleId,
    };

    this.records.set(key, record);
    this.totalCycles += 1;
  }

  recordFailure(context: SignalContext, error: unknown, cycleId: string): void {
    const key = this.buildKey(context);
    const existing = this.records.get(key);
    const message = error instanceof Error ? error.message : String(error);
    const failures = (existing?.consecutiveFailures ?? 0) + 1;

    const record: CycleRecord = {
      contextKey: key,
      pairSymbol: context.pairSymbol,
      timeframe: context.timeframe,
      exchange: context.exchange,
      lastSuccessAt: existing?.lastSuccessAt ?? 0,
      lastDurationMs: existing?.lastDurationMs ?? 0,
      avgDurationMs: existing?.avgDurationMs ?? 0,
      candlesProcessed: existing?.candlesProcessed ?? 0,
      consecutiveFailures: failures,
      lastError: message,
      lastErrorAt: Date.now(),
      lastCycleId: cycleId,
    };

    this.records.set(key, record);
    this.totalErrors += 1;
    HEALTH_LOG.warn('Scanner cycle failure recorded', { key, failures, message, cycleId });
  }

  getSnapshot(): HealthSnapshot {
    return {
      startedAt: this.startedAt,
      contexts: Array.from(this.records.values()),
      totalCycles: this.totalCycles,
      totalErrors: this.totalErrors,
    };
  }

  getStaleContexts(staleThresholdMs: number): CycleRecord[] {
    const now = Date.now();
    return Array.from(this.records.values()).filter((record) => (now - record.lastSuccessAt) > staleThresholdMs);
  }

  reset(): void {
    this.records.clear();
    this.startedAt = Date.now();
    this.totalCycles = 0;
    this.totalErrors = 0;
  }
}

export const healthMonitor = new ScannerHealthMonitor();





