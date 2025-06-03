import { Request, Response } from 'express';
import { dataQueue } from '@/config/queue';
import { JOB_TYPES } from '@/jobs/dataWorker';
import logger from '@/utils/logger';
import { Job, JobType } from 'bullmq';
import { dataService } from '@/services/dataService';
import path from 'path';
import fs from 'fs';
import { getPortfolioResultsFilePath } from '@/utils/paths';

// --- Вынесенная логика для получения данных об очередях --- 

/**
 * Получает и форматирует счетчики задач из очереди.
 * @returns {Promise<{ [key: string]: number }>} Объект со счетчиками задач.
 */
export const getSanitizedJobCounts = async (): Promise<{ [key: string]: number }> => {
  logger.debug('[DataLogic][getSanitizedJobCounts] Fetching job counts...');
  const jobTypesForCounts: JobType[] = ['active', 'wait', 'waiting', 'completed', 'failed', 'delayed', 'paused', 'prioritized'];
  const counts = await dataQueue.getJobCounts(...jobTypesForCounts);
  logger.debug(`[DataLogic][getSanitizedJobCounts] Raw counts from BullMQ: ${JSON.stringify(counts)}`);

  const sanitizedCounts: { [key: string]: number } = {};
  jobTypesForCounts.forEach(status => {
    sanitizedCounts[status] = 0;
  });
  for (const status in counts) {
    if (Object.prototype.hasOwnProperty.call(counts, status)) {
        sanitizedCounts[status as JobType] = counts[status as keyof typeof counts] || 0;
    }
  }

  // Объединение wait и waiting для консистентности, если нужно
  if (sanitizedCounts.wait !== undefined) {
      sanitizedCounts.waiting = (sanitizedCounts.waiting || 0) + sanitizedCounts.wait;
      // delete sanitizedCounts.wait; // Можно раскомментировать, если 'wait' не нужен отдельно
  }

  logger.debug(`[DataLogic][getSanitizedJobCounts] Returning sanitized counts: ${JSON.stringify(sanitizedCounts)}`);
  return sanitizedCounts;
};

/**
 * Получает список задач с отформатированными данными.
 * @param {object} [options] Опции для получения задач.
 * @param {JobType[]} [options.status] Массив статусов для фильтрации.
 * @param {number} [options.start=0] Начальный индекс.
 * @param {number} [options.end=-1] Конечный индекс.
 * @returns {Promise<any[]>} Массив отформатированных задач.
 */
