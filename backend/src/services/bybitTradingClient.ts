import { RestClientV5 } from 'bybit-api';

import logger from '@/utils/logger';

export type BybitCategory = 'linear' | 'inverse' | 'option' | 'spot';
export type BybitAccountType = 'UNIFIED' | 'CONTRACT' | 'OPTIONS' | 'SPOT' | 'INVESTMENT';

export interface BybitTradingClientConfig {
  apiKey: string;
  apiSecret: string;
  apiUrl: string;
  category?: BybitCategory;
  accountType?: BybitAccountType;
  recvWindowMs?: number;
}

export interface CreateOrderParams {
  symbol: string;
  side: 'Buy' | 'Sell';
  orderType?: 'Market' | 'Limit';
  qty: number;
  price?: number;
  entryPrice?: number;
  timeInForce?: 'GTC' | 'IOC' | 'FOK' | 'PostOnly';
  reduceOnly?: boolean;
  closeOnTrigger?: boolean;
  orderLinkId?: string;
  positionIdx?: number;
  takeProfit?: number;
  stopLoss?: number;
  tpTriggerBy?: string;
  slTriggerBy?: string;
  leverage?: number;
}

export interface CreateOrderResult {
  orderId: string;
  orderLinkId?: string;
  orderStatus?: string;
  createTime?: number;
}

export interface SetLeverageParams {
  symbol: string;
  buyLeverage: number;
  sellLeverage: number;
}

export interface AccountBalanceResult {
  accountType: string;
  walletBalance: number;
  availableBalance: number;
  totalEquity?: number;
  totalInitialMargin?: number;
  totalMaintenanceMargin?: number;
  updatedTime?: number;
  coins?: Record<string, { wallet: number; available: number; usdValue?: number }>;
}

export interface PositionInfo {
  symbol: string;
  side: 'Buy' | 'Sell' | 'None';
  size: string;
  positionValue: string;
  entryPrice: string;
  markPrice: string;
  liqPrice: string;
  leverage: string;
  unrealisedPnl: string;
  cumRealisedPnl: string;
  takeProfit: string;
  stopLoss: string;
  trailingStop: string;
  positionIdx: number;
  createdTime: string;
  updatedTime: string;
}

export interface OrderHistoryItem {
  orderId: string;
  orderLinkId: string;
  symbol: string;
  side: 'Buy' | 'Sell';
  orderType: string;
  price: string;
  qty: string;
  cumExecQty: string;
  cumExecValue: string;
  cumExecFee: string;
  orderStatus: string;
  avgPrice: string;
  createdTime: string;
  updatedTime: string;
  reduceOnly: boolean;
  closeOnTrigger: boolean;
}

export interface TradeHistoryItem {
  execId: string;
  orderId: string;
  orderLinkId: string;
  symbol: string;
  side: 'Buy' | 'Sell';
  execPrice: string;
  execQty: string;
  execFee: string;
  execTime: string;
  execType: string;
  feeRate: string;
  closedSize?: string;
}

export interface ClosedPnLItem {
  symbol: string;
  orderId: string;
  side: 'Buy' | 'Sell';
  qty: string;
  orderPrice: string;
  orderType: string;
  execType: string;
  closedSize: string;
  cumEntryValue: string;
  avgEntryPrice: string;
  cumExitValue: string;
  avgExitPrice: string;
  closedPnl: string;
  fillCount: string;
  leverage: string;
  createdTime: string;
  updatedTime: string;
}

interface BybitResponse<T> {
  retCode: number;
  retMsg: string;
  result: T;
  time: number;
}

const CLIENT_LOG = logger.child({ module: 'BybitTradingClient' });
const DEFAULT_ACCOUNT_TYPE: BybitAccountType = 'UNIFIED';
const DEFAULT_RECV_WINDOW_MS = 60_000;

interface InstrumentInfo {
  lotSizeFilter?: {
    minOrderQty?: string;
    maxOrderQty?: string;
    qtyStep?: string;
  };
}

export class BybitTradingClient {
  private readonly client: RestClientV5;
  private readonly accountType: BybitAccountType;
  private readonly category: BybitCategory;
  private readonly recvWindow: number;
  private leverageCache = new Map<string, { buy: number; sell: number }>();
  private instrumentCache = new Map<string, { step: number; minQty?: number; minNotional?: number }>();

