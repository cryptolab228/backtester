import { AppDataSource } from '../config/dataSource';
import { DataService } from '../services/dataService';
import logger from '../utils/logger';

async function testDataTypes() {
  try {
    // Инициализируем соединение с БД
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
      logger.info('Database connected for testing');
    }

    const dataService = new DataService();
    
    // Загружаем несколько свечей для TRUMPUSDT
    const candles = await dataService.getCandles('TRUMPUSDT', '1h', undefined, undefined, 'bybit');
    
    if (candles.length > 0) {
      const firstCandle = candles[0];
      
      console.log('=== CANDLE DATA TYPES TEST ===');
      console.log('First candle from DB:');
      console.log('timestamp:', firstCandle.timestamp, '(type:', typeof firstCandle.timestamp, ')');
      console.log('open:', firstCandle.open, '(type:', typeof firstCandle.open, ')');
      console.log('high:', firstCandle.high, '(type:', typeof firstCandle.high, ')');
      console.log('low:', firstCandle.low, '(type:', typeof firstCandle.low, ')');
      console.log('close:', firstCandle.close, '(type:', typeof firstCandle.close, ')');
      console.log('volume:', firstCandle.volume, '(type:', typeof firstCandle.volume, ')');
      
      // Проверяем, что происходит при арифметических операциях
      console.log('\n=== ARITHMETIC TEST ===');
      console.log('open + 1:', firstCandle.open + 1);
      console.log('close * 1.5:', firstCandle.close * 1.5);
      console.log('timestamp + 3600000:', firstCandle.timestamp + 3600000);
      
      // Проверяем создание Date
      console.log('\n=== DATE CREATION TEST ===');
      try {
        const date = new Date(firstCandle.timestamp);
        console.log('Date from timestamp:', date);
        console.log('Date ISO:', date.toISOString());
      } catch (error) {
        console.error('Error creating Date:', error);
      }
      
      // Проверяем первые 5 свечей
      console.log('\n=== FIRST 5 CANDLES ===');
      for (let i = 0; i < Math.min(5, candles.length); i++) {
        const candle = candles[i];
        console.log(`Candle ${i}: timestamp=${candle.timestamp} (${typeof candle.timestamp}), close=${candle.close} (${typeof candle.close})`);
        
        try {
          const date = new Date(candle.timestamp);
          console.log(`  Date: ${date.toISOString()}`);
        } catch (error) {
          console.log(`  Date error: ${error}`);
        }
      }
      
    } else {
      console.log('No candles found for TRUMPUSDT');
    }
    
  } catch (error) {
    console.error('Test error:', error);
  } finally {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }
}

// Запускаем тест, если файл выполняется напрямую
if (require.main === module) {
  testDataTypes().catch(console.error);
}

export default testDataTypes; 