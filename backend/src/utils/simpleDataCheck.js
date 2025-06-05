const { Pool } = require('pg');

// Подключение к БД (используем настройки из конфигурации)
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'backtester_db',
  user: 'user',
  password: 'password'
});

async function checkDataTypes() {
  try {
    console.log('=== CHECKING DATA TYPES FROM DATABASE ===');
    
    // Проверяем типы данных для TRUMPUSDT
    const result = await pool.query(`
      SELECT 
        id,
        symbol,
        timestamp,
        open,
        high,
        low,
        close,
        volume,
        pg_typeof(timestamp) as timestamp_type,
        pg_typeof(open) as open_type,
        pg_typeof(high) as high_type,
        pg_typeof(low) as low_type,
        pg_typeof(close) as close_type,
        pg_typeof(volume) as volume_type
      FROM candles 
      WHERE symbol = 'TRUMPUSDT' 
      AND timeframe = '1h'
      ORDER BY timestamp DESC 
      LIMIT 5
    `);
    
    console.log('\\nFirst 5 TRUMPUSDT candles from DB:');
    result.rows.forEach((row, index) => {
      console.log(`\\nCandle ${index + 1}:`);
      console.log(`  ID: ${row.id}`);
      console.log(`  Symbol: ${row.symbol}`);
      console.log(`  Timestamp: ${row.timestamp} (type: ${row.timestamp_type}, JS type: ${typeof row.timestamp})`);
      console.log(`  Open: ${row.open} (type: ${row.open_type}, JS type: ${typeof row.open})`);
      console.log(`  High: ${row.high} (type: ${row.high_type}, JS type: ${typeof row.high})`);
      console.log(`  Low: ${row.low} (type: ${row.low_type}, JS type: ${typeof row.low})`);
      console.log(`  Close: ${row.close} (type: ${row.close_type}, JS type: ${typeof row.close})`);
      console.log(`  Volume: ${row.volume} (type: ${row.volume_type}, JS type: ${typeof row.volume})`);
      
      // Проверяем парсинг
      const timestampNum = parseInt(row.timestamp);
      const openNum = parseFloat(row.open);
      console.log(`  Parsed timestamp: ${timestampNum} (${new Date(timestampNum).toISOString()})`);
      console.log(`  Parsed open: ${openNum}`);
    });
    
    // Проверяем общее количество свечей для каждой пары
    console.log('\\n=== CANDLES COUNT BY SYMBOL ===');
    const countResult = await pool.query(`
      SELECT symbol, timeframe, COUNT(*) as count 
      FROM candles 
      WHERE timeframe = '1h'
      GROUP BY symbol, timeframe 
      ORDER BY symbol
    `);
    
    countResult.rows.forEach(row => {
      console.log(`${row.symbol}: ${row.count} candles`);
    });
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

checkDataTypes(); 