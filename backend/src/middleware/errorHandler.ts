import { Request, Response, NextFunction } from 'express';
import { getRequestId } from './requestTracing';
import logger from '../utils/logger';

// Custom error interface
interface CustomError extends Error {
  statusCode?: number;
  isOperational?: boolean;
  details?: any;
}

/**
 * Global error handling middleware
 */
export const errorHandler = (
  err: CustomError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const requestId = getRequestId(req);
  const statusCode = err.statusCode || 500;
  const isDevelopment = process.env.NODE_ENV === 'development';

  // Log error with request ID
  logger.error(`[${requestId}] Error:`, {
    message: err.message,
    stack: err.stack,
    statusCode,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    body: req.body,
    params: req.params,
    query: req.query,
    details: err.details
  });

  // Don't expose internal errors in production
  const errorResponse = {
    success: false,
    error: isDevelopment ? err.message : 'Internal server error',
    requestId,
    timestamp: new Date().toISOString(),
    ...(isDevelopment && { stack: err.stack })
  };

  // Set appropriate status code
  res.status(statusCode).json(errorResponse);
};

/**
 * Async error wrapper for route handlers
 */
export const asyncHandler = (fn: Function) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Create custom error with status code
 */
export const createError = (message: string, statusCode: number = 500, details?: any): CustomError => {
  const error = new Error(message) as CustomError;
  error.statusCode = statusCode;
  error.isOperational = true;
  error.details = details;
  return error;
};









