import { calculateATR, calculateVolumeProfile, VolumeProfileResult, CandleData } from './indicators';
import { calculateNWE, NWECalculationParams, NWEResultPoint } from './indicators';

describe('calculateATR', () => {
  interface TestCandle {
    high: number;
    low: number;
    close: number;
    volume: number;
  }

  const createAtrTestCandle = (high: number, low: number, close: number, volume: number = 0): TestCandle => ({
    high, low, close, volume
  });

  it('should return an array of zeros if candles array is empty', () => {
    const candles: TestCandle[] = [];
    const period = 14;
    const result = calculateATR(candles, period);
    expect(result).toEqual([]);
  });

  it('should return an array of zeros if candles length is less than period', () => {
    const candles: TestCandle[] = [
      createAtrTestCandle(10, 8, 9),
      createAtrTestCandle(11, 9, 10),
    ];
    const period = 5;
    const result = calculateATR(candles, period);
    expect(result).toEqual([0, 0]);
  });

  it('should calculate ATR correctly for a given set of candles and period', () => {
    const candles: TestCandle[] = [
      createAtrTestCandle(10, 8, 9),    // TR = 2
      createAtrTestCandle(12, 9, 11),   // TR = 3
      createAtrTestCandle(11, 9, 10),   // TR = 2
      createAtrTestCandle(13, 10, 12), // TR = 3
      createAtrTestCandle(12, 10, 11), // TR = 2
    ];
    const period = 3;
    const expectedATR = [
      0,
      0,
      2.3333333333333335, 
      2.5555555555555554, 
      2.3703703703703702, 
    ];
    const result = calculateATR(candles, period);
    result.forEach((val, index) => {
      expect(val).toBeCloseTo(expectedATR[index], 5);
    });
  });

  it('should handle prevClose correctly for the first candle TR calculation', () => {
    const candles: TestCandle[] = [createAtrTestCandle(10, 8, 9)];
    const period = 1;
    const result = calculateATR(candles, period);
    expect(result.length).toBe(1);
    expect(result[0]).toBeCloseTo(2, 5);
  });
});

describe('calculateVolumeProfile', () => {
  const createVpTestCandle = (high: number, low: number, close: number, volume: number): CandleData => ({
    high,
    low,
    close,
    volume,
  });

  it('should return empty profile for no candles', () => {
    const candles: CandleData[] = [];
    const result = calculateVolumeProfile(candles);
    expect(result.poc).toBeNull();
    expect(result.vah).toBeNull();
    expect(result.val).toBeNull();
    expect(result.profile).toEqual([]);
    expect(result.totalVolume).toBe(0);
  });

  it('should return empty profile if total volume is zero', () => {
    const candles: CandleData[] = [createVpTestCandle(10, 9, 9.5, 0), createVpTestCandle(11, 10, 10.5, 0)];
    const result = calculateVolumeProfile(candles);
    expect(result.poc).toBeNull();
    expect(result.vah).toBeNull();
    expect(result.val).toBeNull();
    expect(result.profile).toEqual([]);
    expect(result.totalVolume).toBe(0);
  });

  it('should process a single candle correctly', () => {
    const candle = createVpTestCandle(10, 10, 10, 100);
    const candles: CandleData[] = [candle];
    const result = calculateVolumeProfile(candles, 5);
    expect(result.poc).toBe(10);
    expect(result.vah).toBe(10);
    expect(result.val).toBe(10);
    expect(result.totalVolume).toBe(100);
    expect(result.profile.length).toBe(1);
    expect(result.profile[0]).toEqual({ price: 10, volume: 100 });
  });

  it('should calculate POC and VA correctly for a simple case', () => {
    const candles: CandleData[] = [
      createVpTestCandle(102, 100, 101, 100), 
      createVpTestCandle(103, 101, 102, 200), 
      createVpTestCandle(102, 100, 100, 50),  
      createVpTestCandle(104, 102, 103, 150), 
      createVpTestCandle(103, 101, 101, 100), 
    ];
    const result = calculateVolumeProfile(candles, 5); 
    expect(result.totalVolume).toBe(600);
    expect(result.poc).not.toBeNull();
    expect(result.vah).not.toBeNull();
    expect(result.val).not.toBeNull();
    if (result.poc) expect(result.poc).toBeGreaterThanOrEqual(100);
    if (result.poc) expect(result.poc).toBeLessThanOrEqual(104);
    expect(result.poc).toBeCloseTo(102.0, 1);
    if (result.vah) expect(result.vah).toBeGreaterThanOrEqual(result.poc! - 0.8);
    if (result.vah) expect(result.vah).toBeLessThanOrEqual(104);
    if (result.val) expect(result.val).toBeGreaterThanOrEqual(100);
    if (result.val) expect(result.val).toBeLessThanOrEqual(result.poc! + 0.8);
    expect(result.vah).toBeCloseTo(102.8,1); 
    expect(result.val).toBeCloseTo(102.0,1); 
  });

  it('should handle all candles having the same price and volume', () => {
    const candles: CandleData[] = [
      createVpTestCandle(100, 100, 100, 10),
      createVpTestCandle(100, 100, 100, 20),
      createVpTestCandle(100, 100, 100, 30),
    ];
    const result = calculateVolumeProfile(candles, 5);
    expect(result.totalVolume).toBe(60);
    expect(result.poc).toBe(100);
    expect(result.vah).toBe(100);
    expect(result.val).toBe(100);
    expect(result.profile.length).toBe(1);
    expect(result.profile[0]).toEqual({ price: 100, volume: 60 });
  });
});

