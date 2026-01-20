import config from '@/config';
import { dataService } from '@/services/dataService';
import RedisSignalStore from '@/services/RedisSignalStore';
import { broadcast } from '@/websocket';
import logger from '@/utils/logger';
import { connection } from '@/config/queue';
import Redis from 'ioredis';
import { BybitTradingClient } from '@/services/bybitTradingClient';

import {
  ConfirmedSignal,
  ExecutionAdapter,
  ExecutionManager,
  ExecutionRecord,
  ExecutionLeg,
  ExecutionAggregationOptions,
  ExternalExecutionDetails,
  MarketDataSource,
  RiskGateway,
  SignalContext,
  SignalMetadata,
  SignalPublisher,
  PendingSignal,
} from './scanner.types';
import { sessionManager } from './services/SessionManager';
import { CandleData } from '@/interfaces/marketData.interface';

const ADAPTER_LOG = logger.child({ module: 'ScannerAdapters' });

const normalizePendingSignalPayload = (signal: SignalMetadata | PendingSignal | ConfirmedSignal) => {
  const detectedAt = typeof signal.detectedAt === 'number' ? signal.detectedAt : Date.now();
  const now = Date.now();
  const pendingData = signal as PendingSignal;

  const rawTimeToConfirm = typeof pendingData.timeToConfirmMs === 'number'
    ? pendingData.timeToConfirmMs
    : undefined;

  const confirmationExpiresAt = typeof pendingData.confirmationExpiresAt === 'number'
    ? pendingData.confirmationExpiresAt
    : rawTimeToConfirm !== undefined
      ? detectedAt + rawTimeToConfirm
      : null;

  const timeElapsedMs = typeof pendingData.timeElapsedMs === 'number'
    ? pendingData.timeElapsedMs
    : Math.max(now - detectedAt, 0);

  const derivedTimeToConfirm = rawTimeToConfirm !== undefined
    ? rawTimeToConfirm
    : confirmationExpiresAt !== null
      ? Math.max(confirmationExpiresAt - now, 0)
      : null;

  return {
    ...signal,
    lastCandleTimestamp: pendingData.lastCandleTimestamp ?? null,
    lastCandlePrice: pendingData.lastCandlePrice ?? null,
    confirmationTargetPrice: pendingData.confirmationTargetPrice ?? null,
    currentPrice: pendingData.currentPrice ?? null,
    priceDelta: pendingData.priceDelta ?? null,
    priceDeltaPct: pendingData.priceDeltaPct ?? null,
    confirmationExpiresAt,
    timeElapsedMs,
    timeToConfirmMs: derivedTimeToConfirm,
  };
};

export class DataServiceMarketDataSource implements MarketDataSource {
  async getLatestCandles(pairSymbol: string, timeframe: string, limit: number) {
    const candles = await dataService.getCandles(pairSymbol, timeframe, undefined, undefined, 'bybit');
    if (!candles || candles.length === 0) {
      return [];
    }

    return candles.slice(-limit).map((candle: any) => ({
      timestamp: Number(candle.timestamp),
      open: Number(candle.open),
      high: Number(candle.high),
      low: Number(candle.low),
      close: Number(candle.close),
      volume: Number(candle.volume),
      volumeQuote: candle.volumeQuote ? Number(candle.volumeQuote) : undefined,
      timeframe,
      pair_id: candle.tradingPair?.id,
    }));
  }
}

export class WebSocketSignalPublisher implements SignalPublisher {
  async publishDetected(signal: SignalMetadata): Promise<void> {
    ADAPTER_LOG.debug('Publishing detected signal', { pair: signal.pairSymbol, timeframe: signal.timeframe });
    broadcast({ type: 'signal_detected', payload: normalizePendingSignalPayload(signal) });
  }

  async publishConfirmed(signal: ConfirmedSignal): Promise<void> {
    ADAPTER_LOG.info('Publishing confirmed signal', { pair: signal.pairSymbol, timeframe: signal.timeframe });
    const stored = await RedisSignalStore.storeConfirmed(signal);
    broadcast({ type: 'signal_confirmed', payload: normalizePendingSignalPayload(stored) });
  }

  async publishCancelled(signalId: string, reason: string): Promise<void> {
    ADAPTER_LOG.info('Publishing cancelled signal', { signalId, reason });
    broadcast({ type: 'signal_cancelled', payload: { signalId, reason } });
    const key = RedisSignalStore.buildSignalKeyFromIdentifier(signalId);
    await RedisSignalStore.cancelByKey(key, reason);
  }

  async publishUpdated(signal: PendingSignal): Promise<void> {
    ADAPTER_LOG.debug('Publishing updated pending signal', { 
      signalId: signal.id, 
      pair: signal.pairSymbol, 
      currentPrice: signal.currentPrice,
      priceDelta: signal.priceDelta 
    });
    broadcast({ type: 'signal_updated', payload: normalizePendingSignalPayload(signal) });
  }

  async publishStatus(config: any): Promise<void> {
    broadcast({ type: 'scanner_status_updated', payload: config });
  }
}

