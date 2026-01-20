import { readFileSync } from 'fs'
import { Client } from 'pg'
import logger from '@/utils/logger'
import path from 'path'

class PostgreSQLSimple {
  private client: Client | null = null

  private connection = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USERNAME || 'user',
    password: process.env.DB_PASSWORD || 'password',
    database: process.env.DB_DATABASE || 'backtester',
  }

  async initConnection() {
    const client = new Client(this.connection)
    
    try {
      await client.connect()
      this.client = client
      logger.info('✅ PostgreSQL connection established')
    } catch (error) {
      logger.warn('⚠️ PostgreSQL connection failed:', error)
      logger.info(`🔌 Trying to connect to: ${this.connection.host}:${this.connection.port}/${this.connection.database}`)
      throw error // Все равно выбрасываем, чтобы catch в initDB перехватил
    }
  }

  async createTables() {
    if (!this.client) {
      throw new Error('Database client not initialized')
    }

    try {
      const sqlFilePath = path.join(__dirname, '..', 'sql', 'createTables.sql')
      const sql = readFileSync(sqlFilePath, 'utf8')
      
      await this.client.query(sql)
      logger.info('✅ Database tables created/updated successfully')
    } catch (error) {
      logger.error('❌ Error creating tables:', error)
      throw error
    }
  }

  async initDB() {
    try {
      await this.initConnection()
      await this.createTables()
      logger.info('✅ Database initialization completed')
    } catch (error) {
      logger.warn('⚠️ Database initialization failed, continuing without DB:', error)
      logger.info('💡 Please check PostgreSQL is running and .env settings are correct')
      logger.info('📝 Create backend/.env from backend/.env.example')
      // НЕ выбрасываем ошибку - продолжаем как в CryptoLab
    }
  }

  getClient() {
    return this.client
  }

  async disconnect() {
    if (this.client) {
      await this.client.end()
      logger.info('🔌 PostgreSQL connection closed')
    }
  }
}

export default new PostgreSQLSimple()
