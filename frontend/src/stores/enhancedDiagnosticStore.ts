import { defineStore } from 'pinia';
import { ref } from 'vue';
import axios from 'axios';

// === УЛУЧШЕННЫЕ ТИПЫ ===

export interface EnhancedError {
  id: string;
  timestamp: string;
  type: string;
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
  correlationId?: string;
  rootCause?: string;
  affectedComponents: string[];
  escalationLevel: number;
  autoFixAttempts: number;
  lastAutoFixAt?: string;
  mitigationActions?: string[];
}

export interface FixSuggestion {
  type: string;
  description: string;
  action: string;
  params: Record<string, any>;
  priority: 'low' | 'medium' | 'high';
  estimatedTime?: string;
}

export interface AutoFixAction {
  id: string;
  name: string;
  description: string;
  type: 'restart' | 'cleanup' | 'reload' | 'reconfigure' | 'external';
  target: string;
  timeout: number;
  retryCount: number;
  priority: number;
}

export interface DiagnosticInsight {
  id: string;
  type: 'pattern' | 'trend' | 'anomaly' | 'prediction';
  title: string;
  description: string;
  confidence: number;
  impact: 'low' | 'medium' | 'high';
  actions: string[];
  data: any;
  createdAt: string;
  expiresAt?: string;
}

