import { Router } from 'express';
import { runBacktestHandler, runPortfolioBacktestHandler } from './backtester.controller';

const router = Router();

// POST /api/backtest/run
router.post('/run', runBacktestHandler);

// POST /api/backtest/portfolio/run - Новый endpoint для портфельного бектестера
router.post('/portfolio/run', runPortfolioBacktestHandler);

export default router; 