/**
 * Скрипт для тестирования API портфельного бектестера
 * Запускать когда сервер запущен: node test-portfolio-api.js
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:5000/api';

// Данные для тестирования
const portfolioBacktestParams = {
  pairSymbols: ['BTC-USDT-SWAP', 'ETH-USDT-SWAP'],
  timeframe: '1h',
  startDate: '2024-01-01',
  endDate: '2024-01-02',
  initialPortfolioCapital: 10000,
  strategyParameters: {
    dlc: {
      enabled: true,
      vpNumBins: 20,
      vpVaPercentage: 70,
      longConditions: {
        enabled: true,
        exactBounceFromPOC: true,
        exactBounceFromVAH: true,
        exactBounceFromVAL: true,
        falseBreakoutPOC: true,
        falseBreakoutVAH: true,
        falseBreakoutVAL: true
      },
      shortConditions: {
        enabled: true,
        exactBounceFromPOC: true,
        exactBounceFromVAH: true,
        exactBounceFromVAL: true,
        falseBreakoutPOC: true,
        falseBreakoutVAH: true,
        falseBreakoutVAL: true
      }
    },
    nwe: {
      enabled: true,
      period: 20,
      multiplier: 1.5,
      longConditions: {
        enabled: true,
        bounceFromLower: true,
        falseBreakoutLower: true
      },
      shortConditions: {
        enabled: true,
        bounceFromUpper: true,
        falseBreakoutUpper: true
      }
    },
    clusters: {
      enabled: true,
      volumeThresholdPercentage: 150,
      minClusterStrength: 1.0,
      longConditions: {
        enabled: true,
        supportClusters: true
      },
      shortConditions: {
        enabled: true,
        resistanceClusters: true
      }
    },
    global: {
      atrPeriod: 14,
      avgVolumePeriod: 20
    },
    risk: {
      atrPeriod: 14,
      positionSizePercentage: 0.01,
      maxRiskPerTradePercentage: 0.02,
      stopLossMultiplier: 2.0,
      takeProfitMultiplier: 3.0
    }
  },
  portfolioSettings: {
    maxConcurrentTradesPortfolio: 3
  }
};

async function testPortfolioBacktestAPI() {
  console.log('🚀 Testing Portfolio Backtest API...\n');
  
  try {
    console.log('📊 Request payload:');
    console.log(JSON.stringify(portfolioBacktestParams, null, 2));
    console.log('\n⏳ Sending request to /api/backtest/portfolio/run...\n');
    
    const response = await axios.post(`${BASE_URL}/backtest/portfolio/run`, portfolioBacktestParams, {
      timeout: 120000, // 2 minutes timeout
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`✅ Portfolio Backtest API Response (Status: ${response.status}):`);
    console.log(JSON.stringify(response.data, null, 2));
    
    if (response.data.overallMetrics) {
      console.log('\n📈 Portfolio Summary:');
      console.log(`Total Trades: ${response.data.overallMetrics.totalPortfolioTrades}`);
      console.log(`Total PnL: ${response.data.overallMetrics.totalPortfolioPnl}`);
      console.log(`Win Rate: ${(response.data.overallMetrics.portfolioWinRate * 100).toFixed(2)}%`);
      console.log(`Sharpe Ratio: ${response.data.overallMetrics.sharpeRatioPortfolio}`);
      console.log(`Duration: ${response.data.overallMetrics.durationMs}ms`);
    }
    
  } catch (error) {
    if (error.response) {
      console.log(`❌ Portfolio Backtest API Error (Status: ${error.response.status}):`);
      console.log(JSON.stringify(error.response.data, null, 2));
    } else {
      console.log('❌ Network/Other Error:', error.message);
    }
  }
}

async function main() {
  console.log('🧪 Multi-Backtester API Integration Test\n');
  console.log('🔗 Testing against:', BASE_URL);
  console.log('📝 Make sure the backend server is running!\n');
  console.log('=' .repeat(60));
  
  // Тестируем портфельный бектестер
  await testPortfolioBacktestAPI();
  
  console.log('\n' + '=' .repeat(60));
  console.log('\n✨ API Integration Test Complete!');
}

// Запускаем тест
main().catch(console.error); 