import type { StrategyParameters, DLCSettings, NWESettings, ClusterSettings, RiskManagementSettings } from '../modules/strategy_logic/strategy';

const defaultStrategyParameters: StrategyParameters = {
  dlc: {
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

export const getDefaultStrategyParameters = (): StrategyParameters => {
  return JSON.parse(JSON.stringify(defaultStrategyParameters));
}; 