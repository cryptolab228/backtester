/**
 * FuturesPositionSizer - Расчет размера позиции для фьючерсной торговли
 * 
 * Учитывает:
 * - Кредитное плечо
 * - Риск на сделку
 * - Доступный капитал
 * - Kelly Criterion (опционально)
 */

import logger from '@/utils/logger';
import type {
  PositionDirection,
  PositionCalculation,
  PositionSizingSettings,
  KellyParams
} from './types';

export class FuturesPositionSizer {
  /**
   * Рассчитать размер позиции на основе риска
   * 
   * Логика:
   * 1. Определить максимальный риск в валюте
   * 2. Рассчитать расстояние до стоп-лосса
   * 3. Определить размер позиции
   * 4. Учесть плечо
   */
  calculatePositionSize(
    accountBalance: number,
    riskPercent: number,
    entryPrice: number,
    stopLoss: number,
    leverage: number,
    maxPositionPercent: number = 100 // Максимум от баланса
  ): PositionCalculation {
    if (accountBalance <= 0 || entryPrice <= 0 || stopLoss <= 0) {
      logger.warn('Invalid parameters for position sizing', {
        accountBalance,
        entryPrice,
        stopLoss
      });
      return this.getEmptyCalculation();
    }

    // 1. Максимальный риск в валюте
    const maxRisk = accountBalance * (riskPercent / 100);

    // 2. Расстояние до стоп-лосса в процентах
    const stopLossDistance = Math.abs(entryPrice - stopLoss) / entryPrice;

    // 3. Базовый размер позиции (без плеча)
    // Формула: position_size = risk / (entry_price × stop_loss_distance)
    let positionSize = maxRisk / (entryPrice * stopLossDistance);

    // 4. Номинальная стоимость позиции
    let notionalValue = positionSize * entryPrice;

    // 5. Применить ограничение по максимальному размеру
    const maxNotional = accountBalance * (maxPositionPercent / 100) * leverage;
    if (notionalValue > maxNotional) {
      notionalValue = maxNotional;
      positionSize = notionalValue / entryPrice;
    }

    // 6. Требуемая маржа (с учетом плеча)
    const requiredMargin = notionalValue / leverage;

    // 7. Эффективное плечо
    const effectiveLeverage = notionalValue / accountBalance;

    // 8. Максимальный убыток при срабатывании SL
    const maxLoss = positionSize * Math.abs(entryPrice - stopLoss);

    // 9. Рассчитать R/R (нужна цена тейк-профита, пока используем заглушку)
    const riskRewardRatio = 2.0; // Заглушка

    logger.debug('Position size calculated', {
      accountBalance,
      riskPercent,
      maxRisk,
      positionSize: positionSize.toFixed(4),
      notionalValue: notionalValue.toFixed(2),
      requiredMargin: requiredMargin.toFixed(2),
      effectiveLeverage: effectiveLeverage.toFixed(2)
    });

    return {
      contracts: positionSize,
      notionalValue,
      requiredMargin,
      effectiveLeverage,
      maxLoss,
      riskRewardRatio
    };
  }

  /**
   * Расчет размера позиции с учетом тейк-профита
   */
  calculatePositionSizeWithTP(
    accountBalance: number,
    riskPercent: number,
    entryPrice: number,
    stopLoss: number,
    takeProfit: number,
    leverage: number
  ): PositionCalculation {
    const baseCalc = this.calculatePositionSize(
      accountBalance,
      riskPercent,
      entryPrice,
      stopLoss,
      leverage
    );

    // Обновить R/R с учетом реального TP
    const riskDistance = Math.abs(entryPrice - stopLoss);
    const rewardDistance = Math.abs(takeProfit - entryPrice);
    const riskRewardRatio = rewardDistance / riskDistance;

    return {
      ...baseCalc,
      riskRewardRatio
    };
  }

