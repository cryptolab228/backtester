/**
 * Финальная версия API для работы с результатами тестирования
 * Использует автономный логгер без зависимости от winston
 */

import { Router, Request, Response } from 'express';
import { testResultsLoggerStandalone } from '../services/testResultsLogger_standalone';

const router = Router();

/**
 * Проверка работоспособности
 * GET /api/test-results-final/health
 */
router.get('/health', (req: Request, res: Response) => {
  try {
    res.status(200).json({
      success: true,
      message: 'Final test results system is working!',
      timestamp: new Date().toISOString(),
      version: 'standalone-v1.0'
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Error in final test results system',
      error: error.message
    });
  }
});

/**
 * Получить компактную сводку последних тестов
 * GET /api/test-results-final/summary?limit=20
 */
router.get('/summary', (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    
    console.log(`[TestResultsFinal] Getting latest tests summary. Limit: ${limit}`);
    
    const summary = testResultsLoggerStandalone.getLatestTestsSummary(limit);
    
    res.status(200).json({
      success: true,
      summary,
      limit,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error('[TestResultsFinal] Error getting summary:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get tests summary',
      error: error.message
    });
  }
});

/**
 * Тестовое логирование
 * POST /api/test-results-final/test-log
 */
router.post('/test-log', (req: Request, res: Response) => {
  try {
    // Создаем тестовый результат
    const testResult = {
      metrics: {
        totalPnl: 123.45,
        totalPnlPercentage: 12.35,
        totalTrades: 150,
        winningTrades: 60,
        losingTrades: 90,
        winRate: 40.0,
        profitFactor: 1.15,
        maxDrawdown: 15.2,
        durationMs: 500
      },
      trades: [
        {
          entryTimestamp: Date.now(),
          direction: 'long',
          entryPrice: 50000,
          pnl: 25.5
        }
      ],
      configUsed: {
        strategyParameters: { test: true }
      }
    };

    testResultsLoggerStandalone.logCPUSingleTest(testResult as any, {
      pairSymbol: 'TESTUSDT',
      timeframe: '1h',
      startDate: '2024-01-01',
      endDate: '2024-08-18',
      initialCapital: 1000,
      candlesCount: 1000,
      executionSource: 'IMMEDIATE'
    });

    res.status(200).json({
      success: true,
      message: 'Test log entry created successfully!',
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error('[TestResultsFinal] Error creating test log:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create test log',
      error: error.message
    });
  }
});

export default router;

