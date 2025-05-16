import { Request, Response } from 'express';
import { settingsService } from '@/services/settingsService';
import logger from '@/utils/logger';
import { StrategyParameters } from '../strategy_logic/strategy'; // Путь может требовать корректировки

class SettingsController {
  async getSettings(req: Request, res: Response): Promise<void> {
    try {
      const settings = await settingsService.getSettings();
      res.status(200).json(settings);
    } catch (error) {
      logger.error('Error in SettingsController.getSettings:', error);
      // Убедимся, что error имеет свойство message
      const message = error instanceof Error ? error.message : 'Failed to get settings';
      res.status(500).json({ message });
    }
  }

  async updateSettings(req: Request, res: Response): Promise<void> {
    try {
      const newSettings: StrategyParameters = req.body;
      // TODO: Добавить валидацию newSettings перед сохранением
      if (!newSettings) { // Простая проверка на наличие тела запроса
        res.status(400).json({ message: 'Request body is missing or empty' });
        return;
      }
      const savedSettings = await settingsService.saveSettings(newSettings);
      res.status(200).json(savedSettings);
    } catch (error) {
      logger.error('Error in SettingsController.updateSettings:', error);
      const message = error instanceof Error ? error.message : 'Failed to update settings';
      res.status(500).json({ message });
    }
  }
}

export default new SettingsController();

 