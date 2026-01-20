import config from '@/config';
import logger from '@/utils/logger';
import { ExecutionManager, ExternalExecutionDetails } from './scanner.types';
import { sessionManager } from './services/SessionManager';
import { BybitTradingClient } from '@/services/bybitTradingClient';
import { BybitPrivateWebsocketClient, BybitWebsocketMessage } from '@/services/bybitWebsocketClient';

const DEMO_LOG = logger.child({ module: 'BybitDemoExecution' });

interface ExecutionReport {
  category: string;
  symbol: string;
  orderId: string;
  side: 'Buy' | 'Sell';
  orderType: string;
  execQty: string;
  execPrice: string;
  execValue: string;
  execType: string;
  leavesQty: string;
  execFee: string;
  feeCurrency: string;
  orderLinkId?: string;
  tradeTime: number;
  execId: string;
  lastLiquidityInd: string;
  tradeTimeNs?: string;
}

interface PositionUpdate {
  category: string;
  symbol: string;
  size: string;
  side: 'Buy' | 'Sell';
  positionIdx: number;
  leverage: string;
  markPrice: string;
  positionValue: string;
  positionIM: string;
  positionMM: string;
  unrealisedPnl: string;
  cumRealisedPnl: string;
  avgPrice: string;
  liqPrice: string;
  takeProfit: string;
  stopLoss: string;
}

export class BybitDemoExecutionManager {
  private readonly executionManager: ExecutionManager;
  private readonly tradingClient?: BybitTradingClient;
  private readonly wsClient?: BybitPrivateWebsocketClient;

  constructor(executionManager: ExecutionManager) {
    this.executionManager = executionManager;

    const creds = config.bybitDemo;
    if (!(creds?.apiKey && creds?.apiSecret)) {
      DEMO_LOG.warn('Bybit demo credentials missing; execution manager will stay idle');
      return;
    }

    this.tradingClient = new BybitTradingClient({
      apiKey: creds.apiKey,
      apiSecret: creds.apiSecret,
      apiUrl: creds.apiUrl,
    });
    this.wsClient = new BybitPrivateWebsocketClient({
      url: creds.wsUrl,
      apiKey: creds.apiKey,
      apiSecret: creds.apiSecret,
    });
  }

  async start(): Promise<void> {
    if (!this.wsClient) {
      return;
    }

    this.wsClient.addMessageHandler((msg) => this.handleMessage(msg));
    await this.wsClient.connect();
    this.wsClient.subscribe(['order', 'execution', 'position']);
    
    // ✅ Принудительная синхронизация позиций с биржи при старте
    DEMO_LOG.info('Starting initial position sync from Bybit Demo...');
    await this.syncPositionsFromExchange();
  }
  
