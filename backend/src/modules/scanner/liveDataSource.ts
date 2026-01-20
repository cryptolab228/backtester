import axios, { AxiosInstance } from 'axios';

import logger from '@/utils/logger';
import { bybitGlobalRateLimiter, getRateLimiter, SmartRateLimiter } from '@/services/smartRateLimiter';
import { CandleData } from '@/interfaces/marketData.interface';

import { ExchangeName, MarketDataSource, MarketDataSourceOptions } from './scanner.types';

const LIVE_LOG = logger.child({ module: 'LiveMarketDataSource' });

const BYBIT_BASE_URL = process.env.BYBIT_API_URL || 'https://api.bybit.com';
const BYBIT_CATEGORY = 'linear';
const OKX_BASE_URL = process.env.OKX_API_URL || 'https://www.okx.com';
const OKX_BAR_ENDPOINT = '/api/v5/market/candles';

const MAX_API_LIMIT = 1000;
const CACHE_LIMIT_PER_SERIES = 600;
const MIN_REFRESH_MS = 2000;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 500;

const TIMEFRAME_INTERVAL_MAP: Record<string, string> = {
  '1m': '1',
  '3m': '3',
  '5m': '5',
  '15m': '15',
  '30m': '30',
  '1h': '60',
  '2h': '120',
  '4h': '240',
  '6h': '360',
  '12h': '720',
  '1d': 'D',
  '1w': 'W',
  '1M': 'M',
};

const OKX_TIMEFRAME_INTERVAL_MAP: Record<string, string> = {
  '1m': '1m',
  '3m': '3m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1H',
  '2h': '2H',
  '4h': '4H',
  '6h': '6H',
  '12h': '12H',
  '1d': '1D',
  '1w': '1W',
  '1M': '1M',
};


const TIMEFRAME_MS_MAP: Record<string, number> = {
  '1m': 60_000,
  '3m': 3 * 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 60 * 60_000,
  '2h': 2 * 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '6h': 6 * 60 * 60_000,
  '12h': 12 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
  '1w': 7 * 24 * 60 * 60_000,
  '1M': 30 * 24 * 60 * 60_000,
};

interface BybitKlineResponse {
  retCode: number;
  retMsg: string;
  result?: {
    list: string[][];
  };
  time: number;
}

interface OkxKlineResponse {
  code: string;
  msg: string;
  data?: string[][];
}

interface CacheEntry {
  candles: CandleData[];
  fetchedAt: number;
}

export class LiveMarketDataSource implements MarketDataSource {
  private cache = new Map<string, CacheEntry>();
  private readonly axiosClient: AxiosInstance;
  private readonly exchange: ExchangeName;
  private readonly rateLimiter: SmartRateLimiter;

  constructor(exchange: ExchangeName = 'bybit', client?: AxiosInstance, rateLimiter?: SmartRateLimiter) {
    this.exchange = exchange;
    this.axiosClient = client || axios.create({ timeout: 10_000 });
    this.rateLimiter = rateLimiter || getRateLimiter(exchange);
  }

  async getLatestCandles(pairSymbol: string, timeframe: string, limit: number, options?: MarketDataSourceOptions): Promise<CandleData[]> {
    const targetExchange = options?.exchange || this.exchange;

    const cacheKey = `${targetExchange}:${pairSymbol}:${timeframe}`;
    const now = Date.now();
    const intervalMs = TIMEFRAME_MS_MAP[timeframe] || MIN_REFRESH_MS;

    const cached = this.cache.get(cacheKey);
    const shouldRefresh = !cached || now - cached.fetchedAt >= Math.max(intervalMs / 2, MIN_REFRESH_MS);

    if (shouldRefresh) {
      try {
        const fetchLimit = Math.max(limit * 2, limit);
        const fresh = await this.fetchWithRetry(targetExchange, pairSymbol, timeframe, fetchLimit);
        const normalized = this.mergePartialCandle(targetExchange, timeframe, fresh, now);
        if (normalized.length > 0) {
          const trimmed = normalized.slice(-CACHE_LIMIT_PER_SERIES);
          this.cache.set(cacheKey, { candles: trimmed, fetchedAt: now });
        } else if (!cached) {
          this.cache.set(cacheKey, { candles: [], fetchedAt: now });
        } else {
          cached.fetchedAt = now;
        }
      } catch (error: any) {
        LIVE_LOG.error('Failed to fetch live candles from %s for %s %s: %s', targetExchange, pairSymbol, timeframe, error?.message || error);
      }
    }

    const latest = this.cache.get(cacheKey)?.candles ?? [];
    return latest.slice(-limit);
  }

