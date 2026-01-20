/**
 * Конфигурация для сохранения и анализа результатов тестирования
 * Позволяет сравнивать различные типы бэктестов
 */

export interface TestResultConfig {
  enabled: boolean;
  outputDirectory: string;
  maxResultsPerFile: number;
  includeTrades: boolean;
  includeCandles: boolean;
  compactMode: boolean;
}

export interface BacktestTestResult {
  // Идентификация теста
  testId: string;
  timestamp: string;
  testType: 'CPU_SINGLE' | 'CPU_PORTFOLIO' | 'GPU_SINGLE' | 'GPU_PORTFOLIO';
  
  // Параметры теста
  pairSymbols: string[];
  timeframe: string;
  dateRange: {
    startDate: string;
    endDate: string;
  };
  initialCapital: number;
  
  // Ключевые результаты
  metrics: {
    totalPnl: number;
    totalPnlPercentage: number;
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    profitFactor: number;
    maxDrawdown: number;
    durationMs: number;
  };
  
  // Дополнительные данные для анализа
  strategyParameters?: any;
  firstTradeDetails?: any;
  lastTradeDetails?: any;
  
  // Портфельные данные (если применимо)
  portfolioMetrics?: {
    totalPortfolioTrades: number;
    portfolioWinRate: number;
    avgConcurrentTrades: number;
    peakConcurrentTrades: number;
  };
  
  // Метаданные
  candlesProcessed: number;
  executionSource: 'IMMEDIATE' | 'QUEUE' | 'WEBSOCKET';
}

export const DEFAULT_TEST_RESULTS_CONFIG: TestResultConfig = {
  enabled: true,
  outputDirectory: './backend/test-results',
  maxResultsPerFile: 100,
  includeTrades: false, // Для компактности
  includeCandles: false, // Для компактности
  compactMode: true,
};

export const TEST_RESULT_FILENAME_TEMPLATE = (testType: string) => 
  `backtest-results-${testType.toLowerCase()}-{date}.json`;
