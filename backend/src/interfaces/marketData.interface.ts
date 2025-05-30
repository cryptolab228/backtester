export interface CandleData {
  timestamp: number; // Unix timestamp in milliseconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  volumeQuote?: number; // Объем в котируемой валюте
  pair_id?: number; // Optional: if you link candles to a pair ID in your DB
  timeframe?: string; // Optional: e.g., '15m', '1h', '4h', '1d'
  // Add any other fields that come from your data source
}

export interface HistoricalDataRequestParams {
  pairSymbol: string;
  timeframe: string;
  startDate: string; // ISO Date string
  endDate: string;   // ISO Date string
} 