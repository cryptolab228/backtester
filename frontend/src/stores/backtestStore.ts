import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Ref } from 'vue';
import type { 
  BacktestRunParameters, 
  BacktestResult, 
  PortfolioBacktestRunParameters, 
  PortfolioBacktestResult 
} from '@/types/strategy';
import { postWithAbort } from '@/services/apiService';
import type { AxiosResponse } from 'axios';

export interface BacktestState {
  isLoading: Ref<boolean>;
  results: Ref<BacktestResult | null>;
  portfolioResults: Ref<PortfolioBacktestResult | null>;
  error: Ref<string | null>;
  currentAbortController: AbortController | null;
  isPortfolioMode: Ref<boolean>;
}

export const useBacktestStore = defineStore('backtest', {
  state: (): BacktestState => ({
    isLoading: ref(false),
    results: ref(null),
    portfolioResults: ref(null),
    error: ref(null),
    currentAbortController: null,
    isPortfolioMode: ref(false),
  }),
  actions: {
    toggleMode() {
      this.isPortfolioMode = !this.isPortfolioMode;
      this.clearResults();
    },

    setPortfolioMode(isPortfolio: boolean) {
      this.isPortfolioMode = isPortfolio;
      this.clearResults();
    },

    // Новая функция для безопасного восстановления режима без очистки результатов
    restorePortfolioMode(isPortfolio: boolean) {
      this.isPortfolioMode = isPortfolio;
      // НЕ вызываем clearResults() при восстановлении состояния
    },

    async runBacktest(params: BacktestRunParameters): Promise<AxiosResponse<any>> {
      if (this.currentAbortController) {
        console.warn('[BacktestStore] A backtest operation was already in progress. Aborting the previous one.');
        this.currentAbortController.abort();
      }

      this.currentAbortController = new AbortController();
      const signal = this.currentAbortController.signal;

      try {
        const abortablePromise = postWithAbort<any>('/backtest/run', params, signal);
        const response: AxiosResponse<any> = await abortablePromise.promise;
        return response;

      } catch (err: any) {
        if (err.name === 'AbortError') {
          console.log('[BacktestStore] Backtest aborted by user in runBacktest.');
          this.currentAbortController = null; 
          throw { name: 'AbortError', message: 'Backtest was aborted.', response: null }; 
        } else {
          console.error('[BacktestStore] Error running backtest:', err.response?.data?.message || err.message, err);
          this.currentAbortController = null;
          throw err; 
        }
      } 
    },

    async runPortfolioBacktest(params: PortfolioBacktestRunParameters): Promise<AxiosResponse<any>> {
      if (this.currentAbortController) {
        console.warn('[BacktestStore] A portfolio backtest operation was already in progress. Aborting the previous one.');
        this.currentAbortController.abort();
      }

      this.currentAbortController = new AbortController();
      const signal = this.currentAbortController.signal;

      try {
        const abortablePromise = postWithAbort<any>('/backtest/portfolio/run', params, signal);
        const response: AxiosResponse<any> = await abortablePromise.promise;
        return response;

      } catch (err: any) {
        if (err.name === 'AbortError') {
          console.log('[BacktestStore] Portfolio backtest aborted by user.');
          this.currentAbortController = null; 
          throw { name: 'AbortError', message: 'Portfolio backtest was aborted.', response: null }; 
        } else {
          console.error('[BacktestStore] Error running portfolio backtest:', err.response?.data?.message || err.message, err);
          this.currentAbortController = null;
          throw err; 
        }
      } 
    },

    abortRequest() {
      if (this.currentAbortController) {
        console.log('[BacktestStore] Backtest abortion requested via store action.');
        this.currentAbortController.abort();
        this.currentAbortController = null; 
      } else {
        console.log('[BacktestStore] No active backtest to abort via store action.');
      }
    },

    clearCurrentAbortController() {
      if (this.currentAbortController) {
        console.log('[BacktestStore] Clearing currentAbortController explicitly.');
        this.currentAbortController = null;
      } else {
        console.log('[BacktestStore] No currentAbortController to clear explicitly.');
      }
    },

    // НОВОЕ: Принудительная очистка состояния загрузки
    forceStateCleanup() {
      if (this.isLoading) {
        console.warn('[BacktestStore] Forcing state cleanup due to stuck loading state');
        this.isLoading = false;
        this.error = 'Превышено время ожидания выполнения бэктеста';
        this.clearCurrentAbortController();
      }
    },

    // НОВОЕ: Установка результатов с автоматической очисткой состояния загрузки
    setResults(results: BacktestResult) {
      this.results = results;
      this.error = null;
      this.isLoading = false;
      this.clearCurrentAbortController();
    },

    setPortfolioResults(results: PortfolioBacktestResult) {
      this.portfolioResults = results;
      this.error = null;
      this.isLoading = false;
      this.clearCurrentAbortController();
    },

    setError(error: string) {
      this.error = error;
      this.isLoading = false;
      this.clearCurrentAbortController();
    },

    clearResults() {
      this.results = null;
      this.portfolioResults = null;
      this.error = null;
      this.isLoading = false;
      if (this.currentAbortController) {
        console.log('[BacktestStore] Clearing results and aborting any ongoing request.');
        this.currentAbortController.abort();
        this.currentAbortController = null;
      }
    }
  },
}); 