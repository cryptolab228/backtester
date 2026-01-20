import winston from 'winston';
import path from 'path';

// Определяем уровни логирования в зависимости от среды
const getLogLevel = () => {
  const env = process.env.NODE_ENV || 'development';
  
  switch (env) {
    case 'production':
      return 'info'; // В production отключаем debug логи
    case 'test':
      return 'error';
    default:
      return 'debug';
  }
};

// Кастомная функция форматирования для уменьшения размера логов в production
const customFormat = winston.format.printf(({ timestamp, level, message, ...meta }) => {
  const env = process.env.NODE_ENV || 'development';
  
  // В production используем более компактный формат
  if (env === 'production') {
    const metaString = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} ${level}: ${message}${metaString}`;
  }
  
  // В development полный формат
  const metaString = Object.keys(meta).length > 0 ? `\n${JSON.stringify(meta, null, 2)}` : '';
  return `${timestamp} ${level}: ${message}${metaString}`;
});

// Создаем директорию логов если её нет
const logsDir = path.join(process.cwd(), 'logs');

const logger = winston.createLogger({
  level: getLogLevel(),
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    customFormat
  ),
  transports: [
    // Файл для ошибок
    new winston.transports.File({ 
      filename: path.join(logsDir, 'error.log'), 
      level: 'error',
      maxsize: 50 * 1024 * 1024, // 50MB
      maxFiles: 5, // Храним максимум 5 файлов
      tailable: true
    }),
    // Основной лог файл с ротацией
    new winston.transports.File({ 
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 100 * 1024 * 1024, // 100MB максимальный размер файла
      maxFiles: 10, // Храним максимум 10 файлов
      tailable: true
    }),
    // Консоль
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ],
  // Обработка исключений
  exceptionHandlers: [
    new winston.transports.File({ 
      filename: path.join(logsDir, 'exceptions.log'),
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 3
    })
  ],
  // Обработка отклоненных промисов
  rejectionHandlers: [
    new winston.transports.File({ 
      filename: path.join(logsDir, 'rejections.log'),
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 3
    })
  ]
});

// Дополнительные настройки для production
if (process.env.NODE_ENV === 'production') {
  // Отключаем подробные debug логи в production
  logger.info('[Logger] Production mode: Debug logging disabled, log rotation enabled');
}

export default logger; 