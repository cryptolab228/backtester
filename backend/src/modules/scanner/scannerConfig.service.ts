import { EventEmitter } from 'events';
import Redis from 'ioredis';

import config from '@/config';
import { connection } from '@/config/queue';

import { RuntimeScannerConfig } from './scanner.types';

const STORAGE_KEY = 'scanner:runtime-config';

const DEFAULT_CONFIG: RuntimeScannerConfig = {
  enabled: config.scanner.enabled,
  executionMode: config.scanner.executionMode,
  pairs: config.scanner.pairs.map((pair) => ({
    symbol: pair.symbol,
    timeframes: pair.timeframes,
    exchange: pair.exchange ?? 'bybit',
  })),
  defaultTimeframes: config.scanner.defaultTimeframes,
  refreshIntervalMs: config.scanner.refreshIntervalMs,
  confirmWindowSize: config.scanner.confirmWindowSize,
  riskScoreThreshold: config.scanner.riskScoreThreshold,
  maxConcurrentTrades: config.scanner.maxConcurrentTrades ?? 5,
  basePositionSize: config.scanner.basePositionSize ?? 1,
  initialCapital: config.scanner.initialCapital ?? 10_000,
  defaultLeverage: config.scanner.defaultLeverage ?? 10,
  tradingFeeRate: config.scanner.tradingFeeRate ?? 0.0006,
  fundingRateBuffer: config.scanner.fundingRateBuffer ?? 0.00025,
  riskPerTrade: config.scanner.riskPerTrade ?? 0.02,
  stopLossMultiplier: config.scanner.stopLossMultiplier ?? 3,
  takeProfitMultiplier: config.scanner.takeProfitMultiplier ?? 5,
  engines: [{ id: 'basic-strategy-engine', enabled: true }],
};

export class ScannerConfigService extends EventEmitter {
  private readonly redis: Redis;
  private config: RuntimeScannerConfig = DEFAULT_CONFIG;
  private initialized = false;

  constructor(redis?: Redis) {
    super();
    this.redis = redis || connection.duplicate();
  }

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (!this.redis.status || this.redis.status === 'end') {
      await this.redis.connect();
    }

    try {
      const raw = await this.redis.get(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        this.config = this.validate({ ...DEFAULT_CONFIG, ...parsed });
      } else {
        this.config = DEFAULT_CONFIG;
      }
    } catch (error) {
      this.config = DEFAULT_CONFIG;
    }

