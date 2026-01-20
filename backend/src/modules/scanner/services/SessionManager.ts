import { AppDataSource } from '@/config/dataSource';
import { TradingSession, SessionSource, SessionMode, SessionStatus } from '@/models/TradingSession';
import { SessionTrade, TradeSource, TradeStatus } from '@/models/SessionTrade';
import { SessionMetrics } from '@/models/SessionMetrics';
import { In } from 'typeorm';
import logger from '@/utils/logger';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
import { ExecutionLeg } from '../scanner.types';

const SESSION_LOG = logger.child({ module: 'SessionManager' });

export interface CreateSessionParams {
  source: SessionSource;
  mode: SessionMode;
  strategyVersion?: string;
  strategyParams?: Record<string, any>;
  exchange?: string;
  pairs?: string[];
  timeframes?: string[];
  portfolioMode?: boolean;
  configSnapshot?: Record<string, any>;
  riskSettingsSnapshot?: Record<string, any>;
  allocatorConfigSnapshot?: Record<string, any>;
  name?: string;
  notes?: string;
  createdBy?: string;
}

export interface RecordTradeParams {
  sessionId: string;
  source: TradeSource;
  mode?: string;
  pair: string;
  timeframe?: string;
  direction?: string;
  exchange?: string;
  strategyId?: string;
  signalId?: string;
  allocationId?: string;
  orderLinkId?: string;
  entryTimestamp?: Date;
  entryPrice?: number;
  entryFee?: number;
  entryReason?: string;
  positionSize?: number;
  leverage?: number;
  stopLoss?: number;
  takeProfit?: number;
  trailingStop?: number;
  riskScore?: number;
  confirmationAttempts?: number;
  latencyMs?: number;
  extra?: Record<string, any>;
}

export interface CloseTradeParams {
  tradeId: string;
  exitTimestamp: Date;
  exitPrice: number;
  exitFee?: number;
  exitReason?: string;
  realizedPnl?: number;
  realizedPnlPct?: number;
  maxFavorableExcursion?: number;
  maxAdverseExcursion?: number;
}

export interface AppendTradeLegParams {
  tradeId: string;
  leg: ExecutionLeg;
  entryPrice?: number;
  positionSize?: number;
  leverage?: number;
  stopLoss?: number;
  takeProfit?: number;
  confirmationAttempts?: number;
}

export class SessionManager {
  private currentSessionId: string | null = null;

  /**
   * Создание хеша параметров стратегии
   */
  private hashStrategyParams(params: Record<string, any>): string {
    // Простая канонизация JSON (сортировка ключей)
    const canonical = JSON.stringify(params, Object.keys(params).sort());
    return createHash('sha256').update(canonical).digest('hex');
  }

  /**
   * Создание новой торговой сессии
   */
  async createSession(params: CreateSessionParams): Promise<TradingSession> {
    const sessionRepo = AppDataSource.getRepository(TradingSession);
    const metricsRepo = AppDataSource.getRepository(SessionMetrics);

    const session = sessionRepo.create({
      source: params.source,
      mode: params.mode,
      strategyVersion: params.strategyVersion || null,
      strategyParamsHash: params.strategyParams ? this.hashStrategyParams(params.strategyParams) : null,
      strategyParamsSnapshot: params.strategyParams || null,
      exchange: params.exchange || null,
      pairs: params.pairs || null,
      timeframes: params.timeframes || null,
      portfolioMode: params.portfolioMode || false,
      configSnapshot: params.configSnapshot || null,
      riskSettingsSnapshot: params.riskSettingsSnapshot || null,
      allocatorConfigSnapshot: params.allocatorConfigSnapshot || null,
      name: params.name || null,
      notes: params.notes || null,
      autoStarted: false,
      status: 'created',
      createdBy: params.createdBy || null,
    });

    const savedSession = await sessionRepo.save(session);

    // Создаём связанную запись метрик
    const metrics = metricsRepo.create({
      session: savedSession,
    });
    await metricsRepo.save(metrics);

    // Не устанавливаем currentSessionId при создании, так как сессия еще не запущена
    // this.currentSessionId = savedSession.id;

    SESSION_LOG.info('Trading session created', {
      sessionId: savedSession.id,
      source: savedSession.source,
      mode: savedSession.mode,
      pairs: savedSession.pairs,
    });

    return savedSession;
  }

