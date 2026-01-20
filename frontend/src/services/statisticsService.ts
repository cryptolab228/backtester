import { apiClient } from './apiService';

export interface SystemHealth {
  database: 'healthy' | 'error';
  redis: 'healthy' | 'error';
  queue: 'healthy' | 'error';
}

export interface BacktesterStatistics {
  systemHealth: SystemHealth;
  queueStatistics: {
    totalJobs: number;
    activeJobs: number;
    waitingJobs: number;
    completedJobs: number;
    failedJobs: number;
  };
  dataStatistics: {
    totalTradingPairs: number;
    totalCandles: number;
    latestDataTimestamp: string | null;
    oldestDataTimestamp: string | null;
  };
  backtestStatistics: {
    totalBacktestsRun: number;
    totalPortfolioBacktests: number;
    avgBacktestDuration: number | null;
    lastBacktestTimestamp: string | null;
  };
  resourceUsage: {
    uptime: number;
    memoryUsage: {
      used: number;
      total: number;
      percentage: number;
    };
  };
}

export const getDashboardStatistics = async (): Promise<BacktesterStatistics> => {
  try {
    console.log('[StatisticsService] Fetching dashboard statistics...');
    const response = await apiClient.get<BacktesterStatistics>('/statistics/dashboard');
    console.log('[StatisticsService] Dashboard statistics fetched successfully:', response.data);
    return response.data;
  } catch (error: any) {
    console.error('[StatisticsService] Error fetching dashboard statistics:', error.response?.data || error.message);
    throw error.response?.data || new Error('Failed to fetch dashboard statistics');
  }
};

export default {
  getDashboardStatistics,
}; 