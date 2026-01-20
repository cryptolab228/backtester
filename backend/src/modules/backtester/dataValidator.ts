import { StrategyCandle } from './backtester.types';
import logger from '../../utils/logger';

// === УЛУЧШЕННАЯ ВАЛИДАЦИЯ ДАННЫХ ===

/**
 * Результаты валидации
 */
export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  cleanedData?: StrategyCandle[];
}

/**
 * Ошибка валидации
 */
export interface ValidationError {
  type: 'error';
  field: string;
  message: string;
  value: any;
  index?: number;
}

/**
 * Предупреждение валидации
 */
export interface ValidationWarning {
  type: 'warning';
  field: string;
  message: string;
  value: any;
  index?: number;
}

/**
 * Конфигурация валидации
 */
export interface ValidationConfig {
  strictMode: boolean; // Если true, то warnings становятся errors
  maxWarnings: number; // Максимальное количество warnings
  allowNullValues: boolean; // Разрешать null значения
  checkDataIntegrity: boolean; // Проверять целостность данных
  validateTimestamps: boolean; // Проверять временные метки
  validatePriceLogic: boolean; // Проверять логичность цен
  validateVolumeLogic: boolean; // Проверять логичность объемов
}

/**
 * Стандартная конфигурация валидации
 */
export const DEFAULT_VALIDATION_CONFIG: ValidationConfig = {
  strictMode: false,
  maxWarnings: 100,
  allowNullValues: false,
  checkDataIntegrity: true,
  validateTimestamps: true,
  validatePriceLogic: true,
  validateVolumeLogic: true
};

/**
 * Улучшенный валидатор данных для бэктестера
 */
export class BacktestDataValidator {
  private config: ValidationConfig;

  constructor(config: ValidationConfig = DEFAULT_VALIDATION_CONFIG) {
    this.config = config;
    logger.debug(`[DataValidator] Initialized with config: ${JSON.stringify(config)}`);
  }

  /**
   * Валидирует массив свечей
   */
  validateCandles(candles: StrategyCandle[]): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    let cleanedData: StrategyCandle[] = [];

    logger.debug(`[DataValidator] Validating ${candles.length} candles`);

    // Проверяем базовую структуру
    if (!Array.isArray(candles)) {
      errors.push({
        type: 'error',
        field: 'candles',
        message: 'Input must be an array',
        value: typeof candles
      });
      return { isValid: false, errors, warnings };
    }

    if (candles.length === 0) {
      errors.push({
        type: 'error',
        field: 'candles',
        message: 'Array cannot be empty',
        value: candles.length
      });
      return { isValid: false, errors, warnings };
    }

    // Валидируем каждую свечу
    for (let i = 0; i < candles.length; i++) {
      const candle = candles[i];
      const candleResult = this.validateSingleCandle(candle, i);

      errors.push(...candleResult.errors);
      warnings.push(...candleResult.warnings);

      // Добавляем в очищенные данные только если нет ошибок
      if (candleResult.errors.length === 0) {
        cleanedData.push(candle);
      }
    }

    // Проверяем целостность данных
    if (this.config.checkDataIntegrity) {
      const integrityResult = this.validateDataIntegrity(candles);
      errors.push(...integrityResult.errors);
      warnings.push(...integrityResult.warnings);
    }

    // Определяем итоговую валидность
    const isValid = errors.length === 0 && (warnings.length <= this.config.maxWarnings || !this.config.strictMode);

    logger.debug(`[DataValidator] Validation complete: ${isValid ? 'VALID' : 'INVALID'}, ${errors.length} errors, ${warnings.length} warnings, ${cleanedData.length} valid candles`);

