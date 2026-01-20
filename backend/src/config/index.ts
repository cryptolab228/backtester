import dotenv from 'dotenv';

import defaultScannerConfig, { ScannerConfig } from './scanner';

dotenv.config(); // Загружаем переменные из .env файла

const parseScannerPairs = (): ScannerConfig['pairs'] => {
  const raw = process.env.SCANNER_PAIRS;
  if (!raw) {
    return defaultScannerConfig.pairs.map((pair) => ({
      symbol: pair.symbol,
      timeframes: pair.timeframes,
      exchange: pair.exchange ?? 'bybit',
    }));
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item) => item && typeof item.symbol === 'string')
        .map((item) => ({
          symbol: item.symbol,
          timeframes: Array.isArray(item.timeframes) && item.timeframes.length > 0
            ? item.timeframes
            : defaultScannerConfig.defaultTimeframes,
          exchange: item.exchange === 'okx' ? 'okx' : 'bybit',
        }));
    }
    return defaultScannerConfig.pairs;
  } catch (error) {
    console.warn('[config] Failed to parse SCANNER_PAIRS env variable:', error);
    return defaultScannerConfig.pairs;
  }
};

const parseScannerEngines = (): ScannerConfig['engines'] => {
  const raw = process.env.SCANNER_ENGINES;
  if (!raw) {
    return defaultScannerConfig.engines;
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((engine) => engine && typeof engine.id === 'string')
        .map((engine) => ({
          id: engine.id,
          enabled: engine.enabled !== false,
          options: engine.options,
        }));
    }
    return defaultScannerConfig.engines;
  } catch (error) {
    console.warn('[config] Failed to parse SCANNER_ENGINES env variable:', error);
    return defaultScannerConfig.engines;
  }
};

const config = {
  env: process.env.NODE_ENV || 'development',
  port: process.env.PORT || 5000,
  // Базовый URL для генерации ссылок на статические файлы
  baseUrl: process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`,
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },
  okx: {
    apiKey: process.env.OKX_API_KEY,
    apiSecret: process.env.OKX_API_SECRET,
    apiPassphrase: process.env.OKX_API_PASSPHRASE,
  },
  bybit: {
    apiKey: process.env.BYBIT_API_KEY,
    apiSecret: process.env.BYBIT_API_SECRET,
    apiUrl: process.env.BYBIT_API_URL || 'https://api.bybit.com',
    wsUrl: process.env.BYBIT_WS_URL || 'wss://stream.bybit.com/v5/private',
  },
  bybitTestnet: {
    apiKey: process.env.BYBIT_TESTNET_API_KEY?.trim() || undefined,
    apiSecret: process.env.BYBIT_TESTNET_SECRET_KEY?.trim() || undefined,
    apiUrl: (process.env.BYBIT_TESTNET_API_URL || 'https://api-testnet.bybit.com').trim(),
    wsUrl: (process.env.BYBIT_TESTNET_WS_URL || 'wss://stream-testnet.bybit.com/v5/private').trim(),
    accountType: process.env.BYBIT_TESTNET_ACCOUNT_TYPE?.trim() || undefined,
  },
  bybitDemo: {
    apiKey: process.env.BYBIT_DEMO_API_KEY?.trim() || undefined,
    apiSecret: process.env.BYBIT_DEMO_SECRET_KEY?.trim() || undefined,
    apiUrl: (process.env.BYBIT_DEMO_API_URL || 'https://api-demo.bybit.com').trim(),
    wsUrl: (process.env.BYBIT_DEMO_WS_URL || 'wss://stream-demo.bybit.com/v5/private').trim(),
    accountType: process.env.BYBIT_DEMO_ACCOUNT_TYPE?.trim() || undefined,
  },
  scanner: {
    enabled: process.env.SCANNER_ENABLED === 'true' || defaultScannerConfig.enabled,
    executionMode: (process.env.SCANNER_MODE as ScannerConfig['executionMode']) || defaultScannerConfig.executionMode,
    defaultTimeframes: process.env.SCANNER_TIMEFRAMES
      ? process.env.SCANNER_TIMEFRAMES.split(',').map((tf) => tf.trim()).filter(Boolean)
      : defaultScannerConfig.defaultTimeframes,
    pairs: parseScannerPairs(),
    refreshIntervalMs: process.env.SCANNER_REFRESH_MS
      ? parseInt(process.env.SCANNER_REFRESH_MS, 10)
      : defaultScannerConfig.refreshIntervalMs,
    confirmWindowSize: process.env.SCANNER_CONFIRM_WINDOW
      ? parseInt(process.env.SCANNER_CONFIRM_WINDOW, 10)
      : defaultScannerConfig.confirmWindowSize,
    riskScoreThreshold: process.env.SCANNER_RISK_THRESHOLD
      ? parseFloat(process.env.SCANNER_RISK_THRESHOLD)
      : defaultScannerConfig.riskScoreThreshold,
    maxConcurrentTrades: process.env.SCANNER_MAX_CONCURRENT
      ? parseInt(process.env.SCANNER_MAX_CONCURRENT, 10)
      : defaultScannerConfig.maxConcurrentTrades,
    basePositionSize: process.env.SCANNER_BASE_POSITION_SIZE
      ? parseFloat(process.env.SCANNER_BASE_POSITION_SIZE)
      : defaultScannerConfig.basePositionSize,
    initialCapital: process.env.SCANNER_INITIAL_CAPITAL
      ? parseFloat(process.env.SCANNER_INITIAL_CAPITAL)
      : defaultScannerConfig.initialCapital,
    defaultLeverage: process.env.SCANNER_DEFAULT_LEVERAGE
      ? parseFloat(process.env.SCANNER_DEFAULT_LEVERAGE)
      : defaultScannerConfig.defaultLeverage,
    tradingFeeRate: process.env.SCANNER_TRADING_FEE_RATE
      ? parseFloat(process.env.SCANNER_TRADING_FEE_RATE)
      : defaultScannerConfig.tradingFeeRate,
    fundingRateBuffer: process.env.SCANNER_FUNDING_RATE_BUFFER
      ? parseFloat(process.env.SCANNER_FUNDING_RATE_BUFFER)
      : defaultScannerConfig.fundingRateBuffer,
    riskPerTrade: process.env.SCANNER_RISK_PER_TRADE
      ? parseFloat(process.env.SCANNER_RISK_PER_TRADE)
      : defaultScannerConfig.riskPerTrade,
    stopLossMultiplier: process.env.SCANNER_STOP_LOSS_MULTIPLIER
      ? parseFloat(process.env.SCANNER_STOP_LOSS_MULTIPLIER)
      : defaultScannerConfig.stopLossMultiplier,
    takeProfitMultiplier: process.env.SCANNER_TAKE_PROFIT_MULTIPLIER
      ? parseFloat(process.env.SCANNER_TAKE_PROFIT_MULTIPLIER)
      : defaultScannerConfig.takeProfitMultiplier,
    engines: parseScannerEngines(),
  } satisfies ScannerConfig,
};

export type AppConfig = typeof config;

export default config;