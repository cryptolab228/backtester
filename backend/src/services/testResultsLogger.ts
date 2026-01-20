/**
 * Сервис для логирования и анализа результатов различных типов бэктестов
 * Позволяет четко разделить и сравнить:
 * - CPU одиночные тесты
 * - CPU портфельные тесты  
 * - GPU одиночные тесты
 * - GPU портфельные тесты
 */

import * as fs from 'fs';
import * as path from 'path';
import { BacktestTestResult, TestResultConfig, DEFAULT_TEST_RESULTS_CONFIG } from '../config/testResultsConfig';
import { BacktestResult, PortfolioBacktestResult } from '../modules/backtester/backtester.types';
import logger from '../utils/logger';
import { AppDataSource } from '@/config/dataSource';
import { EntityManager } from 'typeorm';
import * as winston from 'winston';
import { TestResult } from '../modules/testResult/testResult.entity';

class TestResultsLogger {
  private static instance: TestResultsLogger;
  private config: TestResultConfig;
  private winstonInstance: winston.Logger | null = null;
  private logFilePath: string;
  private testId: string | null = null;
  private buffer: string[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private isInitialized = false;
  private ensuredDirectories = new Set<string>();
  private logger: winston.Logger; // Добавляем свойство logger

  private constructor() {
    this.config = DEFAULT_TEST_RESULTS_CONFIG;
    this.logFilePath = path.join(__dirname, `../../logs/test-results-standalone.log`);

    // НЕЗАВИСИМЫЙ логгер для самого сервиса
    this.logger = winston.createLogger({
        level: 'info',
        format: winston.format.combine(
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            winston.format.printf(({ timestamp, level, message }) => `${timestamp} [TestResultsLogger] ${level}: ${message}`)
        ),
        transports: [
            new winston.transports.Console(),
            new winston.transports.File({ filename: this.logFilePath, maxsize: 5 * 1024 * 1024 }) // 5MB
        ]
    });

    this.logger.info("TestResultsLogger instance created.");
  }

  public static getInstance(): TestResultsLogger {
    if (!TestResultsLogger.instance) {
      TestResultsLogger.instance = new TestResultsLogger();
    }
    return TestResultsLogger.instance;
  }

  public initialize(testId: string, winstonInstance?: winston.Logger) {
    if (this.isInitialized && this.testId === testId) {
      this.logger.warn(`Logger for test ID ${testId} is already initialized.`);
      return;
    }

    this.testId = testId;
    this.winstonInstance = winstonInstance || null;
    this.isInitialized = true;
    
    this.logger.info(`Initializing for test ID: ${testId}`);

    if (this.winstonInstance) {
        this.logger.info("External winston instance provided. Logging will be duplicated.");
    } else {
        this.logger.warn("No external winston instance provided. Logging to standalone files only.");
    }

    // Запускаем интервал для сброса буфера в БД
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    this.flushInterval = setInterval(() => this.flushBufferToDb(), 5000); // каждые 5 секунд
    this.logger.info("DB buffer flush interval started (5s).");
  }

  /**
   * Логирует результат одиночного CPU бэктеста
   */
  async logCPUSingleTest(
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
  ): Promise<void> {
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

    await this.saveTestResult(testResult, 'CPU_SINGLE');
    this.log('info', `[TestResultsLogger] Logged CPU_SINGLE test: ${testResult.testId}`);
  }

  /**
   * Логирует результат портфельного CPU бэктеста
   */
  async logCPUPortfolioTest(
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
  ): Promise<void> {
    if (!this.config.enabled) return;

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

    await this.saveTestResult(testResult, 'CPU_PORTFOLIO');
    this.log('info', `[TestResultsLogger] Logged CPU_PORTFOLIO test: ${testResult.testId}`);
  }

  /**
   * Логирует результат одиночного GPU бэктеста
   */
  async logGPUSingleTest(
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
  ): Promise<void> {
    if (!this.config.enabled) return;

    const testResult: BacktestTestResult = {
      testId: `gpu-single-${Date.now()}-${parameters.pairSymbol}`,
      timestamp: new Date().toISOString(),
      testType: 'GPU_SINGLE',
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

    await this.saveTestResult(testResult, 'GPU_SINGLE');
    this.log('info', `[TestResultsLogger] Logged GPU_SINGLE test: ${testResult.testId}`);
  }

  /**
   * Логирует результат портфельного GPU бэктеста (когда будет реализован)
   */
  async logGPUPortfolioTest(
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
  ): Promise<void> {
    if (!this.config.enabled) return;

    const allTrades: any[] = [];
    for (const key in result.tradesByPair || {}) {
      if (result.tradesByPair![key]) {
        allTrades.push(...result.tradesByPair![key]);
      }
    }

    const testResult: BacktestTestResult = {
      testId: `gpu-portfolio-${Date.now()}-${parameters.pairSymbols.length}pairs`,
      timestamp: new Date().toISOString(),
      testType: 'GPU_PORTFOLIO',
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
      candlesProcessed: parameters.totalCandlesCount,
      executionSource: parameters.executionSource,
    };

    await this.saveTestResult(testResult, 'GPU_PORTFOLIO');
    this.log('info', `[TestResultsLogger] Logged GPU_PORTFOLIO test: ${testResult.testId}`);
  }

  /**
   * Сохраняет результат теста в файл
   */
  private async saveTestResult(testResult: BacktestTestResult, testType: string): Promise<void> {
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
      this.log('error', `[TestResultsLogger] Failed to save test result: ${error.message}`);
    }
  }

  /**
   * Возвращает сравнительную таблицу результатов тестов
   */
  async generateComparisonReport(dateFilter?: string): Promise<string> {
    try {
      const files = fs.readdirSync(this.config.outputDirectory);
      const results: BacktestTestResult[] = [];

      for (const file of files) {
        if (file.startsWith('backtest-results-') && file.endsWith('.json')) {
          const filepath = path.join(this.config.outputDirectory, file);
          const content = fs.readFileSync(filepath, 'utf8');
          const fileResults: BacktestTestResult[] = JSON.parse(content);
          results.push(...fileResults);
        }
      }

      // Фильтруем по дате если указано
      let filteredResults = results;
      if (dateFilter) {
        filteredResults = results.filter(r => r.timestamp.startsWith(dateFilter));
      }

      // Группируем по типам тестов
      const byType = {
        CPU_SINGLE: filteredResults.filter(r => r.testType === 'CPU_SINGLE'),
        CPU_PORTFOLIO: filteredResults.filter(r => r.testType === 'CPU_PORTFOLIO'),
        GPU_SINGLE: filteredResults.filter(r => r.testType === 'GPU_SINGLE'),
        GPU_PORTFOLIO: filteredResults.filter(r => r.testType === 'GPU_PORTFOLIO'),
      };

      let report = `
# СРАВНИТЕЛЬНЫЙ ОТЧЕТ РЕЗУЛЬТАТОВ БЭКТЕСТОВ
Дата генерации: ${new Date().toLocaleString()}
Всего результатов: ${filteredResults.length}

## СТАТИСТИКА ПО ТИПАМ ТЕСТОВ:
- CPU Одиночные: ${byType.CPU_SINGLE.length} тестов
- CPU Портфельные: ${byType.CPU_PORTFOLIO.length} тестов  
- GPU Одиночные: ${byType.GPU_SINGLE.length} тестов
- GPU Портфельные: ${byType.GPU_PORTFOLIO.length} тестов

`;

      // Добавляем таблицы с последними результатами для каждого типа
      for (const type in byType) {
        const typeResults = byType[type as keyof typeof byType];
        if (typeResults && typeResults.length > 0) {
          const latest = typeResults.slice(-5); // Последние 5 тестов
          report += `\n## ${type} (последние ${latest.length} тестов):\n`;
          report += `| ID | Пары | PnL | PnL% | Сделки | Винрейт% | Макс.Просадка% | Время |\n`;
          report += `|----|----|----|----|----|----|----|----|\\n`;
          
          latest.forEach((r: BacktestTestResult) => {
            report += `| ${r.testId.slice(-12)} | ${r.pairSymbols.join(',')} | ${r.metrics.totalPnl.toFixed(2)} | ${r.metrics.totalPnlPercentage.toFixed(2)} | ${r.metrics.totalTrades} | ${r.metrics.winRate.toFixed(2)} | ${r.metrics.maxDrawdown.toFixed(2)} | ${r.metrics.durationMs}ms |\n`;
          });
        }
      }

      return report;

    } catch (error: any) {
      this.log('error', `[TestResultsLogger] Failed to generate comparison report: ${error.message}`);
      return `Ошибка генерации отчета: ${error.message}`;
    }
  }

  /**
   * Возвращает компактную сводку последних тестов для контекста
   */
  async getLatestTestsSummary(limit: number = 10): Promise<string> {
    try {
      const files = fs.readdirSync(this.config.outputDirectory);
      const results: BacktestTestResult[] = [];

      for (const file of files) {
        if (file.startsWith('backtest-results-') && file.endsWith('.json')) {
          const filepath = path.join(this.config.outputDirectory, file);
          const content = fs.readFileSync(filepath, 'utf8');
          const fileResults: BacktestTestResult[] = JSON.parse(content);
          results.push(...fileResults);
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
      // Создаем директории рекурсивно (старый способ для совместимости)
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

  // Метод для логирования
  public log(level: string, message: string, meta?: any) {
    if (!this.isInitialized || !this.testId) {
      this.logger.error("Logger not initialized. Call initialize(testId) first.");
      console.error("Logger not initialized. Call initialize(testId) first.");
      return;
    }

    const logEntry = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message} ${meta ? JSON.stringify(meta) : ''}`;
    this.buffer.push(logEntry);

    // Дублирование логов в основной логгер, если он есть
    if (this.winstonInstance) {
      this.winstonInstance.log(level, `[TestID: ${this.testId}] ${message}`, meta);
    } else {
        // Если внешнего логгера нет, пишем в свой собственный
        this.logger.log(level, `[TestID: ${this.testId}] ${message}`, meta);
    }
  }

  // Метод для сброса буфера в БД
  private async flushBufferToDb() {
    if (this.buffer.length === 0) {
      return;
    }

    if (!this.testId) {
        this.logger.warn("Cannot flush buffer to DB: testId is not set.");
        return;
    }

    const logsToFlush = [...this.buffer];
    this.buffer = [];

    this.logger.info(`Flushing ${logsToFlush.length} log entries to DB for test ID: ${this.testId}`);

    try {
      if (!AppDataSource.isInitialized) {
        this.logger.warn("DataSource is not initialized. Re-queueing logs.");
        this.buffer.unshift(...logsToFlush);
        return;
      }

      await AppDataSource.transaction(async (transactionalEntityManager: EntityManager) => {
        const testResult = await transactionalEntityManager.findOne(TestResult, { where: { testId: this.testId! } });
        if (testResult) {
          // Добавляем новые логи к существующим
          const updatedLogs = (testResult.logs || []).concat(logsToFlush);
          await transactionalEntityManager.update(TestResult, testResult.id, { logs: updatedLogs });
          this.logger.debug(`Successfully flushed ${logsToFlush.length} logs to DB for test ID: ${this.testId}`);
        } else {
          this.logger.warn(`TestResult with testId ${this.testId} not found. Logs cannot be flushed.`);
          // Возвращаем логи в буфер, если запись еще не создана
          this.buffer.unshift(...logsToFlush);
        }
      });
    } catch (error: any) {
      this.logger.error(`Failed to flush logs to DB for testId ${this.testId}: ${error.message}`, { stack: error.stack });
      // Возвращаем логи в буфер при ошибке
      this.buffer.unshift(...logsToFlush);
    }
  }

  // Метод для остановки и очистки
  public async close() {
    if (!this.isInitialized) {
      return;
    }
    
    this.logger.info(`Closing logger for test ID: ${this.testId}`);

    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }

    // Финальный сброс оставшихся логов
    await this.flushBufferToDb();
    
    this.logger.info(`Logger for test ID: ${this.testId} closed.`);

    this.testId = null;
    this.isInitialized = false;
    this.winstonInstance = null;
  }
}

export const testResultsLogger = TestResultsLogger.getInstance();
