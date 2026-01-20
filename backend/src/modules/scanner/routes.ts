import { Router, Request, Response } from 'express';

import logger from '@/utils/logger';
import RedisSignalStore from '@/services/RedisSignalStore';
import type { PendingSignal } from './scanner.types';

import portfolioAllocator from './portfolioAllocator';
import scannerConfigService from './scannerConfig.service';
import { executionManager as sharedExecutionManager, MultiModeExecutionAdapter } from './adapters';
import { getScannerInstance, bootstrapScanner, stopScanner as stopScannerSingleton, getTestnetManager, getDemoManager } from './scanner.bootstrap';
import signalQueue from './signalQueue';
import { confirmationQueueManager } from './confirmationQueue';
import { healthMonitor } from './healthMonitor';
import { getPairMetrics } from './statisticsService';
import { scannerSessionController } from './scanner.session.controller';
import { sessionManager } from './services/SessionManager';

const router = Router();
const ROUTER_LOG = logger.child({ module: 'ScannerRoutes' });

const toNumber = (value: string | number | null | undefined): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const toSide = (direction?: string | null): 'Buy' | 'Sell' => {
  return direction && direction.toLowerCase() === 'long' ? 'Buy' : 'Sell';
};

router.get('/status', async (_req: Request, res: Response): Promise<void> => {
  const runtime = scannerConfigService.getConfig();
  const scanner = getScannerInstance();
  const pending = await signalQueue.getPendingSignals();
  const confirmationStats = await confirmationQueueManager.getStats();
  const health = healthMonitor.getSnapshot();
  const portfolio = await portfolioAllocator.getState();
  const currentSessionId = sessionManager.getCurrentSessionId();

  res.json({
    ...runtime,
    running: !!scanner,
    pendingCount: pending.length,
    confirmationQueue: confirmationStats,
    health,
    availableCapital: portfolio.availableCapital,
    sessionId: currentSessionId,
  });
});

router.get('/health', async (_req: Request, res: Response): Promise<void> => {
  res.json(healthMonitor.getSnapshot());
});

router.post('/start', async (_req: Request, res: Response): Promise<void> => {
  const scanner = getScannerInstance();
  if (scanner) {
    res.status(409).json({ message: 'Scanner already running' });
    return;
  }

  const runtime = scannerConfigService.getConfig();
  if (!runtime.enabled) {
    res.status(400).json({ message: 'Scanner disabled in settings' });
    return;
  }

  ROUTER_LOG.info('Starting scanner via API');
  await bootstrapScanner();
  res.json({ message: 'Scanner start requested' });
});

router.post('/stop', async (_req: Request, res: Response): Promise<void> => {
  const scanner = getScannerInstance();
  if (!scanner) {
    res.status(409).json({ message: 'Scanner not running' });
    return;
  }

  ROUTER_LOG.info('Stopping scanner via API');
  stopScannerSingleton();
  res.json({ message: 'Scanner stop requested' });
});

router.post('/reset', async (_req: Request, res: Response): Promise<void> => {
  try {
    stopScannerSingleton();
    await signalQueue.clearAll();
    await portfolioAllocator.resetState();
    await sharedExecutionManager.clearAll?.();
    await sharedExecutionManager.broadcastSnapshot?.();
    res.json({ message: 'Scanner reset completed' });
  } catch (error: any) {
    ROUTER_LOG.error('Failed to reset scanner state', error);
    res.status(500).json({ message: error?.message || 'Failed to reset scanner state' });
  }
});

const normalizePendingSignal = (signal: PendingSignal) => {
  const now = Date.now();
  const confirmationExpiresAt = typeof signal.confirmationExpiresAt === 'number'
    ? signal.confirmationExpiresAt
    : signal.detectedAt + (signal.timeToConfirmMs ?? 0);
  const timeElapsedMs = typeof signal.timeElapsedMs === 'number'
    ? signal.timeElapsedMs
    : Math.max(now - signal.detectedAt, 0);
  const timeToConfirmMs = typeof signal.timeToConfirmMs === 'number'
    ? signal.timeToConfirmMs
    : Math.max((confirmationExpiresAt ?? now) - now, 0);

  return {
    ...signal,
    lastCandleTimestamp: signal.lastCandleTimestamp ?? null,
    lastCandlePrice: signal.lastCandlePrice ?? null,
    confirmationTargetPrice: signal.confirmationTargetPrice ?? null,
    currentPrice: signal.currentPrice ?? null,
    priceDelta: signal.priceDelta ?? null,
    priceDeltaPct: signal.priceDeltaPct ?? null,
    confirmationExpiresAt: confirmationExpiresAt ?? null,
    timeElapsedMs,
    timeToConfirmMs,
  };
};

