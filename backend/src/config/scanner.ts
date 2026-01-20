export type ScannerExecutionMode = 'dry-run' | 'paper' | 'shadow' | 'live' | 'testnet' | 'demo';

export interface ScannerPairConfig {
  symbol: string;
  timeframes: string[];
  exchange?: 'bybit' | 'okx';
}

export interface ScannerConfig {
  enabled: boolean;
  executionMode: ScannerExecutionMode;
  defaultTimeframes: string[];
  pairs: ScannerPairConfig[];
  refreshIntervalMs: number;
  confirmWindowSize: number;
  riskScoreThreshold: number;
  maxConcurrentTrades: number;
  basePositionSize: number;
  initialCapital: number;
  defaultLeverage: number;
  tradingFeeRate: number;
  fundingRateBuffer: number;
  riskPerTrade: number;
  stopLossMultiplier: number;
  takeProfitMultiplier: number;
  engines: Array<{ id: string; enabled: boolean; options?: Record<string, any> }>;
}

const defaultScannerConfig: ScannerConfig = {
  enabled: false,
  executionMode: 'dry-run',
  defaultTimeframes: ['1h'],
  pairs: [
    { symbol: 'BTCUSDT', timeframes: ['1h'], exchange: 'bybit' },
    { symbol: 'ETHUSDT', timeframes: ['1h'], exchange: 'bybit' },
    { symbol: 'XRPUSDT', timeframes: ['1h'], exchange: 'bybit' },
    { symbol: 'SOLUSDT', timeframes: ['1h'], exchange: 'bybit' },
  ],
  refreshIntervalMs: 15000,
  confirmWindowSize: 2,
  riskScoreThreshold: 0.55,
  maxConcurrentTrades: 4,
  basePositionSize: 1,
  initialCapital: 1000,
  defaultLeverage: 10,
  tradingFeeRate: 0.0006,
  fundingRateBuffer: 0.00025,
  riskPerTrade: 0.02,
  stopLossMultiplier: 3,
  takeProfitMultiplier: 5,
  engines: [{ id: 'basic-strategy-engine', enabled: true }],
};

export default defaultScannerConfig;



