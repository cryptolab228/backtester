import Redis from 'ioredis';

import { connection } from '@/config/queue';
import logger from '@/utils/logger';

import scannerConfigService from './scannerConfig.service';
import { AllocationDecision, PendingSignal, PortfolioAllocator, PortfolioState } from './scanner.types';
import { BybitTradingClient } from '@/services/bybitTradingClient';
import config from '@/config';

const ALLOCATOR_LOG = logger.child({ module: 'PortfolioAllocator' });

const STATE_KEY_PREFIX = 'scanner:portfolio:state';

type ActivePosition = PortfolioState['active'][number] & { capitalLocked: number };

interface InternalState {
  capital: number;
  maxConcurrentTrades: number;
  basePositionSize: number;
  riskPerTrade: number;
  active: ActivePosition[];
  updatedAt: number;
}

const DEFAULT_STATE: InternalState = {
  maxConcurrentTrades: config.scanner.maxConcurrentTrades ?? 5,
  basePositionSize: config.scanner.basePositionSize ?? 1,
  capital: config.scanner.initialCapital ?? 10_000,
  riskPerTrade: config.scanner.riskPerTrade ?? 0.03,
  active: [],
  updatedAt: Date.now(),
};

export class RedisPortfolioAllocator implements PortfolioAllocator {
  private readonly redis: Redis;
  private readonly testnetClient?: BybitTradingClient;
  private readonly demoClient?: BybitTradingClient;
  private sessionId: string | null = null;

  constructor(redis?: Redis) {
    this.redis = redis || connection.duplicate();

    const { apiKey: testnetKey, apiSecret: testnetSecret, apiUrl: testnetUrl, accountType: testnetAccount } = config.bybitTestnet;
    if (testnetKey && testnetSecret) {
      this.testnetClient = new BybitTradingClient({
        apiKey: testnetKey,
        apiSecret: testnetSecret,
        apiUrl: testnetUrl,
        accountType: testnetAccount as any,
      });
    }

    const { apiKey: demoKey, apiSecret: demoSecret, apiUrl: demoUrl, accountType: demoAccount } = config.bybitDemo || {};
    if (demoKey && demoSecret) {
      this.demoClient = new BybitTradingClient({
        apiKey: demoKey,
        apiSecret: demoSecret,
        apiUrl: demoUrl,
        accountType: demoAccount as any,
      });
    }
  }

  /**
   * Установить текущую сессию для изоляции состояния портфолио
   */
  setSession(sessionId: string | null): void {
    this.sessionId = sessionId;
    ALLOCATOR_LOG.info('Portfolio allocator session set', { sessionId });
  }

  /**
   * Получить ключ состояния для текущей сессии
   */
  private getStateKey(): string {
    return this.sessionId ? `${STATE_KEY_PREFIX}:${this.sessionId}` : STATE_KEY_PREFIX;
  }

  /**
   * Очистить состояние для текущей сессии
   */
  async clearSessionState(): Promise<void> {
    const key = this.getStateKey();
    await this.redis.del(key);
    ALLOCATOR_LOG.info('Cleared portfolio state for session', { sessionId: this.sessionId, key });
  }

  private async init(): Promise<void> {
    if (!this.redis.status || this.redis.status === 'end') {
      await this.redis.connect();
    }

    const key = this.getStateKey();
    const exists = await this.redis.exists(key);
    if (!exists) {
      await this.redis.set(key, JSON.stringify(DEFAULT_STATE));
      ALLOCATOR_LOG.info('Initialized portfolio state', { sessionId: this.sessionId, key });
    }
  }

