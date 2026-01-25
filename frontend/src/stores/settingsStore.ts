import { defineStore } from 'pinia';
// import { ref } from 'vue'; // <-- Удаляем неиспользуемый импорт
// import type { Ref } from 'vue'; // <-- Удаляем неиспользуемый импорт
// import { apiClient } from '@/services/apiService'; // Больше не нужен для этого стора
import type { StrategyParameters } from '@/types/strategy';
import { getAvailableTradingPairs } from '@/services/apiService'; // <-- Импорт без getTradingPairs
import { apiClient } from '@/services/apiService'; // <-- Импорт apiClient

// Добавляем версионирование для автоматического обновления дефолтов при изменении структуры
const STRATEGY_PARAMS_VERSION = '1.2'; // Увеличено с 1.1 до 1.2 для обновления на новые проф. параметры
const STRATEGY_PARAMS_LOCAL_STORAGE_KEY = `strategyParameters_v${STRATEGY_PARAMS_VERSION}`;

export interface TradingPairItem { // <-- Интерфейс для элементов списка
  label: string; // symbol
  value: string; // symbol (или id, если нужно)
}
export interface SettingsState {
  parameters: StrategyParameters;
  isLoading: boolean;
  error: string | null;
  availableTradingPairs: TradingPairItem[]; // <-- Новое состояние
  filteredTradingPairs: TradingPairItem[]; // <-- Отфильтрованные пары для поиска
  selectedExchange: 'okx' | 'bybit'; // НОВОЕ: выбранная биржа
}

export interface PairMetricRequest {
  exchange: 'okx' | 'bybit';
  metric: 'volume' | 'volatility';
  period: 7 | 14 | 30;
}

export interface PairMetricResponseItem {
  symbol: string;
  exchange?: string;
  metricValue: number;
}

export interface PairMetricResponse {
  exchange: string;
  metric: 'volume' | 'volatility';
  period: number;
  pairs: PairMetricResponseItem[];
  generatedAt?: string;
}

// Состояние по умолчанию для параметров стратегии
// Адаптировано к новым типам, соответствующим backend/src/modules/strategy_logic/strategy.ts
const initialStrategyParameters: StrategyParameters = {
  dlc: {
    period: 24, // Рекомендовано: 24 (длина сессии для 1h)
    pocLookback: 5,
    numProfiles: 1, 
    pocColor: '#FF0000',
    vahColor: '#00FF00',
    valColor: '#0000FF',
    numBins: 100,
    vaPercentage: 0.7, // Соответствует стандарту CME
  },
  nwe: {
    enabled: true,
    bandwidth: 8.0,
    multiplier: 2.2, // Рекомендовано: 2.2 (правило 2 SD)
    source: 'close',
    repaint: false,
    upColor: '#00FFFF',
    downColor: '#FFFF00',
  },
  clusters: {
    source: 'volume',
    minVolumeThresholdMultiplier: 2.0, // Рекомендовано: 2.0 (отсечение шума)
    deltaThreshold: 0.7,
    lookbackPeriod: 20,
    confirmationBars: 1,
    buyColor: '#00FF00',
    sellColor: '#FF0000',
  },
  risk: {
    atrPeriod: 14,
    positionSizePercentage: 0.02,
    stopLossMultiplier: 2.0,
    takeProfitMultiplier: 5.0,
    useTrailingStop: true,
    trailingStopOffsetMultiplier: 1.5,
    trailingStopStepMultiplier: 0.25,
    maxTradesPerDay: 2,
    maxRiskPerTradePercentage: 0.02, // Синхронизировано с positionSizePercentage
    exitOnOppositeSignal: false,
  },
};

