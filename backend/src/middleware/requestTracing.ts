import { Request, Response, NextFunction } from 'express';

// Simple UUID generator to avoid dependency issues
const generateId = (): string => {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

// Extend Request interface to include requestId
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      startTime?: number;
    }
  }
}

/**
 * Request tracing middleware
 * Adds unique request ID and timing information to each request
 */
export const requestTracing = (req: Request, res: Response, next: NextFunction) => {
  // Generate unique request ID
  const requestId = req.headers['x-request-id'] as string || generateId();

  // Add request ID to request object
  req.requestId = requestId;
  req.startTime = Date.now();

  // Add request ID to response headers
  res.setHeader('x-request-id', requestId);

  // Log request start
  console.log(`[${requestId}] ${req.method} ${req.originalUrl} - START`);

  next();
};

/**
 * Get current request ID from request object
 */
export const getRequestId = (req: Request): string => {
  return req.requestId || 'unknown';
};

/**
 * Get request duration in milliseconds
 */
export const getRequestDuration = (req: Request): number => {
  return req.startTime ? Date.now() - req.startTime : 0;
};