  /**
   * Активация сессии (перевод в статус running)
   */
  async activateSession(sessionId: string): Promise<void> {
    const sessionRepo = AppDataSource.getRepository(TradingSession);
    
    await sessionRepo.update(sessionId, {
      status: 'running',
      startedAt: new Date(), // Обновляем время старта на фактическое время запуска
    });
    
    this.currentSessionId = sessionId;
    
    SESSION_LOG.info('Session activated', { sessionId });
  }

  /**
   * Получение текущей активной сессии
   */
  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  /**
   * Установка текущей сессии
   */
  setCurrentSessionId(sessionId: string | null): void {
    this.currentSessionId = sessionId;
  }

  /**
   * Завершение сессии
   */
  async endSession(sessionId: string, status: SessionStatus = 'completed', notes?: string): Promise<void> {
    const sessionRepo = AppDataSource.getRepository(TradingSession);
    const tradeRepo = AppDataSource.getRepository(SessionTrade);

    // 🔥 Закрываем все открытые позиции при завершении сессии
    const openTrades = await tradeRepo.find({
      where: {
        session: { id: sessionId },
        status: 'open',
      },
      relations: ['session'],
    });

    if (openTrades.length > 0) {
      SESSION_LOG.info('Closing positions for completed session', {
        sessionId,
        positionsCount: openTrades.length,
        symbols: openTrades.map(t => t.pair),
      });

      // Импортируем execution manager для закрытия позиций
      const { executionManager } = await import('../adapters');
      
      for (const trade of openTrades) {
        try {
          // Сначала закрываем позицию на бирже через demo/testnet manager
          const { getDemoManager, getTestnetManager } = await import('../scanner.bootstrap');
          const demoManager = getDemoManager();
          const testnetManager = getTestnetManager();
          
          if (trade.mode === 'demo' && demoManager) {
            await demoManager.closeExchangePosition(trade.pair, 0);
            SESSION_LOG.debug('Position closed on Bybit Demo', { tradeId: trade.id, pair: trade.pair });
          } else if (trade.mode === 'testnet' && testnetManager) {
            await testnetManager.closeExchangePosition(trade.pair, 0);
            SESSION_LOG.debug('Position closed on Bybit Testnet', { tradeId: trade.id, pair: trade.pair });
          }
          
          // Получаем текущую цену с биржи для корректного PnL
          let currentPrice = trade.entryPrice;
          try {
            const { getDemoManager, getTestnetManager } = await import('../scanner.bootstrap');
            const demoManager = getDemoManager();
            const testnetManager = getTestnetManager();
            
            if (trade.mode === 'demo' && demoManager) {
              const positions = await demoManager.getExchangePositions(trade.pair);
              const position = positions.find(p => Number(p.size) !== 0);
              if (position && position.markPrice) {
                currentPrice = Number(position.markPrice);
                SESSION_LOG.debug('Using current market price for position closure', { 
                  tradeId: trade.id, 
                  pair: trade.pair, 
                  entryPrice: trade.entryPrice, 
                  currentPrice 
                });
              }
            } else if (trade.mode === 'testnet' && testnetManager) {
              const positions = await testnetManager.getExchangePositions(trade.pair);
              const position = positions.find(p => Number(p.size) !== 0);
              if (position && position.markPrice) {
                currentPrice = Number(position.markPrice);
                SESSION_LOG.debug('Using current market price for position closure', { 
                  tradeId: trade.id, 
                  pair: trade.pair, 
                  entryPrice: trade.entryPrice, 
                  currentPrice 
                });
              }
            }
          } catch (error) {
            SESSION_LOG.warn('Failed to get current price, using entry price', { 
              tradeId: trade.id, 
              pair: trade.pair, 
              error: (error as Error)?.message 
            });
          }
          
          // Рассчитываем PnL
          const pnl = trade.direction === 'long' 
            ? (currentPrice - trade.entryPrice) * trade.positionSize
            : (trade.entryPrice - currentPrice) * trade.positionSize;
          const pnlPercentage = trade.entryPrice !== 0 
            ? (currentPrice - trade.entryPrice) / trade.entryPrice * (trade.direction === 'long' ? 100 : -100)
            : 0;
          
          // Закрываем в памяти execution manager
          const closedPosition = await executionManager.closePosition(trade.id, {
            exitReason: 'manual', // Завершение сессии
            exitPrice: currentPrice,
            exitAt: Date.now(),
          });
          
          // Обновляем запись в БД
          await tradeRepo.update(trade.id, {
            status: 'closed',
            exitTimestamp: new Date(),
            exitPrice: currentPrice,
            exitReason: 'session_completed',
            realizedPnl: pnl.toString(),
            realizedPnlPct: pnlPercentage.toString(),
          });
          
          SESSION_LOG.info('Position closed on session completion', {
            sessionId,
            tradeId: trade.id,
            pair: trade.pair,
            pnl: closedPosition?.pnl,
          });
        } catch (error: any) {
          SESSION_LOG.error('Failed to close position on session completion', {
            sessionId,
            tradeId: trade.id,
            error: error?.message || error,
          });
          
          // Если не удалось закрыть на бирже, хотя бы закрываем в БД
          await tradeRepo.update(trade.id, {
            status: 'closed',
            exitTimestamp: new Date(),
            exitPrice: trade.entryPrice,
            exitReason: 'session_completed',
          });
        }
      }
    }

    await sessionRepo.update(sessionId, {
      endedAt: new Date(),
      status,
      notes: notes || null,
    });

    if (this.currentSessionId === sessionId) {
      this.currentSessionId = null;
    }

    SESSION_LOG.info('Trading session ended with positions closed', { 
      sessionId, 
      status, 
      closedPositions: openTrades.length 
    });

    // 🔥 Пересчитываем метрики после закрытия всех позиций
    await this.updateSessionMetrics(sessionId);
  }

