/**
 * Futures Profile - Профиль для фьючерсной торговли
 * 
 * Оптимизированные параметры для торговли с использованием плеча
 */

import { DefaultStrategyParameters } from '../strategy';
import type { StrategyProfile, ExtendedStrategyParameters } from './types';

/**
 * Параметры стратегии для фьючерсной торговли
 * 
 * Особенности фьючерсов:
 * - Кредитное плечо до 100x
 * - Комиссии за финансирование (funding rate)
 * - Риск ликвидации
 * - Высокая капиталоэффективность
 * - Long и Short позиции равноценны
 */
const futuresStrategyParameters: ExtendedStrategyParameters = {
  // Базовые параметры стратегии
  dlc: {
    ...DefaultStrategyParameters.dlc,
    // Для фьючерсов можно использовать меньший период (быстрее реакция)
    period: 30,
    dlcPeriod: 30,
    pocLookback: 5
  },
  
  nwe: {
    ...DefaultStrategyParameters.nwe,
    // Меньший множитель для фьючерсов (более узкие границы)
    multiplier: 2.5  // было 3.0
  },
  
  clusters: {
    ...DefaultStrategyParameters.clusters,
    // Более низкий порог для фьючерсов (больше сигналов)
    minVolumeThresholdMultiplier: 1.3,  // было 1.5
    deltaThreshold: 0.65  // было 0.7
  },
  
  risk: {
    ...DefaultStrategyParameters.risk,
    // КРИТИЧНО: Оптимизированные параметры для фьючерсов
    atrPeriod: 14,
    
    // Меньший SL из-за плеча (ликвидация должна быть ЗА SL)
    stopLossMultiplier: 1.8,  // было 2.0 (более узкий SL)
    
    // Меньший TP для фьючерсов (быстрее фиксация прибыли)
    takeProfitMultiplier: 3.5,  // было 5.0 (более близкий TP)
    
    // Трейлинг стоп рекомендуется для фьючерсов
    useTrailingStop: true,  // было false
    trailingStopOffsetMultiplier: 1.2,  // было 1.5 (ближе)
    trailingStopStepMultiplier: 0.2,  // было 0.25 (меньший шаг)
    
    // Больше сделок при фьючерсах (выше оборот)
    maxTradesPerDay: 4,  // было 2
    
    // Размер позиции - с учетом плеча будет больше
    positionSizePercentage: 0.015,  // 1.5% маржи (было 2%)
    maxRiskPerTradePercentage: 0.015,  // 1.5% риска (было 2%)
    
    exitOnOppositeSignal: true
  },
  
  // Идентификация профиля
  profileName: 'futures',
  marketType: 'futures',
  
  // НОВОЕ: Настройки фьючерсов
  futures: {
    // Настройки плеча
    leverage: {
      enabled: true,
      value: 5,              // Консервативное 5x (начальное)
      mode: 'dynamic',       // Динамическое управление
      maxLeverage: 10        // Максимум 10x
    },
    
    // Настройки ликвидации
    liquidation: {
      bufferPercent: 25,     // 25% буфер до ликвидации
      autoAdjust: true,      // Авто-снижение плеча при риске
      warningThreshold: 30   // Предупреждение при 30%
    },
    
    // Настройки финансирования
    funding: {
      enabled: true,
      maxRate: 0.05,         // Макс. 0.05% за 8 часов
      avoidHighFunding: true,// Избегать высоких ставок
      favorDirection: true   // Входить по направлению funding
    },
    
    // Настройки размера позиции (опционально)
    positionSizing: {
      mode: 'risk',          // Метод на основе риска
      riskPerTrade: 1.5,     // 1.5% риска
      maxPositionSize: 80,   // Максимум 80% от баланса × плечо
      useEffectiveLeverage: true
    }
  },
  
  // Метаданные
  metadata: {
    name: 'Futures Strategy (Optimized)',
    description: 'Оптимизированная торговая стратегия для фьючерсов с консервативным плечом 5x',
    version: '1.0.0',
    author: 'Backtester V2 Team',
    tags: ['futures', 'leverage', 'optimized', '5x']
  }
};

/**
 * Профиль фьючерсной торговли
 */
export const futuresProfile: StrategyProfile = {
  name: 'futures',
  marketType: 'futures',
  
  metadata: {
    name: 'Futures Trading Profile',
    description: 'Оптимизированный профиль для фьючерсной торговли с плечом 5x',
    version: '1.0.0',
    author: 'Backtester V2',
    tags: ['futures', 'leverage', 'medium-risk']
  },
  
  parameters: futuresStrategyParameters,
  
  // Ограничения для фьючерсов
  constraints: {
    maxLeverage: 10,             // Максимум 10x (консервативно)
    minLeverage: 3,              // Минимум 3x
    maxRiskPerTrade: 2.5,        // Максимум 2.5% риска
    maxPositionSize: 80,         // 80% × плечо
    maxTradesPerDay: 10,         // До 10 сделок (выше оборот)
    maxConcurrentTrades: 5,      // До 5 позиций одновременно
    
    // Без временных ограничений
    tradingHours: undefined,
    
    // Без ограничений по парам
    allowedPairs: undefined,
    blockedPairs: undefined
  }
};