  constructor(config: BybitTradingClientConfig) {
    const apiKey = (config.apiKey || '').trim();
    const apiSecret = (config.apiSecret || '').trim();

    if (!apiKey || !apiSecret) {
      CLIENT_LOG.warn('BybitTradingClient initialized without credentials');
    }

    this.accountType = config.accountType ?? DEFAULT_ACCOUNT_TYPE;
    this.category = config.category ?? 'linear';
    this.recvWindow = config.recvWindowMs ?? DEFAULT_RECV_WINDOW_MS;

    const restOptions: Record<string, unknown> = {};
    if (config.apiUrl) {
      restOptions.baseUrl = config.apiUrl;
    }

    const isDemo = /demo/i.test(config.apiUrl);
    const isTestnet = /testnet/i.test(config.apiUrl);

    this.client = new RestClientV5({
      key: apiKey,
      secret: apiSecret,
      testnet: isTestnet && !isDemo,
      demoTrading: isDemo,
      recv_window: this.recvWindow,
      enable_time_sync: true,
      strict_param_validation: false,
      restOptions,
    } as any);
  }

  async ensureLeverage(params: SetLeverageParams): Promise<void> {
    if (!this.client) {
      return;
    }

    const cached = this.leverageCache.get(params.symbol);
    if (cached && cached.buy === params.buyLeverage && cached.sell === params.sellLeverage) {
      return;
    }

    await this.client.setLeverage({
      category: this.category as any,
      symbol: params.symbol,
      buyLeverage: params.buyLeverage.toString(),
      sellLeverage: params.sellLeverage.toString(),
    });

    this.leverageCache.set(params.symbol, {
      buy: params.buyLeverage,
      sell: params.sellLeverage,
    });
  }

  async createOrder(params: CreateOrderParams): Promise<CreateOrderResult> {
    const normalizedQty = await this.normalizeQuantity(params.symbol, params.qty, params.entryPrice ?? params.price);

    try {
      const response = await this.client.submitOrder({
        category: this.category as any,
        symbol: params.symbol,
        side: params.side,
        orderType: params.orderType ?? 'Market',
        qty: normalizedQty.toString(),
        price: params.price !== undefined ? params.price.toString() : undefined,
        timeInForce: params.timeInForce ?? (params.orderType === 'Limit' ? 'GTC' : 'IOC'),
        reduceOnly: params.reduceOnly,
        closeOnTrigger: params.closeOnTrigger,
        orderLinkId: params.orderLinkId,
        positionIdx: params.positionIdx as any,
        takeProfit: params.takeProfit !== undefined ? params.takeProfit.toString() : undefined,
        stopLoss: params.stopLoss !== undefined ? params.stopLoss.toString() : undefined,
        tpTriggerBy: params.tpTriggerBy as any,
        slTriggerBy: params.slTriggerBy as any,
      } as any);

      if (response.retCode !== 0) {
        CLIENT_LOG.error('Bybit order rejected', {
          symbol: params.symbol,
          side: params.side,
          qty: normalizedQty,
          orderType: params.orderType ?? 'Market',
          retCode: response.retCode,
          retMsg: response.retMsg,
          result: response.result,
          takeProfit: params.takeProfit,
          stopLoss: params.stopLoss,
        });
        throw new Error(response.retMsg || 'Bybit create order failed');
      }

      const resultData = response.result as any;
      CLIENT_LOG.info('Bybit order submitted', {
        orderId: resultData?.orderId,
        orderStatus: resultData?.orderStatus,
      });

      return response.result as any as CreateOrderResult;
    } catch (error: any) {
      CLIENT_LOG.error('Bybit submitOrder threw exception', {
        symbol: params.symbol,
        side: params.side,
        qty: normalizedQty,
        orderType: params.orderType ?? 'Market',
        price: params.price,
        retCode: error?.retCode || error?.code,
        retMsg: error?.retMsg || error?.message,
        response: error?.response?.data,
        status: error?.response?.status,
      });

      throw new Error(error?.message || 'Bybit submitOrder failed');
    }
  }

