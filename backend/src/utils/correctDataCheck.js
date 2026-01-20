const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'backtester',
  user: 'user',
  password: 'password'
});

async function checkDataTypes() {
  try {
    console.log('=== CHECKING DATA TYPES FROM DATABASE ===');
    
    // Проверяем данные для TRUMPUSDT с JOIN
    const result = await pool.query(`
      SELECT 
        c.id,
        tp.symbol,
        c.timestamp,
        c.open,
        c.high,
        c.low,
        c.close,
        c.volume,
        pg_typeof(c.timestamp) as timestamp_type,
        pg_typeof(c.open) as open_type,
        pg_typeof(c.high) as high_type,
        pg_typeof(c.low) as low_type,
        pg_typeof(c.close) as close_type,
        pg_typeof(c.volume) as volume_type
      FROM candles c
      JOIN trading_pairs tp ON c.pair_id = tp.id
      WHERE tp.symbol = 'TRUMPUSDT' 
      AND c.timeframe = '1h'
      ORDER BY c.timestamp DESC 
      LIMIT 5
    `);
    
    console.log('\\n=== TRUMPUSDT CANDLES FROM DATABASE ===');
    result.rows.forEach((row, index) => {
      console.log(`\\n🕯️ Candle ${index + 1}:`);
      console.log(`  Symbol: ${row.symbol}`);
      console.log(`  Timestamp: ${row.timestamp} (DB type: ${row.timestamp_type}, JS type: ${typeof row.timestamp})`);
      console.log(`  Open: ${row.open} (DB type: ${row.open_type}, JS type: ${typeof row.open})`);
      console.log(`  High: ${row.high} (DB type: ${row.high_type}, JS type: ${typeof row.high})`);
      console.log(`  Low: ${row.low} (DB type: ${row.low_type}, JS type: ${typeof row.low})`);
      console.log(`  Close: ${row.close} (DB type: ${row.close_type}, JS type: ${typeof row.close})`);
      console.log(`  Volume: ${row.volume} (DB type: ${row.volume_type}, JS type: ${typeof row.volume})`);
      
      // ❌ ДЕМОНСТРИРУЕМ ПРОБЛЕМУ
      console.log('\\n  🚨 ПРОБЛЕМА С ТИПАМИ:');
      console.log(`     row.open === 15.237 ? ${row.open === 15.237} (FALSE! Строка не равна числу)`);
      console.log(`     row.open == 15.237 ? ${row.open == 15.237} (TRUE с приведением типов)`);
      console.log(`     parseFloat(row.open) === 15.237 ? ${parseFloat(row.open) === 15.237} (TRUE после парсинга)`);
      
      // Проверяем парсинг timestamp
      const timestampNum = parseInt(row.timestamp);
      console.log(`\\n  📅 Timestamp parsing:`);
      console.log(`     Raw: ${row.timestamp} (${typeof row.timestamp})`);
      console.log(`     Parsed: ${timestampNum} (${typeof timestampNum})`);
      console.log(`     Date: ${new Date(timestampNum).toISOString()}`);
    });
    
    // Сравниваем с ожидаемыми данными для TRUMPUSDT
    console.log('\\n=== КОЛИЧЕСТВО СВЕЧЕЙ ПО ПАРАМ ===');
    const countResult = await pool.query(`
      SELECT tp.symbol, c.timeframe, COUNT(*) as count 
      FROM candles c
      JOIN trading_pairs tp ON c.pair_id = tp.id
      WHERE c.timeframe = '1h'
      GROUP BY tp.symbol, c.timeframe 
      ORDER BY tp.symbol
    `);
    
    countResult.rows.forEach(row => {
      console.log(`  ${row.symbol}: ${row.count} candles`);
    });

    // Проверяем точно данные для TRUMPUSDT в том диапазоне, что использовался в тестах
    console.log('\\n=== TRUMPUSDT DATA SUMMARY ===');
    const trumpResult = await pool.query(`
      SELECT 
        tp.symbol,
        COUNT(*) as total_candles,
        MIN(c.timestamp) as min_timestamp,
        MAX(c.timestamp) as max_timestamp,
        MIN(c.open::float) as min_price,
        MAX(c.high::float) as max_price
      FROM candles c
      JOIN trading_pairs tp ON c.pair_id = tp.id
      WHERE tp.symbol = 'TRUMPUSDT' 
      AND c.timeframe = '1h'
      GROUP BY tp.symbol
    `);

    if (trumpResult.rows.length > 0) {
      const trump = trumpResult.rows[0];
      console.log(`  Symbol: ${trump.symbol}`);
      console.log(`  Total candles: ${trump.total_candles}`);
      console.log(`  Date range: ${new Date(parseInt(trump.min_timestamp)).toISOString()} - ${new Date(parseInt(trump.max_timestamp)).toISOString()}`);
      console.log(`  Price range: $${trump.min_price} - $${trump.max_price}`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

checkDataTypes(); 