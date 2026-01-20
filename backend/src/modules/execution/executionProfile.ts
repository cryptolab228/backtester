import config from '@/config';

export interface ExecutionProfile {
  tradingFeeRate: number;
  leverage: number;
  slippageBps: number;
  confirmWindowSize: number;
  maxConfirmationAttempts: number;
}

export const DEFAULT_EXECUTION_PROFILE: ExecutionProfile = {
  tradingFeeRate: config.scanner.tradingFeeRate ?? 0.0006,
  leverage: config.scanner.defaultLeverage ?? 1,
  slippageBps: 5,
  confirmWindowSize: config.scanner.confirmWindowSize ?? 2,
  maxConfirmationAttempts: 3,
};

export const DEFAULT_PORTFOLIO_EXECUTION_PROFILE: ExecutionProfile = {
  ...DEFAULT_EXECUTION_PROFILE,
  confirmWindowSize: config.scanner.confirmWindowSize ?? 2,
};

// НОВОЕ: Идеальный профиль для режима без комиссий, плеча и проскальзывания
export const IDEAL_EXECUTION_PROFILE: ExecutionProfile = {
  tradingFeeRate: 0,      // Без комиссий
  leverage: 1,            // Без плеча
  slippageBps: 0,         // Без проскальзывания
  confirmWindowSize: 1,
  maxConfirmationAttempts: 1,
};

export const toBasisPoints = (value: number): number => value / 10_000;


