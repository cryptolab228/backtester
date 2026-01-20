import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { createServer } from 'http';
import { config } from 'dotenv';

// Загружаем переменные окружения
config();

import { setupLogging } from './utils/logger';
import { setupMetrics } from './utils/metrics';
import { setupGracefulShutdown } from './utils/gracefulShutdown';
import { healthCheckRouter } from './health/healthCheck';
import { gpuRoutes } from './routes/gpuRoutes';
import { errorHandler } from './middleware/errorHandler';
import { requestTracing } from './middleware/requestTracing';
import { rateLimit } from './middleware/rateLimit';
import { circuitBreaker } from './middleware/circuitBreaker';

// Инициализация логгера
const logger = setupLogging();

// Создание Express приложения
const app = express();
const server = createServer(app);

// Middleware
app.use(helmet()); // Security headers
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(compression()); // Response compression
app.use(express.json({ limit: '50mb' })); // JSON parsing with size limit
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Request tracing middleware
app.use(requestTracing);

// Rate limiting
app.use('/api/gpu', rateLimit);

// Circuit breaker middleware
app.use('/api/gpu/backtest', circuitBreaker);

// Health check routes (no rate limiting)
app.use('/health', healthCheckRouter);

// API routes
app.use('/api/gpu', gpuRoutes);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
    path: req.originalUrl,
    method: req.method
  });
});

// Error handling middleware (should be last)
app.use(errorHandler);

// Setup metrics
setupMetrics(app);

// Graceful shutdown
setupGracefulShutdown(server);

// Start server
const PORT = parseInt(process.env.PORT || '6000', 10);
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
  logger.info(`🚀 GPU Service started on ${HOST}:${PORT}`);
  logger.info(`📊 Metrics available at http://localhost:${process.env.METRICS_PORT || '9090'}/metrics`);
  logger.info(`❤️ Health check available at http://localhost:${PORT}/health`);
});

// Health check monitoring
setInterval(async () => {
  try {
    const response = await fetch(`http://localhost:${PORT}/health`);
    if (response.ok) {
      logger.debug('Health check passed');
    } else {
      logger.error(`Health check failed: ${response.status}`);
    }
  } catch (error) {
    logger.error('Health check error:', error);
  }
}, parseInt(process.env.HEALTH_CHECK_INTERVAL || '30000', 10));

export { app, server };

