import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import http from 'http';
import config from './config';
import logger from './utils/logger';
import { initializeDataSource } from './config/dataSource';
import { initWebSocket } from './websocket';
import { bootstrapScanner } from './modules/scanner/scanner.bootstrap';

// Import API routes
import dataRoutes from './modules/data/dataRoutes';
import settingsRoutes from './modules/settings/settingsRoutes';
import backtesterRoutes from './modules/backtester/backtester.routes';
import statisticsRoutes from './modules/statistics/statisticsRoutes';
import debugRoutes from './routes/debugRoutes';
import { scannerRoutes } from './modules/scanner';
import sessionRoutes from './modules/scanner/routes/sessionRoutes';

async function startServer() {
  try {
    await initializeDataSource();

    const app: Express = express();
    const port = Number(config.port) || 5000;

    // Basic middleware
    app.use(express.json({ limit: '50mb' }));
    app.use(express.urlencoded({ limit: '50mb', extended: true }));
    app.use(cors({
      origin: process.env.FRONTEND_URL || 'http://localhost:5173',
      credentials: true
    }));

    // Health check
    app.get('/health', (req: Request, res: Response) => {
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        service: 'backtester-backend',
        version: '1.0.0'
      });
    });

    // Root endpoint
    app.get('/', (req: Request, res: Response) => {
      res.send('Backend is running!');
    });

    // API routes
    app.use('/api/data', dataRoutes);
    app.use('/api/settings', settingsRoutes);
    app.use('/api/backtest', backtesterRoutes);
    app.use('/api/statistics', statisticsRoutes);
    app.use('/api/debug', debugRoutes);
    app.use('/api/scanner', scannerRoutes);
    app.use('/api/sessions', sessionRoutes);

    const server = http.createServer(app);

    initWebSocket(server);
    await bootstrapScanner();

    server.listen(port, () => {
      logger.info(`⚡️ Server is running at http://localhost:${port}`);
      logger.info(`❤️ Health check available at http://localhost:${port}/health`);
    });

    return server;
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer(); 

