import { Request, Response, NextFunction } from 'express';
import { getRequestId } from './requestTracing';

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
  console.error(`[${requestId}] Error:`, {
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
 * 404 handler middleware
 */
export const notFoundHandler = (req: Request, res: Response, next: NextFunction) => {
  const requestId = getRequestId(req);

  const error = new Error(`Route ${req.originalUrl} not found`) as CustomError;
  error.statusCode = 404;

  console.warn(`[${requestId}] 404 - Route not found: ${req.method} ${req.originalUrl}`);

  res.status(404).json({
    success: false,
    error: 'Route not found',
    requestId,
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.originalUrl
  });
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

