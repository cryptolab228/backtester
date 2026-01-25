/**
 * Store для модуля Optimizer
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000';

// Типы согласно новому ТЗ Walk-Forward Optimizer
export interface ParameterRange {
  min: number;
  max: number;
  step: number;
}

export interface ParameterValues {
  values: (number | string)[];
}

export type ParameterDefinition = ParameterRange | ParameterValues;

export interface OptimizationParameterGrid {
  risk_per_trade?: ParameterDefinition;
  stop_loss_atr_multiplier?: ParameterDefinition;
  take_profit_atr_multiplier?: ParameterDefinition;
  min_reward_risk_ratio?: ParameterDefinition;
  adx_period?: ParameterDefinition;
  adx_trend_threshold?: ParameterDefinition;
  adx_range_threshold?: ParameterDefinition;
  nwe_multiplier?: ParameterDefinition;
  nwe_period?: ParameterDefinition;
  dlc_period?: ParameterDefinition;
  [key: string]: ParameterDefinition | undefined;
}

export interface OptimizationConstraints {
  maxDrawdownLimit: number;    // Max DD: 25%
  minTradesCount: number;      // Min Trades: 30 за год
  minWinRate: number;          // Win Rate: 40%
  maxOosPerformanceDrop: number;
}

// ТЗ 2.1 - Алгоритм скользящего окна
export interface WalkForwardConfig {
  enabled: boolean;
  trainWindowMonths: number;   // Окно обучения (In-Sample), default: 12
  testWindowMonths: number;    // Окно теста (Out-of-Sample), default: 3
  stepMonths: number;          // Сдвиг окна, default: 3
}

// WFA итерация
export interface WFAIteration {
  iterationNumber: number;
  trainStart: string;
  trainEnd: string;
  testStart: string;
  testEnd: string;
  bestParameters: ParameterSet;
  inSampleMetrics: {
    netProfitPercent: number;
    maxDrawdownPercent: number;
    calmarRatio: number;
    winRate: number;
    totalTrades: number;
    profitFactor: number;
  };
  outOfSampleMetrics: {
    netProfitPercent: number;
    maxDrawdownPercent: number;
    calmarRatio: number;
    winRate: number;
    totalTrades: number;
    profitFactor: number;
  };
  performanceDrop: number;
  isStable: boolean;
}

// Точка эквити для графика (ТЗ 4.Б)
export interface EquityPoint {
  timestamp: number;
  date: string;
  equity: number;
  equityPercent: number;
  drawdown: number;
  drawdownPercent: number;
  isOutOfSample: boolean;
  iterationNumber?: number;
}

// WFA Summary
export interface WFASummary {
  totalIterations: number;
  stableIterations: number;
  stabilityRatio: number;
  averageOosCalmar: number;
  averageOosProfit: number;
  averageOosDrawdown: number;
  combinedOosProfit: number;
  combinedOosMaxDrawdown: number;
  recommendedParameters: ParameterSet;
}

export interface OptimizerConfig {
  pairSymbols: string[];
  timeframe: string;
  startDate: string;
  endDate: string;
  exchange: string;
  parameterGrid: OptimizationParameterGrid;
  constraints: OptimizationConstraints;
  walkForward: WalkForwardConfig;
  objectiveFunction: 'calmar_ratio' | 'recovery_factor' | 'profit_factor' | 'sharpe_ratio';
  maxCombinations?: number;
}

export interface ParameterSet {
  [key: string]: number;
}

export interface OptimizationRunResult {
  id: string;
  parameters: ParameterSet;
  netProfit: number;
  netProfitPercent: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  calmarRatio: number;
  recoveryFactor: number;
  oosStatus: 'passed' | 'failed' | 'not_tested';
  oosPerformanceDrop?: number;
  isValid: boolean;
  invalidReasons: string[];
}

export interface OptimizationProgress {
  jobId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  totalCombinations: number;
  completedCombinations: number;
  progressPercent: number;
  currentParameters?: ParameterSet;
  estimatedTimeRemaining?: number;
  startTime: number;
  elapsedTime: number;
  bestResultSoFar?: OptimizationRunResult;
  errors: string[];
}

export interface OptimizationResult {
  jobId: string;
  config: OptimizerConfig;
  status: string;
  allResults: OptimizationRunResult[];
  topResults: OptimizationRunResult[];
  bestResult?: OptimizationRunResult;
  totalCombinations: number;
  validCombinations: number;
  invalidCombinations: number;
  startTime: number;
  endTime: number;
  totalExecutionTimeMs: number;
  errors: string[];
}

export const useOptimizerStore = defineStore('optimizer', () => {
  // State
  const isRunning = ref(false);
  const currentJobId = ref<string | null>(null);
  const progress = ref<OptimizationProgress | null>(null);
  const result = ref<OptimizationResult | null>(null);
  const error = ref<string | null>(null);
  const optimizationHistory = ref<{ jobId: string; status: string; timestamp: number }[]>([]);

  // Config defaults согласно ТЗ
  const config = ref<OptimizerConfig>({
    pairSymbols: [],
    timeframe: '1h',
    startDate: '',
    endDate: '',
    exchange: 'bybit',
    parameterGrid: {
      adx_threshold: { min: 15, max: 35, step: 5 },
      nwe_multiplier: { min: 1.8, max: 2.4, step: 0.1 },
      stop_loss_atr: { min: 1.0, max: 3.0, step: 0.5 }
    },
    constraints: {
      maxDrawdownLimit: 25,    // Max DD: 25%
      minTradesCount: 30,      // Min Trades: 30 за год
      minWinRate: 40,          // Win Rate: 40%
      maxOosPerformanceDrop: 50
    },
    walkForward: {
      enabled: true,
      trainWindowMonths: 12,   // 12 месяцев обучения
      testWindowMonths: 3,     // 3 месяца теста
      stepMonths: 3            // Сдвиг на 3 месяца
    },
    objectiveFunction: 'calmar_ratio',
    maxCombinations: 10000
  });

  // Computed
  const progressPercent = computed(() => progress.value?.progressPercent || 0);
  const isCompleted = computed(() => progress.value?.status === 'completed');
  const topResults = computed(() => result.value?.topResults || []);
  const bestResult = computed(() => result.value?.bestResult);
  
  const estimatedCombinations = computed(() => {
    let total = 1;
    for (const [, param] of Object.entries(config.value.parameterGrid)) {
      if (param) {
        if ('values' in param) {
          total *= param.values.length;
        } else if ('min' in param && 'max' in param && 'step' in param) {
          const count = Math.floor((param.max - param.min) / param.step) + 1;
          total *= count;
        }
      }
    }
    return Math.min(total, config.value.maxCombinations || 10000);
  });

  // Actions
  async function startOptimization() {
    if (isRunning.value) return;
    
    error.value = null;
    isRunning.value = true;
    result.value = null;
    
    try {
      const response = await axios.post(`${API_BASE}/api/optimizer/start`, config.value);
      
      if (response.data.success) {
        currentJobId.value = response.data.jobId || 'pending';
        optimizationHistory.value.unshift({
          jobId: currentJobId.value || 'pending',
          status: 'running',
          timestamp: Date.now()
        });
      } else {
        throw new Error(response.data.error || 'Failed to start optimization');
      }
    } catch (err: any) {
      error.value = err.response?.data?.error || err.message;
      isRunning.value = false;
      throw err;
    }
  }

  async function cancelOptimization() {
    if (!currentJobId.value) return;
    
    try {
      await axios.post(`${API_BASE}/api/optimizer/cancel/${currentJobId.value}`);
      isRunning.value = false;
    } catch (err: any) {
      error.value = err.response?.data?.error || err.message;
    }
  }

  async function fetchResults(jobId: string) {
    try {
      const response = await axios.get(`${API_BASE}/api/optimizer/results/${jobId}`);
      result.value = response.data;
      return response.data;
    } catch (err: any) {
      error.value = err.response?.data?.error || err.message;
      return null;
    }
  }

  async function downloadCSV(jobId: string) {
    try {
      const response = await axios.get(`${API_BASE}/api/optimizer/results/${jobId}?format=csv`, {
        responseType: 'blob'
      });
      
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `optimization_${jobId}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err: any) {
      error.value = err.response?.data?.error || err.message;
    }
  }

  // WebSocket handlers
  function handleProgressUpdate(data: OptimizationProgress) {
    progress.value = data;
    if (data.jobId && !currentJobId.value) {
      currentJobId.value = data.jobId;
    }
  }

  function handleCompleted(data: OptimizationResult) {
    result.value = data;
    isRunning.value = false;
    
    // Update history
    const historyItem = optimizationHistory.value.find(h => h.jobId === data.jobId);
    if (historyItem) {
      historyItem.status = 'completed';
    }
  }

  function handleFailed(data: { error: string }) {
    error.value = data.error;
    isRunning.value = false;
    
    if (currentJobId.value) {
      const historyItem = optimizationHistory.value.find(h => h.jobId === currentJobId.value);
      if (historyItem) {
        historyItem.status = 'failed';
      }
    }
  }

  function handleCancelled(data: { jobId: string }) {
    isRunning.value = false;
    
    const historyItem = optimizationHistory.value.find(h => h.jobId === data.jobId);
    if (historyItem) {
      historyItem.status = 'cancelled';
    }
  }

  // Parameter grid helpers
  function addParameter(key: string, type: 'range' | 'values') {
    if (type === 'range') {
      config.value.parameterGrid[key] = { min: 0, max: 10, step: 1 };
    } else {
      config.value.parameterGrid[key] = { values: [1, 2, 3] };
    }
  }

  function removeParameter(key: string) {
    delete config.value.parameterGrid[key];
  }

  function updateParameter(key: string, param: ParameterDefinition) {
    config.value.parameterGrid[key] = param;
  }

  function reset() {
    isRunning.value = false;
    currentJobId.value = null;
    progress.value = null;
    result.value = null;
    error.value = null;
  }

  return {
    // State
    isRunning,
    currentJobId,
    progress,
    result,
    error,
    config,
    optimizationHistory,
    
    // Computed
    progressPercent,
    isCompleted,
    topResults,
    bestResult,
    estimatedCombinations,
    
    // Actions
    startOptimization,
    cancelOptimization,
    fetchResults,
    downloadCSV,
    handleProgressUpdate,
    handleCompleted,
    handleFailed,
    handleCancelled,
    addParameter,
    removeParameter,
    updateParameter,
    reset
  };
});
