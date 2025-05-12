import winston from 'winston';
import path from 'path';

const logDir = path.join(__dirname, '..', '..', 'logs'); // Папка logs в корне проекта

// Настройка уровней логирования (стандартные npm)
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  verbose: 4,
  debug: 5,
  silly: 6
};

// Цвета для разных уровней (опционально, для красивого вывода в консоль)
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'blue'
};
winston.addColors(colors);

// Формат логов
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize({ all: true }), // Раскрашиваем вывод в консоль
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}`
  )
);

// Транспорты (куда будут писаться логи)
const transports = [
  // Вывод в консоль
  new winston.transports.Console(),
  // Запись всех error логов в error.log
  new winston.transports.File({
    filename: path.join(logDir, 'error.log'),
    level: 'error',
    format: winston.format.uncolorize(), // В файл пишем без ANSI кодов цвета
  }),
  // Запись всех логов в combined.log
  new winston.transports.File({
    filename: path.join(logDir, 'combined.log'),
    format: winston.format.uncolorize(),
  }),
];

// Создание логгера
const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'development' ? 'debug' : 'warn', // Уровень логирования зависит от окружения
  levels,
  format: logFormat,
  transports,
  exitOnError: false, // Не завершать приложение при ошибке логирования
});

export default logger; 