export class BasicRiskGateway implements RiskGateway {
  async shouldAllow(signal: SignalMetadata): Promise<boolean> {
    const cooldownActive = await RedisSignalStore.isCooldownActive(signal.pairSymbol);
    return !cooldownActive;
  }

  async computeRiskScore(signal: SignalMetadata): Promise<number> {
    return signal.strength;
  }

  async registerExecution(signal: ConfirmedSignal): Promise<void> {
    await RedisSignalStore.setCooldown(signal.pairSymbol, 60 * 15);
  }
}

interface ExecutionAdapterOptions {
  slippageBps?: number;
  feeBps?: number;
  fillDelayMs?: number;
  defaultLeverage?: number;
  mode?: ExecutionAdapter['mode'];
}

export class MultiModeExecutionAdapter implements ExecutionAdapter {
  readonly mode: ExecutionAdapter['mode'];
  private readonly options: ExecutionAdapterOptions;
  private readonly executionManager: ExecutionManager;
  private readonly testnetClient?: BybitTradingClient;
  private readonly demoClient?: BybitTradingClient;
  private readonly defaultLeverage: number;

  constructor(executionManager: ExecutionManager, options: ExecutionAdapterOptions = {}) {
    this.executionManager = executionManager;
    this.options = {
      slippageBps: 5,
      feeBps: 10,
      fillDelayMs: 100,
      ...options,
    };

    this.mode = options.mode ?? config.scanner.executionMode;

    this.defaultLeverage = Number.isFinite(options.defaultLeverage)
      ? Number(options.defaultLeverage)
      : Number(process.env.BYBIT_DEFAULT_LEVERAGE || 5);

    if (this.mode === 'testnet') {
      const { apiKey, apiSecret, apiUrl, accountType } = config.bybitTestnet;
      if (apiKey && apiSecret) {
        this.testnetClient = new BybitTradingClient({
          apiKey,
          apiSecret,
          apiUrl,
          accountType: (accountType as any) || 'UNIFIED',
        });
      } else {
        ADAPTER_LOG.warn('Bybit testnet credentials missing; testnet mode will fallback to dry execution');
      }
    }

    if (this.mode === 'demo') {
      const { apiKey, apiSecret, apiUrl, accountType } = config.bybitDemo || {};
      if (apiKey && apiSecret) {
        this.demoClient = new BybitTradingClient({
          apiKey,
          apiSecret,
          apiUrl,
          accountType: (accountType as any) || 'UNIFIED',
        });
      } else {
        ADAPTER_LOG.warn('Bybit demo credentials missing; demo mode will fallback to dry execution');
      }
    }
  }

  async execute(signal: ConfirmedSignal): Promise<void> {
    const logContext = {
      mode: this.mode,
      pair: signal.pairSymbol,
      timeframe: signal.timeframe,
      price: signal.entryPrice,
      size: signal.recommendedSize,
      riskScore: signal.riskScore,
    };

    switch (this.mode) {
      case 'dry-run':
        ADAPTER_LOG.info('ExecutionAdapter dry-run: skipping execution', logContext);
        return;
      case 'paper':
        await this.simulateFill(signal, 'paper');
        return;
      case 'shadow':
        await this.simulateFill(signal, 'shadow');
        // TODO: можно добавить запись о hypothetical исполнении
        return;
      case 'testnet':
        await this.placeNetworkOrder(signal, this.testnetClient, 'testnet');
        return;
      case 'demo':
        await this.placeNetworkOrder(signal, this.demoClient, 'demo');
        return;
      case 'live':
        await this.placeLiveOrder(signal);
        return;
      default:
        ADAPTER_LOG.warn('Unknown execution mode, defaulting to dry-run', logContext);
    }
  }

