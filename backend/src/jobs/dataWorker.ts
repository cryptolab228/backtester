import { Job } from 'bullmq';
import logger from '@/utils/logger';
import { createWorker, DATA_QUEUE_NAME, dataQueue } from '@/config/queue';
import * as okxService from '@/services/okxService';
import { dataService } from '@/services/dataService';

// Интерфейсы для данных задач
interface FetchPairsJobData {}

interface FetchCandlesJobData {
  symbol: string;
  timeframe: string;
  startTime?: number;
  endTime?: number;
  limit?: number;
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
worker.on('active', (job: Job) => {
  logger.debug(`[Queue Events] Job ${job.name} (ID: ${job.id}) is active.`);
});

worker.on('completed', (job: Job, result: any) => {
  // Используем logger.info для успешного завершения
  logger.info(`[Queue Events] Job ${job.name} (ID: ${job.id}) completed successfully.`);
  // Старый debug лог можно оставить, если он полезен
  logger.debug(`Job ${job.name} (ID: ${job.id}) completed.`);
});

worker.on('failed', (job: Job | undefined, error: Error) => {
  if (job) {
    logger.error(`[Queue Events] Job ${job.name} (ID: ${job.id}) failed:`, error);
  } else {
    // Это может произойти, если ошибка случилась до того, как job стал доступен
    logger.error(`[Queue Events] A job failed (job data unavailable):`, error);
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