router.get('/signals', async (req: Request, res: Response): Promise<void> => {
  const { pairSymbol } = req.query as { pairSymbol?: string };
  const pendingSignals = await signalQueue.getPendingSignals(pairSymbol);
  const pending = pendingSignals
    .filter((signal) => signal.status === 'waiting')
    .map((signal) => normalizePendingSignal(signal));
  const detected = pairSymbol ? await RedisSignalStore.getRecentSignals(pairSymbol) : [];

  res.json({ pending, detected });
});

router.get('/executions', async (req: Request, res: Response): Promise<void> => {
  const limit = req.query.limit ? Number(req.query.limit) : 50;
  const requestedSessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined;
  const currentSessionId = requestedSessionId || sessionManager.getCurrentSessionId();

  if (!currentSessionId) {
    res.json({
      executions: [],
      openPositions: [],
      mode: scannerConfigService.getConfig().executionMode,
      sessionId: null,
    });
    return;
  }

  const executions = await sharedExecutionManager.getExecutionsBySession(currentSessionId, limit);
  const openPositions = await sharedExecutionManager.getOpenPositionsBySession(currentSessionId);

  res.json({
    executions,
    openPositions,
    mode: scannerConfigService.getConfig().executionMode,
    sessionId: currentSessionId,
  });
});

router.get('/sessions/:id/executions', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const limit = req.query.limit ? Number(req.query.limit) : 100;

  try {
    const trades = await sessionManager.getSessionTrades(id, 'closed');

    if (!trades.length) {
      res.json({
        success: true,
        sessionId: id,
        executions: [],
        count: 0,
      });
      return;
    }

    const sorted = trades
      .sort((a, b) => {
        const aTime = a.exitTimestamp?.getTime() ?? a.createdAt.getTime();
        const bTime = b.exitTimestamp?.getTime() ?? b.createdAt.getTime();
        return bTime - aTime;
      })
      .slice(0, limit);

    const executions = sorted.map((trade) => {
      const entryPrice = toNumber(trade.entryPrice);
      const exitPrice = toNumber(trade.exitPrice);
      const size = toNumber(trade.positionSize);
      const pnl = toNumber(trade.realizedPnl);
      const pnlPct = toNumber(trade.realizedPnlPct);

      return {
        id: trade.id,
        orderLinkId: trade.orderLinkId,
        pair: trade.pair,
        timeframe: trade.timeframe,
        direction: trade.direction,
        entryTimestamp: trade.entryTimestamp?.toISOString() ?? trade.createdAt.toISOString(),
        exitTimestamp: trade.exitTimestamp?.toISOString() ?? null,
        entryPrice,
        exitPrice,
        size,
        leverage: toNumber(trade.leverage),
        pnl,
        pnlPct,
        stopLoss: toNumber(trade.stopLoss),
        takeProfit: toNumber(trade.takeProfit),
        extra: trade.extra,
      };
    });

    res.json({
      success: true,
      sessionId: id,
      executions,
      count: executions.length,
    });
  } catch (error: any) {
    ROUTER_LOG.error('Failed to fetch session executions', { error: error?.message || error, sessionId: id });
    res.status(500).json({ success: false, message: 'Failed to fetch session executions', error: error?.message });
  }
});