describe('calculateNWE', () => {
  const createNweTestCandle = (high: number, low: number, close: number, volume: number = 0): CandleData => ({
    high, low, close, volume
  });

  it('should return an empty array for no candles', () => {
    const candles: CandleData[] = [];
    const params: NWECalculationParams = { lookbackPeriod: 5, atrPeriod: 5, atrMultiplier: 1 };
    const result = calculateNWE(candles, params);
    expect(result).toEqual([]);
  });

  it('should return array of nulls if not enough candles for atr or lookback', () => {
    const candles: CandleData[] = [
      createNweTestCandle(10, 8, 9),
      createNweTestCandle(11, 9, 10),
    ];
    const params: NWECalculationParams = { lookbackPeriod: 3, atrPeriod: 3, atrMultiplier: 1 };
    const result = calculateNWE(candles, params);
    expect(result.length).toBe(candles.length);
    result.forEach(r => {
      expect(r.nweUpper).toBeNull();
      expect(r.nweLower).toBeNull();
    });
  });

  it('should calculate NWE bands correctly for a simple case', () => {
    const candles: CandleData[] = [
      createNweTestCandle(10, 8, 9),    // i=0
      createNweTestCandle(12, 10, 11),  // i=1
      createNweTestCandle(11, 9, 10),   // i=2
      createNweTestCandle(13, 11, 12),  // i=3
      createNweTestCandle(12, 10, 10),  // i=4
    ];
    const params: NWECalculationParams = { lookbackPeriod: 2, atrPeriod: 2, atrMultiplier: 1 };
    const result = calculateNWE(candles, params);

    expect(result.length).toBe(candles.length);
    expect(result[0].nweUpper).toBeNull();
    expect(result[0].nweLower).toBeNull();

    expect(result[1].nweUpper).toBeCloseTo(14.5, 5);
    expect(result[1].nweLower).toBeCloseTo(5.5, 5);

    expect(result[2].nweUpper).toBeCloseTo(14.25, 5);
    expect(result[2].nweLower).toBeCloseTo(6.75, 5);

    expect(result[3].nweUpper).toBeCloseTo(15.625, 5);
    expect(result[3].nweLower).toBeCloseTo(6.375, 5);
    
    expect(result[4].nweUpper).toBeCloseTo(15.3125, 5);
    expect(result[4].nweLower).toBeCloseTo(7.6875, 5);
  });

  it('should handle ATR being zero initially', () => {
    const candles: CandleData[] = [
      createNweTestCandle(10, 8, 9), 
      createNweTestCandle(11, 9, 10), 
      createNweTestCandle(12, 10, 11)
    ];
    // atrPeriod = 3. TRs for these candles: [2, 2, 2]
    // ATR[2] = (2+2+2)/3 = 2
    // lookbackPeriod = 1
    const params: NWECalculationParams = { lookbackPeriod: 1, atrPeriod: 3, atrMultiplier: 1 };
    const result = calculateNWE(candles, params);

    expect(result[0].nweUpper).toBeNull(); 
    expect(result[0].nweLower).toBeNull();
    expect(result[1].nweUpper).toBeNull(); 
    expect(result[1].nweLower).toBeNull();

    // i=2: ATR[2]=2. HH(2)=12, LL(2)=10 (lookback=1)
    // NWE Up = 12 + 2*1 = 14.
    // NWE Low = 10 - 2*1 = 8.
    expect(result[2].nweUpper).toBeCloseTo(14, 5);
    expect(result[2].nweLower).toBeCloseTo(8, 5);
  });

  it('should work with lookbackPeriod = 1', () => {
    const candles: CandleData[] = [
      createNweTestCandle(10, 8, 9),   
      createNweTestCandle(12, 10, 11), 
    ];                                
    const params: NWECalculationParams = { lookbackPeriod: 1, atrPeriod: 2, atrMultiplier: 0.5 };
    const result = calculateNWE(candles, params);

    expect(result[0].nweUpper).toBeNull(); 
    expect(result[0].nweLower).toBeNull();

    expect(result[1].nweUpper).toBeCloseTo(13.25, 5);
    expect(result[1].nweLower).toBeCloseTo(8.75, 5);
  });
});

