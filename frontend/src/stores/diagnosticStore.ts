import { defineStore } from 'pinia';
import { ref } from 'vue';
import axios from 'axios';

// Типы ошибок
export enum ErrorType {
  DATA_MISSING = 'DATA_MISSING',
  DATA_INCOMPLETE = 'DATA_INCOMPLETE',
  MEMORY_OVERFLOW = 'MEMORY_OVERFLOW',
  GPU_SERVICE_DOWN = 'GPU_SERVICE_DOWN',
  GPU_PERFORMANCE_ISSUE = 'GPU_PERFORMANCE_ISSUE',
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  CALCULATION_ERROR = 'CALCULATION_ERROR',
  STATE_CORRUPTION = 'STATE_CORRUPTION',
  API_RATE_LIMIT = 'API_RATE_LIMIT',
  NETWORK_ERROR = 'NETWORK_ERROR',
  PORTFOLIO_INCOMPLETE = 'PORTFOLIO_INCOMPLETE',
  CONFIGURATION_ERROR = 'CONFIGURATION_ERROR'
}

export interface DiagnosticError {
  id: string;
  timestamp: string;
  type: ErrorType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  testId: string;
  testType: 'single' | 'portfolio' | 'gpu' | 'system';
  description: string;
  context: Record<string, any>;
  impact: number;
  autoFixable: boolean;
  suggestions: FixSuggestion[];
  resolved: boolean;
  resolvedAt?: string;
  stackTrace?: string;
  metadata: Record<string, any>;
}

export interface FixSuggestion {
  type: string;
  description: string;
  action: string;
  params: Record<string, any>;
  priority: 'low' | 'medium' | 'high';
  estimatedTime?: string;
}

export interface PairDataStatus {
  symbol: string;
  exchange: string;
  status: 'available' | 'missing' | 'incomplete' | 'problematic';
  coverage: number;
  totalCandles: number;
  missingRanges?: Array<{ start: string; end: string }>;
  lastUpdated?: string;
  memoryEstimate: number;
}

export interface PortfolioDataAnalysis {
  totalPairs: number;
  availablePairs: PairDataStatus[];
  missingPairs: PairDataStatus[];
  incompletePairs: PairDataStatus[];
  problematicPairs: PairDataStatus[];
  memoryEstimate: number;
  recommendations: DiagnosticRecommendation[];
  canProceed: boolean;
  warningLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
}

export interface DiagnosticRecommendation {
  id: string;
  type: 'info' | 'warning' | 'error';
  title: string;
  description: string;
  actions?: Array<{
    id: string;
    label: string;
    action: string;
    params: any;
  }>;
  priority: number;
}

export interface SystemHealth {
  status: 'healthy' | 'warning' | 'critical';
  metrics: {
    cpu: {
      usage: number;
      cores: number;
      load: number[];
    };
    memory: {
      used: number;
      total: number;
      percentage: number;
    };
    disk: {
      used: number;
      total: number;
      percentage: number;
    };
    gpu?: {
      available: boolean;
      healthy: boolean;
      memoryUsed: number;
      memoryTotal: number;
      utilization: number;
    };
  };
  recommendations: DiagnosticRecommendation[];
}

export interface ErrorSummary {
  total: number;
  critical: number;
  unresolved: number;
  lastHour: number;
  mostCommon: Array<{
    type: ErrorType;
    count: number;
  }>;
}

