import 'reflect-metadata';
import { AppDataSource } from '@/config/dataSource';
import logger from '@/utils/logger';

async function runMigrations() {
  try {
    logger.info('Инициализация подключения к базе данных...');
    await AppDataSource.initialize();
    
    logger.info('Запуск миграций...');
    await AppDataSource.runMigrations();
    
    logger.info('Миграции успешно выполнены');
    process.exit(0);
  } catch (error) {
    logger.error('Ошибка при выполнении миграций:', error);
    process.exit(1);
  }
}

runMigrations();