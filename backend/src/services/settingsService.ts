import { Repository } from 'typeorm';
import { AppDataSource } from '@/config/dataSource';
import { Setting, ExchangeConnection } from '@/models/Setting';
import logger from '@/utils/logger';

export interface AppSettings {
  exchangeConnections: ExchangeConnection[];
}

const DefaultAppSettings: AppSettings = {
  exchangeConnections: [],
};

export class SettingsService {
  private settingsRepository: Repository<Setting>;

  constructor() {
    this.settingsRepository = AppDataSource.getRepository(Setting);
  }

  async getSettings(): Promise<AppSettings> {
    try {
      const settingsEntity = await this.settingsRepository.findOne({ where: {}, order: { id: 'ASC' } });
      if (settingsEntity && settingsEntity.exchangeConnections) {
        logger.info('Application settings (exchange connections) loaded from DB');
        return { exchangeConnections: settingsEntity.exchangeConnections };
      } else {
        logger.warn('No application settings found in DB, returning default settings and saving them.');
        const newSettings = this.settingsRepository.create({ exchangeConnections: [] });
        await this.settingsRepository.save(newSettings);
        logger.info('Default application settings (empty exchange connections) saved to DB');
        return { exchangeConnections: [] };
      }
    } catch (error) {
      logger.error('Error fetching application settings, returning default values:', error);
      return DefaultAppSettings;
    }
  }

  async saveSettings(data: AppSettings): Promise<AppSettings> {
    try {
      let settingsEntity = await this.settingsRepository.findOne({ where: {}, order: { id: 'ASC' } });
      if (settingsEntity) {
        settingsEntity.exchangeConnections = data.exchangeConnections || [];
      } else {
        settingsEntity = this.settingsRepository.create({ exchangeConnections: data.exchangeConnections || [] });
      }
      const savedSettingsEntity = await this.settingsRepository.save(settingsEntity);
      logger.info('Application settings (exchange connections) saved to DB');
      return { exchangeConnections: savedSettingsEntity.exchangeConnections };
    } catch (error) {
      logger.error('Error saving application settings:', error);
      throw error;
    }
  }
}

export const settingsService = new SettingsService(); 