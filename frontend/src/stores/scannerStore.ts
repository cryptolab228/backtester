import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

import {
  fetchScannerStatus,
  fetchScannerSignals,
  cancelSignal,
  startScanner,
  stopScanner,
  applyRecommendedScannerSettings,
  fetchExecutions,
  fetchSessionExecutions,
  fetchSessionExchangeHistory,
  closeExecution,
  resetScanner,
} from '@/services/scannerService';
import webSocketManager from '@/services/websocketService';

interface ScannerPairConfig {
  symbol: string;
  timeframes: string[];
  exchange?: string;
}

interface ConfirmationQueueStats {
  scheduled: number;
  active: number;
  failed: number;
}

interface ScannerHealthSnapshot {
  startedAt: number;
  contexts: Array<Record<string, any>>;
  totalCycles: number;
  totalErrors: number;
}

export interface ScannerRuntimeStatus {
  enabled: boolean;
  executionMode: 'dry-run' | 'paper' | 'shadow' | 'testnet' | 'demo' | 'live';
  refreshIntervalMs: number;
  confirmWindowSize: number;
  riskScoreThreshold: number;
  maxConcurrentTrades: number;
  defaultLeverage: number;
  tradingFeeRate: number;
  fundingRateBuffer: number;
  riskPerTrade: number;
  stopLossMultiplier: number;
  takeProfitMultiplier: number;
  availableCapital?: number;
  pairs: ScannerPairConfig[];
  running: boolean;
  pendingCount: number;
  confirmationQueue?: ConfirmationQueueStats;
  health?: ScannerHealthSnapshot;
}

const normalizePairs = (pairs: any[]): ScannerPairConfig[] => {
  if (!Array.isArray(pairs)) {
    return [];
  }
  return pairs
    .filter((pair) => pair && typeof pair.symbol === 'string')
    .map((pair) => ({
      symbol: String(pair.symbol).toUpperCase(),
      exchange: typeof pair.exchange === 'string' ? pair.exchange : undefined,
      timeframes: Array.isArray(pair.timeframes)
        ? pair.timeframes.map((tf: any) => String(tf).trim()).filter(Boolean)
        : [],
    }));
};

const toNumber = (value: any, fallback: number): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const normalized = typeof value === 'string'
    ? value.replace(/\s/g, '').replace(',', '.')
    : value;
  const num = Number(normalized);
  return Number.isFinite(num) ? num : fallback;
};

const normalizeStatus = (raw: any): ScannerRuntimeStatus => {
  return {
    enabled: Boolean(raw?.enabled),
    executionMode: (raw?.executionMode as ScannerRuntimeStatus['executionMode']) || 'dry-run',
    refreshIntervalMs: toNumber(raw?.refreshIntervalMs, 1000),
    confirmWindowSize: Math.max(1, Math.round(toNumber(raw?.confirmWindowSize, 1))),
    riskScoreThreshold: toNumber(raw?.riskScoreThreshold, 0.5),
    maxConcurrentTrades: Math.max(1, Math.round(toNumber(raw?.maxConcurrentTrades, 1))),
    defaultLeverage: toNumber(raw?.defaultLeverage, 10),
    tradingFeeRate: toNumber(raw?.tradingFeeRate, 0.0006),
    fundingRateBuffer: toNumber(raw?.fundingRateBuffer, 0.00025),
    riskPerTrade: toNumber(raw?.riskPerTrade, 0.02),
    stopLossMultiplier: toNumber(raw?.stopLossMultiplier, 3),
    takeProfitMultiplier: toNumber(raw?.takeProfitMultiplier, 5),
    availableCapital: typeof raw?.availableCapital === 'number' ? raw.availableCapital : undefined,
    pairs: normalizePairs(raw?.pairs || []),
    running: Boolean(raw?.running),
    pendingCount: Number(raw?.pendingCount) || 0,
    confirmationQueue: raw?.confirmationQueue,
    health: raw?.health,
  };
};

