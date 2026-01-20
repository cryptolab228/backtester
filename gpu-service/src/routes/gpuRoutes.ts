import express from 'express';
import { getRequestId, getRequestDuration } from '../middleware/requestTracing';
import { recordHttpMetrics, recordGPUBacktestMetrics } from '../utils/metrics';
import { executeWithCircuitBreaker } from '../middleware/circuitBreaker';
import { createError } from '../middleware/errorHandler';
import { logInfo, logError } from '../utils/logger';

const router = express.Router();

/**
 * Get available indicators
 */
router.get('/indicators', async (req, res) => {
  const requestId = getRequestId(req);
  const startTime = Date.now();

  try {
    logInfo('Getting available indicators', {}, requestId);

    // Simulate GPU indicators
    const indicators = [
      'SMA', 'EMA', 'RSI', 'MACD', 'Bollinger Bands',
      'ATR', 'Stochastic', 'Williams %R', 'CCI', 'ROC'
    ];

    const duration = Date.now() - startTime;
    recordHttpMetrics('GET', '/api/gpu/indicators', 200, duration, req.app);

    res.json({
      success: true,
      indicators,
      requestId,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    const duration = Date.now() - startTime;
    recordHttpMetrics('GET', '/api/gpu/indicators', 500, duration, req.app);
    logError(error, { requestId }, requestId);
    throw error;
  }
});

/**
 * GPU Backtest endpoint
 */
router.post('/backtest', async (req, res) => {
  const requestId = getRequestId(req);
  const startTime = Date.now();

  try {
    const { candles, strategy, parameters, initial_capital, symbol } = req.body;

    logInfo('Starting GPU backtest', {
      symbol,
      candlesCount: candles?.length,
      strategy
    }, requestId);

    // Validate request
    if (!candles || !Array.isArray(candles) || candles.length === 0) {
      throw createError('Candles data is required', 400);
    }

    if (!strategy || !parameters || !initial_capital) {
      throw createError('Strategy, parameters, and initial capital are required', 400);
    }

    // Execute with circuit breaker protection
    const result = await executeWithCircuitBreaker(async () => {
      // Simulate GPU processing
      await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));

      // Simulate GPU backtest result
      const isSuccess = Math.random() > 0.1; // 90% success rate

      if (!isSuccess) {
        throw createError('GPU processing failed', 500);
      }

      return {
        success: true,
        data: {
          metrics: {
            total_pnl: (Math.random() - 0.5) * 1000,
            total_trades: Math.floor(Math.random() * 50) + 10,
            winning_trades: Math.floor(Math.random() * 30) + 5,
            losing_trades: Math.floor(Math.random() * 20),
            win_rate: Math.random() * 40 + 30, // 30-70%
            profit_factor: Math.random() * 2 + 0.5,
            max_drawdown: Math.random() * 20 + 5,
            initial_capital: initial_capital,
            final_capital: initial_capital + (Math.random() - 0.5) * 500
          },
          trades: [],
          equity_curve: []
        },
        message: 'GPU backtest completed successfully',
        processing_time: Date.now() - startTime
      };
    });

    const duration = Date.now() - startTime;
    recordHttpMetrics('POST', '/api/gpu/backtest', 200, duration, req.app);
    recordGPUBacktestMetrics(symbol || 'unknown', true, duration, req.app);

    logInfo('GPU backtest completed successfully', {
      symbol,
      duration: `${duration}ms`,
      trades: result.data?.metrics?.total_trades
    }, requestId);

    res.json(result);

  } catch (error: any) {
    const duration = Date.now() - startTime;
    recordHttpMetrics('POST', '/api/gpu/backtest', error.statusCode || 500, duration, req.app);

    if (error.statusCode >= 500) {
      recordGPUBacktestMetrics(req.body.symbol || 'unknown', false, duration, req.app);
    }

    logError(error, {
      symbol: req.body.symbol,
      candlesCount: req.body.candles?.length
    }, requestId);

    throw error;
  }
});

/**
 * Optimized GPU Backtest endpoint
 */
