import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Ref } from 'vue';
import type { BacktestRunParameters, BacktestResult } from '@/types/strategy';
import { postWithAbort, type AbortablePromise } from '@/services/apiService'; // Используем postWithAbort

export interface BacktestState {
  isLoading: Ref<boolean>;
  results: Ref<BacktestResult | null>;
  error: Ref<string | null>;
  currentAbortController: AbortController | null; // Изменено для хранения контроллера
}

export const useBacktestStore = defineStore('backtest', {
  state: (): BacktestState => ({
    isLoading: ref(false),
    results: ref(null),
    error: ref(null),
    currentAbortController: null, // Инициализация
  }),
  actions: {
    async runBacktest(params: BacktestRunParameters) {
      this.isLoading = true;
      this.results = null;
      this.error = null;
      
      if (this.currentAbortController) {
        console.warn('A backtest is already running. Aborting the previous one.');
        this.currentAbortController.abort();
      }

      this.currentAbortController = new AbortController();
      const signal = this.currentAbortController.signal;

      try {
        const abortable: AbortablePromise<BacktestResult> = postWithAbort<BacktestResult>('/backtest/run', params, signal);
        // currentAbortablePromise больше не нужен, так как abort() вызывается через currentAbortController
        
        const responseData = await abortable.promise;
        this.results = responseData;
        console.log('Backtest results:', responseData);
      } catch (err: any) {
        if (err.name === 'AbortError') {
          this.error = 'Backtest was aborted.';
          console.log('Backtest aborted by user.');
        } else {
          this.error = err.response?.data?.message || err.message || 'Failed to run backtest';
          console.error('Error running backtest:', this.error, err);
        }
        this.results = null; // Очищаем результаты при ошибке
      } finally {
        this.isLoading = false;
        this.currentAbortController = null; // Очищаем контроллер после завершения/ошибки/отмены
      }
    },

    abortRequest() {
      if (this.currentAbortController) {
        this.currentAbortController.abort();
        console.log('Backtest abortion requested.');
      } else {
        console.log('No active backtest to abort.');
      }
    },

    clearResults() {
      this.results = null;
      this.error = null;
      this.isLoading = false;
      if (this.currentAbortController) {
        this.currentAbortController.abort(); // Также отменяем, если очищаем результаты во время выполнения
        this.currentAbortController = null;
      }
    }
  },
}); 