export const getJobsWithSanitizedData = async (options?: {
  status?: JobType[];
  start?: number;
  end?: number;
}): Promise<any[]> => {
  const { status, start = 0, end = -1 } = options || {};
  logger.debug(`[DataLogic][getJobsWithSanitizedData] Fetching jobs with options: status=${JSON.stringify(status)}, start=${start}, end=${end}`);

  const validJobTypes: JobType[] = ['active', 'wait', 'waiting', 'completed', 'failed', 'delayed', 'paused', 'prioritized'];
  let typesToFetch: JobType[] = [];

  if (status && Array.isArray(status)) {
      typesToFetch = status.filter(t => validJobTypes.includes(t));
  } else {
      typesToFetch = [...validJobTypes]; // По умолчанию получаем все типы
      logger.debug(`[DataLogic][getJobsWithSanitizedData] No specific status requested. Fetching all valid types by default.`);
  }
  
  logger.debug(`[DataLogic][getJobsWithSanitizedData] Types to fetch from BullMQ: ${JSON.stringify(typesToFetch)}`);

  if (typesToFetch.length === 0 && status && Array.isArray(status)) {
    logger.warn(`[DataLogic][getJobsWithSanitizedData] No valid job types to fetch after filtering requested statuses: ${JSON.stringify(status)}. Returning empty array.`);
    return [];
  }
  if (typesToFetch.length === 0 && !status) {
      logger.error(`[DataLogic][getJobsWithSanitizedData] Catastrophic: typesToFetch is empty even when requesting all types. Check 'validJobTypes'. Returning empty array.`);
      return [];
  }

  const jobs = await dataQueue.getJobs(typesToFetch, Number(start), Number(end));
  logger.debug(`[DataLogic][getJobsWithSanitizedData] Fetched ${jobs.length} jobs from queue with types: ${JSON.stringify(typesToFetch)}`);

  // Используем Promise.all для параллельного получения статуса
  const jobsWithDetails = await Promise.all(jobs.map(async (job: Job) => {
    try {
      const jobStatus = await job.getState();
      return {
        id: job.id,
        name: job.name,
        data: job.data,
        progress: job.progress,
        attemptsMade: job.attemptsMade,
        failedReason: job.failedReason,
        timestamp: job.timestamp ? new Date(job.timestamp).toISOString() : null,
        finishedOn: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
        processedOn: job.processedOn ? new Date(job.processedOn).toISOString() : null,
        status: jobStatus
      };
    } catch (jobError: any) {
        logger.error(`[DataLogic][getJobsWithSanitizedData] Error processing job ${job?.id || 'UNKNOWN'}: ${jobError.message}`, { stack: jobError.stack });
        // Возвращаем базовую информацию об ошибке или null/пустой объект, чтобы не прерывать весь Promise.all
        return { id: job?.id, name: job?.name, status: 'unknown', error: 'Failed to process job details' }; 
    }
  }));
  
  // Отфильтруем возможные ошибки, если возвращали не null
  const validJobs = jobsWithDetails.filter(job => job && job.status !== 'unknown');
  logger.debug(`[DataLogic][getJobsWithSanitizedData] Returning ${validJobs.length} sanitized jobs.`);
  return validJobs;
};

// --- Класс контроллера --- 

class DataController {
  /**
   * Добавляет задачу на получение списка всех фьючерсных пар.
   */
  async triggerFetchPairs(req: Request, res: Response): Promise<void> {
    try {
      logger.info(`[Controller] Attempting to add job ${JOB_TYPES.FETCH_PAIRS}...`);
      const job = await dataQueue.add(JOB_TYPES.FETCH_PAIRS, {});
      logger.info(`[Controller] dataQueue.add call completed for ${JOB_TYPES.FETCH_PAIRS}. Returned job object: ${JSON.stringify(job)}`);

      if (job && job.id) {
        logger.info(`[Controller] Successfully added job ${JOB_TYPES.FETCH_PAIRS} with ID: ${job.id} to the queue.`);
        res.status(202).json({ message: 'Fetch pairs job added to the queue.', jobId: job.id });
      } else {
        logger.error(`[Controller] dataQueue.add for ${JOB_TYPES.FETCH_PAIRS} returned an unexpected result. Job object: ${JSON.stringify(job)}`);
        res.status(500).json({ message: 'Failed to add fetch pairs job due to unexpected queue response.' });
      }
    } catch (error: any) {
      logger.error(`[Controller] Error during dataQueue.add or response sending for ${JOB_TYPES.FETCH_PAIRS}: ${error.message}`, { stack: error.stack });
      if (!res.headersSent) {
        res.status(500).json({ message: 'Failed to add fetch pairs job', error: error.message });
      }
    }
  }

