import 'reflect-metadata';
import { AppDataSource } from '@/config/dataSource';
import logger from '@/utils/logger';

async function resetDatabase() {
  try {
    logger.info('Инициализация подключения к базе данных...');
    await AppDataSource.initialize();
    
    logger.info('Очистка базы данных...');
    
    // Получаем все таблицы
    const queryRunner = AppDataSource.createQueryRunner();
    
    // Отключаем проверки внешних ключей
    await queryRunner.query('SET FOREIGN_KEY_CHECKS = 0');
    
    // Получаем список всех таблиц
    const tables = await queryRunner.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = DATABASE()
    `);
    
    // Очищаем все таблицы
    for (const table of tables) {
      const tableName = table.table_name;
      logger.info(`Очистка таблицы: ${tableName}`);
      await queryRunner.query(`TRUNCATE TABLE \`${tableName}\``);
    }
    
    // Включаем обратно проверки внешних ключей
    await queryRunner.query('SET FOREIGN_KEY_CHECKS = 1');
    
    await queryRunner.release();
    
    logger.info('База данных успешно очищена');
    process.exit(0);
  } catch (error) {
    logger.error('Ошибка при очистке базы данных:', error);
    
    // Для PostgreSQL используем другой подход
    try {
      logger.info('Попытка очистки для PostgreSQL...');
      
      const queryRunner = AppDataSource.createQueryRunner();
      
      // Для PostgreSQL
      await queryRunner.query('TRUNCATE TABLE candles CASCADE');
      await queryRunner.query('TRUNCATE TABLE trading_pairs CASCADE');  
      await queryRunner.query('TRUNCATE TABLE settings CASCADE');
      
      await queryRunner.release();
      
      logger.info('База данных PostgreSQL успешно очищена');
      process.exit(0);
    } catch (pgError) {
      logger.error('Ошибка при очистке PostgreSQL:', pgError);
      process.exit(1);
    }
  }
}

resetDatabase();