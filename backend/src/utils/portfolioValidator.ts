import fs from 'fs';
import path from 'path';
import logger from '@/utils/logger';
import {
  PortfolioBacktestResult,
  PortfolioMetrics,
  BacktestMetrics,
  Trade,
} from '@/modules/backtester/backtester.types';

export type Severity = 'error' | 'warn';

export interface ValidationIssue {
  level: Severity;
  message: string;
  details?: Record<string, unknown>;
}

export interface ValidationReport {
  file?: string;
  valid: boolean;
  issues: ValidationIssue[];
}

const EPSILON = 1e-6;

function nearlyEqual(a: number, b: number, tolerance = EPSILON): boolean {
  if (Number.isFinite(a) && Number.isFinite(b)) {
    return Math.abs(a - b) <= tolerance;
  }
  return a === b;
}

function addIssue(issues: ValidationIssue[], level: Severity, message: string, details?: Record<string, unknown>) {
  issues.push({ level, message, details });
}

function aggregateTrades(tradesByPair: Record<string, Trade[]>): Trade[] {
  const aggregated: Trade[] = [];
  Object.values(tradesByPair).forEach((trades) => {
    aggregated.push(...trades);
  });
  return aggregated;
}

function recomputePortfolioMetrics(result: PortfolioBacktestResult) {
  const { overallMetrics, tradesByPair } = result;
  const allTrades = aggregateTrades(tradesByPair);

  const portfolioWinningTrades = allTrades.filter((t) => (t.pnl ?? 0) > 0);
  const portfolioLosingTrades = allTrades.filter((t) => (t.pnl ?? 0) < 0);

  const totalPortfolioPnl = allTrades.reduce((sum, trade) => sum + (trade.pnl ?? 0), 0);
  const totalPortfolioTrades = allTrades.length;
  const portfolioGrossProfit = portfolioWinningTrades.reduce((sum, trade) => sum + (trade.pnl ?? 0), 0);
  const portfolioGrossLossRaw = portfolioLosingTrades.reduce((sum, trade) => sum + (trade.pnl ?? 0), 0);
  const portfolioGrossLoss = Math.abs(portfolioGrossLossRaw);

  const winRateDecimal = totalPortfolioTrades > 0 ? portfolioWinningTrades.length / totalPortfolioTrades : 0;
  const lossRate = 1 - winRateDecimal;

  const avgWinningTrade = portfolioWinningTrades.length > 0 ? portfolioGrossProfit / portfolioWinningTrades.length : 0;
  const avgLosingTrade = portfolioLosingTrades.length > 0 ? Math.abs(portfolioGrossLossRaw / portfolioLosingTrades.length) : 0;
  const portfolioExpectancy = (winRateDecimal * avgWinningTrade) - (lossRate * avgLosingTrade);

  const portfolioAverageTradePnl = totalPortfolioTrades > 0 ? totalPortfolioPnl / totalPortfolioTrades : 0;
  const portfolioProfitFactor = portfolioGrossLoss > 0 ? portfolioGrossProfit / portfolioGrossLoss : (portfolioGrossProfit > 0 ? Infinity : 0);

  const portfolioWinRate = winRateDecimal * 100;

  return {
    totalPortfolioPnl,
    totalPortfolioTrades,
    portfolioGrossProfit,
    portfolioGrossLoss,
    portfolioExpectancy,
    portfolioAverageTradePnl,
    portfolioProfitFactor,
    portfolioWinRate,
    portfolioWinningTrades: portfolioWinningTrades.length,
    portfolioLosingTrades: portfolioLosingTrades.length,
  };
}

