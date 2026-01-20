/**
 * Futures Strategy Parameters Optimization Script
 * 
 * Запускает grid search по параметрам futures стратегии
 * и находит оптимальную комбинацию
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { runBacktest } from '@/modules/backtester/backtester';
import { BacktestRunParameters, BacktestResult } from '@/modules/backtester/backtester.types';
import { getStrategyProfile } from '@/modules/strategy_logic/profiles';
import logger from '@/utils/logger';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Конфигурация оптимизации
const OPTIMIZATION_CONFIG = {
  // Данные для тестирования
  fixture: process.env.OPTIMIZATION_FIXTURE || 'data/fixtures/btc-1h-3months.json',
  
  // Параметры тестирования
  pairSymbol: 'BTCUSDT',
  timeframe: '1h',
  startDate: '2024-07-01',
  endDate: '2024-10-01',
  initialCapital: 10000,
  exchange: 'bybit',
  
  // Выходной файл
  output: 'backend/public/optimization-results/futures-optimization-report.json',
};

// Grid search параметры
const PARAMETER_GRID = {
  leverage: [3, 5, 7, 10],
  stopLossMultiplier: [1.0, 1.5, 2.0, 2.5],
  takeProfitMultiplier: [2.0, 3.0, 4.0, 5.0],
  maxRiskPerTradePercentage: [0.01, 0.015, 0.02],
};

interface OptimizationResult {
  parameters: {
    leverage: number;
    stopLossMultiplier: number;
    takeProfitMultiplier: number;
    maxRiskPerTradePercentage: number;
  };
  metrics: {
    totalPnl: number;
    totalPnlPercentage: number;
    totalTrades: number;
    winRate: number;
    profitFactor: number;
    maxDrawdown: number;
    expectancy: number;
    liquidations: number;
    netFunding: number;
    effectiveROI: number;
    capitalEfficiency: number;
    avgDistanceToLiquidation: number;
  };
  score: number; // Комплексный скор для ранжирования
}

/**
 * Загрузить данные для тестирования
 */
function loadCandles(): any[] {
  const fixturePath = path.resolve(process.cwd(), OPTIMIZATION_CONFIG.fixture);
  
  if (!fs.existsSync(fixturePath)) {
    logger.warn(`Fixture file not found: ${fixturePath}. Will need to fetch data from DB.`);
    throw new Error('Fixture file not found. Please generate candles first.');
  }
  
  const raw = fs.readFileSync(fixturePath, 'utf8');
  const parsed = JSON.parse(raw);
  
  logger.info(`Loaded ${parsed.length} candles from ${fixturePath}`);
  return parsed;
}

/**
 * Рассчитать комплексный скор для ранжирования результатов
 */
function calculateScore(result: BacktestResult): number {
  const m = result.metrics;
  
  // Если были ликвидации - сильно штрафуем
  if (m.futuresStats && m.futuresStats.liquidations > 0) {
    return -1000 * m.futuresStats.liquidations;
  }
  
  // Компоненты скора (нормализованные)
  const pnlScore = m.totalPnlPercentage; // Прибыль в %
  const winRateScore = m.winRate * 0.5; // Win rate с весом 0.5
  const pfScore = Math.min(m.profitFactor * 10, 50); // Profit factor (cap at 50)
  const drawdownPenalty = -m.maxDrawdown * 2; // Штраф за просадку
  const tradesBonus = Math.min(m.totalTrades / 10, 10); // Бонус за количество сделок (cap at 10)
  
  // Futures-специфичные компоненты
  let futuresBonus = 0;
  if (m.futuresStats) {
    futuresBonus += m.futuresStats.effectiveROI * 0.2; // Effective ROI
    futuresBonus += m.futuresStats.capitalEfficiency * 0.1; // Capital efficiency
    futuresBonus += m.futuresStats.avgDistanceToLiquidation * 0.5; // Расстояние до ликвидации
    futuresBonus -= Math.abs(m.futuresStats.netFunding) * 0.1; // Штраф за funding costs
  }
  
  const totalScore = pnlScore + winRateScore + pfScore + drawdownPenalty + tradesBonus + futuresBonus;
  
  return totalScore;
}

/**
 * Запустить один бектест с заданными параметрами
 */