export const useScannerStore = defineStore('scanner', () => {
  const status = ref<ScannerRuntimeStatus | null>(null);
  const pendingSignals = ref<any[]>([]);
  const detectedSignals = ref<any[]>([]);
  const openPositions = ref<any[]>([]);
  const closedExecutions = ref<any[]>([]);
  const exchangeHistory = ref<{ orders: any[]; trades: any[]; closedPnl: any[]; totals?: { totalClosedPnl: number; closedPositions: number } }>({
    orders: [],
    trades: [],
    closedPnl: [],
    totals: { totalClosedPnl: 0, closedPositions: 0 },
  });
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const currentSessionId = ref<string | null>(null);

  const isRunning = computed(() => status.value?.running ?? false);

  const loadStatus = async () => {
    try {
      isLoading.value = true;
      const raw = await fetchScannerStatus();
      status.value = normalizeStatus(raw);
      currentSessionId.value = typeof raw?.sessionId === 'string' && raw.sessionId.length > 0 ? raw.sessionId : null;
    } catch (err: any) {
      error.value = err.message || 'Failed to load scanner status';
      throw err;
    } finally {
      isLoading.value = false;
    }
  };

  const loadSignals = async (pairSymbol?: string) => {
    try {
      isLoading.value = true;
      const { pending, detected } = await fetchScannerSignals(pairSymbol);
      const pendingFiltered = (pending || []).filter((item) => item && item.id && item.status === 'waiting');
      const detectedFiltered = (detected || []).filter((item) => item && item.id);
      pendingSignals.value = pendingFiltered;
      detectedSignals.value = detectedFiltered;
    } catch (err: any) {
      error.value = err.message || 'Failed to load signals';
      throw err;
    } finally {
      isLoading.value = false;
    }
  };

  const cancelPendingSignal = async (signalId: string) => {
    await cancelSignal(signalId);
    await loadSignals();
  };

  const loadExecutions = async () => {
    const response = await fetchExecutions(currentSessionId.value || undefined);
    const mode = response?.mode as ScannerRuntimeStatus['executionMode'] | undefined;
    const executions = Array.isArray(response?.executions)
      ? response.executions.map((item: any) => ({ ...item, mode }))
      : [];
    const open = Array.isArray(response?.openPositions)
      ? response.openPositions.map((item: any) => ({ ...item, mode }))
      : [];

    openPositions.value = open;

    if (currentSessionId.value) {
      try {
        const sessionData = await fetchSessionExecutions(currentSessionId.value);
        const sessionExecutions = Array.isArray(sessionData?.executions)
          ? sessionData.executions
          : [];
        closedExecutions.value = sessionExecutions.map((item: any) => ({ ...item, mode }));
      } catch (err) {
        console.warn('Failed to load session executions, falling back to recent executions list', err);
        closedExecutions.value = executions.filter((item: any) => item.status === 'closed');
      }
    } else {
      closedExecutions.value = executions.filter((item: any) => item.status === 'closed');
    }
  };

  const loadExchangeHistory = async () => {
    if (!currentSessionId.value) {
      exchangeHistory.value = {
        orders: [],
        trades: [],
        closedPnl: [],
        totals: { totalClosedPnl: 0, closedPositions: 0 },
      };
      return;
    }

    const data = await fetchSessionExchangeHistory(currentSessionId.value);
    exchangeHistory.value = {
      orders: Array.isArray(data?.orders) ? data.orders : [],
      trades: Array.isArray(data?.trades) ? data.trades : [],
      closedPnl: Array.isArray(data?.closedPnl) ? data.closedPnl : [],
      totals: data?.totals ?? { totalClosedPnl: 0, closedPositions: 0 },
    };
  };

  const closePosition = async (id: string, exitPrice: number) => {
    await closeExecution(id, exitPrice, 'manual');
    await loadExecutions();
  };

  const start = async () => {
    await startScanner();
    await loadStatus();
  };

  const stop = async () => {
    await stopScanner();
    await loadStatus();
  };

  const reset = async () => {
    await resetScanner();
    await Promise.all([loadStatus(), loadSignals(), loadExecutions(), loadExchangeHistory()]);
  };

  const applyRecommended = async () => {
    const raw = await applyRecommendedScannerSettings();
    status.value = normalizeStatus(raw);
    return status.value;
  };

  const handleWebSocketMessage = (message: { type: string; payload?: any }) => {
    const payloadSessionId = message.payload?.sessionId as string | undefined
    const hasSessionMismatch = currentSessionId.value
      ? !payloadSessionId || payloadSessionId !== currentSessionId.value
      : false
    switch (message.type) {
      case 'signal_detected': {
        const payload = message.payload;
        if (!payload?.id) return;
        pendingSignals.value = [payload, ...pendingSignals.value.filter((s) => s.id !== payload.id)];
        break;
      }
      case 'signal_confirmed': {
        const payload = message.payload;
        if (!payload?.id) return;
        pendingSignals.value = pendingSignals.value.filter((s) => s.id !== payload.id);
        detectedSignals.value = [payload, ...detectedSignals.value.filter((s) => s.id !== payload.id)];
        loadExecutions().catch((error) => {
          console.warn('Failed to refresh executions after confirmation', error);
        });
        break;
      }
      case 'signal_updated': {
        const payload = message.payload;
        if (!payload?.id) return;
        // ✅ Обновляем существующий pending сигнал с новыми метриками
        const index = pendingSignals.value.findIndex((s) => s.id === payload.id);
        if (index !== -1) {
          pendingSignals.value[index] = { ...pendingSignals.value[index], ...payload };
        }
        break;
      }
      case 'signal_cancelled': {
        const payload = message.payload;
        if (!payload?.signalId) return;
        pendingSignals.value = pendingSignals.value.filter((s) => s.id !== payload.signalId);
        loadExecutions().catch((error) => {
          console.warn('Failed to refresh executions after cancellation', error);
        });
        break;
      }
      case 'executions_snapshot': {
        const open = Array.isArray(message.payload?.open) ? message.payload.open : [];
        const recent = Array.isArray(message.payload?.recent) ? message.payload.recent : [];
        openPositions.value = open;
        closedExecutions.value = recent.filter((item: any) => item && item.status === 'closed');
        break;
      }
      case 'execution_opened': {
        if (hasSessionMismatch) return
        if (message.payload) {
          openPositions.value = [message.payload, ...openPositions.value.filter((pos) => pos.id !== message.payload.id)]
        }
        break
      }
      case 'execution_updated': {
        if (hasSessionMismatch) return
        if (message.payload?.id) {
          openPositions.value = openPositions.value.map((pos) => (pos.id === message.payload.id ? message.payload : pos))
        }
        break
      }
      case 'execution_closed': {
        if (hasSessionMismatch) return
        if (message.payload) {
          openPositions.value = openPositions.value.filter((pos) => pos.id !== message.payload.id)
          closedExecutions.value = [message.payload, ...closedExecutions.value]
        }
        break
      }
      case 'scanner_status_updated': {
        if (message.payload) {
          status.value = normalizeStatus(message.payload);
        }
        break;
      }
      default:
        break;
    }
  };

  const clearSignals = () => {
    pendingSignals.value = [];
    detectedSignals.value = [];
  };

  const unsubscribe = () => webSocketManager.unsubscribe(handleWebSocketMessage);

  webSocketManager.subscribe(handleWebSocketMessage);

  return {
    status,
    pendingSignals,
    detectedSignals,
    openPositions,
    closedExecutions,
    exchangeHistory,
    isLoading,
    error,
    isRunning,
    currentSessionId,
    loadStatus,
    loadSignals,
    cancelPendingSignal,
    loadExecutions,
    loadExchangeHistory,
    closePosition,
    start,
    stop,
    reset,
    applyRecommended,
    clearSignals,
    unsubscribe,
  };
});


