import { apiClient } from '@/services/apiService'
import type { ScannerRuntimeStatus } from '@/stores/scannerStore'

export interface ScannerSignal {
  id: string
  pairSymbol: string
  timeframe: string
  status: string
  detectedAt: number
  direction: 'long' | 'short'
  strength?: number
  entryPrice?: number
  stopLoss?: number
  takeProfit?: number
  lastCandleTimestamp?: number
  lastCandlePrice?: number
  confirmationAttempts?: number
  maxConfirmationAttempts?: number
  confirmWindowSize?: number
  confirmationTargetPrice?: number
  recommendedSize?: number
  riskScore?: number
  reason?: string
}

export interface ScannerSignalsResponse {
  pending: ScannerSignal[]
  detected: ScannerSignal[]
}

export const fetchScannerStatus = async () => {
  const { data } = await apiClient.get('/scanner/status')
  return data
}

export const fetchScannerSignals = async (pairSymbol?: string): Promise<ScannerSignalsResponse> => {
  const params = pairSymbol ? { pairSymbol } : undefined
  const { data } = await apiClient.get('/scanner/signals', { params })
  return data
}

export const startScanner = async (): Promise<void> => {
  await apiClient.post('/scanner/start')
};

export const stopScanner = async (): Promise<void> => {
  await apiClient.post('/scanner/stop')
};

export const resetScanner = async (): Promise<void> => {
  await apiClient.post('/scanner/reset')
};

export const updateScannerSettings = async (settings: Partial<ScannerRuntimeStatus>): Promise<ScannerRuntimeStatus> => {
  const response = await apiClient.put<ScannerRuntimeStatus>('/scanner/settings', settings)
  return response.data
};

export const applyRecommendedScannerSettings = async (): Promise<ScannerRuntimeStatus> => {
  const response = await apiClient.post<ScannerRuntimeStatus>('/scanner/settings/recommended')
  return response.data
};

export const cancelSignal = async (signalId: string): Promise<void> => {
  await apiClient.post('/scanner/cancel', { signalId })
};

export const fetchExecutions = async (sessionId?: string) => {
  const params = sessionId ? { sessionId } : undefined
  const { data } = await apiClient.get('/scanner/executions', { params })
  return data
};

export const fetchSessionExecutions = async (sessionId: string) => {
  const { data } = await apiClient.get(`/scanner/sessions/${sessionId}/executions`)
  return data
};

export const fetchSessionExchangeHistory = async (sessionId: string) => {
  const { data } = await apiClient.get(`/scanner/sessions/${sessionId}/exchange-history`)
  return data
};

export const closeExecution = async (id: string, exitPrice: number, exitReason: 'take_profit' | 'stop_loss' | 'manual' = 'manual') => {
  const { data } = await apiClient.post(`/scanner/executions/${id}/close`, { exitPrice, exitReason })
  return data
};

export const fetchScannerSettings = async () => {
  const response = await apiClient.get('/scanner/settings')
  return response.data
};

