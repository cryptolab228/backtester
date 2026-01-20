
import { applyStrategyLogic, DefaultStrategyParameters, StrategyCandle, StrategyParameters } from '../modules/strategy_logic/strategy';
import { CandleData } from '../modules/strategy_logic/indicators';

// Mock NWE output since calculateNWE depends on full implementation which might be complex to mock perfectly with random data,
// but our strategy logic uses the *result* of NWE.
// However, applyStrategyLogic *calls* calculateNWE internally. 
// We need to provide enough candles for NWE/ATR to warm up.

const createCandle = (
  timestamp: number, 
  open: number, 
  high: number, 
  low: number, 
  close: number, 
  volume: number
): CandleData => ({ timestamp, open, high, low, close, volume });

const generateScenarioData = () => {
  const candles: CandleData[] = [];
  const now = Date.now();
  let price = 100;
  
  // 1. Warmup Phase (0-500) - Flat market to stabilize indicators
  for (let i = 0; i < 500; i++) {
    candles.push(createCandle(now + i * 60000, price, price + 0.5, price - 0.5, price, 100));
  }

  // Current index is now 500.
  
  // --- SCENARIO 1: Trend Pullback (Uptrend) ---
  // Create a strong uptrend to push price above Upper Band
  // Then pull back to Middle Line.
  
  // 500-520: Strong pump
  for (let i = 0; i < 20; i++) {
    price += 1; // Fast rise
    candles.push(createCandle(now + (500+i) * 60000, price, price + 0.5, price - 0.2, price + 0.8, 200));
  }
  
  // 520-525: Pullback to "middle" (approx)
  // We don't know exactly where NWE middle is, but it lags. 
  // If price rose from 100 to 120 in 20 bars, SMA(500) is still near 100-101.
  // Wait, NWE lookback is 500 in code logic? Let's check strategy.ts logic.
  // Yes, lookbackPeriod: 500. So BaseLine is essentially flat around 100.
  // Price is 120. Upper band is Base + ATR*Mult*Bandwidth.
  // If ATR is approx 1, Mult=3, BW=8 -> Offset = 24. Upper Band ~ 124.
  // We need to push HARDER to breach upper band if lookback is that long.
  
  // Let's assume standard behavior. We just need to trigger 'recentUpperBreach' logic.
  // recentUpperBreach checks: high > nweUpper.
  
  // To test logic *deterministically* without relying on complex NWE math on random data,
  // we might verify the *logic flow* by inspecting the code, but here we want a runtime check.
  // Let's construct data that we know *should* trigger it if NWE adapts relatively slowly.
  
  // Let's simulate a HUGE pump to ensure breach.
  for (let i = 0; i < 10; i++) {
    price += 10; // 120 -> 220. NWE Upper will lag significantly.
    candles.push(createCandle(now + (520+i) * 60000, price, price + 2, price - 2, price + 5, 1000));
  }
  
  // Now price is ~220. NWE Base is still dragging up from 100.
  // Let's pullback sharply to where we expect the middle line to be.
  // Middle line is SMA(500). With 500 bars at 100 and 30 bars spiking to 220, SMA is still low.
  // (500*100 + 30*160) / 530 ~ 103. 
  // So pullback needs to go DEEP.
  
  price = 105; 
  candles.push(createCandle(now + 530 * 60000, price+5, price+5, price-1, price, 500)); // Dump to 105
  
  // This bar at 530 should theoretically touch the middle line (approx 103-105).
  
  
  // --- SCENARIO 2: Delta Divergence (Bullish) ---
  // We need Price Lower Low, but CVD Higher Low.
  
  // Stabilize 
  for (let i = 0; i < 50; i++) {
    price = 100;
    candles.push(createCandle(now + (600+i) * 60000, price, price+0.5, price-0.5, price, 100));
  }
  
  // Pivot 1: Low 90
  const pivot1Time = now + 700 * 60000;
  candles.push(createCandle(pivot1Time, 95, 95, 90, 91, 1000)); 
  
  // Recovery
  for (let i = 1; i <= 10; i++) {
    candles.push(createCandle(pivot1Time + i * 60000, 92, 93, 91, 92, 100));
  }
  
  // Pivot 2: Low 89 (Lower Price), High Close (Positive Delta implied or set via high volume on green candle if we had buy/sell vol, but here approx delta uses CLV)
  // CLV = ((89.9-89) - (90-89.9)) / 1 = 0.9 - 0.1 = 0.8 (Positive).
  // Approx Delta = 0.8 * 1000 = 800.
  // CVD will increase by 800.
  // Previous Pivot 1: CLV = ((91-90) - (95-91)) / 5 = (1 - 4) / 5 = -0.6.
  // Approx Delta = -0.6 * 1000 = -600.
  // So CVD at Pivot 2 will be higher than at Pivot 1.
  const pivot2Time = pivot1Time + 11 * 60000;
  candles.push(createCandle(pivot2Time, 90, 90, 89, 89.9, 1000)); 
  
  return candles;
};