// Функция для безопасной загрузки и ОЧИСТКИ из localStorage
const loadParametersFromLocalStorage = (): StrategyParameters | null => {
  try {
    const stored = localStorage.getItem(STRATEGY_PARAMS_LOCAL_STORAGE_KEY);
    if (stored) {
      const parsedStored = JSON.parse(stored);
      const cleanParameters: StrategyParameters = {};

      // Обновленная логика для каждого под-объекта параметров
      const loadSubParameters = <T extends Record<string, any>>(
        initialSubParams: T,
        parsedSubParams: Partial<T> | undefined
      ): T => {
        const cleanSub: Partial<T> = {};
        if (parsedSubParams) {
          for (const key in initialSubParams) {
            if (Object.prototype.hasOwnProperty.call(initialSubParams, key)) {
              if (Object.prototype.hasOwnProperty.call(parsedSubParams, key) && parsedSubParams[key] !== undefined) {
                cleanSub[key as keyof T] = parsedSubParams[key as keyof T]; // Используем значение из localStorage, если оно есть
              } else {
                cleanSub[key as keyof T] = initialSubParams[key]; // Иначе используем значение по умолчанию
              }
            }
          }
           // Проверка на старые поля, которые могли быть переименованы
           if ('atrMultiplier' in parsedSubParams && initialSubParams === initialStrategyParameters.nwe) {
            // Если есть старый atrMultiplier в NWE и multiplier не установлен из localStorage,
            // можно попытаться его перенести, но безопаснее использовать новое значение по умолчанию.
            // Для простоты пока оставляем новое значение по умолчанию.
          }
          if ('thresholdMultiplier' in parsedSubParams && initialSubParams === initialStrategyParameters.clusters) {
            // Аналогично для clusters.thresholdMultiplier -> minVolumeThresholdMultiplier
          }
        } else {
          // Если в localStorage нет такого под-объекта, полностью используем значения по умолчанию
          return JSON.parse(JSON.stringify(initialSubParams));
        }
        return cleanSub as T; // Возвращаем собранный объект
      };
      
      cleanParameters.dlc = loadSubParameters(initialStrategyParameters.dlc!, parsedStored.dlc);
      cleanParameters.nwe = loadSubParameters(initialStrategyParameters.nwe!, parsedStored.nwe);
      cleanParameters.clusters = loadSubParameters(initialStrategyParameters.clusters!, parsedStored.clusters);
      cleanParameters.risk = loadSubParameters(initialStrategyParameters.risk!, parsedStored.risk);
      
      // Удаляем загрузку устаревших корневых полей globalAtrPeriod и avgVolumePeriod
      // if (Object.prototype.hasOwnProperty.call(parsedStored, 'globalAtrPeriod')) { ... } // Удалено
      // if (Object.prototype.hasOwnProperty.call(parsedStored, 'avgVolumePeriod')) { ... } // Удалено
            
      localStorage.setItem(STRATEGY_PARAMS_LOCAL_STORAGE_KEY, JSON.stringify(cleanParameters));
      return cleanParameters;
    }
  } catch (error) {
    console.error('Error loading or cleaning strategy parameters from localStorage:', error);
    localStorage.removeItem(STRATEGY_PARAMS_LOCAL_STORAGE_KEY); // Очистить некорректные данные
  }
  return null;
};

