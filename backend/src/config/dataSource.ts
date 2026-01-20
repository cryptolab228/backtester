import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
import dotenv from 'dotenv';
import { TradingPair } from '../models/TradingPair';
import { Candle } from '../models/Candle';
import { Setting } from '../models/Setting';
import { TradingSession } from '../models/TradingSession';
import { SessionTrade } from '../models/SessionTrade';
import { SessionMetrics } from '../models/SessionMetrics';
import logger from '@/utils/logger';

dotenv.config();

const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST || 'db',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'user',
  password: process.env.DB_PASSWORD || 'password',
  database: process.env.DB_DATABASE || 'backtester',
  synchronize: false, // Отключаем автосинхронизацию - используем нашу схему
  logging: process.env.NODE_ENV === 'development' ? ['query', 'error'] : ['error'],
  entities: [TradingPair, Candle, Setting, TradingSession, SessionTrade, SessionMetrics],
  migrations: [],
  subscribers: [],
};

export const AppDataSource = new DataSource(dataSourceOptions);

export const initializeDataSource = async () => {
  try {
    if (AppDataSource.isInitialized) {
      logger.debug('Data Source is already initialized.');
      return;
    }
    await AppDataSource.initialize();
    logger.info('Data Source has been initialized successfully.');
  } catch (error) {
    logger.error('Error during Data Source initialization:', error);
    throw error; // Пробрасываем ошибку дальше, чтобы приложение не запустилось без БД
  }
}; 