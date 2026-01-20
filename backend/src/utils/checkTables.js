const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'backtester',
  user: 'user',
  password: 'password'
});

async function checkTables() {
  try {
    console.log('=== CHECKING DATABASE STRUCTURE ===');
    
    // Проверяем все таблицы
    const tablesResult = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    
    console.log('\\nTables in database:');
    tablesResult.rows.forEach(row => {
      console.log(`  - ${row.table_name}`);
    });
    
    // Проверяем структуру таблицы candles
    console.log('\\n=== CANDLES TABLE STRUCTURE ===');
    const columnsResult = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'candles' 
      ORDER BY ordinal_position
    `);
    
    if (columnsResult.rows.length > 0) {
      console.log('\\nColumns in candles table:');
      columnsResult.rows.forEach(row => {
        console.log(`  - ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
      });
      
      // Проверяем данные в таблице
      const countResult = await pool.query('SELECT COUNT(*) as count FROM candles');
      console.log(`\\nTotal candles in database: ${countResult.rows[0].count}`);
      
      if (countResult.rows[0].count > 0) {
        const sampleResult = await pool.query(`
          SELECT * FROM candles 
          ORDER BY timestamp DESC 
          LIMIT 2
        `);
        
        console.log('\\nSample data:');
        sampleResult.rows.forEach((row, index) => {
          console.log(`\\nCandle ${index + 1}:`);
          console.log(JSON.stringify(row, null, 2));
        });
      }
    } else {
      console.log('Candles table not found or empty');
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

checkTables(); 