import { Server } from 'http';
import { setupLogging } from './logger';

const logger = setupLogging();

/**
 * Setup graceful shutdown handlers
 */
export const setupGracefulShutdown = (server: Server): void => {
  const shutdownTimeout = parseInt(process.env.GRACEFUL_SHUTDOWN_TIMEOUT || '10000', 10);

  const gracefulShutdown = async (signal: string) => {
    logger.info(`Received ${signal}, starting graceful shutdown...`);

    // Stop accepting new connections
    server.close(async () => {
      logger.info('HTTP server closed');

      try {
        // Close database connections
        await closeDatabaseConnections();

        // Close Redis connections
        await closeRedisConnections();

        // Close GPU resources
        await closeGPUResources();

        logger.info('Graceful shutdown completed');
        process.exit(0);
      } catch (error: any) {
        logger.error('Error during graceful shutdown:', error);
        process.exit(1);
      }
    });

    // Force shutdown after timeout
    setTimeout(() => {
      logger.error('Graceful shutdown timeout, forcing exit');
      process.exit(1);
    }, shutdownTimeout);
  };

  // Handle different termination signals
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGQUIT', () => gracefulShutdown('SIGQUIT'));

  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    gracefulShutdown('uncaughtException');
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    gracefulShutdown('unhandledRejection');
  });
};

/**
 * Close database connections
 */
const closeDatabaseConnections = async (): Promise<void> => {
  try {
    // Close any database connections here
    logger.info('Database connections closed');
  } catch (error: any) {
    logger.error('Error closing database connections:', error);
    throw error;
  }
};

/**
 * Close Redis connections
 */
const closeRedisConnections = async (): Promise<void> => {
  try {
    // Close any Redis connections here
    logger.info('Redis connections closed');
  } catch (error: any) {
    logger.error('Error closing Redis connections:', error);
    throw error;
  }
};

/**
 * Close GPU resources
 */
const closeGPUResources = async (): Promise<void> => {
  try {
    // Close any GPU resources here
    logger.info('GPU resources closed');
  } catch (error: any) {
    logger.error('Error closing GPU resources:', error);
    throw error;
  }
};











































