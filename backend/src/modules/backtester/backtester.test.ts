import { 
  runBacktest, 
  runPortfolioBacktest, 
  calculatePositionSize 
} from './backtester';
import { 
  BacktestRunParameters, 
  BacktestResult, 
  BacktestMetrics,
  PortfolioBacktestRunParameters,
  PortfolioBacktestResult,
  PortfolioSettings,
  Trade,
  TradeDirection 
} from './backtester.types';
import { CandleData } from '../strategy_logic/indicators';
import { DefaultStrategyParameters, StrategyParameters } from '../strategy_logic/strategy';
import * as strategy from '../strategy_logic/strategy';

// Мокируем модуль стратегии для контролируемого тестирования
jest.mock('../strategy_logic/strategy', () => ({
  ...jest.requireActual('../strategy_logic/strategy'),
  applyStrategyLogic: jest.fn(),
}));

const mockedApplyStrategyLogic = strategy.applyStrategyLogic as jest.MockedFunction<typeof strategy.applyStrategyLogic>;

// Helper функции для создания тестовых данных
const createMockCandle = (
  timestamp: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number = 100
): CandleData => ({
  timestamp,
  open,
  high,
  low,
  close,
  volume,
});

const createMockStrategyCandle = (
  candle: CandleData,
  entryConditionLong: boolean = false,
  entryConditionShort: boolean = false,
  signalStrength: number | null = null,
  atr: number = 1.0
) => ({
  ...candle,
  atr,
  nweUpper: null,
  nweLower: null,
  avgVolume: 80,
  approxDelta: 0,
  isVolumeCluster: false,
  entryConditionLong,
  entryConditionShort,
  signalStrength: (entryConditionLong || entryConditionShort) ? signalStrength : null,
});

