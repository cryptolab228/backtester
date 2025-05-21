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

// Добавляем небольшую задержку перед инициализацией воркера
// чтобы дать Redis время на стабилизацию после старта контейнеров
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Импортируем воркер, чтобы он запустился (перенесено в startServer)
// import '@/jobs/dataWorker'; 
import dataRoutes from '@/modules/data/dataRoutes'; // Импорт роутов данных
import settingsRoutes from '@/modules/settings/settingsRoutes'; // <-- Импорт роутов настроек
import backtesterRoutes from '@/modules/backtester/backtester.routes'; // <-- Импорт роутов бэктестера
import DataController from '@/modules/data/dataController'; // <--- Явный импорт DataController

async function startServer() {
  try {
    // Инициализация подключения к БД
    await initializeDataSource();

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

    // Middlewares
    app.use(cors({ // <-- Подключаем cors
      // origin: 'http://localhost:5173', // Разрешаем запросы с frontend dev сервера Vite
      origin: '*', // Временно разрешаем все источники для диагностики
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], // Разрешенные методы
      allowedHeaders: ['Content-Type', 'Authorization'], // Разрешенные заголовки
    }));
    app.use(express.json()); // Для парсинга JSON body

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

    // Здесь позже добавим роутеры для бектеста и сканера

    // --- Создание HTTP сервера и запуск --- 
    const httpServer = http.createServer(app); // Создаем HTTP сервер

    // --- Инициализация WebSocket --- 
    initWebSocket(httpServer); // Передаем HTTP сервер в инициализатор WebSocket

    // --->>> ВЫЗОВ ДОБАВЛЕНИЯ СЛУШАТЕЛЕЙ СОБЫТИЙ ОЧЕРЕДИ <<<---
    attachQueueEventListeners(); // Вызываем после инициализации WS и dataQueue
    // ------------------------------------------------------------

    // --- Запуск сервера --- 
    httpServer.listen(port, () => {
      logger.info(`⚡️[server]: Server is running at http://localhost:${port}`);
      logger.info(`⚡️[websocket]: WebSocket server is listening on the same port.`); // Добавлен лог для WS
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