function recomputePairMetrics(trades: Trade[], initialCapital: number): Partial<BacktestMetrics> {
  const totalTrades = trades.length;
  const winningTrades = trades.filter((t) => (t.pnl ?? 0) > 0);
  const losingTrades = trades.filter((t) => (t.pnl ?? 0) < 0);

  const totalPnl = trades.reduce((sum, trade) => sum + (trade.pnl ?? 0), 0);
  const totalPnlPercentage = initialCapital > 0 ? (totalPnl / initialCapital) * 100 : 0;
  const grossProfit = winningTrades.reduce((sum, trade) => sum + (trade.pnl ?? 0), 0);
  const grossLoss = Math.abs(losingTrades.reduce((sum, trade) => sum + (trade.pnl ?? 0), 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);
  const winRate = totalTrades > 0 ? (winningTrades.length / totalTrades) * 100 : 0;
  const averageTradePnl = totalTrades > 0 ? totalPnl / totalTrades : 0;
  const avgWinningTrade = winningTrades.length > 0 ? grossProfit / winningTrades.length : 0;
  const avgLosingTrade = losingTrades.length > 0 ? grossLoss / losingTrades.length : 0;
  const expectancy = (winRate / 100) * avgWinningTrade - ((100 - winRate) / 100) * avgLosingTrade;

  return {
    totalPnl,
    totalPnlPercentage,
    totalTrades,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    grossProfit,
    grossLoss,
    profitFactor,
    winRate,
    averageTradePnl,
    avgWinningTrade,
    avgLosingTrade,
    expectancy,
  };
}

export function validatePortfolioMetrics(result: PortfolioBacktestResult, report: ValidationReport): void {
  const { overallMetrics } = result;
  const issues = report.issues;

  const recomputed = recomputePortfolioMetrics(result);

  if (!nearlyEqual(overallMetrics.totalPortfolioPnl, recomputed.totalPortfolioPnl)) {
    addIssue(issues, 'error', 'Mismatch in total portfolio PnL', {
      reported: overallMetrics.totalPortfolioPnl,
      recomputed: recomputed.totalPortfolioPnl,
    });
  }

  if (!nearlyEqual(overallMetrics.totalPortfolioTrades, recomputed.totalPortfolioTrades)) {
    addIssue(issues, 'error', 'Mismatch in total portfolio trades count', {
      reported: overallMetrics.totalPortfolioTrades,
      recomputed: recomputed.totalPortfolioTrades,
    });
  }

  if (!nearlyEqual(overallMetrics.portfolioGrossProfit, recomputed.portfolioGrossProfit)) {
    addIssue(issues, 'error', 'Mismatch in gross profit', {
      reported: overallMetrics.portfolioGrossProfit,
      recomputed: recomputed.portfolioGrossProfit,
    });
  }

  if (!nearlyEqual(overallMetrics.portfolioGrossLoss, recomputed.portfolioGrossLoss)) {
    addIssue(issues, 'error', 'Mismatch in gross loss', {
      reported: overallMetrics.portfolioGrossLoss,
      recomputed: recomputed.portfolioGrossLoss,
    });
  }

  if (!nearlyEqual(overallMetrics.portfolioAverageTradePnl, recomputed.portfolioAverageTradePnl)) {
    addIssue(issues, 'error', 'Mismatch in average trade PnL', {
      reported: overallMetrics.portfolioAverageTradePnl,
      recomputed: recomputed.portfolioAverageTradePnl,
    });
  }

  if (!nearlyEqual(overallMetrics.portfolioExpectancy, recomputed.portfolioExpectancy)) {
    addIssue(issues, 'warn', 'Mismatch in portfolio expectancy', {
      reported: overallMetrics.portfolioExpectancy,
      recomputed: recomputed.portfolioExpectancy,
    });
  }

  if (!nearlyEqual(overallMetrics.portfolioWinRate, recomputed.portfolioWinRate)) {
    addIssue(issues, 'error', 'Mismatch in portfolio win rate', {
      reported: overallMetrics.portfolioWinRate,
      recomputed: recomputed.portfolioWinRate,
    });
  }

  if (!nearlyEqual(overallMetrics.portfolioProfitFactor, recomputed.portfolioProfitFactor)) {
    addIssue(issues, 'warn', 'Mismatch in portfolio profit factor', {
      reported: overallMetrics.portfolioProfitFactor,
      recomputed: recomputed.portfolioProfitFactor,
    });
  }

  if (!nearlyEqual(overallMetrics.portfolioWinningTrades, recomputed.portfolioWinningTrades)) {
    addIssue(issues, 'error', 'Mismatch in winning trades count', {
      reported: overallMetrics.portfolioWinningTrades,
      recomputed: recomputed.portfolioWinningTrades,
    });
  }

  if (!nearlyEqual(overallMetrics.portfolioLosingTrades, recomputed.portfolioLosingTrades)) {
    addIssue(issues, 'error', 'Mismatch in losing trades count', {
      reported: overallMetrics.portfolioLosingTrades,
      recomputed: recomputed.portfolioLosingTrades,
    });
  }

  const expectedFinalCapital = overallMetrics.initialPortfolioCapital + overallMetrics.totalPortfolioPnl;
  if (!nearlyEqual(overallMetrics.finalPortfolioCapital, expectedFinalCapital)) {
    addIssue(issues, 'error', 'Final capital does not match initial capital plus PnL', {
      reported: overallMetrics.finalPortfolioCapital,
      expected: expectedFinalCapital,
    });
  }
}

function validateEquityCurve(overallMetrics: PortfolioMetrics, issues: ValidationIssue[]): void {
  const { portfolioEquityCurve, initialPortfolioCapital, finalPortfolioCapital } = overallMetrics;
  if (!portfolioEquityCurve || portfolioEquityCurve.length === 0) {
    addIssue(issues, 'warn', 'Portfolio equity curve is empty');
    return;
  }

  const firstPoint = portfolioEquityCurve[0];
  if (!nearlyEqual(firstPoint.capital, initialPortfolioCapital)) {
    addIssue(issues, 'warn', 'First point of equity curve does not match initial capital', {
      firstPoint: firstPoint.capital,
      initialPortfolioCapital,
    });
  }

  const lastPoint = portfolioEquityCurve[portfolioEquityCurve.length - 1];
  if (!nearlyEqual(lastPoint.capital, finalPortfolioCapital)) {
    addIssue(issues, 'warn', 'Last point of equity curve does not match final capital', {
      lastPoint: lastPoint.capital,
      finalPortfolioCapital,
    });
  }

  let previousTimestamp = portfolioEquityCurve[0].timestamp;
  for (let i = 1; i < portfolioEquityCurve.length; i++) {
    const point = portfolioEquityCurve[i];
    if (point.timestamp < previousTimestamp) {
      addIssue(issues, 'warn', 'Equity curve timestamp ordering is not strictly increasing', {
        index: i,
        current: point.timestamp,
        previous: previousTimestamp,
      });
      break;
    }
    previousTimestamp = point.timestamp;
  }
}

function validatePairMetrics(result: PortfolioBacktestResult, report: ValidationReport): void {
  const { metricsByPair, tradesByPair, overallMetrics } = result;
  const issues = report.issues;

  const recomputedSums = {
    totalPnl: 0,
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    grossProfit: 0,
    grossLoss: 0,
  };

  Object.entries(metricsByPair).forEach(([pair, metrics]) => {
    const trades = tradesByPair[pair] || [];
    const recomputed = recomputePairMetrics(trades, metrics.initialCapital ?? overallMetrics.initialPortfolioCapital);

    if (!nearlyEqual(metrics.totalPnl ?? 0, recomputed.totalPnl ?? 0)) {
      addIssue(issues, 'error', `Mismatch in total PnL for pair ${pair}`, {
        reported: metrics.totalPnl,
        recomputed: recomputed.totalPnl,
      });
    }

    const reportedTrades = metrics.totalTrades ?? trades.length;
    const recomputedTrades = recomputed.totalTrades ?? trades.length;
    if (!nearlyEqual(reportedTrades, recomputedTrades)) {
      addIssue(issues, 'error', `Mismatch in trades count for pair ${pair}`, {
        reported: reportedTrades,
        recomputed: recomputedTrades,
      });
    }

    const reportedGrossProfit = metrics.grossProfit ?? 0;
    const recomputedGrossProfit = recomputed.grossProfit ?? 0;
    if (!nearlyEqual(reportedGrossProfit, recomputedGrossProfit)) {
      addIssue(issues, 'warn', `Mismatch in gross profit for pair ${pair}`, {
        reported: metrics.grossProfit,
        recomputed: recomputed.grossProfit,
      });
    }

    const reportedGrossLoss = metrics.grossLoss ?? 0;
    const recomputedGrossLoss = recomputed.grossLoss ?? 0;
    if (!nearlyEqual(reportedGrossLoss, recomputedGrossLoss)) {
      addIssue(issues, 'warn', `Mismatch in gross loss for pair ${pair}`, {
        reported: metrics.grossLoss,
        recomputed: recomputed.grossLoss,
      });
    }

    recomputedSums.totalPnl += recomputed.totalPnl ?? 0;
    recomputedSums.totalTrades += recomputed.totalTrades ?? trades.length;
    recomputedSums.winningTrades += recomputed.winningTrades ?? 0;
    recomputedSums.losingTrades += recomputed.losingTrades ?? 0;
    recomputedSums.grossProfit += recomputed.grossProfit ?? 0;
    recomputedSums.grossLoss += recomputed.grossLoss ?? 0;
  });

  if (!nearlyEqual(recomputedSums.totalPnl, overallMetrics.totalPortfolioPnl)) {
    addIssue(issues, 'warn', 'Sum of pair PnL does not match overall portfolio PnL', {
      pairSum: recomputedSums.totalPnl,
      portfolio: overallMetrics.totalPortfolioPnl,
    });
  }

  if (!nearlyEqual(recomputedSums.totalTrades, overallMetrics.totalPortfolioTrades)) {
    addIssue(issues, 'warn', 'Sum of pair trades does not match total portfolio trades', {
      pairSum: recomputedSums.totalTrades,
      portfolio: overallMetrics.totalPortfolioTrades,
    });
  }
}

export function validatePortfolioResult(result: PortfolioBacktestResult, file?: string): ValidationReport {
  const issues: ValidationIssue[] = [];
  const report: ValidationReport = {
    file,
    valid: true,
    issues,
  };

  try {
    validatePortfolioMetrics(result, report);
    validateEquityCurve(result.overallMetrics, issues);
    validatePairMetrics(result, report);
  } catch (error) {
    addIssue(issues, 'error', 'Validator encountered an exception', {
      error: (error as Error).message,
    });
  }

  report.valid = !issues.some((issue) => issue.level === 'error');
  return report;
}

export function validatePortfolioResultFromFile(jsonPath: string): ValidationReport {
  const absolutePath = path.resolve(process.cwd(), jsonPath);
  const raw = fs.readFileSync(absolutePath, 'utf8');
  const parsed = JSON.parse(raw) as PortfolioBacktestResult;
  const report = validatePortfolioResult(parsed, absolutePath);

  if (!report.valid) {
    logger.error(`[PortfolioValidator] Validation failed for ${absolutePath}`);
  } else {
    logger.info(`[PortfolioValidator] Validation passed for ${absolutePath}`);
  }

  return report;
}

export function summarizeReport(report: ValidationReport): string {
  const lines = [report.file ? `File: ${report.file}` : 'Result'];
  lines.push(`Status: ${report.valid ? 'VALID' : 'INVALID'}`);
  if (report.issues.length === 0) {
    lines.push('No issues found.');
  } else {
    report.issues.forEach((issue) => {
      const details = issue.details ? ` ${JSON.stringify(issue.details)}` : '';
      lines.push(`- [${issue.level.toUpperCase()}] ${issue.message}${details}`);
    });
  }
  return lines.join('\n');
}

export function validateMultiple(files: string[]): ValidationReport[] {
  return files.map((file) => validatePortfolioResultFromFile(file));
}