router.get('/sessions/:id/exchange-history', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { limit = '100' } = req.query as { limit?: string };
  const numericLimit = Number(limit);

  try {
    const trades = await sessionManager.getSessionTrades(id);

    if (!trades.length) {
      res.json({
        success: true,
        sessionId: id,
        orders: [],
        trades: [],
        closedPnl: [],
        totals: {
          totalClosedPnl: 0,
          closedPositions: 0,
        },
      });
      return;
    }

    const orders = trades.flatMap((trade) => {
      const external = trade.extra?.external;
      const orderIds: string[] = Array.isArray(external?.orders)
        ? external.orders.map((value: any) => String(value))
        : [];

      if (orderIds.length === 0) {
        return [];
      }

      return orderIds.map((orderId) => ({
        orderId,
        orderLinkId: trade.orderLinkId,
        symbol: trade.pair,
        side: toSide(trade.direction),
        qty: toNumber(trade.positionSize),
        price: toNumber(trade.entryPrice),
        status: trade.status === 'closed' ? 'Filled' : 'Open',
        createdAt: trade.entryTimestamp?.toISOString() ?? trade.createdAt.toISOString(),
      }));
    });

    const tradeExecutions = trades.flatMap((trade) => {
      const legs = Array.isArray(trade.extra?.legs) ? trade.extra?.legs : [];
      if (!legs.length) {
        return [];
      }

      return legs.map((leg: any) => ({
        tradeId: trade.id,
        symbol: trade.pair,
        side: toSide(trade.direction),
        execQty: toNumber(leg.size),
        execPrice: toNumber(leg.entryPrice),
        execId: leg.id,
        executionTime: leg.confirmedAt ? new Date(leg.confirmedAt).toISOString() : trade.entryTimestamp?.toISOString() ?? trade.createdAt.toISOString(),
      }));
    });

    const closedTrades = trades
      .filter((trade) => trade.status === 'closed')
      .sort((a, b) => {
        const aTime = a.exitTimestamp?.getTime() ?? a.updatedAt.getTime();
        const bTime = b.exitTimestamp?.getTime() ?? b.updatedAt.getTime();
        return bTime - aTime;
      });

    const limitedClosedTrades = Number.isFinite(numericLimit) && numericLimit > 0
      ? closedTrades.slice(0, numericLimit)
      : closedTrades;

    const closedPnl = limitedClosedTrades.map((trade) => ({
      tradeId: trade.id,
      symbol: trade.pair,
      side: toSide(trade.direction),
      qty: toNumber(trade.positionSize),
      avgEntryPrice: toNumber(trade.entryPrice),
      avgExitPrice: toNumber(trade.exitPrice),
      leverage: toNumber(trade.leverage),
      closedPnl: toNumber(trade.realizedPnl),
      closedPnlPct: toNumber(trade.realizedPnlPct),
      updatedTime: trade.exitTimestamp?.getTime() ?? trade.updatedAt.getTime(),
      exitReason: trade.exitReason,
    }));

    const totalClosedPnl = closedTrades.reduce((acc, trade) => {
      const pnl = toNumber(trade.realizedPnl) ?? 0;
      return acc + pnl;
    }, 0);

    res.json({
      success: true,
      sessionId: id,
      orders,
      trades: tradeExecutions,
      closedPnl,
      totals: {
        totalClosedPnl,
        closedPositions: closedTrades.length,
      },
    });
  } catch (error: any) {
    ROUTER_LOG.error('Failed to fetch session exchange history', { error: error?.message || error, sessionId: id });
    res.status(500).json({ success: false, message: 'Failed to fetch session exchange history', error: error?.message });
  }
});

router.post('/executions/:id/close', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { exitPrice, exitReason } = req.body as { exitPrice?: number; exitReason?: 'take_profit' | 'stop_loss' | 'manual' };

  if (typeof exitPrice !== 'number' || Number.isNaN(exitPrice)) {
    res.status(400).json({ message: 'exitPrice must be a number' });
    return;
  }

  const reason = exitReason ?? 'manual';
  const closed = await sharedExecutionManager.closePosition(id, { exitPrice, exitAt: Date.now(), exitReason: reason });
  if (!closed) {
    res.status(404).json({ message: 'Position not found or already closed' });
    return;
  }

  res.json({ position: closed });
});

// Получение позиций с биржи
router.get('/exchange-positions', async (req: Request, res: Response): Promise<void> => {
  const { symbol } = req.query as { symbol?: string };
  const mode = scannerConfigService.getConfig().executionMode;

  try {
    let positions: any[] = [];

    if (mode === 'demo') {
      const demoManager = getDemoManager();
      if (demoManager) {
        positions = await demoManager.getExchangePositions(symbol);
      } else {
        res.status(503).json({ message: 'Demo manager not initialized' });
        return;
      }
    } else if (mode === 'testnet') {
      const testnetManager = getTestnetManager();
      if (testnetManager) {
        positions = await testnetManager.getExchangePositions(symbol);
      } else {
        res.status(503).json({ message: 'Testnet manager not initialized' });
        return;
      }
    } else {
      res.status(400).json({ message: 'Exchange positions only available in demo/testnet mode' });
      return;
    }

    res.json({ success: true, positions, mode, count: positions.length });
  } catch (error: any) {
    ROUTER_LOG.error('Failed to fetch exchange positions', { error: error?.message || error });
    res.status(500).json({ message: 'Failed to fetch positions', error: error?.message });
  }
});

