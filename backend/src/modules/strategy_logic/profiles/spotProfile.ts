/**
 * Spot Profile - Профиль для спотовой торговли (Legacy)
 * 
 * Сохраняет текущие параметры стратегии для обратной совместимости
 */

import { DefaultStrategyParameters } from '../strategy';
import type { StrategyProfile, ExtendedStrategyParameters } from './types';

/**
 * Параметры стратегии для спотовой торговли
 * 
 * Особенности спота:
 * - Нет кредитного плеча (или минимальное)
 * - Нет комиссий за финансирование
 * - Нет риска ликвидации
 * - Меньшая капиталоэффективность
 * - Только длинные позиции (без шорта)
 */
const spotStrategyParameters: ExtendedStrategyParameters = {
  // Базовые параметры (из существующей стратегии)
  ...DefaultStrategyParameters,
  
  // Идентификация профиля
  profileName: 'spot',
  marketType: 'spot',
  
  // Для спота futures настройки отсутствуют
  futures: undefined,
  
  // Метаданные
  metadata: {
    name: 'Spot Strategy (Legacy)',
    description: 'Торговая стратегия для спотового рынка без использования плеча. Сохранена для обратной совместимости.',
    version: '1.0.0',
    author: 'Backtester V2 Team',
    tags: ['spot', 'legacy', 'conservative', 'no-leverage']
  }
};

/**
 * Профиль спотовой торговли
 */
export const spotProfile: StrategyProfile = {
  name: 'spot',
  marketType: 'spot',
  
  metadata: {
    name: 'Spot Trading Profile',
    description: 'Консервативный профиль для спотовой торговли без использования плеча',
    version: '1.0.0',
    author: 'Backtester V2',
    tags: ['spot', 'conservative', 'legacy']
  },
  
  parameters: spotStrategyParameters,
  
  // Ограничения для спота
  constraints: {
    maxLeverage: 1,              // Без плеча
    minLeverage: 1,
    maxRiskPerTrade: 5,          // Максимум 5% риска на сделку
    maxPositionSize: 50,         // Максимум 50% капитала в одной позиции
    maxTradesPerDay: 5,          // До 5 сделок в день
    maxConcurrentTrades: 3,      // До 3 одновременных позиций
    
    // Без временных ограничений (торгуем круглосуточно)
    tradingHours: undefined,
    
    // Без ограничений по парам
    allowedPairs: undefined,
    blockedPairs: undefined
  }
};

/**
 * Получить параметры спот-профиля
 */
export function getSpotParameters(): ExtendedStrategyParameters {
  return JSON.parse(JSON.stringify(spotStrategyParameters));
}

/**
 * Проверить, является ли профиль спотовым
 */
export function isSpotProfile(params: ExtendedStrategyParameters): boolean {
  return params.marketType === 'spot' || 
         params.profileName === 'spot' || 
         !params.futures;
}

/**
 * Конвертировать фьючерсный профиль в спотовый
 * (убрать все фьючерс-специфичные настройки)
 */
export function convertToSpot(params: ExtendedStrategyParameters): ExtendedStrategyParameters {
  const spotParams = { ...params };
  
  // Удалить фьючерсные настройки
  delete spotParams.futures;
  
  // Изменить идентификацию
  spotParams.profileName = 'spot';
  spotParams.marketType = 'spot';
  
  // Сбросить агрессивные параметры
  if (spotParams.risk) {
    spotParams.risk.stopLossMultiplier = Math.max(
      spotParams.risk.stopLossMultiplier || 2,
      2.0  // Минимум 2x ATR для спота
    );
    
    spotParams.risk.takeProfitMultiplier = Math.max(
      spotParams.risk.takeProfitMultiplier || 3,
      3.0  // Минимум 3x ATR для спота
    );
  }
  
  return spotParams;
}

/**
 * Экспорт по умолчанию
 */
export default spotProfile;