    return {
      isValid,
      errors,
      warnings,
      cleanedData: isValid ? cleanedData : undefined
    };
  }

  /**
   * Валидирует отдельную свечу
   */
  private validateSingleCandle(candle: StrategyCandle, index: number): { errors: ValidationError[], warnings: ValidationWarning[] } {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Проверяем обязательные поля
    const requiredFields = ['timestamp', 'open', 'high', 'low', 'close', 'volume'];
    for (const field of requiredFields) {
      if (!(field in candle)) {
        errors.push({
          type: 'error',
          field,
          message: `Missing required field: ${field}`,
          value: undefined,
          index
        });
      }
    }

    // Проверяем типы данных
    if (candle.timestamp !== undefined && (!Number.isFinite(candle.timestamp) || candle.timestamp <= 0)) {
      errors.push({
        type: 'error',
        field: 'timestamp',
        message: 'Timestamp must be a positive finite number',
        value: candle.timestamp,
        index
      });
    }

    // Проверяем цены
    if (this.config.validatePriceLogic) {
      const priceFields = ['open', 'high', 'low', 'close'];
      for (const field of priceFields) {
        const value = candle[field as keyof StrategyCandle];
        if (value !== undefined) {
          if (!Number.isFinite(Number(value)) || Number(value) < 0) {
            errors.push({
              type: 'error',
              field,
              message: `${field} must be a non-negative finite number`,
              value,
              index
            });
          }
        }
      }

      // Проверяем логичность OHLC
      if (candle.high !== undefined && candle.low !== undefined && candle.high < candle.low) {
        errors.push({
          type: 'error',
          field: 'high/low',
          message: 'High price cannot be lower than low price',
          value: { high: candle.high, low: candle.low },
          index
        });
      }
    }

    // Проверяем объем
    if (this.config.validateVolumeLogic && candle.volume !== undefined) {
      if (!Number.isFinite(Number(candle.volume)) || Number(candle.volume) < 0) {
        errors.push({
          type: 'error',
          field: 'volume',
          message: 'Volume must be a non-negative finite number',
          value: candle.volume,
          index
        });
      }
    }

    // Проверяем временные метки
    if (this.config.validateTimestamps && candle.timestamp !== undefined) {
      const timestamp = Number(candle.timestamp);
      const now = Date.now();
      const minTime = new Date('2000-01-01').getTime();
      const maxTime = now + (365 * 24 * 60 * 60 * 1000); // +1 год от текущего времени

      if (timestamp < minTime || timestamp > maxTime) {
        warnings.push({
          type: 'warning',
          field: 'timestamp',
          message: `Timestamp seems unusual: ${new Date(timestamp).toISOString()}`,
          value: timestamp,
          index
        });
      }
    }

    // Проверяем индикаторы (если есть)
    this.validateIndicators(candle, index, errors, warnings);

    return { errors, warnings };
  }

  /**
   * Валидирует индикаторы
   */
  private validateIndicators(
    candle: StrategyCandle,
    index: number,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): void {
    // ATR
    if (candle.atr !== undefined && (typeof candle.atr !== 'number' || candle.atr < 0 || !Number.isFinite(candle.atr))) {
      errors.push({
        type: 'error',
        field: 'atr',
        message: 'ATR must be a non-negative finite number',
        value: candle.atr,
        index
      });
    }

    // NWE
    if (candle.nweUpper !== undefined && candle.nweLower !== undefined &&
        candle.nweUpper !== null && candle.nweLower !== null) {
      if (candle.nweUpper < candle.nweLower) {
        warnings.push({
          type: 'warning',
          field: 'nwe',
          message: 'NWE upper bound is below lower bound',
          value: { upper: candle.nweUpper, lower: candle.nweLower },
          index
        });
      }
    }

    // Volume Profile
    if (candle.poc !== undefined && (typeof candle.poc !== 'number' || !Number.isFinite(candle.poc))) {
      errors.push({
        type: 'error',
        field: 'poc',
        message: 'POC must be a finite number',
        value: candle.poc,
        index
      });
    }

    // Сигналы
    if (candle.entryConditionLong !== undefined && typeof candle.entryConditionLong !== 'boolean') {
      errors.push({
        type: 'error',
        field: 'entryConditionLong',
        message: 'Entry condition must be boolean',
        value: candle.entryConditionLong,
        index
      });
    }

    if (candle.entryConditionShort !== undefined && typeof candle.entryConditionShort !== 'boolean') {
      errors.push({
        type: 'error',
        field: 'entryConditionShort',
        message: 'Entry condition must be boolean',
        value: candle.entryConditionShort,
        index
      });
    }
  }

  /**
   * Проверяет целостность данных
   */
  private validateDataIntegrity(candles: StrategyCandle[]): { errors: ValidationError[], warnings: ValidationWarning[] } {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    if (candles.length < 2) {
      return { errors, warnings };
    }

    // Проверяем временную последовательность
    for (let i = 1; i < candles.length; i++) {
      const prev = candles[i - 1];
      const current = candles[i];

      if (prev.timestamp >= current.timestamp) {
        errors.push({
          type: 'error',
          field: 'timestamp_sequence',
          message: `Timestamps are not in ascending order: ${prev.timestamp} >= ${current.timestamp}`,
          value: { prev: prev.timestamp, current: current.timestamp },
          index: i
        });
      }

      // Проверяем временные интервалы (должны быть примерно одинаковыми)
      const timeDiff = current.timestamp - prev.timestamp;
      if (timeDiff < 1000 || timeDiff > 24 * 60 * 60 * 1000) { // От 1 секунды до 24 часов
        warnings.push({
          type: 'warning',
          field: 'time_interval',
          message: `Unusual time interval: ${timeDiff}ms`,
          value: timeDiff,
          index: i
        });
      }
    }

    // Проверяем на дубликаты
    const seenTimestamps = new Set<number>();
    for (let i = 0; i < candles.length; i++) {
      const timestamp = candles[i].timestamp;
      if (seenTimestamps.has(timestamp)) {
        warnings.push({
          type: 'warning',
          field: 'duplicate_timestamp',
          message: 'Duplicate timestamp found',
          value: timestamp,
          index: i
        });
      }
      seenTimestamps.add(timestamp);
    }

    return { errors, warnings };
  }

  /**
   * Очищает данные от некорректных значений
   */
  sanitizeData(candles: StrategyCandle[]): StrategyCandle[] {
    return candles.map(candle => {
      const sanitized = { ...candle };

      // Очищаем бесконечные значения
      if (!Number.isFinite(sanitized.open)) sanitized.open = 0;
      if (!Number.isFinite(sanitized.high)) sanitized.high = 0;
      if (!Number.isFinite(sanitized.low)) sanitized.low = 0;
      if (!Number.isFinite(sanitized.close)) sanitized.close = 0;
      if (!Number.isFinite(sanitized.volume)) sanitized.volume = 0;

      // Очищаем индикаторы
      if (sanitized.atr !== undefined && !Number.isFinite(sanitized.atr)) {
        sanitized.atr = undefined;
      }

      if (sanitized.nweUpper !== undefined && !Number.isFinite(sanitized.nweUpper)) {
        sanitized.nweUpper = undefined;
      }

      if (sanitized.nweLower !== undefined && !Number.isFinite(sanitized.nweLower)) {
        sanitized.nweLower = undefined;
      }

      return sanitized;
    });
  }

  /**
   * Проверяет, можно ли использовать данные для бэктеста
   */
  canBacktest(candles: StrategyCandle[]): { canBacktest: boolean; reason?: string } {
    const validation = this.validateCandles(candles);

    if (!validation.isValid) {
      return {
        canBacktest: false,
        reason: `Invalid data: ${validation.errors.length} errors, ${validation.warnings.length} warnings`
      };
    }

    if (validation.cleanedData && validation.cleanedData.length < 50) {
      return {
        canBacktest: false,
        reason: 'Insufficient data: need at least 50 valid candles for reliable backtesting'
      };
    }

    return { canBacktest: true };
  }

  /**
   * Получает статистику по данным
   */
  getDataStats(candles: StrategyCandle[]): {
    total: number;
    valid: number;
    invalid: number;
    priceRange: { min: number; max: number; avg: number };
    volumeStats: { total: number; avg: number; max: number };
    timeRange: { start: number; end: number; duration: number };
  } {
    const validCandles = this.validateCandles(candles).cleanedData || [];

    const prices = validCandles.map(c => c.close).filter(p => Number.isFinite(p));
    const volumes = validCandles.map(c => c.volume).filter(v => Number.isFinite(v));
    const timestamps = validCandles.map(c => c.timestamp).filter(t => Number.isFinite(t));

    return {
      total: candles.length,
      valid: validCandles.length,
      invalid: candles.length - validCandles.length,
      priceRange: {
        min: prices.length > 0 ? Math.min(...prices) : 0,
        max: prices.length > 0 ? Math.max(...prices) : 0,
        avg: prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0
      },
      volumeStats: {
        total: volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) : 0,
        avg: volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) / volumes.length : 0,
        max: volumes.length > 0 ? Math.max(...volumes) : 0
      },
      timeRange: {
        start: timestamps.length > 0 ? Math.min(...timestamps) : 0,
        end: timestamps.length > 0 ? Math.max(...timestamps) : 0,
        duration: timestamps.length > 0 ? Math.max(...timestamps) - Math.min(...timestamps) : 0
      }
    };
  }
}

/**
 * Фабрика валидаторов
 */
export class DataValidatorFactory {
  static createStandardValidator(): BacktestDataValidator {
    return new BacktestDataValidator(DEFAULT_VALIDATION_CONFIG);
  }

  static createStrictValidator(): BacktestDataValidator {
    return new BacktestDataValidator({
      ...DEFAULT_VALIDATION_CONFIG,
      strictMode: true,
      allowNullValues: false
    });
  }

  static createLenientValidator(): BacktestDataValidator {
    return new BacktestDataValidator({
      ...DEFAULT_VALIDATION_CONFIG,
      strictMode: false,
      allowNullValues: true,
      maxWarnings: 1000
    });
  }

  static createCustomValidator(config: Partial<ValidationConfig>): BacktestDataValidator {
    return new BacktestDataValidator({
      ...DEFAULT_VALIDATION_CONFIG,
      ...config
    });
  }
}