  /**
   * Kelly Criterion для расчета оптимального размера позиции
   * 
   * Формула Kelly: f = (p × b - q) / b
   * где:
   * - p = вероятность выигрыша
   * - q = вероятность проигрыша (1 - p)
   * - b = соотношение выигрыша к проигрышу (avg_win / avg_loss)
   * 
   * Для фьючерсов нужно разделить на leverage
   */
  kellyPositionSize(params: KellyParams): number {
    const { winRate, avgWin, avgLoss, leverage, maxKelly } = params;

    if (winRate <= 0 || winRate >= 1 || avgWin <= 0 || avgLoss <= 0) {
      logger.warn('Invalid Kelly parameters', params);
      return 0;
    }

    const p = winRate;
    const q = 1 - winRate;
    const b = avgWin / avgLoss;

    // Рассчитать Kelly %
    let kellyPercent = (p * b - q) / b;

    // Применить ограничение (обычно используют 0.25 от полного Kelly)
    kellyPercent = Math.min(kellyPercent, maxKelly);

    // Учесть плечо (при плече Kelly должен быть меньше)
    const adjustedKelly = kellyPercent / Math.sqrt(leverage);

    logger.debug('Kelly Criterion calculated', {
      winRate,
      avgWin,
      avgLoss,
      rawKelly: kellyPercent.toFixed(4),
      adjustedKelly: adjustedKelly.toFixed(4),
      leverage
    });

    return Math.max(0, adjustedKelly);
  }

  /**
   * Рассчитать размер позиции методом Kelly
   */
  calculateKellyPositionSize(
    accountBalance: number,
    entryPrice: number,
    stopLoss: number,
    leverage: number,
    kellyParams: KellyParams
  ): PositionCalculation {
    // Получить Kelly %
    const kellyPercent = this.kellyPositionSize(kellyParams);

    // Рассчитать размер позиции
    const capitalToRisk = accountBalance * kellyPercent;
    const stopLossDistance = Math.abs(entryPrice - stopLoss) / entryPrice;
    const positionSize = capitalToRisk / (entryPrice * stopLossDistance);

    const notionalValue = positionSize * entryPrice;
    const requiredMargin = notionalValue / leverage;
    const effectiveLeverage = notionalValue / accountBalance;
    const maxLoss = positionSize * Math.abs(entryPrice - stopLoss);
    const riskRewardRatio = kellyParams.avgWin / kellyParams.avgLoss;

    return {
      contracts: positionSize,
      notionalValue,
      requiredMargin,
      effectiveLeverage,
      maxLoss,
      riskRewardRatio
    };
  }

  /**
   * Рассчитать размер позиции на основе фиксированного капитала
   */
  calculateCapitalBasedPosition(
    capitalToUse: number,
    entryPrice: number,
    leverage: number
  ): PositionCalculation {
    const notionalValue = capitalToUse * leverage;
    const positionSize = notionalValue / entryPrice;
    const requiredMargin = notionalValue / leverage;
    const effectiveLeverage = leverage;

    return {
      contracts: positionSize,
      notionalValue,
      requiredMargin,
      effectiveLeverage,
      maxLoss: 0, // Нужен SL для расчета
      riskRewardRatio: 0 // Нужен TP для расчета
    };
  }

  /**
   * Проверить, достаточно ли маржи для позиции
   */
  hassufficientMargin(
    accountBalance: number,
    requiredMargin: number,
    reservePercent: number = 10 // Оставить 10% резерва
  ): boolean {
    const availableMargin = accountBalance * (1 - reservePercent / 100);
    return requiredMargin <= availableMargin;
  }

  /**
   * Скорректировать размер позиции под доступную маржу
   */
  adjustToAvailableMargin(
    calculation: PositionCalculation,
    accountBalance: number,
    reservePercent: number = 10
  ): PositionCalculation {
    const availableMargin = accountBalance * (1 - reservePercent / 100);

    if (calculation.requiredMargin <= availableMargin) {
      return calculation; // Все в порядке
    }

    // Рассчитать коэффициент уменьшения
    const scaleFactor = availableMargin / calculation.requiredMargin;

    logger.warn('Position size adjusted due to insufficient margin', {
      originalMargin: calculation.requiredMargin,
      availableMargin,
      scaleFactor: scaleFactor.toFixed(2)
    });

    return {
      contracts: calculation.contracts * scaleFactor,
      notionalValue: calculation.notionalValue * scaleFactor,
      requiredMargin: availableMargin,
      effectiveLeverage: calculation.effectiveLeverage,
      maxLoss: calculation.maxLoss * scaleFactor,
      riskRewardRatio: calculation.riskRewardRatio
    };
  }

  /**
   * Получить пустой результат
   */
  private getEmptyCalculation(): PositionCalculation {
    return {
      contracts: 0,
      notionalValue: 0,
      requiredMargin: 0,
      effectiveLeverage: 0,
      maxLoss: 0,
      riskRewardRatio: 0
    };
  }
}

// Экспорт singleton instance
export const futuresPositionSizer = new FuturesPositionSizer();




