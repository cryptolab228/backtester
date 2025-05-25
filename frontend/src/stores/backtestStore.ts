import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Ref } from 'vue';
import type { BacktestRunParameters, BacktestResult } from '@/types/strategy';
import { postWithAbort } from '@/services/apiService';
import type { AxiosResponse } from 'axios';

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
    // Обновляем тип возвращаемого значения для ясности, что это AxiosResponse
    async runBacktest(params: BacktestRunParameters): Promise<AxiosResponse<any>> { // Тип AxiosResponse<any>
      // Установка isLoading и сброс error/results теперь происходит в компоненте ПЕРЕД вызовом этого action,
      // так как компонент должен немедленно отреагировать.
      // this.isLoading = true;
      // this.results = null;
      // this.error = null;
      
      if (this.currentAbortController) {
        console.warn('[BacktestStore] A backtest operation was already in progress. Aborting the previous one.');
        this.currentAbortController.abort();
        // Не очищаем здесь, так как новый будет создан ниже
      }

      this.currentAbortController = new AbortController();
      const signal = this.currentAbortController.signal;

      try {
        // postWithAbort теперь возвращает AbortablePromise<AxiosResponse<any>>
        const abortablePromise = postWithAbort<any>('/backtest/run', params, signal);
        
        const response: AxiosResponse<any> = await abortablePromise.promise;

        // Логика обработки response (установка isLoading, results, error) остается в компоненте.
        // Store только возвращает полный ответ.

        return response;

      } catch (err: any) {
        // this.isLoading = false; // Компонент обработает isLoading в своем catch
        // this.results = null; 

        if (err.name === 'AbortError') {
          // this.error = 'Backtest was aborted.'; // Компонент может показать свой toast
          console.log('[BacktestStore] Backtest aborted by user in runBacktest.');
          // После AbortError, контроллер больше не нужен для ЭТОЙ операции
          this.currentAbortController = null; 
          throw { name: 'AbortError', message: 'Backtest was aborted.', response: null }; 
        } else {
          // this.error = err.response?.data?.message || err.message || 'Failed to run backtest';
          console.error('[BacktestStore] Error running backtest:', err.response?.data?.message || err.message, err);
          // Если произошла другая ошибка, контроллер для текущей неудачной операции тоже больше не нужен
          this.currentAbortController = null;
          throw err; 
        }
      } 
      // finally блок здесь не нужен для currentAbortController, так как он обрабатывается в try/catch
      // или будет обработан при следующем запуске, или через clearCurrentAbortController
    },

    abortRequest() {
      if (this.currentAbortController) {
        console.log('[BacktestStore] Backtest abortion requested via store action.');
        this.currentAbortController.abort();
        // Очищаем контроллер сразу после запроса на отмену, так как он свою функцию выполнил.
        // Обработка последствий отмены (например, isLoading, error) произойдет в runBacktest или компоненте.
        this.currentAbortController = null; 
      } else {
        console.log('[BacktestStore] No active backtest to abort via store action.');
      }
    },

    clearCurrentAbortController() {
      if (this.currentAbortController) {
        console.log('[BacktestStore] Clearing currentAbortController explicitly.');
        // Можно на всякий случай вызвать abort, если он еще не был вызван,
        // но это может быть излишним, если clear вызывается после завершения.
        // this.currentAbortController.abort(); 
        this.currentAbortController = null;
      } else {
        console.log('[BacktestStore] No currentAbortController to clear explicitly.');
      }
    },

    clearResults() {
      this.results = null;
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