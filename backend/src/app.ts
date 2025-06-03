// import 'module-alias/register'; // <-- Убираем для режима разработки
import 'reflect-metadata'; // Должен быть импортирован первым!
import express, { Express, Request, Response } from 'express';
import cors from 'cors'; // <-- Импортируем cors
import http from 'http'; // <--- Добавлен импорт http
import config from '@/config';
import logger from '@/utils/logger';
import { initializeDataSource } from '@/config/dataSource';
import { initWebSocket } from '@/websocket'; // <--- Добавлен импорт initWebSocket
import { attachQueueEventListeners } from '@/config/queue'; // <--- Импортируем функцию
// import { initializeScheduler } from '@/config/queue'; // Комментируем импорт
import path from 'path';
import fs from 'fs';
import { ensureDirectoriesExist, getPortfolioResultsDirectory } from '@/utils/paths';

// Добавляем небольшую задержку перед инициализацией воркера
// чтобы дать Redis время на стабилизацию после старта контейнеров
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Импортируем воркер, чтобы он запустился (перенесено в startServer)
// import '@/jobs/dataWorker'; 
import dataRoutes from '@/modules/data/dataRoutes'; // Импорт роутов данных
import settingsRoutes from '@/modules/settings/settingsRoutes'; // <-- Импорт роутов настроек
import backtesterRoutes from '@/modules/backtester/backtester.routes'; // <-- Импорт роутов бэктестера
import statisticsRoutes from '@/modules/statistics/statisticsRoutes'; // <-- Импорт роутов статистики
import DataController from '@/modules/data/dataController'; // <--- Явный импорт DataController

async function startServer() {
  try {
    // Инициализация подключения к БД
    await initializeDataSource();

    // Создаем необходимые директории
    try {
      await ensureDirectoriesExist();
      logger.info(`✅ Portfolio results directory created/verified: ${getPortfolioResultsDirectory()}`);
    } catch (mkdirError: any) {
      logger.warn(`⚠️ Failed to create portfolio results directory: ${mkdirError.message}`);
    }

    // Инициализация планировщика BullMQ
    // initializeScheduler(); // Комментируем вызов

    // --- Задержка перед инициализацией воркера ---
    logger.info('Waiting 3 seconds before initializing data worker...');
    await delay(3000); 
    logger.info('Initializing data worker...');
    // Импортируем воркер здесь, после инициализации DataSource и задержки
    require('@/jobs/dataWorker'); 
    // -------------------------------------------

    const app: Express = express();
    const port = config.port;

    // Настройки Express для больших файлов и улучшенной производительности
    app.set('trust proxy', true);
    
    // Увеличиваем лимиты для обработки больших запросов
    app.use(express.json({ limit: '100mb' }));
    app.use(express.urlencoded({ limit: '100mb', extended: true }));

    // Middlewares
    app.use(cors({ // <-- Подключаем cors
      // origin: 'http://localhost:5173', // Разрешаем запросы с frontend dev сервера Vite
      origin: '*', // Временно разрешаем все источники для диагностики
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], // Разрешенные методы
      allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control', 'Accept'], // Разрешенные заголовки
      exposedHeaders: ['Content-Length', 'Content-Disposition', 'Accept-Ranges'], // Дополнительные заголовки для скачивания
    }));

    // --- Диагностический лог --- 
    if (DataController.getQueueJobCounts && typeof DataController.getQueueJobCounts === 'function') {
      logger.info('[AppDiag] DataController.getQueueJobCounts method IS accessible in app.ts before attaching routes.');
    } else {
      logger.error('[AppDiag] DataController.getQueueJobCounts method IS NOT accessible in app.ts!');
    }
    // ---------------------------

    // Основной роут
    app.get('/', (req: Request, res: Response) => {
      res.send('Backend is running!');
    });

    // Подключаем роуты модуля данных
    app.use('/api/data', dataRoutes);

    // Подключаем роуты модуля настроек
    app.use('/api/settings', settingsRoutes); // <-- Подключение роутов настроек

    // Подключаем роуты модуля бэктестера
    app.use('/api/backtest', backtesterRoutes); // <-- Подключение роутов бэктестера

    // Подключаем роуты модуля статистики
    app.use('/api/statistics', statisticsRoutes); // <-- Подключение роутов статистики

    // Статический маршрут для файлов с результатами портфельного бэктестинга
    const staticPath = getPortfolioResultsDirectory();
    app.use('/portfolio-results', express.static(staticPath, {
      maxAge: '1h', // Кэшируем файлы на 1 час
      etag: true,
      lastModified: true,
      dotfiles: 'deny',
      index: false,
      setHeaders: (res, path) => {
        if (path.endsWith('.json')) {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Content-Disposition', 'attachment');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Disposition');
          // Дополнительные заголовки для больших файлов
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
        }
      }
    }));

    // Здесь позже добавим роутеры для бектеста и сканера

    // --- Создание HTTP сервера и запуск --- 
    const httpServer = http.createServer(app); // Создаем HTTP сервер

    // Настройки для больших файлов и таймаутов
    httpServer.timeout = 10 * 60 * 1000; // 10 минут таймаут
    httpServer.keepAliveTimeout = 5 * 60 * 1000; // 5 минут keep-alive
    httpServer.headersTimeout = 60 * 1000; // 60 секунд для заголовков

    // --- Инициализация WebSocket --- 
    initWebSocket(httpServer); // Передаем HTTP сервер в инициализатор WebSocket

    // --->>> ВЫЗОВ ДОБАВЛЕНИЯ СЛУШАТЕЛЕЙ СОБЫТИЙ ОЧЕРЕДИ <<<---
    attachQueueEventListeners(); // Вызываем после инициализации WS и dataQueue
    // ------------------------------------------------------------

    // --- Запуск сервера --- 
    httpServer.listen(port, () => {
      logger.info(`⚡️[server]: Server is running at http://localhost:${port}`);
      logger.info(`⚡️[websocket]: WebSocket server is listening on the same port.`); // Добавлен лог для WS
      logger.info(`⚡️[static]: Portfolio results available at http://localhost:${port}/portfolio-results/`);
      logger.info(`⚡️[api]: Download API available at http://localhost:${port}/api/data/portfolio-results/`);
    });

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

// Обработка неперехваченных ошибок
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  // process.exit(1); // В разработке можно закомментировать для отладки
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // process.exit(1);
});

// export default app; // Больше не экспортируем app 