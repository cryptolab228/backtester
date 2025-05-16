import axios from 'axios';
// import type { JobCounts, Job, JobStatus, GetJobsParams } from './apiServiceTypes'; // Удаляем, так как типы определены ниже

// Базовый URL бэкенда (можно вынести в .env)
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Если типы еще не вынесены, оставляем их здесь или определяем новые
export interface TradingPair {
  id: string; // или number, в зависимости от вашей модели
  symbol: string;
  // другие поля, если есть, например, baseAsset, quoteAsset, etc.
}

export interface FetchCandlesParams {
  symbol: string;
  timeframes: string[]; // Изменено на массив строк
  startTime?: number;
  endTime?: number;
  limit?: number;
}

export interface QueuedJobInfo {
  message: string;
  jobId?: string;      // Для одиночной задачи
  jobIds?: string[];   // Для нескольких задач
  totalAttempted?: number;
  totalSuccessfullyQueued?: number;
}

export interface JobCreationResponse {
  message: string;
  jobId: string;
}

/**
 * Запускает задачу получения списка торговых пар.
 */
export const getAvailableTradingPairs = async (): Promise<TradingPair[]> => {
  try {
    console.log('[ApiService] Fetching available trading pairs...');
    const response = await apiClient.get<TradingPair[]>('/data/trading-pairs');
    console.log(`[ApiService] Successfully fetched ${response.data.length} trading pairs.`);
    return response.data;
  } catch (error: any) {
    console.error('[ApiService] Error fetching trading pairs:', error.response?.data || error.message);
    throw error.response?.data || new Error('Failed to fetch trading pairs');
  }
};

export const triggerFetchPairsJob = async (): Promise<QueuedJobInfo> => {
  try {
    console.log('[ApiService] Triggering fetch pairs job...');
    const response = await apiClient.post<QueuedJobInfo>('/data/fetch-pairs', {});
    console.log('[ApiService] Fetch pairs job triggered successfully:', response.data);
    return response.data;
  } catch (error: any) {
    console.error('[ApiService] Error triggering fetch pairs job:', error.response?.data || error.message);
    throw error.response?.data || new Error('Failed to trigger fetch pairs job');
  }
};

// Измененная функция для запуска загрузки свечей
export const triggerFetchCandlesJob = async (params: FetchCandlesParams): Promise<QueuedJobInfo> => {
  try {
    console.log('[ApiService] Triggering fetch candles job with params:', params);
    // Убедимся, что startTime и endTime корректно передаются, если они null/undefined
    const requestParams = {
        ...params,
        startTime: params.startTime === undefined || params.startTime === null ? undefined : params.startTime,
        endTime: params.endTime === undefined || params.endTime === null ? undefined : params.endTime,
        limit: params.limit === undefined || params.limit === null ? undefined : params.limit,
    };
    const response = await apiClient.post<QueuedJobInfo>('/data/fetch-candles', requestParams);
    console.log('[ApiService] Fetch candles job(s) triggered successfully:', response.data);
    return response.data;
  } catch (error: any) {
    console.error('[ApiService] Error triggering fetch candles job:', error.response?.data || error.message, { paramsSent: params });
    throw error.response?.data || new Error('Failed to trigger fetch candles job(s)');
  }
};

// TODO: Добавить функцию для получения статуса задачи
// export const getJobStatus = async (jobId: string | number) => { ... }

// TODO: Добавить функцию для получения списка пар из БД
// export const getStoredPairs = async () => { ... }

// Типы для управления очередью
export interface JobCounts {
  active?: number;
  waiting?: number;
  completed?: number;
  failed?: number;
  delayed?: number;
  paused?: number;
  [key: string]: number | undefined; // Для других возможных статусов
}

export type JobStatus = 'active' | 'waiting' | 'completed' | 'failed' | 'delayed' | 'paused' | 'wait' | 'prioritized';

export interface JobData {
  // Определите структуру данных задачи, если она известна и важна для отображения
  // Например: symbol?: string; timeframe?: string;
  [key: string]: any; 
}

export interface JobOpts {
  attempts?: number;
  delay?: number; // Теперь delay - известное опциональное свойство
  priority?: number;
  // Добавьте другие опции BullMQ, которые могут быть в opts, если они вам нужны
  // removeOnComplete?: boolean | number | { age?: number; count?: number; };
  // removeOnFail?: boolean | number | { age?: number; count?: number; };
  // ... и т.д.
  [key: string]: any; // Для остальных неизвестных опций, если они есть
}

export interface Job {
  id: string;
  name: string;
  data: JobData;
  progress: number | object;
  // delay: number; // Это поле обычно находится внутри opts, а не на верхнем уровне Job в BullMQ. Если оно у вас есть от API, раскомментируйте.
  timestamp: number;
  attemptsMade: number;
  failedReason: string | null;
  stacktrace: string[] | null;
  returnvalue: any | null;
  finishedOn: number | null;
  processedOn: number | null;
  opts: JobOpts; // Используем новый, более точный тип JobOpts
  status: JobStatus; // Изменено: поле status теперь обязательное и соответствует типу JobStatus
  // Добавьте другие поля, которые возвращает toJSON() задачи BullMQ, если они нужны
}

export const getQueueJobCounts = async (): Promise<JobCounts> => {
  const response = await apiClient.get('/data/queue/job-counts');
  return response.data;
};

export interface GetJobsParams {
  status?: JobStatus | JobStatus[];
  start?: number;
  end?: number;
}

export const getJobs = async (params?: GetJobsParams): Promise<Job[]> => {
  const response = await apiClient.get('/data/queue/jobs', { params });
  return response.data;
};

export const getJobDetails = async (jobId: string): Promise<Job> => {
  const response = await apiClient.get(`/data/queue/jobs/${jobId}`);
  return response.data;
};

export const removeJob = async (jobId: string): Promise<{ message: string }> => {
  const response = await apiClient.delete(`/data/queue/jobs/${jobId}`);
  return response.data;
};

export const retryJob = async (jobId: string): Promise<{ message: string }> => {
  const response = await apiClient.post(`/data/queue/jobs/${jobId}/retry`);
  return response.data;
};

export const pauseJob = async (jobId: string): Promise<{ message: string }> => {
  console.debug(`[ApiService] Pausing job: ${jobId}`);
  try {
    const response = await apiClient.post<{ message: string }>(`/data/queue/jobs/${jobId}/pause`);
    console.info(`[ApiService] Job ${jobId} pause request successful:`, response.data.message);
    return response.data;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error during job pause';
    console.error(`[ApiService] Error pausing job ${jobId}:`, errorMessage, error);
    // Re-throw a more specific error or handle it as needed
    throw new Error(`Failed to pause job ${jobId}: ${errorMessage}`);
  }
};

export const resumeJob = async (jobId: string): Promise<{ message: string }> => {
  console.debug(`[ApiService] Resuming job: ${jobId}`);
  try {
    const response = await apiClient.post<{ message: string }>(`/data/queue/jobs/${jobId}/resume`);
    console.info(`[ApiService] Job ${jobId} resume request successful:`, response.data.message);
    return response.data;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error during job resume';
    console.error(`[ApiService] Error resuming job ${jobId}:`, errorMessage, error);
    throw new Error(`Failed to resume job ${jobId}: ${errorMessage}`);
  }
};

export const getJobCounts = async (): Promise<JobCounts> => {
  const response = await apiClient.get('/data/queue/job-counts');
  return response.data;
}; 