  private async normalizeQuantity(symbol: string, requestedQty: number, price?: number): Promise<number> {
    if (!Number.isFinite(requestedQty) || requestedQty <= 0) {
      throw new Error('Invalid quantity requested');
    }

    const instrument = await this.getInstrumentInfo(symbol);
    const step = instrument?.step ?? 0;
    const minQty = instrument?.minQty ?? 0;
    const minNotional = instrument?.minNotional ?? 0;

    let qty = requestedQty;
    if (step > 0) {
      qty = Math.floor(qty / step) * step;
    }

    if (qty <= 0) {
      throw new Error('Quantity rounded to zero by lot size');
    }

    if (minQty > 0 && qty < minQty) {
      throw new Error(`Quantity ${qty} below min qty ${minQty}`);
    }

    if (minNotional > 0 && price && qty * price < minNotional) {
      throw new Error(`Notional ${qty * price} below min notional ${minNotional}`);
    }

    return Number(qty.toFixed(step > 0 ? Math.max(0, `${step}`.split('.')[1]?.length || 0) : 8));
  }

  private async getInstrumentInfo(symbol: string): Promise<{ step: number; minQty?: number; minNotional?: number }> {
    const cached = this.instrumentCache.get(symbol);
    if (cached) {
      return cached;
    }

    const response = await this.client.getInstrumentsInfo({ category: this.category as any, symbol } as any);
    if (response.retCode !== 0) {
      CLIENT_LOG.warn('Failed to fetch instrument info', { symbol, retCode: response.retCode, retMsg: response.retMsg });
      const fallback = { step: 0.001 };
      this.instrumentCache.set(symbol, fallback);
      return fallback;
    }

    const instrumentRaw = response.result?.list?.[0] as any;
    const lot = instrumentRaw?.lotSizeFilter || {};
    const step = Number(lot.qtyStep ?? lot.minOrderQty ?? 0.001);
    const minQty = lot.minOrderQty ? Number(lot.minOrderQty) : undefined;
    const minNotional = instrumentRaw?.minOrderAmt ? Number(instrumentRaw.minOrderAmt) : undefined;

    const info = { step, minQty, minNotional };
    this.instrumentCache.set(symbol, info);
    return info;
  }

  async getAccountBalance(accountType: string = this.accountType): Promise<AccountBalanceResult | null> {
    const response = await this.client.getWalletBalance({ accountType: accountType as any } as any);

    if (response.retCode !== 0) {
      if (response.retCode === 10001 && accountType !== 'UNIFIED') {
        CLIENT_LOG.warn('Bybit accountType unsupported, retrying with UNIFIED', {
          requested: accountType,
          retCode: response.retCode,
          retMsg: response.retMsg,
        });
        return this.getAccountBalance('UNIFIED');
      }
      CLIENT_LOG.error('Wallet balance request returned non-zero code', response);
      throw new Error(response.retMsg || 'Bybit wallet balance request failed');
    }

    const first = response.result?.list?.[0] as any;
    if (!first) {
      CLIENT_LOG.warn('Wallet balance response without accounts', { result: response.result });
      return null;
    }

    const walletFromTopLevel = Number(first.totalWalletBalance ?? first.walletBalance ?? 0);
    const availableFromTopLevel = Number(first.totalAvailableBalance ?? first.availableBalance ?? 0);

    const coinArray = Array.isArray(first.coin) ? (first.coin as any[]) : [];
    const walletFromCoins = coinArray.reduce((sum: number, coin: any) => {
      const usdValue = Number(coin.usdValue ?? coin.equity ?? coin.walletBalance ?? 0);
      return Number.isFinite(usdValue) && usdValue > 0 ? sum + usdValue : sum;
    }, 0);

    const availableFromCoins = coinArray.reduce((sum: number, coin: any) => {
      const usdValue = Number(coin.usdValue ?? coin.equity ?? coin.walletBalance ?? 0);
      const walletRaw = Number(coin.walletBalance ?? 0);
      const availableRaw = Number(coin.availableToWithdraw ?? coin.availableBalance ?? walletRaw);

      if (!Number.isFinite(availableRaw) || availableRaw <= 0) {
        return sum;
      }

      if (usdValue > 0 && Number.isFinite(walletRaw) && walletRaw > 0) {
        return sum + (usdValue * (availableRaw / walletRaw));
      }

      return sum + availableRaw;
    }, 0);

    const coinsMap: AccountBalanceResult['coins'] = coinArray.reduce((acc: Record<string, { wallet: number; available: number; usdValue?: number }>, coin: any) => {
      if (!coin || typeof coin.coin !== 'string') {
        return acc;
      }
      const symbol = coin.coin.toUpperCase();
      const walletRaw = Number(coin.walletBalance ?? 0);
      const availableRaw = Number(coin.availableToWithdraw ?? coin.availableBalance ?? walletRaw);
      const usdValue = Number(coin.usdValue ?? coin.equity ?? undefined);

      acc[symbol] = {
        wallet: Number.isFinite(walletRaw) ? walletRaw : 0,
        available: Number.isFinite(availableRaw) ? availableRaw : 0,
        usdValue: Number.isFinite(usdValue) ? usdValue : undefined,
      };

      return acc;
    }, {});

    const walletBalance = walletFromCoins > 0 ? walletFromCoins : walletFromTopLevel;
    const availableBalance = availableFromCoins > 0 ? availableFromCoins : availableFromTopLevel;

    return {
      accountType: (first.accountType || accountType) as string,
      walletBalance: Number.isFinite(walletBalance) ? walletBalance : 0,
      availableBalance: Number.isFinite(availableBalance) ? availableBalance : 0,
      totalEquity: Number(first.totalEquity ?? first.equity ?? walletBalance) || undefined,
      totalInitialMargin: Number(first.totalInitialMargin ?? first.totalIM) || undefined,
      totalMaintenanceMargin: Number(first.totalMaintenanceMargin ?? first.totalMM) || undefined,
      updatedTime: first.updatedTime ? Number(first.updatedTime) : undefined,
      coins: coinsMap,
    };
  }