  /**
   * Запись сделки
   */
  async recordTrade(params: RecordTradeParams): Promise<SessionTrade> {
    const tradeRepo = AppDataSource.getRepository(SessionTrade);

    const initialExtra: Record<string, any> = params.extra ? { ...params.extra } : {};
    if (!initialExtra.external) {
      initialExtra.external = {
        orders: [],
        executions: [],
      };
    }

    const trade = tradeRepo.create({
      id: randomUUID(), // Генерируем UUID вручную
      session: { id: params.sessionId } as any,
      source: params.source,
      mode: params.mode || null,
      pair: params.pair,
      timeframe: params.timeframe || null,
      direction: params.direction || null,
      exchange: params.exchange || null,
      strategyId: params.strategyId || null,
      signalId: params.signalId || null,
      allocationId: params.allocationId || null,
      orderLinkId: params.orderLinkId || null,
      entryTimestamp: params.entryTimestamp || null,
      entryPrice: params.entryPrice?.toString() || null,
      entryFee: params.entryFee?.toString() || null,
      entryReason: params.entryReason || null,
      positionSize: params.positionSize?.toString() || null,
      leverage: params.leverage?.toString() || null,
      stopLoss: params.stopLoss?.toString() || null,
      takeProfit: params.takeProfit?.toString() || null,
      trailingStop: params.trailingStop?.toString() || null,
      riskScore: params.riskScore?.toString() || null,
      confirmationAttempts: params.confirmationAttempts || null,
      latencyMs: params.latencyMs || null,
      status: 'open',
      extra: initialExtra,
    });

    const savedTrade = await tradeRepo.save(trade);

    SESSION_LOG.debug('Trade recorded', {
      sessionId: params.sessionId,
      tradeId: savedTrade.id,
      pair: params.pair,
      signalId: params.signalId,
    });

    // Обновляем метрики сессии
    await this.updateSessionMetrics(params.sessionId);

    return savedTrade;
  }

