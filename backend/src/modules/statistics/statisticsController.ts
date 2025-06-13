import { Request, Response } from 'express';
import { AppDataSource } from '../../config/dataSource';
import { Candle } from '../../models/Candle';
import { dataQueue } from '../../config/queue';
import logger from '../../utils/logger';

export interface SystemHealth {
  database: 'healthy' | 'error';
  redis: 'healthy' | 'error';
  queue: 'healthy' | 'error';
}

export interface BacktesterStatistics {
  systemHealth: SystemHealth;
  queueStatistics: {
    totalJobs: number;
    activeJobs: number;
    waitingJobs: number;
    completedJobs: number;
    failedJobs: number;
  };
  dataStatistics: {
    totalTradingPairs: number;
    totalCandles: number;
    latestDataTimestamp: string | null;
    oldestDataTimestamp: string | null;
  };
  backtestStatistics: {
    totalBacktestsRun: number;
    totalPortfolioBacktests: number;
    avgBacktestDuration: number | null;
    lastBacktestTimestamp: string | null;
  };
  resourceUsage: {
    uptime: number;
    memoryUsage: {
      used: number;
      total: number;
      percentage: number;
    };
  };
}

class StatisticsController {
  /**
   * Получение статистики для dashboard
   */
  async getDashboardStatistics(req: Request, res: Response): Promise<void> {
    try {
      logger.info('[StatisticsController] Fetching dashboard statistics...');

      const [
        systemHealth,
        queueStatistics,
        dataStatistics,
        backtestStatistics,
        resourceUsage
      ] = await Promise.all([
        this.getSystemHealth(),
        this.getQueueStatistics(),
        this.getDataStatistics(),
        this.getBacktestStatistics(),
        this.getResourceUsage()
      ]);

      const statistics: BacktesterStatistics = {
        systemHealth,
        queueStatistics,
        dataStatistics,
        backtestStatistics,
        resourceUsage
      };

      logger.info('[StatisticsController] Dashboard statistics fetched successfully');
      res.json(statistics);
    } catch (error: any) {
      logger.error('[StatisticsController] Error fetching dashboard statistics:', error);
      res.status(500).json({
        error: 'Failed to fetch dashboard statistics',
        message: error.message
      });
    }
  }

  /**
   * Проверка здоровья системных компонентов
   */
  private async getSystemHealth(): Promise<SystemHealth> {
    const health: SystemHealth = {
      database: 'error',
      redis: 'error',
      queue: 'error'
    };

    try {
      // Проверка базы данных
      await AppDataSource.query('SELECT 1');
      health.database = 'healthy';
    } catch (error) {
      logger.warn('[StatisticsController] Database health check failed:', error);
    }

    try {
      // Проверка Redis через получение количества задач (требует работающего Redis)
      await dataQueue.getJobCounts();
      health.redis = 'healthy';
      health.queue = 'healthy'; // Если getJobCounts работает, то и очередь работает
    } catch (error) {
      logger.warn('[StatisticsController] Redis/Queue health check failed:', error);
    }

    return health;
  }

  /**
   * Статистика очереди задач
   */
  private async getQueueStatistics() {
    try {
      const counts = await dataQueue.getJobCounts();
      
      return {
        totalJobs: Object.values(counts).reduce((sum: number, count: number) => sum + count, 0),
        activeJobs: counts.active || 0,
        waitingJobs: (counts.waiting || 0) + (counts.wait || 0),
        completedJobs: counts.completed || 0,
        failedJobs: counts.failed || 0
      };
    } catch (error) {
      logger.warn('[StatisticsController] Failed to get queue statistics:', error);
      return {
        totalJobs: 0,
        activeJobs: 0,
        waitingJobs: 0,
        completedJobs: 0,
        failedJobs: 0
      };
    }
  }

  /**
   * Статистика данных
   */
  private async getDataStatistics() {
    try {
      // Количество торговых пар
      const totalTradingPairs = await AppDataSource.query(
        'SELECT COUNT(*) as count FROM trading_pairs'
      );

      // Количество свечей
      const totalCandles = await AppDataSource.query(
        'SELECT COUNT(*) as count FROM candles'
      );

      // Самые новые и старые данные
      const timeRange = await AppDataSource.query(`
        SELECT 
          MAX(timestamp) as latest_timestamp,
          MIN(timestamp) as oldest_timestamp
        FROM candles
      `);

      return {
        totalTradingPairs: parseInt(totalTradingPairs[0]?.count || '0'),
        totalCandles: parseInt(totalCandles[0]?.count || '0'),
        latestDataTimestamp: timeRange[0]?.latest_timestamp || null,
        oldestDataTimestamp: timeRange[0]?.oldest_timestamp || null
      };
    } catch (error) {
      logger.warn('[StatisticsController] Failed to get data statistics:', error);
      return {
        totalTradingPairs: 0,
        totalCandles: 0,
        latestDataTimestamp: null,
        oldestDataTimestamp: null
      };
    }
  }

  /**
   * Статистика бэктестов
   */
  private async getBacktestStatistics() {
    try {
      // Получаем статистику из очереди задач
      const jobs = await dataQueue.getJobs(['completed'], 0, -1);
      
      const backtestJobs = jobs.filter(job => 
        job.name === 'RUN_BACKTEST' || job.name === 'FETCH_PORTFOLIO_DATA_AND_RUN_BACKTEST'
      );

      const singleBacktests = backtestJobs.filter(job => job.name === 'RUN_BACKTEST');
      const portfolioBacktests = backtestJobs.filter(job => job.name === 'FETCH_PORTFOLIO_DATA_AND_RUN_BACKTEST');

      // Средняя продолжительность
      const durations = backtestJobs
        .filter(job => job.processedOn && job.finishedOn)
        .map(job => (job.finishedOn! - job.processedOn!));
      
      const avgDuration = durations.length > 0 
        ? durations.reduce((sum, duration) => sum + duration, 0) / durations.length
        : null;

      // Последний бэктест
      const lastBacktest = backtestJobs
        .filter(job => job.finishedOn)
        .sort((a, b) => (b.finishedOn! - a.finishedOn!))[0];

      return {
        totalBacktestsRun: singleBacktests.length,
        totalPortfolioBacktests: portfolioBacktests.length,
        avgBacktestDuration: avgDuration,
        lastBacktestTimestamp: lastBacktest?.finishedOn ? new Date(lastBacktest.finishedOn).toISOString() : null
      };
    } catch (error) {
      logger.warn('[StatisticsController] Failed to get backtest statistics:', error);
      return {
        totalBacktestsRun: 0,
        totalPortfolioBacktests: 0,
        avgBacktestDuration: null,
        lastBacktestTimestamp: null
      };
    }
  }

  /**
   * Использование ресурсов
   */
  private async getResourceUsage() {
    const memoryUsage = process.memoryUsage();
    const uptime = process.uptime();

    return {
      uptime,
      memoryUsage: {
        used: Math.round(memoryUsage.heapUsed / 1024 / 1024), // MB
        total: Math.round(memoryUsage.heapTotal / 1024 / 1024), // MB
        percentage: Math.round((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100)
      }
    };
  }
}

// Экспортируем экземпляр класса
export default new StatisticsController(); 