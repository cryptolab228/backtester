import logger from '@/utils/logger';
import LiveMarketDataSource from './liveDataSource';
import type { ExchangeName } from './scanner.types';

const METRICS_LOG = logger.child({ module: 'ScannerPairMetrics' });

export interface PairMetricsRequest {
  exchange: ExchangeName;
  metric: 'volume' | 'volatility';
  period: 7 | 14 | 30;
}

export interface PairMetricsResponseItem {
  symbol: string;
  exchange: ExchangeName;
  metricValue: number;
  candlesAnalyzed: number;
}

export interface PairMetricsResponse {
  exchange: ExchangeName;
  metric: 'volume' | 'volatility';
  period: number;
  pairs: PairMetricsResponseItem[];
  generatedAt: number;
}

const CACHE_TTL_MS = 3 * 60 * 1000; // 3 минуты
const MAX_CONCURRENT_REQUESTS = 4;

const metricsCache = new Map<string, { payload: PairMetricsResponse; expiresAt: number }>();
const dataSources: Record<ExchangeName, LiveMarketDataSource> = {
  bybit: new LiveMarketDataSource('bybit'),
  okx: new LiveMarketDataSource('okx'),
};

const DEFAULT_SYMBOLS: Record<ExchangeName, string[]> = {
  bybit: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'TONUSDT', 'DOGEUSDT', 'APEUSDT'],
  okx: ['BTC-USDT-SWAP', 'ETH-USDT-SWAP', 'LTC-USDT-SWAP', 'XRP-USDT-SWAP', 'DOGE-USDT-SWAP'],
};

const MAX_CANDLES_LOOKBACK: Record<number, number> = {
  7: 7 * 24 * 12,
  14: 14 * 24 * 12,
  30: 30 * 24 * 12,
};

const REFERENCE_TIMEFRAMES = ['1h', '4h', '1d'];

function buildCacheKey(request: PairMetricsRequest): string {
  return `${request.exchange}_${request.metric}_${request.period}`;
}

async function ensureSymbols(request: PairMetricsRequest): Promise<string[]> {
  const defaultSymbols = DEFAULT_SYMBOLS[request.exchange];
  if (!defaultSymbols || defaultSymbols.length === 0) {
    throw new Error(`No default symbols configured for ${request.exchange}`);
  }
  return defaultSymbols;
}

function calculateMetric(metric: 'volume' | 'volatility', candles: Array<{ high: number; low: number; close: number; volume?: number }>): number {
  if (!candles.length) return 0;
  if (metric === 'volume') {
    const total = candles.reduce((acc, candle) => acc + (candle.volume || 0), 0);
    return Number(total.toFixed(2));
  }

  const returns: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const prev = candles[i - 1];
    const current = candles[i];
    if (!prev.close || !current.close) continue;
    const ret = Math.log(current.close / prev.close);
    if (!Number.isFinite(ret)) continue;
    returns.push(ret);
  }

  if (!returns.length) {
    return 0;
  }

  const mean = returns.reduce((acc, value) => acc + value, 0) / returns.length;
  const variance = returns.reduce((acc, value) => acc + (value - mean) ** 2, 0) / returns.length;
  const stdDev = Math.sqrt(variance);

  const annualized = stdDev * Math.sqrt(returns.length);
  return Number((annualized * 100).toFixed(2));
}

async function fetchCandlesForSymbol(
  exchange: ExchangeName,
  symbol: string,
  period: number,
): Promise<Array<{ timeframe: string; candles: Array<{ high: number; low: number; close: number; volume?: number }> }>> {
  const timeframeResults: Array<{ timeframe: string; candles: Array<{ high: number; low: number; close: number; volume?: number }> }> = [];
  const dataSource = dataSources[exchange];
  const maxCandles = MAX_CANDLES_LOOKBACK[period] || MAX_CANDLES_LOOKBACK[7];
  for (const timeframe of REFERENCE_TIMEFRAMES) {
    try {
      const candles = await dataSource.getLatestCandles(symbol, timeframe, maxCandles, { exchange });
      if (candles && candles.length) {
        timeframeResults.push({
          timeframe,
          candles: candles.slice(-maxCandles),
        });
      }
    } catch (error: any) {
      METRICS_LOG.warn('Failed to load candles for %s %s %s: %s', exchange, symbol, timeframe, error?.message || error);
    }
  }
  return timeframeResults;
}

function aggregateCandles(
  metric: 'volume' | 'volatility',
  timeframeCandles: Array<{ timeframe: string; candles: Array<{ high: number; low: number; close: number; volume?: number }> }> ,
): number {
  if (!timeframeCandles.length) return 0;

  if (metric === 'volume') {
    const total = timeframeCandles.reduce((acc, entry) => acc + entry.candles.reduce((sum, candle) => sum + (candle.volume || 0), 0), 0);
    return Number(total.toFixed(2));
  }

  const combined: Array<{ high: number; low: number; close: number; volume?: number }> = [];
  timeframeCandles.forEach((entry) => {
    combined.push(...entry.candles);
  });
  combined.sort((a, b) => a.close - b.close);
  return calculateMetric('volatility', combined);
}

export async function getPairMetrics(request: PairMetricsRequest): Promise<PairMetricsResponse> {
  const cacheKey = buildCacheKey(request);
  const cached = metricsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    METRICS_LOG.debug('Pair metrics served from cache %s', cacheKey);
    return cached.payload;
  }

  const symbols = await ensureSymbols(request);
  const limitedSymbols = symbols.slice(0, 50);

  const results: PairMetricsResponseItem[] = [];
  const inFlight: Promise<void>[] = [];

  for (const symbol of limitedSymbols) {
    const job = async () => {
      const timeframeCandles = await fetchCandlesForSymbol(request.exchange, symbol, request.period);
      const metricValue = aggregateCandles(request.metric, timeframeCandles);
      const candlesCount = timeframeCandles.reduce((acc, entry) => acc + entry.candles.length, 0);

      results.push({
        symbol,
        exchange: request.exchange,
        metricValue,
        candlesAnalyzed: candlesCount,
      });
    };

    inFlight.push(job());
    if (inFlight.length >= MAX_CONCURRENT_REQUESTS) {
      await Promise.allSettled(inFlight.splice(0, inFlight.length));
    }
  }

  if (inFlight.length) {
    await Promise.allSettled(inFlight);
  }

  results.sort((a, b) => b.metricValue - a.metricValue);

  const response: PairMetricsResponse = {
    exchange: request.exchange,
    metric: request.metric,
    period: request.period,
    pairs: results,
    generatedAt: Date.now(),
  };

  metricsCache.set(cacheKey, {
    payload: response,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return response;
}

export function clearPairMetricsCache(): void {
  metricsCache.clear();
}