  async requestAllocation(signal: PendingSignal): Promise<AllocationDecision> {
    await this.init();
    const runtimeConfig = scannerConfigService.getConfig();
    const state = await this.getInternalState(runtimeConfig);

    const capitalBalance = await this.resolveAvailableCapital(runtimeConfig.executionMode, signal.pairSymbol);
    const riskPerTrade = this.resolveRiskPerTrade(runtimeConfig.riskPerTrade);

    const capitalForTrade = this.calculateCapitalForSignal(signal, state, riskPerTrade, capitalBalance);
    if (capitalForTrade <= 0 || capitalBalance < capitalForTrade) {
      ALLOCATOR_LOG.warn('Allocation denied: insufficient capital', {
        signalId: signal.id,
        capital: capitalBalance,
        required: capitalForTrade,
        correlationId: signal.correlationId,
      });
      return { approved: false, size: 0, reason: 'insufficient_capital' };
    }

    const recommendedSize = capitalForTrade / (signal.entryPrice || 1);

    const canAllocateSlot = state.active.length < state.maxConcurrentTrades;

    const updatedState: InternalState = {
      ...state,
      capital: Math.max(0, capitalBalance - capitalForTrade),
      active: canAllocateSlot
        ? [
            ...state.active,
            {
              id: signal.id || `${signal.pairSymbol}:${signal.detectedAt}`,
              pairSymbol: signal.pairSymbol,
              timeframe: signal.timeframe,
              exchange: signal.exchange,
              size: recommendedSize,
              timestamp: Date.now(),
              capitalLocked: capitalForTrade,
            },
          ]
        : state.active,
      updatedAt: Date.now(),
    };

    const key = this.getStateKey();
    await this.redis.set(key, JSON.stringify(updatedState));

    if (!canAllocateSlot) {
      ALLOCATOR_LOG.warn('Allocation skipped due to max concurrent trades', {
        signalId: signal.id,
        capitalBalance,
        capitalForTrade,
        activeCount: state.active.length,
        maxConcurrentTrades: state.maxConcurrentTrades,
      });
      return { approved: false, size: 0, reason: 'max_concurrent_reached' };
    }

    ALLOCATOR_LOG.info('Allocation approved', {
      signalId: signal.id,
      capitalForTrade,
      recommendedSize,
      capitalBalance,
      riskPerTrade,
    });

    return {
      approved: true,
      size: recommendedSize,
    };
  }

  async releaseAllocation(signalId: string, reason: string = 'released'): Promise<void> {
    await this.init();
    const runtimeConfig = scannerConfigService.getConfig();
    const state = await this.getInternalState(runtimeConfig);
    const entry = state.active.find((item) => item.id === signalId);
    if (!entry) {
      ALLOCATOR_LOG.debug('Release allocation skipped: not found', { signalId, reason });
      return;
    }

    const updatedState: InternalState = {
      ...state,
      capital: state.capital + entry.capitalLocked,
      active: state.active.filter((item) => item.id !== signalId),
      updatedAt: Date.now(),
    };

    ALLOCATOR_LOG.info('Allocation released', { signalId, reason, capitalUnlocked: entry.capitalLocked });

    const key = this.getStateKey();
    await this.redis.set(key, JSON.stringify(updatedState));
  }

  async resetState(): Promise<void> {
    await this.init();
    const key = this.getStateKey();
    await this.redis.del(key);
    ALLOCATOR_LOG.info('Portfolio state reset', { sessionId: this.sessionId });
  }

  async getState(): Promise<PortfolioState> {
    await this.init();
    const runtimeConfig = scannerConfigService.getConfig();
    const state = await this.getInternalState(runtimeConfig);
    const capital = await this.resolveAvailableCapital(runtimeConfig.executionMode);
    return {
      maxConcurrentTrades: state.maxConcurrentTrades,
      basePositionSize: state.basePositionSize,
      availableCapital: capital,
      active: state.active.map(({ capitalLocked, ...rest }) => rest),
    };
  }

  async syncWithTrades(trades: Array<{ id: string; pair: string; timeframe?: string | null; entryPrice?: number | null; positionSize?: number | null; exchange?: string | null }>): Promise<void> {
    await this.init();
    const runtimeConfig = scannerConfigService.getConfig();
    const state = await this.getInternalState(runtimeConfig);

    const parseNumeric = (value: number | string | null | undefined): number => {
      if (typeof value === 'number') {
        return Number.isFinite(value) ? value : 0;
      }
      if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
      }
      return 0;
    };

    const normalizedActive: ActivePosition[] = [];
    for (const trade of trades || []) {
      const size = parseNumeric(trade.positionSize);
      const entryPrice = parseNumeric(trade.entryPrice);
      if (size <= 0 || entryPrice <= 0) {
        continue;
      }

      const capitalLocked = size * entryPrice;
      const exchange = (trade.exchange || 'bybit') as ActivePosition['exchange'];

      normalizedActive.push({
        id: trade.id,
        pairSymbol: trade.pair,
        timeframe: trade.timeframe || '1h',
        exchange,
        size,
        capitalLocked,
        timestamp: Date.now(),
      });
    }

    const usedCapital = normalizedActive.reduce((sum, item) => sum + item.capitalLocked, 0);
    const availableBalance = await this.resolveAvailableCapital(runtimeConfig.executionMode);

    const updatedState: InternalState = {
      ...state,
      active: normalizedActive,
      capital: Math.max(0, availableBalance - usedCapital),
      updatedAt: Date.now(),
    };

    const key = this.getStateKey();
    await this.redis.set(key, JSON.stringify(updatedState));

