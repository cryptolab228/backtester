/**
 * LiquidationCalculator - Расчеты связанные с ликвидацией позиций
 * 
 * Специализированный модуль для работы с механизмом ликвидации на фьючерсах
 */

import logger from '@/utils/logger';
import type { PositionDirection, LiquidationData } from './types';

export class LiquidationCalculator {
  // Ставки поддерживающей маржи для разных уровней плеча (Bybit)
  private readonly MAINTENANCE_MARGIN_RATES: { [key: string]: number } = {
    '1-10': 0.005,    // 0.5% для плеча 1-10x
    '11-25': 0.01,    // 1% для плеча 11-25x
    '26-50': 0.02,    // 2% для плеча 26-50x
    '51-100': 0.05    // 5% для плеча 51-100x
  };

  /**
   * Получить ставку поддерживающей маржи для заданного плеча
   */
  getMaintenanceMarginRate(leverage: number): number {
    if (leverage <= 10) return this.MAINTENANCE_MARGIN_RATES['1-10'];
    if (leverage <= 25) return this.MAINTENANCE_MARGIN_RATES['11-25'];
    if (leverage <= 50) return this.MAINTENANCE_MARGIN_RATES['26-50'];
    return this.MAINTENANCE_MARGIN_RATES['51-100'];
  }

  /**
   * Рассчитать цену ликвидации для long позиции
   * 
   * Формула: liquidation_price = entry_price × (1 - 1/leverage + MMR)
   */
  calculateLongLiquidationPrice(
    entryPrice: number,
    leverage: number,
    maintenanceMarginRate?: number
  ): number {
    const mmr = maintenanceMarginRate ?? this.getMaintenanceMarginRate(leverage);
    return entryPrice * (1 - 1 / leverage + mmr);
  }

  /**
   * Рассчитать цену ликвидации для short позиции
   * 
   * Формула: liquidation_price = entry_price × (1 + 1/leverage - MMR)
   */
  calculateShortLiquidationPrice(
    entryPrice: number,
    leverage: number,
    maintenanceMarginRate?: number
  ): number {
    const mmr = maintenanceMarginRate ?? this.getMaintenanceMarginRate(leverage);
    return entryPrice * (1 + 1 / leverage - mmr);
  }

  /**
   * Рассчитать цену ликвидации (универсальный метод)
   */
  calculateLiquidationPrice(
    entryPrice: number,
    leverage: number,
    direction: PositionDirection,
    maintenanceMarginRate?: number
  ): number {
    if (direction === 'long') {
      return this.calculateLongLiquidationPrice(entryPrice, leverage, maintenanceMarginRate);
    } else {
      return this.calculateShortLiquidationPrice(entryPrice, leverage, maintenanceMarginRate);
    }
  }

  /**
   * Проверить, находится ли позиция в зоне риска ликвидации
   */
  isLiquidationRisk(
    currentPrice: number,
    liquidationPrice: number,
    direction: PositionDirection,
    warningThreshold: number = 20 // 20% по умолчанию
  ): boolean {
    const distance = this.calculateDistancePercent(
      currentPrice,
      liquidationPrice,
      direction
    );

    return distance <= warningThreshold;
  }

  /**
   * Рассчитать расстояние до цены ликвидации в процентах
   */
  calculateDistancePercent(
    currentPrice: number,
    liquidationPrice: number,
    direction: PositionDirection
  ): number {
    if (direction === 'long') {
      // Для long: расстояние вниз до ликвидации
      return ((currentPrice - liquidationPrice) / currentPrice) * 100;
    } else {
      // Для short: расстояние вверх до ликвидации
      return ((liquidationPrice - currentPrice) / currentPrice) * 100;
    }
  }

  /**
   * Рассчитать расстояние в валюте
   */
  calculateDistanceValue(
    currentPrice: number,
    liquidationPrice: number,
    positionSize: number
  ): number {
    return Math.abs(currentPrice - liquidationPrice) * positionSize;
  }

  /**
   * Проверить, произошла ли ликвидация
   */
  isLiquidated(
    currentPrice: number,
    liquidationPrice: number,
    direction: PositionDirection
  ): boolean {
    if (direction === 'long') {
      // Long ликвидируется, если цена упала ниже цены ликвидации
      return currentPrice <= liquidationPrice;
    } else {
      // Short ликвидируется, если цена выросла выше цены ликвидации
      return currentPrice >= liquidationPrice;
    }
  }

  /**
   * Рассчитать убыток при ликвидации
   */
  calculateLiquidationLoss(
    entryPrice: number,
    liquidationPrice: number,
    positionSize: number,
    direction: PositionDirection
  ): number {
    const priceDiff = direction === 'long' 
      ? entryPrice - liquidationPrice 
      : liquidationPrice - entryPrice;
    
    return priceDiff * positionSize;
  }