  /**
   * Закрытие сделки
   */
  async closeTrade(params: CloseTradeParams): Promise<SessionTrade | null> {
    const tradeRepo = AppDataSource.getRepository(SessionTrade);

    const trade = await tradeRepo.findOne({ where: { id: params.tradeId } });
    if (!trade) {
      SESSION_LOG.warn('Trade not found for closing', { tradeId: params.tradeId });
      return null;
    }

    await tradeRepo.update(params.tradeId, {
      exitTimestamp: params.exitTimestamp,
      exitPrice: params.exitPrice.toString(),
      exitFee: params.exitFee?.toString() || null,
      exitReason: params.exitReason || null,
      realizedPnl: params.realizedPnl?.toString() || null,
      realizedPnlPct: params.realizedPnlPct?.toString() || null,
      maxFavorableExcursion: params.maxFavorableExcursion?.toString() || null,
      maxAdverseExcursion: params.maxAdverseExcursion?.toString() || null,
      status: 'closed',
    });

    const updatedTrade = await tradeRepo.findOne({ where: { id: params.tradeId } });

    SESSION_LOG.info('Trade closed', {
      tradeId: params.tradeId,
      pair: trade.pair,
      realizedPnl: params.realizedPnl,
      exitReason: params.exitReason,
    });

    // Обновляем метрики сессии
    if (trade.session) {
      await this.updateSessionMetrics((trade.session as any).id);
    }

    return updatedTrade!;
  }

  async appendTradeLeg(params: AppendTradeLegParams): Promise<void> {
    const tradeRepo = AppDataSource.getRepository(SessionTrade);
    const trade = await tradeRepo.findOne({ where: { id: params.tradeId } });
    if (!trade) {
      SESSION_LOG.warn('Trade not found for leg append', { tradeId: params.tradeId });
      return;
    }

    const extra = trade.extra ? { ...trade.extra } : {};
    if (!extra.external) {
      extra.external = {
        orders: [],
        executions: [],
      };
    }
    const legs: ExecutionLeg[] = Array.isArray(extra.legs) ? extra.legs : [];
    legs.push(params.leg);

    extra.legs = legs;
    extra.lastLeg = params.leg.id;
    if (typeof params.entryPrice === 'number') {
      extra.lastEntryPrice = params.entryPrice;
    }
    if (typeof params.positionSize === 'number') {
      extra.lastPositionSize = params.positionSize;
    }
    if (typeof params.leverage === 'number') {
      extra.lastLeverage = params.leverage;
    }
    if (typeof params.stopLoss === 'number') {
      extra.lastStopLoss = params.stopLoss;
    }
    if (typeof params.takeProfit === 'number') {
      extra.lastTakeProfit = params.takeProfit;
    }
    if (typeof params.confirmationAttempts === 'number') {
      extra.lastConfirmationAttempts = params.confirmationAttempts;
    }

    await tradeRepo.update(params.tradeId, {
      positionSize: params.positionSize?.toString() ?? trade.positionSize,
      entryPrice: params.entryPrice?.toString() ?? trade.entryPrice,
      stopLoss: params.stopLoss?.toString() ?? trade.stopLoss,
      takeProfit: params.takeProfit?.toString() ?? trade.takeProfit,
      leverage: params.leverage?.toString() ?? trade.leverage,
      extra,
    });

    SESSION_LOG.debug('Trade leg appended', { tradeId: params.tradeId, legId: params.leg.id });
  }

  async appendExternalExecution(params: {
    sessionId: string;
    orderLinkId?: string | null;
    orderId?: string | null;
    executionId?: string | null;
    details?: Record<string, any>;
  }): Promise<void> {
    if (!params.orderLinkId) {
      return;
    }

    const tradeRepo = AppDataSource.getRepository(SessionTrade);

    const trade = await tradeRepo.findOne({
      where: {
        session: { id: params.sessionId } as any,
        orderLinkId: params.orderLinkId,
      },
    });

    if (!trade) {
      return;
    }

    const extra = trade.extra ? { ...trade.extra } : {};
    const external: Record<string, any> = extra.external ? { ...extra.external } : { orders: [], executions: [] };

    if (params.orderId) {
      const idStr = String(params.orderId);
      const existingOrders: string[] = Array.isArray(external.orders) ? external.orders : [];
      if (!existingOrders.includes(idStr)) {
        external.orders = [...existingOrders, idStr];
      } else {
        external.orders = existingOrders;
      }
    }

    if (params.executionId) {
      const execStr = String(params.executionId);
      const existingExecs: string[] = Array.isArray(external.executions) ? external.executions : [];
      if (!existingExecs.includes(execStr)) {
        external.executions = [...existingExecs, execStr];
      } else {
        external.executions = existingExecs;
      }
    }

    if (params.details) {
      external.lastDetails = params.details;
    }

    external.updatedAt = Date.now();
    extra.external = external;

    await tradeRepo.update(trade.id, { extra });
  }

