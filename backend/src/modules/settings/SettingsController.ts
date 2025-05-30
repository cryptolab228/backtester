import { Request, Response } from 'express';
import { settingsService, AppSettings } from '@/services/settingsService';
import logger from '@/utils/logger';

class SettingsController {
  async getSettings(req: Request, res: Response): Promise<void> {
    try {
      const appSettings = await settingsService.getSettings();
      res.status(200).json(appSettings);
    } catch (error) {
      logger.error('Error in SettingsController.getSettings:', error);
      const message = error instanceof Error ? error.message : 'Failed to get settings';
      res.status(500).json({ message });
    }
  }

  async updateSettings(req: Request, res: Response): Promise<void> {
    try {
      const newAppSettings: AppSettings = req.body;
      
      if (!newAppSettings || typeof newAppSettings !== 'object') {
        res.status(400).json({ message: 'Request body is missing or not an object' });
        return;
      }
      if (!Array.isArray(newAppSettings.exchangeConnections)) {
        res.status(400).json({ message: 'exchangeConnections is missing or not an array' });
        return;
      }

      const savedAppSettings = await settingsService.saveSettings(newAppSettings);
      res.status(200).json(savedAppSettings);
    } catch (error) {
      logger.error('Error in SettingsController.updateSettings:', error);
      const message = error instanceof Error ? error.message : 'Failed to update settings';
      res.status(500).json({ message });
    }
  }
}

export default new SettingsController();

 