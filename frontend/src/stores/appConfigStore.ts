import { defineStore } from 'pinia';
import type { AppSettings, ExchangeConnectionSettings } from '@/types/appConfig';
import { v4 as uuidv4 } from 'uuid'; // Для генерации ID
import { apiClient } from '@/services/apiService'; // Исправленный импорт

export interface AppConfigState {
  config: AppSettings | null;
  isLoading: boolean;
  error: string | null;
}

const initialDefaultAppSettings: AppSettings = {
  exchangeConnections: [
    {
      id: uuidv4(),
      name: 'OKX Main', // Используем name
      exchange: 'OKX',  // Добавляем exchange
      isActive: true,
      isTestNet: false, // Добавляем isTestNet
      apiKey: '',
      secretKey: '',
      passphrase: '', // Используем passphrase
    },
    {
      id: uuidv4(),
      name: 'Binance Spot',
      exchange: 'Binance',
      isActive: false,
      isTestNet: false,
      apiKey: 'BINANCE_API_KEY_PLACEHOLDER',
      secretKey: 'BINANCE_SECRET_KEY_PLACEHOLDER',
    },
    {
      id: uuidv4(),
      name: 'Bybit Futures',
      exchange: 'Bybit',
      isActive: false,
      isTestNet: false,
      apiKey: 'BYBIT_API_KEY_PLACEHOLDER',
      secretKey: 'BYBIT_SECRET_KEY_PLACEHOLDER',
    },
  ],
  activeExchangeId: undefined,
};

const initialActiveConnection = initialDefaultAppSettings.exchangeConnections.find(conn => conn.isActive);
if (initialActiveConnection) {
  initialDefaultAppSettings.activeExchangeId = initialActiveConnection.id;
}


