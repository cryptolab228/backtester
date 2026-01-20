import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';

// Rate limiter configuration
export const rateLimit = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || '900000', 10), // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10), // 100 requests per window
  message: {
    success: false,
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: Math.ceil(parseInt(process.env.RATE_LIMIT_WINDOW || '900000', 10) / 1000 / 60) // minutes
  },
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  // Skip rate limiting for health checks
  skip: (req: Request) => req.path === '/health',
  // Custom key generator based on user ID if available
  keyGenerator: (req: Request) => {
    // Use user ID if authenticated, otherwise IP
    return (req as any).userId || req.ip || req.connection.remoteAddress || 'unknown';
  },
  // Custom handler for rate limit exceeded
  handler: (req: Request, res: Response) => {
    console.warn(`Rate limit exceeded for ${req.ip} on ${req.path}`);
    res.status(429).json({
      success: false,
      error: 'Too many requests from this IP, please try again later.',
      retryAfter: Math.ceil(parseInt(process.env.RATE_LIMIT_WINDOW || '900000', 10) / 1000 / 60)
    });
  },
  // Skip successful requests from rate limiting
  skipSuccessfulRequests: false,
  // Skip failed requests from rate limiting
  skipFailedRequests: false
});

// Stricter rate limiting for heavy operations
export const strictRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  message: {
    success: false,
    error: 'Too many heavy operations from this IP, please try again later.'
  },
  skip: (req: Request) => req.path === '/health'
});

