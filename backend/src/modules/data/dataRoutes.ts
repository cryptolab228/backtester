import express from 'express';
import DataController from './dataController';
import logger from '@/utils/logger';
// import { validateFetchCandles } from './dataValidation'; // Убираем, т.к. файл не найден

logger.info('[RouterInit] Initializing dataRoutes.ts...');
const router = express.Router();

// Роуты для запуска задач
router.post('/fetch-pairs', DataController.triggerFetchPairs);
logger.info('[RouterInit] Route POST /fetch-pairs registered.');

router.post(
  '/fetch-candles',
  // validateFetchCandles, // Валидация входных данных (пока убрана)
  DataController.triggerFetchCandles // Исправлено имя метода
);
logger.info('[RouterInit] Route POST /fetch-candles registered.');

// Новый роут для получения всех торговых пар
router.get(
  '/trading-pairs',
  DataController.getAllTradingPairs
);
logger.info('[RouterInit] Route GET /trading-pairs registered.');

// --- Роуты для управления очередью --- 

// Получение количества задач по статусам
router.get('/queue/job-counts', DataController.getQueueJobCounts);
logger.info('[RouterInit] Route GET /queue/job-counts registered.');

// Получение списка задач с фильтрацией по статусу
router.get('/queue/jobs', DataController.getJobs);
logger.info('[RouterInit] Route GET /queue/jobs registered.');

// Получение деталей конкретной задачи
router.get('/queue/jobs/:jobId', DataController.getJobDetails);
logger.info('[RouterInit] Route GET /queue/jobs/:jobId registered.');

// Удаление задачи
router.delete('/queue/jobs/:jobId', DataController.removeJob);
logger.info('[RouterInit] Route DELETE /queue/jobs/:jobId registered.');

// Повторный запуск задачи
router.post('/queue/jobs/:jobId/retry', DataController.retryJob);
logger.info('[RouterInit] Route POST /queue/jobs/:jobId/retry registered.');

export default router; 