// Закрытие позиции на бирже
router.post('/executions/:id/close-exchange', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const mode = scannerConfigService.getConfig().executionMode;

  try {
    // Получаем информацию о позиции из Redis
    const position = await sharedExecutionManager.getOpenPositions().then(positions => 
      positions.find(p => p.id === id)
    );

    if (!position) {
      res.status(404).json({ message: 'Position not found' });
      return;
    }

    const symbol = position.pairSymbol;
    const positionIdx = position.external?.positionIdx || 0;
    let success = false;

    if (mode === 'demo') {
      const demoManager = getDemoManager();
      if (demoManager) {
        success = await demoManager.closeExchangePosition(symbol, positionIdx);
      } else {
        res.status(503).json({ message: 'Demo manager not initialized' });
        return;
      }
    } else if (mode === 'testnet') {
      const testnetManager = getTestnetManager();
      if (testnetManager) {
        success = await testnetManager.closeExchangePosition(symbol, positionIdx);
      } else {
        res.status(503).json({ message: 'Testnet manager not initialized' });
        return;
      }
    } else {
      res.status(400).json({ message: 'Exchange close only available in demo/testnet mode' });
      return;
    }

    if (success) {
      // Закрываем позицию в Redis (используем текущую цену как exitPrice)
      const exitPrice = position.external?.markPrice || position.entryPrice;
      const closed = await sharedExecutionManager.closePosition(id, {
        exitPrice,
        exitAt: Date.now(),
        exitReason: 'manual',
      });

      res.json({ 
        success: true, 
        position: closed,
        message: 'Position closed on exchange and in system',
      });
    } else {
      res.status(500).json({ message: 'Failed to close position on exchange' });
    }
  } catch (error: any) {
    ROUTER_LOG.error('Failed to close position on exchange', { error: error?.message || error });
    res.status(500).json({ message: 'Failed to close position', error: error?.message });
  }
});

// Получение истории ордеров с биржи
router.get('/exchange-orders', async (req: Request, res: Response): Promise<void> => {
  const { symbol, limit, startTime, endTime } = req.query as { 
    symbol?: string; 
    limit?: string; 
    startTime?: string; 
    endTime?: string; 
  };
  const mode = scannerConfigService.getConfig().executionMode;

  try {
    let orders: any[] = [];

    const params = {
      symbol,
      limit: limit ? parseInt(limit, 10) : 50,
      startTime: startTime ? parseInt(startTime, 10) : undefined,
      endTime: endTime ? parseInt(endTime, 10) : undefined,
    };

    if (mode === 'demo') {
      const demoManager = getDemoManager();
      if (demoManager) {
        orders = await demoManager.getOrderHistory(params);
      } else {
        res.status(503).json({ message: 'Demo manager not initialized' });
        return;
      }
    } else if (mode === 'testnet') {
      const testnetManager = getTestnetManager();
      if (testnetManager) {
        orders = await testnetManager.getOrderHistory(params);
      } else {
        res.status(503).json({ message: 'Testnet manager not initialized' });
        return;
      }
    } else {
      res.status(400).json({ message: 'Order history only available in demo/testnet mode' });
      return;
    }

    res.json({ success: true, orders, mode, count: orders.length });
  } catch (error: any) {
    ROUTER_LOG.error('Failed to fetch order history', { error: error?.message || error });
    res.status(500).json({ message: 'Failed to fetch order history', error: error?.message });
  }
});

// Получение истории сделок с биржи
router.get('/exchange-trades', async (req: Request, res: Response): Promise<void> => {
  const { symbol, limit, startTime, endTime } = req.query as { 
    symbol?: string; 
    limit?: string; 
    startTime?: string; 
    endTime?: string; 
  };
  const mode = scannerConfigService.getConfig().executionMode;

  try {
    let trades: any[] = [];

    const params = {
      symbol,
      limit: limit ? parseInt(limit, 10) : 50,
      startTime: startTime ? parseInt(startTime, 10) : undefined,
      endTime: endTime ? parseInt(endTime, 10) : undefined,
    };

    if (mode === 'demo') {
      const demoManager = getDemoManager();
      if (demoManager) {
        trades = await demoManager.getTradeHistory(params);
      } else {
        res.status(503).json({ message: 'Demo manager not initialized' });
        return;
      }
    } else if (mode === 'testnet') {
      const testnetManager = getTestnetManager();
      if (testnetManager) {
        trades = await testnetManager.getTradeHistory(params);
      } else {
        res.status(503).json({ message: 'Testnet manager not initialized' });
        return;
      }
    } else {
      res.status(400).json({ message: 'Trade history only available in demo/testnet mode' });
      return;
    }

    res.json({ success: true, trades, mode, count: trades.length });
  } catch (error: any) {
    ROUTER_LOG.error('Failed to fetch trade history', { error: error?.message || error });
    res.status(500).json({ message: 'Failed to fetch trade history', error: error?.message });
  }
});