  /**
   * Обновление метрик сессии
   */
  async updateSessionMetrics(sessionId: string): Promise<void> {
    const tradeRepo = AppDataSource.getRepository(SessionTrade);
    const metricsRepo = AppDataSource.getRepository(SessionMetrics);

    await AppDataSource.transaction('READ COMMITTED', async (manager) => {
      const metricsRepoTx = manager.getRepository(SessionMetrics);
      const tradeRepoTx = manager.getRepository(SessionTrade);

      let metrics = await metricsRepoTx.findOne({ where: { session: { id: sessionId } as any } });

      if (!metrics) {
        metrics = metricsRepoTx.create({
          session: { id: sessionId } as any,
          totalPnl: '0',
          realizedPnl: '0',
          unrealizedPnl: '0',
          totalReturnPct: '0',
          winRatePct: '0',
          profitFactor: '0',
          avgTradePnl: '0',
          avgWinPnl: '0',
          avgLossPnl: '0',
          expectancy: '0',
          tradeCount: 0,
          winningTrades: 0,
          losingTrades: 0,
          openPositions: 0,
          closedPositions: 0,
          latencyMsAvg: '0',
          latencyMsP95: '0',
          updatedAt: new Date(),
        });
        metrics = await metricsRepoTx.save(metrics);
      }

      const previousTradeCount = metrics.tradeCount ?? 0;

      const [openTrades, closedTrades] = await Promise.all([
        tradeRepoTx.find({ where: { session: { id: sessionId } as any, status: 'open' } }),
        tradeRepoTx.find({ where: { session: { id: sessionId } as any, status: 'closed' } }),
      ]);

      // 🔥 Полный пересчет метрик вместо инкрементального накопления
      const totalClosed = closedTrades.length;
      const latencies: number[] = [];
      let totalRealized = 0;
      let winningTrades = 0;
      let losingTrades = 0;
      let winSum = 0;
      let lossSum = 0;

      // Считаем все закрытые сделки сессии
      for (const trade of closedTrades) {
        const pnl = parseFloat(trade.realizedPnl || '0');
        totalRealized += pnl;

        if (pnl > 0) {
          winningTrades += 1;
          winSum += pnl;
        } else if (pnl < 0) {
          losingTrades += 1;
          lossSum += Math.abs(pnl);
        }

        if (trade.latencyMs) {
          latencies.push(trade.latencyMs);
        }
      }

      metrics.tradeCount = totalClosed;
      metrics.closedPositions = totalClosed;
      metrics.openPositions = openTrades.length;

      // 🔥 Устанавливаем финальные значения вместо инкрементального накопления
      const updatedRealized = totalRealized;
      const updatedTotalPnl = totalRealized; // Для закрытых сделок total = realized
      const updatedWinningTrades = winningTrades;
      const updatedLosingTrades = losingTrades;
      const updatedWinSum = winSum;
      const updatedLossSum = lossSum;

      const tradeCount = metrics.tradeCount || 0;
      const winRatePct = tradeCount > 0 ? (updatedWinningTrades / tradeCount) * 100 : 0;
      const avgTradePnl = tradeCount > 0 ? updatedRealized / tradeCount : 0;
      const avgWinPnl = updatedWinningTrades > 0 ? updatedWinSum / updatedWinningTrades : 0;
      const avgLossPnl = updatedLosingTrades > 0 ? updatedLossSum / updatedLosingTrades : 0;
      const lossRate = 1 - (winRatePct / 100);
      const expectancy = (winRatePct / 100) * avgWinPnl - lossRate * avgLossPnl;
      const profitFactor = updatedLossSum > 0 ? updatedWinSum / updatedLossSum : (updatedWinSum > 0 ? 999 : 0);

      let latencyMsAvg = parseFloat(metrics.latencyMsAvg || '0');
      let latencyMsP95 = parseFloat(metrics.latencyMsP95 || '0');

      if (latencies.length > 0) {
        const existingSamples = metrics.losingTrades || 0 + metrics.winningTrades || 0;
        const totalSamples = existingSamples + latencies.length;

        latencyMsAvg = totalSamples > 0
          ? ((latencyMsAvg * existingSamples) + latencies.reduce((a, b) => a + b, 0)) / totalSamples
          : latencyMsAvg;

        const combined = new Array(existingSamples).fill(latencyMsAvg).concat(latencies).sort((a, b) => a - b);
        latencyMsP95 = combined[Math.floor(combined.length * 0.95)] ?? latencyMsP95;
      }

      Object.assign(metrics, {
        realizedPnl: updatedRealized.toFixed(2),
        totalPnl: updatedTotalPnl.toFixed(2),
        winRatePct: winRatePct.toFixed(2),
        profitFactor: profitFactor.toFixed(2),
        avgTradePnl: avgTradePnl.toFixed(2),
        avgWinPnl: avgWinPnl.toFixed(2),
        avgLossPnl: avgLossPnl.toFixed(2),
        expectancy: expectancy.toFixed(2),
        winningTrades: updatedWinningTrades,
        losingTrades: updatedLosingTrades,
        latencyMsAvg: latencyMsAvg.toFixed(2),
        latencyMsP95: latencyMsP95.toFixed(2),
        updatedAt: new Date(),
      });

      await metricsRepoTx.save(metrics);

      SESSION_LOG.debug('Session metrics updated (full recalculation)', {
        sessionId,
        totalClosed,
        totalOpen: openTrades.length,
        updatedRealized,
        updatedTotalPnl,
      });
    });
  }

