/**
 * Детеминированный запуск портфельного бэктеста.
 *
 * Скрипт загружает заранее подготовленный JSON-файл со свечами для всех пар
 * и запускает `runPortfolioBacktest` напрямую, минуя API, очередь и Redis.
 * Таким образом результат зависит только от кода стратегии и входных данных.
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { runPortfolioBacktest } from '@/modules/backtester/backtester';
import {
  PortfolioBacktestRunParameters,
  PortfolioBacktestResult,
} from '@/modules/backtester/backtester.types';
import { validatePortfolioResult } from '@/utils/portfolioValidator';
import logger from '@/utils/logger';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

interface FixtureShape {
  [pair: string]: Array<{
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    [key: string]: unknown;
  }>;
}

interface ReproConfig {
  fixturePath: string;
  outputPath: string;
  params: PortfolioBacktestRunParameters;
}

const DEFAULT_CONFIG: ReproConfig = {
  fixturePath: process.env.PORTFOLIO_REPRO_FIXTURE || 'data/fixtures/portfolio-majors-1h.json',
  outputPath: process.env.PORTFOLIO_REPRO_OUTPUT || 'backend/public/portfolio-results/portfolio-backtest-repro.json',
  params: {
    pairSymbols: ['BTCUSDT', 'ETHUSDT', 'XRPUSDT', 'SOLUSDT'],
    timeframe: '1h',
    startDate: '2022-10-29',
    endDate: '2025-05-17',
    initialPortfolioCapital: 1000,
    exchange: 'bybit',
    useGPU: false,
    strategyParameters: {
      dlc: {
        period: 40,
        pocLookback: 5,
        numProfiles: 1,
        pocColor: '#FF0000',
        vahColor: '#00FF00',
        valColor: '#0000FF',
        numBins: 100,
        vaPercentage: 0.7,
      },
      nwe: {
        enabled: true,
        bandwidth: 8,
        multiplier: 3,
        source: 'close',
        repaint: false,
        upColor: '#00FFFF',
        downColor: '#FFFF00',
      },
      clusters: {
        source: 'volume',
        minVolumeThresholdMultiplier: 1.5,
        deltaThreshold: 0.7,
        lookbackPeriod: 20,
        confirmationBars: 1,
        buyColor: '#00FF00',
        sellColor: '#FF0000',
      },
      risk: {
        atrPeriod: 14,
        positionSizePercentage: 0.02,
        stopLossMultiplier: 2,
        takeProfitMultiplier: 5,
        useTrailingStop: false,
        trailingStopOffsetMultiplier: 1.5,
        trailingStopStepMultiplier: 0.25,
        maxTradesPerDay: 2,
        maxRiskPerTradePercentage: 0.02,
        exitOnOppositeSignal: false,
      },
    },
    portfolioSettings: {
      maxConcurrentTradesPortfolio: 50,
    },
  },
};

function loadFixture(fixturePath: string): FixtureShape {
  const absolutePath = path.resolve(process.cwd(), fixturePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Fixture file not found: ${absolutePath}`);
  }

  const raw = fs.readFileSync(absolutePath, 'utf8');
  const data = JSON.parse(raw);

  if (typeof data !== 'object' || data === null) {
    throw new Error(`Fixture file ${absolutePath} does not contain a JSON object.`);
  }

  return data as FixtureShape;
}

function ensurePairsPresent(fixture: FixtureShape, params: PortfolioBacktestRunParameters): void {
  for (const pair of params.pairSymbols) {
    if (!fixture[pair] || fixture[pair].length === 0) {
      throw new Error(`Fixture does not contain candles for pair ${pair}`);
    }
  }
}

function saveResult(result: PortfolioBacktestResult, config: ReproConfig): void {
  const absoluteOutputPath = path.resolve(process.cwd(), config.outputPath);
  fs.mkdirSync(path.dirname(absoluteOutputPath), { recursive: true });

  const payload = {
    overallMetrics: result.overallMetrics,
    metricsByPair: result.metricsByPair,
    configUsed: result.configUsed,
    generatedAt: new Date().toISOString(),
    fixture: path.resolve(process.cwd(), config.fixturePath),
  };

  fs.writeFileSync(absoluteOutputPath, JSON.stringify(payload, null, 2), 'utf8');
  logger.info(`[PortfolioRepro] Saved result to ${absoluteOutputPath}`);
}

async function runRepro(config: ReproConfig): Promise<void> {
  logger.info('[PortfolioRepro] Loading candles fixture...');
  const fixture = loadFixture(config.fixturePath);
  ensurePairsPresent(fixture, config.params);

  logger.info('[PortfolioRepro] Running portfolio backtest...');
  const result = await runPortfolioBacktest(config.params, fixture);

  const validation = validatePortfolioResult(result);
  if (!validation.valid) {
    logger.error('[PortfolioRepro] Validation failed. Issues:\n' + validation.issues.map((issue) => ` - [${issue.level}] ${issue.message}`).join('\n'));
    throw new Error('Portfolio validation failed. See log for details.');
  }

  saveResult(result, config);

  console.log('=== Portfolio Repro Result ===');
  console.log('Final capital:', result.overallMetrics.finalPortfolioCapital.toFixed(6));
  console.log('Total PnL % :', result.overallMetrics.totalPortfolioPnlPercentage.toFixed(4));
  console.log('Total trades:', result.overallMetrics.totalPortfolioTrades);
}

runRepro(DEFAULT_CONFIG).catch((error) => {
  console.error('[PortfolioRepro] Execution failed:', error);
  process.exit(1);
});