  /**
   * Добавляет задачу на получение исторических свечей.
   * Принимает параметры из тела запроса: symbol, timeframes (массив строк), startTime?, endTime?, limit?
   */
  async triggerFetchCandles(req: Request, res: Response): Promise<void> {
    logger.info(`[Controller] Received request to fetch candles. Body: ${JSON.stringify(req.body)}`);
    const { symbol, timeframes, startTime, endTime, limit } = req.body;

    if (!symbol || !timeframes || !Array.isArray(timeframes) || timeframes.length === 0) {
      res.status(400).json({ message: 'Missing or invalid required parameters: symbol (string) and timeframes (non-empty array of strings).' });
      return;
    }

    const jobPromises: Promise<Job<any, any, string>>[] = [];
    const createdJobIds: string[] = [];

    for (const timeframe of timeframes) {
      if (typeof timeframe !== 'string' || timeframe.trim() === '') {
        logger.warn(`[Controller] Invalid timeframe value "${timeframe}" for symbol ${symbol}. Skipping.`);
        continue; 
      }

      const jobData = {
        symbol,
        timeframe: timeframe.trim(),
        startTime: startTime ? parseInt(startTime, 10) : undefined,
        endTime: endTime ? parseInt(endTime, 10) : undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
      };

      try {
        logger.info(`[Controller] Attempting to add job ${JOB_TYPES.FETCH_CANDLES} for ${symbol} (${jobData.timeframe}) with data: ${JSON.stringify(jobData)}.`);
        const jobPromise = dataQueue.add(JOB_TYPES.FETCH_CANDLES, jobData);
        jobPromises.push(jobPromise);
      } catch (error: any) {
        logger.error(`[Controller] Error synchronously adding job ${JOB_TYPES.FETCH_CANDLES} for ${symbol} (${jobData.timeframe}): ${error.message}`, { stack: error.stack, jobData });
      }
    }

    if (jobPromises.length === 0 && timeframes.length > 0) {
        logger.warn(`[Controller] No valid timeframes provided for symbol ${symbol} after filtering. Request body: ${JSON.stringify(req.body)}`);
        res.status(400).json({ message: 'No valid timeframes provided to process.' });
        return;
    }
    if (jobPromises.length === 0 && timeframes.length === 0) {
        res.status(400).json({ message: 'Timeframes array was empty.'});
        return;
    }

    try {
      const settledJobs = await Promise.allSettled(jobPromises);
      let allJobsSuccessfullyQueued = true;

      settledJobs.forEach((result, index) => {
        const currentTf = timeframes[index];
        if (result.status === 'fulfilled') {
          const job = result.value;
          if (job && job.id) {
            createdJobIds.push(job.id);
            logger.info(`[Controller] Successfully added job ${JOB_TYPES.FETCH_CANDLES} for ${symbol} (${currentTf}) with ID: ${job.id} to the queue.`);
          } else {
            allJobsSuccessfullyQueued = false;
            logger.error(`[Controller] dataQueue.add for ${symbol} (${currentTf}) returned an unexpected result (no job or no job.id). Job object: ${JSON.stringify(job)}`);
          }
        } else {
          allJobsSuccessfullyQueued = false;
          logger.error(`[Controller] Failed to add job ${JOB_TYPES.FETCH_CANDLES} for ${symbol} (${currentTf}): ${result.reason.message}`, { stack: result.reason.stack });
        }
      });

      if (createdJobIds.length > 0) {
        const message = `Successfully added ${createdJobIds.length} fetch candles job(s) to the queue.` +
                        (allJobsSuccessfullyQueued ? '' : ` Some jobs may have failed to queue (Total attempted: ${jobPromises.length}). Check logs.`);
        res.status(202).json({ 
            message,
            jobIds: createdJobIds,
            totalAttempted: jobPromises.length,
            totalSuccessfullyQueued: createdJobIds.length
        });
      } else {
        logger.error(`[Controller] Failed to queue any fetch candles jobs for symbol ${symbol} with timeframes [${timeframes.join(', ')}]`);
        res.status(500).json({ message: 'Failed to add any fetch candles jobs to the queue. Check server logs.' });
      }

    } catch (error: any) {
      logger.error(`[Controller] General error during queuing multiple fetch candles jobs for ${symbol}: ${error.message}`, { stack: error.stack });
      if (!res.headersSent) {
        res.status(500).json({ message: 'General error processing fetch candles jobs', error: error.message });
      }
    }
  }

  // --- Методы для управления очередью ---

  async getQueueJobCounts(req: Request, res: Response): Promise<void> {
    logger.debug('[Controller][getJobCounts] Received HTTP request to get job counts.');
    try {
      const sanitizedCounts = await getSanitizedJobCounts(); // Используем вынесенную функцию
      logger.info(`[Controller][getJobCounts] Sending sanitized counts via HTTP: ${JSON.stringify(sanitizedCounts)}`);
      res.status(200).json(sanitizedCounts);
    } catch (error: any) {
      logger.error('[Controller][getJobCounts] Error getting/sending job counts via HTTP:', { message: error.message, stack: error.stack });
      res.status(500).json({ message: 'Error fetching job counts' });
    }
  }

