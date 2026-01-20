/**
 * API для работы с результатами тестирования и их анализа
 */

import { Router, Request, Response } from 'express';
import { testResultsLogger } from '../services/testResultsLogger';
import logger from '../utils/logger';

const router = Router();

/**
 * Получить сравнительный отчет результатов тестов
 * GET /api/test-results/report?date=2024-01-15
 */
router.get('/report', async (req: Request, res: Response) => {
  try {
    const dateFilter = req.query.date as string;
    
    logger.info(`[TestResultsAPI] Generating comparison report. Date filter: ${dateFilter || 'none'}`);
    
    const report = await testResultsLogger.generateComparisonReport(dateFilter);
    
    res.status(200).json({
      success: true,
      report,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error('[TestResultsAPI] Error generating report:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate comparison report',
      error: error.message
    });
  }
});

/**
 * Получить компактную сводку последних тестов
 * GET /api/test-results/summary?limit=20
 */
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    
    logger.info(`[TestResultsAPI] Getting latest tests summary. Limit: ${limit}`);
    
    const summary = await testResultsLogger.getLatestTestsSummary(limit);
    
    res.status(200).json({
      success: true,
      summary,
      limit,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error('[TestResultsAPI] Error getting summary:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get tests summary',
      error: error.message
    });
  }
});

/**
 * Получить статистику по типам тестов
 * GET /api/test-results/stats
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    logger.info(`[TestResultsAPI] Getting test statistics`);
    
    // Получаем полный отчет и извлекаем статистику
    const fullReport = await testResultsLogger.generateComparisonReport();
    
    // Парсим статистику из отчета (упрощенно)
    const stats = {
      reportGenerated: new Date().toISOString(),
      summary: fullReport.substring(0, 500) + '...' // Компактная версия для API
    };
    
    res.status(200).json({
      success: true,
      stats,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error('[TestResultsAPI] Error getting stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get test statistics',
      error: error.message
    });
  }
});

export default router;

