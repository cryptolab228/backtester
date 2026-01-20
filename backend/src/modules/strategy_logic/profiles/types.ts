/**
 * Расширенные типы для системы профилей стратегий
 * 
 * Добавляет поддержку фьючерсных параметров к базовым параметрам стратегии
 */

import type { StrategyParameters as BaseStrategyParameters } from '../strategy';
import type { 
  FuturesSettings,
  LeverageSettings,
  LiquidationSettings,
  FundingSettings,
  PositionSizingSettings
} from '../../futures/types';

// Тип рынка
export type MarketType = 'spot' | 'futures';

// Название профиля
export type ProfileName = 'spot' | 'futures' | 'custom';

/**
 * Расширенные параметры стратегии с поддержкой фьючерсов
 */
export interface ExtendedStrategyParameters extends BaseStrategyParameters {
  // Идентификация профиля
  profileName?: ProfileName;
  marketType?: MarketType;
  
  // Настройки фьючерсов (опционально, только для futures профиля)
  futures?: FuturesSettings;
  
  // Метаданные профиля
  metadata?: ProfileMetadata;
}

/**
 * Метаданные профиля
 */
export interface ProfileMetadata {
  name: string;
  description: string;
  version: string;
  createdAt?: number;
  updatedAt?: number;
  author?: string;
  tags?: string[];
}

/**
 * Конфигурация профиля стратегии
 */
export interface StrategyProfile {
  // Базовая информация
  name: ProfileName;
  marketType: MarketType;
  metadata: ProfileMetadata;
  
  // Параметры стратегии
  parameters: ExtendedStrategyParameters;
  
  // Валидация и ограничения
  constraints?: ProfileConstraints;
}

/**
 * Ограничения профиля
 */
export interface ProfileConstraints {
  // Ограничения по плечу
  maxLeverage?: number;
  minLeverage?: number;
  
  // Ограничения по риску
  maxRiskPerTrade?: number;
  maxPositionSize?: number;
  
  // Ограничения по сделкам
  maxTradesPerDay?: number;
  maxConcurrentTrades?: number;
  
  // Временные ограничения
  tradingHours?: {
    start: number; // UTC hour (0-23)
    end: number;   // UTC hour (0-23)
  };
  
  // Ограничения по парам
  allowedPairs?: string[];
  blockedPairs?: string[];
}

/**
 * Результат валидации профиля
 */
export interface ProfileValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Опции для получения профиля
 */
export interface GetProfileOptions {
  // Использовать кастомные переопределения
  overrides?: Partial<ExtendedStrategyParameters>;
  
  // Строгая валидация
  strict?: boolean;
  
  // Применить ограничения
  applyConstraints?: boolean;
}

/**
 * Заводские настройки для профилей
 */
export interface ProfileDefaults {
  spot: ExtendedStrategyParameters;
  futures: ExtendedStrategyParameters;
}

/**
 * Конфигурация для конкретной биржи
 */
export interface ExchangeConfig {
  name: 'bybit' | 'okx';
  
  // Специфичные лимиты биржи
  maxLeverage: number;
  minOrderSize: number;
  
  // Комиссии
  makerFee: number;
  takerFee: number;
  
  // Funding (для фьючерсов)
  fundingInterval: number; // В часах (обычно 8)
  fundingTimes: number[];  // UTC часы (например [0, 8, 16])
  
  // Ликвидация
  maintenanceMarginRates: {
    [leverageRange: string]: number;
  };
}

/**
 * Оптимизированные параметры для разных условий рынка
 */
export interface MarketConditionParams {
  trending: ExtendedStrategyParameters;
  ranging: ExtendedStrategyParameters;
  volatile: ExtendedStrategyParameters;
  calm: ExtendedStrategyParameters;
}

/**
 * История изменений параметров
 */
export interface ParameterChangeLog {
  timestamp: number;
  profileName: ProfileName;
  changes: {
    path: string;
    oldValue: any;
    newValue: any;
    reason?: string;
  }[];
  source: 'manual' | 'optimization' | 'auto-adjustment';
}

// Экспорт типов для удобства
export type { FuturesSettings, LeverageSettings, LiquidationSettings, FundingSettings };




