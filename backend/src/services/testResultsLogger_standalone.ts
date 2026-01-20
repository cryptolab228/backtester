/**
 * Автономный сервис для логирования результатов тестирования
 * БЕЗ зависимости от winston logger для избежания проблем компиляции
 */

import * as fs from 'fs';
import * as path from 'path';
import { BacktestTestResult, TestResultConfig, DEFAULT_TEST_RESULTS_CONFIG } from '../config/testResultsConfig';
import { BacktestResult, PortfolioBacktestResult } from '../modules/backtester/backtester.types';

// Простой logger для вывода в консоль
const simpleLogger = {
  info: (message: string) => console.log(`[INFO] ${new Date().toISOString()} ${message}`),
  warn: (message: string) => console.warn(`[WARN] ${new Date().toISOString()} ${message}`),
  error: (message: string) => console.error(`[ERROR] ${new Date().toISOString()} ${message}`)
};

export class TestResultsLoggerStandalone {
  private config: TestResultConfig;
  private ensuredDirectories: Set<string> = new Set();

  constructor(config: TestResultConfig = DEFAULT_TEST_RESULTS_CONFIG) {
    this.config = config;
  }

  /**
   * Логирует результат одиночного CPU бэктеста
   */
  logCPUSingleTest(
    result: BacktestResult,
    parameters: {
      pairSymbol: string;
      timeframe: string;
      startDate: string;
      endDate: string;
      initialCapital: number;
      candlesCount: number;
      executionSource: 'IMMEDIATE' | 'QUEUE' | 'WEBSOCKET';
    }
  ): void {
    if (!this.config.enabled) return;

    const testResult: BacktestTestResult = {
      testId: `cpu-single-${Date.now()}-${parameters.pairSymbol}`,
      timestamp: new Date().toISOString(),
      testType: 'CPU_SINGLE',
      pairSymbols: [parameters.pairSymbol],
      timeframe: parameters.timeframe,
      dateRange: {
        startDate: parameters.startDate,
        endDate: parameters.endDate,
      },
      initialCapital: parameters.initialCapital,
      metrics: {
        totalPnl: result.metrics.totalPnl,
        totalPnlPercentage: result.metrics.totalPnlPercentage,
        totalTrades: result.metrics.totalTrades,
        winningTrades: result.metrics.winningTrades,
        losingTrades: result.metrics.losingTrades,
        winRate: result.metrics.winRate,
        profitFactor: result.metrics.profitFactor,
        maxDrawdown: result.metrics.maxDrawdown,
        durationMs: result.metrics.durationMs || 0,
      },
      strategyParameters: result.configUsed?.strategyParameters,
      firstTradeDetails: result.trades?.[0] ? {
        timestamp: result.trades[0].entryTimestamp,
        direction: result.trades[0].direction,
        entryPrice: result.trades[0].entryPrice,
        pnl: result.trades[0].pnl
      } : null,
      lastTradeDetails: result.trades?.length > 0 ? {
        timestamp: result.trades[result.trades.length - 1].entryTimestamp,
        direction: result.trades[result.trades.length - 1].direction,
        entryPrice: result.trades[result.trades.length - 1].entryPrice,
        pnl: result.trades[result.trades.length - 1].pnl
      } : null,
      candlesProcessed: parameters.candlesCount,
      executionSource: parameters.executionSource,
    };

    this.saveTestResult(testResult, 'CPU_SINGLE');
    simpleLogger.info(`[TestResultsLogger] Logged CPU_SINGLE test: ${testResult.testId}`);
  }