  /**
   * Получить полные данные о ликвидации
   */
  getLiquidationData(
    entryPrice: number,
    currentPrice: number,
    leverage: number,
    direction: PositionDirection,
    positionSize: number,
    warningThreshold: number = 20
  ): LiquidationData {
    const maintenanceMarginRate = this.getMaintenanceMarginRate(leverage);
    const liquidationPrice = this.calculateLiquidationPrice(
      entryPrice,
      leverage,
      direction,
      maintenanceMarginRate
    );

    const distance = this.calculateDistancePercent(
      currentPrice,
      liquidationPrice,
      direction
    );

    const bufferAmount = this.calculateDistanceValue(
      currentPrice,
      liquidationPrice,
      positionSize
    );

    const isAtRisk = this.isLiquidationRisk(
      currentPrice,
      liquidationPrice,
      direction,
      warningThreshold
    );

    return {
      price: liquidationPrice,
      distance,
      maintenanceMarginRate,
      isAtRisk,
      bufferAmount
    };
  }

  /**
   * Рассчитать безопасный уровень плеча с учетом волатильности
   * 
   * @param atr - Average True Range
   * @param price - Текущая цена
   * @param targetBuffer - Желаемый буфер до ликвидации (%)
   */
  calculateSafeLeverage(
    atr: number,
    price: number,
    targetBuffer: number = 30,
    maxLeverage: number = 10
  ): number {
    const volatilityPercent = (atr / price) * 100;
    
    // Простая формула: leverage = target_buffer / (2 × volatility)
    let safeLeverage = targetBuffer / (2 * volatilityPercent);
    
    // Ограничить min/max
    safeLeverage = Math.max(1, Math.min(maxLeverage, safeLeverage));

    logger.debug('Safe leverage calculated', {
      atr,
      price,
      volatilityPercent: volatilityPercent.toFixed(2),
      targetBuffer,
      safeLeverage: safeLeverage.toFixed(1)
    });

    return Math.round(safeLeverage);
  }

  /**
   * Рассчитать максимальное плечо для заданного стоп-лосса
   * 
   * Логика: плечо должно быть таким, чтобы ликвидация была ЗА стоп-лоссом
   */
  calculateMaxLeverageForStopLoss(
    entryPrice: number,
    stopLoss: number,
    direction: PositionDirection,
    buffer: number = 1.2 // 20% буфер
  ): number {
    const stopDistance = Math.abs(entryPrice - stopLoss) / entryPrice;
    
    // Расстояние до ликвидации должно быть больше расстояния до SL
    // liquidation_distance = 1/leverage - MMR
    // Упрощенно (без MMR): leverage = 1 / (stop_distance × buffer)
    const maxLeverage = 1 / (stopDistance * buffer);

    return Math.floor(maxLeverage);
  }

  /**
   * Смоделировать ликвидацию на исторических данных
   * 
   * Полезно для бектестинга
   */
  simulateLiquidation(
    entryPrice: number,
    leverage: number,
    direction: PositionDirection,
    priceHistory: number[]
  ): { liquidated: boolean; liquidationBar: number; liquidationPrice: number } {
    const liquidationPrice = this.calculateLiquidationPrice(
      entryPrice,
      leverage,
      direction
    );

    for (let i = 0; i < priceHistory.length; i++) {
      const currentPrice = priceHistory[i];
      
      if (this.isLiquidated(currentPrice, liquidationPrice, direction)) {
        logger.info('Liquidation occurred in simulation', {
          bar: i,
          price: currentPrice,
          liquidationPrice,
          direction
        });

        return {
          liquidated: true,
          liquidationBar: i,
          liquidationPrice: currentPrice
        };
      }
    }

    return {
      liquidated: false,
      liquidationBar: -1,
      liquidationPrice: 0
    };
  }

  /**
   * Рассчитать статистику риска ликвидации для портфеля
   */
  calculatePortfolioLiquidationRisk(
    positions: Array<{
      entryPrice: number;
      currentPrice: number;
      leverage: number;
      direction: PositionDirection;
      positionSize: number;
    }>
  ): {
    avgDistance: number;
    minDistance: number;
    positionsAtRisk: number;
    totalAtRisk: number;
  } {
    let totalDistance = 0;
    let minDistance = Infinity;
    let positionsAtRisk = 0;
    let totalAtRisk = 0;

    for (const pos of positions) {
      const data = this.getLiquidationData(
        pos.entryPrice,
        pos.currentPrice,
        pos.leverage,
        pos.direction,
        pos.positionSize
      );

      totalDistance += data.distance;
      minDistance = Math.min(minDistance, data.distance);

      if (data.isAtRisk) {
        positionsAtRisk++;
        totalAtRisk += pos.positionSize * pos.currentPrice;
      }
    }

    const avgDistance = positions.length > 0 ? totalDistance / positions.length : 0;

    return {
      avgDistance,
      minDistance: minDistance === Infinity ? 0 : minDistance,
      positionsAtRisk,
      totalAtRisk
    };
  }
}

// Экспорт singleton instance
export const liquidationCalculator = new LiquidationCalculator();




