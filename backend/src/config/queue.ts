import { Queue, Worker, Job, JobScheduler, JobType } from 'bullmq';
import IORedis from 'ioredis';
import config from './index';
import logger from '@/utils/logger';
import { broadcast } from '@/websocket';

// Создаем подключение к Redis, которое будут использовать все очереди и воркеры
const connection = new IORedis({
  host: config.redis.host,
  port: config.redis.port,
  maxRetriesPerRequest: null, // Отключаем встроенные ретраи IORedis
});

connection.on('connect', () => {
  logger.info('Connected to Redis for BullMQ.');
});

connection.on('error', (err) => {
  logger.error('Redis connection error for BullMQ:', err);
});

// Имена очередей
export const DATA_QUEUE_NAME = 'data-processing';

// Функция для создания инстанса очереди
export const createQueue = (queueName: string) => {
  return new Queue(queueName, {
    connection,
    defaultJobOptions: {
      attempts: 3, // Количество попыток выполнения задачи
      backoff: {   // Стратегия повторного выполнения при ошибке
        type: 'exponential',
        delay: 5000, // Задержка 5 секунд перед первой попыткой
      },
      removeOnComplete: false, // Явно указываем сохранять завершенные задачи
      removeOnFail: 1000 // Хранить 1000 последних неудачных задач
    }
  });
};

// Функция для создания инстанса воркера
export const createWorker = <T = any, R = any>(queueName: string, processor: (job: Job<T>) => Promise<R>) => {
  return new Worker<T, R>(queueName, processor, {
    connection,
    concurrency: 3, // Увеличиваем с 1 до 3 для лучшей производительности
  });
};

// Создаем планировщик для обработки отложенных и повторяющихся задач
// (Нужен только один на приложение)
export const initializeScheduler = (queueName: string) => {
  const scheduler = new JobScheduler(queueName, { connection });
  logger.info(`BullMQ Job Scheduler initialized for ${queueName}.`);
  return scheduler;
};

// Экспортируем готовый инстанс очереди данных
export const dataQueue = createQueue(DATA_QUEUE_NAME);

// Инициализируем и экспортируем планировщик для основной очереди данных
export const dataQueueScheduler = initializeScheduler(DATA_QUEUE_NAME);

// --- Helper для отправки счетчиков --- 
const validJobTypesForCounts: JobType[] = ['active', 'wait', 'waiting', 'completed', 'failed', 'delayed', 'paused', 'prioritized'];

export const broadcastJobCounts = async () => {
  try {
    const counts = await dataQueue.getJobCounts(...validJobTypesForCounts);
    const sanitizedCounts: { [key: string]: number } = {};
    validJobTypesForCounts.forEach(status => {
      sanitizedCounts[status] = 0;
    });
    for (const status in counts) {
      if (Object.prototype.hasOwnProperty.call(counts, status)) {
          sanitizedCounts[status as JobType] = counts[status as keyof typeof counts] || 0;
      }
    }
    // Объединяем wait и waiting для фронтенда, если нужно
    if (sanitizedCounts.wait !== undefined) {
        sanitizedCounts.waiting = (sanitizedCounts.waiting || 0) + sanitizedCounts.wait;
        // delete sanitizedCounts.wait; // Опционально: удалить wait после объединения
    }

    broadcast({ type: 'job_counts_updated', counts: sanitizedCounts });
  } catch (error: any) {
    logger.error('[QueueEvents] Error fetching or broadcasting job counts:', error);
  }
};
// ------------------------------------

// --- Слушатели событий dataQueue --- 
const listenerLogger = logger.child({ module: 'BullMQEvents' });

// --->>> ВАЖНО: Убедимся, что слушатели добавляются только ОДИН РАЗ <<<---
// Простой флаг для предотвращения повторного добавления слушателей
let listenersAttached = false;

