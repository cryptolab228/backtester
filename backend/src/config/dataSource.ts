import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
import config from './index';
import { TradingPair } from '@/models/TradingPair';
import { Candle } from '@/models/Candle';
import { Setting } from '@/models/Setting';
import logger from '@/utils/logger';

const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: config.db.host,
  port: config.db.port,
  username: config.db.username,
  password: config.db.password,
  database: config.db.database,
  synchronize: config.env === 'development', // В production лучше использовать миграции!
  logging: config.env === 'development' ? ['query', 'error'] : ['error'], // Логирование запросов в dev
  entities: [TradingPair, Candle, Setting],
  migrations: [], // Путь к миграциям, если будут использоваться
  subscribers: [],
};

export const AppDataSource = new DataSource(dataSourceOptions);

export const initializeDataSource = async () => {
  try {
    await AppDataSource.initialize();
    logger.info('Data Source has been initialized successfully.');
  } catch (error) {
    logger.error('Error during Data Source initialization:', error);
    throw error; // Пробрасываем ошибку дальше, чтобы приложение не запустилось без БД
  }
}; 