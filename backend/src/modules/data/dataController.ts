import { Request, Response } from 'express';
import { dataQueue } from '@/config/queue';
import { JOB_TYPES } from '@/jobs/dataWorker';
import logger from '@/utils/logger';
import { Job, JobType } from 'bullmq';
import { dataService } from '@/services/dataService';

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
    logger.debug('[Controller][getJobCounts] Received request to get job counts.');
    try {
      const jobTypesForCounts: JobType[] = ['active', 'wait', 'waiting', 'completed', 'failed', 'delayed', 'paused', 'prioritized'];
      const counts = await dataQueue.getJobCounts(...jobTypesForCounts);
      logger.debug(`[Controller][getJobCounts] Raw counts from BullMQ: ${JSON.stringify(counts)}`);
      
      const sanitizedCounts: { [key: string]: number } = {};
      jobTypesForCounts.forEach(status => {
        sanitizedCounts[status] = 0;
      });
      for (const status in counts) {
        if (Object.prototype.hasOwnProperty.call(counts, status)) {
            sanitizedCounts[status as JobType] = counts[status as keyof typeof counts] || 0;
        }
      }

      if (sanitizedCounts.wait !== undefined && sanitizedCounts.waiting === 0) {
        sanitizedCounts.waiting = sanitizedCounts.wait;
      }

      logger.info(`[Controller][getJobCounts] Sanitized counts being sent to frontend: ${JSON.stringify(sanitizedCounts)}`);
      res.status(200).json(sanitizedCounts);
    } catch (error: any) {
      logger.error('[Controller][getJobCounts] Error fetching job counts:', { message: error.message, stack: error.stack });
      res.status(500).json({ message: 'Error fetching job counts' });
    }
  }

  async getJobs(req: Request, res: Response): Promise<void> {
    const { status, start = 0, end = -1 } = req.query;
    logger.debug(`[Controller][getJobs] Received request with query: status=${JSON.stringify(status)}, start=${start}, end=${end}`);

    const validJobTypes: JobType[] = ['active', 'wait', 'waiting', 'completed', 'failed', 'delayed', 'paused', 'prioritized'];
    let typesToFetch: JobType[] = [];

    if (status && typeof status === 'string' && status.toLowerCase() === 'all') {
        typesToFetch = [...validJobTypes];
        logger.debug(`[Controller][getJobs] Client requested 'all' statuses. Fetching all valid types.`);
    } else if (status) {
      const requestedTypes = Array.isArray(status) ? status as string[] : [status as string];
      logger.debug(`[Controller][getJobs] Requested types from query: ${JSON.stringify(requestedTypes)}`);
      typesToFetch = requestedTypes.filter(t => validJobTypes.includes(t as JobType)) as JobType[];
    } else {
      typesToFetch = [...validJobTypes];
      logger.debug(`[Controller][getJobs] No specific status requested. Fetching all valid types by default (including completed).`);
    }
    
    logger.debug(`[Controller][getJobs] Types to fetch from BullMQ after filtering/defaulting: ${JSON.stringify(typesToFetch)}`);

    if (typesToFetch.length === 0 && status && !(typeof status === 'string' && status.toLowerCase() === 'all')) {
      logger.warn(`[Controller][getJobs] No valid job types to fetch after filtering requested statuses: ${JSON.stringify(status)}. Returning empty array.`);
      res.status(200).json([]);
      return;
    }
     if (typesToFetch.length === 0 && (!status || (typeof status === 'string' && status.toLowerCase() === 'all'))) {
        logger.error(`[Controller][getJobs] Catastrophic: typesToFetch is empty even when requesting all types. Check 'validJobTypes'. Returning empty array.`);
        res.status(200).json([]);
        return;
    }

    try {
      const jobs = await dataQueue.getJobs(typesToFetch, Number(start), Number(end));
      logger.debug(`[Controller][getJobs] Fetched ${jobs.length} jobs from queue with types: ${JSON.stringify(typesToFetch)}`);

      const jobsWithDetails = await Promise.all(jobs.map(async job => {
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
      }));
      res.status(200).json(jobsWithDetails);
    } catch (error: any) {
      logger.error('[Controller][getJobs] Error fetching jobs from queue:', { 
        message: error.message, 
        stack: error.stack,
        typesToFetch,
        start,
        end 
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
}

export default new DataController(); 