export interface EnhancedSystemHealth {
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
  enhanced: {
    healthChecks: number;
    autoFixActions: number;
    alertRules: number;
    insights: number;
    systemMetrics: any;
  };
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

export interface AutoFixResult {
  errorId: string;
  fixed: boolean;
  message: string;
}

export const useEnhancedDiagnosticStore = defineStore('enhancedDiagnostic', {
  state: () => ({
    // Ошибки
    errors: ref<EnhancedError[]>([]),
    insights: ref<DiagnosticInsight[]>([]),
    autoFixActions: ref<AutoFixAction[]>([]),

    // Система
    systemHealth: ref<EnhancedSystemHealth | null>(null),

    // Состояние загрузки
    loading: {
      errors: ref(false),
      insights: ref(false),
      systemHealth: ref(false),
      autoFixActions: ref(false)
    },

    // Ошибки API
    apiErrors: {
      errors: ref<string | null>(null),
      insights: ref<string | null>(null),
      systemHealth: ref<string | null>(null),
      autoFixActions: ref<string | null>(null)
    },

    // Фильтры
    errorFilters: ref({
      type: null as string | null,
      severity: null as string | null,
      testType: null as string | null,
      resolved: null as boolean | null,
      startDate: null as Date | null,
      endDate: null as Date | null,
      autoFixable: null as boolean | null
    }),

    // WebSocket соединение
    websocketConnected: ref(false),

    // Настройки
    settings: ref({
      autoRefreshInterval: 30000, // 30 секунд
      maxErrors: 1000,
      enableRealTimeUpdates: true,
      enableAutoFix: true
    })
  }),

  getters: {
    // Фильтрованные ошибки
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
      if (filters.autoFixable !== null) {
        filtered = filtered.filter(e => e.autoFixable === filters.autoFixable);
      }
      if (filters.startDate) {
        filtered = filtered.filter(e => new Date(e.timestamp) >= filters.startDate!);
      }
      if (filters.endDate) {
        filtered = filtered.filter(e => new Date(e.timestamp) <= filters.endDate!);
      }

      return filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    },

    // Критические ошибки
    criticalErrors: (state) => {
      return state.errors.filter(error =>
        error.severity === 'critical' &&
        !error.resolved &&
        error.autoFixAttempts < 3
      );
    },

    // Автоисправляемые ошибки
    autoFixableErrors: (state) => {
      return state.errors.filter(error =>
        error.autoFixable &&
        !error.resolved &&
        error.autoFixAttempts < 3
      );
    },

    // Инсайты по типам
    insightsByType: (state) => {
      return state.insights.reduce((acc, insight) => {
        if (!acc[insight.type]) {
          acc[insight.type] = [];
        }
        acc[insight.type].push(insight);
        return acc;
      }, {} as Record<string, DiagnosticInsight[]>);
    },

    // Общий статус системы
    overallSystemStatus: (state) => {
      const criticalCount = state.errors.filter(e => e.severity === 'critical' && !e.resolved).length;
      const systemStatus = state.systemHealth?.status;

      if (criticalCount > 0 || systemStatus === 'critical') {
        return 'critical';
      } else if (systemStatus === 'warning' || (state.errors.filter(e => !e.resolved).length > 5)) {
        return 'warning';
      } else {
        return 'healthy';
      }
    },

    // Проблемные компоненты
    problematicComponents: (state) => {
      const components = new Map<string, number>();

      state.errors.forEach(error => {
        error.affectedComponents.forEach(component => {
          components.set(component, (components.get(component) || 0) + 1);
        });
      });

      return Array.from(components.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
    },

    // Статистика автоисправлений
    autoFixStats: (state) => {
      const total = state.errors.filter(e => e.autoFixable).length;
      const attempted = state.errors.filter(e => e.autoFixAttempts > 0).length;
      const successful = state.errors.filter(e => e.resolved && e.autoFixAttempts > 0).length;
      const failed = attempted - successful;

      return {
        total,
        attempted,
        successful,
        failed,
        successRate: attempted > 0 ? (successful / attempted) * 100 : 0
      };
    }
  },

  actions: {
    /**
     * Загрузка ошибок
     */
    async fetchErrors(filters?: Partial<typeof this.errorFilters>) {
      this.loading.errors = true;
      this.apiErrors.errors = null;

      try {
        const params = new URLSearchParams();

        if (filters?.type) params.append('type', filters.type);
        if (filters?.severity) params.append('severity', filters.severity);
        if (filters?.testType) params.append('testType', filters.testType);
        if (filters?.resolved !== undefined) params.append('resolved', String(filters.resolved));
        if (filters?.startDate) params.append('startDate', filters.startDate.toISOString());
        if (filters?.endDate) params.append('endDate', filters.endDate.toISOString());
        if (filters?.autoFixable !== undefined) params.append('autoFixable', String(filters.autoFixable));

        const response = await axios.get(`/api/diagnostics/errors?${params}`);

        if (response.data.success) {
          this.errors = response.data.data.errors;
        } else {
          throw new Error(response.data.message || 'Failed to fetch errors');
        }

      } catch (error: any) {
        this.apiErrors.errors = error.response?.data?.message || error.message;
        console.error('[EnhancedDiagnosticStore] Error fetching errors:', error);
      } finally {
        this.loading.errors = false;
      }
    },

    /**
     * Загрузка инсайтов
     */
    async fetchInsights() {
      this.loading.insights = true;
      this.apiErrors.insights = null;

      try {
        const response = await axios.get('/api/diagnostics/insights');

        if (response.data.success) {
          this.insights = response.data.data.insights;
        } else {
          throw new Error(response.data.message || 'Failed to fetch insights');
        }

      } catch (error: any) {
        this.apiErrors.insights = error.response?.data?.message || error.message;
        console.error('[EnhancedDiagnosticStore] Error fetching insights:', error);
      } finally {
        this.loading.insights = false;
      }
    },

    /**
     * Загрузка улучшенных метрик системы
     */
    async fetchEnhancedSystemHealth() {
      this.loading.systemHealth = true;
      this.apiErrors.systemHealth = null;

      try {
        const response = await axios.get('/api/diagnostics/system/enhanced');

        if (response.data.success) {
          this.systemHealth = response.data.data;
        } else {
          throw new Error(response.data.message || 'Failed to fetch enhanced system health');
        }

      } catch (error: any) {
        this.apiErrors.systemHealth = error.response?.data?.message || error.message;
        console.error('[EnhancedDiagnosticStore] Error fetching enhanced system health:', error);
      } finally {
        this.loading.systemHealth = false;
      }
    },

    /**
     * Загрузка доступных автоисправлений
     */
    async fetchAutoFixActions() {
      this.loading.autoFixActions = true;
      this.apiErrors.autoFixActions = null;

      try {
        const response = await axios.get('/api/diagnostics/autofix/actions');

        if (response.data.success) {
          this.autoFixActions = response.data.data.actions;
        } else {
          throw new Error(response.data.message || 'Failed to fetch auto-fix actions');
        }

      } catch (error: any) {
        this.apiErrors.autoFixActions = error.response?.data?.message || error.message;
        console.error('[EnhancedDiagnosticStore] Error fetching auto-fix actions:', error);
      } finally {
        this.loading.autoFixActions = false;
      }
    },

    /**
     * Попытка автоисправления ошибки
     */
    async attemptAutoFix(errorId: string): Promise<AutoFixResult> {
      try {
        const response = await axios.post(`/api/diagnostics/autofix/${errorId}`);

        if (response.data.success) {
          // Обновляем локальное состояние
          const error = this.errors.find(e => e.id === errorId);
          if (error) {
            error.autoFixAttempts += 1;
            error.lastAutoFixAt = new Date().toISOString();
            if (response.data.data.fixed) {
              error.resolved = true;
              error.resolvedAt = new Date().toISOString();
            }
          }

          return response.data.data;
        } else {
          throw new Error(response.data.message || 'Failed to attempt auto-fix');
        }

      } catch (error: any) {
        console.error('[EnhancedDiagnosticStore] Error attempting auto-fix:', error);
        throw error;
      }
    },

    /**
     * Разрешение ошибки
     */
    async resolveError(errorId: string) {
      try {
        const response = await axios.put(`/api/diagnostics/errors/${errorId}/resolve`);

        if (response.data.success) {
          const error = this.errors.find(e => e.id === errorId);
          if (error) {
            error.resolved = true;
            error.resolvedAt = new Date().toISOString();
          }
        } else {
          throw new Error(response.data.message || 'Failed to resolve error');
        }

      } catch (error: any) {
        console.error('[EnhancedDiagnosticStore] Error resolving error:', error);
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
        endDate: null,
        autoFixable: null
      };
    },

    /**
     * Обновление настроек
     */
    updateSettings(newSettings: Partial<typeof this.settings>) {
      Object.assign(this.settings, newSettings);
    },

    /**
     * Обработка WebSocket сообщения об ошибке
     */
    handleDiagnosticError(errorData: EnhancedError) {
      // Добавляем новую ошибку в начало списка
      this.errors.unshift(errorData);

      // Ограничиваем количество ошибок в памяти
      if (this.errors.length > this.settings.maxErrors) {
        this.errors = this.errors.slice(0, this.settings.maxErrors);
      }
    },

    /**
     * Обработка WebSocket сообщения об инсайте
     */
    handleDiagnosticInsight(insightData: DiagnosticInsight) {
      this.insights.unshift(insightData);

      // Ограничиваем количество инсайтов
      if (this.insights.length > 100) {
        this.insights = this.insights.slice(0, 100);
      }
    },

    /**
     * Обработка WebSocket сообщения о исправлении
     */
    handleErrorResolved(errorId: string) {
      const error = this.errors.find(e => e.id === errorId);
      if (error) {
        error.resolved = true;
        error.resolvedAt = new Date().toISOString();
      }
    },

    /**
     * Автоматическое исправление критических ошибок
     */
    async autoFixCriticalErrors() {
      const criticalErrors = this.criticalErrors;

      for (const error of criticalErrors) {
        if (error.autoFixable && error.autoFixAttempts < 3) {
          try {
            await this.attemptAutoFix(error.id);
          } catch (error: any) {
            console.error(`[EnhancedDiagnosticStore] Auto-fix failed for error ${error.id}:`, error instanceof Error ? error.message : String(error));
          }
        }
      }
    },

    /**
     * Экспорт данных для отчета
     */
    exportDiagnosticReport() {
      return {
        timestamp: new Date().toISOString(),
        errors: this.errors,
        insights: this.insights,
        systemHealth: this.systemHealth,
        stats: {
          totalErrors: this.errors.length,
          criticalErrors: this.criticalErrors.length,
          autoFixableErrors: this.autoFixableErrors.length,
          autoFixStats: this.autoFixStats,
          problematicComponents: this.problematicComponents
        }
      };
    }
  }
});