  private async simulateFill(signal: ConfirmedSignal, mode: 'paper' | 'shadow'): Promise<void> {
    const fillDelay = this.options.fillDelayMs ?? 0;
    if (fillDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, fillDelay));
    }

    const slippageFactor = 1 + (this.options.slippageBps ?? 0) / 10_000 * (signal.direction === 'long' ? 1 : -1);
    const filledPrice = signal.entryPrice * slippageFactor;
    const fee = (this.options.feeBps ?? 0) / 10_000 * filledPrice * signal.recommendedSize;

    ADAPTER_LOG.info('Simulated execution', {
      mode,
      pair: signal.pairSymbol,
      price: filledPrice,
      fee,
      size: signal.recommendedSize,
    });
  }

  private async placeLiveOrder(signal: ConfirmedSignal): Promise<void> {
    ADAPTER_LOG.info('Live execution placeholder', {
      pair: signal.pairSymbol,
      timeframe: signal.timeframe,
      price: signal.entryPrice,
      size: signal.recommendedSize,
    });
    // TODO: integrate with actual broker API
  }

  private async placeNetworkOrder(signal: ConfirmedSignal, client: BybitTradingClient | undefined, network: 'testnet' | 'demo'): Promise<void> {
    if (!client) {
      ADAPTER_LOG.warn(`Bybit ${network} client not configured, skipping execution`, {
        pair: signal.pairSymbol,
      });
      return;
    }

    const qty = Number(signal.recommendedSize || 0);
    if (!Number.isFinite(qty) || qty <= 0) {
      ADAPTER_LOG.warn(`Skipping ${network} order due to non-positive size`, {
        pair: signal.pairSymbol,
        size: signal.recommendedSize,
      });
      return;
    }

    const leverage = Number(signal.additionalData?.leverage ?? this.defaultLeverage);
    const side = signal.direction === 'long' ? 'Buy' : 'Sell';
    const orderLinkId = signal.id || `scan-${Date.now()}`;

    let takeProfit = signal.takeProfit;
    let stopLoss = signal.stopLoss;

    if (signal.entryPrice) {
      if (side === 'Sell') {
        if (typeof stopLoss === 'number' && stopLoss <= signal.entryPrice) {
          ADAPTER_LOG.warn('Adjusting stopLoss for short position to satisfy Bybit constraints', {
            pair: signal.pairSymbol,
            originalStopLoss: stopLoss,
            entryPrice: signal.entryPrice,
          });
          stopLoss = undefined;
        }
        if (typeof takeProfit === 'number' && takeProfit >= signal.entryPrice) {
          ADAPTER_LOG.warn('Adjusting takeProfit for short position to satisfy Bybit constraints', {
            pair: signal.pairSymbol,
            originalTakeProfit: takeProfit,
            entryPrice: signal.entryPrice,
          });
          takeProfit = undefined;
        }
      } else {
        if (typeof stopLoss === 'number' && stopLoss >= signal.entryPrice) {
          ADAPTER_LOG.warn('Adjusting stopLoss for long position to satisfy Bybit constraints', {
            pair: signal.pairSymbol,
            originalStopLoss: stopLoss,
            entryPrice: signal.entryPrice,
          });
          stopLoss = undefined;
        }
        if (typeof takeProfit === 'number' && takeProfit <= signal.entryPrice) {
          ADAPTER_LOG.warn('Adjusting takeProfit for long position to satisfy Bybit constraints', {
            pair: signal.pairSymbol,
            originalTakeProfit: takeProfit,
            entryPrice: signal.entryPrice,
          });
          takeProfit = undefined;
        }
      }
    }

    try {
      if (Number.isFinite(leverage) && leverage > 0) {
        await client.ensureLeverage({
          symbol: signal.pairSymbol,
          buyLeverage: leverage,
          sellLeverage: leverage,
        });
      }

      const result = await client.createOrder({
        symbol: signal.pairSymbol,
        side,
        orderType: 'Market',
        qty,
        orderLinkId,
        takeProfit,
        stopLoss,
        leverage,
      });

      if (signal.id) {
        const resultPayload = result as unknown as Record<string, unknown>;
        const positionId = signal.id || result.orderId || result.orderLinkId || `${signal.pairSymbol}:${signal.timeframe}`;
        const externalDetails: ExternalExecutionDetails = {
          orderId: result.orderId,
          orderLinkId: result.orderLinkId,
          exchange: signal.exchange ?? 'bybit',
          mode: this.mode,
          leverage,
          updatedAt: Date.now(),
        };

        const asNumber = (key: string): number | undefined => {
          const value = resultPayload[key];
          return typeof value === 'number' ? value : undefined;
        };

        const asString = (key: string): string | undefined => {
          const value = resultPayload[key];
          return typeof value === 'string' ? value : undefined;
        };

        const fee = asNumber('fee');
        if (typeof fee === 'number') {
          externalDetails.fee = fee;
        }

        const feeCurrency = asString('feeCurrency');
        if (feeCurrency) {
          externalDetails.feeCurrency = feeCurrency;
        }

        const margin = asNumber('margin');
        if (typeof margin === 'number') {
          externalDetails.margin = margin;
        }

        const initialMargin = asNumber('initialMargin');
        if (typeof initialMargin === 'number') {
          externalDetails.initialMargin = initialMargin;
        }

        const maintenanceMargin = asNumber('maintenanceMargin');
        if (typeof maintenanceMargin === 'number') {
          externalDetails.maintenanceMargin = maintenanceMargin;
        }

        const walletBalance = asNumber('walletBalance');
        if (typeof walletBalance === 'number') {
          externalDetails.walletBalance = walletBalance;
        }

        const availableBalance = asNumber('availableBalance');
        if (typeof availableBalance === 'number') {
          externalDetails.availableBalance = availableBalance;
        }

        const positionValue = asNumber('positionValue');
        if (typeof positionValue === 'number') {
          externalDetails.positionValue = positionValue;
        }

        const unrealizedPnl = asNumber('unrealizedPnl');
        if (typeof unrealizedPnl === 'number') {
          externalDetails.unrealizedPnl = unrealizedPnl;
        }

        const pnlPercentage = asNumber('pnlPercentage');
        if (typeof pnlPercentage === 'number') {
          externalDetails.pnlPercentage = pnlPercentage;
        }

        const markPrice = asNumber('markPrice');
        if (typeof markPrice === 'number') {
          externalDetails.markPrice = markPrice;
        }

        await this.executionManager.attachExternalOrder(positionId, externalDetails);
      }

      ADAPTER_LOG.info(`Bybit ${network} order submitted`, {
        pair: signal.pairSymbol,
        orderId: result.orderId,
        orderLinkId: result.orderLinkId,
        side,
        qty,
      });
    } catch (error: any) {
      ADAPTER_LOG.error(`Failed to execute Bybit ${network} order`, {
        pair: signal.pairSymbol,
        payload: {
          side,
          qty,
          orderLinkId,
          takeProfit,
          stopLoss,
        },
        error: error?.message || error,
        retCode: error?.retCode || error?.code,
        retMsg: error?.retMsg,
        result: error?.result,
        response: error?.response?.data,
        status: error?.response?.status,
      });
    }
  }
}