// Тесты для calculateAvgVolume
import { calculateAvgVolume, calculateApproxDelta } from './indicators'; // CandleData уже импортирован

describe('calculateAvgVolume', () => {
  // Можно использовать createNweTestCandle или аналогичную для создания свечей
  const createAvgVolTestCandle = (volume: number, high: number = 0, low: number = 0, close: number = 0): CandleData => ({
    high, low, close, volume
  });

  it('should return an array of zeros for no candles', () => {
    const candles: CandleData[] = [];
    const period = 5;
    const result = calculateAvgVolume(candles, period);
    expect(result).toEqual([]);
  });

  it('should return an array of zeros if period is zero or negative', () => {
    const candles: CandleData[] = [createAvgVolTestCandle(100)];
    expect(calculateAvgVolume(candles, 0)).toEqual([0]);
    expect(calculateAvgVolume(candles, -1)).toEqual([0]);
  });

  it('should return array of zeros if not enough candles for the period', () => {
    const candles: CandleData[] = [
      createAvgVolTestCandle(100),
      createAvgVolTestCandle(110),
    ];
    const period = 3;
    const result = calculateAvgVolume(candles, period);
    // Ожидаем [0, 0] так как для i=0, i=1, условие i === period - 1 (i.e. 2) не выполняется
    expect(result).toEqual([0, 0]);
  });

  it('should calculate SMA of volume correctly', () => {
    const candles: CandleData[] = [
      createAvgVolTestCandle(10), // i=0
      createAvgVolTestCandle(20), // i=1
      createAvgVolTestCandle(30), // i=2. Avg(0,1,2) = (10+20+30)/3 = 20
      createAvgVolTestCandle(40), // i=3. Avg(1,2,3) = (20+30+40)/3 = 30
      createAvgVolTestCandle(50), // i=4. Avg(2,3,4) = (30+40+50)/3 = 40
    ];
    const period = 3;
    const result = calculateAvgVolume(candles, period);
    const expected = [
      0,       // i=0, < period-1
      0,       // i=1, < period-1
      20,      // (10+20+30)/3
      30,      // (20+30+40)/3
      40,      // (30+40+50)/3
    ];
    result.forEach((val, index) => {
      expect(val).toBeCloseTo(expected[index], 5);
    });
  });

  it('should handle period of 1 correctly', () => {
    const candles: CandleData[] = [
      createAvgVolTestCandle(10),
      createAvgVolTestCandle(20),
      createAvgVolTestCandle(30),
    ];
    const period = 1;
    const result = calculateAvgVolume(candles, period);
    const expected = [10, 20, 30]; // Avg of 1 is the number itself
    result.forEach((val, index) => {
      expect(val).toBeCloseTo(expected[index], 5);
    });
  });
});