export const useSettingsStore = defineStore('settings', {
  state: (): SettingsState => {
    const storedParameters = loadParametersFromLocalStorage();
    return {
      parameters: storedParameters || JSON.parse(JSON.stringify(initialStrategyParameters)),
      isLoading: false,
      error: null,
      availableTradingPairs: [], // <-- Инициализация нового состояния
      filteredTradingPairs: [], // <-- Инициализация отфильтрованного состояния
      selectedExchange: 'bybit', // НОВОЕ: по умолчанию Bybit как более быстрый
    };
  },
  getters: {
    currentSettings(state): StrategyParameters {
      // Гарантируем, что всегда возвращается объект, а не null
      return state.parameters;
    },
    // Геттер для списка пар, чтобы напрямую использовать в компоненте
    tradingPairOptions(state): TradingPairItem[] {
        return state.filteredTradingPairs.length > 0 ? state.filteredTradingPairs : state.availableTradingPairs;
    }
  },
  actions: {
    // fetchSettings больше не нужен, так как загрузка происходит при инициализации state
    // async fetchSettings() { ... }

    updateSettings(newParameters: Partial<StrategyParameters>) {
      // Позволяем частичное обновление, но затем сохраняем полный объект
      // Это полезно, если мы обновляем только одну секцию параметров, например, dlc
      this.isLoading = true; // Если будут какие-то проверки перед сохранением
      this.error = null;
      try {
        // Глубокое слияние newParameters с текущими параметрами
        // Object.assign не подходит для глубокого слияния, нужна более сложная логика или библиотека (lodash.merge)
        // Для простоты, пока что ожидаем, что newParameters это полный объект или 
        // вызывающий код сам позаботится о слиянии перед вызовом.
        // Либо, мы можем сделать этот метод принимающим весь StrategyParameters.
        // Давайте сделаем его принимающим полный объект для простоты, как и было.
        // Если newParameters - это StrategyParameters (не Partial):
        this.parameters = { ...this.parameters, ...newParameters }; 
        // Для глубокого слияния, если newParameters может быть Partial и содержать вложенные Partial:
        // this.parameters = mergeDeep(this.parameters, newParameters) - где mergeDeep - кастомная функция или из lodash
        
        // Пока что, если newParameters это полный объект StrategyParameters, как предполагалось ранее:
        this.parameters = JSON.parse(JSON.stringify(newParameters));

        localStorage.setItem(STRATEGY_PARAMS_LOCAL_STORAGE_KEY, JSON.stringify(this.parameters));
        console.log('Strategy parameters updated in store and localStorage:', this.parameters);
      } catch (err: any) {
        this.error = err.message || 'Failed to update strategy parameters';
        console.error('Error updating strategy parameters:', this.error);
      }
      this.isLoading = false;
    },
    setSettings(parameters: StrategyParameters) {
      this.parameters = JSON.parse(JSON.stringify(parameters));
      localStorage.setItem(STRATEGY_PARAMS_LOCAL_STORAGE_KEY, JSON.stringify(this.parameters));
    },
    // Сброс настроек к значениям по умолчанию
    resetToDefaults() {
      this.parameters = JSON.parse(JSON.stringify(initialStrategyParameters));
      localStorage.setItem(STRATEGY_PARAMS_LOCAL_STORAGE_KEY, JSON.stringify(this.parameters));
      console.log('Strategy parameters reset to defaults.');
    },
    // НОВОЕ: действие для смены биржи с оптимизацией
    setExchange(exchange: 'okx' | 'bybit') {
      if (this.selectedExchange === exchange) {
        return; // Нет необходимости менять если биржа та же
      }
      
      const previousExchange = this.selectedExchange;
      this.selectedExchange = exchange;
      
      // Очищаем текущие торговые пары и фильтры
      this.availableTradingPairs = [];
      this.filteredTradingPairs = [];

      console.log(`Exchange changed from ${previousExchange} to ${exchange}`);
      
      // Асинхронно загружаем пары для новой биржи с проверкой кэша
      this.fetchAvailableTradingPairs();
    },
    
    // Обновленное действие для загрузки торговых пар с поддержкой биржи и кэширования
    async fetchAvailableTradingPairs(forceReload: boolean = false) {
      // Проверяем кэш с учетом биржи
      const cacheKey = `trading_pairs_${this.selectedExchange}`;
      const cachedData = localStorage.getItem(cacheKey);
      const cacheExpiry = localStorage.getItem(`${cacheKey}_expiry`);
      
      if (!forceReload && cachedData && cacheExpiry) {
        const isExpired = Date.now() > parseInt(cacheExpiry);
        if (!isExpired) {
          try {
            this.availableTradingPairs = JSON.parse(cachedData);
            console.log(`Trading pairs loaded from cache for ${this.selectedExchange}:`, this.availableTradingPairs.length, 'pairs');
            return;
          } catch (error) {
            console.warn('Failed to parse cached trading pairs, fetching fresh data');
          }
        }
      }
      
      if (this.availableTradingPairs.length > 0 && !forceReload) {
        console.log('Trading pairs already loaded for', this.selectedExchange);
        return;
      }
      
      this.isLoading = true;
      this.error = null;
      try {
        console.log(`Fetching trading pairs for ${this.selectedExchange}...`);
        const pairsFromApi = await getAvailableTradingPairs(this.selectedExchange);
        
        // Оптимизированная обработка большого количества пар
        this.availableTradingPairs = pairsFromApi
          .sort((a, b) => a.symbol.localeCompare(b.symbol)) // Сортируем по алфавиту
          .map(p => ({
            label: p.symbol, // Отображаемый текст
            value: p.symbol  // Значение, которое будет использоваться в v-model
          }));
        
        // Кэшируем данные на 10 минут
        const expiryTime = Date.now() + (10 * 60 * 1000);
        localStorage.setItem(cacheKey, JSON.stringify(this.availableTradingPairs));
        localStorage.setItem(`${cacheKey}_expiry`, expiryTime.toString());
        
        console.log(`Available trading pairs loaded for ${this.selectedExchange}:`, this.availableTradingPairs.length, 'pairs');
      } catch (err: any) {
        this.error = err.message || 'Failed to fetch trading pairs';
        console.error('Error fetching trading pairs:', this.error);
        this.availableTradingPairs = []; // Очищаем в случае ошибки
        
        // Очищаем кэш при ошибке
        localStorage.removeItem(cacheKey);
        localStorage.removeItem(`${cacheKey}_expiry`);
      }
      this.isLoading = false;
    },

    // Действие для фильтрации торговых пар
    filterTradingPairs(query: string) {
      if (!query || query.trim() === '') {
        this.filteredTradingPairs = [];
        return;
      }

      const searchTerm = query.toLowerCase().trim();

      // Оптимизированная фильтрация - показываем только первые 100 результатов
      const filtered = this.availableTradingPairs
        .filter(pair => pair.label.toLowerCase().includes(searchTerm))
        .slice(0, 100); // Ограничиваем до 100 результатов для производительности

      this.filteredTradingPairs = filtered;

      console.log(`Filtered trading pairs: ${filtered.length} results for query "${query}"`);
    },

    // Действие для очистки фильтра
    clearTradingPairsFilter() {
      this.filteredTradingPairs = [];
    },

    async fetchPairMetricsAndSort(request: PairMetricRequest): Promise<PairMetricResponseItem[]> {
      const cacheKey = `pair_metrics_${request.exchange}_${request.metric}_${request.period}`;
      const expiryKey = `${cacheKey}_expiry`;
      const cached = localStorage.getItem(cacheKey);
      const expiry = localStorage.getItem(expiryKey);

      if (cached && expiry && Date.now() < parseInt(expiry)) {
        try {
          const parsed: PairMetricResponseItem[] = JSON.parse(cached);
          if (Array.isArray(parsed)) {
            return parsed;
          }
        } catch (error) {
          console.warn('Failed to parse cached pair metrics, refetching...');
        }
      }

      this.isLoading = true;
      this.error = null;
      try {
        const response = await apiClient.get<PairMetricResponse>('/scanner/pair-metrics', {
          params: request,
        });

        if (!response.data || !Array.isArray(response.data.pairs)) {
          throw new Error('Некорректный ответ сервера');
        }

        const normalized = response.data.pairs
          .filter((item) => item && item.symbol)
          .map((item) => ({
            symbol: item.symbol.toUpperCase(),
            exchange: (item.exchange || request.exchange) as 'okx' | 'bybit',
            metricValue: Number(item.metricValue) || 0,
          }))
          .sort((a, b) => b.metricValue - a.metricValue);

        localStorage.setItem(cacheKey, JSON.stringify(normalized));
        localStorage.setItem(expiryKey, (Date.now() + 5 * 60 * 1000).toString());
        return normalized;
      } catch (error: any) {
        this.error = error?.message || 'Не удалось получить метрики пар';
        console.error('[settingsStore] fetchPairMetricsAndSort error', error);
        throw error;
      } finally {
        this.isLoading = false;
      }
    },
  },
}); 