  async getJobs(req: Request, res: Response): Promise<void> {
    const { status, start = 0, end = -1 } = req.query;
    logger.debug(`[Controller][getJobs] Received HTTP request with query: status=${JSON.stringify(status)}, start=${start}, end=${end}`);

    try {
      // Преобразуем статус запроса в массив JobType[] для вынесенной функции
      let statusFilter: JobType[] | undefined = undefined;
      const validJobTypes: JobType[] = ['active', 'wait', 'waiting', 'completed', 'failed', 'delayed', 'paused', 'prioritized'];
      if (status && typeof status === 'string' && status.toLowerCase() !== 'all') {
          const requestedTypes = Array.isArray(status) ? status as string[] : [status as string];
          statusFilter = requestedTypes.filter(t => validJobTypes.includes(t as JobType)) as JobType[];
          if (statusFilter.length === 0) {
              logger.warn(`[Controller][getJobs] No valid job types found in HTTP request status filter: ${JSON.stringify(status)}. Returning empty array.`);
              res.status(200).json([]);
              return;
          }
      } // Если status не задан или 'all', statusFilter остается undefined, и getJobsWithSanitizedData вернет все типы
       else if (status && typeof status !== 'string') { // Handle invalid status type
          logger.warn(`[Controller][getJobs] Invalid status type in HTTP request: ${typeof status}. Ignoring status filter.`);
      }

      const jobsWithDetails = await getJobsWithSanitizedData({ 
        status: statusFilter, 
        start: Number(start), 
        end: Number(end) 
      });
      logger.debug(`[Controller][getJobs] Sending ${jobsWithDetails.length} jobs via HTTP.`);
      res.status(200).json(jobsWithDetails);
    } catch (error: any) {
      logger.error('[Controller][getJobs] Error fetching/sending jobs via HTTP:', { 
        message: error.message, 
        stack: error.stack,
        query: req.query 
      });
      res.status(500).json({ message: 'Error fetching jobs' });
    }
  }

  async getJobDetails(req: Request, res: Response): Promise<void> {
    const { jobId } = req.params;
    try {
      logger.debug(`[Controller] Attempting to fetch details for job ${jobId}`);
      const job = await dataQueue.getJob(jobId);
      if (job) {
        const jobStatus = await job.getState();
        const jobJson = job.toJSON();
        jobJson.status = jobStatus; 
        logger.debug(`[Controller] Fetched details for job ${jobId}:`, jobJson);
        res.status(200).json(jobJson);
      } else {
        logger.warn(`[Controller] Job ${jobId} not found for details.`);
        res.status(404).json({ message: 'Job not found' });
      }
    } catch (error: any) {
      logger.error(`[Controller] Error fetching details for job ${jobId}:`, error);
      res.status(500).json({ message: 'Failed to fetch job details', error: error.message });
    }
  }

  async removeJob(req: Request, res: Response): Promise<void> {
    const { jobId } = req.params;
    try {
      const job = await dataQueue.getJob(jobId);
      if (job) {
        await job.remove();
        logger.info(`[Controller] Job ${jobId} removed successfully.`);
        res.status(200).json({ message: `Job ${jobId} removed successfully.` });
      } else {
        logger.warn(`[Controller] Attempted to remove non-existent job ${jobId}.`);
        res.status(404).json({ message: 'Job not found, cannot remove.' });
      }
    } catch (error: any) {
      logger.error(`[Controller] Error removing job ${jobId}:`, error);
      res.status(500).json({ message: 'Failed to remove job', error: error.message });
    }
  }