  /**
   * Получение сессии по ID
   */
  async getSession(sessionId: string): Promise<TradingSession | null> {
    const sessionRepo = AppDataSource.getRepository(TradingSession);
    return await sessionRepo.findOne({ where: { id: sessionId } });
  }

  /**
   * Получение метрик сессии
   */
  async getSessionMetrics(sessionId: string): Promise<SessionMetrics | null> {
    const metricsRepo = AppDataSource.getRepository(SessionMetrics);
    return await metricsRepo.findOne({ where: { session: { id: sessionId } as any } });
  }

  /**
   * Получение сделок сессии
   */
  async getSessionTrades(sessionId: string, status?: TradeStatus): Promise<SessionTrade[]> {
    const tradeRepo = AppDataSource.getRepository(SessionTrade);
    const where: any = { session: { id: sessionId } };
    if (status) {
      where.status = status;
    }
    return await tradeRepo.find({ where, order: { createdAt: 'DESC' } });
  }

  /**
   * Поиск открытого трейда по паре, mode и exchange (в любой сессии)
   */
  async findOpenTradeByPair(pair: string, mode: string, exchange: string): Promise<SessionTrade | null> {
    const tradeRepo = AppDataSource.getRepository(SessionTrade);
    return await tradeRepo.findOne({
      where: {
        pair,
        mode,
        exchange,
        status: 'open',
      },
      relations: ['session'],
      order: { createdAt: 'DESC' },
    });
  }