  /**
   * Логирует результат портфельного CPU бэктеста
   */
  logCPUPortfolioTest(
    result: PortfolioBacktestResult,
    parameters: {
      pairSymbols: string[];
      timeframe: string;
      startDate: string;
      endDate: string;
      initialPortfolioCapital: number;
      totalCandlesCount: number;
      executionSource: 'IMMEDIATE' | 'QUEUE' | 'WEBSOCKET';
    }
  ): void {
    if (!this.config.enabled) return;

    // Собираем все сделки из портфеля
    const allTrades: any[] = [];
    for (const key in result.tradesByPair || {}) {
      if (result.tradesByPair![key]) {
        allTrades.push(...result.tradesByPair![key]);
      }
    }

    const testResult: BacktestTestResult = {
      testId: `cpu-portfolio-${Date.now()}-${parameters.pairSymbols.length}pairs`,
      timestamp: new Date().toISOString(),
      testType: 'CPU_PORTFOLIO',
      pairSymbols: parameters.pairSymbols,
      timeframe: parameters.timeframe,
      dateRange: {
        startDate: parameters.startDate,
        endDate: parameters.endDate,
      },
      initialCapital: parameters.initialPortfolioCapital,
      metrics: {
        totalPnl: result.overallMetrics.totalPortfolioPnl,
        totalPnlPercentage: result.overallMetrics.totalPortfolioPnlPercentage,
        totalTrades: result.overallMetrics.totalPortfolioTrades,
        winningTrades: result.overallMetrics.portfolioWinningTrades,
        losingTrades: result.overallMetrics.portfolioLosingTrades,
        winRate: result.overallMetrics.portfolioWinRate,
        profitFactor: result.overallMetrics.portfolioProfitFactor,
        maxDrawdown: result.overallMetrics.portfolioMaxDrawdown,
        durationMs: result.overallMetrics.durationMs || 0,
      },
      portfolioMetrics: {
        totalPortfolioTrades: result.overallMetrics.totalPortfolioTrades,
        portfolioWinRate: result.overallMetrics.portfolioWinRate,
        avgConcurrentTrades: result.overallMetrics.avgConcurrentTrades,
        peakConcurrentTrades: result.overallMetrics.peakConcurrentTrades,
      },
      strategyParameters: result.configUsed?.strategyParameters,
      firstTradeDetails: allTrades[0] ? {
        timestamp: allTrades[0].entryTimestamp,
        direction: allTrades[0].direction,
        entryPrice: allTrades[0].entryPrice,
        pnl: allTrades[0].pnl,
        pair: allTrades[0].pair
      } : null,
      lastTradeDetails: allTrades.length > 0 ? {
        timestamp: allTrades[allTrades.length - 1].entryTimestamp,
        direction: allTrades[allTrades.length - 1].direction,
        entryPrice: allTrades[allTrades.length - 1].entryPrice,
        pnl: allTrades[allTrades.length - 1].pnl,
        pair: allTrades[allTrades.length - 1].pair
      } : null,
      candlesProcessed: parameters.totalCandlesCount,
      executionSource: parameters.executionSource,
    };

    this.saveTestResult(testResult, 'CPU_PORTFOLIO');
    simpleLogger.info(`[TestResultsLogger] Logged CPU_PORTFOLIO test: ${testResult.testId}`);
  }

  /**
   * Сохраняет результат теста в файл
   */
  private saveTestResult(testResult: BacktestTestResult, testType: string): void {
    try {
      this.ensureDirectory(this.config.outputDirectory);
      
      const filename = `backtest-results-${testType.toLowerCase()}-${this.getDateString()}.json`;
      const filepath = path.join(this.config.outputDirectory, filename);

      let existingData: BacktestTestResult[] = [];
      if (fs.existsSync(filepath)) {
        const fileContent = fs.readFileSync(filepath, 'utf8');
        existingData = JSON.parse(fileContent);
      }

      existingData.push(testResult);

      // Ограничиваем количество результатов в файле
      if (existingData.length > this.config.maxResultsPerFile) {
        existingData = existingData.slice(-this.config.maxResultsPerFile);
      }

      fs.writeFileSync(filepath, JSON.stringify(existingData, null, 2));
      
    } catch (error: any) {
      simpleLogger.error(`[TestResultsLogger] Failed to save test result: ${error.message}`);
    }
  }

  /**
   * Получить компактную сводку последних тестов
   */
  getLatestTestsSummary(limit: number = 10): string {
    try {
      if (!fs.existsSync(this.config.outputDirectory)) {
        return 'Папка результатов тестов не найдена';
      }

      const files = fs.readdirSync(this.config.outputDirectory);
      const results: BacktestTestResult[] = [];

      for (const file of files) {
        if (file.startsWith('backtest-results-') && file.endsWith('.json')) {
          try {
            const filepath = path.join(this.config.outputDirectory, file);
            const content = fs.readFileSync(filepath, 'utf8');
            const fileResults: BacktestTestResult[] = JSON.parse(content);
            results.push(...fileResults);
          } catch (fileError: any) {
            simpleLogger.warn(`Failed to read file ${file}: ${fileError.message}`);
          }
        }
      }

      // Сортируем по времени и берем последние
      const latest = results
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, limit);

      let summary = `ПОСЛЕДНИЕ ${latest.length} ТЕСТОВ:\n`;
      summary += `Тип | Пары | PnL | Сделки | Винрейт% | Время\n`;
      
      latest.forEach(r => {
        const typeShort = r.testType.replace('_', '-').substring(0, 8);
        const pairsShort = r.pairSymbols.length === 1 ? r.pairSymbols[0] : `${r.pairSymbols.length}пар`;
        summary += `${typeShort} | ${pairsShort} | ${r.metrics.totalPnl.toFixed(1)} | ${r.metrics.totalTrades} | ${r.metrics.winRate.toFixed(1)}% | ${r.timestamp.substring(11, 19)}\n`;
      });

      return summary;

    } catch (error: any) {
      return `Ошибка получения сводки: ${error.message}`;
    }
  }

  private ensureDirectory(dirPath: string): void {
    if (this.ensuredDirectories.has(dirPath)) return;
    
    if (!fs.existsSync(dirPath)) {
      // Создаем директории рекурсивно
      const parts = dirPath.split(path.sep);
      let current = '';
      for (const part of parts) {
        current = path.join(current, part);
        if (current && !fs.existsSync(current)) {
          fs.mkdirSync(current);
        }
      }
    }
    this.ensuredDirectories.add(dirPath);
  }

  private getDateString(): string {
    return new Date().toISOString().split('T')[0];
  }
}

// Экспортируем глобальный экземпляр
export const testResultsLoggerStandalone = new TestResultsLoggerStandalone();