async function runSingleBacktest(
  candles: any[],
  params: typeof PARAMETER_GRID extends infer G ? {
    [K in keyof G]: G[K] extends any[] ? G[K][number] : never
  } : never
): Promise<OptimizationResult> {
  // Получить futures профиль и настроить параметры
  const profile = getStrategyProfile('futures');
  
  // Настроить параметры
  profile.futures!.leverage!.value = params.leverage;
  profile.futures!.leverage!.max = Math.max(params.leverage, 10);
  profile.risk!.stopLossMultiplier = params.stopLossMultiplier;
  profile.risk!.takeProfitMultiplier = params.takeProfitMultiplier;
  profile.risk!.maxRiskPerTradePercentage = params.maxRiskPerTradePercentage;
  
  const backtestParams: BacktestRunParameters = {
    pairSymbol: OPTIMIZATION_CONFIG.pairSymbol,
    timeframe: OPTIMIZATION_CONFIG.timeframe,
    startDate: OPTIMIZATION_CONFIG.startDate,
    endDate: OPTIMIZATION_CONFIG.endDate,
    initialCapital: OPTIMIZATION_CONFIG.initialCapital,
    strategyParameters: profile.strategyParameters!,
    extendedParameters: profile,
    exchange: OPTIMIZATION_CONFIG.exchange,
    strategyProfile: 'futures',
  };
  
  // Запустить бектест
  const result = await runBacktest(backtestParams, candles);
  
  // Собрать метрики
  const metrics = {
    totalPnl: result.metrics.totalPnl,
    totalPnlPercentage: result.metrics.totalPnlPercentage,
    totalTrades: result.metrics.totalTrades,
    winRate: result.metrics.winRate,
    profitFactor: result.metrics.profitFactor,
    maxDrawdown: result.metrics.maxDrawdown,
    expectancy: result.metrics.expectancy || 0,
    liquidations: result.metrics.futuresStats?.liquidations || 0,
    netFunding: result.metrics.futuresStats?.netFunding || 0,
    effectiveROI: result.metrics.futuresStats?.effectiveROI || 0,
    capitalEfficiency: result.metrics.futuresStats?.capitalEfficiency || 0,
    avgDistanceToLiquidation: result.metrics.futuresStats?.averageDistanceToLiquidation || 0,
  };
  
  const score = calculateScore(result);
  
  return {
    parameters: params,
    metrics,
    score,
  };
}

/**
 * Главная функция оптимизации
 */
