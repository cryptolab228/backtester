export interface DLCSettings {
  period?: number;
  numProfiles?: number;
  pocColor?: string;
  vahColor?: string;
  valColor?: string;
  numBins?: number;
  vaPercentage?: number;
}

export interface NWESettings {
  lookbackPeriod?: number;
  atrPeriod?: number;
  atrMultiplier?: number;
  upColor?: string;
  downColor?: string;
}

export interface ClusterSettings {
  source?: 'delta' | 'volume';
  thresholdMultiplier?: number;
  lookbackPeriod?: number;
  confirmationBars?: number;
  buyColor?: string;
  sellColor?: string;
}

export interface RiskManagementSettings {
  atrPeriod?: number;
  stopLossMultiplier?: number;
  takeProfitMultiplier?: number;
  useTrailingStop?: boolean;
  trailingStopOffsetMultiplier?: number;
  maxTradesPerDay?: number;
  positionSizePercentage?: number;
  maxRiskPerTradePercentage?: number;
}

export interface StrategyParameters {
  dlc: DLCSettings;
  nwe: NWESettings;
  clusters: ClusterSettings;
  risk: RiskManagementSettings;
  globalAtrPeriod?: number;
  avgVolumePeriod?: number;
  tradingPair?: string;
  timeframe?: string;
  initialCapital?: number;
} 