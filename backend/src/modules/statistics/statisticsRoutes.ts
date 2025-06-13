import { Router } from 'express';
import statisticsController from './statisticsController';

const router = Router();

// Получение статистики dashboard
router.get('/dashboard', (req, res) => statisticsController.getDashboardStatistics(req, res));

export default router; 