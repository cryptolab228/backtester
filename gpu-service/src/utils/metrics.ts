import promClient from 'prometheus-api-metrics';
import { Application } from 'express';

/**
 * Setup Prometheus metrics
 */
export const setupMetrics = (app: Application): void => {
  if (process.env.METRICS_ENABLED !== 'true') {
    console.log('Metrics disabled');
    return;
  }

  try {
    // Create Prometheus registry
    const register = new promClient.Registry();

    // Add default metrics
    promClient.collectDefaultMetrics({ register });

    // Custom metrics
    const httpRequestDuration = new promClient.Histogram({
      name: 'gpu_service_http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.1, 0.5, 1, 2, 5, 10],
      registers: [register]
    });

    const gpuBacktestDuration = new promClient.Histogram({
      name: 'gpu_service_backtest_duration_seconds',
      help: 'Duration of GPU backtest operations',
      labelNames: ['pair', 'success'],
      buckets: [1, 5, 10, 30, 60, 120, 300],
      registers: [register]
    });

    const gpuBacktestCount = new promClient.Counter({
      name: 'gpu_service_backtest_total',
      help: 'Total number of GPU backtest operations',
      labelNames: ['pair', 'status'],
      registers: [register]
    });

    const gpuMemoryUsage = new promClient.Gauge({
      name: 'gpu_service_memory_usage_mb',
      help: 'GPU memory usage in MB',
      registers: [register]
    });

    const circuitBreakerState = new promClient.Gauge({
      name: 'gpu_service_circuit_breaker_state',
      help: 'Circuit breaker state (0=closed, 1=open, 2=half-open)',
      labelNames: ['name'],
      registers: [register]
    });

    // Store metrics in app for use in routes
    (app as any).metrics = {
      httpRequestDuration,
      gpuBacktestDuration,
      gpuBacktestCount,
      gpuMemoryUsage,
      circuitBreakerState
    };

    // Expose metrics endpoint
    const metricsPort = parseInt(process.env.METRICS_PORT || '9090', 10);
    app.get('/metrics', async (req, res) => {
      try {
        res.set('Content-Type', register.contentType);
        const metrics = await register.metrics();
        res.end(metrics);
      } catch (error: any) {
        res.status(500).end(error.message);
      }
    });

    console.log(`📊 Metrics enabled on port ${metricsPort}`);

    // Start metrics collection interval
    setInterval(() => {
      try {
        // Update GPU memory usage (simulated)
        const memoryUsage = Math.random() * 4000; // 0-4GB
        gpuMemoryUsage.set(memoryUsage);

        // Update circuit breaker states (simulated)
        circuitBreakerState.set({ name: 'gpu-backtest' }, Math.random() > 0.9 ? 1 : 0);
      } catch (error) {
        console.error('Error updating metrics:', error);
      }
    }, 10000); // Update every 10 seconds

  } catch (error: any) {
    console.error('Failed to setup metrics:', error);
  }
};

/**
 * Record HTTP request metrics
 */
export const recordHttpMetrics = (
  method: string,
  route: string,
  statusCode: number,
  duration: number,
  app: Application
) => {
  try {
    const metrics = (app as any).metrics;
    if (metrics && metrics.httpRequestDuration) {
      metrics.httpRequestDuration
        .labels(method, route, statusCode.toString())
        .observe(duration / 1000); // Convert to seconds
    }
  } catch (error) {
    console.error('Error recording HTTP metrics:', error);
  }
};

/**
 * Record GPU backtest metrics
 */
export const recordGPUBacktestMetrics = (
  pair: string,
  success: boolean,
  duration: number,
  app: Application
) => {
  try {
    const metrics = (app as any).metrics;
    if (metrics) {
      if (metrics.gpuBacktestDuration) {
        metrics.gpuBacktestDuration
          .labels(pair, success ? 'success' : 'error')
          .observe(duration / 1000);
      }

      if (metrics.gpuBacktestCount) {
        metrics.gpuBacktestCount
          .labels(pair, success ? 'success' : 'error')
          .inc();
      }
    }
  } catch (error) {
    console.error('Error recording GPU backtest metrics:', error);
  }
};











































