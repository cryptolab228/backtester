import logger from '@/utils/logger';

import {
  ConfirmationJobPayload,
  ConfirmationJobResult,
  ConfirmationQueueManagerContract,
  PendingSignal,
} from './scanner.types';

type ConfirmationJobHandler = (payload: ConfirmationJobPayload) => Promise<ConfirmationJobResult> | ConfirmationJobResult;

interface ConfirmationQueueStats {
  scheduled: number;
  failed: number;
}

const MAX_HANDLER_RETRIES = 5
const HANDLER_RETRY_BASE_DELAY_MS = 5_000

class ConfirmationQueueManager implements ConfirmationQueueManagerContract {
  private readonly log = logger.child({ module: 'ConfirmationQueue' });

  private handler?: ConfirmationJobHandler;

  private readonly jobs = new Map<string, NodeJS.Timeout>();

  private readonly attempts = new Map<string, number>();

  private stats: ConfirmationQueueStats = { scheduled: 0, failed: 0 };

  registerHandler(handler: ConfirmationJobHandler): void {
    this.handler = handler;
  }

  async scheduleConfirmation(signal: PendingSignal, delayMs: number): Promise<void> {
    if (!signal.id) {
      this.log.warn('Cannot schedule confirmation without signal id', {
        pair: signal.pairSymbol,
        timeframe: signal.timeframe,
      });
      return;
    }

    const delay = Math.max(0, Number.isFinite(delayMs) ? delayMs : 0);

    await this.cancelConfirmation(signal.id);

    const attempt = (this.attempts.get(signal.id) ?? 0) + 1;
    this.attempts.set(signal.id, attempt);

    const payload: ConfirmationJobPayload = {
      signalId: signal.id,
      pairSymbol: signal.pairSymbol,
      timeframe: signal.timeframe,
      exchange: signal.exchange,
      triggeredAt: Date.now() + delay,
      attempt,
    };

    const timeout = setTimeout(() => {
      void this.executeJob(signal.id!, payload);
    }, delay);

    timeout.unref?.();

    this.jobs.set(signal.id, timeout);
    this.stats.scheduled += 1;

    this.log.debug('Confirmation job scheduled', {
      signalId: signal.id,
      pair: signal.pairSymbol,
      timeframe: signal.timeframe,
      delay,
      attempt,
    });
  }

  async cancelConfirmation(signalId: string): Promise<void> {
    const timeout = this.jobs.get(signalId);
    if (timeout) {
      clearTimeout(timeout);
      this.jobs.delete(signalId);
      this.log.debug('Confirmation job cancelled', { signalId });
    }
  }

  async clearAll(): Promise<void> {
    for (const timeout of this.jobs.values()) {
      clearTimeout(timeout);
    }
    this.jobs.clear();
    this.attempts.clear();
    this.stats = { scheduled: 0, failed: 0 };
    this.log.debug('Confirmation queue cleared');
  }

  async shutdown(): Promise<void> {
    await this.clearAll();
  }

  async getStats(): Promise<{ scheduled: number; active: number; failed: number }> {
    return {
      scheduled: this.stats.scheduled,
      active: this.jobs.size,
      failed: this.stats.failed,
    };
  }

  private async executeJob(signalId: string, payload: ConfirmationJobPayload): Promise<void> {
    this.jobs.delete(signalId);

    if (!this.handler) {
      this.log.warn('Confirmation job handler not registered, skipping execution', { signalId });
      return;
    }

    try {
      const result = await this.handler(payload);
      if (!result || result.status !== 'retry') {
        this.attempts.delete(signalId);
      }

      this.log.debug('Confirmation job executed', {
        signalId,
        status: result?.status ?? 'unknown',
        attempt: payload.attempt,
      });

      if (result && result.status === 'retry') {
        return;
      }
    } catch (error: any) {
      this.stats.failed += 1;
      this.log.error('Confirmation job execution failed', {
        signalId,
        attempt: payload.attempt,
        error: error?.message || error,
      });

      const currentAttempts = this.attempts.get(signalId) ?? payload.attempt;
      if (currentAttempts >= MAX_HANDLER_RETRIES) {
        this.attempts.delete(signalId);
        return;
      }

      const nextAttempt = currentAttempts + 1;
      this.attempts.set(signalId, nextAttempt);

      const delay = Math.min(60_000, HANDLER_RETRY_BASE_DELAY_MS * nextAttempt);
      const retryPayload: ConfirmationJobPayload = {
        ...payload,
        attempt: nextAttempt,
        triggeredAt: Date.now() + delay,
      };

      const timeout = setTimeout(() => {
        void this.executeJob(signalId, retryPayload);
      }, delay);

      timeout.unref?.();
      this.jobs.set(signalId, timeout);
      this.stats.scheduled += 1;
      return;
    }

    this.attempts.delete(signalId);
  }
}

export const confirmationQueueManager = new ConfirmationQueueManager();

export default confirmationQueueManager;




