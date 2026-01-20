import { defineStore } from 'pinia';

interface StrategySettings {
  dlc_period: number;
  poc_lookback: number;
  value_area_percent: number;
  h: number;
  mult: number;
  use_nwe: boolean;
  repaint: boolean;
  min_volume_threshold: number;
  delta_threshold: number;
  risk_percent: number;
  stop_loss_atr: number;
  take_profit_atr: number;
  atr_period: number;
  max_trades_per_day: number;
  use_trailing_stop: boolean;
  trailing_step: number;
  trail_offset_mult: number;
}

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    // Значения по умолчанию из Pine Script или измененные
    strategy: {
      dlc_period: 40,
      poc_lookback: 5,
      value_area_percent: 70.0,
      h: 8.0,
      mult: 3.0,
      use_nwe: true,
      repaint: false,
      min_volume_threshold: 1.5,
      delta_threshold: 0.7,
      risk_percent: 2.0,
      stop_loss_atr: 2.0,
      take_profit_atr: 5.0,
      atr_period: 14,
      max_trades_per_day: 2,
      use_trailing_stop: true,
      trailing_step: 1.0,
      trail_offset_mult: 2.0,
    } as StrategySettings,
    // Другие настройки приложения, если нужны
    // apiKey: ''
  }),
  actions: {
    updateSettings(newSettings: Partial<StrategySettings>) {
      this.strategy = { ...this.strategy, ...newSettings };
      // Здесь можно добавить логику сохранения настроек (например, в localStorage или через API)
      console.log('Settings updated:', this.strategy);
    },
    // loadSettings() {
      // Логика загрузки настроек
    // }
  },
  getters: {
    getStrategySettings: (state): StrategySettings => state.strategy,
  },
}); 