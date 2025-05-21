import { Router } from 'express';
import { runBacktestHandler } from './backtester.controller';

const router = Router();

// POST /api/backtest/run
router.post('/run', runBacktestHandler);

export default router; 