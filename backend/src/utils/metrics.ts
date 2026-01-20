import { Application, Request, Response } from 'express';

/**
 * Setup basic metrics collection
 */
export const setupMetrics = (app: Application): void => {
  if (process.env.METRICS_ENABLED !== 'true') {
    console.log('Metrics disabled');
    return;
  }

  // Store metrics data
  const metrics = {
    requestCount: 0,
    errorCount: 0,
    averageResponseTime: 0,
    startTime: Date.now()
  };

  // Store metrics in app for use in middleware
  (app as any).metrics = metrics;

  // Update metrics periodically
  setInterval(() => {
    const uptime = Date.now() - metrics.startTime;
    const uptimeSeconds = uptime / 1000;

    console.log(`[METRICS] Uptime: ${uptimeSeconds.toFixed(0)}s, Requests: ${metrics.requestCount}, Errors: ${metrics.errorCount}, Avg Response: ${metrics.averageResponseTime.toFixed(2)}ms`);
  }, 30000); // Log every 30 seconds
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
    if (metrics) {
      metrics.requestCount++;

      if (statusCode >= 400) {
        metrics.errorCount++;
      }

      // Update average response time
      const totalTime = metrics.averageResponseTime * (metrics.requestCount - 1) + duration;
      metrics.averageResponseTime = totalTime / metrics.requestCount;
    }
  } catch (error) {
    console.error('Error recording HTTP metrics:', error);
  }
};

/**
 * Get current metrics
 */
export const getMetrics = (app: Application) => {
  const metrics = (app as any).metrics;
  if (!metrics) {
    return null;
  }

  return {
    uptime: Date.now() - metrics.startTime,
    requestCount: metrics.requestCount,
    errorCount: metrics.errorCount,
    averageResponseTime: metrics.averageResponseTime,
    errorRate: metrics.requestCount > 0 ? (metrics.errorCount / metrics.requestCount) * 100 : 0
  };
};









