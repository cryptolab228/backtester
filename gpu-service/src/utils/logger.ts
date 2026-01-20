import winston from 'winston';
import path from 'path';

// Define log levels
const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define log colors
const logColors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

winston.addColors(logColors);

// Create logs directory if it doesn't exist
import fs from 'fs';
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

/**
 * Setup Winston logger with proper configuration
 */
export const setupLogging = (): winston.Logger => {
  const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    levels: logLevels,
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.errors({ stack: true }),
      winston.format.json(),
      winston.format.printf(({ timestamp, level, message, requestId, ...meta }) => {
        const metaStr = Object.keys(meta).length ? `\n${JSON.stringify(meta, null, 2)}` : '';
        return `${timestamp} [${requestId || 'SYSTEM'}] ${level}: ${message}${metaStr}`;
      })
    ),
    defaultMeta: {
      service: 'gpu-service',
      version: process.env.npm_package_version || '1.0.0'
    },
    transports: [
      // Write all logs with importance level of `error` or less to `error.log`
      new winston.transports.File({
        filename: path.join(logsDir, 'error.log'),
        level: 'error',
        maxsize: 5242880, // 5MB
        maxFiles: 5,
      }),
      // Write all logs with importance level of `info` or less to `combined.log`
      new winston.transports.File({
        filename: path.join(logsDir, 'combined.log'),
        maxsize: 5242880, // 5MB
        maxFiles: 5,
      }),
    ],
  });

  // If we're not in production then log to the console
  if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple(),
        winston.format.printf(({ timestamp, level, message, requestId, ...meta }) => {
          const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
          return `${timestamp} [${requestId || 'SYSTEM'}] ${level}: ${message}${metaStr}`;
        })
      )
    }));
  }

  return logger;
};

/**
 * Create child logger with request ID
 */
export const createRequestLogger = (requestId: string): winston.Logger => {
  const logger = setupLogging();
  return logger.child({ requestId });
};

/**
 * Log HTTP requests
 */
export const logHttpRequest = (method: string, url: string, statusCode: number, duration: number, requestId?: string) => {
  const logger = setupLogging();
  logger.http(`HTTP ${method} ${url} ${statusCode} ${duration}ms`, { requestId });
};

/**
 * Log errors with context
 */
export const logError = (error: Error, context?: any, requestId?: string) => {
  const logger = setupLogging();
  logger.error(error.message, {
    requestId,
    context,
    stack: error.stack
  });
};

/**
 * Log warnings
 */
export const logWarning = (message: string, context?: any, requestId?: string) => {
  const logger = setupLogging();
  logger.warn(message, { requestId, context });
};

/**
 * Log info messages
 */
export const logInfo = (message: string, context?: any, requestId?: string) => {
  const logger = setupLogging();
  logger.info(message, { requestId, context });
};











