  /**
   * Получение списка открытых позиций
   */
  async getPositions(symbol?: string): Promise<PositionInfo[]> {
    if (!this.client) {
      CLIENT_LOG.warn('Bybit client not initialized, cannot fetch positions');
      return [];
    }

    try {
      const params: any = {
        category: this.category as any,
      };
      
      if (symbol) {
        params.symbol = symbol;
      } else {
        // Если не передан symbol, обязательно нужен settleCoin
        params.settleCoin = 'USDT';
      }

      const response = await this.client.getPositionInfo(params as any);

      if (response.retCode !== 0) {
        CLIENT_LOG.error('Failed to fetch positions from Bybit', {
          retCode: response.retCode,
          retMsg: response.retMsg,
        });
        return [];
      }

      const positionsRaw = (response.result?.list || []) as any[];

      return positionsRaw
        .map((pos: any): PositionInfo => ({
          symbol: String(pos.symbol || ''),
          side: pos.side || 'None',
          size: String(pos.size || '0'),
          positionValue: String(pos.positionValue || '0'),
          entryPrice: String(pos.entryPrice || '0'),
          markPrice: String(pos.markPrice || '0'),
          liqPrice: String(pos.liqPrice || '0'),
          leverage: String(pos.leverage || '0'),
          unrealisedPnl: String(pos.unrealisedPnl || pos.unrealizedPnl || '0'),
          cumRealisedPnl: String(pos.cumRealisedPnl || pos.cumRealizedPnl || '0'),
          takeProfit: String(pos.takeProfit || '0'),
          stopLoss: String(pos.stopLoss || '0'),
          trailingStop: String(pos.trailingStop || '0'),
          positionIdx: Number(pos.positionIdx ?? 0),
          createdTime: String(pos.createdTime || Date.now()),
          updatedTime: String(pos.updatedTime || Date.now()),
        }))
        .filter((pos) => parseFloat(pos.size || '0') > 0);
    } catch (error: any) {
      CLIENT_LOG.error('Exception while fetching positions', {
        error: error?.message || error,
      });
      return [];
    }
  }