router.post('/backtest-optimized', async (req, res) => {
  const requestId = getRequestId(req);
  const startTime = Date.now();

  try {
    const { candles, strategy, parameters, initial_capital, symbol } = req.body;

    logInfo('Starting optimized GPU backtest', {
      symbol,
      candlesCount: candles?.length,
      compressed: req.body.compressed
    }, requestId);

    // Validate request
    if (!candles || !Array.isArray(candles) || candles.length === 0) {
      throw createError('Candles data is required', 400);
    }

    const result = await executeWithCircuitBreaker(async () => {
      // Simulate optimized GPU processing (faster)
      await new Promise(resolve => setTimeout(resolve, Math.random() * 500 + 200));

      const isSuccess = Math.random() > 0.05; // 95% success rate for optimized

      if (!isSuccess) {
        throw createError('Optimized GPU processing failed', 500);
      }

      return {
        success: true,
        optimization_used: true,
        data: {
          backtest_results: {
            total_trades: Math.floor(Math.random() * 60) + 15,
            profitable_trades: Math.floor(Math.random() * 35) + 8,
            total_profit: (Math.random() - 0.5) * 1200,
            final_balance: initial_capital + (Math.random() - 0.5) * 600,
            return_percentage: (Math.random() - 0.5) * 50,
            max_drawdown: Math.random() * 25 + 8,
            win_rate: Math.random() * 45 + 25,
            profit_factor: Math.random() * 2.5 + 0.8,
            gross_profit: Math.random() * 800 + 200,
            gross_loss: Math.random() * 400 + 100
          },
          gpu_enabled: true,
          processing_time_seconds: (Date.now() - startTime) / 1000,
          performance_metrics: {
            candles_per_second: Math.floor(Math.random() * 5000) + 1000,
            gpu_acceleration_used: true,
            memory_efficient: true
          },
          gpu_memory_usage: {
            peak_usage_mb: Math.random() * 2000 + 500,
            average_usage_mb: Math.random() * 1500 + 300
          }
        },
        api_processing_time_ms: Date.now() - startTime
      };
    });

    const duration = Date.now() - startTime;
    recordHttpMetrics('POST', '/api/gpu/backtest-optimized', 200, duration, req.app);
    recordGPUBacktestMetrics(symbol || 'unknown', true, duration, req.app);

    logInfo('Optimized GPU backtest completed', {
      symbol,
      duration: `${duration}ms`,
      gpuEnabled: result.data.gpu_enabled
    }, requestId);

    res.json(result);

  } catch (error: any) {
    const duration = Date.now() - startTime;
    recordHttpMetrics('POST', '/api/gpu/backtest-optimized', error.statusCode || 500, duration, req.app);

    if (error.statusCode >= 500) {
      recordGPUBacktestMetrics(req.body.symbol || 'unknown', false, duration, req.app);
    }

    logError(error, {
      symbol: req.body.symbol,
      candlesCount: req.body.candles?.length
    }, requestId);

    throw error;
  }
});

/**
 * GPU Statistics endpoint
 */
router.get('/stats', async (req, res) => {
  const requestId = getRequestId(req);
  const startTime = Date.now();

  try {
    logInfo('Getting GPU statistics', {}, requestId);

    // Simulate GPU stats
    const stats = {
      gpu_available: Math.random() > 0.1, // 90% availability
      gpu_utilization: Math.random() * 100,
      gpu_memory_used: Math.random() * 4000,
      gpu_memory_total: 4096,
      gpu_temperature: Math.random() * 30 + 40, // 40-70°C
      active_backtests: Math.floor(Math.random() * 5),
      completed_backtests: Math.floor(Math.random() * 100) + 50,
      average_processing_time: Math.random() * 2000 + 500,
      circuit_breaker_state: Math.random() > 0.8 ? 'OPEN' : 'CLOSED'
    };

    const duration = Date.now() - startTime;
    recordHttpMetrics('GET', '/api/gpu/stats', 200, duration, req.app);

    res.json({
      success: true,
      stats,
      requestId,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    const duration = Date.now() - startTime;
    recordHttpMetrics('GET', '/api/gpu/stats', 500, duration, req.app);
    logError(error, { requestId }, requestId);
    throw error;
  }
});

export { router as gpuRoutes };











