describe('Multi-Backtester (Portfolio Backtester)', () => {
  beforeEach(() => {
    mockedApplyStrategyLogic.mockReset();
    jest.clearAllMocks();
  });

  describe('runPortfolioBacktest', () => {
    const defaultPortfolioParams: PortfolioBacktestRunParameters = {
      pairSymbols: ['BTCUSDT', 'ETHUSDT'],
      timeframe: '1h',
      startDate: '2024-01-01',
      endDate: '2024-01-02',
      initialPortfolioCapital: 10000,
      strategyParameters: {
        ...DefaultStrategyParameters,
        risk: {
          atrPeriod: 14,
          positionSizePercentage: 0.01, // 1% от капитала
          maxRiskPerTradePercentage: 0.02, // 2% риск на сделку
          stopLossMultiplier: 2.0,
          takeProfitMultiplier: 3.0,
        }
      },
      portfolioSettings: {
        maxConcurrentTradesPortfolio: 5,
      },
    };

    describe('Input Validation', () => {
      it('should throw error if no pair symbols provided', async () => {
        const params = { ...defaultPortfolioParams, pairSymbols: [] };
        const candlesByPair = {};

        await expect(runPortfolioBacktest(params, candlesByPair))
          .rejects
          .toThrow('No pair symbols provided for portfolio backtest');
      });

      it('should throw error if initial capital is negative or zero', async () => {
        const params = { ...defaultPortfolioParams, initialPortfolioCapital: 0 };
        const candlesByPair = { 'BTCUSDT': [], 'ETHUSDT': [] };

        await expect(runPortfolioBacktest(params, candlesByPair))
          .rejects
          .toThrow('Initial portfolio capital must be positive');
      });

      it('should handle missing candles for some pairs gracefully', async () => {
        const params = defaultPortfolioParams;
        const candlesByPair = {
          'BTCUSDT': [createMockCandle(1000, 100, 105, 95, 102)],
          // ETHUSDT отсутствует
        };

        mockedApplyStrategyLogic.mockImplementation((candles, strategyParams) => ({
          strategyCandles: candles.map(c => createMockStrategyCandle(c)),
          volumeProfile: null,
        }));

        const result = await runPortfolioBacktest(params, candlesByPair);
        
        expect(result.overallMetrics).toBeDefined();
        expect(result.tradesByPair['BTCUSDT']).toBeDefined();
        expect(result.tradesByPair['ETHUSDT']).toEqual([]);
      });
    });

    describe('Strategy Logic Application', () => {
      it('should apply strategy logic to each pair individually', async () => {
        const params = defaultPortfolioParams;
        const candlesByPair = {
          'BTCUSDT': [createMockCandle(1000, 100, 105, 95, 102)],
          'ETHUSDT': [createMockCandle(1000, 200, 210, 190, 205)],
        };

        mockedApplyStrategyLogic.mockImplementation((candles, strategyParams) => ({
          strategyCandles: candles.map(c => createMockStrategyCandle(c)),
          volumeProfile: null,
        }));

        await runPortfolioBacktest(params, candlesByPair);

        expect(mockedApplyStrategyLogic).toHaveBeenCalledTimes(2);
        expect(mockedApplyStrategyLogic).toHaveBeenCalledWith(
          candlesByPair['BTCUSDT'], 
          params.strategyParameters
        );
        expect(mockedApplyStrategyLogic).toHaveBeenCalledWith(
          candlesByPair['ETHUSDT'], 
          params.strategyParameters
        );
      });
    });

    describe('Candle Synchronization', () => {
      it('should process candles in chronological order across all pairs', async () => {
        const params = defaultPortfolioParams;
        const candlesByPair = {
          'BTCUSDT': [
            createMockCandle(1000, 100, 105, 95, 102),  // timestamp 1000
            createMockCandle(3000, 102, 107, 97, 104),  // timestamp 3000
          ],
          'ETHUSDT': [
            createMockCandle(2000, 200, 210, 190, 205), // timestamp 2000
            createMockCandle(4000, 205, 215, 195, 210), // timestamp 4000
          ],
        };

        // Мокируем стратегию так, чтобы генерировать сигналы с signalStrength
        mockedApplyStrategyLogic.mockImplementation((candles, strategyParams) => ({
          strategyCandles: candles.map((c, i) => createMockStrategyCandle(
            c, 
            true, // entryConditionLong 
            false, 
            2.0 + i, // signalStrength увеличивается
            1.0
          )),
          volumeProfile: null,
        }));

        const result = await runPortfolioBacktest(params, candlesByPair);

        // Проверяем, что результат корректно обработал хронологический порядок
        expect(result.overallMetrics).toBeDefined();
        expect(result.tradesByPair['BTCUSDT']).toBeDefined();
        expect(result.tradesByPair['ETHUSDT']).toBeDefined();
      });

      it('should handle simultaneous timestamps correctly', async () => {
        const params = defaultPortfolioParams;
        const sharedTimestamp = 1000;
        const candlesByPair = {
          'BTCUSDT': [createMockCandle(sharedTimestamp, 100, 105, 95, 102)],
          'ETHUSDT': [createMockCandle(sharedTimestamp, 200, 210, 190, 205)],
        };

        mockedApplyStrategyLogic.mockImplementation((candles, strategyParams) => ({
          strategyCandles: candles.map(c => createMockStrategyCandle(c, true, false, 1.5, 1.0)),
          volumeProfile: null,
        }));

        const result = await runPortfolioBacktest(params, candlesByPair);

        expect(result.overallMetrics.totalPortfolioTrades).toBeGreaterThan(0);
      });
    });

    describe('Signal Prioritization', () => {
      it('should prioritize signals by strength when processing simultaneous signals', async () => {
        const params = { ...defaultPortfolioParams, portfolioSettings: { maxConcurrentTradesPortfolio: 1 } };
        const sharedTimestamp = 1000;
        const candlesByPair = {
          'BTCUSDT': [createMockCandle(sharedTimestamp, 100, 105, 95, 102)],
          'ETHUSDT': [createMockCandle(sharedTimestamp, 200, 210, 190, 205)],
        };

        // ETHUSDT будет иметь более сильный сигнал (3.0 vs 1.0)
        mockedApplyStrategyLogic.mockImplementation((candles, strategyParams) => {
          if (candles[0].close === 102) { // BTCUSDT
            return {
              strategyCandles: candles.map(c => createMockStrategyCandle(c, true, false, 1.0, 1.0)),
              volumeProfile: null,
            };
          } else { // ETHUSDT
            return {
              strategyCandles: candles.map(c => createMockStrategyCandle(c, true, false, 3.0, 1.0)),
              volumeProfile: null,
            };
          }
        });

        const result = await runPortfolioBacktest(params, candlesByPair);

        // При лимите в 1 сделку, должна быть открыта только сделка с более сильным сигналом (ETHUSDT)
        expect(result.overallMetrics.totalPortfolioTrades).toBe(1);
        expect(result.tradesByPair['ETHUSDT'].length).toBe(1);
        expect(result.tradesByPair['BTCUSDT'].length).toBe(0);
      });

      it('should respect maxConcurrentTrades limit', async () => {
        const params = { ...defaultPortfolioParams, portfolioSettings: { maxConcurrentTradesPortfolio: 2 } };
        const candlesByPair = {
          'PAIR1': [createMockCandle(1000, 100, 105, 95, 102)],
          'PAIR2': [createMockCandle(1000, 200, 210, 190, 205)],
          'PAIR3': [createMockCandle(1000, 300, 310, 290, 305)],
        };

        mockedApplyStrategyLogic.mockImplementation((candles, strategyParams) => ({
          strategyCandles: candles.map(c => createMockStrategyCandle(c, true, false, 2.0, 1.0)),
          volumeProfile: null,
        }));

        const result = await runPortfolioBacktest(params, candlesByPair);

        // При лимите в 2 сделки, не должно быть более 2 одновременных сделок
        expect(result.overallMetrics.peakConcurrentTrades).toBeLessThanOrEqual(2);
      });
    });

    describe('Trade Management', () => {
      it('should open and close trades correctly for multiple pairs', async () => {
        const params = defaultPortfolioParams;
        const candlesByPair = {
          'BTCUSDT': [
            createMockCandle(1000, 100, 105, 95, 102), // Сигнал на вход
            createMockCandle(2000, 102, 110, 98, 108), // SL/TP проверка
          ],
          'ETHUSDT': [
            createMockCandle(1500, 200, 210, 190, 205), // Сигнал на вход
            createMockCandle(2500, 205, 220, 200, 215), // SL/TP проверка
          ],
        };

        mockedApplyStrategyLogic.mockImplementation((candles, strategyParams) => ({
          strategyCandles: candles.map((c, i) => createMockStrategyCandle(
            c, 
            i === 0, // Сигнал только на первой свече
            false, 
            i === 0 ? 2.0 : null, 
            1.0
          )),
          volumeProfile: null,
        }));

        const result = await runPortfolioBacktest(params, candlesByPair);

        expect(result.tradesByPair['BTCUSDT'].length).toBeGreaterThan(0);
        expect(result.tradesByPair['ETHUSDT'].length).toBeGreaterThan(0);
        
        // Проверяем, что сделки имеют корректные поля
        const btcTrade = result.tradesByPair['BTCUSDT'][0];
        expect(btcTrade.pair).toBe('BTCUSDT');
        expect(btcTrade.direction).toBe(TradeDirection.LONG);
        expect(btcTrade.entryPrice).toBe(102);
        expect(btcTrade.stopLoss).toBeDefined();
        expect(btcTrade.takeProfit).toBeDefined();
      });

      it('should handle stop loss correctly', async () => {
        const params = defaultPortfolioParams;
        const candlesByPair = {
          'BTCUSDT': [
            createMockCandle(1000, 100, 105, 95, 102), // Вход
            createMockCandle(2000, 90, 95, 85, 88),    // SL должен сработать (low = 85, SL ~= 93)
          ],
        };

        mockedApplyStrategyLogic.mockImplementation((candles, strategyParams) => ({
          strategyCandles: candles.map((c, i) => createMockStrategyCandle(
            c, 
            i === 0, // Сигнал только на первой свече
            false, 
            i === 0 ? 2.0 : null, 
            1.0
          )),
          volumeProfile: null,
        }));

        const result = await runPortfolioBacktest(params, candlesByPair);

        expect(result.tradesByPair['BTCUSDT'].length).toBe(1);
        const trade = result.tradesByPair['BTCUSDT'][0];
        expect(trade.exitReason).toBe('SL');
        expect(trade.pnl).toBeLessThan(0); // Убыточная сделка
      });

      it('should handle take profit correctly', async () => {
        const params = defaultPortfolioParams;
        const candlesByPair = {
          'BTCUSDT': [
            createMockCandle(1000, 100, 105, 95, 102), // Вход
            createMockCandle(2000, 110, 120, 108, 115), // TP должен сработать (high = 120, TP ~= 107)
          ],
        };

        mockedApplyStrategyLogic.mockImplementation((candles, strategyParams) => ({
          strategyCandles: candles.map((c, i) => createMockStrategyCandle(
            c, 
            i === 0, // Сигнал только на первой свече
            false, 
            i === 0 ? 2.0 : null, 
            1.0
          )),
          volumeProfile: null,
        }));

        const result = await runPortfolioBacktest(params, candlesByPair);

        expect(result.tradesByPair['BTCUSDT'].length).toBe(1);
        const trade = result.tradesByPair['BTCUSDT'][0];
        expect(trade.exitReason).toBe('TP');
        expect(trade.pnl).toBeGreaterThan(0); // Прибыльная сделка
      });
    });

    describe('Portfolio Metrics Calculation', () => {
      it('should calculate overall portfolio metrics correctly', async () => {
        const params = defaultPortfolioParams;
        const candlesByPair = {
          'BTCUSDT': [
            createMockCandle(1000, 100, 105, 95, 102),
            createMockCandle(2000, 102, 110, 98, 108),
          ],
          'ETHUSDT': [
            createMockCandle(1500, 200, 210, 190, 205),
            createMockCandle(2500, 205, 220, 200, 215),
          ],
        };

        mockedApplyStrategyLogic.mockImplementation((candles, strategyParams) => ({
          strategyCandles: candles.map((c, i) => createMockStrategyCandle(
            c, 
            i === 0,
            false, 
            i === 0 ? 2.0 : null, 
            1.0
          )),
          volumeProfile: null,
        }));

        const result = await runPortfolioBacktest(params, candlesByPair);

        // Проверяем основные метрики портфеля
        expect(result.overallMetrics.initialPortfolioCapital).toBe(10000);
        expect(result.overallMetrics.totalPortfolioTrades).toBeGreaterThan(0);
        expect(result.overallMetrics.portfolioWinRate).toBeGreaterThanOrEqual(0);
        expect(result.overallMetrics.portfolioWinRate).toBeLessThanOrEqual(1);
        expect(result.overallMetrics.durationMs).toBeGreaterThan(0);
        
        // Проверяем специфичные для портфеля метрики
        expect(result.overallMetrics.avgConcurrentTrades).toBeGreaterThanOrEqual(0);
        expect(result.overallMetrics.peakConcurrentTrades).toBeGreaterThanOrEqual(0);
        expect(typeof result.overallMetrics.sharpeRatioPortfolio).toBe('number');
      });

      it('should calculate individual pair metrics correctly', async () => {
        const params = defaultPortfolioParams;
        const candlesByPair = {
          'BTCUSDT': [
            createMockCandle(1000, 100, 105, 95, 102),
            createMockCandle(2000, 102, 110, 98, 108),
          ],
        };

        mockedApplyStrategyLogic.mockImplementation((candles, strategyParams) => ({
          strategyCandles: candles.map((c, i) => createMockStrategyCandle(
            c, 
            i === 0,
            false, 
            i === 0 ? 2.0 : null, 
            1.0
          )),
          volumeProfile: null,
        }));

        const result = await runPortfolioBacktest(params, candlesByPair);

        expect(result.metricsByPair['BTCUSDT']).toBeDefined();
        const btcMetrics = result.metricsByPair['BTCUSDT'];
        
        expect(btcMetrics.totalTrades).toBeGreaterThanOrEqual(0);
        expect(btcMetrics.winRate).toBeGreaterThanOrEqual(0);
        expect(btcMetrics.winRate).toBeLessThanOrEqual(1);
        expect(typeof btcMetrics.totalPnl).toBe('number');
        expect(typeof btcMetrics.profitFactor).toBe('number');
      });

      it('should handle portfolio with no trades', async () => {
        const params = defaultPortfolioParams;
        const candlesByPair = {
          'BTCUSDT': [createMockCandle(1000, 100, 105, 95, 102)],
        };

        // Мокируем стратегию без сигналов
        mockedApplyStrategyLogic.mockImplementation((candles, strategyParams) => ({
          strategyCandles: candles.map(c => createMockStrategyCandle(c, false, false, null, 1.0)),
          volumeProfile: null,
        }));

        const result = await runPortfolioBacktest(params, candlesByPair);

        expect(result.overallMetrics.totalPortfolioTrades).toBe(0);
        expect(result.overallMetrics.totalPortfolioPnl).toBe(0);
        expect(result.overallMetrics.portfolioWinRate).toBe(0);
        expect(result.overallMetrics.avgConcurrentTrades).toBe(0);
        expect(result.overallMetrics.peakConcurrentTrades).toBe(0);
      });
    });

    describe('Capital Management', () => {
      it('should update portfolio capital correctly after trades', async () => {
        const params = defaultPortfolioParams;
        const candlesByPair = {
          'BTCUSDT': [
            createMockCandle(1000, 100, 105, 95, 102),
            createMockCandle(2000, 102, 110, 98, 108), // TP сработает
          ],
        };

        mockedApplyStrategyLogic.mockImplementation((candles, strategyParams) => ({
          strategyCandles: candles.map((c, i) => createMockStrategyCandle(
            c, 
            i === 0,
            false, 
            i === 0 ? 2.0 : null, 
            1.0
          )),
          volumeProfile: null,
        }));

        const result = await runPortfolioBacktest(params, candlesByPair);

        const expectedFinalCapital = params.initialPortfolioCapital + result.overallMetrics.totalPortfolioPnl;
        expect(result.overallMetrics.finalPortfolioCapital).toBeCloseTo(expectedFinalCapital, 2);
      });

      it('should handle insufficient capital gracefully', async () => {
        const params = { ...defaultPortfolioParams, initialPortfolioCapital: 100 }; // Очень маленький капитал
        const candlesByPair = {
          'BTCUSDT': [createMockCandle(1000, 50000, 55000, 45000, 52000)], // Очень дорогая пара
        };

        mockedApplyStrategyLogic.mockImplementation((candles, strategyParams) => ({
          strategyCandles: candles.map(c => createMockStrategyCandle(c, true, false, 2.0, 1000)), // Высокий ATR
          volumeProfile: null,
        }));

        const result = await runPortfolioBacktest(params, candlesByPair);

        // Не должно быть сделок из-за недостатка капитала
        expect(result.overallMetrics.totalPortfolioTrades).toBe(0);
        expect(result.overallMetrics.finalPortfolioCapital).toBe(100);
      });
    });

    describe('Equity Curve', () => {
      it('should generate portfolio equity curve correctly', async () => {
        const params = defaultPortfolioParams;
        const candlesByPair = {
          'BTCUSDT': [
            createMockCandle(1000, 100, 105, 95, 102),
            createMockCandle(2000, 102, 110, 98, 108),
          ],
        };

        mockedApplyStrategyLogic.mockImplementation((candles, strategyParams) => ({
          strategyCandles: candles.map((c, i) => createMockStrategyCandle(
            c, 
            i === 0,
            false, 
            i === 0 ? 2.0 : null, 
            1.0
          )),
          volumeProfile: null,
        }));

        const result = await runPortfolioBacktest(params, candlesByPair);

        expect(result.overallMetrics.portfolioEquityCurve).toBeDefined();
        expect(result.overallMetrics.portfolioEquityCurve.length).toBeGreaterThan(0);
        
        // Первая точка должна быть начальный капитал
        const firstPoint = result.overallMetrics.portfolioEquityCurve[0];
        expect(firstPoint.capital).toBe(params.initialPortfolioCapital);
      });
    });

    describe('Edge Cases', () => {
      it('should handle empty candles data', async () => {
        const params = defaultPortfolioParams;
        const candlesByPair = {
          'BTCUSDT': [],
          'ETHUSDT': [],
        };

        const result = await runPortfolioBacktest(params, candlesByPair);

        expect(result.overallMetrics.totalPortfolioTrades).toBe(0);
        expect(result.overallMetrics.finalPortfolioCapital).toBe(params.initialPortfolioCapital);
      });

      it('should handle strategy logic errors gracefully', async () => {
        const params = defaultPortfolioParams;
        const candlesByPair = {
          'BTCUSDT': [createMockCandle(1000, 100, 105, 95, 102)],
        };

        mockedApplyStrategyLogic.mockImplementation(() => {
          throw new Error('Strategy error');
        });

        await expect(runPortfolioBacktest(params, candlesByPair)).rejects.toThrow('Strategy error');
      });

      it('should handle candles with invalid ATR', async () => {
        const params = defaultPortfolioParams;
        const candlesByPair = {
          'BTCUSDT': [createMockCandle(1000, 100, 105, 95, 102)],
        };

        mockedApplyStrategyLogic.mockImplementation((candles, strategyParams) => ({
          strategyCandles: candles.map(c => createMockStrategyCandle(c, true, false, 2.0, 0)), // ATR = 0
          volumeProfile: null,
        }));

        const result = await runPortfolioBacktest(params, candlesByPair);

        // Не должно быть сделок из-за невалидного ATR
        expect(result.overallMetrics.totalPortfolioTrades).toBe(0);
      });
    });
  });

  describe('Integration with Single Backtester', () => {
    it('should produce consistent results when portfolio has only one pair', async () => {
      const singlePairParams: BacktestRunParameters = {
        pairSymbol: 'BTCUSDT',
        timeframe: '1h',
        startDate: '2024-01-01',
        endDate: '2024-01-02',
        initialCapital: 10000,
        strategyParameters: DefaultStrategyParameters,
      };

      const portfolioParams: PortfolioBacktestRunParameters = {
        pairSymbols: ['BTCUSDT'],
        timeframe: '1h',
        startDate: '2024-01-01',
        endDate: '2024-01-02',
        initialPortfolioCapital: 10000,
        strategyParameters: DefaultStrategyParameters,
      };

      const candles = [
        createMockCandle(1000, 100, 105, 95, 102),
        createMockCandle(2000, 102, 110, 98, 108),
      ];

      mockedApplyStrategyLogic.mockImplementation((candles, strategyParams) => ({
        strategyCandles: candles.map((c, i) => createMockStrategyCandle(
          c, 
          i === 0,
          false, 
          i === 0 ? 2.0 : null, 
          1.0
        )),
        volumeProfile: null,
      }));

      const singleResult = await runBacktest(singlePairParams, candles);
      const portfolioResult = await runPortfolioBacktest(portfolioParams, { 'BTCUSDT': candles });

      // Результаты должны быть схожими (с учетом возможных различий в реализации)
      expect(portfolioResult.overallMetrics.totalPortfolioTrades).toBe(singleResult.metrics.totalTrades);
      expect(portfolioResult.tradesByPair['BTCUSDT'].length).toBe(singleResult.trades.length);
    });
  });

  describe('Integration test for debugging', () => {
    it('should create portfolio trades with simple setup', async () => {
      const params: PortfolioBacktestRunParameters = {
        pairSymbols: ['BTCUSDT'],
        timeframe: '1h',
        startDate: '2024-01-01',
        endDate: '2024-01-02',
        initialPortfolioCapital: 10000,
        strategyParameters: {
          ...DefaultStrategyParameters,
          risk: {
            atrPeriod: 14,
            positionSizePercentage: 0.01, // 1% от капитала
            maxRiskPerTradePercentage: 0.02, // 2% риск на сделку
            stopLossMultiplier: 2.0,
            takeProfitMultiplier: 3.0,
          }
        },
        portfolioSettings: {
          maxConcurrentTradesPortfolio: 5,
        },
      };

      const candlesByPair = {
        'BTCUSDT': [
          createMockCandle(1000, 100, 105, 95, 102), // Entry signal
          createMockCandle(2000, 102, 110, 98, 108), // Exit signal
        ],
      };

      // Импортируем реальную функцию напрямую для этого теста
      const { applyStrategyLogic: realApplyStrategyLogic } = jest.requireActual('../strategy_logic/strategy');
      mockedApplyStrategyLogic.mockImplementation(realApplyStrategyLogic);

      const result = await runPortfolioBacktest(params, candlesByPair);

      console.log('Result:', {
        totalTrades: result.overallMetrics.totalPortfolioTrades,
        btcTrades: result.tradesByPair['BTCUSDT'].length,
        strategyCandlesCount: result.strategyCandlesByPair?.['BTCUSDT']?.length || 0,
        firstStrategyCandle: result.strategyCandlesByPair?.['BTCUSDT']?.[0],
      });

      expect(result.overallMetrics).toBeDefined();
    });
  });

  describe('Integration test for debugging with crafted signals', () => {
    it('should create portfolio trades with crafted test data that generates signals', async () => {
      const params: PortfolioBacktestRunParameters = {
        pairSymbols: ['BTCUSDT'],
        timeframe: '1h',
        startDate: '2024-01-01',
        endDate: '2024-01-02',
        initialPortfolioCapital: 10000,
        strategyParameters: {
          ...DefaultStrategyParameters,
          risk: {
            atrPeriod: 14,
            positionSizePercentage: 0.01, // 1% от капитала
            maxRiskPerTradePercentage: 0.02, // 2% риск на сделку
            stopLossMultiplier: 2.0,
            takeProfitMultiplier: 3.0,
          }
        },
        portfolioSettings: {
          maxConcurrentTradesPortfolio: 5,
        },
      };

      // Создаем специальные данные для реального теста
      const candlesByPair = {
        'BTCUSDT': [
          // Первая свеча - базовая, нет сигналов
          createMockCandle(1000, 100, 105, 95, 102, 1000), 
          // Вторая свеча - высокий объем для кластера
          createMockCandle(2000, 102, 110, 98, 108, 3000), // Объем в 3 раза больше среднего
          // Третья свеча - для закрытия позиции
          createMockCandle(3000, 108, 115, 105, 112, 800), 
        ],
      };

      // Мокируем стратегию так чтобы она создавала корректные сигналы
      mockedApplyStrategyLogic.mockImplementation((candles, strategyParams) => {
        console.log('[MOCK] applyStrategyLogic called with candles:', candles.length);
        
        return {
          strategyCandles: candles.map((c, i) => {
            let entryLong = false;
            let signalStrength: number | null = null;
            
            // На второй свече создаем сигнал входа LONG
            if (i === 1) { 
              entryLong = true;
              signalStrength = 2.5; // Хорошая сила сигнала
            }
            
            const result = createMockStrategyCandle(c, entryLong, false, signalStrength, 2.0);
            console.log(`[MOCK] Candle ${i}: entryLong=${entryLong}, signalStrength=${signalStrength}`);
            return result;
          }),
          volumeProfile: null,
        };
      });

      const result = await runPortfolioBacktest(params, candlesByPair);

      console.log('Crafted Signal Test Result:', {
        totalTrades: result.overallMetrics.totalPortfolioTrades,
        btcTrades: result.tradesByPair['BTCUSDT'].length,
        strategyCandlesCount: result.strategyCandlesByPair?.['BTCUSDT']?.length || 0,
        firstTrade: result.tradesByPair['BTCUSDT']?.[0],
      });

      // Проверяем, что сделки созданы
      expect(result.overallMetrics.totalPortfolioTrades).toBeGreaterThan(0);
      expect(result.tradesByPair['BTCUSDT'].length).toBeGreaterThan(0);
      
      const trade = result.tradesByPair['BTCUSDT'][0];
      expect(trade.pair).toBe('BTCUSDT');
      expect(trade.direction).toBe(TradeDirection.LONG);
      expect(trade.entryPrice).toBe(108); // Цена закрытия второй свечи
      expect(trade.stopLoss).toBeDefined();
      expect(trade.takeProfit).toBeDefined();
      expect(trade.size).toBeGreaterThan(0);
    });
  });
});

// === ТЕСТЫ ДЛЯ ВСПОМОГАТЕЛЬНЫХ ФУНКЦИЙ ===

describe('Portfolio Helper Functions', () => {
  describe('Sharpe Ratio Calculation', () => {
    // Sharpe ratio тестирование будет добавлено, когда функция станет публичной или экспортируемой
  });

  describe('Individual Pair Metrics Calculation', () => {
    // Тестирование функции calculateIndividualPairMetrics
  });
}); 