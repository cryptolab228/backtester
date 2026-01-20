import { performance } from 'perf_hooks';

import logger from '@/utils/logger';

import { CandleData } from '@/interfaces/marketData.interface';

import {
  SignalContext,
  SignalEngine,
  SignalEngineConfig,
  SignalEngineManagerContract,
  SignalEngineRuntimeMetrics,
  SignalMetadata,
} from './scanner.types';

const ENGINE_LOG = logger.child({ module: 'SignalEngineManager' });

interface EngineEntry {
  engine: SignalEngine;
  config: SignalEngineConfig;
  metrics: SignalEngineRuntimeMetrics;
}

type EngineFactory = (config: SignalEngineConfig) => SignalEngine;

export class SignalEngineManager implements SignalEngineManagerContract {
  private readonly engineFactories = new Map<string, EngineFactory>();
  private readonly engines = new Map<string, EngineEntry>();

  constructor() {
    this.registerDefaultFactories();
  }

  private registerDefaultFactories(): void {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { BasicSignalEngine } = require('./engines/basicSignalEngine');
    this.engineFactories.set('basic-strategy-engine', () => new BasicSignalEngine());
  }

  registerFactory(engineId: string, factory: EngineFactory): void {
    this.engineFactories.set(engineId, factory);
  }

  async sync(configs: SignalEngineConfig[]): Promise<void> {
    const desiredIds = new Set(configs.map((config) => config.id));

    // Remove engines that are no longer needed
    for (const [engineId] of this.engines) {
      if (!desiredIds.has(engineId)) {
        this.engines.delete(engineId);
        ENGINE_LOG.info('Removed signal engine', { engineId });
      }
    }

    // Add or update engines
    for (const config of configs) {
      const existing = this.engines.get(config.id);
      if (existing) {
        existing.config = config;
        ENGINE_LOG.info('Updated signal engine config', { engineId: config.id, enabled: config.enabled });
        continue;
      }

      const factory = this.engineFactories.get(config.id);
      if (!factory) {
        ENGINE_LOG.warn('No factory registered for signal engine', { engineId: config.id });
        continue;
      }

      try {
        const engine = factory(config);
        const entry: EngineEntry = {
          engine,
          config,
          metrics: {
            id: config.id,
            enabled: config.enabled,
            evaluations: 0,
            signalsEmitted: 0,
            errors: 0,
            lastDurationMs: 0,
            avgDurationMs: 0,
          },
        };
        this.engines.set(config.id, entry);
        ENGINE_LOG.info('Registered signal engine', { engineId: config.id, enabled: config.enabled });
      } catch (error) {
        ENGINE_LOG.error('Failed to instantiate signal engine', { engineId: config.id, error });
      }
    }
  }

  async evaluateAll(candles: CandleData[], context: SignalContext): Promise<SignalMetadata[]> {
    const results: SignalMetadata[] = [];

    for (const entry of this.engines.values()) {
      if (!entry.config.enabled) {
        continue;
      }

      const start = performance.now();

      try {
        const evaluation = await entry.engine.evaluate(candles, context);
        entry.metrics.evaluations += 1;

        if (!evaluation) {
          continue;
        }

        const emittedSignals = Array.isArray(evaluation) ? evaluation : [evaluation];
        emittedSignals.forEach((signal) => {
          results.push({ ...signal, strategyId: signal.strategyId || entry.config.id });
        });
        entry.metrics.signalsEmitted += emittedSignals.length;
      } catch (error: any) {
        entry.metrics.errors += 1;
        entry.metrics.lastError = error?.message || String(error);
        ENGINE_LOG.error('Signal engine evaluation failed', {
          engineId: entry.config.id,
          pair: context.pairSymbol,
          timeframe: context.timeframe,
          error,
        });
      } finally {
        const duration = performance.now() - start;
        entry.metrics.lastDurationMs = duration;
        entry.metrics.avgDurationMs =
          entry.metrics.avgDurationMs === 0
            ? duration
            : entry.metrics.avgDurationMs * 0.8 + duration * 0.2;
        entry.metrics.enabled = entry.config.enabled;
        entry.metrics.lastUpdatedAt = Date.now();
      }
    }

    return results;
  }

  getMetrics(): SignalEngineRuntimeMetrics[] {
    return Array.from(this.engines.values()).map((entry) => ({ ...entry.metrics }));
  }

  getActiveEngineIds(): string[] {
    return Array.from(this.engines.values())
      .filter((entry) => entry.config.enabled)
      .map((entry) => entry.config.id);
  }
}

export const signalEngineManager = new SignalEngineManager();





