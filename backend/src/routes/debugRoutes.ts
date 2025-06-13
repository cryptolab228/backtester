import { Router, Request, Response } from 'express';
import { okxGlobalRateLimiter, bybitGlobalRateLimiter, EXCHANGE_LIMITS } from '../services/smartRateLimiter';
import logger from '../utils/logger';

const router = Router();

/**
 * Получение статистики по лимитам для диагностики
 */
router.get('/rate-limits', async (req: Request, res: Response) => {
  try {
    logger.info('[DebugRoutes] Getting rate limits statistics...');
    
    // Получаем статистику для обеих бирж
    const okxStats = await okxGlobalRateLimiter.getStats();
    const bybitStats = await bybitGlobalRateLimiter.getStats();
    
    const result = {
      timestamp: new Date().toISOString(),
      exchanges: {
        okx: {
          configured: EXCHANGE_LIMITS.okx,
          current: okxStats
        },
        bybit: {
          configured: EXCHANGE_LIMITS.bybit,
          current: bybitStats
        }
      },
      summary: {
        okx: `${okxStats.global.current}/${okxStats.global.limit} (${okxStats.global.percentage}%)`,
        bybit: `${bybitStats.global.current}/${bybitStats.global.limit} (${bybitStats.global.percentage}%)`
      }
    };
    
    logger.info('[DebugRoutes] Rate limits statistics retrieved successfully');
    
    res.json({
      success: true,
      data: result
    });
    
  } catch (error: any) {
    logger.error('[DebugRoutes] Error getting rate limits statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get rate limits statistics',
      error: error.message
    });
  }
});

/**
 * Информация о текущем алгоритме и настройках
 */
router.get('/algorithm-info', async (req: Request, res: Response) => {
  try {
    logger.info('[DebugRoutes] Getting algorithm information...');
    
    const result = {
      timestamp: new Date().toISOString(),
      algorithm: {
        primary_exchange: 'bybit',
        fallback_exchange: 'okx',
        optimization_enabled: true,
        parallel_fetching: true,
        database_priority: true
      },
      performance: {
        bybit: {
          requests_per_second: EXCHANGE_LIMITS.bybit.requestsPerSecond,
          candles_per_request: 1000,
          performance_multiplier: '13x vs OKX'
        },
        okx: {
          requests_per_second: EXCHANGE_LIMITS.okx.requestsPerSecond,
          candles_per_request: 300,
          performance_multiplier: '1x (baseline)'
        }
      },
      current_settings: {
        smart_rate_limiting: true,
        redis_coordination: true,
        worker_coordination: true,
        global_rate_limits: true
      }
    };
    
    logger.info('[DebugRoutes] Algorithm information retrieved successfully');
    
    res.json({
      success: true,
      data: result
    });
    
  } catch (error: any) {
    logger.error('[DebugRoutes] Error getting algorithm information:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get algorithm information',
      error: error.message
    });
  }
});

export default router; 