  private mergePartialCandle(exchange: ExchangeName, timeframe: string, candles: CandleData[], now: number): CandleData[] {
    if (!candles.length) {
      return candles;
    }

    const intervalMs = TIMEFRAME_MS_MAP[timeframe];
    if (!intervalMs) {
      return candles;
    }

    const withIncomplete = [...candles];
    const last = withIncomplete[withIncomplete.length - 1];

    if (now - last.timestamp < intervalMs && now >= last.timestamp) {
      const projectedClose = last.close;
      const estimated = {
        ...last,
        close: projectedClose,
        high: Math.max(last.high, projectedClose),
        low: Math.min(last.low, projectedClose),
      };
      withIncomplete[withIncomplete.length - 1] = estimated;
    }

    return withIncomplete;
  }

  private async fetchWithRetry(exchange: ExchangeName, pairSymbol: string, timeframe: string, limit: number): Promise<CandleData[]> {
    let attempt = 0;
    let lastError: any = null;

    while (attempt < MAX_RETRIES) {
      try {
        attempt++;
        return await this.fetchFromExchange(exchange, pairSymbol, timeframe, limit);
      } catch (error: any) {
        lastError = error;
        const delay = RETRY_BACKOFF_MS * attempt;
        LIVE_LOG.warn('Retrying fetch for %s %s %s (attempt %d/%d, delay %dms): %s', exchange, pairSymbol, timeframe, attempt, MAX_RETRIES, delay, error?.message || error);
        if (attempt >= MAX_RETRIES) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError ?? new Error('Unknown error fetching candles');
  }

  private async fetchFromExchange(exchange: ExchangeName, pairSymbol: string, timeframe: string, limit: number): Promise<CandleData[]> {
    switch (exchange) {
      case 'okx':
        return this.fetchFromOkx(pairSymbol, timeframe, limit);
      case 'bybit':
      default:
        return this.fetchFromBybit(pairSymbol, timeframe, limit);
    }
  }

  private async fetchFromBybit(pairSymbol: string, timeframe: string, limit: number): Promise<CandleData[]> {
    const interval = TIMEFRAME_INTERVAL_MAP[timeframe];
    if (!interval) {
      LIVE_LOG.error('Unsupported timeframe requested for Bybit: %s', timeframe);
      return [];
    }

    await this.rateLimiter.waitForSlot(pairSymbol);

    const params = {
      category: BYBIT_CATEGORY,
      symbol: pairSymbol,
      interval,
      end: Date.now(),
      limit: Math.min(Math.max(limit, 50), MAX_API_LIMIT),
    };

    const url = `${BYBIT_BASE_URL}/v5/market/kline`;

    const response = await this.axiosClient.get<BybitKlineResponse>(url, { params });
    await this.rateLimiter.recordRequest(pairSymbol);

    if (!response.data || response.data.retCode !== 0 || !response.data.result?.list) {
      throw new Error(response.data?.retMsg || 'Bybit kline request failed');
    }

    return response.data.result.list
      .map<CandleData>((item) => ({
        timestamp: parseInt(item[0], 10),
        open: parseFloat(item[1]),
        high: parseFloat(item[2]),
        low: parseFloat(item[3]),
        close: parseFloat(item[4]),
        volume: parseFloat(item[5]),
        volumeQuote: item[6] ? parseFloat(item[6]) : undefined,
      }))
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  private async fetchFromOkx(pairSymbol: string, timeframe: string, limit: number): Promise<CandleData[]> {
    const interval = OKX_TIMEFRAME_INTERVAL_MAP[timeframe];
    if (!interval) {
      LIVE_LOG.error('Unsupported timeframe requested for OKX: %s', timeframe);
      return [];
    }

    await this.rateLimiter.waitForSlot(pairSymbol);

    const params = {
      instId: pairSymbol,
      bar: interval,
      limit: Math.min(Math.max(limit, 50), 1000),
    };

    const response = await this.axiosClient.get<OkxKlineResponse>(`${OKX_BASE_URL}${OKX_BAR_ENDPOINT}`, { params });
    await this.rateLimiter.recordRequest(pairSymbol);

    if (response.data.code !== '0' || !response.data.data) {
      throw new Error(response.data.msg || 'OKX candlestick request failed');
    }

    return response.data.data
      .map<CandleData>((item) => ({
        timestamp: parseInt(item[0], 10),
        open: parseFloat(item[1]),
        high: parseFloat(item[2]),
        low: parseFloat(item[3]),
        close: parseFloat(item[4]),
        volume: parseFloat(item[5]),
        volumeQuote: item[7] ? parseFloat(item[7]) : undefined,
      }))
      .sort((a, b) => a.timestamp - b.timestamp);
  }
}

export default LiveMarketDataSource;

