import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

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
  const requestId = req.headers['x-request-id'] as string || uuidv4();

  // Add request ID to request object
  req.requestId = requestId;
  req.startTime = Date.now();

  // Add request ID to response headers
  res.setHeader('x-request-id', requestId);

  // Add timing header
  res.setHeader('x-response-time', Date.now().toString());

  // Log request start
  console.log(`[${requestId}] ${req.method} ${req.originalUrl} - START`);

  // Override res.end to log response time
  const originalEnd = res.end;
  res.end = function(chunk?: any, encoding?: BufferEncoding | (() => void)) {
    const responseTime = Date.now() - (req.startTime || Date.now());
    res.setHeader('x-response-time', responseTime.toString());

    console.log(`[${requestId}] ${req.method} ${req.originalUrl} - END - ${responseTime}ms - ${res.statusCode}`);

    // Call original end method
    return originalEnd.call(this, chunk, encoding);
  };

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

