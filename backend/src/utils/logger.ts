import * as winston from 'winston';
import * as path from 'path';

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

const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize({ all: true }),
  winston.format.printf((info) => {
    const { timestamp, level, message, ...rest } = info;
    const meta = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : '';
    return `${timestamp} ${level}: ${message}${meta}`;
  }),
);

const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf((info) => {
    const { timestamp, level, message, ...rest } = info;
    const meta = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : '';
    return `${timestamp} ${level}: ${message}${meta}`;
  }),
);

// Транспорты (куда будут писаться логи)
const transports = [
  // Вывод в консоль
  new winston.transports.Console({
    format: consoleFormat,
  }),
  // Запись всех error логов в error.log
  new winston.transports.File({
    filename: path.join(logDir, 'error.log'),
    level: 'error',
    format: winston.format.combine(winston.format.uncolorize(), fileFormat),
  }),
  // Запись всех логов в combined.log
  new winston.transports.File({
    filename: path.join(logDir, 'combined.log'),
    format: winston.format.combine(winston.format.uncolorize(), fileFormat),
  }),
];

// Создание логгера
const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'development' ? 'debug' : 'warn', // Уровень логирования зависит от окружения
  levels,
  format: fileFormat,
  transports,
  exitOnError: false, // Не завершать приложение при ошибке логирования
});

export default logger; 