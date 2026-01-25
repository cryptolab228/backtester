/**
 * Контроллер для модуля Optimizer
 */

import { Request, Response } from 'express';
import logger from '@/utils/logger';
import { dataService } from '@/services/dataService';
import { broadcast } from '@/websocket';
import type { CandleData } from '@/interfaces/marketData.interface';
import {
  OptimizerConfig,
  OptimizationProgress,
  DEFAULT_CONSTRAINTS,
  DEFAULT_WALK_FORWARD
} from './optimizer.types';
import { runOptimization, exportResultsToCSV } from './optimizer';

// Хранилище активных оптимизаций
const activeOptimizations: Map<string, {
  config: OptimizerConfig;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  progress: OptimizationProgress;
  result?: any;
}> = new Map();

/**
 * Запуск оптимизации
 * POST /api/optimizer/start
 */
export async function startOptimization(req: Request, res: Response) {
  try {
    const config: OptimizerConfig = req.body;
    
    // Валидация входных данных
    if (!config.pairSymbols || config.pairSymbols.length === 0) {
      return res.status(400).json({ error: 'pairSymbols is required' });
    }
    if (!config.timeframe) {
      return res.status(400).json({ error: 'timeframe is required' });
    }
    if (!config.startDate || !config.endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }
    if (!config.parameterGrid || Object.keys(config.parameterGrid).length === 0) {
      return res.status(400).json({ error: 'parameterGrid is required' });
    }
    
    // Применяем дефолты
    config.constraints = { ...DEFAULT_CONSTRAINTS, ...config.constraints };
    config.walkForward = { ...DEFAULT_WALK_FORWARD, ...config.walkForward };
    config.exchange = config.exchange || 'bybit';
    config.objectiveFunction = config.objectiveFunction || 'calmar_ratio';
    
    logger.info(`[OptimizerCtrl] Starting optimization for ${config.pairSymbols.length} pairs`);
    
    // Загружаем данные свечей
    const startTimestamp = new Date(config.startDate).getTime();
    const endTimestamp = new Date(config.endDate).getTime();
    
    const candlesData: Record<string, CandleData[]> = {};
    let totalCandles = 0;
    
    for (const symbol of config.pairSymbols) {
      try {
        const candles = await dataService.getCandles(
          symbol,
          config.timeframe,
          startTimestamp,
          endTimestamp,
          config.exchange
        );
        
        if (candles.length > 0) {
          candlesData[symbol] = candles.map((c: any) => ({
            timestamp: Number(c.timestamp),
            open: Number(c.open),
            high: Number(c.high),
            low: Number(c.low),
            close: Number(c.close),
            volume: Number(c.volume)
          }));
          totalCandles += candles.length;
        }
      } catch (error: any) {
        logger.warn(`[OptimizerCtrl] Failed to load candles for ${symbol}: ${error.message}`);
      }
    }
    
    if (Object.keys(candlesData).length === 0) {
      return res.status(400).json({ 
        error: 'No candle data available for the specified pairs and date range' 
      });
    }
    
    logger.info(`[OptimizerCtrl] Loaded ${totalCandles} candles for ${Object.keys(candlesData).length} pairs`);
    
    // Запускаем оптимизацию асинхронно
    const optimizationPromise = runOptimization(
      config,
      candlesData,
      (progress: OptimizationProgress) => {
        // Обновляем прогресс в хранилище
        const existing = activeOptimizations.get(progress.jobId);
        if (existing) {
          existing.progress = progress;
        }
        
        // Отправляем прогресс через WebSocket
        broadcast({
          type: 'OPTIMIZATION_PROGRESS',
          payload: progress
        });
      }
    );
    
    // Сразу возвращаем ответ с jobId
    optimizationPromise.then(result => {
      activeOptimizations.set(result.jobId, {
        config,
        status: 'completed',
        progress: {
          jobId: result.jobId,
          status: 'completed',
          totalCombinations: result.totalCombinations,
          completedCombinations: result.totalCombinations,
          progressPercent: 100,
          startTime: result.startTime,
          elapsedTime: result.totalExecutionTimeMs,
          errors: result.errors
        },
        result
      });
      
      // Отправляем результат через WebSocket
      broadcast({
        type: 'OPTIMIZATION_COMPLETED',
        payload: result
      });
      
      logger.info(`[OptimizerCtrl] Optimization ${result.jobId} completed. Best Calmar: ${result.bestResult?.calmarRatio.toFixed(2) || 'N/A'}`);
    }).catch(error => {
      logger.error(`[OptimizerCtrl] Optimization failed:`, error);
      
      broadcast({
        type: 'OPTIMIZATION_FAILED',
        payload: { error: error.message }
      });
    });
    
    // Возвращаем начальный статус
    res.json({
      success: true,
      message: 'Optimization started',
      pairsLoaded: Object.keys(candlesData).length,
      totalCandles,
      config: {
        ...config,
        parameterGrid: config.parameterGrid
      }
    });
    
  } catch (error: any) {
    logger.error('[OptimizerCtrl] Error starting optimization:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * Получение статуса оптимизации
 * GET /api/optimizer/status/:jobId
 */
export async function getOptimizationStatus(req: Request, res: Response) {
  try {
    const { jobId } = req.params;
    
    const optimization = activeOptimizations.get(jobId);
    
    if (!optimization) {
      return res.status(404).json({ error: 'Optimization not found' });
    }
    
    res.json({
      jobId,
      status: optimization.status,
      progress: optimization.progress,
      hasResult: !!optimization.result
    });
    
  } catch (error: any) {
    logger.error('[OptimizerCtrl] Error getting status:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * Получение результатов оптимизации
 * GET /api/optimizer/results/:jobId
 */
export async function getOptimizationResults(req: Request, res: Response) {
  try {
    const { jobId } = req.params;
    const { format } = req.query;
    
    const optimization = activeOptimizations.get(jobId);
    
    if (!optimization) {
      return res.status(404).json({ error: 'Optimization not found' });
    }
    
    if (!optimization.result) {
      return res.status(400).json({ error: 'Optimization not completed yet' });
    }
    
    // Экспорт в CSV
    if (format === 'csv') {
      const csv = exportResultsToCSV(optimization.result);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=optimization_${jobId}.csv`);
      return res.send(csv);
    }
    
    // JSON ответ
    res.json(optimization.result);
    
  } catch (error: any) {
    logger.error('[OptimizerCtrl] Error getting results:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * Отмена оптимизации
 * POST /api/optimizer/cancel/:jobId
 */
export async function cancelOptimization(req: Request, res: Response) {
  try {
    const { jobId } = req.params;
    
    const optimization = activeOptimizations.get(jobId);
    
    if (!optimization) {
      return res.status(404).json({ error: 'Optimization not found' });
    }
    
    if (optimization.status !== 'running') {
      return res.status(400).json({ error: 'Optimization is not running' });
    }
    
    optimization.status = 'cancelled';
    
    broadcast({
      type: 'OPTIMIZATION_CANCELLED',
      payload: { jobId }
    });
    
    res.json({ success: true, message: 'Optimization cancelled' });
    
  } catch (error: any) {
    logger.error('[OptimizerCtrl] Error cancelling optimization:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * Получение списка всех оптимизаций
 * GET /api/optimizer/list
 */
export async function listOptimizations(req: Request, res: Response) {
  try {
    const list = Array.from(activeOptimizations.entries()).map(([jobId, opt]) => ({
      jobId,
      status: opt.status,
      pairSymbols: opt.config.pairSymbols,
      timeframe: opt.config.timeframe,
      progress: opt.progress?.progressPercent || 0,
      hasResult: !!opt.result
    }));
    
    res.json(list);
    
  } catch (error: any) {
    logger.error('[OptimizerCtrl] Error listing optimizations:', error);
    res.status(500).json({ error: error.message });
  }
}