  /**
   * Синхронизация всех открытых позиций с биржи
   */
  private async syncPositionsFromExchange(): Promise<void> {
    try {
      const positions = await this.getExchangePositions();
      
      // Получаем текущие открытые позиции в Scanner
      const localPositions = await this.executionManager.getOpenPositions();
      const localDemoPositions = localPositions.filter(p => p.mode === 'demo');
      
      // Создаём Set символов с биржи для быстрой проверки
      const exchangeSymbols = new Set(
        (positions || []).filter(p => Number(p.size || 0) !== 0).map(p => p.symbol)
      );
      
      // Закрываем фантомные позиции (есть локально, но нет на бирже)
      let closedPhantomCount = 0;
      for (const localPos of localDemoPositions) {
        if (!exchangeSymbols.has(localPos.pairSymbol)) {
          DEMO_LOG.warn('Closing phantom position - not found on exchange', {
            symbol: localPos.pairSymbol,
            positionId: localPos.id,
          });
          
          await this.executionManager.closePosition(localPos.id, {
            exitReason: 'manual',
            exitPrice: localPos.entryPrice,
            exitAt: Date.now(),
          });
          closedPhantomCount++;
        }
      }
      
      if (closedPhantomCount > 0) {
        DEMO_LOG.info('Closed phantom positions', { count: closedPhantomCount });
      }
      
      if (!positions || positions.length === 0) {
        DEMO_LOG.info('No open positions on exchange');
        return;
      }
      
      DEMO_LOG.info('Found positions on exchange to sync', { count: positions.length });
      
      for (const pos of positions) {
        // Пропускаем закрытые позиции
        if (!pos.size || Number(pos.size) === 0) {
          continue;
        }
        
        const leverage = Number(pos.leverage);
        const unrealized = Number(pos.unrealisedPnl);
        const avgPrice = Number(pos.avgPrice);
        const size = Number(pos.size);
        
        await this.attachBySymbol(pos.symbol, {
          orderId: pos.symbol,
          exchange: 'bybit',
          mode: 'demo',
          leverage: Number.isFinite(leverage) ? leverage : undefined,
          avgPrice: Number.isFinite(avgPrice) ? avgPrice : undefined,
          filledQty: Number.isFinite(size) ? size : undefined,
          markPrice: Number.isFinite(Number(pos.markPrice)) ? Number(pos.markPrice) : undefined,
          positionValue: Number.isFinite(Number(pos.positionValue)) ? Number(pos.positionValue) : undefined,
          liqPrice: Number.isFinite(Number(pos.liqPrice)) ? Number(pos.liqPrice) : undefined,
          unrealizedPnl: Number.isFinite(unrealized) ? unrealized : undefined,
          status: 'position_sync',
          updatedAt: Date.now(),
        });
      }
      
      DEMO_LOG.info('Position sync completed', { count: positions.length });
      
      // ✅ Broadcast обновленного snapshot
      await this.executionManager.broadcastSnapshot();
    } catch (error: any) {
      DEMO_LOG.error('Failed to sync positions from exchange', { 
        error: error?.message || error 
      });
    }
  }

  stop(): void {
    this.wsClient?.disconnect();
  }

  private async handleMessage(message: BybitWebsocketMessage): Promise<void> {
    if (!message.topic || !message.data) {
      return;
    }

    switch (message.topic) {
      case 'order':
        await this.handleOrderUpdate(Array.isArray(message.data) ? message.data : [message.data]);
        break;
      case 'execution':
        await this.handleExecution(Array.isArray(message.data) ? message.data : [message.data]);
        break;
      case 'position':
        await this.handlePosition(Array.isArray(message.data) ? message.data : [message.data]);
        break;
      default:
        break;
    }
  }

  private async handleOrderUpdate(payload: any[]): Promise<void> {
    for (const item of payload) {
      const details: ExternalExecutionDetails = {
        orderId: item.orderId,
        orderLinkId: item.orderLinkId,
        exchange: 'bybit',
        mode: 'demo',
        leverage: item.leverage ? Number(item.leverage) : undefined,
        status: item.orderStatus,
        filledQty: item.cumExecQty ? Number(item.cumExecQty) : undefined,
        avgPrice: item.avgPrice ? Number(item.avgPrice) : undefined,
        fee: item.cumExecFee ? Number(item.cumExecFee) : undefined,
        feeCurrency: item.feeCurrency,
        updatedAt: Date.now(),
      };

      const positionId = this.resolvePositionId(item);
      if (positionId) {
        await this.executionManager.attachExternalOrder(positionId, details).catch((error) => {
          DEMO_LOG.error('Failed to attach external order', { error: error?.message || error, orderId: item.orderId, positionId });
        });
        continue;
      }

      await this.attachBySymbol(item.symbol, details);
    }
  }

  private async handleExecution(payload: ExecutionReport[]): Promise<void> {
    for (const exec of payload) {
      if (!exec.orderLinkId) {
        continue;
      }

      const details: ExternalExecutionDetails = {
        orderId: exec.orderId,
        orderLinkId: exec.orderLinkId,
        exchange: 'bybit',
        mode: 'demo',
        leverage: undefined,
        status: exec.execType,
        filledQty: Number(exec.execQty),
        avgPrice: Number(exec.execPrice),
        fee: Number(exec.execFee),
        updatedAt: Date.now(),
      };

      const positionId = this.resolvePositionId(exec);
      if (positionId) {
        await this.executionManager.attachExternalOrder(positionId, details).catch((error) => {
          DEMO_LOG.error('Failed to attach execution', { error: error?.message || error, orderId: exec.orderId, positionId });
        });
        continue;
      }

      await this.attachBySymbol(exec.symbol, details);
    }
  }