// Тесты для calculateApproxDelta
describe('calculateApproxDelta', () => {
  const createDeltaTestCandle = (high: number, low: number, close: number, volume: number): CandleData => ({
    high, low, close, volume
  });

  it('should return an empty array for no candles', () => {
    const candles: CandleData[] = [];
    const result = calculateApproxDelta(candles);
    expect(result).toEqual([]);
  });

  it('should return 0 delta if high equals low (range is 0)', () => {
    const candles: CandleData[] = [createDeltaTestCandle(10, 10, 10, 100)];
    const result = calculateApproxDelta(candles);
    expect(result[0]).toBe(0);
  });

  it('should return positive delta (volume) for a fully bullish candle (close = high, low < high)', () => {
    const candles: CandleData[] = [createDeltaTestCandle(10, 8, 10, 100)]; // CLV = ((10-8)-(10-10))/(10-8) = 2/2 = 1
    const result = calculateApproxDelta(candles);
    expect(result[0]).toBe(100);
  });

  it('should return negative delta (-volume) for a fully bearish candle (close = low, low < high)', () => {
    const candles: CandleData[] = [createDeltaTestCandle(10, 8, 8, 100)]; // CLV = ((8-8)-(10-8))/(10-8) = -2/2 = -1
    const result = calculateApproxDelta(candles);
    expect(result[0]).toBe(-100);
  });

  it('should return 0 delta if close is exactly in the middle of high and low', () => {
    const candles: CandleData[] = [createDeltaTestCandle(10, 8, 9, 100)]; // CLV = ((9-8)-(10-9))/(10-8) = (1-1)/2 = 0
    const result = calculateApproxDelta(candles);
    expect(result[0]).toBe(0);
  });

  it('should calculate approx delta correctly for a mix of candles', () => {
    const candles: CandleData[] = [
      createDeltaTestCandle(10, 8, 10, 100), // Bullish, CLV=1, Delta=100
      createDeltaTestCandle(10, 8, 8, 50),  // Bearish, CLV=-1, Delta=-50
      createDeltaTestCandle(10, 8, 9, 200), // Neutral, CLV=0, Delta=0
      createDeltaTestCandle(12, 10, 11.5, 80), // CLV = ((11.5-10)-(12-11.5))/(12-10) = (1.5-0.5)/2 = 1/2 = 0.5. Delta=40
      createDeltaTestCandle(10, 10, 10, 1000) // Range 0, Delta=0
    ];
    const expectedDeltas = [100, -50, 0, 40, 0];
    const result = calculateApproxDelta(candles);
    result.forEach((delta, index) => {
      expect(delta).toBeCloseTo(expectedDeltas[index], 5);
    });
  });

  it('should handle candle with invalid (NaN) values by returning 0 delta', () => {
    const candles: CandleData[] = [
      // @ts-ignore to test invalid input
      createDeltaTestCandle(NaN, 8, 9, 100), 
      // @ts-ignore to test invalid input
      createDeltaTestCandle(10, NaN, 9, 100),
      // @ts-ignore to test invalid input
      createDeltaTestCandle(10, 8, NaN, 100),
      // @ts-ignore to test invalid input
      createDeltaTestCandle(10, 8, 9, NaN),
    ];
    const result = calculateApproxDelta(candles);
    expect(result).toEqual([0, 0, 0, 0]);
  });

   it('should handle candle with undefined (will be NaN after Number()) values by returning 0 delta', () => {
    const candles: CandleData[] = [
      // @ts-ignore to test invalid input
      createDeltaTestCandle(undefined, 8, 9, 100), 
    ];
    const result = calculateApproxDelta(candles);
    expect(result).toEqual([0]);
  });
}); 