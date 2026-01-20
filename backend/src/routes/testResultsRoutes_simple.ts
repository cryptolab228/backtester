/**
 * Простая версия API для работы с результатами тестирования
 */

import { Router, Request, Response } from 'express';

const router = Router();

/**
 * Простая проверка работы роутов
 * GET /api/test-results-simple/health
 */
router.get('/health', async (req: Request, res: Response) => {
  try {
    res.status(200).json({
      success: true,
      message: 'Test results router is working!',
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Error in test results router',
      error: error.message
    });
  }
});

export default router;

