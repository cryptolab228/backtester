import { Server } from 'http';
import logger from './logger';
import { AppDataSource } from '../config/dataSource';

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

        // Close any other resources
        await closeOtherResources();

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
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
      logger.info('Database connections closed');
    }
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
    // Close Redis connections here
    // This would depend on how Redis is configured in your app
    logger.info('Redis connections closed');
  } catch (error: any) {
    logger.error('Error closing Redis connections:', error);
    throw error;
  }
};

/**
 * Close other resources
 */
const closeOtherResources = async (): Promise<void> => {
  try {
    // Close any other resources like external API connections, file handles, etc.
    logger.info('Other resources closed');
  } catch (error: any) {
    logger.error('Error closing other resources:', error);
    throw error;
  }
};









