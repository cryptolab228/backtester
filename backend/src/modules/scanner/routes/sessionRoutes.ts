import { Router, Request, Response } from 'express';
import { sessionManager } from '../services/SessionManager';
import { AppDataSource } from '@/config/dataSource';
import { TradingSession } from '@/models/TradingSession';
import { SessionTrade } from '@/models/SessionTrade';
import { SessionMetrics } from '@/models/SessionMetrics';
import logger from '@/utils/logger';
// import { Parser } from 'json2csv'; // Временно отключено

const router = Router();
const SESSION_ROUTES_LOG = logger.child({ module: 'SessionRoutes' });

/**
 * GET /api/sessions
 * Список всех торговых сессий с фильтрацией
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { source, mode, strategyVersion, limit = '50', offset = '0' } = req.query;

    const sessionRepo = AppDataSource.getRepository(TradingSession);
    const queryBuilder = sessionRepo.createQueryBuilder('session');

    if (source) {
      queryBuilder.andWhere('session.source = :source', { source });
    }
    if (mode) {
      queryBuilder.andWhere('session.mode = :mode', { mode });
    }
    if (strategyVersion) {
      queryBuilder.andWhere('session.strategyVersion = :strategyVersion', { strategyVersion });
    }

    queryBuilder
      .orderBy('session.startedAt', 'DESC')
      .skip(parseInt(offset as string, 10))
      .take(parseInt(limit as string, 10));

    const [sessions, total] = await queryBuilder.getManyAndCount();

    res.json({
      success: true,
      sessions,
      pagination: {
        total,
        limit: parseInt(limit as string, 10),
        offset: parseInt(offset as string, 10),
      },
    });
  } catch (error: any) {
    SESSION_ROUTES_LOG.error('Failed to fetch sessions', { error: error?.message || error });
    res.status(500).json({ success: false, message: 'Failed to fetch sessions', error: error?.message });
  }
});

/**
 * GET /api/sessions/:id
 * Детали сессии с метриками
 */
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const session = await sessionManager.getSession(id);
    if (!session) {
      res.status(404).json({ success: false, message: 'Session not found' });
      return;
    }

    const metrics = await sessionManager.getSessionMetrics(id);

    res.json({
      success: true,
      session,
      metrics,
    });
  } catch (error: any) {
    SESSION_ROUTES_LOG.error('Failed to fetch session', { error: error?.message || error, sessionId: req.params.id });
    res.status(500).json({ success: false, message: 'Failed to fetch session', error: error?.message });
  }
});

/**
 * GET /api/sessions/:id/trades
 * Список сделок сессии
 */
router.get('/:id/trades', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, limit = '100', offset = '0' } = req.query;

    const tradeRepo = AppDataSource.getRepository(SessionTrade);
    const queryBuilder = tradeRepo.createQueryBuilder('trade')
      .where('trade.sessionId = :sessionId', { sessionId: id });

    if (status) {
      queryBuilder.andWhere('trade.status = :status', { status });
    }

    queryBuilder
      .orderBy('trade.createdAt', 'DESC')
      .skip(parseInt(offset as string, 10))
      .take(parseInt(limit as string, 10));

    const [trades, total] = await queryBuilder.getManyAndCount();

    res.json({
      success: true,
      trades,
      pagination: {
        total,
        limit: parseInt(limit as string, 10),
        offset: parseInt(offset as string, 10),
      },
    });
  } catch (error: any) {
    SESSION_ROUTES_LOG.error('Failed to fetch trades', { error: error?.message || error, sessionId: req.params.id });
    res.status(500).json({ success: false, message: 'Failed to fetch trades', error: error?.message });
  }
});

/**
 * GET /api/sessions/:id/export
 * Экспорт сделок и метрик сессии (JSON или CSV)
 */
