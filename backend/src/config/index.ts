import dotenv from 'dotenv';

dotenv.config(); // Загружаем переменные из .env файла

const isDevelopment = process.env.NODE_ENV === 'development';

const config = {
  env: process.env.NODE_ENV || 'development',
  port: process.env.PORT || 5000,
  db: {
    host: isDevelopment && !process.env.DB_HOST ? 'localhost' : (process.env.DB_HOST || 'db'),
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'user',
    password: process.env.DB_PASSWORD || 'password',
    database: process.env.DB_DATABASE || 'backtester_db',
  },
  redis: {
    host: process.env.REDIS_HOST || 'redis',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },
  okx: {
    apiKey: process.env.OKX_API_KEY,
    apiSecret: process.env.OKX_API_SECRET,
    apiPassphrase: process.env.OKX_API_PASSPHRASE,
  }
};

export default config; 