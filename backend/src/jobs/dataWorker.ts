import { Job, JobProgress } from 'bullmq';
import logger from '@/utils/logger';
import { createWorker, DATA_QUEUE_NAME, dataQueue, broadcastJobCounts } from '@/config/queue';
import * as okxService from '@/services/okxService';
import { dataService } from '@/services/dataService';
import { broadcast } from '@/websocket';

// Интерфейсы для данных задач
interface FetchPairsJobData {
  isUserPaused?: boolean;
}

interface FetchCandlesJobData {
  symbol: string;
  timeframe: string;
  startTime?: number;
  endTime?: number;
  limit?: number;
  isUserPaused?: boolean;
}

type DataJobData = FetchPairsJobData | FetchCandlesJobData;

// Константы для имен задач
export const JOB_TYPES = {
  FETCH_PAIRS: 'fetch-pairs',
  FETCH_CANDLES: 'fetch-candles',
} as const;

/**
 * Обработчик задачи получения и сохранения списка торговых пар.
 */
const processFetchPairs = async (job: Job<FetchPairsJobData>) => {
  logger.info(`Processing job ${JOB_TYPES.FETCH_PAIRS} (ID: ${job.id}) with data:`, job.data);
  try {
    logger.info(`Starting processFetchPairs for job ID: ${job.id}`);
    const pairs = await okxService.getFuturesPairs();
    logger.debug(`[Job ${job.id}] Fetched ${pairs.length} pairs from OKX.`);

    await dataService.saveOrUpdateTradingPairs(pairs);
    logger.debug(`[Job ${job.id}] Finished dataService.saveOrUpdateTradingPairs.`);

    logger.info(`Finished processFetchPairs for job ID: ${job.id} successfully.`);

  } catch (error: any) {
    logger.error(`Error processing job ${JOB_TYPES.FETCH_PAIRS} (ID: ${job.id}):`, error);
    throw error;
  }
};

/**
 * Обработчик задачи получения и сохранения исторических свечей.
 */
const processFetchCandles = async (job: Job<FetchCandlesJobData>) => {
  const { symbol, timeframe, startTime, endTime, limit } = job.data;
  // <-- Лог самого начала обработки
  logger.info(`[Worker] Received job ${JOB_TYPES.FETCH_CANDLES} (ID: ${job.id}) for ${symbol} (${timeframe}). Starting processing...`);

  logger.info(`Processing job ${JOB_TYPES.FETCH_CANDLES} (ID: ${job.id}) with data:`, job.data);
  try {
    logger.info(`Starting processFetchCandles for job ID: ${job.id}, symbol: ${symbol}, timeframe: ${timeframe}`);
    logger.debug(`[Job ${job.id}] Calling okxService.getHistoricalCandles for ${symbol}...`);
    const candles = await okxService.getHistoricalCandles(symbol, timeframe, startTime, endTime, limit);
    logger.debug(`[Job ${job.id}] Fetched ${candles.length} candles for ${symbol} from OKX.`);

    if (candles.length > 0) {
      logger.debug(`[Job ${job.id}] Calling dataService.saveCandles for ${symbol}...`);
      await dataService.saveCandles(symbol, timeframe, candles);
      logger.debug(`[Job ${job.id}] Finished dataService.saveCandles for ${symbol}.`);
    }

    logger.info(`Finished processFetchCandles for job ID: ${job.id} successfully.`);

  } catch (error: any) {
    logger.error(`Error processing job ${JOB_TYPES.FETCH_CANDLES} (ID: ${job.id}) for ${symbol} (${timeframe}):`, error);
    throw error;
  }
};

// Главный процессор задач для очереди данных
const dataProcessor = async (job: Job<DataJobData>) => {
  logger.debug(`[Worker] Picked up job ${job.name} (ID: ${job.id}).`); // Лог получения задачи воркером

  // ---> Проверка флага isUserPaused <--- 
  if (job.data?.isUserPaused === true) {
    logger.info(`[Worker] Job ${job.id} (${job.name}) is paused by user. Attempting to move to delayed state and skipping processing.`);
    try {
      // Перемещаем в delayed на очень долгий срок (имитация паузы)
      const VERY_LARGE_DELAY = 24 * 60 * 60 * 1000 * 365 * 10; // 10 лет
      await (job as any).moveToDelayed(Date.now() + VERY_LARGE_DELAY, undefined, true); // Добавлен токен и флаг
      logger.info(`[Worker] Job ${job.id} successfully moved to delayed state due to user pause.`);
      return; // Важно! Завершаем обработку этой задачи воркером
    } catch (delayError: any) {
      logger.error(`[Worker] Failed to move user-paused job ${job.id} to delayed state: ${delayError.message}. Job will remain in its current state but processing will be skipped.`, { stack: delayError.stack });
      // Даже если не удалось переместить, не обрабатываем ее
      return; 
    }
  }
  // -------------------------------------

  switch (job.name) {
    case JOB_TYPES.FETCH_PAIRS:
      await processFetchPairs(job as Job<FetchPairsJobData>);
      break;
    case JOB_TYPES.FETCH_CANDLES:
      await processFetchCandles(job as Job<FetchCandlesJobData>);
      break;
    default:
      logger.warn(`Unknown job type: ${job.name}`);
      // Для неизвестных типов лучше выбросить ошибку, чтобы задача не считалась успешной
      throw new Error(`Unknown job type: ${job.name}`);
  }
};

// Создаем инстанс воркера
const worker = createWorker<DataJobData>(DATA_QUEUE_NAME, dataProcessor);

