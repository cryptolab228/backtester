import { Request, Response, NextFunction } from 'express';

// Simple circuit breaker implementation without external dependencies
interface CircuitBreakerState {
  failures: number;
  lastFailureTime: number;
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
}

class SimpleCircuitBreaker {
  private state: CircuitBreakerState = {
    failures: 0,
    lastFailureTime: 0,
    state: 'CLOSED'
  };

  constructor(
    private name: string,
    private threshold: number = 5,
    private timeout: number = 60000,
    private resetTimeout: number = 30000
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state.state === 'OPEN') {
      if (Date.now() - this.state.lastFailureTime > this.resetTimeout) {
        this.state.state = 'HALF_OPEN';
      } else {
        throw new Error(`${this.name} circuit breaker is OPEN`);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess() {
    this.state.failures = 0;
    this.state.state = 'CLOSED';
  }

  private onFailure() {
    this.state.failures++;
    this.state.lastFailureTime = Date.now();

    if (this.state.failures >= this.threshold) {
      this.state.state = 'OPEN';
    }
  }

  getState() {
    return this.state.state;
  }
}

// Circuit breaker instances for different external services
const gpuServiceBreaker = new SimpleCircuitBreaker('gpu-service');
const databaseCircuitBreaker = new SimpleCircuitBreaker('database');
const redisCircuitBreaker = new SimpleCircuitBreaker('redis');

/**
 * Circuit breaker middleware for GPU service calls
 */
export const gpuServiceCircuitBreaker = (req: Request, res: Response, next: NextFunction) => {
  const circuitBreaker = gpuServiceBreaker;
  circuitBreaker.execute(() => {
    return Promise.resolve();
  }).then(() => {
    (req as any).circuitBreaker = {
      success: () => {},
      failure: (error: Error) => {},
      name: 'gpu-service'
    };
    next();
  }).catch((error: Error) => {
    console.error('GPU service circuit breaker triggered:', error.message);
    res.status(503).json({
      success: false,
      error: 'GPU service temporarily unavailable',
      circuitBreaker: 'OPEN'
    });
  });
};

/**
 * Execute function with circuit breaker protection
 */
export const executeWithCircuitBreaker = async <T>(
  circuitBreakerName: string,
  operation: () => Promise<T>
): Promise<T> => {
  let circuitBreaker: SimpleCircuitBreaker;

  switch (circuitBreakerName) {
    case 'gpu-service':
      circuitBreaker = gpuServiceBreaker;
      break;
    case 'database':
      circuitBreaker = databaseCircuitBreaker;
      break;
    case 'redis':
      circuitBreaker = redisCircuitBreaker;
      break;
    default:
      throw new Error(`Unknown circuit breaker: ${circuitBreakerName}`);
  }

  return circuitBreaker.execute(operation);
};

/**
 * Get circuit breaker state
 */
export const getCircuitBreakerState = (name: string): string => {
  switch (name) {
    case 'gpu-service':
      return gpuServiceBreaker.getState();
    case 'database':
      return databaseCircuitBreaker.getState();
    case 'redis':
      return redisCircuitBreaker.getState();
    default:
      return 'UNKNOWN';
  }
};