async function optimize() {
  logger.info('='.repeat(80));
  logger.info('🔍 FUTURES STRATEGY PARAMETERS OPTIMIZATION');
  logger.info('='.repeat(80));
  
  logger.info('\n📊 Configuration:');
  logger.info(`  Pair: ${OPTIMIZATION_CONFIG.pairSymbol}`);
  logger.info(`  Timeframe: ${OPTIMIZATION_CONFIG.timeframe}`);
  logger.info(`  Period: ${OPTIMIZATION_CONFIG.startDate} to ${OPTIMIZATION_CONFIG.endDate}`);
  logger.info(`  Initial Capital: $${OPTIMIZATION_CONFIG.initialCapital}`);
  
  // Загрузить данные
  logger.info('\n📥 Loading candles...');
  const candles = loadCandles();
  
  // Генерировать комбинации параметров
  const combinations: any[] = [];
  for (const leverage of PARAMETER_GRID.leverage) {
    for (const sl of PARAMETER_GRID.stopLossMultiplier) {
      for (const tp of PARAMETER_GRID.takeProfitMultiplier) {
        for (const risk of PARAMETER_GRID.maxRiskPerTradePercentage) {
          combinations.push({
            leverage,
            stopLossMultiplier: sl,
            takeProfitMultiplier: tp,
            maxRiskPerTradePercentage: risk,
          });
        }
      }
    }
  }
  
  logger.info(`\n🔄 Running ${combinations.length} backtests...`);
  logger.info(`  Leverage: ${PARAMETER_GRID.leverage.join(', ')}`);
  logger.info(`  Stop Loss: ${PARAMETER_GRID.stopLossMultiplier.join(', ')}`);
  logger.info(`  Take Profit: ${PARAMETER_GRID.takeProfitMultiplier.join(', ')}`);
  logger.info(`  Risk per Trade: ${PARAMETER_GRID.maxRiskPerTradePercentage.map(r => `${r * 100}%`).join(', ')}`);
  
  const results: OptimizationResult[] = [];
  let completed = 0;
  
  for (const params of combinations) {
    try {
      const result = await runSingleBacktest(candles, params);
      results.push(result);
      completed++;
      
      // Прогресс
      if (completed % 10 === 0 || completed === combinations.length) {
        const progress = ((completed / combinations.length) * 100).toFixed(1);
        logger.info(`  Progress: ${completed}/${combinations.length} (${progress}%) - Last: PnL=${result.metrics.totalPnlPercentage.toFixed(2)}%, Score=${result.score.toFixed(2)}`);
      }
    } catch (error) {
      logger.error(`Error running backtest for params ${JSON.stringify(params)}:`, error);
    }
  }
  
  // Сортировать по скору
  results.sort((a, b) => b.score - a.score);
  
  // Вывести топ-10
  logger.info('\n' + '='.repeat(80));
  logger.info('🏆 TOP 10 RESULTS:');
  logger.info('='.repeat(80));
  
  for (let i = 0; i < Math.min(10, results.length); i++) {
    const r = results[i];
    logger.info(`\n#${i + 1} | Score: ${r.score.toFixed(2)}`);
    logger.info(`  Leverage: ${r.parameters.leverage}x | SL: ${r.parameters.stopLossMultiplier} | TP: ${r.parameters.takeProfitMultiplier} | Risk: ${(r.parameters.maxRiskPerTradePercentage * 100).toFixed(1)}%`);
    logger.info(`  PnL: ${r.metrics.totalPnlPercentage.toFixed(2)}% ($${r.metrics.totalPnl.toFixed(2)}) | Trades: ${r.metrics.totalTrades} | Win Rate: ${r.metrics.winRate.toFixed(2)}%`);
    logger.info(`  Profit Factor: ${r.metrics.profitFactor.toFixed(2)} | Max DD: ${r.metrics.maxDrawdown.toFixed(2)}% | Expectancy: ${r.metrics.expectancy.toFixed(2)}`);
    logger.info(`  Liquidations: ${r.metrics.liquidations} | Net Funding: $${r.metrics.netFunding.toFixed(2)} | Effective ROI: ${r.metrics.effectiveROI.toFixed(2)}%`);
    logger.info(`  Capital Efficiency: ${r.metrics.capitalEfficiency.toFixed(2)}% | Avg Distance to Liq: ${r.metrics.avgDistanceToLiquidation.toFixed(2)}%`);
  }
  
  // Статистика
  logger.info('\n' + '='.repeat(80));
  logger.info('📈 STATISTICS:');
  logger.info('='.repeat(80));
  
  const profitableCount = results.filter(r => r.metrics.totalPnl > 0).length;
  const noLiquidationsCount = results.filter(r => r.metrics.liquidations === 0).length;
  const avgPnl = results.reduce((sum, r) => sum + r.metrics.totalPnlPercentage, 0) / results.length;
  const avgWinRate = results.reduce((sum, r) => sum + r.metrics.winRate, 0) / results.length;
  const avgLiquidations = results.reduce((sum, r) => sum + r.metrics.liquidations, 0) / results.length;
  
  logger.info(`  Total combinations tested: ${results.length}`);
  logger.info(`  Profitable strategies: ${profitableCount} (${((profitableCount / results.length) * 100).toFixed(1)}%)`);
  logger.info(`  Strategies without liquidations: ${noLiquidationsCount} (${((noLiquidationsCount / results.length) * 100).toFixed(1)}%)`);
  logger.info(`  Average PnL: ${avgPnl.toFixed(2)}%`);
  logger.info(`  Average Win Rate: ${avgWinRate.toFixed(2)}%`);
  logger.info(`  Average Liquidations: ${avgLiquidations.toFixed(2)}`);
  
  // Рекомендации
  logger.info('\n' + '='.repeat(80));
  logger.info('💡 RECOMMENDATIONS:');
  logger.info('='.repeat(80));
  
  const best = results[0];
  if (best) {
    logger.info('\n✅ Best parameters:');
    logger.info(`  Leverage: ${best.parameters.leverage}x`);
    logger.info(`  Stop Loss Multiplier: ${best.parameters.stopLossMultiplier}`);
    logger.info(`  Take Profit Multiplier: ${best.parameters.takeProfitMultiplier}`);
    logger.info(`  Max Risk per Trade: ${(best.parameters.maxRiskPerTradePercentage * 100).toFixed(1)}%`);
    logger.info(`\n  Expected Performance:`);
    logger.info(`    • PnL: ${best.metrics.totalPnlPercentage.toFixed(2)}%`);
    logger.info(`    • Win Rate: ${best.metrics.winRate.toFixed(2)}%`);
    logger.info(`    • Profit Factor: ${best.metrics.profitFactor.toFixed(2)}`);
    logger.info(`    • Max Drawdown: ${best.metrics.maxDrawdown.toFixed(2)}%`);
    logger.info(`    • Liquidations: ${best.metrics.liquidations}`);
  }
  
  // Сохранить результаты
  const outputPath = path.resolve(process.cwd(), OPTIMIZATION_CONFIG.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  
  const report = {
    config: OPTIMIZATION_CONFIG,
    parameterGrid: PARAMETER_GRID,
    timestamp: new Date().toISOString(),
    results: results,
    statistics: {
      totalCombinations: results.length,
      profitableCount,
      noLiquidationsCount,
      avgPnl,
      avgWinRate,
      avgLiquidations,
    },
    recommendation: best ? {
      parameters: best.parameters,
      expectedMetrics: best.metrics,
      score: best.score,
    } : null,
  };
  
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');
  logger.info(`\n💾 Report saved to: ${outputPath}`);
  
  logger.info('\n' + '='.repeat(80));
  logger.info('✅ OPTIMIZATION COMPLETE!');
  logger.info('='.repeat(80));
}

// Запустить оптимизацию
optimize()
  .then(() => {
    logger.info('✅ Optimization finished successfully');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('❌ Optimization failed:', error);
    process.exit(1);
  });




