/**
 * Роуты для модуля Optimizer
 */

import { Router } from 'express';
import {
  startOptimization,
  getOptimizationStatus,
  getOptimizationResults,
  cancelOptimization,
  listOptimizations
} from './optimizer.controller';

const router = Router();

// POST /api/optimizer/start - Запуск оптимизации
router.post('/start', startOptimization);

// GET /api/optimizer/list - Список всех оптимизаций
router.get('/list', listOptimizations);

// GET /api/optimizer/status/:jobId - Статус оптимизации
router.get('/status/:jobId', getOptimizationStatus);

// GET /api/optimizer/results/:jobId - Результаты оптимизации
router.get('/results/:jobId', getOptimizationResults);

// POST /api/optimizer/cancel/:jobId - Отмена оптимизации
router.post('/cancel/:jobId', cancelOptimization);

export default router;
