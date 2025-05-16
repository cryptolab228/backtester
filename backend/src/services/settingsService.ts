import { Repository } from 'typeorm';
import { AppDataSource } from '@/config/dataSource';
import { Setting } from '@/models/Setting';
import { StrategyParameters, DefaultStrategyParameters } from '@/modules/strategy_logic/strategy';
import logger from '@/utils/logger';

export class SettingsService {
  private settingsRepository: Repository<Setting>;

  constructor() {
    this.settingsRepository = AppDataSource.getRepository(Setting);
  }

  async getSettings(): Promise<StrategyParameters> {
    try {
      const settings = await this.settingsRepository.findOne({ where: {}, order: { id: 'ASC' } });
      if (settings) {
        logger.info('Settings loaded from DB');
        return settings.strategyParameters;
      } else {
        // Если настроек нет, возвращаем и сохраняем дефолтные
        logger.warn('No settings found in DB, returning default settings and saving them.');
        const defaultSettings = await this.saveSettings(DefaultStrategyParameters);
        return defaultSettings;
      }
    } catch (error) {
      logger.error('Error fetching settings, returning default values:', error);
      return DefaultStrategyParameters; // Возвращаем дефолт в случае ошибки
    }
  }

  async saveSettings(strategyParams: StrategyParameters): Promise<StrategyParameters> {
    try {
      let settings = await this.settingsRepository.findOne({ where: {}, order: { id: 'ASC' } });
      if (settings) {
        settings.strategyParameters = strategyParams;
      } else {
        settings = this.settingsRepository.create({ strategyParameters: strategyParams });
      }
      const savedSettings = await this.settingsRepository.save(settings);
      logger.info('Settings saved to DB');
      return savedSettings.strategyParameters;
    } catch (error) {
      logger.error('Error saving settings:', error);
      throw error; // Пробрасываем ошибку дальше
    }
  }
}

export const settingsService = new SettingsService(); 