  /**
   * Закрытие позиции маркет-ордером
   */
  async closePosition(symbol: string, positionIdx: number = 0): Promise<CreateOrderResult> {
    if (!this.client) {
      throw new Error('Bybit client not initialized');
    }

    // Получаем информацию о позиции
    const positions = await this.getPositions(symbol);
    const position = positions.find(p => p.positionIdx === positionIdx);

    if (!position) {
      throw new Error(`No open position found for ${symbol} with positionIdx ${positionIdx}`);
    }

    const size = parseFloat(position.size);
    if (size <= 0) {
      throw new Error(`Position size is 0 for ${symbol}`);
    }

    // Определяем направление закрывающего ордера (противоположное позиции)
    const side = position.side === 'Buy' ? 'Sell' : 'Buy';

    const orderParams: any = {
      category: this.category as any,
      symbol,
      side,
      orderType: 'Market',
      qty: position.size,
      reduceOnly: true, // Важно! Только закрытие позиции
      positionIdx,
    };

    try {
      const response = await this.client.submitOrder(orderParams as any);

      if (response.retCode !== 0) {
        CLIENT_LOG.error('Bybit close position rejected', {
          symbol,
          side,
          qty: position.size,
          retCode: response.retCode,
          retMsg: response.retMsg,
        });
        throw new Error(response.retMsg || 'Close position failed');
      }

      CLIENT_LOG.info('Position closed successfully', {
        symbol,
        side,
        qty: position.size,
        orderId: response.result?.orderId,
      });

      const resultData = response.result as any;
      return {
        orderId: resultData?.orderId || '',
        orderLinkId: resultData?.orderLinkId,
        orderStatus: resultData?.orderStatus,
      };
    } catch (error: any) {
      CLIENT_LOG.error('Failed to close position', {
        symbol,
        payload: orderParams,
        error: error?.message || error,
      });
      throw error;
    }
  }

  /**
   * Отмена всех открытых ордеров (опционально по символу)
   */
  async cancelAllOrders(symbol?: string): Promise<boolean> {
    if (!this.client) {
      throw new Error('Bybit client not initialized');
    }

    const cancelFn = (this.client as any).cancelAllOrders;
    if (typeof cancelFn !== 'function') {
      CLIENT_LOG.warn('Bybit client does not support cancelAllOrders');
      return false;
    }

    try {
      const response = await cancelFn.call(this.client, {
        category: this.category as any,
        symbol: symbol || undefined,
      } as any);

      if (response?.retCode !== 0) {
        CLIENT_LOG.error('Bybit cancelAllOrders rejected', {
          symbol,
          retCode: response?.retCode,
          retMsg: response?.retMsg,
        });
        return false;
      }

      CLIENT_LOG.info('Bybit cancelAllOrders executed', { symbol: symbol || 'all' });
      return true;
    } catch (error: any) {
      CLIENT_LOG.error('Failed to cancel orders', {
        symbol,
        error: error?.message || error,
      });
      return false;
    }
  }

  /**
   * Получение истории ордеров
   */
  async getOrderHistory(params?: {
    symbol?: string;
    limit?: number;
    startTime?: number;
    endTime?: number;
  }): Promise<OrderHistoryItem[]> {
    if (!this.client) {
      CLIENT_LOG.warn('Bybit client not initialized, cannot fetch order history');
      return [];
    }

    try {
      const requestParams: any = {
        category: this.category as any,
        limit: params?.limit || 50,
      };

      if (params?.symbol) requestParams.symbol = params.symbol;
      if (params?.startTime) requestParams.startTime = params.startTime;
      if (params?.endTime) requestParams.endTime = params.endTime;

      const response = await this.client.getHistoricOrders(requestParams as any);

      if (response.retCode !== 0) {
        CLIENT_LOG.error('Failed to fetch order history from Bybit', {
          retCode: response.retCode,
          retMsg: response.retMsg,
        });
        return [];
      }

      return (response.result?.list || []) as OrderHistoryItem[];
    } catch (error: any) {
      CLIENT_LOG.error('Exception while fetching order history', {
        error: error?.message || error,
      });
      return [];
    }
  }

