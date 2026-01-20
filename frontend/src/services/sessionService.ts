import axios from 'axios';
import type {
  TradingSession,
  SessionMetrics,
  SessionTrade,
  CreateSessionParams,
  SessionFilters,
  ScannerStatus,
} from '@/types/session';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

/**
 * Сервис для работы с сессиями сканера
 */
export class SessionService {
  /**
   * Получить список всех сессий с фильтрацией
   */
  async getSessions(filters?: SessionFilters): Promise<TradingSession[]> {
    const response = await axios.get(`${API_BASE_URL}/api/scanner/sessions`, {
      params: filters,
    });
    return response.data.data || response.data;
  }

  async deleteSession(sessionId: string): Promise<void> {
    await axios.delete(`${API_BASE_URL}/api/scanner/sessions/${sessionId}`);
  }

  /**
   * Получить детали конкретной сессии
   */
  async getSession(sessionId: string): Promise<TradingSession> {
    const response = await axios.get(`${API_BASE_URL}/api/scanner/sessions/${sessionId}`);
    return response.data.data || response.data;
  }

  /**
   * Получить текущую активную сессию
   */
  async getActiveSession(): Promise<TradingSession | null> {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/scanner/sessions/active`);
      const result = response.data.data || response.data;
      return result?.session || result;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Создать новую сессию
   */
  async createSession(params: CreateSessionParams): Promise<TradingSession> {
    const response = await axios.post(`${API_BASE_URL}/api/scanner/sessions`, params);
    return response.data.data || response.data;
  }

  /**
   * Запустить сканнер с выбранной сессией
   */
  async startScanner(sessionId: string): Promise<{ message: string; sessionId: string }> {
    const response = await axios.post(`${API_BASE_URL}/api/scanner/start/${sessionId}`);
    return response.data.data || response.data;
  }

  /**
   * Остановить сканнер и завершить текущую сессию
   */
  async stopScanner(): Promise<{ message: string }> {
    const response = await axios.post(`${API_BASE_URL}/api/scanner/stop`);
    return response.data.data || response.data;
  }

  /**
   * Принудительно завершить сессию
   */
  async endSession(sessionId: string): Promise<{ message: string }> {
    const response = await axios.post(`${API_BASE_URL}/api/scanner/sessions/${sessionId}/end`);
    return response.data.data || response.data;
  }

  /**
   * Получить статус сканера
   */
  async getScannerStatus(): Promise<ScannerStatus> {
    const response = await axios.get(`${API_BASE_URL}/api/scanner/scanner-status`);
    const result = response.data.data || response.data;
    return {
      isRunning: result.status === 'running',
      activeSessionId: result.sessionId,
      startedAt: result.startedAt,
    };
  }

  /**
   * Получить метрики для сессии
   */
  async getSessionMetrics(sessionId: string): Promise<SessionMetrics | null> {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/scanner/sessions/${sessionId}/metrics`);
      return response.data.data || response.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Получить сделки для сессии
   */
  async getSessionTrades(sessionId: string, limit = 100): Promise<SessionTrade[]> {
    const response = await axios.get(`${API_BASE_URL}/api/scanner/sessions/${sessionId}/trades`, {
      params: { limit },
    });
    return response.data.data || response.data;
  }
}

export const sessionService = new SessionService();
