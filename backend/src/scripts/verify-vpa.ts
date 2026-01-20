
import { applyStrategyLogic, DefaultStrategyParameters, StrategyCandle, StrategyParameters } from '../modules/strategy_logic/strategy';
import { CandleData } from '../modules/strategy_logic/indicators';

// We won't mock logger directly to avoid TS errors. 
// The system logger will just output to console/file which is fine for verification.

const createBaseCandles = (count: number, startPrice: number = 100): CandleData[] => {
  const candles: CandleData[] = [];
  let price = startPrice;
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const open = price;
    const close = price + (Math.random() - 0.5) * 1;
    const high = Math.max(open, close) + Math.random() * 0.5;
    const low = Math.min(open, close) - Math.random() * 0.5;
    candles.push({
      timestamp: now - (count - i) * 60000,
      open,
      high,
      low,
      close,
      volume: 100 + Math.random() * 50, // Base volume
    });
    price = close;
  }
  return candles;
};

const runTest = () => {
  console.log('--- Starting VPA Verification ---');

  // 1. Setup Context (100 candles of flat movement to establish ATR and AvgVolume)
  const baseCandles = createBaseCandles(100, 100);
  
  // --- Scenario 1: Falling Knife (The Trap) ---
  // Huge Red Candle, Huge Volume, Close near Low.
  // Should normally trigger Volume Cluster, but VPA should filter it.
  const fallingKnifeCandle: CandleData = {
    timestamp: Date.now(),
    open: 100,
    high: 100.2,
    low: 95,
    close: 95.1, // Closed at bottom 2%
    volume: 500, // 4x Average Volume
  };

  // --- Scenario 2: Absorption (The Signal) ---
  // Small Spread (Doji), Huge Volume.
  // Should trigger Volume Cluster AND Absorption bonus.
  const absorptionCandle: CandleData = {
    timestamp: Date.now() + 60000,
    open: 95,
    high: 95.2,
    low: 94.8,
    close: 95.1,
    volume: 500, // 4x Average Volume
  };

  // --- Scenario 3: Pinbar Rejection (The Setup) ---
  // Wide Spread, Huge Volume, but Closed high (Rejection).
  // Should trigger Volume Cluster (Long).
  const pinbarCandle: CandleData = {
    timestamp: Date.now() + 120000,
    open: 95,
    high: 95.5,
    low: 90,
    close: 94.5, // Closed near top
    volume: 500, // 4x Average Volume
  };

  const allCandles = [...baseCandles, fallingKnifeCandle, absorptionCandle, pinbarCandle];

  const params: StrategyParameters = {
    ...DefaultStrategyParameters,
    vpa: {
      enabled: true,
      maxSpreadAtrMultiplier: 0.5,
      minSpreadAtrMultiplier: 1.5,
    },
    clusters: {
      ...DefaultStrategyParameters.clusters,
      minVolumeThresholdMultiplier: 2.0, // High threshold
    }
  };

  const result = applyStrategyLogic(allCandles, params);
  const testCandles = result.strategyCandles.slice(-3);

  console.log('\nResults Analysis:');
  
  const kCandle = testCandles[0];
  const kSpread = Number(kCandle.high) - Number(kCandle.low);
  console.log(`\n1. Falling Knife (Spread: ${Number(kSpread).toFixed(2)}, ATR: ${Number(kCandle.atr || 0).toFixed(2)})`);
  console.log(`   Is WideSpread: ${kCandle.isWideSpread}`);
  console.log(`   Is Volume Cluster: ${kCandle.isVolumeCluster}`);
  console.log(`   Is Absorption: ${kCandle.isAbsorption}`);
  console.log(`   Long Signal Active: ${kCandle.entryConditionLong}`);
  console.log(`   EXPECTED: Long Signal FALSE (Filtered by VPA)`);

  const aCandle = testCandles[1];
  const aSpread = Number(aCandle.high) - Number(aCandle.low);
  console.log(`\n2. Absorption (Spread: ${Number(aSpread).toFixed(2)}, ATR: ${Number(aCandle.atr || 0).toFixed(2)})`);
  console.log(`   Is WideSpread: ${aCandle.isWideSpread}`);
  console.log(`   Is Volume Cluster: ${aCandle.isVolumeCluster}`);
  console.log(`   Is Absorption: ${aCandle.isAbsorption}`);
  console.log(`   Long Signal Active: ${aCandle.entryConditionLong}`);
  console.log(`   EXPECTED: Long Signal TRUE (Absorption Bonus)`);

  const pCandle = testCandles[2];
  const pSpread = Number(pCandle.high) - Number(pCandle.low);
  console.log(`\n3. Pinbar Rejection (Spread: ${Number(pSpread).toFixed(2)}, ATR: ${Number(pCandle.atr || 0).toFixed(2)})`);
  console.log(`   Is WideSpread: ${pCandle.isWideSpread}`);
  console.log(`   Is Volume Cluster: ${pCandle.isVolumeCluster}`);
  console.log(`   Long Signal Active: ${pCandle.entryConditionLong}`);
  console.log(`   EXPECTED: Long Signal TRUE (Rejection allowed)`);

};

runTest();
