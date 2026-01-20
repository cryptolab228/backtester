import { Router } from 'express';
import { runBacktestHandler, runPortfolioBacktestHandler, compareCpuGpuHandler } from './backtester.controller';
import { broadcast } from '@/websocket';
import { checkGPUServiceHealth, getGPUStats } from '../../services/gpuService';

const router = Router();

// POST /api/backtest/run - запуск одиночного бэктеста
router.post('/run', runBacktestHandler);

// POST /api/backtest/portfolio - запуск портфельного бэктеста  
router.post('/portfolio', runPortfolioBacktestHandler);

// POST /api/backtest/portfolio/run - альтернативный путь для совместимости
router.post('/portfolio/run', runPortfolioBacktestHandler);

// POST /api/backtest/clear-state - очистка состояния фронтенда
router.post('/clear-state', (req, res) => {
  try {
    // Отправляем событие очистки состояния
    broadcast({
      type: 'PORTFOLIO_STATE_CLEARED',
      payload: {
        timestamp: new Date().toISOString(),
        message: 'Portfolio backtest state cleared'
      }
    });
    
    res.json({ 
      success: true, 
      message: 'Portfolio state cleared successfully' 
    });
  } catch (error: any) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// GET /api/backtest/gpu/health - проверка статуса GPU сервиса
router.get('/gpu/health', async (req, res) => {
  try {
    const isHealthy = await checkGPUServiceHealth();
    const stats = await getGPUStats();

    res.json({
      success: true,
      gpu_available: isHealthy,
      gpu_stats: stats,
      disabled: process.env.DISABLE_GPU_SERVICE === 'true',
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      gpu_available: false,
      error: error.message
    });
  }
});

// POST /api/backtest/compare - сравнение CPU и GPU результатов на одном наборе данных
router.post('/compare', compareCpuGpuHandler);

export default router; 