/**
 * LeverageManager - Управление кредитным плечом для фьючерсной торговли
 * 
 * Основные функции:
 * - Расчет цены ликвидации
 * - Расчет эффективного плеча
 * - Проверка безопасности плеча
 * - Рекомендации по размеру плеча на основе волатильности
 */

import logger from '@/utils/logger';
import type {
  PositionDirection,
  LeverageCalculation,
  LiquidationData,
  LeverageSettings
} from './types';

export class LeverageManager {
  /**
   * Рассчитать цену ликвидации для позиции
   * 
   * Формула для long:  liquidation = entry × (1 - 1/leverage + MMR)
   * Формула для short: liquidation = entry × (1 + 1/leverage - MMR)
   * 
   * где MMR - Maintenance Margin Rate (обычно 0.4-0.5%)
   */
  calculateLiquidationPrice(
    entryPrice: number,
    leverage: number,
    direction: PositionDirection,
    maintenanceMarginRate: number = 0.004 // 0.4% по умолчанию
  ): number {
    if (leverage <= 0 || entryPrice <= 0) {
      logger.warn('Invalid parameters for liquidation calculation', {
        entryPrice,
        leverage
      });
      return 0;
    }

    let liquidationPrice: number;

    if (direction === 'long') {
      // Для лонга: цена падает до ликвидации
      liquidationPrice = entryPrice * (1 - 1 / leverage + maintenanceMarginRate);
    } else {
      // Для шорта: цена растет до ликвидации
      liquidationPrice = entryPrice * (1 + 1 / leverage - maintenanceMarginRate);
    }

    return liquidationPrice;
  }

  /**
   * Рассчитать расстояние до цены ликвидации в процентах
   */
  calculateDistanceToLiquidation(
    currentPrice: number,
    liquidationPrice: number,
    direction: PositionDirection
  ): number {
    if (currentPrice <= 0 || liquidationPrice <= 0) {
      return 0;
    }

    if (direction === 'long') {
      // Для лонга: расстояние вниз
      return ((currentPrice - liquidationPrice) / currentPrice) * 100;
    } else {
      // Для шорта: расстояние вверх
      return ((liquidationPrice - currentPrice) / currentPrice) * 100;
    }
  }

  /**
   * Проверить безопасность плеча
   * Позиция считается безопасной, если расстояние до ликвидации > bufferPercent
   */
  isLeverageSafe(
    currentPrice: number,
    entryPrice: number,
    liquidationPrice: number,
    direction: PositionDirection,
    bufferPercent: number = 20 // 20% буфер по умолчанию
  ): boolean {
    const distance = this.calculateDistanceToLiquidation(
      currentPrice,
      liquidationPrice,
      direction
    );

    return distance >= bufferPercent;
  }

  /**
   * Рассчитать эффективное плечо позиции
   * Эффективное плечо = Стоимость позиции / Баланс счета
   */
  calculateEffectiveLeverage(
    positionValue: number,
    accountBalance: number
  ): number {
    if (accountBalance <= 0) {
      return 0;
    }

    return positionValue / accountBalance;
  }

  /**
   * Рекомендовать размер плеча на основе волатильности (ATR)
   * 
   * Логика:
   * - Высокая волатильность (ATR > 5% от цены) → низкое плечо (3-5x)
   * - Средняя волатильность (ATR 2-5%) → среднее плечо (5-7x)
   * - Низкая волатильность (ATR < 2%) → высокое плечо (7-10x)
   */
  recommendLeverage(
    atr: number,
    price: number,
    maxLeverage: number = 10,
    minLeverage: number = 3
  ): number {
    if (atr <= 0 || price <= 0) {
      return minLeverage;
    }

    // Рассчитать волатильность в процентах
    const volatilityPercent = (atr / price) * 100;

    let recommendedLeverage: number;

    if (volatilityPercent > 5) {
      // Высокая волатильность: 3-5x
      recommendedLeverage = 3 + (5 - 3) * (1 - Math.min(volatilityPercent / 10, 1));
    } else if (volatilityPercent > 2) {
      // Средняя волатильность: 5-7x
      recommendedLeverage = 5 + (7 - 5) * ((5 - volatilityPercent) / 3);
    } else {
      // Низкая волатильность: 7-10x
      recommendedLeverage = 7 + (10 - 7) * ((2 - volatilityPercent) / 2);
    }

    // Ограничить min/max
    recommendedLeverage = Math.max(minLeverage, Math.min(maxLeverage, recommendedLeverage));

    logger.debug('Leverage recommendation calculated', {
      atr,
      price,
      volatilityPercent: volatilityPercent.toFixed(2),
      recommendedLeverage: recommendedLeverage.toFixed(1)
    });

    return Math.round(recommendedLeverage * 10) / 10; // Округлить до 1 знака
  }

