import axios from 'axios';

/**
 * Check database health by testing connection
 */
export const checkDatabaseHealth = async (): Promise<boolean> => {
  try {
    // This would check actual database connection
    // For now, we'll simulate it
    const isHealthy = Math.random() > 0.05; // 95% success rate
    return isHealthy;
  } catch (error) {
    console.error('Database health check failed:', error);
    return false;
  }
};

/**
 * Check Redis health by testing connection
 */
export const checkRedisHealth = async (): Promise<boolean> => {
  try {
    // This would check actual Redis connection
    // For now, we'll simulate it
    const isHealthy = Math.random() > 0.05; // 95% success rate
    return isHealthy;
  } catch (error) {
    console.error('Redis health check failed:', error);
    return false;
  }
};

/**
 * Check backend service health
 */
export const checkBackendHealth = async (): Promise<boolean> => {
  try {
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:5000';
    const response = await axios.get(`${backendUrl}/health`, {
      timeout: 5000
    });
    return response.status === 200;
  } catch (error) {
    console.error('Backend health check failed:', error);
    return false;
  }
};