  private async handlePosition(payload: PositionUpdate[]): Promise<void> {
    DEMO_LOG.debug('Received position update from WebSocket', { count: payload.length });
    
    for (const position of payload) {
      const leverage = Number(position.leverage);
      const unrealized = Number(position.unrealisedPnl);
      const avgPrice = Number(position.avgPrice);
      const size = Number(position.size);

      DEMO_LOG.debug('Processing position update', {
        symbol: position.symbol,
        size,
        unrealizedPnl: unrealized,
        markPrice: position.markPrice,
        avgPrice,
      });

      const details: ExternalExecutionDetails = {
        orderId: position.symbol,
        exchange: 'bybit',
        mode: 'demo',
        leverage: Number.isFinite(leverage) ? leverage : undefined,
        avgPrice: Number.isFinite(avgPrice) ? avgPrice : undefined,
        filledQty: Number.isFinite(size) ? size : undefined,
        status: 'position_update',
        updatedAt: Date.now(),
      };

      await this.attachBySymbol(position.symbol, {
        ...details,
        markPrice: Number.isFinite(Number(position.markPrice)) ? Number(position.markPrice) : undefined,
        positionValue: Number.isFinite(Number(position.positionValue)) ? Number(position.positionValue) : undefined,
        liqPrice: Number.isFinite(Number(position.liqPrice)) ? Number(position.liqPrice) : undefined,
        initialMargin: Number.isFinite(Number(position.positionIM)) ? Number(position.positionIM) : undefined,
        maintenanceMargin: Number.isFinite(Number(position.positionMM)) ? Number(position.positionMM) : undefined,
        unrealizedPnl: Number.isFinite(unrealized) ? unrealized : undefined,
        updatedAt: Date.now(),
      });
    }
  }

  private resolvePositionId(payload: { orderLinkId?: string; orderId?: string; symbol: string }): string | null {
    if (payload.orderLinkId) {
      return payload.orderLinkId;
    }

    return payload.orderId || null;
  }