export const attachQueueEventListeners = () => {
  if (listenersAttached) {
    listenerLogger.warn('Attempted to attach BullMQ event listeners more than once. Skipping.');
    return;
  }

  listenerLogger.info('Attaching BullMQ event listeners...');

  // --- Оставляем слушатели, относящиеся к ОЧЕРЕДИ --- 
  (dataQueue as any).on('error', (error: Error) => {
    listenerLogger.error(`Queue ${dataQueue.name} error:`, error);
  });
  
  (dataQueue as any).on('waiting', async (jobOrId: string | { id: string }) => {
      let jobId: string | undefined;
      if (typeof jobOrId === 'string') {
          jobId = jobOrId;
      } else if (typeof jobOrId === 'object' && jobOrId !== null && typeof jobOrId.id === 'string') {
          jobId = jobOrId.id;
      } else {
          listenerLogger.warn('Received [waiting] event with invalid argument:', jobOrId);
          return;
      }
  
      listenerLogger.debug(`Job ${jobId} is [waiting] in queue ${dataQueue.name}.`);
      try {
        const job = await dataQueue.getJob(jobId);
        if (job) {
            const jobDataToSend = {
                type: 'job_updated',
                jobId: job.id,
                name: job.name || 'Unknown',
                status: 'waiting',
                timestamp: job.timestamp ? new Date(job.timestamp).toISOString() : new Date().toISOString(),
                data: job.data || {},
                opts: job.opts || {}, // Добавим opts, если они нужны фронтенду
                attemptsMade: job.attemptsMade || 0,
                processedOn: job.processedOn ? new Date(job.processedOn).toISOString() : null,
                finishedOn: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
                failedReason: job.failedReason || null,
                progress: job.progress || 0
            };
            listenerLogger.debug(`[waiting] Broadcasting update for job ${jobId}. Data: ${JSON.stringify(jobDataToSend)}`);
            broadcast(jobDataToSend);
        } else {
            listenerLogger.warn(`[waiting] Could not find job ${jobId} via getJob after waiting event. Broadcasting minimal info.`);
            broadcast({
                type: 'job_updated', 
                jobId: jobId,
                status: 'waiting',
                name: 'Pending Info',
                timestamp: new Date().toISOString(),
                data: {},
                opts: {},
                attemptsMade: 0,
                processedOn: null,
                finishedOn: null,
                failedReason: null,
                progress: 0
            });
        }
        await broadcastJobCounts();
      } catch (error: any) {
          listenerLogger.error(`[waiting] Error processing event for job ${jobId}:`, error);
      }
  });

  // --- Оставляем слушатели статуса самой очереди и очистки --- 
  (dataQueue as any).on('paused', async () => {
      listenerLogger.info(`Queue ${dataQueue.name} is [paused].`);
      broadcast({ type: 'queue_status_updated', isPaused: true });
      await broadcastJobCounts();
  });
  
  (dataQueue as any).on('resumed', async () => {
      listenerLogger.info(`Queue ${dataQueue.name} is [resumed].`);
      broadcast({ type: 'queue_status_updated', isPaused: false });
      await broadcastJobCounts();
  });
  
  (dataQueue as any).on('cleaned', async (jobs: string[], type: string) => {
      listenerLogger.info(`[cleaned] ${jobs.length} ${type} jobs from queue ${dataQueue.name}. Jobs: ${jobs.join(', ')}`);
      broadcast({ type: 'jobs_cleaned', jobIds: jobs, cleanType: type });
      await broadcastJobCounts();
  });
  
  (dataQueue as any).on('removed', async (job: any) => {
      if (!job || typeof job.id !== 'string') {
          listenerLogger.warn('[removed] Received event with invalid job object:', job);
          return;
      }
      const jobId = job.id;
      listenerLogger.debug(`Job ${jobId} was [removed] from queue ${dataQueue.name}.`);
      broadcast({ type: 'job_removed', jobId: jobId });
      await broadcastJobCounts();
  });
  
  (dataQueue as any).on('delayed', async (jobId: any) => {
      if (typeof jobId !== 'string') {
          listenerLogger.warn(`[delayed] Received event with invalid jobId type: ${typeof jobId}`);
          return;
      }
      listenerLogger.debug(`Job ${jobId} was [delayed] in queue ${dataQueue.name}.`);
      try {
          const job = await dataQueue.getJob(jobId);
          if (job) {
              const isUserPaused = job.data?.isUserPaused === true; // Проверяем флаг паузы
              const status = isUserPaused ? 'paused' : 'delayed'; // Устанавливаем статус для фронта
              listenerLogger.info(`[delayed/paused] Broadcasting update for job ${jobId} with status: ${status} (isUserPaused: ${isUserPaused})`);
              const jobDataToSend = {
                  type: 'job_updated',
                  jobId: job.id,
                  name: job.name,
                  status: status,
                  timestamp: job.timestamp ? new Date(job.timestamp).toISOString() : null,
                  processedOn: job.processedOn ? new Date(job.processedOn).toISOString() : null,
                  finishedOn: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
                  failedReason: job.failedReason,
                  data: job.data,
                  opts: job.opts,
                  attemptsMade: job.attemptsMade
              };
              listenerLogger.debug(`[delayed/paused] Broadcasting update data: ${JSON.stringify(jobDataToSend)}`);
              broadcast(jobDataToSend);
          } else {
              listenerLogger.warn(`[delayed] Could not find job ${jobId} after delayed event.`);
          }
          await broadcastJobCounts();
      } catch (error: any) {
          listenerLogger.error(`[delayed] Error processing event for job ${jobId}:`, error);
      }
  });

  listenersAttached = true; // Устанавливаем флаг после успешного добавления
  listenerLogger.info('BullMQ event listeners attached successfully.');
};

// --->>> Вызываем функцию для добавления слушателей <<<---
// Это нужно вызывать один раз при инициализации приложения
// attachQueueEventListeners(); 
// ПРИМЕЧАНИЕ: Убедитесь, что эта функция вызывается где-то в вашем основном файле приложения (например, app.ts) ПОСЛЕ инициализации dataQueue.

// Удалены дублирующиеся обработчики событий, которые были внизу файла 