  async retryJob(req: Request, res: Response): Promise<void> {
    const { jobId } = req.params;
    try {
      const job = await dataQueue.getJob(jobId);
      if (job) {
        if (await job.isFailed()) {
          await job.retry();
          logger.info(`[Controller] Job ${jobId} marked for retry.`);
          res.status(200).json({ message: `Job ${jobId} marked for retry.` });
        } else {
          logger.warn(`[Controller] Job ${jobId} is not in a failed state, cannot retry.`);
          res.status(400).json({ message: 'Job is not in a failed state.' });
        }
      } else {
        logger.warn(`[Controller] Job ${jobId} not found for retry.`);
        res.status(404).json({ message: 'Job not found, cannot retry.' });
      }
    } catch (error: any) {
      logger.error(`[Controller] Error retrying job ${jobId}:`, error);
      res.status(500).json({ message: 'Failed to retry job', error: error.message });
    }
  }

  async getAllTradingPairs(req: Request, res: Response): Promise<void> {
    logger.info('[DataController] Received request to get all trading pairs.');
    try {
      const pairs = await dataService.getAllTradingPairs();
      res.status(200).json(pairs);
    } catch (error: any) {
      logger.error('[DataController] Error fetching all trading pairs:', error);
      res.status(500).json({ message: 'Error fetching trading pairs', error: error.message });
    }
  }

  // Method to pause a job (using data flag)
  async pauseJob(req: Request, res: Response): Promise<void> {
    const jobId = req.params.jobId;
    logger.debug(`[Controller][pauseJob] Attempting to pause job with ID: ${jobId} by setting data flag.`);
    try {
      const job = await dataQueue.getJob(jobId);
      if (!job) {
        logger.warn(`[Controller][pauseJob] Job not found: ${jobId}`);
        res.status(404).json({ message: 'Job not found' });
        return;
      }

      const currentState = await job.getState();
      logger.debug(`[Controller][pauseJob] Current state for job ${jobId}: ${currentState}`);

      // Разрешаем паузу для разных состояний, не только waiting/wait
      const pausableStates = ['waiting', 'wait', 'active', 'delayed'];
      if (!pausableStates.includes(currentState)) {
        logger.warn(`[Controller][pauseJob] Job ${jobId} cannot be paused from state: ${currentState}. Allowed states: ${pausableStates.join(', ')}`);
        res.status(400).json({ 
          message: `Job cannot be paused from state: ${currentState}. Allowed states: ${pausableStates.join(', ')}`,
          currentState 
        });
        return;
      }

      // Добавляем флаг в данные
      const currentData = job.data || {};
      currentData.isUserPaused = true;

      logger.debug(`[Controller][pauseJob] Updating job ${jobId} data with isUserPaused=true:`, currentData);
      await (job as any).update(currentData); // Используем as any для update

      // Проверяем финальное состояние
      const finalState = await job.getState();
      const finalData = await job.data;

      logger.info(`[Controller][pauseJob] Job ${jobId} marked as paused via data flag. State: ${currentState} -> ${finalState}`);
      res.status(200).json({ 
        message: 'Job marked as paused. It will be skipped by the worker.', 
        previousState: currentState,
        finalState: finalState,
        jobData: finalData
      });
    } catch (error: any) {
      logger.error(`[Controller][pauseJob] Error marking job ${jobId} as paused:`, error);
      res.status(500).json({ message: error.message || 'Internal server error while marking job as paused' });
    }
  }

