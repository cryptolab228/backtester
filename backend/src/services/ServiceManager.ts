import logger from '@/utils/logger';
import { initializeDataSource } from '@/config/dataSource';
import path from 'path';
import fs from 'fs';
import { spawn, ChildProcess } from 'child_process';

// Импортируем простую инициализацию БД
let PostgreSQLSimple: any;
try {
  PostgreSQLSimple = require('@/middleware/PostgreSQLSimple').default;
} catch (error) {
  logger.warn('PostgreSQLSimple не найден, будет использован только TypeORM');
}

/**
 * ServiceManager - управляет автоматическим запуском и остановкой сервисов
 * Реализует автозапуск PostgreSQL и Redis как в CryptoLab проекте
 */
class ServiceManager {
  private postgresProcess: ChildProcess | null = null;
  private redisProcess: ChildProcess | null = null;

  /**
   * Запускает все необходимые сервисы автоматически
   */
  async startAll(): Promise<void> {
    try {
      logger.info('🎯 Автозапуск сервисов (PostgreSQL + Redis) как в CryptoLab...');

      // 1. Стартуем PostgreSQL
      await this.startPostgreSQL();
      
      // 2. Стартуем Redis  
      await this.startRedis();
      
      // 3. Инициализируем базу данных
      await this.initializeDatabase();
      
      logger.info('✅ Все сервисы запущены и готовы к работе');
    } catch (error) {
      logger.error('❌ Ошибка при запуске сервисов:', error);
      throw error;
    }
  }

  /**
   * Запускает PostgreSQL если он не запущен
   */
  private async startPostgreSQL(): Promise<void> {
    try {
      // Проверяем, запущен ли уже PostgreSQL
      if (await this.isPostgreSQLRunning()) {
        logger.info('✅ PostgreSQL уже запущен');
        return;
      }

      logger.info('🚀 Запуск PostgreSQL...');
      
      // Пути для PostgreSQL
      const pgPath = 'C:\\Program Files\\PostgreSQL\\16\\bin\\pg_ctl.exe';
      const dataDir = 'C:\\Program Files\\PostgreSQL\\16\\data';
      
      if (!fs.existsSync(pgPath)) {
        logger.warn('⚠️ PostgreSQL не найден, предполагается что он уже запущен');
        return;
      }

      // Запускаем PostgreSQL
      const args = ['-D', dataDir, '-l', 'postgresql.log', 'start'];
      this.postgresProcess = spawn(pgPath, args, {
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore']
      });

      // Ждем 3 секунды на запуск
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      if (await this.isPostgreSQLRunning()) {
        logger.info('✅ PostgreSQL запущен успешно');
      } else {
        logger.warn('⚠️ PostgreSQL возможно уже работает как служба');
      }

    } catch (error) {
      logger.warn('⚠️ Не удалось запустить PostgreSQL автоматически:', error);
      logger.info('💡 Убедитесь что PostgreSQL запущен вручную');
    }
  }

  /**
   * Запускает Redis если он не запущен
   */
  private async startRedis(): Promise<void> {
    try {
      // Проверяем, запущен ли уже Redis
      if (await this.isRedisRunning()) {
        logger.info('✅ Redis уже запущен');
        return;
      }

      logger.info('🚀 Запуск Redis...');
      
      // Проверяем локальную папку redis-windows
      const localRedisPath = path.join(process.cwd(), 'redis-windows', 'redis-server.exe');
      let redisPath = localRedisPath;
      
      if (!fs.existsSync(localRedisPath)) {
        // Пробуем системный путь
        redisPath = 'redis-server';
      }

      // Запускаем Redis
      this.redisProcess = spawn(redisPath, [], {
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore']
      });

      // Ждем 2 секунды на запуск
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      if (await this.isRedisRunning()) {
        logger.info('✅ Redis запущен успешно');
      } else {
        throw new Error('Redis не запустился');
      }

    } catch (error) {
      logger.warn('⚠️ Не удалось запустить Redis автоматически:', error);
      logger.info('💡 Убедитесь что Redis установлен и доступен');
      logger.info('💡 Запустите: npm run setup:redis для автоматической установки');
    }
  }