  async deleteSession(sessionId: string): Promise<void> {
    const sessionRepo = AppDataSource.getRepository(TradingSession);
    const tradeRepo = AppDataSource.getRepository(SessionTrade);

    const session = await sessionRepo.findOne({ where: { id: sessionId } });
    if (!session) {
      throw new Error('Session not found');
    }

    if (session.status === 'running') {
      throw new Error('Cannot delete active session');
    }

    // 🔥 Принудительно закрываем все открытые позиции сессии
    const openTrades = await tradeRepo.find({
      where: {
        session: { id: sessionId },
        status: 'open',
      },
      relations: ['session'],
    });

    if (openTrades.length > 0) {
      SESSION_LOG.warn('Force closing positions for deleted session', {
        sessionId,
        positionsCount: openTrades.length,
        symbols: openTrades.map(t => t.pair),
      });

      // Импортируем execution manager для закрытия позиций
      const { executionManager } = await import('../adapters');
      
      for (const trade of openTrades) {
        try {
          // Закрываем позицию на бирже (если возможно)
          await executionManager.closePosition(trade.id, {
            exitReason: 'manual', // session_deleted не поддерживается, используем manual
            exitPrice: trade.entryPrice, // Закрываем по entry price для минимизации потерь
            exitAt: Date.now(),
          });
          
          SESSION_LOG.info('Position force-closed', {
            sessionId,
            tradeId: trade.id,
            pair: trade.pair,
          });
        } catch (error: any) {
          SESSION_LOG.error('Failed to force-close position', {
            sessionId,
            tradeId: trade.id,
            error: error?.message || error,
          });
          
          // Получаем текущую цену для корректного PnL
          let currentPrice = trade.entryPrice;
          try {
            const { getDemoManager, getTestnetManager } = await import('../scanner.bootstrap');
            const demoManager = getDemoManager();
            const testnetManager = getTestnetManager();
            
            if (trade.mode === 'demo' && demoManager) {
              const positions = await demoManager.getExchangePositions(trade.pair);
              const position = positions.find(p => Number(p.size) !== 0);
              if (position && position.markPrice) {
                currentPrice = Number(position.markPrice);
              }
            } else if (trade.mode === 'testnet' && testnetManager) {
              const positions = await testnetManager.getExchangePositions(trade.pair);
              const position = positions.find(p => Number(p.size) !== 0);
              if (position && position.markPrice) {
                currentPrice = Number(position.markPrice);
              }
            }
          } catch (error) {
            // Используем entry price если не удалось получить текущую
          }
          
          // Рассчитываем PnL
          const pnl = trade.direction === 'long' 
            ? (currentPrice - trade.entryPrice) * trade.positionSize
            : (trade.entryPrice - currentPrice) * trade.positionSize;
          const pnlPercentage = trade.entryPrice !== 0 
            ? (currentPrice - trade.entryPrice) / trade.entryPrice * (trade.direction === 'long' ? 100 : -100)
            : 0;
          
          // Закрываем в БД с корректным PnL
          await tradeRepo.update(trade.id, {
            status: 'closed',
            exitTimestamp: new Date(),
            exitPrice: currentPrice,
            exitReason: 'session_deleted',
            realizedPnl: pnl.toString(),
            realizedPnlPct: pnlPercentage.toString(),
          });
        }
      }
    }

    await sessionRepo.delete(sessionId);

    if (this.currentSessionId === sessionId) {
      this.currentSessionId = null;
    }

    SESSION_LOG.info('Session deleted with positions closed', { 
      sessionId, 
      closedPositions: openTrades.length 
    });

    // 🔥 Пересчитываем метрики после закрытия всех позиций (если сессия еще не удалена)
    try {
      await this.updateSessionMetrics(sessionId);
    } catch (error) {
      // Игнорируем ошибку, т.к. сессия уже удалена
      SESSION_LOG.debug('Could not update metrics for deleted session', { sessionId, error: (error as Error)?.message });
    }
  }

  /**
   * Список сессий с фильтрацией
   */
  async listSessions(filters: {
    source?: 'scanner' | 'backtester';
    status?: SessionStatus;
    mode?: SessionMode;
    limit?: number;
    offset?: number;
  }): Promise<TradingSession[]> {
    const sessionRepo = AppDataSource.getRepository(TradingSession);
    
    const queryBuilder = sessionRepo.createQueryBuilder('session');
    
    if (filters.source) {
      queryBuilder.andWhere('session.source = :source', { source: filters.source });
    }
    if (filters.status) {
      queryBuilder.andWhere('session.status = :status', { status: filters.status });
    }
    if (filters.mode) {
      queryBuilder.andWhere('session.mode = :mode', { mode: filters.mode });
    }
    
    queryBuilder
      .orderBy('session.createdAt', 'DESC')
      .limit(filters.limit || 50)
      .offset(filters.offset || 0);
    
    return await queryBuilder.getMany();
  }

