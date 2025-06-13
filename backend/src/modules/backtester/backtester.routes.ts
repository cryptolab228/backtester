import { Router } from 'express';
import { runBacktestHandler, runPortfolioBacktestHandler } from './backtester.controller';
import { broadcast } from '@/websocket';

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

export default router; 