  /**
   * Инициализирует базу данных
   */
  private async initializeDatabase(): Promise<void> {
    try {
      logger.info('🏗️ Инициализация базы данных...');
      
      // Создаем БД если не существует
      await this.ensureDatabaseExists();
      
      // Простая инициализация (создание таблиц) если доступна
      if (PostgreSQLSimple) {
        await PostgreSQLSimple.initDB();
        logger.info('✅ База данных инициализирована (таблицы созданы)');
      }
      
      // Обновляем схему для совместимости с TypeORM
      await this.updateDatabaseSchema();
      
      // TypeORM для дополнительных возможностей
      try {
        await initializeDataSource();
        logger.info('✅ TypeORM инициализирован дополнительно');
      } catch (error) {
        logger.warn('⚠️ TypeORM не удалось инициализировать, но система может работать');
      }
      
    } catch (error) {
      logger.warn('⚠️ Инициализация базы данных не удалась:', error);
      logger.info('💡 Система продолжит работу, проверьте настройки БД в .env');
    }
  }

  /**
   * Проверяет и создает базу данных если она не существует
   */
  private async ensureDatabaseExists(): Promise<void> {
    const { Client } = require('pg');
    
    const adminConnection = {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      user: process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || '',
      database: 'postgres', // Подключаемся к системной БД для создания новой
    };
    
    const targetDatabase = process.env.DB_DATABASE || 'backtester';
    
    const adminClient = new Client(adminConnection);
    
    try {
      await adminClient.connect();
      
      // Проверяем существует ли база данных
      const checkQuery = 'SELECT 1 FROM pg_database WHERE datname = $1';
      const result = await adminClient.query(checkQuery, [targetDatabase]);
      
      if (result.rows.length === 0) {
        logger.info(`🏗️ Создание базы данных ${targetDatabase}...`);
        await adminClient.query(`CREATE DATABASE "${targetDatabase}"`);
        logger.info(`✅ База данных ${targetDatabase} создана успешно`);
      } else {
        logger.info(`✅ База данных ${targetDatabase} уже существует`);
      }
      
    } catch (error) {
      logger.error('❌ Ошибка при проверке/создании базы данных:', error);
      throw error;
    } finally {
      await adminClient.end();
    }
  }

