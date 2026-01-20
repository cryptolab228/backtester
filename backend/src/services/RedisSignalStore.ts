import Redis from 'ioredis';

import config from '@/config';
import { connection } from '@/config/queue';
import logger from '@/utils/logger';
import { broadcast } from '@/websocket';

import {
  ConfirmedSignal,
  PendingSignal,
  PendingSignalStatus,
  SignalMetadata,
} from '@/modules/scanner/scanner.types';

const SIGNAL_LOG = logger.child({ module: 'RedisSignalStore' });

const DETECTED_KEY_PREFIX = 'scanner:signal';
const PENDING_KEY_PREFIX = 'scanner:pending';
const TIMELINE_KEY_PREFIX = 'scanner:timeline';

class RedisSignalStore {
  private redis: Redis | null = null;
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized && this.redis) {
      return;
    }
    this.redis = connection.duplicate();
    if (!this.redis.status || this.redis.status === 'end') {
      await this.redis.connect();
    }
    this.initialized = true;
  }

  async storeDetected(signal: SignalMetadata) {
    await this.init();
    if (!this.redis) throw new Error('Redis not initialized');

    const id = this.buildSignalIdentifier(signal);
    const key = this.buildSignalKey(id);

    const payload = {
      id,
      pairSymbol: signal.pairSymbol,
      timeframe: signal.timeframe,
      detectedAt: signal.detectedAt.toString(),
      strategyId: signal.strategyId,
      strength: signal.strength.toString(),
      direction: signal.direction,
      entryPrice: signal.entryPrice.toString(),
      stopLoss: signal.stopLoss?.toString() ?? '',
      takeProfit: signal.takeProfit?.toString() ?? '',
      additionalData: signal.additionalData ? JSON.stringify(signal.additionalData) : '',
      status: 'waiting',
      lastCandleTimestamp: signal.lastCandleTimestamp?.toString() ?? '',
      lastCandlePrice: signal.lastCandlePrice?.toString() ?? '',
      confirmationTargetPrice: signal.confirmationTargetPrice?.toString() ?? '',
      currentPrice: signal.currentPrice?.toString() ?? '',
      priceDelta: signal.priceDelta?.toString() ?? '',
      priceDeltaPct: signal.priceDeltaPct?.toString() ?? '',
      confirmationExpiresAt: signal.confirmationExpiresAt?.toString() ?? '',
      timeElapsedMs: signal.timeElapsedMs?.toString() ?? '',
      timeToConfirmMs: signal.timeToConfirmMs?.toString() ?? '',
    };

    await this.redis.hmset(key, payload);
    await this.redis.zadd(this.buildTimelineKey(signal.pairSymbol), signal.detectedAt, key);
    await this.redis.expire(key, 60 * 60 * 24 * 7);

    return { ...signal, id, status: 'waiting' };
  }

  async storeConfirmed(signal: ConfirmedSignal) {
    await this.init();
    if (!this.redis) throw new Error('Redis not initialized');

    const id = signal.id || this.buildSignalIdentifier(signal);
    const key = this.buildSignalKey(id);

    const recommendedSize = typeof signal.recommendedSize === 'number'
      ? signal.recommendedSize
      : config.scanner.basePositionSize ?? 0;

    if (!Number.isFinite(recommendedSize) || recommendedSize <= 0) {
      SIGNAL_LOG.warn('Confirmed signal without valid recommendedSize, using fallback', {
        id,
        pair: signal.pairSymbol,
        timeframe: signal.timeframe,
        recommendedSize: signal.recommendedSize,
      });
    }

    const payload = {
      id,
      pairSymbol: signal.pairSymbol,
      timeframe: signal.timeframe,
      detectedAt: signal.detectedAt.toString(),
      confirmedAt: signal.confirmedAt.toString(),
      strategyId: signal.strategyId,
      strength: signal.strength.toString(),
      direction: signal.direction,
      entryPrice: signal.entryPrice.toString(),
      stopLoss: signal.stopLoss?.toString() ?? '',
      takeProfit: signal.takeProfit?.toString() ?? '',
      additionalData: signal.additionalData ? JSON.stringify(signal.additionalData) : '',
      status: 'confirmed',
      riskScore: signal.riskScore.toString(),
      recommendedOrderType: signal.recommendedOrderType,
      recommendedSize: Number.isFinite(recommendedSize) && recommendedSize > 0
        ? recommendedSize.toString()
        : '0',
    };

    await this.redis.hmset(key, payload);
    await this.redis.zadd(this.buildTimelineKey(signal.pairSymbol), signal.confirmedAt, key);
    await this.redis.expire(key, 60 * 60 * 24 * 30);

    return { ...signal, id, status: 'confirmed' };
  }

  async cancelByKey(key: string, reason: string) {
    await this.init();
    if (!this.redis) throw new Error('Redis not initialized');

    const exists = await this.redis.exists(key);
    if (!exists) {
      return;
    }

    await this.redis.hmset(key, { status: 'cancelled', cancelledAt: Date.now().toString(), reason });
    const pairSymbol = await this.redis.hget(key, 'pairSymbol');
    if (pairSymbol) {
      const timelineKey = this.getPendingTimelineKey(pairSymbol);
      await this.redis.zrem(timelineKey, key);
    }
    await this.redis.del(key);
  }

  async setCooldown(pairSymbol: string, seconds: number) {
    await this.init();
    if (!this.redis) throw new Error('Redis not initialized');

    const key = `scanner:cooldown:${pairSymbol}`;
    await this.redis.set(key, '1', 'EX', seconds);
  }

  async isCooldownActive(pairSymbol: string): Promise<boolean> {
    await this.init();
    if (!this.redis) throw new Error('Redis not initialized');

    const key = `scanner:cooldown:${pairSymbol}`;
    const ttl = await this.redis.ttl(key);
    return ttl > 0;
  }

  async getRecentSignals(pairSymbol: string, limit = 50) {
    await this.init();
    if (!this.redis) throw new Error('Redis not initialized');

    const timelineKey = this.buildTimelineKey(pairSymbol);
    const now = Date.now();
    const minScore = now - 1000 * 60 * 60 * 24 * 7;
    const items = await this.redis.zrevrangebyscore(timelineKey, now, minScore, 'LIMIT', 0, limit);

    const results = [];
    for (const key of items) {
      const data = await this.redis.hgetall(key);
      if (Object.keys(data).length === 0) {
        continue;
      }
      results.push(this.mapSignal(data));
    }

    return results;
  }

  async storePending(signal: PendingSignal): Promise<void> {
    await this.init();
    if (!this.redis) throw new Error('Redis not initialized');

    const id = signal.id || this.buildSignalIdentifier(signal);
    const key = this.buildPendingKey(id);
    await this.redis.hmset(key, {
      id,
      status: signal.status,
      pairSymbol: signal.pairSymbol,
      timeframe: signal.timeframe,
      detectedAt: signal.detectedAt.toString(),
      strategyId: signal.strategyId,
      strength: signal.strength.toString(),
      direction: signal.direction,
      entryPrice: signal.entryPrice.toString(),
      stopLoss: signal.stopLoss?.toString() ?? '',
      takeProfit: signal.takeProfit?.toString() ?? '',
      additionalData: signal.additionalData ? JSON.stringify(signal.additionalData) : '',
      lastUpdatedAt: Date.now().toString(),
      riskScore: signal.riskScore?.toString() ?? '',
      recommendedSize: signal.recommendedSize?.toString() ?? '',
      confirmationAttempts: signal.confirmationAttempts?.toString() ?? '0',
      lastCandleTimestamp: signal.lastCandleTimestamp?.toString() ?? '',
      lastCandlePrice: signal.lastCandlePrice?.toString() ?? '',
      maxConfirmationAttempts: signal.maxConfirmationAttempts?.toString() ?? '',
      confirmWindowSize: signal.confirmWindowSize?.toString() ?? '',
      confirmationTargetPrice: signal.confirmationTargetPrice?.toString() ?? '',
      currentPrice: signal.currentPrice?.toString() ?? '',
      priceDelta: signal.priceDelta?.toString() ?? '',
      priceDeltaPct: signal.priceDeltaPct?.toString() ?? '',
      confirmationExpiresAt: signal.confirmationExpiresAt?.toString() ?? '',
      timeElapsedMs: signal.timeElapsedMs?.toString() ?? '',
      timeToConfirmMs: signal.timeToConfirmMs?.toString() ?? '',
    });
    await this.redis.zadd(this.getPendingTimelineKey(signal.pairSymbol), signal.detectedAt, key);
    await this.setPendingExpiry(key);
  }

  async updatePending(signalId: string, updates: Partial<PendingSignal>): Promise<void> {
    await this.init();
    if (!this.redis) throw new Error('Redis not initialized');

    const key = this.buildPendingKey(signalId);
    const exists = await this.redis.exists(key);
    if (!exists) {
      SIGNAL_LOG.warn('Attempted to update non-existing pending signal', { signalId });
      return;
    }

    const payload: Record<string, string> = { lastUpdatedAt: Date.now().toString() };
    if (updates.status) payload.status = updates.status;
    if (typeof updates.riskScore === 'number') payload.riskScore = updates.riskScore.toString();
    if (typeof updates.recommendedSize === 'number') payload.recommendedSize = updates.recommendedSize.toString();
    if (typeof updates.confirmationAttempts === 'number') payload.confirmationAttempts = updates.confirmationAttempts.toString();
    if (typeof updates.lastCandleTimestamp === 'number') payload.lastCandleTimestamp = updates.lastCandleTimestamp.toString();
    if (typeof updates.lastCandlePrice === 'number') payload.lastCandlePrice = updates.lastCandlePrice.toString();
    if (typeof updates.confirmationTargetPrice === 'number') payload.confirmationTargetPrice = updates.confirmationTargetPrice.toString();
    if (typeof (updates as any).maxConfirmationAttempts === 'number') payload.maxConfirmationAttempts = (updates as any).maxConfirmationAttempts.toString();
    if (typeof (updates as any).confirmWindowSize === 'number') payload.confirmWindowSize = (updates as any).confirmWindowSize.toString();
    if (typeof updates.currentPrice === 'number') payload.currentPrice = updates.currentPrice.toString();
    if (typeof updates.priceDelta === 'number') payload.priceDelta = updates.priceDelta.toString();
    if (typeof updates.priceDeltaPct === 'number') payload.priceDeltaPct = updates.priceDeltaPct.toString();
    if (typeof updates.confirmationExpiresAt === 'number') payload.confirmationExpiresAt = updates.confirmationExpiresAt.toString();
    if (typeof updates.timeElapsedMs === 'number') payload.timeElapsedMs = updates.timeElapsedMs.toString();
    if (typeof updates.timeToConfirmMs === 'number') payload.timeToConfirmMs = updates.timeToConfirmMs.toString();
    if (updates.additionalData) payload.additionalData = JSON.stringify(updates.additionalData);

    await this.redis.hmset(key, payload);
    await this.setPendingExpiry(key);

    if (updates.status && updates.status !== 'waiting') {
      const pairSymbol = updates.pairSymbol || (await this.redis.hget(key, 'pairSymbol'));
      if (pairSymbol) {
        const timelineKey = this.getPendingTimelineKey(pairSymbol);
        await this.redis.zrem(timelineKey, key);
      }
    }
  }

  async removePending(signalId: string): Promise<void> {
    await this.init();
    if (!this.redis) throw new Error('Redis not initialized');

    const key = this.buildPendingKey(signalId);
    const data = await this.redis.hgetall(key);
    if (!data || Object.keys(data).length === 0) {
      return;
    }

    const pairSymbol = data.pairSymbol;
    await this.redis.del(key);
    if (pairSymbol) {
      const timelineKey = this.getPendingTimelineKey(pairSymbol);
      await this.redis.zrem(timelineKey, key);
    }
  }

  async getPendingSignal(signalId: string): Promise<PendingSignal | null> {
    await this.init();
    if (!this.redis) throw new Error('Redis not initialized');

    const key = this.buildPendingKey(signalId);
    const data = await this.redis.hgetall(key);
    if (!data || Object.keys(data).length === 0) {
      return null;
    }
    return this.mapPending(data);
  }

  async getPendingSignals(pairSymbol?: string): Promise<PendingSignal[]> {
    await this.init();
    if (!this.redis) throw new Error('Redis not initialized');

    let keys: string[] = [];
    if (pairSymbol) {
      const timelineKey = this.getPendingTimelineKey(pairSymbol);
      const now = Date.now();
      keys = await this.redis.zrevrangebyscore(timelineKey, now, now - 1000 * 60 * 60 * 24, 'LIMIT', 0, 200);
    } else {
      keys = await this.redis.keys(`${PENDING_KEY_PREFIX}:*`);
    }

    const result: PendingSignal[] = [];
    for (const key of keys) {
      if (key.includes(':timeline:')) {
        continue;
      }
      const data = await this.redis.hgetall(key);
      if (Object.keys(data).length > 0) {
        result.push(this.mapPending(data));
      }
    }
    return result;
  }

  buildSignalKeyFromIdentifier(identifier: string): string {
    return this.buildSignalKey(identifier);
  }

  private buildSignalIdentifier(signal: SignalMetadata | PendingSignal): string {
    if (signal.id) {
      return signal.id;
    }
    const base = `${signal.pairSymbol}:${signal.timeframe}:${signal.detectedAt}`;
    return base;
  }

  private buildSignalKey(id: string): string {
    return `${DETECTED_KEY_PREFIX}:${id}`;
  }

  private buildPendingKey(id: string): string {
    return `${PENDING_KEY_PREFIX}:${id}`;
  }

  private buildTimelineKey(pairSymbol: string): string {
    return `${TIMELINE_KEY_PREFIX}:${pairSymbol}`;
  }

  private getPendingTimelineKey(pairSymbol: string): string {
    return `${PENDING_KEY_PREFIX}:timeline:${pairSymbol}`;
  }

  private async setPendingExpiry(key: string): Promise<void> {
    if (!this.redis) throw new Error('Redis not initialized');
    await this.redis.expire(key, 60 * 60 * 24);
  }

  private mapSignal(data: Record<string, string>) {
    return {
      id: data.id,
      pairSymbol: data.pairSymbol,
      timeframe: data.timeframe,
      detectedAt: Number(data.detectedAt),
      confirmedAt: data.confirmedAt ? Number(data.confirmedAt) : undefined,
      strategyId: data.strategyId,
      strength: Number(data.strength),
      direction: data.direction,
      entryPrice: Number(data.entryPrice),
      stopLoss: data.stopLoss ? Number(data.stopLoss) : undefined,
      takeProfit: data.takeProfit ? Number(data.takeProfit) : undefined,
      additionalData: data.additionalData ? JSON.parse(data.additionalData) : undefined,
      status: (data.status as PendingSignalStatus) || 'waiting',
      riskScore: data.riskScore ? Number(data.riskScore) : undefined,
      recommendedOrderType: data.recommendedOrderType,
      recommendedSize: data.recommendedSize ? Number(data.recommendedSize) : undefined,
      lastCandleTimestamp: data.lastCandleTimestamp ? Number(data.lastCandleTimestamp) : undefined,
      lastCandlePrice: data.lastCandlePrice ? Number(data.lastCandlePrice) : undefined,
      confirmationTargetPrice: data.confirmationTargetPrice ? Number(data.confirmationTargetPrice) : undefined,
      currentPrice: data.currentPrice ? Number(data.currentPrice) : undefined,
      priceDelta: data.priceDelta ? Number(data.priceDelta) : undefined,
      priceDeltaPct: data.priceDeltaPct ? Number(data.priceDeltaPct) : undefined,
      confirmationExpiresAt: data.confirmationExpiresAt ? Number(data.confirmationExpiresAt) : undefined,
      timeElapsedMs: data.timeElapsedMs ? Number(data.timeElapsedMs) : undefined,
      timeToConfirmMs: data.timeToConfirmMs ? Number(data.timeToConfirmMs) : undefined,
    };
  }

  private mapPending(data: Record<string, string>): PendingSignal {
    return {
      id: data.id,
      pairSymbol: data.pairSymbol,
      timeframe: data.timeframe,
      detectedAt: Number(data.detectedAt),
      strategyId: data.strategyId,
      strength: Number(data.strength),
      direction: data.direction as PendingSignal['direction'],
      entryPrice: Number(data.entryPrice),
      stopLoss: data.stopLoss ? Number(data.stopLoss) : undefined,
      takeProfit: data.takeProfit ? Number(data.takeProfit) : undefined,
      additionalData: data.additionalData ? JSON.parse(data.additionalData) : undefined,
      status: (data.status as PendingSignalStatus) || 'waiting',
      riskScore: data.riskScore ? Number(data.riskScore) : undefined,
      lastUpdatedAt: data.lastUpdatedAt ? Number(data.lastUpdatedAt) : Date.now(),
      recommendedSize: data.recommendedSize ? Number(data.recommendedSize) : undefined,
      confirmationAttempts: data.confirmationAttempts ? Number(data.confirmationAttempts) : undefined,
      maxConfirmationAttempts: data.maxConfirmationAttempts ? Number(data.maxConfirmationAttempts) : undefined,
      confirmWindowSize: data.confirmWindowSize ? Number(data.confirmWindowSize) : undefined,
      lastCandleTimestamp: data.lastCandleTimestamp ? Number(data.lastCandleTimestamp) : undefined,
      lastCandlePrice: data.lastCandlePrice ? Number(data.lastCandlePrice) : undefined,
      confirmationTargetPrice: data.confirmationTargetPrice ? Number(data.confirmationTargetPrice) : undefined,
      currentPrice: data.currentPrice ? Number(data.currentPrice) : undefined,
      priceDelta: data.priceDelta ? Number(data.priceDelta) : undefined,
      priceDeltaPct: data.priceDeltaPct ? Number(data.priceDeltaPct) : undefined,
      confirmationExpiresAt: data.confirmationExpiresAt ? Number(data.confirmationExpiresAt) : undefined,
      timeElapsedMs: data.timeElapsedMs ? Number(data.timeElapsedMs) : undefined,
      timeToConfirmMs: data.timeToConfirmMs ? Number(data.timeToConfirmMs) : undefined,
    };
  }

  async clearAllSignals(): Promise<void> {
    await this.init();
    if (!this.redis) throw new Error('Redis not initialized');

    const patterns = [
      `${PENDING_KEY_PREFIX}:*`,
      `${DETECTED_KEY_PREFIX}:*`,
      `${TIMELINE_KEY_PREFIX}:*`,
      'scanner:cooldown:*',
    ];

    for (const pattern of patterns) {
      const keys = await this.redis.keys(pattern);
      if (keys.length) {
        await this.redis.del(keys);
      }
    }
  }
}

export default new RedisSignalStore();