  /**
   * Переоткрытие сессии (изменение статуса на running)
   */
  async reopenSession(sessionId: string): Promise<void> {
    const sessionRepo = AppDataSource.getRepository(TradingSession);
    
    await sessionRepo.update(sessionId, {
      status: 'running',
      endedAt: null,
    });
    
    this.currentSessionId = sessionId;
    
    SESSION_LOG.info('Session reopened', { sessionId });
  }

  /**
   * Пометить сессию как автоматически восстановленную
   */
  async markSessionAutoStarted(sessionId: string): Promise<void> {
    const sessionRepo = AppDataSource.getRepository(TradingSession);
    
    await sessionRepo.update(sessionId, {
      autoStarted: true,
    });
    
    SESSION_LOG.info('Session marked as auto-started', { sessionId });
  }

  /**
   * Восстановление последней активной сессии после перезапуска
   */
  async restoreLastActiveSession(): Promise<TradingSession | null> {
    const sessionRepo = AppDataSource.getRepository(TradingSession);
    
    try {
      // Ищем последнюю сессию со статусом running
      const lastSession = await sessionRepo.findOne({
        where: { status: 'running' },
        order: { createdAt: 'DESC' },
      });

      if (!lastSession) {
        SESSION_LOG.info('No active session to restore');
        return null;
      }

      // Проверяем, была ли сессия создана недавно (за последние 24 часа)
      const hoursSinceCreated = (Date.now() - lastSession.createdAt.getTime()) / (1000 * 60 * 60);
      if (hoursSinceCreated > 24) {
        SESSION_LOG.warn('Last active session is too old, not restoring', {
          sessionId: lastSession.id,
          createdAt: lastSession.createdAt,
          hoursSince: Math.round(hoursSinceCreated),
        });
        // Помечаем как interrupted
        await this.endSession(lastSession.id, 'interrupted', 'Session too old, auto-closed on restart');
        return null;
      }

      this.currentSessionId = lastSession.id;
      
      SESSION_LOG.info('Restored active session', {
        sessionId: lastSession.id,
        source: lastSession.source,
        mode: lastSession.mode,
        createdAt: lastSession.createdAt,
      });

      return lastSession;
    } catch (error) {
      SESSION_LOG.error('Failed to restore session', { error: (error as Error)?.message || error });
      return null;
    }
  }

  /**
   * Восстановление открытых позиций из БД и проверка их актуальности
   */
  async restoreAndValidateOpenPositions(sessionId: string): Promise<SessionTrade[]> {
    const tradeRepo = AppDataSource.getRepository(SessionTrade);

    try {
      const openTrades = await this.getSessionTrades(sessionId, 'open');
      
      if (openTrades.length === 0) {
        SESSION_LOG.info('No open positions to restore');
        return [];
      }

      SESSION_LOG.info('Found open positions to restore', {
        sessionId,
        count: openTrades.length,
        pairs: openTrades.map((t) => t.pair),
      });

      // Проверяем каждую позицию
      const validatedTrades: SessionTrade[] = [];
      for (const trade of openTrades) {
        // Проверяем, не слишком ли старая позиция (более 7 дней)
        const daysSinceEntry = trade.entryTimestamp
          ? (Date.now() - trade.entryTimestamp.getTime()) / (1000 * 60 * 60 * 24)
          : 999;

        if (daysSinceEntry > 7) {
          SESSION_LOG.warn('Closing stale position (too old)', {
            tradeId: trade.id,
            pair: trade.pair,
            daysSince: Math.round(daysSinceEntry),
          });
          
          // Закрываем как interrupted
          await this.closeTrade({
            tradeId: trade.id,
            exitTimestamp: new Date(),
            exitPrice: parseFloat(trade.entryPrice || '0'),
            exitReason: 'auto_close_stale',
            realizedPnl: 0,
            realizedPnlPct: 0,
          });
          continue;
        }

        validatedTrades.push(trade);
      }

      SESSION_LOG.info('Validated open positions', {
        total: openTrades.length,
        valid: validatedTrades.length,
        closed: openTrades.length - validatedTrades.length,
      });

      return validatedTrades;
    } catch (error) {
      SESSION_LOG.error('Failed to restore and validate positions', { error: (error as Error)?.message || error });
      return [];
    }
  }
}

export const sessionManager = new SessionManager();