// Получение закрытого PnL с биржи
router.get('/exchange-closed-pnl', async (req: Request, res: Response): Promise<void> => {
  const { symbol, limit, startTime, endTime } = req.query as { 
    symbol?: string; 
    limit?: string; 
    startTime?: string; 
    endTime?: string; 
  };
  const mode = scannerConfigService.getConfig().executionMode;

  try {
    const sessionId = sessionManager.getCurrentSessionId();
    const sessionStartedAt = sessionId ? await sessionManager.getSession(sessionId).then((s) => s?.startedAt ?? s?.createdAt ?? null) : null;
    let closedPnL: any[] = [];

    const params = {
      symbol,
      limit: limit ? parseInt(limit, 10) : 50,
      startTime: startTime ? parseInt(startTime, 10) : undefined,
      endTime: endTime ? parseInt(endTime, 10) : undefined,
    };

    if (mode === 'demo') {
      const demoManager = getDemoManager();
      if (demoManager) {
        closedPnL = await demoManager.getClosedPnL(params);
      } else {
        res.status(503).json({ message: 'Demo manager not initialized' });
        return;
      }
    } else if (mode === 'testnet') {
      const testnetManager = getTestnetManager();
      if (testnetManager) {
        closedPnL = await testnetManager.getClosedPnL(params);
      } else {
        res.status(503).json({ message: 'Testnet manager not initialized' });
        return;
      }
    } else {
      res.status(400).json({ message: 'Closed PnL only available in demo/testnet mode' });
      return;
    }

    if (sessionStartedAt) {
      const sessionStartTs = new Date(sessionStartedAt).getTime();
      closedPnL = closedPnL.filter((item) => {
        const closeTime = Number(item.updatedTime ?? item.closedTime ?? item.execTime ?? item.timestamp);
        return Number.isFinite(closeTime) && closeTime >= sessionStartTs;
      });
    }

    // Подсчитываем суммарный PnL
    const totalPnL = closedPnL.reduce((sum, item) => {
      const pnl = parseFloat(item.closedPnl || '0');
      return sum + (Number.isFinite(pnl) ? pnl : 0);
    }, 0);

    res.json({ 
      success: true,
      closedPnL, 
      mode, 
      count: closedPnL.length,
      totalClosedPnL: totalPnL,
    });
  } catch (error: any) {
    ROUTER_LOG.error('Failed to fetch closed PnL', { error: error?.message || error });
    res.status(500).json({ message: 'Failed to fetch closed PnL', error: error?.message });
  }
});

// Получение суммарного PnL (реализованный + нереализованный)
router.get('/total-pnl', async (req: Request, res: Response): Promise<void> => {
  const { symbol } = req.query as { symbol?: string };
  const mode = scannerConfigService.getConfig().executionMode;

  try {
    let pnlData: any;

    if (mode === 'demo') {
      const demoManager = getDemoManager();
      if (demoManager) {
        pnlData = await demoManager.calculateTotalPnL(symbol);
      } else {
        res.status(503).json({ message: 'Demo manager not initialized' });
        return;
      }
    } else if (mode === 'testnet') {
      const testnetManager = getTestnetManager();
      if (testnetManager) {
        pnlData = await testnetManager.calculateTotalPnL(symbol);
      } else {
        res.status(503).json({ message: 'Testnet manager not initialized' });
        return;
      }
    } else {
      res.status(400).json({ message: 'PnL calculation only available in demo/testnet mode' });
      return;
    }

    res.json({ 
      success: true,
      ...pnlData,
      mode,
      symbol: symbol || 'all',
    });
  } catch (error: any) {
    ROUTER_LOG.error('Failed to calculate total PnL', { error: error?.message || error });
    res.status(500).json({ message: 'Failed to calculate total PnL', error: error?.message });
  }
});

router.get('/portfolio', async (_req: Request, res: Response): Promise<void> => {
  const state = await portfolioAllocator.getState();
  res.json(state);
});

