const fs = require('fs');
const path = require('path');

console.log('🔍 Testing portfolio results file creation and download...');

async function testPortfolioFileCreation() {
  try {
    // Определяем правильный путь к директории результатов (backend/public/portfolio-results)
    const portfolioResultsDir = path.join(__dirname, 'public', 'portfolio-results');
    console.log('📁 Target directory:', portfolioResultsDir);
    
    // Создаем директорию если она не существует
    await fs.promises.mkdir(portfolioResultsDir, { recursive: true });
    console.log('✅ Directory created/verified successfully');
    
    // Создаем тестовые данные
    const testData = {
      test: true,
      type: 'portfolio_backtest_results',
      timestamp: new Date().toISOString(),
      overallMetrics: {
        totalPortfolioPnl: 1500.50,
        totalPortfolioTrades: 25,
        portfolioWinRate: 0.685,
        sharpeRatioPortfolio: 1.45,
        initialPortfolioCapital: 10000,
        finalPortfolioCapital: 11500.50
      },
      metricsByPair: {
        'BTC-USDT-SWAP': {
          totalTrades: 10,
          totalPnl: 800.25,
          winRate: 0.70
        },
        'ETH-USDT-SWAP': {
          totalTrades: 15, 
          totalPnl: 700.25,
          winRate: 0.67
        }
      },
      tradesByPair: {
        'BTC-USDT-SWAP': [
          {
            id: 1,
            entryPrice: 45000,
            exitPrice: 46000,
            pnl: 150.5,
            direction: 'long',
            timestamp: '2024-01-01T10:00:00Z'
          }
        ],
        'ETH-USDT-SWAP': [
          {
            id: 2,
            entryPrice: 3000,
            exitPrice: 3100,
            pnl: 200.75,
            direction: 'long',
            timestamp: '2024-01-01T11:00:00Z'
          }
        ]
      },
      note: 'Это тестовый файл для проверки скачивания результатов портфельного бектеста'
    };
    
    // Создаем имя файла
    const filename = `test-portfolio-results-${Date.now()}.json`;
    const filepath = path.join(portfolioResultsDir, filename);
    
    // Записываем файл
    const jsonString = JSON.stringify(testData, null, 2);
    await fs.promises.writeFile(filepath, jsonString, 'utf8');
    
    console.log('✅ Test file created successfully:');
    console.log('   📁 Path:', filepath);
    console.log('   📄 Filename:', filename);
    console.log('   📏 Size:', jsonString.length, 'bytes');
    
    // Проверяем, что файл создался
    const stats = await fs.promises.stat(filepath);
    console.log('✅ File verification:');
    console.log('   📏 Actual size:', stats.size, 'bytes');
    console.log('   📅 Created:', stats.birthtime);
    
    // Тестируем чтение файла
    const readData = await fs.promises.readFile(filepath, 'utf8');
    const parsedData = JSON.parse(readData);
    console.log('✅ File read test successful');
    console.log('   📊 Trades count:', parsedData.overallMetrics.totalPortfolioTrades);
    
    console.log('\n🌐 Download URLs to test:');
    console.log(`   Direct: http://localhost:5000/portfolio-results/${filename}`);
    console.log(`   API: http://localhost:5000/api/data/portfolio-results/${filename}`);
    
    console.log('\n🎉 Portfolio file test completed successfully!');
    console.log('💡 You can now test downloading the file using the URLs above');
    
  } catch (error) {
    console.error('❌ Portfolio file test failed:', error.message);
    console.error('Stack:', error.stack);
  }
}

testPortfolioFileCreation(); 