  /**
   * Рассчитать уровень риска на основе расстояния до ликвидации
   */
  calculateRiskLevel(distanceToLiquidation: number): 'low' | 'medium' | 'high' | 'extreme' {
    if (distanceToLiquidation >= 30) return 'low';
    if (distanceToLiquidation >= 20) return 'medium';
    if (distanceToLiquidation >= 10) return 'high';
    return 'extreme';
  }

  /**
   * Комплексный расчет параметров плеча
   */
  calculateLeverageMetrics(
    entryPrice: number,
    currentPrice: number,
    leverage: number,
    direction: PositionDirection,
    accountBalance: number,
    positionSize: number,
    atr: number,
    settings: LeverageSettings
  ): LeverageCalculation {
    // Цена ликвидации
    const liquidationPrice = this.calculateLiquidationPrice(
      entryPrice,
      leverage,
      direction
    );

    // Расстояние до ликвидации
    const distanceToLiquidation = this.calculateDistanceToLiquidation(
      currentPrice,
      liquidationPrice,
      direction
    );

    // Эффективное плечо
    const positionValue = positionSize * currentPrice;
    const effectiveLeverage = this.calculateEffectiveLeverage(
      positionValue,
      accountBalance
    );

    // Рекомендуемое плечо
    const recommendedLeverage = this.recommendLeverage(
      atr,
      currentPrice,
      settings.maxLeverage
    );

    // Проверка безопасности
    const isSafe = this.isLeverageSafe(
      currentPrice,
      entryPrice,
      liquidationPrice,
      direction,
      settings.mode === 'dynamic' ? 30 : 20 // Больший буфер для динамического режима
    );

    // Уровень риска
    const riskLevel = this.calculateRiskLevel(distanceToLiquidation);

    return {
      recommendedLeverage,
      effectiveLeverage,
      liquidationPrice,
      distanceToLiquidation,
      isSafe,
      riskLevel
    };
  }

  /**
   * Авто-корректировка плеча при приближении к ликвидации
   */
  autoAdjustLeverage(
    currentLeverage: number,
    distanceToLiquidation: number,
    minDistance: number = 20
  ): number {
    if (distanceToLiquidation >= minDistance) {
      return currentLeverage; // Все в порядке
    }

    // Рассчитать коэффициент снижения
    const adjustmentFactor = distanceToLiquidation / minDistance;
    const adjustedLeverage = currentLeverage * adjustmentFactor;

    logger.warn('Leverage auto-adjusted due to liquidation risk', {
      currentLeverage,
      adjustedLeverage: adjustedLeverage.toFixed(2),
      distanceToLiquidation: distanceToLiquidation.toFixed(2)
    });

    return Math.max(1, adjustedLeverage); // Минимум 1x
  }

  /**
   * Получить данные о ликвидации для отображения
   */
  getLiquidationData(
    entryPrice: number,
    currentPrice: number,
    leverage: number,
    direction: PositionDirection,
    positionSize: number
  ): LiquidationData {
    const maintenanceMarginRate = 0.004;
    const liquidationPrice = this.calculateLiquidationPrice(
      entryPrice,
      leverage,
      direction,
      maintenanceMarginRate
    );

    const distance = this.calculateDistanceToLiquidation(
      currentPrice,
      liquidationPrice,
      direction
    );

    const bufferAmount = Math.abs(currentPrice - liquidationPrice) * positionSize;
    const isAtRisk = distance < 20;

    return {
      price: liquidationPrice,
      distance,
      maintenanceMarginRate,
      isAtRisk,
      bufferAmount
    };
  }
}

// Экспорт singleton instance
export const leverageManager = new LeverageManager();




