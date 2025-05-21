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
    // period: undefined, // Можно оставить undefined или задать значение
    numProfiles: 1,
    pocColor: '#FF0000',
    vahColor: '#00FF00',
    valColor: '#0000FF',
    numBins: 20,
    vaPercentage: 0.7,
  },
  nwe: {
    lookbackPeriod: 20,
    atrPeriod: 10,
    atrMultiplier: 2,
    upColor: '#00FFFF',
    downColor: '#FFFF00',
  },
  clusters: {
    source: 'volume',
    thresholdMultiplier: 2,
    lookbackPeriod: 20,
    confirmationBars: 0,
    buyColor: '#00FF00',
    sellColor: '#FF0000',
  },
  risk: { // Изменено с riskManagement на risk
    atrPeriod: 14,
    stopLossMultiplier: 1.5,
    takeProfitMultiplier: 3,
    useTrailingStop: false,
    trailingStopOffsetMultiplier: 1,
    maxTradesPerDay: 0, // 0 - без ограничений
    positionSizePercentage: 0.01, 
    maxRiskPerTradePercentage: 0.01, 
  },
  globalAtrPeriod: 14,
  avgVolumePeriod: 20,
};

// Функция для безопасной загрузки и ОЧИСТКИ из localStorage
const loadParametersFromLocalStorage = (): StrategyParameters | null => {
  try {
    const stored = localStorage.getItem(STRATEGY_PARAMS_LOCAL_STORAGE_KEY);
    if (stored) {
      const parsedStored = JSON.parse(stored);
      // Очистка: создаем новый объект только с ожидаемыми полями из initialStrategyParameters
      // и их вложенных структур.
      const cleanParameters: StrategyParameters = {};

      if (parsedStored.dlc) {
        cleanParameters.dlc = {};
        for (const key in initialStrategyParameters.dlc) {
          if (Object.prototype.hasOwnProperty.call(initialStrategyParameters.dlc, key) && 
              Object.prototype.hasOwnProperty.call(parsedStored.dlc, key)) {
            (cleanParameters.dlc as any)[key] = parsedStored.dlc[key];
          }
        }
      } else {
        cleanParameters.dlc = JSON.parse(JSON.stringify(initialStrategyParameters.dlc));
      }

      if (parsedStored.nwe) {
        cleanParameters.nwe = {};
        for (const key in initialStrategyParameters.nwe) {
          if (Object.prototype.hasOwnProperty.call(initialStrategyParameters.nwe, key) &&
              Object.prototype.hasOwnProperty.call(parsedStored.nwe, key)) {
            (cleanParameters.nwe as any)[key] = parsedStored.nwe[key];
          }
        }
      } else {
        cleanParameters.nwe = JSON.parse(JSON.stringify(initialStrategyParameters.nwe));
      }

      if (parsedStored.clusters) {
        cleanParameters.clusters = {};
        for (const key in initialStrategyParameters.clusters) {
          if (Object.prototype.hasOwnProperty.call(initialStrategyParameters.clusters, key) &&
              Object.prototype.hasOwnProperty.call(parsedStored.clusters, key)) {
            (cleanParameters.clusters as any)[key] = parsedStored.clusters[key];
          }
        }
      } else {
        cleanParameters.clusters = JSON.parse(JSON.stringify(initialStrategyParameters.clusters));
      }

      if (parsedStored.risk) {
        cleanParameters.risk = {};
        for (const key in initialStrategyParameters.risk) {
          if (Object.prototype.hasOwnProperty.call(initialStrategyParameters.risk, key) &&
              Object.prototype.hasOwnProperty.call(parsedStored.risk, key)) {
            (cleanParameters.risk as any)[key] = parsedStored.risk[key];
          }
        }
      } else {
        cleanParameters.risk = JSON.parse(JSON.stringify(initialStrategyParameters.risk));
      }
      
      // Копируем корневые поля globalAtrPeriod и avgVolumePeriod, если они есть в stored
      if (Object.prototype.hasOwnProperty.call(parsedStored, 'globalAtrPeriod')) {
        cleanParameters.globalAtrPeriod = parsedStored.globalAtrPeriod;
      } else {
        cleanParameters.globalAtrPeriod = initialStrategyParameters.globalAtrPeriod;
      }
      if (Object.prototype.hasOwnProperty.call(parsedStored, 'avgVolumePeriod')) {
        cleanParameters.avgVolumePeriod = parsedStored.avgVolumePeriod;
      } else {
        cleanParameters.avgVolumePeriod = initialStrategyParameters.avgVolumePeriod;
      }
      
      // Важно: после очистки, сохраняем очищенные параметры обратно в localStorage,
      // чтобы при следующей загрузке не повторять процесс для тех же "грязных" данных.
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