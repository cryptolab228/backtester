import express from 'express';
import settingsController from './SettingsController';
import logger from '@/utils/logger';

const router = express.Router();

logger.info('[RouterInit] Initializing settingsRoutes.ts...');

// GET /api/settings - Получить текущие настройки
router.get('/', settingsController.getSettings);

// PUT /api/settings - Обновить настройки
router.put('/', settingsController.updateSettings);

logger.info('[RouterInit] settingsRoutes.ts initialized.');

export default router; 