  /**
   * Получение истории сделок (executions)
   */
  async getTradeHistory(params?: {
    symbol?: string;
    limit?: number;
    startTime?: number;
    endTime?: number;
  }): Promise<TradeHistoryItem[]> {
    if (!this.client) {
      CLIENT_LOG.warn('Bybit client not initialized, cannot fetch trade history');
      return [];
    }

    try {
      const requestParams: any = {
        category: this.category as any,
        limit: params?.limit || 50,
      };

      if (params?.symbol) requestParams.symbol = params.symbol;
      if (params?.startTime) requestParams.startTime = params.startTime;
      if (params?.endTime) requestParams.endTime = params.endTime;

      const response = await this.client.getExecutionList(requestParams as any);

      if (response.retCode !== 0) {
        CLIENT_LOG.error('Failed to fetch trade history from Bybit', {
          retCode: response.retCode,
          retMsg: response.retMsg,
        });
        return [];
      }

      return (response.result?.list || []) as TradeHistoryItem[];
    } catch (error: any) {
      CLIENT_LOG.error('Exception while fetching trade history', {
        error: error?.message || error,
      });
      return [];
    }
  }

  /**
   * Получение истории закрытого PnL
   */
  async getClosedPnL(params?: {
    symbol?: string;
    limit?: number;
    startTime?: number;
    endTime?: number;
  }): Promise<ClosedPnLItem[]> {
    if (!this.client) {
      CLIENT_LOG.warn('Bybit client not initialized, cannot fetch closed PnL');
      return [];
    }

    try {
      const requestParams: any = {
        category: this.category as any,
        limit: params?.limit || 50,
      };

      if (params?.symbol) requestParams.symbol = params.symbol;
      if (params?.startTime) requestParams.startTime = params.startTime;
      if (params?.endTime) requestParams.endTime = params.endTime;

      const response = await this.client.getClosedPnL(requestParams as any);

      if (response.retCode !== 0) {
        CLIENT_LOG.error('Failed to fetch closed PnL from Bybit', {
          retCode: response.retCode,
          retMsg: response.retMsg,
        });
        return [];
      }

      return (response.result?.list || []) as ClosedPnLItem[];
    } catch (error: any) {
      CLIENT_LOG.error('Exception while fetching closed PnL', {
        error: error?.message || error,
      });
      return [];
    }
  }

  /**
   * Подсчет суммарного PnL (реализованный + нереализованный)
   */
  async calculateTotalPnL(symbol?: string): Promise<{
    realizedPnL: number;
    unrealizedPnL: number;
    totalPnL: number;
    closedTrades: number;
    openPositions: number;
    details: {
      positions: PositionInfo[];
      closedPnL: ClosedPnLItem[];
    };
  }> {
    try {
      // Получаем открытые позиции
      const positions = await this.getPositions(symbol);
      
      // Получаем закрытый PnL за последние 7 дней
      const endTime = Date.now();
      const startTime = endTime - (7 * 24 * 60 * 60 * 1000);
      const closedPnL = await this.getClosedPnL({
        symbol,
        startTime,
        endTime,
        limit: 100,
      });

      // Подсчитываем нереализованный PnL из открытых позиций
      const unrealizedPnL = positions.reduce((sum, pos) => {
        const pnl = parseFloat(pos.unrealisedPnl || '0');
        return sum + (Number.isFinite(pnl) ? pnl : 0);
      }, 0);

      // Подсчитываем реализованный PnL из закрытых позиций
      const realizedPnL = closedPnL.reduce((sum, item) => {
        const pnl = parseFloat(item.closedPnl || '0');
        return sum + (Number.isFinite(pnl) ? pnl : 0);
      }, 0);

      const totalPnL = realizedPnL + unrealizedPnL;

      CLIENT_LOG.info('Calculated total PnL', {
        symbol: symbol || 'all',
        realizedPnL,
        unrealizedPnL,
        totalPnL,
        closedTrades: closedPnL.length,
        openPositions: positions.length,
      });

      return {
        realizedPnL,
        unrealizedPnL,
        totalPnL,
        closedTrades: closedPnL.length,
        openPositions: positions.length,
        details: {
          positions,
          closedPnL,
        },
      };
    } catch (error: any) {
      CLIENT_LOG.error('Failed to calculate total PnL', {
        error: error?.message || error,
        symbol,
      });
      
      return {
        realizedPnL: 0,
        unrealizedPnL: 0,
        totalPnL: 0,
        closedTrades: 0,
        openPositions: 0,
        details: {
          positions: [],
          closedPnL: [],
        },
      };
    }
  }
}

