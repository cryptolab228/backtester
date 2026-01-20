import { Request, Response } from 'express';
import { sessionManager } from './services/SessionManager';
import { startScannerWithSession, stopScannerAndEndSession, getScannerStatus, getScannerInstance, getDemoManager, getTestnetManager } from './scanner.bootstrap';
import config from '@/config';
import { executionManager } from './adapters';
import logger from '@/utils/logger';
import { DefaultStrategyParameters } from '../strategy_logic/strategy';
import { BybitDemoExecutionManager } from './bybitDemoExecutionManager';
import { BybitTestnetExecutionManager } from './bybitTestnetExecutionManager';

const SESSION_CTRL_LOG = logger.child({ module: 'ScannerSessionController' });

/**
 * Контроллер для управления сессиями сканера
 */
export class ScannerSessionController {
  /**
   * GET /api/scanner/sessions
   * Список всех сессий (для выбора пользователем)
   */
  async listSessions(req: Request, res: Response): Promise<void> {
    try {
      const { status, mode, limit = 50, offset = 0 } = req.query;

      const sessions = await sessionManager.listSessions({
        source: 'scanner',
        status: status as any,
        mode: mode as any,
        limit: Number(limit),
        offset: Number(offset),
      });

      res.json({
        success: true,
        data: sessions,
        count: sessions.length,
      });
    } catch (error) {
      SESSION_CTRL_LOG.error('Failed to list sessions', { error: (error as Error)?.message || error });
      res.status(500).json({
        success: false,
        error: 'Failed to list sessions',
        message: (error as Error)?.message,
      });
    }
  }

  /**
   * POST /api/scanner/sessions
   * Создание новой сессии (БЕЗ запуска сканера)
   */
  async createSession(req: Request, res: Response): Promise<void> {
    try {
      SESSION_CTRL_LOG.info('Creating session with body:', req.body); // Логируем входящий запрос

      const { name, mode, notes, exchange } = req.body;
      
      // Поддержка различных форматов передачи пар
      let inputPairs = req.body.pairs || req.body.tradingPairs || [];
      let inputTimeframes = req.body.timeframes || [];

      // Нормализация данных
      const pairs: string[] = [];
      const timeframesSet = new Set<string>();
      const detailedPairs: { symbol: string; timeframes: string[] }[] = [];

      if (Array.isArray(inputPairs)) {
        inputPairs.forEach((p: any) => {
          if (typeof p === 'string') {
            // Простой формат: ['BTCUSDT', 'ETHUSDT']
            pairs.push(p);
            // Если таймфреймы переданы отдельно глобально
            if (Array.isArray(inputTimeframes)) {
               detailedPairs.push({ symbol: p, timeframes: inputTimeframes });
               inputTimeframes.forEach((tf: string) => timeframesSet.add(tf));
            } else {
               // Фолбэк
               detailedPairs.push({ symbol: p, timeframes: ['1h'] }); // Default
               timeframesSet.add('1h');
            }
          } else if (typeof p === 'object' && p.symbol) {
            // Сложный формат: [{ symbol: 'BTCUSDT', timeframes: ['1h', '15m'] }]
            pairs.push(p.symbol);
            const tfs = Array.isArray(p.timeframes) ? p.timeframes : (Array.isArray(inputTimeframes) ? inputTimeframes : ['1h']);
            detailedPairs.push({ symbol: p.symbol, timeframes: tfs });
            tfs.forEach((tf: string) => timeframesSet.add(tf));
          }
        });
      }

      // Если timeframes не были извлечены из объектов пар, пробуем взять глобальные или дефолт
      if (timeframesSet.size === 0) {
         if (Array.isArray(inputTimeframes) && inputTimeframes.length > 0) {
             inputTimeframes.forEach((tf: string) => timeframesSet.add(tf));
         } else {
             timeframesSet.add('1h');
         }
      }

      const timeframes = Array.from(timeframesSet);

      if (!name) {
        res.status(400).json({
          success: false,
          error: 'Missing required field: name',
        });
        return;
      }

      // ИСПРАВЛЕНО: Используем executionMode из config, если mode не передан
      const effectiveMode = mode || config.scanner.executionMode;

      const session = await sessionManager.createSession({
        source: 'scanner',
        mode: effectiveMode,
        strategyVersion: '1.0.0',
        strategyParams: DefaultStrategyParameters,
        exchange: exchange || 'bybit',
        pairs: pairs,
        timeframes: timeframes,
        portfolioMode: false,
        configSnapshot: {
          name,
          pairs: pairs,
          timeframes: timeframes,
          tradingPairs: detailedPairs, // Сохраняем детальную структуру
          mode: effectiveMode,
        },
        riskSettingsSnapshot: DefaultStrategyParameters.risk,
        notes: notes || undefined,
        name,
        createdBy: 'user',
      });

      if (!sessionManager.getCurrentSessionId() && typeof executionManager.clearAll === 'function') {
        await executionManager.clearAll();
      }

      SESSION_CTRL_LOG.info('Session created by user', {
        sessionId: session.id,
        name,
        pairs: pairs || 'default',
        mode: effectiveMode,
      });

      res.json({
        success: true,
        data: session,
      });
    } catch (error) {
      SESSION_CTRL_LOG.error('Failed to create session', { error: (error as Error)?.message || error });
      res.status(500).json({
        success: false,
        error: 'Failed to create session',
        message: (error as Error)?.message,
      });
    }
  }

