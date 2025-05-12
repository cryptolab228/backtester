import { Queue, Worker, Job, JobScheduler } from 'bullmq';
import IORedis from 'ioredis';
import config from './index';
import logger from '@/utils/logger';

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
    concurrency: 1 // <-- Устанавливаем конкурентность в 1
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

// Добавляем слушателей событий для dataQueue
dataQueue.on('error', (error: Error) => {
  logger.error(`[BullMQ DataQueue EVENT:error] Queue ${dataQueue.name}`, error);
});
dataQueue.on('waiting', (jobId: string) => {
  logger.debug(`[BullMQ DataQueue EVENT:waiting] Job ${jobId} is waiting in queue ${dataQueue.name}.`);
});

/* // Закомментируем проблемные слушатели для Docker сборки
dataQueue.on('active', (job: BullMQ.Job<any, any, string>) => {
  logger.info(`[BullMQ DataQueue EVENT:active] Job ${job.id} is active in queue ${dataQueue.name}.`);
});
dataQueue.on('stalled', (job: BullMQ.Job<any, any, string>) => {
  logger.warn(`[BullMQ DataQueue EVENT:stalled] Job ${job.id} has stalled in queue ${dataQueue.name}.`);
});
*/
dataQueue.on('progress', (job: Job<any, any, string>, progress: any) => {
  logger.debug(`[BullMQ DataQueue EVENT:progress] Job ${job.id} in queue ${dataQueue.name} progress ${typeof progress === 'object' ? JSON.stringify(progress) : progress}.`);
});
/* // Закомментируем проблемные слушатели для Docker сборки
dataQueue.on('completed', (job: BullMQ.Job<any, any, string>, result: any) => {
  logger.info(`[BullMQ DataQueue EVENT:completed] Job ${job.id} in queue ${dataQueue.name} completed.`);
});
dataQueue.on('failed', (job: BullMQ.Job<any, any, string> | undefined, err: Error) => {
  logger.error(`[BullMQ DataQueue EVENT:failed] Job ${job?.id || 'unknown'} in queue ${dataQueue.name} failed with error: ${err.message}`, { stack: err.stack, jobName: job?.name, jobData: job?.data });
});
*/
dataQueue.on('paused', () => {
  logger.info(`[BullMQ DataQueue EVENT:paused] Queue ${dataQueue.name} is paused.`);
});
dataQueue.on('resumed', () => {
  logger.info(`[BullMQ DataQueue EVENT:resumed] Queue ${dataQueue.name} is resumed.`);
});
dataQueue.on('cleaned', (jobs: string[], type: string) => {
  logger.info(`[BullMQ DataQueue EVENT:cleaned] Cleaned ${jobs.length} ${type} jobs from queue ${dataQueue.name}. Jobs: ${jobs.join(', ')}`);
});
/* // Закомментируем проблемные слушатели для Docker сборки
dataQueue.on('drained', () => {
  logger.info(`[BullMQ DataQueue EVENT:drained] Queue ${dataQueue.name} is drained.`);
});
*/
dataQueue.on('removed', (job: Job<any, any, string>) => {
  logger.debug(`[BullMQ DataQueue EVENT:removed] Job ${job.id} removed from queue ${dataQueue.name}.`);
}); 