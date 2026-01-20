/**
 * Strategy Profiles Router - Система управления профилями стратегий
 * 
 * Предоставляет унифицированный интерфейс для работы со спотовыми и фьючерсными профилями
 */

import logger from '@/utils/logger';
import { spotProfile, getSpotParameters, isSpotProfile, convertToSpot } from './spotProfile';
import { 
  futuresProfile, 
  aggressiveFuturesProfile,
  getFuturesParameters, 
  isFuturesProfile, 
  createCustomFuturesProfile,
  convertToFutures 
} from './futuresProfile';

import type { 
  StrategyProfile,
  ExtendedStrategyParameters,
  ProfileName,
  MarketType,
  GetProfileOptions,
  ProfileValidationResult
} from './types';

/**
 * Реестр доступных профилей
 */
const profileRegistry: Map<ProfileName, StrategyProfile> = new Map([
  ['spot', spotProfile],
  ['futures', futuresProfile]
]);

/**
 * Получить профиль стратегии по имени
 * 
 * @param name - Имя профиля ('spot' | 'futures')
 * @param options - Опции получения профиля
 * @returns Параметры стратегии
 */
export function getStrategyProfile(
  name: ProfileName = 'spot',
  options?: GetProfileOptions
): ExtendedStrategyParameters {
  const profile = profileRegistry.get(name);
  
  if (!profile) {
    logger.warn(`Profile "${name}" not found, using spot profile as fallback`, { name });
    return getSpotParameters();
  }
  
  // Клонировать параметры
  let parameters = JSON.parse(JSON.stringify(profile.parameters));
  
  // Применить переопределения
  if (options?.overrides) {
    parameters = mergeParameters(parameters, options.overrides);
  }
  
  // Валидация
  if (options?.strict) {
    const validation = validateProfile(parameters);
    if (!validation.isValid) {
      logger.error('Profile validation failed', { 
        profile: name, 
        errors: validation.errors 
      });
      throw new Error(`Invalid profile parameters: ${validation.errors.join(', ')}`);
    }
  }
  
  // Применить ограничения
  if (options?.applyConstraints && profile.constraints) {
    parameters = applyConstraints(parameters, profile.constraints);
  }
  
  logger.debug('Strategy profile loaded', { 
    name, 
    marketType: parameters.marketType,
    hasOverrides: !!options?.overrides
  });
  
  return parameters;
}

/**
 * Получить профиль по типу рынка
 */
export function getProfileByMarketType(
  marketType: MarketType = 'spot',
  options?: GetProfileOptions
): ExtendedStrategyParameters {
  const name: ProfileName = marketType === 'futures' ? 'futures' : 'spot';
  return getStrategyProfile(name, options);
}

/**
 * Автоматически определить профиль из параметров
 */
export function detectProfile(params: ExtendedStrategyParameters): ProfileName {
  if (params.profileName) {
    return params.profileName;
  }
  
  if (isFuturesProfile(params)) {
    return 'futures';
  }
  
  if (isSpotProfile(params)) {
    return 'spot';
  }
  
  // По умолчанию спот
  return 'spot';
}

/**
 * Валидация параметров профиля
 */
