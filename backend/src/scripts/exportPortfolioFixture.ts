import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import logger from '@/utils/logger';
import { AppDataSource } from '@/config/dataSource';
import { DataService } from '@/services/dataService';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

interface SerializableCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  volumeQuote?: number;
}

const DEFAULT_FIXTURE_PATH = 'data/fixtures/portfolio-majors-1h.json';
const DEFAULT_START_DATE = '2022-10-29';
const DEFAULT_END_DATE = '2025-05-17';
const DEFAULT_PAIRS = ['BTCUSDT', 'ETHUSDT', 'XRPUSDT', 'SOLUSDT'];
const DEFAULT_TIMEFRAME = '1h';
const DEFAULT_EXCHANGE = 'bybit';

function toTimestamp(date: string): number {
  // Приводим к полуночи UTC
  return new Date(`${date}T00:00:00Z`).getTime();
}

async function ensureDataSource(): Promise<void> {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }
}

async function exportFixture(): Promise<void> {
  const outputPath = path.resolve(process.cwd(), process.env.PORTFOLIO_FIXTURE_PATH || DEFAULT_FIXTURE_PATH);
  const startDate = process.env.PORTFOLIO_FIXTURE_START || DEFAULT_START_DATE;
  const endDate = process.env.PORTFOLIO_FIXTURE_END || DEFAULT_END_DATE;
  const pairs = (process.env.PORTFOLIO_FIXTURE_PAIRS?.split(',').map((p) => p.trim()).filter(Boolean)) || DEFAULT_PAIRS;
  const timeframe = process.env.PORTFOLIO_FIXTURE_TIMEFRAME || DEFAULT_TIMEFRAME;
  const exchange = process.env.PORTFOLIO_FIXTURE_EXCHANGE || DEFAULT_EXCHANGE;

  const startTime = toTimestamp(startDate);
  const endTime = toTimestamp(endDate);

  logger.info('[ExportPortfolioFixture] Starting export', { outputPath, startDate, endDate, pairs, timeframe, exchange });

  await ensureDataSource();
  const dataService = new DataService();

  const fixture: Record<string, SerializableCandle[]> = {};

  for (const pair of pairs) {
    logger.info(`[ExportPortfolioFixture] Fetching candles for ${pair}`);
    const candles = await dataService.getCandles(pair, timeframe, startTime, endTime, exchange);

    if (!candles || candles.length === 0) {
      logger.warn(`[ExportPortfolioFixture] No candles found for ${pair}. Pair will be present with empty array.`);
      fixture[pair] = [];
      continue;
    }

    const serialized = candles
      .map((candle) => ({
        timestamp: Number(candle.timestamp),
        open: Number(candle.open),
        high: Number(candle.high),
        low: Number(candle.low),
        close: Number(candle.close),
        volume: Number(candle.volume),
        volumeQuote: candle.volumeQuote !== undefined ? Number(candle.volumeQuote) : undefined,
      }))
      .sort((a, b) => a.timestamp - b.timestamp);

    fixture[pair] = serialized;

    const first = serialized[0];
    const last = serialized[serialized.length - 1];
    logger.info(`[ExportPortfolioFixture] ${pair}: exported ${serialized.length} candles. Range ${new Date(first.timestamp).toISOString()} - ${new Date(last.timestamp).toISOString()}`);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(fixture, null, 2), 'utf8');

  logger.info(`[ExportPortfolioFixture] Fixture saved to ${outputPath}`);
}

exportFixture()
  .then(() => {
    logger.info('[ExportPortfolioFixture] Done.');
    return AppDataSource.isInitialized ? AppDataSource.destroy() : undefined;
  })
  .catch((error) => {
    logger.error('[ExportPortfolioFixture] Failed', { message: error.message, stack: error.stack });
    if (AppDataSource.isInitialized) {
      AppDataSource.destroy().finally(() => process.exit(1));
    } else {
      process.exit(1);
    }
  });