  /**
   * Обновляет схему базы данных (добавляет недостающие индексы и столбцы)
   */
  private async updateDatabaseSchema(): Promise<void> {
    const { Client } = require('pg');
    
    const connection = {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      user: process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_DATABASE || 'backtester',
    };
    
    const client = new Client(connection);
    
    try {
      await client.connect();
      
      // 1. ОБНОВЛЯЕМ ИНДЕКСЫ TRADING_PAIRS
      logger.info('🔧 Проверка индексов trading_pairs...');
      const checkIndexQuery = `
        SELECT 1 FROM pg_indexes 
        WHERE tablename = 'trading_pairs' 
        AND indexname = 'idx_trading_pairs_symbol_exchange'
      `;
      
      const indexResult = await client.query(checkIndexQuery);
      
      if (indexResult.rows.length === 0) {
        logger.info('🔧 Добавление составного уникального индекса (symbol, exchange)...');
        
        // Удаляем старый уникальный индекс на symbol если он есть
        await client.query(`
          DO $$ 
          BEGIN
            IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trading_pairs_symbol_key') THEN
              ALTER TABLE trading_pairs DROP CONSTRAINT trading_pairs_symbol_key;
            END IF;
          END $$;
        `);
        
        // Добавляем новый составной уникальный индекс
        await client.query(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_trading_pairs_symbol_exchange 
          ON trading_pairs(symbol, exchange)
        `);
        
        logger.info('✅ Составной уникальный индекс добавлен успешно');
      } else {
        logger.info('✅ Составной уникальный индекс уже существует');
      }

      // 2. ОБНОВЛЯЕМ ТАБЛИЦУ CANDLES - добавляем volumeQuote
      logger.info('🔧 Проверка столбцов таблицы candles...');
      const checkColumnQuery = `
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'candles' 
        AND column_name = 'volumeQuote'
      `;
      
      const columnResult = await client.query(checkColumnQuery);
      
      if (columnResult.rows.length === 0) {
        logger.info('🔧 Добавление столбца volumeQuote в таблицу candles...');
        await client.query(`
          ALTER TABLE candles 
          ADD COLUMN IF NOT EXISTS "volumeQuote" DECIMAL(30,8) NULL
        `);
        logger.info('✅ Столбец volumeQuote добавлен успешно');
      } else {
        logger.info('✅ Столбец volumeQuote уже существует');
      }

      // 3. ОБНОВЛЯЕМ ИНДЕКС CANDLES - убираем лишний exchange
      logger.info('🔧 Проверка индекса candles...');
      const checkCandlesIndexQuery = `
        SELECT 1 FROM pg_indexes 
        WHERE tablename = 'candles' 
        AND indexname = 'idx_candles_unique'
      `;
      
      const candlesIndexResult = await client.query(checkCandlesIndexQuery);
      
      if (candlesIndexResult.rows.length > 0) {
        // Проверяем определение индекса
        const indexDefQuery = `
          SELECT indexdef FROM pg_indexes 
          WHERE tablename = 'candles' 
          AND indexname = 'idx_candles_unique'
        `;
        const indexDefResult = await client.query(indexDefQuery);
        
        if (indexDefResult.rows.length > 0 && 
            indexDefResult.rows[0].indexdef.includes('exchange')) {
          logger.info('🔧 Пересоздание индекса candles (убираем exchange)...');
          await client.query(`DROP INDEX IF EXISTS idx_candles_unique`);
          await client.query(`
            CREATE UNIQUE INDEX idx_candles_unique 
            ON candles(trading_pair_id, timestamp, timeframe)
          `);
          logger.info('✅ Индекс candles обновлен успешно');
        } else {
          logger.info('✅ Индекс candles уже корректен');
        }
      }
      
    } catch (error) {
      logger.warn('⚠️ Не удалось обновить схему БД:', error);
      logger.info('💡 База данных продолжит работу с текущей схемой');
    } finally {
      await client.end();
    }
  }

  /**
   * Проверяет запущен ли PostgreSQL
   */
  private async isPostgreSQLRunning(): Promise<boolean> {
    try {
      const { Client } = require('pg');
      const client = new Client({
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        user: process.env.DB_USERNAME || 'postgres',
        password: process.env.DB_PASSWORD || '',
        database: 'postgres',
        connectTimeoutMillis: 3000,
      });
      
      await client.connect();
      await client.end();
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Проверяет запущен ли Redis
   */
  private async isRedisRunning(): Promise<boolean> {
    try {
      const redis = require('redis');
      const client = redis.createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379'
      });
      
      await client.connect();
      await client.ping();
      await client.quit();
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Останавливает все сервисы
   */
  async stopAll(): Promise<void> {
    logger.info('🛑 Остановка всех сервисов...');

    // Останавливаем Redis
    if (this.redisProcess) {
      this.redisProcess.kill();
      this.redisProcess = null;
      logger.info('✅ Redis остановлен');
    }

    // Останавливаем PostgreSQL (осторожно - может влиять на другие приложения)
    if (this.postgresProcess) {
      this.postgresProcess.kill();
      this.postgresProcess = null;
      logger.info('✅ PostgreSQL остановлен');
    }
  }

  /**
   * Настраивает корректное завершение при получении сигналов
   */
  setupGracefulShutdown(): void {
    const gracefulShutdown = async (signal: string) => {
      logger.info(`Получен сигнал ${signal}, корректно завершаем работу...`);
      await this.stopAll();
      process.exit(0);
    };

    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGQUIT', () => gracefulShutdown('SIGQUIT'));
  }
}

export default new ServiceManager();