  // Method to resume a job (using data flag)
  async resumeJob(req: Request, res: Response): Promise<void> {
    const jobId = req.params.jobId;
    logger.debug(`[Controller][resumeJob] Attempting to resume job with ID: ${jobId} by removing data flag.`);
    try {
      const job = await dataQueue.getJob(jobId);
      if (!job) {
        logger.warn(`[Controller][resumeJob] Job not found: ${jobId}`);
        res.status(404).json({ message: 'Job not found' });
        return;
      }

      const currentState = await job.getState();
      logger.debug(`[Controller][resumeJob] Current state for job ${jobId}: ${currentState}`);
      const currentData = job.data || {};
      logger.debug(`[Controller][resumeJob] Current data for job ${jobId}:`, currentData);

      // Проверяем, был ли установлен флаг
      if (currentData.isUserPaused !== true) {
          logger.warn(`[Controller][resumeJob] Job ${jobId} was not marked as paused via data flag. Current isUserPaused value: ${currentData.isUserPaused}`);
          res.status(200).json({ 
            message: 'Job was not paused via data flag.', 
            currentState,
            isUserPaused: currentData.isUserPaused 
          });
          return;
      }

      // Удаляем флаг (или устанавливаем в false)
      delete currentData.isUserPaused; 
      logger.debug(`[Controller][resumeJob] Updating job ${jobId} data to remove isUserPaused flag:`, currentData);
      await (job as any).update(currentData); // Используем as any для update
      
      // Если задача была переведена воркером в delayed, попытаемся ее продвинуть
      if (currentState === 'delayed') { 
          try {
              logger.info(`[Controller][resumeJob] Job ${jobId} is in delayed state, attempting to promote.`);
              await (job as any).promote(); // Используем as any для promote
              logger.info(`[Controller][resumeJob] Job ${jobId} promoted successfully from delayed to waiting.`);
              
              // Проверяем новое состояние после promote
              const newState = await job.getState();
              logger.info(`[Controller][resumeJob] Job ${jobId} new state after promote: ${newState}`);
          } catch (promoteError: any) {
              // Логируем ошибку, но не прерываем основной ответ, так как флаг снят
              logger.error(`[Controller][resumeJob] Failed to promote job ${jobId} after removing pause flag:`, promoteError);
          }
      } else {
          logger.info(`[Controller][resumeJob] Job ${jobId} is in state '${currentState}', no promotion needed.`);
      }

      // Финальная проверка состояния
      const finalState = await job.getState();
      const finalData = await job.data;
      
      logger.info(`[Controller][resumeJob] Job ${jobId} resumed via data flag. Final state: ${finalState}`);
      res.status(200).json({ 
        message: 'Job resumed successfully (pause flag removed).', 
        previousState: currentState,
        finalState: finalState,
        jobData: finalData
      });
    } catch (error: any) {
      logger.error(`[Controller][resumeJob] Error resuming job ${jobId}:`, error);
      res.status(500).json({ message: error.message || 'Internal server error while resuming job' });
    }
  }