const OPEN_POSITIONS_KEY = 'scanner:positions:open';
const POSITION_INDEX_KEY = 'scanner:positions:index';
const EXECUTION_KEY = 'scanner:executions';
const OPEN_POSITION_PATTERN = 'scanner:positions:open*';

export class RedisExecutionManager implements ExecutionManager {
  private readonly redis: Redis;

  constructor(redis?: Redis) {
    this.redis = redis || connection.duplicate();
  }

  private calculatePnL(position: ExecutionRecord, exitPrice: number): number {
    const size = position.size ?? 0;
    const entryPrice = position.entryPrice ?? 0;
    if (!size || !entryPrice) {
      return 0;
    }

    const difference = position.direction === 'long'
      ? exitPrice - entryPrice
      : entryPrice - exitPrice;

    return difference * size;
  }

  private async init() {
    if (!this.redis.status || this.redis.status === 'end') {
      await this.redis.connect();
    }
  }

  private buildPositionKey(signal: ConfirmedSignal): string {
    return `${signal.exchange || 'bybit'}:${signal.pairSymbol}:${signal.direction}`;
  }

  private buildLeg(signal: ConfirmedSignal): ExecutionLeg {
    return {
      id: signal.id || `${signal.pairSymbol}:${signal.timeframe}:${signal.confirmedAt}`,
      signalId: signal.id,
      timeframe: signal.timeframe,
      strategyId: signal.strategyId,
      allocationId: signal.allocationId,
      allocationTimestamp: signal.detectedAt,
      allocationSize: signal.recommendedSize,
      confirmedAt: signal.confirmedAt,
      entryPrice: signal.entryPrice,
      size: signal.recommendedSize,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
    };
  }

  private aggregatePosition(existing: ExecutionRecord | null, signal: ConfirmedSignal): ExecutionRecord {
    const leg = this.buildLeg(signal);
    if (!existing) {
      // НОВОЕ: Получаем текущую сессию для изоляции данных
      const currentSessionId = sessionManager.getCurrentSessionId();
      
      return {
        id: leg.id,
        positionKey: this.buildPositionKey(signal),
        pairSymbol: signal.pairSymbol,
        timeframe: signal.timeframe,
        timeframes: [signal.timeframe],
        exchange: signal.exchange,
        direction: signal.direction,
        entryPrice: signal.entryPrice,
        riskScore: signal.riskScore,
        size: signal.recommendedSize,
        executedAt: signal.confirmedAt,
        mode: config.scanner.executionMode,
        status: 'open',
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        legs: [leg],
        sessionId: currentSessionId || undefined,  // НОВОЕ: Привязка к сессии
      };
    }

    const totalSize = (existing.size || 0) + (signal.recommendedSize || 0);
    const weightedEntry = totalSize > 0
      ? ((existing.entryPrice * (existing.size || 0)) + (signal.entryPrice * (signal.recommendedSize || 0))) / totalSize
      : existing.entryPrice;

    const timeframes = new Set(existing.timeframes || []);
    timeframes.add(signal.timeframe);

    const stopLoss = (() => {
      if (typeof signal.stopLoss !== 'number') return existing.stopLoss;
      if (typeof existing.stopLoss !== 'number') return signal.stopLoss;
      return signal.direction === 'long'
        ? Math.max(existing.stopLoss, signal.stopLoss)
        : Math.min(existing.stopLoss, signal.stopLoss);
    })();

    const takeProfit = (() => {
      if (typeof signal.takeProfit !== 'number') return existing.takeProfit;
      if (typeof existing.takeProfit !== 'number') return signal.takeProfit;
      return signal.direction === 'long'
        ? Math.min(existing.takeProfit, signal.takeProfit)
        : Math.max(existing.takeProfit, signal.takeProfit);
    })();

    return {
      ...existing,
      size: totalSize,
      entryPrice: Number.isFinite(weightedEntry) ? weightedEntry : existing.entryPrice,
      stopLoss,
      takeProfit,
      legs: [...(existing.legs || []), leg],
      timeframes: Array.from(timeframes),
      executedAt: Math.min(existing.executedAt, signal.confirmedAt),
      riskScore: Math.max(existing.riskScore ?? 0, signal.riskScore ?? 0),
    };
  }

