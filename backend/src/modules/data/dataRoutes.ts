import express from 'express';
import dataController from './dataController';
import logger from '@/utils/logger';

logger.info('[RouterInit] Initializing dataRoutes.ts...');
const router = express.Router();

// Роуты для запуска задач
router.post('/fetch-pairs', dataController.triggerFetchPairs);
logger.info('[RouterInit] Route POST /fetch-pairs registered.');

router.post(
  '/fetch-candles',
  (req, res) => dataController.triggerFetchCandles(req, res)
);
logger.info('[RouterInit] Route POST /fetch-candles registered.');

// Новый роут для получения всех торговых пар
router.get(
  '/trading-pairs',
  (req, res) => dataController.getAllTradingPairs(req, res)
);
logger.info('[RouterInit] Route GET /trading-pairs registered.');

// Роут для получения исторических данных свечей
router.post(
  '/candles',
  (req, res) => dataController.getHistoricalCandles(req, res)
);
logger.info('[RouterInit] Route POST /candles registered.');

// --- Endpoint для скачивания файлов результатов ---
router.get('/portfolio-results/:filename', dataController.downloadPortfolioResults);
logger.info('[RouterInit] Route GET /portfolio-results/:filename registered.');

// --- Роуты для управления очередью --- 

// Получение количества задач по статусам
router.get('/queue/job-counts', dataController.getQueueJobCounts);
logger.info('[RouterInit] Route GET /queue/job-counts registered.');

// Получение списка задач с фильтрацией по статусу
router.get('/queue/jobs', (req, res) => dataController.getJobs(req, res));
logger.info('[RouterInit] Route GET /queue/jobs registered.');

// Получение деталей конкретной задачи
router.get('/queue/jobs/:jobId', dataController.getJobDetails);
logger.info('[RouterInit] Route GET /queue/jobs/:jobId registered.');

// Удаление задачи
router.delete('/queue/jobs/:jobId', (req, res) => dataController.removeJob(req, res));
logger.info('[RouterInit] Route DELETE /queue/jobs/:jobId registered.');

// Повторный запуск задачи
router.post('/queue/jobs/:jobId/retry', (req, res) => dataController.retryJob(req, res));
logger.info('[RouterInit] Route POST /queue/jobs/:jobId/retry registered.');

// Job control routes
router.post('/queue/jobs/:jobId/pause', (req, res) => dataController.pauseJob(req, res));
logger.info('[RouterInit] Route POST /queue/jobs/:jobId/pause registered.');
router.post('/queue/jobs/:jobId/resume', (req, res) => dataController.resumeJob(req, res));
logger.info('[RouterInit] Route POST /queue/jobs/:jobId/resume registered.');

// Force kill route - принудительная остановка задач
router.post('/queue/jobs/:jobId/force-kill', (req, res) => dataController.forceKillJob(req, res));
logger.info('[RouterInit] Route POST /queue/jobs/:jobId/force-kill registered.');

export default router; 