  async downloadPortfolioResults(req: Request, res: Response): Promise<void> {
    try {
      const filename = req.params.filename;
      const filepath = getPortfolioResultsFilePath(filename);
      
      logger.info(`[Downloads] Download request for file: ${filename}`);
      logger.debug(`[Downloads] Resolved filepath: ${filepath}`);
      
      // Проверяем, что файл существует
      if (!fs.existsSync(filepath)) {
        logger.warn(`[Downloads] File not found: ${filepath}`);
        res.status(404).json({ error: 'File not found' });
        return;
      }
      
      // Проверяем размер файла
      const stats = fs.statSync(filepath);
      logger.info(`[Downloads] Serving file: ${filename}, size: ${stats.size} bytes (${(stats.size / 1024 / 1024).toFixed(2)}MB)`);
      
      // Устанавливаем правильные заголовки для скачивания больших файлов
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Disposition');
      res.setHeader('Content-Length', stats.size.toString());
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Accept-Ranges', 'bytes'); // Поддержка возобновляемых загрузок
      
      // Обрабатываем Range запросы для поддержки возобновляемых загрузок
      const range = req.headers.range;
      if (range) {
        logger.info(`[Downloads] Range request for ${filename}: ${range}`);
        
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
        const chunksize = (end - start) + 1;
        
        res.status(206); // Partial Content
        res.setHeader('Content-Range', `bytes ${start}-${end}/${stats.size}`);
        res.setHeader('Content-Length', chunksize.toString());
        
        const stream = fs.createReadStream(filepath, { start, end });
        stream.pipe(res);
        
        stream.on('error', (err) => {
          logger.error(`[Downloads] Stream error for ${filename}:`, err);
          if (!res.headersSent) {
            res.status(500).json({ error: 'Error streaming file' });
          }
        });
        
        stream.on('end', () => {
          logger.info(`[Downloads] Range request completed for ${filename}: ${start}-${end}`);
        });
        
      } else {
        // Обычная загрузка полного файла через stream для больших файлов
        const stream = fs.createReadStream(filepath);
        
        stream.on('error', (err) => {
          logger.error(`[Downloads] Stream error for ${filename}:`, err);
          if (!res.headersSent) {
            res.status(500).json({ error: 'Error streaming file' });
          }
        });
        
        stream.on('end', () => {
          logger.info(`[Downloads] Successfully streamed file: ${filename}`);
        });
        
        stream.on('close', () => {
          logger.debug(`[Downloads] Stream closed for: ${filename}`);
        });
        
        // Устанавливаем обработчики ошибок для response
        res.on('error', (err) => {
          logger.error(`[Downloads] Response error for ${filename}:`, err);
        });
        
        res.on('close', () => {
          logger.debug(`[Downloads] Response closed for: ${filename}`);
          stream.destroy(); // Закрываем stream при закрытии response
        });
        
        // Pipe stream в response
        stream.pipe(res);
      }
      
    } catch (error: any) {
      logger.error(`[Downloads] Error in download route:`, error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }

  /**
   * Получает исторические данные свечей напрямую из базы данных.
   */
  async getHistoricalCandles(req: Request, res: Response): Promise<void> {
    try {
      logger.info(`[Controller] Received request for historical candles: ${JSON.stringify(req.body)}`);
      
      const { symbol, timeframe, startTime, endTime, limit = 1000 } = req.body;

      // Валидация входных параметров
      if (!symbol || typeof symbol !== 'string') {
        res.status(400).json({ 
          success: false, 
          message: 'Missing or invalid symbol parameter' 
        });
        return;
      }

      if (!timeframe || typeof timeframe !== 'string') {
        res.status(400).json({ 
          success: false, 
          message: 'Missing or invalid timeframe parameter' 
        });
        return;
      }

      // Проверяем валидность временных параметров
      const start = startTime ? new Date(startTime) : null;
      const end = endTime ? new Date(endTime) : null;
      
      if (startTime && (isNaN(start?.getTime() || 0))) {
        res.status(400).json({ 
          success: false, 
          message: 'Invalid startTime parameter' 
        });
        return;
      }

      if (endTime && (isNaN(end?.getTime() || 0))) {
        res.status(400).json({ 
          success: false, 
          message: 'Invalid endTime parameter' 
        });
        return;
      }

      // Ограничиваем количество запрашиваемых свечей
      const requestLimit = Math.min(Math.max(1, parseInt(limit.toString(), 10) || 1000), 5000);
      
      logger.debug(`[Controller] Fetching candles for ${symbol} ${timeframe}:`, {
        startTime: start?.toISOString(),
        endTime: end?.toISOString(),
        limit: requestLimit
      });

      // Получаем данные через сервис
      const candleData = await dataService.getHistoricalCandles({
        symbol: symbol.toUpperCase(),
        timeframe,
        startTime: start?.getTime(),
        endTime: end?.getTime(),
        limit: requestLimit
      });

      if (!candleData || !Array.isArray(candleData)) {
        logger.warn(`[Controller] No candle data found for ${symbol} ${timeframe}`);
        res.status(404).json({ 
          success: false, 
          message: 'No candle data found for the specified parameters',
          data: []
        });
        return;
      }

      logger.info(`[Controller] Successfully retrieved ${candleData.length} candles for ${symbol} ${timeframe}`);
      
      res.status(200).json({ 
        success: true, 
        data: candleData,
        meta: {
          symbol,
          timeframe,
          count: candleData.length,
          startTime: candleData[0]?.openTime || null,
          endTime: candleData[candleData.length - 1]?.openTime || null
        }
      });

    } catch (error: any) {
      logger.error(`[Controller] Error fetching historical candles: ${error.message}`, { 
        stack: error.stack,
        body: req.body 
      });
      
      if (!res.headersSent) {
        res.status(500).json({ 
          success: false, 
          message: 'Failed to fetch historical candles', 
          error: error.message 
        });
      }
    }
  }
}

export default new DataController(); 