    ALLOCATOR_LOG.info('Portfolio allocator state synced with trades', {
      sessionId: this.sessionId,
      activeCount: normalizedActive.length,
      capitalRemaining: updatedState.capital,
    });
  }

  private async getInternalState(configOverride?: { maxConcurrentTrades: number; basePositionSize: number; initialCapital: number; riskPerTrade?: number }): Promise<InternalState> {
    await this.init();
    const key = this.getStateKey();
    const raw = await this.redis.get(key);
    let parsed: InternalState;
    try {
      parsed = raw ? JSON.parse(raw) : { ...DEFAULT_STATE };
    } catch (error) {
      ALLOCATOR_LOG.error('Failed to parse portfolio state. Resetting to default.', { error });
      parsed = { ...DEFAULT_STATE };
    }
    parsed = this.mergeWithRuntimeConfig(parsed, configOverride);
    return parsed;
  }

  private mergeWithRuntimeConfig(state: InternalState, configOverride?: { maxConcurrentTrades: number; basePositionSize: number; initialCapital: number; riskPerTrade?: number }): InternalState {
    if (!configOverride) {
      return state;
    }

    return {
      ...state,
      maxConcurrentTrades: configOverride.maxConcurrentTrades,
      basePositionSize: configOverride.basePositionSize,
      riskPerTrade: typeof configOverride.riskPerTrade === 'number' ? configOverride.riskPerTrade : state.riskPerTrade,
      capital: this.resolveFallbackCapital(configOverride.initialCapital),
    };
  }

  private resolveRiskPerTrade(value: number | undefined): number {
    if (typeof value === 'number' && value > 0 && value <= 1) {
      return value;
    }
    return 0.02;
  }

  private resolveFallbackCapital(initialCapital: number): number {
    if (typeof initialCapital === 'number' && Number.isFinite(initialCapital) && initialCapital > 0) {
      return initialCapital;
    }
    return DEFAULT_STATE.capital;
  }

  private async resolveAvailableCapital(mode?: typeof config.scanner.executionMode, pairSymbol?: string): Promise<number> {
    const client = mode === 'demo'
      ? this.demoClient
      : mode === 'testnet'
        ? this.testnetClient
        : undefined;

    if (!client) {
      return DEFAULT_STATE.capital;
    }

    try {
      const account = await client.getAccountBalance();
      if (!account) {
        return DEFAULT_STATE.capital;
      }

      if (pairSymbol && account.coins) {
        const quote = this.resolveQuoteCurrency(pairSymbol);
        const coinInfo = quote ? account.coins[quote] : undefined;
        if (coinInfo && coinInfo.available > 0) {
          const precision = quote ? this.resolveCoinPrecision(quote) : 2;
          return this.roundToPrecision(coinInfo.available, precision);
        }
      }

      const walletBalance = account.walletBalance ?? DEFAULT_STATE.capital;
      const availableBalanceCandidate = account.availableBalance ?? walletBalance;
      if (Number.isFinite(availableBalanceCandidate) && availableBalanceCandidate > 0) {
        return availableBalanceCandidate;
      }
      return Number.isFinite(walletBalance) ? walletBalance : DEFAULT_STATE.capital;
    } catch (error: any) {
      ALLOCATOR_LOG.error('Failed to load account balance from Bybit', { error: error?.message || error });
      return DEFAULT_STATE.capital;
    }
  }

  private resolveQuoteCurrency(pairSymbol: string | undefined): string | undefined {
    if (!pairSymbol) {
      return undefined;
    }

    const upper = pairSymbol.toUpperCase();
    if (upper.endsWith('USDT')) {
      return 'USDT';
    }
    if (upper.endsWith('USDC')) {
      return 'USDC';
    }
    if (upper.endsWith('USD')) {
      return 'USD';
    }
    return undefined;
  }

  private resolveCoinPrecision(symbol: string): number {
    switch (symbol) {
      case 'USDT':
      case 'USDC':
      case 'USD':
        return 2;
      default:
        return 4;
    }
  }

  private roundToPrecision(value: number, precision: number): number {
    const factor = 10 ** precision;
    return Math.floor(value * factor) / factor;
  }

  private calculateCapitalForSignal(signal: PendingSignal, state: InternalState, riskPerTrade: number, accountBalance: number): number {
    const entryPrice = signal.entryPrice || 0;
    const baseCapital = state.basePositionSize > 0
      ? state.basePositionSize * (entryPrice || 1)
      : accountBalance * 0.01;

    const riskCapital = accountBalance * Math.min(riskPerTrade, 1);

    // Фьючерс торгуем в долларах: берём долю капитала, не пытаясь подгонять под стоп-лосс.
    // Минимум – базовый капитал, максимум – доступный баланс.
    const desiredCapital = Math.max(baseCapital, riskCapital);
    return Math.min(accountBalance, desiredCapital);
  }
}

const portfolioAllocator = new RedisPortfolioAllocator();

export default portfolioAllocator;
