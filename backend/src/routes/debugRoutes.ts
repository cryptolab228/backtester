import { Router, Request, Response } from 'express';
import { okxGlobalRateLimiter, bybitGlobalRateLimiter, EXCHANGE_LIMITS } from '../services/smartRateLimiter';
import logger from '../utils/logger';
import { broadcast } from '../websocket';

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

/**
 * Тестовый endpoint для симуляции прогресса бэктеста
 */
router.post('/simulate-progress', async (req: Request, res: Response) => {
  try {
    const { jobId = 'test-job-' + Date.now(), type = 'single' } = req.body;
    
    logger.info(`[DebugRoutes] Starting progress simulation for job ${jobId} (${type})`);
    
    const stages = [
      { stage: 'initializing', description: 'Инициализация бэктеста...', duration: 2000 },
      { stage: 'loading_data', description: 'Загрузка исторических данных...', duration: 5000 },
      { stage: 'processing_indicators', description: 'Расчет технических индикаторов...', duration: 3000 },
      { stage: 'running_backtest', description: 'Выполнение бэктеста...', duration: 8000 },
      { stage: 'calculating_metrics', description: 'Расчет метрик производительности...', duration: 2000 },
      { stage: 'saving_results', description: 'Сохранение результатов...', duration: 1000 },
      { stage: 'completed', description: 'Бэктест завершен!', duration: 0 }
    ];
    
    const startTime = Date.now();
    const totalItems = type === 'portfolio' ? 10 : 1;
    
    let currentStageIndex = 0;
    let processedItems = 0;
    
    const sendProgressUpdate = () => {
      if (currentStageIndex >= stages.length) return;
      
      const currentStage = stages[currentStageIndex];
      const progress = Math.min(100, Math.round((processedItems / totalItems) * 100));
      
      // Создаем детальную разбивку по этапам
      const stageBreakdown = [
        { name: 'Инициализация', status: currentStageIndex > 0 ? 'completed' : (currentStageIndex === 0 ? 'active' : 'pending'), progress: currentStageIndex > 0 ? 100 : (currentStageIndex === 0 ? 50 : 0) },
        { name: 'Загрузка данных', status: currentStageIndex > 1 ? 'completed' : (currentStageIndex === 1 ? 'active' : 'pending'), progress: currentStageIndex > 1 ? 100 : (currentStageIndex === 1 ? progress : 0) },
        { name: 'Расчет индикаторов', status: currentStageIndex > 2 ? 'completed' : (currentStageIndex === 2 ? 'active' : 'pending'), progress: currentStageIndex > 2 ? 100 : (currentStageIndex === 2 ? progress : 0) },
        { name: 'Выполнение бэктеста', status: currentStageIndex > 3 ? 'completed' : (currentStageIndex === 3 ? 'active' : 'pending'), progress: currentStageIndex > 3 ? 100 : (currentStageIndex === 3 ? progress : 0) },
        { name: 'Расчет метрик', status: currentStageIndex > 4 ? 'completed' : (currentStageIndex === 4 ? 'active' : 'pending'), progress: currentStageIndex > 4 ? 100 : (currentStageIndex === 4 ? progress : 0) },
        { name: 'Сохранение результатов', status: currentStageIndex > 5 ? 'completed' : (currentStageIndex === 5 ? 'active' : 'pending'), progress: currentStageIndex > 5 ? 100 : (currentStageIndex === 5 ? progress : 0) }
      ];
      
      const progressUpdate = {
        jobId,
        stage: currentStage.stage,
        stageDescription: currentStage.description,
        processedItems,
        totalItems,
        startTime,
        stageBreakdown,
        portfolioStats: type === 'portfolio' ? {
          processedPairs: processedItems,
          totalPairs: totalItems,
          totalTrades: processedItems * 15, // Симуляция сделок
          dataLoaded: `${Math.round(processedItems * 2.5)} MB`,
          currentPair: `BTCUSDT`,
          pairsWithData: processedItems,
          pairsNeedingData: Math.max(0, totalItems - processedItems),
          apiCallsMade: processedItems * 50,
          dbQueriesMade: processedItems * 25
        } : undefined,
        gpuStats: {
          enabled: Math.random() > 0.5,
          status: 'active',
          utilization: Math.round(Math.random() * 80 + 20),
          memoryUsage: `${Math.round(Math.random() * 2000 + 500)} MB`,
          memoryTotal: '8192 MB',
          speedup: Math.round((Math.random() * 3 + 2) * 10) / 10,
          kernelsExecuted: processedItems * 100,
          averageKernelTime: Math.round(Math.random() * 5 + 1)
        },
        memoryUsage: Math.round(Math.random() * 500 + 100),
        estimatedCompletion: startTime + (stages.reduce((sum, s) => sum + s.duration, 0))
      };
      
             // Отправляем обновление через WebSocket
       broadcast({
         type: 'BACKTEST_PROGRESS',
         payload: progressUpdate
       });
      
      logger.debug(`[DebugRoutes] Progress update sent: ${currentStage.stage} (${processedItems}/${totalItems})`);
    };
    
    // Запускаем симуляцию
    let stageTimer: NodeJS.Timeout;
    
    const runStage = () => {
      if (currentStageIndex >= stages.length) {
        logger.info(`[DebugRoutes] Progress simulation completed for job ${jobId}`);
        return;
      }
      
      const currentStage = stages[currentStageIndex];
      const stageSteps = Math.max(1, Math.floor(currentStage.duration / 500)); // Обновления каждые 500мс
      let stepCount = 0;
      
      const stepTimer = setInterval(() => {
        stepCount++;
        
        // Увеличиваем processedItems постепенно в течение этапа
        if (currentStage.stage !== 'initializing' && currentStage.stage !== 'completed') {
          const stageProgress = stepCount / stageSteps;
          const expectedItemsForStage = Math.ceil((currentStageIndex / (stages.length - 2)) * totalItems);
          processedItems = Math.min(totalItems, Math.floor(expectedItemsForStage * stageProgress));
        }
        
        sendProgressUpdate();
        
        if (stepCount >= stageSteps) {
          clearInterval(stepTimer);
          
          if (currentStage.stage === 'completed') {
            processedItems = totalItems;
            sendProgressUpdate();
          }
          
          currentStageIndex++;
          setTimeout(runStage, 200); // Небольшая пауза между этапами
        }
      }, 500);
    };
    
    // Начинаем симуляцию через 1 секунду
    setTimeout(runStage, 1000);
    
    res.json({
      success: true,
      message: `Progress simulation started for job ${jobId}`,
      jobId,
      type,
      estimatedDuration: stages.reduce((sum, s) => sum + s.duration, 0)
    });
    
  } catch (error: any) {
    logger.error('[DebugRoutes] Error starting progress simulation:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start progress simulation',
      error: error.message
    });
  }
});

export default router; 