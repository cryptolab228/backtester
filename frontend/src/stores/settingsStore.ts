import { defineStore } from 'pinia';
// import { ref } from 'vue'; // <-- Удаляем неиспользуемый импорт
// import type { Ref } from 'vue'; // <-- Удаляем неиспользуемый импорт
// import { apiClient } from '@/services/apiService'; // Больше не нужен для этого стора
import type { StrategyParameters } from '@/types/strategy';
import { getTradingPairs } from '@/services/apiService'; // <-- Импорт

const STRATEGY_PARAMS_LOCAL_STORAGE_KEY = 'strategyParameters';

export interface TradingPairItem { // <-- Интерфейс для элементов списка
  label: string; // symbol
  value: string; // symbol (или id, если нужно)
}
export interface SettingsState {
  parameters: StrategyParameters;
  isLoading: boolean;
  error: string | null;
  availableTradingPairs: TradingPairItem[]; // <-- Новое состояние
}

// Состояние по умолчанию для параметров стратегии
// Адаптировано к новым типам, соответствующим backend/src/modules/strategy_logic/strategy.ts
const initialStrategyParameters: StrategyParameters = {
  dlc: {
    period: 40, // Новый параметр из Pine: dlc_period
    pocLookback: 5, // Новый параметр из Pine: poc_lookback
    numProfiles: 1, 
    pocColor: '#FF0000',
    vahColor: '#00FF00',
    valColor: '#0000FF',
    numBins: 100, // Изменено с 20 на 100, чтобы соответствовать внутренней логике Pine для профиля
    vaPercentage: 0.7, // Соответствует Pine: value_area_percent (70.0 / 100)
  },
  nwe: {
    enabled: true, // Новый параметр из Pine: use_nwe
    bandwidth: 8.0, // Новый параметр из Pine: h
    multiplier: 3.0, // Переименовано с atrMultiplier и значение изменено (Pine: mult)
    source: 'close', // Новый параметр из Pine: nwe_src
    repaint: false, // Новый параметр из Pine: repaint
    // lookbackPeriod и atrPeriod удалены, т.к. не имеют прямого аналога во входных данных Pine NWE
    upColor: '#00FFFF',
    downColor: '#FFFF00',
  },
  clusters: {
    source: 'volume',
    minVolumeThresholdMultiplier: 1.5, // Переименовано с thresholdMultiplier и значение изменено (Pine: min_volume_threshold)
    deltaThreshold: 0.7, // Новый параметр из Pine: delta_threshold
    lookbackPeriod: 20, // Соответствует периоду SMA для avg_volume в Pine
    confirmationBars: 1, // Изменено с 0, чтобы соответствовать Pine: cluster[1]
    buyColor: '#00FF00',
    sellColor: '#FF0000',
  },
  risk: { // Изменено с riskManagement на risk
    atrPeriod: 14, // Соответствует Pine: atr_period
    positionSizePercentage: 0.02, // Изменено с 0.01 (Pine: risk_percent 2.0 / 100)
    stopLossMultiplier: 2.0, // Изменено с 1.5 (Pine: stop_loss_atr)
    takeProfitMultiplier: 5.0, // Изменено с 3 (Pine: take_profit_atr)
    useTrailingStop: true, // Изменено с false (Pine: use_trailing_stop)
    trailingStopOffsetMultiplier: 2.0, // Изменено с 1 (Pine: trail_offset_mult)
    trailingStopStepMultiplier: 1.0, // Новый параметр из Pine: trailing_step (используется для trail_step)
    maxTradesPerDay: 2, // Изменено с 0 (Pine: max_trades_per_day)
    maxRiskPerTradePercentage: 0.01, // Существующий параметр, нет прямого аналога в Pine, но может использоваться для доп. контроля
  },
  // globalAtrPeriod и avgVolumePeriod удалены, используются аналоги внутри risk и clusters
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
    };
  },
  getters: {
    currentSettings(state): StrategyParameters {
      // Гарантируем, что всегда возвращается объект, а не null
      return state.parameters;
    },
    // Геттер для списка пар, чтобы напрямую использовать в компоненте
    tradingPairOptions(state): TradingPairItem[] {
        return state.availableTradingPairs;
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
    // Новое действие для загрузки торговых пар
    async fetchAvailableTradingPairs() {
      if (this.availableTradingPairs.length > 0) {
        // Опционально: не перезагружать, если уже есть данные
        // console.log('Trading pairs already loaded.');
        // return;
      }
      this.isLoading = true;
      this.error = null;
      try {
        const pairsFromApi = await getTradingPairs(); // { id: number, symbol: string }[]
        this.availableTradingPairs = pairsFromApi.map(p => ({
          label: p.symbol, // Отображаемый текст
          value: p.symbol  // Значение, которое будет использоваться в v-model
        }));
        console.log('Available trading pairs loaded:', this.availableTradingPairs);
      } catch (err: any) {
        this.error = err.message || 'Failed to fetch trading pairs';
        console.error('Error fetching trading pairs:', this.error);
        this.availableTradingPairs = []; // Очищаем в случае ошибки
      }
      this.isLoading = false;
    }
  },
}); 