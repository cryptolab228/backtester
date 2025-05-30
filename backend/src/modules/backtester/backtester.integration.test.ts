import { runPortfolioBacktest } from './backtester';
import { PortfolioBacktestRunParameters } from './backtester.types';
import { DefaultStrategyParameters } from '../strategy_logic/strategy';
import { dataService } from '../../services/dataService';
import { CandleData } from '../../interfaces/marketData.interface';
import logger from '../../utils/logger';

/**
 * Интеграционный тест для портфельного бектестера с реальными данными
 * Требует запущенной БД и наличия исторических данных
 */
describe('Portfolio Backtester Integration Test', () => {
  // Увеличиваем timeout для интеграционных тестов
  jest.setTimeout(60000);

  const samplePairs = ['BTC-USDT-SWAP', 'ETH-USDT-SWAP'];
  const timeframe = '1h';
  const startDate = '2024-01-01T00:00:00.000Z';
  const endDate = '2024-01-02T00:00:00.000Z';

  describe('Real Data Integration', () => {
    it('should run portfolio backtest with real database data', async () => {
      const params: PortfolioBacktestRunParameters = {
        pairSymbols: samplePairs,
        timeframe,
        startDate,
        endDate,
        initialPortfolioCapital: 10000,
        strategyParameters: {
          ...DefaultStrategyParameters,
          risk: {
            atrPeriod: 14,
            positionSizePercentage: 0.01,
            maxRiskPerTradePercentage: 0.02,
            stopLossMultiplier: 2.0,
            takeProfitMultiplier: 3.0,
          }
        },
        portfolioSettings: {
          maxConcurrentTradesPortfolio: 3,
        },
      };

      // Загружаем реальные данные из БД
      const candlesByPair: Record<string, CandleData[]> = {};
      const startTimestamp = new Date(startDate).getTime();
      const endTimestamp = new Date(endDate).getTime();

      console.log(`[Integration Test] Loading data for pairs: ${samplePairs.join(', ')}`);
      console.log(`[Integration Test] Date range: ${startDate} to ${endDate}`);

      for (const pairSymbol of samplePairs) {
        try {
          // Проверяем существование торговой пары
          const tradingPair = await dataService.getTradingPairBySymbol(pairSymbol);
          if (!tradingPair) {
            console.warn(`[Integration Test] Trading pair ${pairSymbol} not found in DB. Skipping.`);
            continue;
          }

          // Загружаем свечи из БД
          const candlesFromDB = await dataService.getCandles(pairSymbol, timeframe, startTimestamp, endTimestamp);
          console.log(`[Integration Test] Loaded ${candlesFromDB.length} candles for ${pairSymbol}`);

          if (candlesFromDB.length > 0) {
            // Адаптируем данные
            candlesByPair[pairSymbol] = candlesFromDB.map(c => ({
              timestamp: Number(c.timestamp),
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close,
              volume: c.volume,
            }));

            console.log(`[Integration Test] ${pairSymbol} data range: ${new Date(candlesByPair[pairSymbol][0].timestamp)} to ${new Date(candlesByPair[pairSymbol][candlesByPair[pairSymbol].length - 1].timestamp)}`);
          } else {
            console.warn(`[Integration Test] No candles found for ${pairSymbol} in specified range`);
          }
        } catch (error: any) {
          console.error(`[Integration Test] Error loading data for ${pairSymbol}:`, error.message);
        }
      }

      const totalCandles = Object.values(candlesByPair).reduce((sum, candles) => sum + candles.length, 0);
      console.log(`[Integration Test] Total candles loaded: ${totalCandles}`);

      // Пропускаем тест если данных недостаточно
      if (totalCandles === 0) {
        console.warn('[Integration Test] No candle data available. Skipping integration test.');
        console.warn('[Integration Test] To run this test, ensure you have historical data in the database.');
        console.warn('[Integration Test] Run: POST /api/data/fetch-candles with the test pairs and timeframe.');
        return; // Пропускаем тест без ошибки
      }

      // Запускаем портфельный бектест
      console.log('[Integration Test] Running portfolio backtest...');
      const result = await runPortfolioBacktest(params, candlesByPair);

      // Выводим результаты
      console.log('\n=== PORTFOLIO BACKTEST RESULTS ===');
      console.log(`Total Portfolio Trades: ${result.overallMetrics.totalPortfolioTrades}`);
      console.log(`Total Portfolio PnL: ${result.overallMetrics.totalPortfolioPnl}`);
      console.log(`Portfolio Win Rate: ${(result.overallMetrics.portfolioWinRate * 100).toFixed(2)}%`);
      console.log(`Initial Capital: ${result.overallMetrics.initialPortfolioCapital}`);
      console.log(`Final Capital: ${result.overallMetrics.finalPortfolioCapital}`);
      console.log(`ROI: ${(((result.overallMetrics.finalPortfolioCapital - result.overallMetrics.initialPortfolioCapital) / result.overallMetrics.initialPortfolioCapital) * 100).toFixed(2)}%`);
      console.log(`Sharpe Ratio: ${result.overallMetrics.sharpeRatioPortfolio}`);
      console.log(`Avg Concurrent Trades: ${result.overallMetrics.avgConcurrentTrades.toFixed(2)}`);
      console.log(`Peak Concurrent Trades: ${result.overallMetrics.peakConcurrentTrades}`);
      console.log(`Duration: ${result.overallMetrics.durationMs}ms`);

      console.log('\n=== TRADES BY PAIR ===');
      for (const [pair, trades] of Object.entries(result.tradesByPair)) {
        if (trades.length > 0) {
          const pairPnL = trades.reduce((sum, trade) => sum + (trade.pnl || 0), 0);
          const winRate = trades.filter(t => (t.pnl || 0) > 0).length / trades.length;
          console.log(`${pair}: ${trades.length} trades, PnL: ${pairPnL.toFixed(2)}, Win Rate: ${(winRate * 100).toFixed(2)}%`);
          
          // Показываем первые несколько сделок для примера
          if (trades.length > 0) {
            console.log(`  Sample trade: ${trades[0].direction} at ${trades[0].entryPrice}, exit: ${trades[0].exitPrice} (${trades[0].exitReason}), PnL: ${trades[0].pnl || 0}`);
          }
        } else {
          console.log(`${pair}: 0 trades`);
        }
      }

      // Базовые проверки
      expect(result.overallMetrics).toBeDefined();
      expect(result.overallMetrics.initialPortfolioCapital).toBe(10000);
      expect(result.overallMetrics.totalPortfolioTrades).toBeGreaterThanOrEqual(0);
      expect(typeof result.overallMetrics.totalPortfolioPnl).toBe('number');
      expect(result.overallMetrics.portfolioWinRate).toBeGreaterThanOrEqual(0);
      expect(result.overallMetrics.portfolioWinRate).toBeLessThanOrEqual(1);
      expect(result.overallMetrics.avgConcurrentTrades).toBeGreaterThanOrEqual(0);
      expect(result.overallMetrics.peakConcurrentTrades).toBeGreaterThanOrEqual(0);
      expect(result.overallMetrics.durationMs).toBeGreaterThan(0);

      // Проверяем структуру данных
      expect(result.tradesByPair).toBeDefined();
      expect(result.metricsByPair).toBeDefined();
      expect(result.configUsed).toBeDefined();

      console.log('\n[Integration Test] Portfolio backtest completed successfully! ✅');
    });

    it('should handle empty data gracefully', async () => {
      const params: PortfolioBacktestRunParameters = {
        pairSymbols: ['NONEXISTENT-PAIR'],
        timeframe: '1h',
        startDate: '2020-01-01T00:00:00.000Z',
        endDate: '2020-01-02T00:00:00.000Z',
        initialPortfolioCapital: 10000,
        strategyParameters: DefaultStrategyParameters,
      };

      const result = await runPortfolioBacktest(params, {});

      expect(result.overallMetrics.totalPortfolioTrades).toBe(0);
      expect(result.overallMetrics.totalPortfolioPnl).toBe(0);
      expect(result.overallMetrics.finalPortfolioCapital).toBe(10000);
    });
  });
}); 