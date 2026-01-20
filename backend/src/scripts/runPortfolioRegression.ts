import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'
import { runPortfolioBacktest } from '@/modules/backtester/backtester'
import { PortfolioBacktestRunParameters } from '@/modules/backtester/backtester.types'
import { validatePortfolioResult, summarizeReport } from '@/utils/portfolioValidator'
import logger from '@/utils/logger'

dotenv.config({ path: path.resolve(__dirname, '../../.env') })

const FIXTURE_ENV = 'PORTFOLIO_REGRESSION_FIXTURE'
const OUTPUT_ENV = 'PORTFOLIO_REGRESSION_OUTPUT'
const DEFAULT_FIXTURE = 'data/fixtures/portfolio-majors-1h.json'
const DEFAULT_OUTPUT = 'backend/public/portfolio-results/portfolio-backtest-regression.json'

const fixturePath = path.resolve(process.cwd(), process.env[FIXTURE_ENV] || DEFAULT_FIXTURE)
const outputPath = path.resolve(process.cwd(), process.env[OUTPUT_ENV] || DEFAULT_OUTPUT)

const params: PortfolioBacktestRunParameters = {
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
}

function loadFixture(): Record<string, any[]> {
  if (!fs.existsSync(fixturePath)) {
    throw new Error(`Fixture file not found: ${fixturePath}`)
  }
  const raw = fs.readFileSync(fixturePath, 'utf8')
  const parsed = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Fixture file ${fixturePath} does not contain valid JSON object`)
  }
  return parsed
}

async function run() {
  logger.info(`[PortfolioRegression] Using fixture ${fixturePath}`)
  const fixture = loadFixture()
  logger.info('[PortfolioRegression] Running backtest...')
  const result = await runPortfolioBacktest(params, fixture)

  const report = validatePortfolioResult(result)
  const summary = summarizeReport(report)
  if (!report.valid) {
    logger.error('[PortfolioRegression] Validation failed:\n' + summary)
    throw new Error('Portfolio regression failed validation')
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf8')
  logger.info(`[PortfolioRegression] Result saved to ${outputPath}`)
  console.log(summary)
}

run().catch((error) => {
  console.error('[PortfolioRegression] Execution failed:', error)
  process.exit(1)
})

