import RedisSignalStore from '@/services/RedisSignalStore';
import { confirmationQueueManager } from './confirmationQueue';

import { PendingSignal, SignalQueue } from './scanner.types';

export class RedisSignalQueue implements SignalQueue {
  async enqueue(signal: PendingSignal): Promise<void> {
    await RedisSignalStore.storePending(signal);
  }

  async markAsConfirmed(signalId: string, _riskScore: number): Promise<void> {
    await RedisSignalStore.removePending(signalId);
  }

  async markAsCancelled(signalId: string, _reason: string): Promise<void> {
    await RedisSignalStore.removePending(signalId);
  }

  async getPendingSignals(pairSymbol?: string): Promise<PendingSignal[]> {
    return RedisSignalStore.getPendingSignals(pairSymbol);
  }

  async get(signalId: string): Promise<PendingSignal | null> {
    return RedisSignalStore.getPendingSignal(signalId);
  }

  async clearAll(): Promise<void> {
    await confirmationQueueManager.clearAll();
    await RedisSignalStore.clearAllSignals();
  }
}

export default new RedisSignalQueue();