router.get('/pair-metrics', async (req: Request, res: Response): Promise<void> => {
  try {
    const { exchange, metric, period } = req.query as { exchange?: string; metric?: string; period?: string };

    if (!exchange || (exchange !== 'bybit' && exchange !== 'okx')) {
      res.status(400).json({ message: 'exchange must be one of bybit, okx' });
      return;
    }

    if (!metric || (metric !== 'volume' && metric !== 'volatility')) {
      res.status(400).json({ message: 'metric must be volume or volatility' });
      return;
    }

    const numericPeriod = period ? Number(period) : 7;
    if (![7, 14, 30].includes(numericPeriod)) {
      res.status(400).json({ message: 'period must be 7, 14 or 30 days' });
      return;
    }

    const result = await getPairMetrics({ exchange, metric, period: numericPeriod as 7 | 14 | 30 });
    res.json(result);
  } catch (error: any) {
    ROUTER_LOG.error('Failed to load pair metrics', error);
    res.status(500).json({ message: error?.message || 'Failed to load pair metrics' });
  }
});

router.get('/settings', (_req: Request, res: Response): void => {
  res.json(scannerConfigService.getConfig());
});

router.put('/settings', async (req: Request, res: Response): Promise<void> => {
  try {
    const updated = await scannerConfigService.updateConfig(req.body || {});
    res.json(updated);
  } catch (error: any) {
    ROUTER_LOG.error('Failed to update scanner settings', error);
    res.status(400).json({ message: error.message || 'Failed to update settings' });
  }
});

router.post('/settings/recommended', async (_req: Request, res: Response): Promise<void> => {
  try {
    const updated = await scannerConfigService.applyRecommendedDefaults();
    res.json(updated);
  } catch (error: any) {
    ROUTER_LOG.error('Failed to apply recommended settings', error);
    res.status(500).json({ message: error.message || 'Failed to apply recommended settings' });
  }
});

router.post('/cancel', async (req: Request, res: Response): Promise<void> => {
  const { signalId } = req.body as { signalId?: string };
  if (!signalId) {
    res.status(400).json({ message: 'signalId is required' });
    return;
  }

  const pending = await signalQueue.get(signalId);
  if (!pending) {
    await RedisSignalStore.cancelByKey(RedisSignalStore.buildSignalKeyFromIdentifier(signalId), 'cancelled_by_user');
    res.status(404).json({ message: 'Signal not found or already processed' });
    return;
  }

  await signalQueue.markAsCancelled(signalId, 'cancelled_by_user');
  await RedisSignalStore.cancelByKey(RedisSignalStore.buildSignalKeyFromIdentifier(signalId), 'cancelled_by_user');
  res.json({ message: 'Signal cancelled', signalId });
});

router.get('/modes', (_req: Request, res: Response): void => {
  const runtime = scannerConfigService.getConfig();
  const adapter = new MultiModeExecutionAdapter(sharedExecutionManager, { mode: runtime.executionMode });
  res.json({ mode: adapter.mode, supported: ['dry-run', 'paper', 'shadow', 'testnet', 'demo', 'live'] });
});

// ========================================
// Session Management Routes (NEW)
// ========================================

// Список всех сессий
router.get('/sessions', scannerSessionController.listSessions.bind(scannerSessionController));

// Создание новой сессии (без запуска сканера)
router.post('/sessions', scannerSessionController.createSession.bind(scannerSessionController));

// Получение активной сессии
router.get('/sessions/active', scannerSessionController.getActiveSession.bind(scannerSessionController));

// Получение детальной информации о сессии
router.get('/sessions/:id', scannerSessionController.getSession.bind(scannerSessionController));

// Удаление сессии
router.delete('/sessions/:id', scannerSessionController.deleteSession.bind(scannerSessionController));

// Получение метрик для сессии
router.get('/sessions/:id/metrics', scannerSessionController.getSessionMetrics.bind(scannerSessionController));

// Получение сделок для сессии
router.get('/sessions/:id/trades', scannerSessionController.getSessionTrades.bind(scannerSessionController));

// Запуск сканера с выбранной сессией
router.post('/start/:sessionId', scannerSessionController.startScanner.bind(scannerSessionController));

// Остановка сканера и завершение сессии
router.post('/stop', scannerSessionController.stopScanner.bind(scannerSessionController));

// Принудительное завершение сессии
router.post('/sessions/:id/end', scannerSessionController.forceEndSession.bind(scannerSessionController));

// Статус сканера (idle/running/stopped)
router.get('/scanner-status', scannerSessionController.getStatus.bind(scannerSessionController));

export default router;

