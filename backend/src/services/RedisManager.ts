import { spawn, ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import Redis from 'ioredis';
import logger from '../utils/logger';

export class RedisManager {
  private redisProcess: ChildProcess | null = null;
  private readonly redisPath: string;
  private readonly port: number;
  private readonly host: string;

  constructor() {
    // Используем скачанный Redis из корня проекта
    this.redisPath = join(process.cwd(), 'redis-windows');
    this.port = parseInt(process.env.REDIS_PORT || '6379');
    this.host = process.env.REDIS_HOST || 'localhost';
  }

  /**
   * Проверяет запущен ли Redis на нужном порту
   */
  async isRunning(): Promise<boolean> {
    try {
      const redis = new Redis({
        host: this.host,
        port: this.port,
        connectTimeout: 2000,
        lazyConnect: true,
      });

      await redis.connect();
      const pong = await redis.ping();
      await redis.disconnect();

      if (pong === 'PONG') {
        logger.info('✅ Redis уже запущен');
        return true;
      }
      return false;
    } catch (error) {
      logger.info('⏳ Redis не запущен, нужен автозапуск');
      return false;
    }
  }

  /**
   * Проверяет существуют ли файлы Redis
   */
  private checkRedisFiles(): boolean {
    const serverPath = join(this.redisPath, 'redis-server.exe');
    const configPath = join(this.redisPath, 'redis.windows.conf');
    
    if (!existsSync(serverPath)) {
      logger.error(`❌ Redis сервер не найден: ${serverPath}`);
      return false;
    }
    
    if (!existsSync(configPath)) {
      logger.error(`❌ Конфиг Redis не найден: ${configPath}`);
      return false;
    }

    return true;
  }

  /**
   * Запускает Redis сервер
   */
  async start(): Promise<void> {
    if (await this.isRunning()) {
      logger.info('✅ Redis уже запущен, пропускаем автозапуск');
      return;
    }

    if (!this.checkRedisFiles()) {
      throw new Error('Redis файлы не найдены. Запустите установку: npm run setup-redis');
    }

    logger.info('🚀 Запуск Redis сервера...');

    const serverPath = join(this.redisPath, 'redis-server.exe');
    const configPath = join(this.redisPath, 'redis.windows.conf');

    return new Promise((resolve, reject) => {
      this.redisProcess = spawn(serverPath, [configPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true // Скрываем окно на Windows
      });

      let output = '';
      this.redisProcess.stdout?.on('data', (data) => {
        output += data.toString();
        // Redis готов когда видим сообщение "Ready to accept connections"
        if (output.includes('Ready to accept connections')) {
          logger.info('✅ Redis сервер запущен и готов');
          resolve();
        }
      });

      this.redisProcess.stderr?.on('data', (data) => {
        const errorText = data.toString();
        output += errorText;
        logger.warn('Redis stderr:', errorText);
      });

      this.redisProcess.on('error', (error) => {
        logger.error('❌ Ошибка процесса Redis:', error);
        reject(error);
      });

      this.redisProcess.on('exit', (code, signal) => {
        if (code !== 0) {
          logger.error(`❌ Redis завершился с кодом ${code}, сигнал: ${signal}`);
          logger.error('Redis output:', output);
          reject(new Error(`Redis exited with code ${code}`));
        } else {
          logger.info('Redis процесс завершен нормально');
        }
      });

      // Таймаут на случай если Redis не запустится
      setTimeout(() => {
        if (!output.includes('Ready to accept connections')) {
          logger.error('❌ Redis не запустился в течение 10 секунд');
          reject(new Error('Redis startup timeout'));
        }
      }, 10000);
    });
  }

  /**
   * Ждет полный запуск Redis (до 15 секунд)
   */
  private async waitForStartup(): Promise<void> {
    const maxAttempts = 15;
    let attempts = 0;

    while (attempts < maxAttempts) {
      if (await this.isRunning()) {
        return;
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
      
      if (attempts % 3 === 0) {
        logger.info(`⏳ Ожидание запуска Redis... (${attempts}/${maxAttempts})`);
      }
    }

    throw new Error('Redis не запустился в течение 15 секунд');
  }

  /**
   * Останавливает Redis сервер
   */
  async stop(): Promise<void> {
    if (this.redisProcess) {
      logger.info('⏹️ Остановка Redis сервера...');
      
      return new Promise((resolve) => {
        if (this.redisProcess) {
          this.redisProcess.kill('SIGTERM');
          
          this.redisProcess.on('exit', () => {
            logger.info('✅ Redis сервер остановлен');
            this.redisProcess = null;
            resolve();
          });

          // Принудительно завершаем через 5 секунд
          setTimeout(() => {
            if (this.redisProcess) {
              this.redisProcess.kill('SIGKILL');
              logger.info('✅ Redis сервер принудительно остановлен');
              this.redisProcess = null;
              resolve();
            }
          }, 5000);
        } else {
          resolve();
        }
      });
    }
  }

  /**
   * Получить информацию о Redis
   */
  async getInfo(): Promise<string | null> {
    try {
      const redis = new Redis({
        host: this.host,
        port: this.port,
        connectTimeout: 1000,
      });

      const info = await redis.info();
      await redis.disconnect();
      return info;
    } catch (error) {
      return null;
    }
  }
}

export default new RedisManager();

