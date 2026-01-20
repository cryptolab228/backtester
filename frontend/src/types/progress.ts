export interface BacktestProgressUpdate {
  jobId: string;
  stage: BacktestStage;
  stageDescription: string;
  processedItems: number;
  totalItems: number;
  startTime: number;
  stageBreakdown: StageInfo[];
  portfolioStats?: PortfolioProgressStats;
  gpuStats?: GPUProgressStats;
  activityLog: ActivityLogEntry[];
  memoryUsage?: number;
  estimatedCompletion?: number;
  currentPairs?: PairProgress[];
  loadingQueue?: LoadingQueueInfo;
}

export interface StageInfo {
  name: string;
  status: 'pending' | 'active' | 'completed' | 'error';
  progress: number;
  startTime?: number;
  endTime?: number;
  errorMessage?: string;
}

export interface PortfolioProgressStats {
  processedPairs: number;
  totalPairs: number;
  totalTrades: number;
  dataLoaded: string;
  currentPair?: string;
  pairsWithData: number;
  pairsNeedingData: number;
  apiCallsMade: number;
  dbQueriesMade: number;
}

export interface GPUProgressStats {
  enabled: boolean;
  status: 'initializing' | 'active' | 'idle' | 'error';
  utilization: number;
  memoryUsage: string;
  memoryTotal: string;
  speedup: number;
  kernelsExecuted: number;
  averageKernelTime: number;
  temperature?: number;
}

export interface ActivityLogEntry {
  timestamp: number;
  message: string;
  level: 'info' | 'warning' | 'error' | 'success';
  stage?: string;
  details?: any;
}

export type BacktestStage = 
  | 'initializing'
  | 'loading_data'
  | 'processing_indicators'
  | 'running_backtest'
  | 'calculating_metrics'
  | 'saving_results'
  | 'completed'
  | 'error';

export interface PerformanceMetrics {
  itemsPerSecond: number;
  itemsPerMinute: number;
  elapsedTime: number;
  estimatedTimeRemaining: number;
  cpuUsage?: number;
  memoryUsage: number;
  diskIO?: number;
  networkIO?: number;
}

// WebSocket события для прогресса
export interface ProgressWebSocketMessage {
  type: 'BACKTEST_PROGRESS';
  data: BacktestProgressUpdate;
}

// Конфигурация GPU
export interface GPUConfiguration {
  enabled: boolean;
  deviceId?: number;
  memoryLimit?: number; // в MB
  batchSize?: number;
  kernelOptimization?: 'speed' | 'memory' | 'balanced';
  fallbackToCPU?: boolean;
}

// Детальное отслеживание пар
export interface PairProgress {
  symbol: string;
  status: 'queued' | 'loading' | 'processing' | 'completed' | 'error';
  progress: number;
  startTime?: number;
  endTime?: number;
  candlesLoaded?: number;
  candlesTotal?: number;
  dataSize?: number;
  errorMessage?: string;
  exchange?: string;
  timeframe?: string;
  speedMbps?: number;
  estimatedTimeRemaining?: number;
}

export interface LoadingQueueInfo {
  totalPairs: number;
  completedPairs: number;
  activePairs: PairProgress[];
  queuedPairs: string[];
  failedPairs: PairProgress[];
  totalCandlesExpected: number;
  totalCandlesLoaded: number;
  totalDataSize: number;
  estimatedTimePerPair: number;
  currentThroughput: number; // пары/мин
  peakThroughput: number;
  averagePairLoadTime: number;
} 