export const useDiagnosticStore = defineStore('diagnostic', {
  state: () => ({
    // Ошибки
    errors: ref<DiagnosticError[]>([]),
    errorSummary: ref<ErrorSummary | null>(null),
    
    // Система
    systemHealth: ref<SystemHealth | null>(null),
    
    // Портфель
    portfolioAnalysis: ref<PortfolioDataAnalysis | null>(null),
    
    // Состояние загрузки
    loading: {
      errors: ref(false),
      systemHealth: ref(false),
      portfolioAnalysis: ref(false)
    },
    
    // Ошибки API
    apiErrors: {
      errors: ref<string | null>(null),
      systemHealth: ref<string | null>(null),
      portfolioAnalysis: ref<string | null>(null)
    },
    
    // WebSocket соединение для real-time уведомлений
    websocketConnected: ref(false),
    
    // Фильтры
    errorFilters: ref({
      type: null as ErrorType | null,
      severity: null as string | null,
      testType: null as string | null,
      resolved: null as boolean | null,
      startDate: null as Date | null,
      endDate: null as Date | null
    })
  }),

  getters: {
    // Критические ошибки
    criticalErrors: (state) => {
      return state.errors.filter(error => error.severity === 'critical' && !error.resolved);
    },

    // Нерешенные ошибки
    unresolvedErrors: (state) => {
      return state.errors.filter(error => !error.resolved);
    },

    // Ошибки за последний час
    recentErrors: (state) => {
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
      return state.errors.filter(error => new Date(error.timestamp) > hourAgo);
    },

    // Отфильтрованные ошибки
    filteredErrors: (state) => {
      let filtered = state.errors;
      const filters = state.errorFilters;

      if (filters.type) {
        filtered = filtered.filter(e => e.type === filters.type);
      }
      if (filters.severity) {
        filtered = filtered.filter(e => e.severity === filters.severity);
      }
      if (filters.testType) {
        filtered = filtered.filter(e => e.testType === filters.testType);
      }
      if (filters.resolved !== null) {
        filtered = filtered.filter(e => e.resolved === filters.resolved);
      }
      if (filters.startDate) {
        filtered = filtered.filter(e => new Date(e.timestamp) >= filters.startDate!);
      }
      if (filters.endDate) {
        filtered = filtered.filter(e => new Date(e.timestamp) <= filters.endDate!);
      }

      return filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    },

    // Проблемные пары для портфеля
    problematicPairs: (state) => {
      if (!state.portfolioAnalysis) return [];
      return [
        ...state.portfolioAnalysis.missingPairs,
        ...state.portfolioAnalysis.incompletePairs,
        ...state.portfolioAnalysis.problematicPairs
      ];
    },

    // Можно ли запускать портфельный тест
    canRunPortfolioTest: (state) => {
      return state.portfolioAnalysis?.canProceed ?? false;
    },

    // Общий статус системы
    overallSystemStatus: (state) => {
      const criticalCount = state.errors.filter(e => e.severity === 'critical' && !e.resolved).length;
      const systemStatus = state.systemHealth?.status;
      
      if (criticalCount > 0 || systemStatus === 'critical') {
        return 'critical';
      } else if (systemStatus === 'warning' || (state.errorSummary?.unresolved ?? 0) > 5) {
        return 'warning';
      } else {
        return 'healthy';
      }
    }
  },

  actions: {
    /**
     * Загрузка ошибок с сервера
     */
    async fetchErrors(filters?: {
      type?: ErrorType;
      severity?: string;
      testId?: string;
      resolved?: boolean;
      startDate?: Date;
      endDate?: Date;
      limit?: number;
    }) {
      this.loading.errors = true;
      this.apiErrors.errors = null;

      try {
        const params = new URLSearchParams();
        
        if (filters?.type) params.append('type', filters.type);
        if (filters?.severity) params.append('severity', filters.severity);
        if (filters?.testId) params.append('testId', filters.testId);
        if (filters?.resolved !== undefined) params.append('resolved', String(filters.resolved));
        if (filters?.startDate) params.append('startDate', filters.startDate.toISOString());
        if (filters?.endDate) params.append('endDate', filters.endDate.toISOString());
        if (filters?.limit) params.append('limit', String(filters.limit));

        const response = await axios.get(`/api/diagnostics/errors?${params}`);
        
        if (response.data.success) {
          this.errors = response.data.data.errors;
          this.errorSummary = response.data.data.summary;
        } else {
          throw new Error(response.data.message || 'Failed to fetch errors');
        }

      } catch (error: any) {
        this.apiErrors.errors = error.response?.data?.message || error.message;
        console.error('[DiagnosticStore] Error fetching errors:', error);
      } finally {
        this.loading.errors = false;
      }
    },

    /**
     * Анализ портфельных данных
     */
    async analyzePortfolioData(
      pairSymbols: string[],
      timeframe: string,
      startDate: Date,
      endDate: Date,
      exchange: string = 'okx'
    ): Promise<PortfolioDataAnalysis | null> {
      this.loading.portfolioAnalysis = true;
      this.apiErrors.portfolioAnalysis = null;

      try {
        const response = await axios.post('/api/diagnostics/portfolio/analyze', {
          pairSymbols,
          timeframe,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          exchange
        });

        if (response.data.success) {
          this.portfolioAnalysis = response.data.data;
          return response.data.data;
        } else {
          throw new Error(response.data.message || 'Failed to analyze portfolio data');
        }

      } catch (error: any) {
        this.apiErrors.portfolioAnalysis = error.response?.data?.message || error.message;
        console.error('[DiagnosticStore] Error analyzing portfolio data:', error);
        return null;
      } finally {
        this.loading.portfolioAnalysis = false;
      }
    },

    /**
     * Получение состояния системы
     */
    async fetchSystemHealth() {
      this.loading.systemHealth = true;
      this.apiErrors.systemHealth = null;

      try {
        const response = await axios.get('/api/diagnostics/system');
        
        if (response.data.success) {
          this.systemHealth = response.data.data;
        } else {
          throw new Error(response.data.message || 'Failed to fetch system health');
        }

      } catch (error: any) {
        this.apiErrors.systemHealth = error.response?.data?.message || error.message;
        console.error('[DiagnosticStore] Error fetching system health:', error);
      } finally {
        this.loading.systemHealth = false;
      }
    },

    /**
     * Получение краткой сводки
     */
    async fetchSummary() {
      try {
        const response = await axios.get('/api/diagnostics/summary');
        
        if (response.data.success) {
          this.errorSummary = response.data.data.errors;
          // Обновляем системную информацию из сводки
          if (response.data.data.system && this.systemHealth) {
            this.systemHealth.status = response.data.data.system.status;
          }
        }

      } catch (error: any) {
        console.error('[DiagnosticStore] Error fetching summary:', error);
      }
    },

    /**
     * Разрешение ошибки
     */
    async resolveError(errorId: string) {
      try {
        const response = await axios.put(`/api/diagnostics/errors/${errorId}/resolve`);
        
        if (response.data.success) {
          // Обновляем локальное состояние
          const error = this.errors.find(e => e.id === errorId);
          if (error) {
            error.resolved = true;
            error.resolvedAt = new Date().toISOString();
          }
        } else {
          throw new Error(response.data.message || 'Failed to resolve error');
        }

      } catch (error: any) {
        console.error('[DiagnosticStore] Error resolving error:', error);
        throw error;
      }
    },

    /**
     * Попытка автоисправления ошибки
     */
    async fixError(errorId: string) {
      try {
        const response = await axios.post(`/api/diagnostics/errors/${errorId}/fix`);
        
        if (response.data.success) {
          // Перезагружаем ошибки для обновления статуса
          await this.fetchErrors();
        }

        return response.data;

      } catch (error: any) {
        console.error('[DiagnosticStore] Error fixing error:', error);
        throw error;
      }
    },

    /**
     * Установка фильтров
     */
    setErrorFilters(filters: Partial<typeof this.errorFilters>) {
      Object.assign(this.errorFilters, filters);
    },

    /**
     * Очистка фильтров
     */
    clearErrorFilters() {
      this.errorFilters = {
        type: null,
        severity: null,
        testType: null,
        resolved: null,
        startDate: null,
        endDate: null
      };
    },

    /**
     * Инициализация WebSocket соединения для real-time уведомлений
     */
    initializeWebSocket() {
      // Здесь будет интеграция с существующим WebSocket для получения уведомлений
      // о новых ошибках в реальном времени
    },

    /**
     * Обработка WebSocket сообщения о новой ошибке
     */
    handleDiagnosticError(errorData: DiagnosticError) {
      // Добавляем новую ошибку в начало списка
      this.errors.unshift(errorData);
      
      // Ограничиваем количество ошибок в памяти
      if (this.errors.length > 1000) {
        this.errors = this.errors.slice(0, 1000);
      }
      
      // Обновляем сводку
      this.fetchSummary();
    },

    /**
     * Обработка WebSocket сообщения о решении ошибки
     */
    handleErrorResolved(errorId: string) {
      const error = this.errors.find(e => e.id === errorId);
      if (error) {
        error.resolved = true;
        error.resolvedAt = new Date().toISOString();
      }
    }
  }
});