export const useAppConfigStore = defineStore('appConfig', {
  state: (): AppConfigState => ({
    config: null,
    isLoading: false,
    error: null,
  }),
  getters: {
    currentConfig(state): AppSettings {
      return state.config || JSON.parse(JSON.stringify(initialDefaultAppSettings)); // Возвращаем копию
    },
    activeExchangeConnection(state): ExchangeConnectionSettings | undefined {
      const conf = state.config || initialDefaultAppSettings;
      return conf.exchangeConnections.find((conn) => conn.id === conf.activeExchangeId);
    },
    allExchangeConnections(state): ExchangeConnectionSettings[] {
      const conf = state.config || initialDefaultAppSettings;
      return conf.exchangeConnections;
    }
  },
  actions: {
    async fetchAppConfig() {
      if (this.config && !this.error && !this.isLoading) { // Проверяем isLoading чтобы избежать гонок
        console.log('App config already loaded or loading, skipping fetch.');
        return;
      }
      this.isLoading = true;
      this.error = null;
      try {
        const response = await apiClient.get<{ exchangeConnections: ExchangeConnectionSettings[] }>('/settings');
        const backendConfig = response.data;
        
        let activeId: string | undefined = undefined;
        const activeBackendConn = backendConfig.exchangeConnections.find((c: ExchangeConnectionSettings) => c.isActive);
        if (activeBackendConn) {
            activeId = activeBackendConn.id;
        } else if (backendConfig.exchangeConnections.length > 0) {
            // Если нет активного с бэка, но есть подключения, делаем первое активным (на фронте)
            backendConfig.exchangeConnections[0].isActive = true;
            activeId = backendConfig.exchangeConnections[0].id;
        }

        this.config = {
            exchangeConnections: backendConfig.exchangeConnections,
            activeExchangeId: activeId
        };
        
        console.log('App config loaded from API:', this.config);
      } catch (err: any) {
        this.error = err.message || 'Failed to fetch app config from API';
        // При ошибке загрузки с API, используем дефолтные и не пытаемся их сохранить на бэк
        this.config = JSON.parse(JSON.stringify(initialDefaultAppSettings));
        console.error('Error fetching app config from API, using defaults:', this.error);
      }
      this.isLoading = false;
    },
    async _updateAppConfigOnBackend(configToSave: AppSettings) {
        // Приватный метод для отправки данных на бэкенд
        // Отправляем только exchangeConnections, так как activeExchangeId - это состояние фронтенда
        this.isLoading = true;
        this.error = null;
        try {
            await apiClient.put('/settings', { exchangeConnections: configToSave.exchangeConnections });
            this.config = JSON.parse(JSON.stringify(configToSave)); // Обновляем состояние стора копией
            console.log('App config updated on API and in store:', this.config);
        } catch (err: any) {
            this.error = err.message || 'Failed to update app config on API';
            console.error('Error updating app config on API:', this.error);
            // Здесь можно решить, откатывать ли локальные изменения this.config или нет
            // Пока что оставляем локальные изменения, но показываем ошибку
        }
        this.isLoading = false;
    },
    // Действия для управления подключениями теперь вызывают _updateAppConfigOnBackend
    addExchangeConnection(newConnection: ExchangeConnectionSettings) {
        const current = JSON.parse(JSON.stringify(this.currentConfig));
        const existingIndex = current.exchangeConnections.findIndex((conn: ExchangeConnectionSettings) => conn.id === newConnection.id);
        if (existingIndex === -1) {
            current.exchangeConnections.push(newConnection);
        } else {
            console.warn(`Connection with id ${newConnection.id} already exists. Replacing.`);
            current.exchangeConnections[existingIndex] = newConnection;
        }
        
        if (newConnection.isActive) {
            current.exchangeConnections.forEach((conn: ExchangeConnectionSettings) => {
                if (conn.id !== newConnection.id) conn.isActive = false;
            });
            current.activeExchangeId = newConnection.id;
        }
        this._updateAppConfigOnBackend(current); 
    },
    addNewExchangeConnectionConfig(name: string = 'New Connection', exchange: string = 'OKX') { // Принимаем имя и биржу
        const newConnection: ExchangeConnectionSettings = {
            id: uuidv4(),
            name, // Используем name
            exchange, // Используем exchange
            isActive: false,
            isTestNet: false, // Добавляем isTestNet
            apiKey: '',
            secretKey: '',
            passphrase: exchange === 'OKX' ? '' : undefined, // Используем passphrase
        };
        const current = JSON.parse(JSON.stringify(this.currentConfig));
        current.exchangeConnections.push(newConnection);
        // Если это первое соединение, делаем его активным
        if (current.exchangeConnections.length === 1) {
            newConnection.isActive = true;
            current.activeExchangeId = newConnection.id;
        }
        this._updateAppConfigOnBackend(current);
    },
    setActiveExchangeConnection(connectionId: string) {
        const current = JSON.parse(JSON.stringify(this.currentConfig));
        const targetConnection = current.exchangeConnections.find((conn: ExchangeConnectionSettings) => conn.id === connectionId);
        if (targetConnection) {
            current.exchangeConnections.forEach((conn: ExchangeConnectionSettings) => conn.isActive = (conn.id === connectionId));
            current.activeExchangeId = connectionId;
            this._updateAppConfigOnBackend(current);
        } else {
            console.warn(`Connection with id ${connectionId} not found.`);
        }
    },
    updateExchangeConnectionById(connectionId: string, updatedFields: Partial<ExchangeConnectionSettings>) {
        const current = JSON.parse(JSON.stringify(this.currentConfig));
        const connectionIndex = current.exchangeConnections.findIndex((conn: ExchangeConnectionSettings) => conn.id === connectionId);
        if (connectionIndex !== -1) {
            // Применяем частичные обновления, но ID и exchange не должны меняться этим методом
            const originalConnection = current.exchangeConnections[connectionIndex];
            current.exchangeConnections[connectionIndex] = {
                ...originalConnection,
                ...updatedFields,
                id: originalConnection.id, // Гарантируем, что id не изменился
                exchange: originalConnection.exchange, // Гарантируем, что exchange не изменился
            };
            
            if (updatedFields.isActive === true) {
                 current.exchangeConnections.forEach((conn: ExchangeConnectionSettings) => {
                    if (conn.id !== connectionId) conn.isActive = false;
                });
                current.activeExchangeId = connectionId;
            } else if (updatedFields.isActive === false && current.activeExchangeId === connectionId) {
                // Если деактивировали текущее активное соединение, нужно выбрать новое активное
                const firstOtherConnection = current.exchangeConnections.find((conn: ExchangeConnectionSettings) => conn.id !== connectionId);
                if (firstOtherConnection) {
                    firstOtherConnection.isActive = true;
                    current.activeExchangeId = firstOtherConnection.id;
                } else {
                    // Если других нет, то активного нет
                    current.activeExchangeId = undefined;
                }
            }
            this._updateAppConfigOnBackend(current);
        } else {
            console.warn(`Connection with id ${connectionId} not found for update.`);
        }
    },
    deleteExchangeConnectionById(connectionId: string) {
        const current = JSON.parse(JSON.stringify(this.currentConfig));
        const originalLength = current.exchangeConnections.length;
        current.exchangeConnections = current.exchangeConnections.filter((conn: ExchangeConnectionSettings) => conn.id !== connectionId);
        
        if (originalLength === current.exchangeConnections.length) {
            console.warn(`Connection with id ${connectionId} not found for deletion.`);
            return; // Ничего не было удалено
        }

        if (current.activeExchangeId === connectionId) {
            if (current.exchangeConnections.length > 0) {
                current.exchangeConnections[0].isActive = true; // Делаем первое активным
                current.activeExchangeId = current.exchangeConnections[0].id;
            } else {
                current.activeExchangeId = undefined; // Нет активных
            }
        }
        this._updateAppConfigOnBackend(current);
    }
  },
}); 