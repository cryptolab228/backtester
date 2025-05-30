export interface ExchangeConnectionSettings {
  id: string; // Уникальный идентификатор, генерируемый uuid
  name: string; // Пользовательское имя для этого подключения, например "Мой основной OKX"
  exchange: string; // Ключ биржи, например, 'OKX', 'Binance', 'Bybit'
  isActive: boolean; // Является ли это подключение активным в данный момент
  isTestNet: boolean; // Используется ли тестовая сеть (paper trading)
  apiKey: string;
  secretKey: string;
  passphrase?: string; // Для OKX и других бирж, где это требуется
}

export interface AppSettings {
  // Массив для хранения настроек подключений к биржам
  exchangeConnections: ExchangeConnectionSettings[];
  // ID активного подключения (управляется на фронтенде для удобства UI)
  activeExchangeId?: string;
  // Другие глобальные настройки приложения можно добавить сюда
  // например, defaultTheme: 'light' | 'dark';
} 