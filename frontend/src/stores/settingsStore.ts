import { defineStore } from 'pinia';
import { apiClient } from '@/services/apiService'; // Обновленный импорт
import type { StrategyParameters } from '@/types/strategy'; // Обновленный путь к типам, без .d

// Тип для состояния хранилища, включая флаги загрузки и ошибок
export interface SettingsState {
  parameters: StrategyParameters | null;
  isLoading: boolean;
  error: string | null;
}

// Значения по умолчанию для инициализации, если они не придут с бэкенда сразу
// Это должно совпадать с DefaultStrategyParameters на бэкенде или быть достаточно универсальным
const initialDefaultParameters: StrategyParameters = {
  dlc: {
    numProfiles: 1,
    pocColor: '#FF0000',
    vahColor: '#00FF00',
    valColor: '#0000FF',
    numBins: 20,
    vaPercentage: 0.7,
    period: undefined, // Добавлено для полноты, как в backend/DefaultStrategyParameters
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
  risk: {
    atrPeriod: 14,
    stopLossMultiplier: 1.5,
    takeProfitMultiplier: 3,
    useTrailingStop: false,
    trailingStopOffsetMultiplier: 1,
    maxTradesPerDay: 0,
    positionSizePercentage: 0.01,
    maxRiskPerTradePercentage: 0.01,
  },
  globalAtrPeriod: 14,
  avgVolumePeriod: 20,
};

export const useSettingsStore = defineStore('settings', {
  state: (): SettingsState => ({
    parameters: null, // Изначально null, будут загружены
    isLoading: false,
    error: null,
  }),
  getters: {
    // Геттер для получения текущих параметров или дефолтных, если они еще не загружены
    currentSettings(state): StrategyParameters {
      return state.parameters || initialDefaultParameters;
    },
  },
  actions: {
    async fetchSettings() {
      if (this.parameters && !this.error) {
        // Если параметры уже загружены и нет ошибки, не загружаем повторно
        // console.log('Settings already loaded, skipping fetch.');
        // return;
      }
      this.isLoading = true;
      this.error = null;
      try {
        const response = await apiClient.get<StrategyParameters>('/settings'); // Используем apiClient
        this.parameters = response.data;
        console.log('Settings fetched successfully:', response.data);
      } catch (err: any) {
        this.error = err.response?.data?.message || err.message || 'Failed to fetch settings';
        this.parameters = initialDefaultParameters; // В случае ошибки используем дефолтные
        console.error('Error fetching settings:', this.error);
      }
      this.isLoading = false;
    },
    async updateSettings(newParameters: StrategyParameters) {
      this.isLoading = true;
      this.error = null;
      try {
        const response = await apiClient.put<StrategyParameters>('/settings', newParameters); // Используем apiClient
        this.parameters = response.data;
        console.log('Settings updated successfully:', response.data);
      } catch (err: any) {
        this.error = err.response?.data?.message || err.message || 'Failed to update settings';
        console.error('Error updating settings:', this.error);
        // В случае ошибки обновления, параметры не откатываем, чтобы пользователь видел введенные им значения
        // и мог попробовать сохранить снова или исправить.
        // Если критично, можно добавить логику отката к предыдущим this.parameters или вызова fetchSettings.
      }
      this.isLoading = false;
    },
    // Действие для установки параметров напрямую (например, для инициализации)
    setSettings(parameters: StrategyParameters) {
      this.parameters = parameters;
    }
  },
}); 