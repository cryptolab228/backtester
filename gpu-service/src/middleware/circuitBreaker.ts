import { Request, Response, NextFunction } from 'express';
import CircuitBreaker from 'circuit-breaker-js';

// Circuit breaker instances for different operations
const backtestCircuitBreaker = new CircuitBreaker({
  name: 'gpu-backtest',
  threshold: parseInt(process.env.CIRCUIT_BREAKER_THRESHOLD || '5', 10),
  timeout: parseInt(process.env.CIRCUIT_BREAKER_TIMEOUT || '60000', 10),
  resetTimeout: 30000
});

// GPU health check circuit breaker
const healthCheckCircuitBreaker = new CircuitBreaker({
  name: 'gpu-health',
  threshold: 3,
  timeout: 30000,
  resetTimeout: 15000
});

/**
 * Circuit breaker middleware for GPU backtest operations
 */
export const circuitBreaker = (req: Request, res: Response, next: NextFunction) => {
  backtestCircuitBreaker.run((success: () => void, failure: (error: Error) => void) => {
    // Store circuit breaker functions in request for use in route handlers
    (req as any).circuitBreaker = {
      success,
      failure
    };
    next();
  }, (error: Error) => {
    console.error('Circuit breaker triggered:', error.message);
    res.status(503).json({
      success: false,
      error: 'Service temporarily unavailable',
      circuitBreaker: 'OPEN'
    });
  });
};

/**
 * Check if GPU service is healthy using circuit breaker
 */
export const checkGPUHealth = async (): Promise<boolean> => {
  return new Promise((resolve) => {
    healthCheckCircuitBreaker.run(
      async (success: () => void) => {
        try {
          // This would check actual GPU availability
          // For now, we'll simulate it
          const isHealthy = Math.random() > 0.1; // 90% success rate
          if (isHealthy) {
            success();
            resolve(true);
          } else {
            throw new Error('GPU unavailable');
          }
        } catch (error) {
          throw error;
        }
      },
      (error: Error) => {
        console.error('GPU health check failed:', error.message);
        resolve(false);
      }
    );
  });
};

/**
 * Execute function with circuit breaker protection
 */
export const executeWithCircuitBreaker = async <T>(
  operation: () => Promise<T>
): Promise<T> => {
  return new Promise((resolve, reject) => {
    backtestCircuitBreaker.run(
      async (success: () => void) => {
        try {
          const result = await operation();
          success();
          resolve(result);
        } catch (error) {
          throw error;
        }
      },
      (error: Error) => {
        reject(error);
      }
    );
  });
};