export function validateProfile(params: ExtendedStrategyParameters): ProfileValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Базовая валидация
  if (!params.risk) {
    errors.push('Risk management settings are required');
  }
  
  // Валидация фьючерсов
  if (params.marketType === 'futures') {
    if (!params.futures) {
      errors.push('Futures settings are required for futures market type');
    } else {
      // Валидация плеча
      if (params.futures.leverage) {
        const lev = params.futures.leverage.value;
        if (lev < 1 || lev > 100) {
          errors.push(`Invalid leverage: ${lev}. Must be between 1 and 100`);
        }
        if (lev > 10) {
          warnings.push(`High leverage detected: ${lev}x. Consider using lower leverage for safety`);
        }
      }
      
      // Валидация буфера ликвидации
      if (params.futures.liquidation) {
        const buffer = params.futures.liquidation.bufferPercent;
        if (buffer < 10) {
          warnings.push(`Low liquidation buffer: ${buffer}%. Recommended at least 20%`);
        }
      }
    }
  }
  
  // Валидация риск-менеджмента
  if (params.risk) {
    const slMultiplier = params.risk.stopLossMultiplier || 0;
    const tpMultiplier = params.risk.takeProfitMultiplier || 0;
    
    if (slMultiplier < 1) {
      errors.push('Stop loss multiplier must be at least 1');
    }
    
    if (tpMultiplier < slMultiplier) {
      warnings.push(`Take profit (${tpMultiplier}) is less than stop loss (${slMultiplier}). Risk/Reward ratio < 1`);
    }
    
    const riskPercent = params.risk.maxRiskPerTradePercentage || 0;
    if (riskPercent > 0.05) {
      warnings.push(`High risk per trade: ${riskPercent * 100}%. Consider reducing to < 5%`);
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Слияние параметров с переопределениями
 */
function mergeParameters(
  base: ExtendedStrategyParameters,
  overrides: Partial<ExtendedStrategyParameters>
): ExtendedStrategyParameters {
  // Глубокое слияние
  const merged = JSON.parse(JSON.stringify(base));
  
  // Простое слияние верхнего уровня
  Object.keys(overrides).forEach(key => {
    const value = overrides[key as keyof ExtendedStrategyParameters];
    if (value !== undefined) {
      if (typeof value === 'object' && !Array.isArray(value)) {
        // Слияние вложенных объектов
        merged[key as keyof ExtendedStrategyParameters] = {
          ...merged[key as keyof ExtendedStrategyParameters],
          ...value
        };
      } else {
        merged[key as keyof ExtendedStrategyParameters] = value;
      }
    }
  });
  
  return merged;
}

/**
 * Применить ограничения профиля
 */
function applyConstraints(
  params: ExtendedStrategyParameters,
  constraints: any
): ExtendedStrategyParameters {
  const constrained = { ...params };
  
  // Применить ограничения плеча
  if (constrained.futures?.leverage && constraints.maxLeverage) {
    if (constrained.futures.leverage.value > constraints.maxLeverage) {
      logger.warn('Leverage capped by constraints', {
        original: constrained.futures.leverage.value,
        max: constraints.maxLeverage
      });
      constrained.futures.leverage.value = constraints.maxLeverage;
    }
  }
  
  // Применить ограничения риска
  if (constrained.risk && constraints.maxRiskPerTrade) {
    const maxRisk = constraints.maxRiskPerTrade / 100;
    if ((constrained.risk.maxRiskPerTradePercentage || 0) > maxRisk) {
      constrained.risk.maxRiskPerTradePercentage = maxRisk;
    }
  }
  
  // Применить ограничения по сделкам
  if (constrained.risk && constraints.maxTradesPerDay) {
    if ((constrained.risk.maxTradesPerDay || 0) > constraints.maxTradesPerDay) {
      constrained.risk.maxTradesPerDay = constraints.maxTradesPerDay;
    }
  }
  
  return constrained;
}

/**
 * Сравнить два профиля
 */
export function compareProfiles(
  profile1: ExtendedStrategyParameters,
  profile2: ExtendedStrategyParameters
): {
  identical: boolean;
  differences: string[];
} {
  const differences: string[] = [];
  
  // Сравнение marketType
  if (profile1.marketType !== profile2.marketType) {
    differences.push(`Market type: ${profile1.marketType} vs ${profile2.marketType}`);
  }
  
  // Сравнение плеча
  if (profile1.futures?.leverage.value !== profile2.futures?.leverage.value) {
    differences.push(`Leverage: ${profile1.futures?.leverage.value || 1}x vs ${profile2.futures?.leverage.value || 1}x`);
  }
  
  // Сравнение SL/TP
  if (profile1.risk?.stopLossMultiplier !== profile2.risk?.stopLossMultiplier) {
    differences.push(`Stop Loss: ${profile1.risk?.stopLossMultiplier} vs ${profile2.risk?.stopLossMultiplier}`);
  }
  
  if (profile1.risk?.takeProfitMultiplier !== profile2.risk?.takeProfitMultiplier) {
    differences.push(`Take Profit: ${profile1.risk?.takeProfitMultiplier} vs ${profile2.risk?.takeProfitMultiplier}`);
  }
  
  return {
    identical: differences.length === 0,
    differences
  };
}

/**
 * Получить рекомендованный профиль на основе условий рынка
 */
export function getRecommendedProfile(marketConditions: {
  volatility: 'low' | 'medium' | 'high';
  trend: 'trending' | 'ranging';
  experience: 'beginner' | 'intermediate' | 'advanced';
}): ProfileName {
  const { volatility, experience } = marketConditions;
  
  // Новичкам всегда спот
  if (experience === 'beginner') {
    return 'spot';
  }
  
  // Высокая волатильность - спот или низкое плечо
  if (volatility === 'high') {
    return experience === 'advanced' ? 'futures' : 'spot';
  }
  
  // Средняя/низкая волатильность - можно фьючерсы
  return 'futures';
}

/**
 * Экспорт всех необходимых функций и типов
 */
export {
  // Профили
  spotProfile,
  futuresProfile,
  aggressiveFuturesProfile,
  
  // Функции получения параметров
  getSpotParameters,
  getFuturesParameters,
  
  // Функции проверки
  isSpotProfile,
  isFuturesProfile,
  
  // Функции конвертации
  convertToSpot,
  convertToFutures,
  createCustomFuturesProfile,
  
  // Типы
  type StrategyProfile,
  type ExtendedStrategyParameters,
  type ProfileName,
  type MarketType,
  type GetProfileOptions,
  type ProfileValidationResult
};

// Экспорт всех типов из types.ts
export * from './types';

/**
 * Пример использования:
 * 
 * // Получить спот профиль
 * const spotParams = getStrategyProfile('spot');
 * 
 * // Получить фьючерс профиль с переопределениями
 * const futuresParams = getStrategyProfile('futures', {
 *   overrides: {
 *     futures: {
 *       leverage: { ...default, value: 7 }
 *     }
 *   }
 * });
 * 
 * // Автоматически определить профиль
 * const profile = detectProfile(params);
 * 
 * // Валидация
 * const validation = validateProfile(params);
 * if (!validation.isValid) {
 *   console.error('Errors:', validation.errors);
 * }
 */




