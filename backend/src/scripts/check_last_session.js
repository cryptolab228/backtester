
const { Client } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

async function checkLastSession() {
  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'backtester',
  });

  try {
    await client.connect();
    
    const res = await client.query(`
      SELECT id, status, "configSnapshot", "createdAt"
      FROM trading_sessions 
      WHERE source = 'scanner'
      ORDER BY "createdAt" DESC 
      LIMIT 1;
    `);

    if (res.rows.length === 0) {
        console.log('No scanner sessions found.');
    } else {
        const session = res.rows[0];
        console.log('Last Session ID:', session.id);
        console.log('Status:', session.status);
        console.log('Config Snapshot:', JSON.stringify(session.configSnapshot, null, 2));
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

checkLastSession();