// --- Добавляем слушателей событий к созданному воркеру --- 
worker.on('completed', async (job: Job, result: any) => {
  const jobId = job?.id; // Определяем jobId здесь
  const jobName = job?.name || 'unknown';
  logger.info(`[Queue Events][Worker] Job ${jobName} (ID: ${jobId || 'unknown'}) completed successfully.`);

  try {
    if (typeof jobId === 'string') { // Проверяем, что jobId это строка
      const currentJob = await dataQueue.getJob(jobId); // <--- ИСПОЛЬЗУЕМ ПРОВЕРЕННЫЙ jobId
      if (currentJob) {
        // ... остальная логика broadcast ...
        broadcast({
          type: 'job_updated',
          jobId: currentJob.id, // ID из currentJob
          name: currentJob.name,
          status: 'completed',
          timestamp: currentJob.timestamp ? new Date(currentJob.timestamp).toISOString() : new Date().toISOString(),
          data: currentJob.data,
          opts: currentJob.opts,
          attemptsMade: currentJob.attemptsMade,
          processedOn: currentJob.processedOn ? new Date(currentJob.processedOn).toISOString() : null,
          finishedOn: currentJob.finishedOn ? new Date(currentJob.finishedOn).toISOString() : new Date().toISOString(),
          failedReason: currentJob.failedReason,
          progress: currentJob.progress,
          returnValue: result
        });
        logger.debug(`[Worker Listener - completed] Broadcast sent for job ${jobId}.`);
      } else {
        logger.warn(`[Worker Listener - completed] Could not get job ${jobId} from queue for broadcasting.`);
      }
    } else {
      logger.warn(`[Worker Listener - completed] Job ID is undefined. Skipping broadcast for job object:`, job);
    }
    broadcastJobCounts();
  } catch (error) {
    logger.error(`[Worker Listener - completed] Error during broadcast for job ${jobId || 'unknown'}:`, error);
    broadcastJobCounts();
  }
});

// --- Обработчик 'failed' --- 
worker.on('failed', async (job: Job | undefined, error: Error) => {
  const jobId = job?.id;
  const jobName = job?.name || 'unknown';
  logger.error(`[Queue Events][Worker] Job ${jobName} (ID: ${jobId || 'unknown'}) failed:`, error);
  try {
    let jobDataToSend: any;
    let currentJob: Job | null = null;
    if (job && job.id) {
       currentJob = await dataQueue.getJob(job.id); 
    }
    
    if(currentJob) {
      jobDataToSend = {
        type: 'job_updated',
        jobId: currentJob.id,
        name: currentJob.name,
        status: 'failed', 
        timestamp: currentJob.timestamp ? new Date(currentJob.timestamp).toISOString() : null,
        processedOn: currentJob.processedOn ? new Date(currentJob.processedOn).toISOString() : null,
        finishedOn: currentJob.finishedOn ? new Date(currentJob.finishedOn).toISOString() : new Date().toISOString(),
        failedReason: currentJob.failedReason || error.message,
        stacktrace: currentJob.stacktrace || (error.stack ? error.stack.split('\n') : null),
        data: currentJob.data,
        opts: currentJob.opts,
        attemptsMade: currentJob.attemptsMade
      };
      logger.debug(`[Worker Listener - failed] Broadcast sent for job ${jobId || 'unknown'}.`);
    } else {
      logger.warn(`[Worker Listener - failed] Could not get job ${jobId || 'unknown'} from queue. Broadcasting minimal info.`);
       jobDataToSend = {
        type: 'job_updated',
        jobId: jobId || 'unknown',
        name: jobName,
        status: 'failed',
        failedReason: error.message,
        timestamp: new Date().toISOString() 
      };
    }
    broadcast(jobDataToSend);
    
    // ---> Убираем if (typeof jobId === 'string') вокруг broadcastJobCounts <--- 
    // Логирование, вызывавшее ошибку, уже закомментировано.
    // Вызываем broadcastJobCounts в любом случае, т.к. он не зависит от jobId.
    logger.debug(`[Worker Listener - failed] Broadcasting job counts after attempting to process job ${jobId || 'unknown'}.`);
    broadcastJobCounts(); 

  } catch(broadcastError) { 
    logger.error(`[Worker Listener - failed] Error during broadcast for job ${jobId || 'unknown'}:`, broadcastError);
    // ---> Убираем if (typeof jobId === 'string') вокруг broadcastJobCounts <--- 
    // Вызываем broadcastJobCounts в любом случае, т.к. он не зависит от jobId.
    logger.debug(`[Worker Listener - failed] Attempting to broadcast job counts despite broadcast error for job ${jobId || 'unknown'}.`);
    broadcastJobCounts(); 
  }
});

worker.on('error', (error: Error) => {
  // Ошибка самого воркера, не связанная с конкретной задачей
  logger.error('[Worker Error] Worker encountered an error:', error);
});

worker.on('stalled', (jobId: string) => {
  // Задача была активна слишком долго и помечена как stalled
  logger.warn(`[Queue Events] Job (ID: ${jobId}) has stalled.`);
});

// Слушатели для самой очереди (dataQueue) тоже могут быть полезны
dataQueue.on('waiting', (jobId: string) => {
  // Этот лог сработает, когда задача добавляется в очередь и ожидает обработки
  logger.debug(`[Queue Events] Job (ID: ${jobId}) is waiting in the queue.`);
});
// -----------------------------------------------------------

logger.info('Data Worker instance created and listeners attached.');

// Экспортируем сам воркер, если он нужен где-то еще (хотя обычно достаточно импорта файла)
export { worker as dataWorker };

// Экспортируем типы задач для использования в контроллере
export type { FetchCandlesJobData, FetchPairsJobData }; 