router.get('/:id/export', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { format = 'json' } = req.query;

    const session = await sessionManager.getSession(id);
    if (!session) {
      res.status(404).json({ success: false, message: 'Session not found' });
      return;
    }

    const metrics = await sessionManager.getSessionMetrics(id);
    const trades = await sessionManager.getSessionTrades(id);

    const exportData = {
      session: {
        id: session.id,
        source: session.source,
        mode: session.mode,
        strategyVersion: session.strategyVersion,
        strategyParamsHash: session.strategyParamsHash,
        exchange: session.exchange,
        pairs: session.pairs,
        timeframes: session.timeframes,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        status: session.status,
      },
      metrics: metrics ? {
        totalPnl: parseFloat(metrics.totalPnl),
        realizedPnl: parseFloat(metrics.realizedPnl),
        unrealizedPnl: parseFloat(metrics.unrealizedPnl),
        winRatePct: parseFloat(metrics.winRatePct),
        profitFactor: parseFloat(metrics.profitFactor),
        avgTradePnl: parseFloat(metrics.avgTradePnl),
        expectancy: parseFloat(metrics.expectancy),
        tradeCount: metrics.tradeCount,
        winningTrades: metrics.winningTrades,
        losingTrades: metrics.losingTrades,
        maxDrawdownPct: parseFloat(metrics.maxDrawdownPct),
      } : null,
      trades: trades.map(t => ({
        id: t.id,
        pair: t.pair,
        timeframe: t.timeframe,
        signalId: t.signalId,
        entryTimestamp: t.entryTimestamp,
        entryPrice: t.entryPrice ? parseFloat(t.entryPrice) : null,
        exitTimestamp: t.exitTimestamp,
        exitPrice: t.exitPrice ? parseFloat(t.exitPrice) : null,
        exitReason: t.exitReason,
        positionSize: t.positionSize ? parseFloat(t.positionSize) : null,
        leverage: t.leverage ? parseFloat(t.leverage) : null,
        realizedPnl: t.realizedPnl ? parseFloat(t.realizedPnl) : null,
        realizedPnlPct: t.realizedPnlPct ? parseFloat(t.realizedPnlPct) : null,
        stopLoss: t.stopLoss ? parseFloat(t.stopLoss) : null,
        takeProfit: t.takeProfit ? parseFloat(t.takeProfit) : null,
        status: t.status,
      })),
    };

    if (format === 'csv') {
      // CSV экспорт временно отключен
      res.status(501).json({ 
        success: false, 
        message: 'CSV export temporarily disabled. Please use JSON format.' 
      });
      return;
    } else {
      // JSON экспорт
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="session-${id}.json"`);
      res.json(exportData);
    }
  } catch (error: any) {
    SESSION_ROUTES_LOG.error('Failed to export session', { error: error?.message || error, sessionId: req.params.id });
    res.status(500).json({ success: false, message: 'Failed to export session', error: error?.message });
  }
});

/**
 * POST /api/sessions/:id/compare
 * Сравнение двух сессий
 */
router.post('/:id/compare', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { otherSessionId } = req.body;

    if (!otherSessionId) {
      res.status(400).json({ success: false, message: 'otherSessionId is required' });
      return;
    }

    const [baseMetrics, referenceMetrics] = await Promise.all([
      sessionManager.getSessionMetrics(id),
      sessionManager.getSessionMetrics(otherSessionId),
    ]);

    if (!baseMetrics || !referenceMetrics) {
      res.status(404).json({ success: false, message: 'One or both sessions not found' });
      return;
    }

    const calculateDelta = (base: string, ref: string) => {
      const baseNum = parseFloat(base);
      const refNum = parseFloat(ref);
      const abs = baseNum - refNum;
      const pct = refNum !== 0 ? (abs / refNum) * 100 : 0;
      return { abs, pct };
    };

    const delta = {
      totalPnl: calculateDelta(baseMetrics.totalPnl, referenceMetrics.totalPnl),
      winRatePct: { abs: parseFloat(baseMetrics.winRatePct) - parseFloat(referenceMetrics.winRatePct) },
      profitFactor: { abs: parseFloat(baseMetrics.profitFactor) - parseFloat(referenceMetrics.profitFactor) },
      avgTradePnl: calculateDelta(baseMetrics.avgTradePnl, referenceMetrics.avgTradePnl),
      expectancy: calculateDelta(baseMetrics.expectancy, referenceMetrics.expectancy),
      maxDrawdownPct: { abs: parseFloat(baseMetrics.maxDrawdownPct) - parseFloat(referenceMetrics.maxDrawdownPct) },
      tradeCount: { abs: baseMetrics.tradeCount - referenceMetrics.tradeCount },
    };

    // Определяем значимость отклонения
    const significant = 
      Math.abs(delta.winRatePct.abs) > 5 ||
      Math.abs(delta.profitFactor.abs) > 0.5 ||
      Math.abs(delta.totalPnl.pct) > 20;

    res.json({
      success: true,
      base: {
        sessionId: id,
        totalPnl: parseFloat(baseMetrics.totalPnl),
        winRatePct: parseFloat(baseMetrics.winRatePct),
        profitFactor: parseFloat(baseMetrics.profitFactor),
        avgTradePnl: parseFloat(baseMetrics.avgTradePnl),
        expectancy: parseFloat(baseMetrics.expectancy),
        tradeCount: baseMetrics.tradeCount,
      },
      reference: {
        sessionId: otherSessionId,
        totalPnl: parseFloat(referenceMetrics.totalPnl),
        winRatePct: parseFloat(referenceMetrics.winRatePct),
        profitFactor: parseFloat(referenceMetrics.profitFactor),
        avgTradePnl: parseFloat(referenceMetrics.avgTradePnl),
        expectancy: parseFloat(referenceMetrics.expectancy),
        tradeCount: referenceMetrics.tradeCount,
      },
      delta,
      significant,
      notes: [
        significant ? 'Significant differences detected' : 'Metrics are similar',
      ],
    });
  } catch (error: any) {
    SESSION_ROUTES_LOG.error('Failed to compare sessions', { error: error?.message || error });
    res.status(500).json({ success: false, message: 'Failed to compare sessions', error: error?.message });
  }
});

/**
 * POST /api/sessions/:id/notes
 * Добавление заметок к сессии
 */
router.post('/:id/notes', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    if (!notes) {
      res.status(400).json({ success: false, message: 'notes is required' });
      return;
    }

    const sessionRepo = AppDataSource.getRepository(TradingSession);
    await sessionRepo.update(id, { notes });

    res.json({ success: true, message: 'Notes updated' });
  } catch (error: any) {
    SESSION_ROUTES_LOG.error('Failed to update notes', { error: error?.message || error, sessionId: req.params.id });
    res.status(500).json({ success: false, message: 'Failed to update notes', error: error?.message });
  }
});

/**
 * POST /api/sessions/:id/end
 * Завершение сессии вручную
 */
router.post('/:id/end', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { status = 'completed', notes } = req.body;

    await sessionManager.endSession(id, status, notes);

    res.json({ success: true, message: 'Session ended' });
  } catch (error: any) {
    SESSION_ROUTES_LOG.error('Failed to end session', { error: error?.message || error, sessionId: req.params.id });
    res.status(500).json({ success: false, message: 'Failed to end session', error: error?.message });
  }
});

export default router;