  private async attachBySymbol(symbol: string, details: ExternalExecutionDetails): Promise<void> {
    const openPositions = await this.executionManager.getOpenPositions();
    DEMO_LOG.debug('Searching for position to attach external data', {
      symbol,
      totalOpenPositions: openPositions.length,
      openSymbols: openPositions.map(p => ({ symbol: p.pairSymbol, mode: p.mode })),
      unrealizedPnl: details.unrealizedPnl,
    });
    
    let match = openPositions.find((pos) => pos.pairSymbol === symbol && pos.mode === 'demo');
    
    // ✅ Если позиция не найдена локально, но существует на бирже - создаём её в БД
    if (!match && details.filledQty && Number(details.filledQty) > 0) {
      DEMO_LOG.warn('Exchange position not tracked locally - creating record', { 
        symbol, 
        size: details.filledQty,
        avgPrice: details.avgPrice,
        unrealizedPnl: details.unrealizedPnl 
      });
      
      // Используем динамический импорт
      const { sessionManager } = await import('./services/SessionManager');
      
      const sessionId = sessionManager.getCurrentSessionId();
      
      if (sessionId) {
        try {
          const filledQty = Number(details.filledQty || 0);
          const direction = filledQty > 0 ? 'long' : 'short';
          const size = Math.abs(filledQty);
          // Используем avgPrice если есть, иначе markPrice (текущая цена)
          const entryPrice = (Number(details.avgPrice) > 0 ? Number(details.avgPrice) : 0) || Number(details.markPrice) || 0;
          
          if (entryPrice === 0) {
            DEMO_LOG.error('Cannot save position without price', { symbol, avgPrice: details.avgPrice, markPrice: details.markPrice });
            return;
          }
          
          DEMO_LOG.debug('Preparing to save exchange position', {
            symbol,
            filledQty,
            direction,
            size,
            entryPrice,
            avgPrice: details.avgPrice,
            markPrice: details.markPrice,
          });
          
          // Сохраняем в БД для восстановления
          const savedTrade = await sessionManager.recordTrade({
            sessionId,
            source: 'scanner',
            mode: 'demo',
            pair: symbol,
            timeframe: '1h',
            direction,
            entryPrice,
            positionSize: size,
            entryTimestamp: new Date(),
            exchange: 'bybit',
          });
          
          DEMO_LOG.info('Exchange position saved to DB', { 
            symbol, 
            sessionId,
            tradeId: savedTrade.id,
            size,
            entryPrice 
          });
          
          // ✅ Немедленно восстанавливаем позицию в памяти
          const tradeData = {
            id: savedTrade.id,
            pair: symbol,
            timeframe: '1h',
            direction,
            entryPrice: savedTrade.entryPrice,
            positionSize: savedTrade.positionSize,
            entryTimestamp: savedTrade.entryTimestamp,
            exchange: 'bybit',
            stopLoss: savedTrade.stopLoss,
            takeProfit: savedTrade.takeProfit,
            sessionId,
          };
          
          // Используем restorePosition если доступен
          if (typeof (this.executionManager as any).restorePosition === 'function') {
            match = await (this.executionManager as any).restorePosition(tradeData);
            
            if (match) {
              await this.executionManager.updatePositionRecord(match.id, { mode: 'demo' });
              
              // 🔥 Обновляем external данные с биржи для корректного PnL
              await this.executionManager.attachExternalOrder(match.id, {
                ...details,
                orderLinkId: details.orderLinkId ?? match.external?.orderLinkId,
                orderId: details.orderId ?? match.external?.orderId,
                updatedAt: Date.now(),
              });
              
              DEMO_LOG.info('Restored position from previous session with PnL data', { 
                positionId: match.id, 
                symbol,
                unrealizedPnl: details.unrealizedPnl,
                markPrice: details.markPrice,
              });
            }
          }
        } catch (error: any) {
          DEMO_LOG.error('Failed to save/restore exchange position', { 
            symbol, 
            error: error?.message || error 
          });
        }
      }
      
      // Если не удалось восстановить немедленно - позиция будет восстановлена при рефреше
      if (!match) {
        return;
      }
    }
    
    if (!match) {
      DEMO_LOG.warn('No matching demo position for symbol and failed to create', { symbol, details });
      return;
    }

    DEMO_LOG.debug('Attaching external data to position', {
      positionId: match.id,
      symbol,
      unrealizedPnl: details.unrealizedPnl,
      markPrice: details.markPrice,
    });

    await this.executionManager.attachExternalOrder(match.id, {
      ...details,
      orderLinkId: details.orderLinkId ?? match.external?.orderLinkId,
      orderId: details.orderId ?? match.external?.orderId,
      updatedAt: Date.now(),
    }).catch((error) => {
      DEMO_LOG.error('Failed to attach aggregated update', { error: error?.message || error, symbol, positionId: match.id });
    });
  }

  /**
   * Получение позиций с биржи Bybit Demo
   */
  async getExchangePositions(symbol?: string): Promise<any[]> {
    if (!this.tradingClient) {
      DEMO_LOG.warn('Trading client not initialized');
      return [];
    }

    try {
      const positions = await this.tradingClient.getPositions(symbol);
      
      DEMO_LOG.debug('Fetched positions from Bybit Demo', {
        count: positions.length,
        symbol,
      });

      return positions;
    } catch (error: any) {
      DEMO_LOG.error('Failed to fetch positions from Bybit Demo', {
        error: error?.message || error,
        symbol,
      });
      return [];
    }
  }

  /**
   * Закрытие позиции на бирже Bybit Demo
   */
  async closeExchangePosition(symbol: string, positionIdx: number = 0): Promise<boolean> {
    if (!this.tradingClient) {
      DEMO_LOG.warn('Trading client not initialized, cannot close position');
      return false;
    }

    try {
      const result = await this.tradingClient.closePosition(symbol, positionIdx);
      
      DEMO_LOG.info('Position closed on Bybit Demo', {
        symbol,
        orderId: result.orderId,
        orderLinkId: result.orderLinkId,
      });

      return true;
    } catch (error: any) {
      DEMO_LOG.error('Failed to close position on Bybit Demo', {
        error: error?.message || error,
        symbol,
        positionIdx,
      });
      return false;
    }
  }