  /**
   * POST /api/scanner/start/:sessionId
   * Запуск сканера с выбранной сессией
   */
  async startScanner(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId } = req.params;
      const safeSessionId = String(sessionId);

      const currentStatus = getScannerStatus();
      if (currentStatus === 'running') {
        res.status(400).json({
          success: false,
          error: 'Scanner is already running',
          currentSessionId: sessionManager.getCurrentSessionId(),
        });
        return;
      }

      const session = await sessionManager.getSession(safeSessionId);
      if (!session) {
        res.status(404).json({
          success: false,
          error: 'Session not found',
        });
        return;
      }

      if (session.status !== 'running') {
        // Обновить статус сессии на 'running'
        await sessionManager.reopenSession(safeSessionId);
      }

      await startScannerWithSession(safeSessionId);

      SESSION_CTRL_LOG.info('Scanner started with session', {
        sessionId: safeSessionId,
        name: session.configSnapshot?.name,
      });

      res.json({
        success: true,
        data: {
          status: 'running',
          sessionId: safeSessionId,
          session,
        },
      });
    } catch (error) {
      SESSION_CTRL_LOG.error('Failed to start scanner', {
        error: (error as Error)?.message || error,
        sessionId: req.params.sessionId,
      });
      res.status(500).json({
        success: false,
        error: 'Failed to start scanner',
        message: (error as Error)?.message,
      });
    }
  }

  /**
   * POST /api/scanner/stop
   * Остановка сканера и завершение текущей сессии
   */
  async stopScanner(req: Request, res: Response): Promise<void> {
    try {
      const { forceClose = false } = req.body;

      const currentStatus = getScannerStatus();
      if (currentStatus !== 'running') {
        res.status(400).json({
          success: false,
          error: 'Scanner is not running',
        });
        return;
      }

      const sessionId = sessionManager.getCurrentSessionId();
      const openPositions = sessionId
        ? await executionManager.getOpenPositionsBySession(sessionId)
        : [];

      if (openPositions.length > 0 && !forceClose) {
        res.status(400).json({
          success: false,
          error: 'Cannot stop scanner with open positions',
          openPositionsCount: openPositions.length,
          openPositions: openPositions.map((p) => ({
            pair: p.pairSymbol,
            direction: p.direction,
            size: p.size,
          })),
          hint: 'Send forceClose: true to close all positions and stop',
        });
        return;
      }

      await stopScannerAndEndSession();

      SESSION_CTRL_LOG.info('Scanner stopped by user', {
        sessionId,
        closedPositions: openPositions.length,
      });

      res.json({
        success: true,
        data: {
          status: 'stopped',
          sessionId,
          closedPositions: openPositions.length,
        },
      });
    } catch (error) {
      SESSION_CTRL_LOG.error('Failed to stop scanner', { error: (error as Error)?.message || error });
      res.status(500).json({
        success: false,
        error: 'Failed to stop scanner',
        message: (error as Error)?.message,
      });
    }
  }

  /**
   * GET /api/scanner/sessions/active
   * Получение текущей активной сессии
   */
  async getActiveSession(req: Request, res: Response): Promise<void> {
    try {
      const sessionId = sessionManager.getCurrentSessionId();
      if (!sessionId) {
        res.json({
          success: true,
          data: null,
        });
        return;
      }

      const session = await sessionManager.getSession(sessionId);
      const metrics = await sessionManager.getSessionMetrics(sessionId);
      
      // ИСПРАВЛЕНО: Получаем позиции только текущей сессии
      const openPositions = await executionManager.getOpenPositionsBySession(sessionId);

      // Считаем актуальный Unrealized PnL на основе живых данных
      let currentUnrealized = 0;
      const positionsData = openPositions.map((p) => {
        const upnl = Number(p.external?.unrealizedPnl) || 0;
        currentUnrealized += upnl;
        return {
          id: p.id,
          pair: p.pairSymbol,
          direction: p.direction,
          entryPrice: p.entryPrice,
          size: p.size,
          unrealizedPnl: upnl,
          // Добавляем полезные поля
          markPrice: p.external?.markPrice,
          liqPrice: p.external?.liqPrice,
          leverage: p.external?.leverage,
        };
      });

      // Подмешиваем живые метрики в ответ (не сохраняя в БД)
      if (metrics) {
        metrics.unrealizedPnl = currentUnrealized.toFixed(2);
        metrics.totalPnl = (Number(metrics.realizedPnl || 0) + currentUnrealized).toFixed(2);
        metrics.openPositions = openPositions.length;
      }

      res.json({
        success: true,
        data: {
          session,
          metrics,
          openPositionsCount: openPositions.length,
          openPositions: positionsData,
        },
      });
    } catch (error) {
      SESSION_CTRL_LOG.error('Failed to get active session', { error: (error as Error)?.message || error });
      res.status(500).json({
        success: false,
        error: 'Failed to get active session',
        message: (error as Error)?.message,
      });
    }
  }

  /**
   * POST /api/scanner/sessions/:id/end
   * Принудительное завершение сессии (с закрытием позиций)
   */
  async forceEndSession(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const safeId = String(id);
      const { notes } = req.body;

      const session = await sessionManager.getSession(safeId);
      if (!session) {
        res.status(404).json({
          success: false,
          error: 'Session not found',
        });
        return;
      }

      if (session.status !== 'running') {
        res.status(400).json({
          success: false,
          error: 'Session is not running',
          status: session.status,
        });
        return;
      }

      // Если это текущая активная сессия — остановить сканер
      if (sessionManager.getCurrentSessionId() === safeId) {
        await stopScannerAndEndSession();
      } else {
        // Иначе завершаем сессию с принудительным закрытием позиций
        await sessionManager.endSession(safeId, 'completed', notes || 'Ended by user');
      }

      SESSION_CTRL_LOG.info('Session forcefully ended', {
        sessionId: safeId,
        notes,
      });

      res.json({
        success: true,
        data: {
          sessionId: safeId,
          status: 'completed',
        },
      });
    } catch (error) {
      SESSION_CTRL_LOG.error('Failed to end session', {
        error: (error as Error)?.message || error,
        sessionId: req.params.id,
      });
      res.status(500).json({
        success: false,
        error: 'Failed to end session',
        message: (error as Error)?.message,
      });
    }
  }

  /**
   * GET /api/scanner/status
   * Статус сканера (idle/running/stopped)
   */
  async getStatus(req: Request, res: Response): Promise<void> {
    try {
      const status = getScannerStatus();
      const sessionId = sessionManager.getCurrentSessionId();

      res.json({
        success: true,
        data: {
          status,
          sessionId,
          hasActiveSession: !!sessionId,
        },
      });
    } catch (error) {
      SESSION_CTRL_LOG.error('Failed to get scanner status', { error: (error as Error)?.message || error });
      res.status(500).json({
        success: false,
        error: 'Failed to get scanner status',
        message: (error as Error)?.message,
      });
    }
  }

  /**
   * GET /api/scanner/sessions/:id
   * Получение детальной информации о сессии
   */
  async getSession(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const safeId = String(id);

      const session = await sessionManager.getSession(safeId);
      if (!session) {
        res.status(404).json({
          success: false,
          error: 'Session not found',
        });
        return;
      }

      res.json({
        success: true,
        data: session,
      });
    } catch (error) {
      SESSION_CTRL_LOG.error('Failed to get session', {
        error: (error as Error)?.message || error,
        sessionId: req.params.id,
      });
      res.status(500).json({
        success: false,
        error: 'Failed to get session',
        message: (error as Error)?.message,
      });
    }
  }

  /**
   * DELETE /api/scanner/sessions/:id
   * Удаление сессии (доступно только для завершённых)
   */
  async deleteSession(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const safeId = String(id);

      const session = await sessionManager.getSession(safeId);
      if (!session) {
        res.status(404).json({
          success: false,
          error: 'Session not found',
        });
        return;
      }

      if (session.status === 'running') {
        res.status(400).json({
          success: false,
          error: 'Cannot delete running session. Stop scanner first.',
        });
        return;
      }

      // ИСПРАВЛЕНО: Получаем открытые сделки из БД, так как Redis может быть пуст после остановки
      const openTrades = await sessionManager.getSessionTrades(safeId, 'open');
      const openPositions = await executionManager.getOpenPositions();
      const tradeOrderIds = new Set(openTrades.map((trade) => trade.orderLinkId).filter((id): id is string => !!id));
      const sessionPositions = openPositions.filter((pos) => pos.sessionId === safeId || tradeOrderIds.has(pos.id));

      if (sessionPositions.length > 0 || openTrades.length > 0) {
        SESSION_CTRL_LOG.info('Found open trades to close before deletion', { 
          count: openTrades.length,
          sessionId: safeId 
        });

        const mode = session.mode;
        const symbols = Array.from(new Set([
          ...sessionPositions.map((pos) => pos.pairSymbol),
          ...openTrades.map((trade) => trade.pair),
        ].filter((symbol): symbol is string => !!symbol)));

        let demoManager = mode === 'demo' ? getDemoManager() : undefined;
        let testnetManager = mode === 'testnet' ? getTestnetManager() : undefined;

        // Инициализируем менеджеры если они не активны (для разовой операции)
        if (!demoManager && mode === 'demo') {
          demoManager = new BybitDemoExecutionManager(executionManager);
          SESSION_CTRL_LOG.info('Initialized temporary Demo manager for cleanup');
        }
        if (!testnetManager && mode === 'testnet') {
          testnetManager = new BybitTestnetExecutionManager(executionManager);
          SESSION_CTRL_LOG.info('Initialized temporary Testnet manager for cleanup');
        }

        // 1. Отменяем все ордера
        for (const symbol of symbols) {
          try {
            if (mode === 'demo' && demoManager) {
              await demoManager.cancelAllOrders(symbol);
            } else if (mode === 'testnet' && testnetManager) {
              await testnetManager.cancelAllOrders(symbol);
            }
          } catch (err) {
            SESSION_CTRL_LOG.warn('Failed to cancel orders during cleanup', { symbol, error: err });
          }
        }

        // 2. Закрываем позиции на бирже и в БД
        for (const position of sessionPositions) {
          try {
            const positionIdx = position.external?.positionIdx || 0;
            if (mode === 'demo' && demoManager) {
              await demoManager.closeExchangePosition(position.pairSymbol, positionIdx);
            } else if (mode === 'testnet' && testnetManager) {
              await testnetManager.closeExchangePosition(position.pairSymbol, positionIdx);
            }

            const exitPrice = position.external?.markPrice || position.entryPrice;
            await executionManager.closePosition(position.id, {
              exitPrice,
              exitAt: Date.now(),
              exitReason: 'manual',
            });
          } catch (err) {
            SESSION_CTRL_LOG.error('Failed to close position during deletion', { positionId: position.id, error: err });
          }
        }

        if (sessionPositions.length === 0) {
          for (const symbol of symbols) {
            if (mode === 'demo' && demoManager) {
              await demoManager.closeExchangePosition(symbol);
            } else if (mode === 'testnet' && testnetManager) {
              await testnetManager.closeExchangePosition(symbol);
            }
          }
        }

        for (const trade of openTrades) {
          try {
            // Пытаемся достать positionIdx из сохраненных данных, иначе 0 (One-Way mode)
            const exitPrice = trade.extra?.external?.markPrice 
              ? Number(trade.extra.external.markPrice) 
              : (trade.entryPrice ? Number(trade.entryPrice) : 0);

            await sessionManager.closeTrade({
              tradeId: trade.id,
              exitTimestamp: new Date(),
              exitPrice,
              exitReason: 'session_deleted',
              realizedPnl: 0, // Не знаем точно PnL без ответа биржи, ставим 0 или приблизительно
            });
            
            SESSION_CTRL_LOG.info('Closed trade during session deletion', { tradeId: trade.id, pair: trade.pair });
          } catch (err) {
            SESSION_CTRL_LOG.error('Failed to close trade during deletion', { tradeId: trade.id, error: err });
          }
        }
      }

      await sessionManager.deleteSession(id);

      SESSION_CTRL_LOG.info('Session deleted by user', { sessionId: id });

      res.json({
        success: true,
        data: { sessionId: id },
      });
    } catch (error) {
      SESSION_CTRL_LOG.error('Failed to delete session', {
        error: (error as Error)?.message || error,
        sessionId: req.params.id,
      });
      res.status(500).json({
        success: false,
        error: 'Failed to delete session',
        message: (error as Error)?.message,
      });
    }
  }

  /**
   * GET /api/scanner/sessions/:id/metrics
   * Получение метрик для сессии
   */
  async getSessionMetrics(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      const metrics = await sessionManager.getSessionMetrics(id);
      if (!metrics) {
        res.status(404).json({
          success: false,
          error: 'Session metrics not found',
        });
        return;
      }

      res.json({
        success: true,
        data: metrics,
      });
    } catch (error) {
      SESSION_CTRL_LOG.error('Failed to get session metrics', {
        error: (error as Error)?.message || error,
        sessionId: req.params.id,
      });
      res.status(500).json({
        success: false,
        error: 'Failed to get session metrics',
        message: (error as Error)?.message,
      });
    }
  }

  /**
   * GET /api/scanner/sessions/:id/trades
   * Получение сделок для сессии
   */
  async getSessionTrades(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const safeId = String(id);
      const { limit = 100 } = req.query;

      const trades = await sessionManager.getSessionTrades(safeId);
      const numericLimit = Number(limit);
      const limitedTrades = Number.isFinite(numericLimit) && numericLimit > 0
        ? trades.slice(0, numericLimit)
        : trades;

      res.json({
        success: true,
        data: limitedTrades,
        count: limitedTrades.length,
      });
    } catch (error) {
      SESSION_CTRL_LOG.error('Failed to get session trades', {
        error: (error as Error)?.message || error,
        sessionId: req.params.id,
      });
      res.status(500).json({
        success: false,
        error: 'Failed to get session trades',
        message: (error as Error)?.message,
      });
    }
  }
}

export const scannerSessionController = new ScannerSessionController();