    this.initialized = true;
  }

  getConfig(): RuntimeScannerConfig {
    return {
      ...this.config,
      pairs: this.config.pairs.map((pair) => ({ ...pair, timeframes: [...pair.timeframes], exchange: pair.exchange ?? 'bybit' })),
      engines: this.config.engines.map((engine) => ({ id: engine.id, enabled: engine.enabled, options: engine.options ? { ...engine.options } : undefined })),
      riskPerTrade: this.config.riskPerTrade,
      stopLossMultiplier: this.config.stopLossMultiplier,
      takeProfitMultiplier: this.config.takeProfitMultiplier,
    };
  }

  async updateConfig(partial: Partial<RuntimeScannerConfig>): Promise<RuntimeScannerConfig> {
    await this.init();

    const merged = this.validate({ ...this.config, ...partial });
    this.config = merged;

    await this.redis.set(STORAGE_KEY, JSON.stringify(merged));
    this.emit('update', this.getConfig());
    return this.getConfig();
  }

  async applyRecommendedDefaults(): Promise<RuntimeScannerConfig> {
    await this.init();
    const recommended = this.validate({
      ...DEFAULT_CONFIG,
      enabled: this.config.enabled,
    });
    this.config = recommended;
    await this.redis.set(STORAGE_KEY, JSON.stringify(recommended));
    this.emit('update', this.getConfig());
    return this.getConfig();
  }

  subscribe(listener: (config: RuntimeScannerConfig) => void): () => void {
    const wrapped = (config: RuntimeScannerConfig) => listener(config);
    this.on('update', wrapped);
    return () => this.off('update', wrapped);
  }

  private validate(configToValidate: RuntimeScannerConfig): RuntimeScannerConfig {
    const sanitized: RuntimeScannerConfig = {
      enabled: typeof configToValidate.enabled === 'boolean' ? configToValidate.enabled : DEFAULT_CONFIG.enabled,
      executionMode: this.validateExecutionMode(configToValidate.executionMode),
      pairs: Array.isArray(configToValidate.pairs)
        ? configToValidate.pairs
            .filter((pair) => pair && typeof pair.symbol === 'string')
            .map((pair) => ({
              symbol: pair.symbol.trim().toUpperCase(),
              timeframes: Array.isArray(pair.timeframes) && pair.timeframes.length > 0
                ? Array.from(new Set(pair.timeframes.map((tf) => tf.trim())))
                : [...DEFAULT_CONFIG.defaultTimeframes],
              exchange: pair.exchange === 'okx' ? 'okx' : 'bybit',
            }))
        : [...DEFAULT_CONFIG.pairs],
      defaultTimeframes: Array.isArray(configToValidate.defaultTimeframes) && configToValidate.defaultTimeframes.length > 0
        ? Array.from(new Set(configToValidate.defaultTimeframes.map((tf) => tf.trim())))
        : [...DEFAULT_CONFIG.defaultTimeframes],
      refreshIntervalMs: this.ensurePositiveNumber(configToValidate.refreshIntervalMs, DEFAULT_CONFIG.refreshIntervalMs),
      confirmWindowSize: Math.max(1, Math.round(configToValidate.confirmWindowSize || DEFAULT_CONFIG.confirmWindowSize)),
      riskScoreThreshold: this.clamp(configToValidate.riskScoreThreshold, 0.01, 1),
      maxConcurrentTrades: Math.max(1, Math.round(configToValidate.maxConcurrentTrades || DEFAULT_CONFIG.maxConcurrentTrades)),
      basePositionSize: this.ensurePositiveNumber(configToValidate.basePositionSize, DEFAULT_CONFIG.basePositionSize),
      initialCapital: this.ensurePositiveNumber(configToValidate.initialCapital, DEFAULT_CONFIG.initialCapital),
      defaultLeverage: this.ensurePositiveNumber(configToValidate.defaultLeverage, DEFAULT_CONFIG.defaultLeverage),
      tradingFeeRate: this.ensurePositiveNumber(configToValidate.tradingFeeRate, DEFAULT_CONFIG.tradingFeeRate),
      fundingRateBuffer: this.ensurePositiveNumber(configToValidate.fundingRateBuffer, DEFAULT_CONFIG.fundingRateBuffer),
      riskPerTrade: this.clamp(configToValidate.riskPerTrade, 0.0001, 1),
      stopLossMultiplier: this.ensurePositiveNumber(configToValidate.stopLossMultiplier, DEFAULT_CONFIG.stopLossMultiplier),
      takeProfitMultiplier: this.ensurePositiveNumber(configToValidate.takeProfitMultiplier, DEFAULT_CONFIG.takeProfitMultiplier),
      engines: Array.isArray(configToValidate.engines) && configToValidate.engines.length > 0
        ? configToValidate.engines
            .filter((engine) => engine && typeof engine.id === 'string')
            .map((engine) => ({
              id: engine.id,
              enabled: engine.enabled !== false,
              options: engine.options,
            }))
        : [...DEFAULT_CONFIG.engines],
    };

    if (sanitized.pairs.length === 0) {
      sanitized.pairs = [...DEFAULT_CONFIG.pairs];
    }

    return sanitized;
  }

  private ensurePositiveNumber(value: number | undefined, fallback: number): number {
    if (typeof value !== 'number' || Number.isNaN(value) || value <= 0) {
      return fallback;
    }
    return value;
  }

  private clamp(value: number | undefined, min: number, max: number): number {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return min;
    }
    return Math.min(max, Math.max(min, value));
  }

  private validateExecutionMode(mode: string | undefined): RuntimeScannerConfig['executionMode'] {
    const allowed: RuntimeScannerConfig['executionMode'][] = ['dry-run', 'paper', 'shadow', 'testnet', 'demo', 'live'];
    if (mode && allowed.includes(mode as any)) {
      return mode as RuntimeScannerConfig['executionMode'];
    }
    return DEFAULT_CONFIG.executionMode;
  }
}

const scannerConfigService = new ScannerConfigService();

export default scannerConfigService;