  private async saveOpenPosition(record: ExecutionRecord): Promise<void> {
    await this.redis.hset(OPEN_POSITIONS_KEY, record.id, JSON.stringify(record));
    if (record.positionKey) {
      await this.redis.hset(POSITION_INDEX_KEY, record.positionKey, record.id);
    }
  }

  async recordExecution(signal: ConfirmedSignal): Promise<void> {
    await this.init();
    const positionKey = this.buildPositionKey(signal);
    const existingId = await this.redis.hget(POSITION_INDEX_KEY, positionKey);
    let existingRecord: ExecutionRecord | null = null;

    if (existingId) {
      const raw = await this.redis.hget(OPEN_POSITIONS_KEY, existingId);
      if (raw) {
        try {
          existingRecord = JSON.parse(raw) as ExecutionRecord;
        } catch (error: any) {
          ADAPTER_LOG.warn('Failed to parse existing execution record, ignoring', { existingId, error: error instanceof Error ? error.message : error });
        }
      }
    }

    const aggregated = this.aggregatePosition(existingRecord, signal);
    const isNewPosition = !existingRecord;
    const legs = aggregated.legs || [];
    const lastLeg = legs.length > 0 ? legs[legs.length - 1] : null;
    const broadcastPayload = {
      ...aggregated,
      lastLeg,
      legs: aggregated.legs,
    };

    await this.redis.multi()
      .lpush(EXECUTION_KEY, JSON.stringify({ ...broadcastPayload, legs: lastLeg ? [lastLeg] : broadcastPayload.legs }))
      .ltrim(EXECUTION_KEY, 0, 999)
      .exec();

    await this.saveOpenPosition(aggregated);
    await broadcast({ type: isNewPosition ? 'execution_opened' : 'execution_updated', payload: broadcastPayload });

    const sessionId = sessionManager.getCurrentSessionId();
    if (sessionId) {
      try {
        const leg = legs.length > 0 ? legs[legs.length - 1] : undefined;
        if (isNewPosition) {
          await sessionManager.recordTrade({
            sessionId,
            source: 'scanner',
            mode: config.scanner.executionMode,
            pair: signal.pairSymbol,
            timeframe: signal.timeframe,
            direction: signal.direction,
            exchange: signal.exchange || 'bybit',
            strategyId: signal.strategyId,
            signalId: signal.id,
            allocationId: signal.allocationId,
            orderLinkId: aggregated.id,
            entryTimestamp: new Date(signal.confirmedAt),
            entryPrice: signal.entryPrice,
            positionSize: signal.recommendedSize,
            leverage: signal.additionalData?.leverage,
            stopLoss: signal.stopLoss,
            takeProfit: signal.takeProfit,
            riskScore: signal.riskScore,
            confirmationAttempts: signal.confirmationAttempts,
            extra: {
              correlationId: signal.correlationId,
              recommendedOrderType: signal.recommendedOrderType,
              positionKey,
              legId: leg?.id,
              legsCount: aggregated.legs?.length,
            },
          });
        } else if (leg) {
          await sessionManager.appendTradeLeg({
            tradeId: aggregated.id,
            leg,
            entryPrice: signal.entryPrice,
            positionSize: signal.recommendedSize,
            leverage: signal.additionalData?.leverage,
            stopLoss: signal.stopLoss,
            takeProfit: signal.takeProfit,
            confirmationAttempts: signal.confirmationAttempts,
          });
        }
      } catch (error: any) {
        ADAPTER_LOG.error('Failed to record trade in session', { error: error instanceof Error ? error.message : error, signalId: signal.id });
      }
    }
  }