  /**
   * Отмена всех открытых ордеров на бирже Bybit Demo (опционально по символу)
   */
  async cancelAllOrders(symbol?: string): Promise<boolean> {
    if (!this.tradingClient) {
      DEMO_LOG.warn('Trading client not initialized, cannot cancel orders');
      return false;
    }

    try {
      return await this.tradingClient.cancelAllOrders(symbol);
    } catch (error: any) {
      DEMO_LOG.error('Failed to cancel all orders on Bybit Demo', {
        error: error?.message || error,
        symbol,
      });
      return false;
    }
  }

  /**
   * Получение истории ордеров
   */
  async getOrderHistory(params?: { symbol?: string; limit?: number; startTime?: number; endTime?: number }): Promise<any[]> {
    if (!this.tradingClient) {
      DEMO_LOG.warn('Trading client not initialized');
      return [];
    }

    try {
      const orders = await this.tradingClient.getOrderHistory(params);
      
      DEMO_LOG.debug('Fetched order history from Bybit Demo', {
        count: orders.length,
        symbol: params?.symbol,
      });

      return orders;
    } catch (error: any) {
      DEMO_LOG.error('Failed to fetch order history from Bybit Demo', {
        error: error?.message || error,
      });
      return [];
    }
  }

  /**
   * Получение истории сделок
   */
  async getTradeHistory(params?: { symbol?: string; limit?: number; startTime?: number; endTime?: number }): Promise<any[]> {
    if (!this.tradingClient) {
      DEMO_LOG.warn('Trading client not initialized');
      return [];
    }

    try {
      const trades = await this.tradingClient.getTradeHistory(params);
      
      DEMO_LOG.debug('Fetched trade history from Bybit Demo', {
        count: trades.length,
        symbol: params?.symbol,
      });

      return trades;
    } catch (error: any) {
      DEMO_LOG.error('Failed to fetch trade history from Bybit Demo', {
        error: error?.message || error,
      });
      return [];
    }
  }

  /**
   * Получение закрытого PnL
   */
  async getClosedPnL(params?: { symbol?: string; limit?: number; startTime?: number; endTime?: number }): Promise<any[]> {
    if (!this.tradingClient) {
      DEMO_LOG.warn('Trading client not initialized');
      return [];
    }

    try {
      const pnl = await this.tradingClient.getClosedPnL(params);
      
      DEMO_LOG.debug('Fetched closed PnL from Bybit Demo', {
        count: pnl.length,
        symbol: params?.symbol,
      });

      return pnl;
    } catch (error: any) {
      DEMO_LOG.error('Failed to fetch closed PnL from Bybit Demo', {
        error: error?.message || error,
      });
      return [];
    }
  }

  /**
   * Подсчет суммарного PnL
   */
  async calculateTotalPnL(symbol?: string): Promise<any> {
    if (!this.tradingClient) {
      DEMO_LOG.warn('Trading client not initialized');
      return {
        realizedPnL: 0,
        unrealizedPnL: 0,
        totalPnL: 0,
        closedTrades: 0,
        openPositions: 0,
        details: { positions: [], closedPnL: [] },
      };
    }

    try {
      const result = await this.tradingClient.calculateTotalPnL(symbol);
      
      DEMO_LOG.info('Calculated total PnL for Bybit Demo', {
        symbol: symbol || 'all',
        totalPnL: result.totalPnL,
        realizedPnL: result.realizedPnL,
        unrealizedPnL: result.unrealizedPnL,
      });

      return result;
    } catch (error: any) {
      DEMO_LOG.error('Failed to calculate total PnL for Bybit Demo', {
        error: error?.message || error,
      });
      return {
        realizedPnL: 0,
        unrealizedPnL: 0,
        totalPnL: 0,
        closedTrades: 0,
        openPositions: 0,
        details: { positions: [], closedPnL: [] },
      };
    }
  }
}