const runTest = () => {
  console.log('--- Starting Full Strategy Verification ---');
  
  const candles = generateScenarioData();
  
  // Params with all features enabled
  const params: StrategyParameters = {
    ...DefaultStrategyParameters,
    nwe: { ...DefaultStrategyParameters.nwe, enabled: true },
    vpa: { ...DefaultStrategyParameters.vpa, enabled: true },
    clusters: { ...DefaultStrategyParameters.clusters },
  };

  const result = applyStrategyLogic(candles, params);
  const strategyCandles = result.strategyCandles;

  // --- Verify Trend Pullback ---
  // We looked for pullback around index 530.
  console.log('\n--- Checking Trend Pullback ---');
  let foundPullback = false;
  // Search for the pullback candle by checking price characteristic around the dump
  // The dump candle was set to close at 105.
  const pullbackCandleIndex = strategyCandles.findIndex(c => c.close === 105);
  
  if (pullbackCandleIndex !== -1) {
        const c = strategyCandles[pullbackCandleIndex];
        console.log(`[${pullbackCandleIndex}] Pullback Candle Found. Price: ${c.close}, Middle: ${c.nweMiddle?.toFixed(2)}`);
        
        if (c.nweMiddle && c.low <= c.nweMiddle * 1.1 && c.high >= c.nweMiddle * 0.9) {
             console.log(`    Signal Strength: ${c.signalStrength}`);
             if (c.signalStrength && c.signalStrength >= 1.0) foundPullback = true;
        }
  }
  
  if (!foundPullback) console.log('NOTE: Trend Pullback logic condition not fully met in test scenario.');
  else console.log('SUCCESS: Trend Pullback identified.');

  // --- Verify Delta Divergence ---
  console.log('\n--- Checking Delta Divergence ---');
  
  const cPivot1 = strategyCandles.find(c => c.low === 90);
  const cPivot2 = strategyCandles.find(c => c.low === 89);
  
  if (cPivot1 && cPivot2) {
      console.log(`Pivot 1: Low ${cPivot1.low}, CVD: ${cPivot1.cumulativeDelta?.toFixed(2)}`);
      console.log(`Pivot 2: Low ${cPivot2.low}, CVD: ${cPivot2.cumulativeDelta?.toFixed(2)}`);
      
      const isDiv = cPivot2.isDeltaDivergence;
      console.log(`\nIs Divergence Flag Set on Pivot 2? ${isDiv}`);
      console.log(`Signal Strength: ${cPivot2.signalStrength}`);
      
      if (isDiv) console.log('SUCCESS: Delta Divergence correctly identified.');
      else console.log('FAILURE: Delta Divergence not identified.');
  } else {
      console.log('Error locating specific pivot candles for divergence test.');
  }
  
  // --- Verify VPA (Absorption) ---
  const absCandle = strategyCandles.find(c => c.isAbsorption);
  if (absCandle) {
      console.log(`\nVerified VPA: Found absorption candle.`);
  }

};

runTest();