/**
 * Агрессивный профиль фьючерсов (10x leverage)
 */
export const aggressiveFuturesProfile: StrategyProfile = {
  ...futuresProfile,
  name: 'futures',
  
  metadata: {
    ...futuresProfile.metadata,
    name: 'Aggressive Futures Profile',
    description: 'Агрессивный профиль с плечом 10x для опытных трейдеров',
    tags: ['futures', 'leverage', 'aggressive', '10x', 'high-risk']
  },
  
  parameters: {
    ...futuresStrategyParameters,
    
    futures: {
      ...futuresStrategyParameters.futures!,
      leverage: {
        enabled: true,
        value: 10,           // Агрессивное 10x
        mode: 'fixed',       // Фиксированное
        maxLeverage: 15
      },
      liquidation: {
        bufferPercent: 20,   // Меньший буфер
        autoAdjust: true,
        warningThreshold: 25
      }
    },
    
    metadata: {
      ...futuresStrategyParameters.metadata!,
      name: 'Aggressive Futures Strategy',
      tags: ['futures', 'aggressive', '10x', 'high-risk']
    }
  },
  
  constraints: {
    ...futuresProfile.constraints,
    maxLeverage: 15,
    maxRiskPerTrade: 3,
    maxTradesPerDay: 15
  }
};

/**
 * Получить параметры фьючерс-профиля
 */
export function getFuturesParameters(aggressive: boolean = false): ExtendedStrategyParameters {
  const source = aggressive ? aggressiveFuturesProfile : futuresProfile;
  return JSON.parse(JSON.stringify(source.parameters));
}

/**
 * Проверить, является ли профиль фьючерсным
 */
export function isFuturesProfile(params: ExtendedStrategyParameters): boolean {
  return params.marketType === 'futures' || 
         params.profileName === 'futures' || 
         !!params.futures;
}

/**
 * Создать кастомный фьючерсный профиль с заданным плечом
 */
export function createCustomFuturesProfile(
  leverage: number,
  maxLeverage: number = leverage + 5
): ExtendedStrategyParameters {
  const baseParams = getFuturesParameters();
  
  if (baseParams.futures) {
    baseParams.futures.leverage.value = leverage;
    baseParams.futures.leverage.maxLeverage = maxLeverage;
    
    // Адаптировать параметры под плечо
    if (leverage > 10) {
      // Высокое плечо - уменьшить риски
      if (baseParams.risk) {
        baseParams.risk.stopLossMultiplier = 1.5;
        baseParams.risk.positionSizePercentage = 0.01;
      }
      baseParams.futures.liquidation.bufferPercent = 30;
    } else if (leverage < 5) {
      // Низкое плечо - можно чуть агрессивнее
      if (baseParams.risk) {
        baseParams.risk.stopLossMultiplier = 2.0;
        baseParams.risk.positionSizePercentage = 0.02;
      }
      baseParams.futures.liquidation.bufferPercent = 20;
    }
  }
  
  baseParams.profileName = 'custom';
  if (baseParams.metadata) {
    baseParams.metadata.name = `Custom Futures ${leverage}x`;
    baseParams.metadata.description = `Кастомный профиль с плечом ${leverage}x`;
  }
  
  return baseParams;
}

/**
 * Конвертировать спотовый профиль в фьючерсный
 */
export function convertToFutures(
  params: ExtendedStrategyParameters,
  leverage: number = 5
): ExtendedStrategyParameters {
  const futuresParams = { ...params };
  
  // Добавить фьючерсные настройки
  futuresParams.futures = {
    leverage: {
      enabled: true,
      value: leverage,
      mode: 'dynamic',
      maxLeverage: leverage + 5
    },
    liquidation: {
      bufferPercent: 25,
      autoAdjust: true,
      warningThreshold: 30
    },
    funding: {
      enabled: true,
      maxRate: 0.05,
      avoidHighFunding: true,
      favorDirection: true
    },
    positionSizing: {
      mode: 'risk',
      riskPerTrade: 1.5,
      maxPositionSize: 80,
      useEffectiveLeverage: true
    }
  };
  
  // Изменить идентификацию
  futuresParams.profileName = 'futures';
  futuresParams.marketType = 'futures';
  
  // Адаптировать риск-параметры для фьючерсов
  if (futuresParams.risk) {
    futuresParams.risk.stopLossMultiplier = 1.8;
    futuresParams.risk.takeProfitMultiplier = 3.5;
    futuresParams.risk.useTrailingStop = true;
    futuresParams.risk.positionSizePercentage = 0.015;
    futuresParams.risk.maxTradesPerDay = 4;
  }
  
  return futuresParams;
}

/**
 * Экспорт по умолчанию
 */
export default futuresProfile;