  async getExecutions(limit = 50): Promise<ExecutionRecord[]> {
    await this.init();
    const entries = await this.redis.lrange(EXECUTION_KEY, 0, limit - 1);
    return entries
      .map((entry) => {
        try {
          return JSON.parse(entry) as ExecutionRecord;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is ExecutionRecord => entry !== null);
  }

  /**
   * Получить историю исполнений конкретной сессии
   */
  async getExecutionsBySession(sessionId: string, limit = 50): Promise<ExecutionRecord[]> {
    const allExecutions = await this.getExecutions(limit * 2); // Берём больше, чтобы после фильтрации осталось достаточно
    return allExecutions
      .filter((exec) => exec.sessionId === sessionId)
      .slice(0, limit);
  }

  async getOpenPositions(): Promise<ExecutionRecord[]> {
    await this.init();
    const items = await this.redis.hvals(OPEN_POSITIONS_KEY);
    return items
      .map((raw) => {
        try {
          return JSON.parse(raw) as ExecutionRecord;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is ExecutionRecord => entry !== null);
  }

  /**
   * Получить открытые позиции конкретной сессии
   */
  async getOpenPositionsBySession(sessionId: string): Promise<ExecutionRecord[]> {
    const allPositions = await this.getOpenPositions();
    return allPositions.filter((pos) => pos.sessionId === sessionId);
  }

  private async resolveRecord(positionId: string): Promise<ExecutionRecord | null> {
    await this.init();
    const raw = await this.redis.hget(OPEN_POSITIONS_KEY, positionId);
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as ExecutionRecord;
    } catch (error: any) {
      ADAPTER_LOG.warn('Failed to parse execution record', { positionId, error: error instanceof Error ? error.message : error });
      await this.redis.hdel(OPEN_POSITIONS_KEY, positionId);
      return null;
    }
  }

  private async removePosition(record: ExecutionRecord): Promise<void> {
    await this.redis.hdel(OPEN_POSITIONS_KEY, record.id);
    if (record.positionKey) {
      await this.redis.hdel(POSITION_INDEX_KEY, record.positionKey);
    }
  }

  async closePosition(positionId: string, payload: { exitPrice: number; exitAt: number; exitReason: 'take_profit' | 'stop_loss' | 'manual' }): Promise<ExecutionRecord | null> {
    const position = await this.resolveRecord(positionId);
    if (!position) {
      return null;
    }

    const pnl = position.direction === 'long'
      ? (payload.exitPrice - position.entryPrice) * position.size
      : (position.entryPrice - payload.exitPrice) * position.size;
    const pnlPercentage = position.entryPrice !== 0
      ? (payload.exitPrice - position.entryPrice) / position.entryPrice * (position.direction === 'long' ? 100 : -100)
      : 0;

    const closed: ExecutionRecord = {
      ...position,
      status: 'closed',
      exitPrice: payload.exitPrice,
      exitAt: payload.exitAt,
      exitReason: payload.exitReason,
      pnl,
      pnlPercentage,
    };

    await this.redis.multi()
      .lpush(EXECUTION_KEY, JSON.stringify(closed))
      .ltrim(EXECUTION_KEY, 0, 999)
      .exec();

    await this.removePosition(position);
    await broadcast({ type: 'execution_closed', payload: closed });

    const sessionId = sessionManager.getCurrentSessionId();
    if (sessionId) {
      try {
        const trades = await sessionManager.getSessionTrades(sessionId, 'open');
        const trade = trades.find((t) => t.orderLinkId === positionId);

        if (trade) {
          await sessionManager.closeTrade({
            tradeId: trade.id,
            exitTimestamp: new Date(payload.exitAt),
            exitPrice: payload.exitPrice,
            exitReason: payload.exitReason,
            realizedPnl: pnl,
            realizedPnlPct: pnlPercentage,
          });
        }
      } catch (error: any) {
        ADAPTER_LOG.error('Failed to close trade in session', { error: error instanceof Error ? error.message : error, positionId });
      }
    }

    return closed;
  }

  async checkForAutoCloses(context: SignalContext, candles: CandleData[]): Promise<ExecutionRecord[]> {
    await this.init();
    if (!candles.length) {
      return [];
    }

    const latest = candles[candles.length - 1];
    const currentSessionId = sessionManager.getCurrentSessionId();
    const openPositions = currentSessionId
      ? await this.getOpenPositionsBySession(currentSessionId)
      : await this.getOpenPositions();
    const toClose: ExecutionRecord[] = [];

    for (const position of openPositions) {
      if (position.pairSymbol !== context.pairSymbol || position.timeframe !== context.timeframe) {
        continue;
      }

      const priceHigh = latest.high ?? latest.close;
      const priceLow = latest.low ?? latest.close;

      if (position.direction === 'long') {
        if (typeof position.takeProfit === 'number' && priceHigh >= position.takeProfit) {
          const closed = await this.closePosition(position.id, { exitPrice: position.takeProfit, exitAt: latest.timestamp, exitReason: 'take_profit' });
          if (closed) toClose.push(closed);
          continue;
        }
        if (typeof position.stopLoss === 'number' && priceLow <= position.stopLoss) {
          const closed = await this.closePosition(position.id, { exitPrice: position.stopLoss, exitAt: latest.timestamp, exitReason: 'stop_loss' });
          if (closed) toClose.push(closed);
          continue;
        }
      } else {
        if (typeof position.takeProfit === 'number' && priceLow <= position.takeProfit) {
          const closed = await this.closePosition(position.id, { exitPrice: position.takeProfit, exitAt: latest.timestamp, exitReason: 'take_profit' });
          if (closed) toClose.push(closed);
          continue;
        }
        if (typeof position.stopLoss === 'number' && priceHigh >= position.stopLoss) {
          const closed = await this.closePosition(position.id, { exitPrice: position.stopLoss, exitAt: latest.timestamp, exitReason: 'stop_loss' });
          if (closed) toClose.push(closed);
          continue;
        }
      }
    }

    return toClose;
  }

  async updatePositionRecord(positionId: string, updates: Partial<ExecutionRecord>, options: ExecutionAggregationOptions = {}): Promise<ExecutionRecord | null> {
    const current = await this.resolveRecord(positionId);
    if (!current) {
      return null;
    }

    const merged: ExecutionRecord = {
      ...current,
      ...updates,
    };

    if (options.combineTimeframes && updates.timeframes) {
      merged.timeframes = Array.from(new Set([...(current.timeframes || []), ...updates.timeframes]));
    }

    if (options.updateSizeFromExchange && typeof updates.size === 'number') {
      merged.entryPrice = current.entryPrice; // размер меняем, цену оставляем
    }

    await this.saveOpenPosition(merged);
    await broadcast({ type: 'execution_updated', payload: merged });
    return merged;
  }

  async attachExternalOrder(positionId: string, details: ExternalExecutionDetails): Promise<void> {
    const existing = await this.resolveRecord(positionId);
    if (!existing) {
      return;
    }

    const mergedExternal = {
      ...(existing.external || {}),
      ...details,
      updatedAt: details.updatedAt || Date.now(),
    };

    // Логируем изменение PnL для отладки
    if (details.unrealizedPnl !== undefined && Math.abs(details.unrealizedPnl - (existing.external?.unrealizedPnl || 0)) > 0.1) {
      ADAPTER_LOG.debug('Position PnL updated', { 
        id: positionId, 
        pair: existing.pairSymbol, 
        old: existing.external?.unrealizedPnl, 
        new: details.unrealizedPnl 
      });
    }

    // 🔥 Рассчитываем PnL на основе внешних данных
    const currentPrice = details.markPrice || existing.entryPrice;
    const unrealizedPnl = details.unrealizedPnl;
    let calculatedPnl = existing.pnl || 0;
    let calculatedPnlPercentage = existing.pnlPercentage || 0;

    if (unrealizedPnl !== undefined) {
      calculatedPnl = unrealizedPnl;
      calculatedPnlPercentage = existing.entryPrice !== 0
        ? (unrealizedPnl / (existing.entryPrice * existing.size)) * 100
        : 0;
    } else if (currentPrice !== existing.entryPrice) {
      // Если unrealizedPnl не пришел, считаем по markPrice
      calculatedPnl = existing.direction === 'long'
        ? (currentPrice - existing.entryPrice) * existing.size
        : (existing.entryPrice - currentPrice) * existing.size;
      calculatedPnlPercentage = existing.entryPrice !== 0
        ? (currentPrice - existing.entryPrice) / existing.entryPrice * (existing.direction === 'long' ? 100 : -100)
        : 0;
    }

    const updatedPosition = {
      ...existing,
      external: mergedExternal,
      pnl: calculatedPnl,
      pnlPercentage: calculatedPnlPercentage,
    };

    await this.saveOpenPosition(updatedPosition);
    await broadcast({ type: 'execution_updated', payload: updatedPosition });

    if (existing.sessionId) {
      try {
        await sessionManager.appendExternalExecution({
          sessionId: existing.sessionId,
          orderLinkId: details.orderLinkId ?? existing.id,
          orderId: details.orderId,
          executionId: details.executionId,
          details: mergedExternal,
        });
      } catch (error: any) {
        ADAPTER_LOG.warn('Failed to append external execution to session trade', {
          sessionId: existing.sessionId,
          positionId,
          error: error instanceof Error ? error.message : error,
        });
      }
    }
  }

  async broadcastSnapshot(): Promise<void> {
    await this.init();
    // ИСПРАВЛЕНО: Фильтруем по текущей сессии
    const currentSessionId = sessionManager.getCurrentSessionId();
    
    if (currentSessionId) {
      const open = await this.getOpenPositionsBySession(currentSessionId);
      const recent = await this.getExecutionsBySession(currentSessionId, 50);
      await broadcast({ type: 'executions_snapshot', payload: { open, recent } });
      ADAPTER_LOG.debug(`Broadcasting snapshot for session ${currentSessionId}: ${open.length} open, ${recent.length} recent`);
    } else {
      // Если нет активной сессии, отправляем пустой snapshot
      await broadcast({ type: 'executions_snapshot', payload: { open: [], recent: [] } });
      ADAPTER_LOG.debug('No active session, broadcasting empty snapshot');
    }
  }

  async clearAll(): Promise<void> {
    await this.init();
    await this.redis.del(EXECUTION_KEY);
    await this.redis.del(OPEN_POSITIONS_KEY);
    await this.redis.del(POSITION_INDEX_KEY);
    await broadcast({ type: 'executions_snapshot', payload: { open: [], recent: [] } });
  }

  /**
   * Восстановление позиции из БД после перезапуска
   */
  async restorePosition(trade: any): Promise<ExecutionRecord | null> {
    await this.init();

    try {
      const record: ExecutionRecord = {
        id: trade.id,
        pairSymbol: trade.pair,
        timeframe: trade.timeframe || '1h',
        timeframes: trade.timeframe ? [trade.timeframe] : [],
        direction: (trade.direction as 'long' | 'short') || 'long',
        entryPrice: parseFloat(trade.entryPrice || '0'),
        size: parseFloat(trade.positionSize || '0'),
        executedAt: trade.entryTimestamp ? trade.entryTimestamp.getTime() : Date.now(),
        status: 'open',
        stopLoss: trade.stopLoss ? parseFloat(trade.stopLoss) : undefined,
        takeProfit: trade.takeProfit ? parseFloat(trade.takeProfit) : undefined,
        riskScore: 0,
        source: 'restored',
        sessionId: trade.session?.id || trade.sessionId,  // ИСПРАВЛЕНО: правильная привязка
      };

      await this.saveOpenPosition(record);
      await broadcast({ type: 'execution_opened', payload: record });
      
      ADAPTER_LOG.info('Position restored', {
        id: record.id,
        pair: record.pairSymbol,
        size: record.size,
      });

      return record;
    } catch (error: any) {
      ADAPTER_LOG.error('Failed to restore position', { error: error instanceof Error ? error.message : error, tradeId: trade.id });
      return null;
    }
  }

  /**
   * Проверка позиций против текущего рынка и закрытие тех, которые должны были закрыться
   */
  async validateAndClosePhantomPositions(marketDataSource: MarketDataSource): Promise<number> {
    await this.init();
    
    try {
      const currentSessionId = sessionManager.getCurrentSessionId();
      const openPositions = currentSessionId
        ? await this.getOpenPositionsBySession(currentSessionId)
        : await this.getOpenPositions();
      let closedCount = 0;

      for (const position of openPositions) {
        try {
          // Получаем актуальные свечи для проверки
          const candles = await marketDataSource.getLatestCandles(position.pairSymbol, position.timeframe, 100);
          
          if (!candles || candles.length === 0) {
            ADAPTER_LOG.warn('No candles available for position validation', { 
              pair: position.pairSymbol,
              positionId: position.id,
            });
            continue;
          }

          // Проверяем все свечи с момента входа
          const entryTime = position.executedAt;
          const relevantCandles = candles.filter((c) => c.timestamp >= entryTime);

          let shouldClose = false;
          let exitPrice = position.entryPrice;
          let exitReason = '';
          let exitTimestamp = Date.now();

          for (const candle of relevantCandles) {
            if (position.direction === 'long') {
              // Проверяем тейк-профит
              if (position.takeProfit && candle.high >= position.takeProfit) {
                shouldClose = true;
                exitPrice = position.takeProfit;
                exitReason = 'take_profit';
                exitTimestamp = candle.timestamp;
                break;
              }
              // Проверяем стоп-лосс
              if (position.stopLoss && candle.low <= position.stopLoss) {
                shouldClose = true;
                exitPrice = position.stopLoss;
                exitReason = 'stop_loss';
                exitTimestamp = candle.timestamp;
                break;
              }
            } else {
              // Для short позиций
              if (position.takeProfit && candle.low <= position.takeProfit) {
                shouldClose = true;
                exitPrice = position.takeProfit;
                exitReason = 'take_profit';
                exitTimestamp = candle.timestamp;
                break;
              }
              if (position.stopLoss && candle.high >= position.stopLoss) {
                shouldClose = true;
                exitPrice = position.stopLoss;
                exitReason = 'stop_loss';
                exitTimestamp = candle.timestamp;
                break;
              }
            }
          }

          if (shouldClose) {
            const finalExitPrice = exitPrice || position.entryPrice;

            const closed = await this.closePosition(position.id, {
              exitReason: exitReason as 'take_profit' | 'stop_loss' | 'manual',
              exitPrice: finalExitPrice,
              exitAt: exitTimestamp,
            });
            if (closed) {
              closedCount++;
              ADAPTER_LOG.info('Phantom position closed', {
                positionId: position.id,
                pair: position.pairSymbol,
                exitReason,
                exitPrice: finalExitPrice,
                pnl: closed.pnl,
              });
            }
          }
        } catch (error: any) {
          ADAPTER_LOG.error('Failed to validate position against market', {
            error: error instanceof Error ? error.message : error,
            positionId: position.id,
          });
        }
      }

      if (closedCount > 0) {
        ADAPTER_LOG.info('Phantom positions cleanup completed', { closedCount });
      }

      return closedCount;
    } catch (error: any) {
      ADAPTER_LOG.error('Failed to validate phantom positions', { error: error instanceof Error ? error.message : error });
      return 0;
    }
  }
}

export const executionManager = new RedisExecutionManager();

const LEGACY_POSITION_KEYS = ['scanner:positions:open', 'scanner:positions:index'];

export const clearExecutionCaches = async (): Promise<void> => {
  const redis = connection.duplicate();
  try {
    if (!redis.status || redis.status === 'end') {
      await redis.connect();
    }

    const keysToDelete = new Set<string>();
    for (const pattern of [OPEN_POSITION_PATTERN, 'scanner:positions:index*', 'scanner:executions*']) {
      const found = await redis.keys(pattern);
      found.forEach((key) => keysToDelete.add(key));
    }

    keysToDelete.add(OPEN_POSITIONS_KEY);
    keysToDelete.add(POSITION_INDEX_KEY);
    keysToDelete.add(EXECUTION_KEY);

    const keys = Array.from(keysToDelete);
    if (keys.length > 0) {
      await redis.del(...keys);
      ADAPTER_LOG.info('Cleared stale scanner execution cache', { keys });
    }
    await redis.quit();
  } catch (error: any) {
    ADAPTER_LOG.error('Failed to clear execution cache', { error: error instanceof Error ? error.message : error });
  }
};

