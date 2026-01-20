/**
 * FundingManager - Управление financing rate (ставкой финансирования)
 * 
 * Funding rate - это механизм балансировки между лонгами и шортами:
 * - Положительный funding: лонги платят шортам
 * - Отрицательный funding: шорты платят лонгам
 * 
 * Обычно funding происходит каждые 8 часов: 00:00, 08:00, 16:00 UTC
 */

import logger from '@/utils/logger';
import type {
  PositionDirection,
  FundingRateData,
  FundingCostCalculation,
  FundingSettings
} from './types';

export class FundingManager {
  // Интервал funding в миллисекундах (8 часов)
  private readonly FUNDING_INTERVAL_MS = 8 * 60 * 60 * 1000;

  // Времена funding в UTC (часы)
  private readonly FUNDING_HOURS = [0, 8, 16];

  /**
   * Получить текущую ставку funding rate
   * 
   * TODO: В реальной реализации нужно запрашивать с биржи через API
   * Сейчас возвращаем моковые данные
   */
  async getCurrentFundingRate(
    symbol: string,
    exchange: 'bybit' | 'okx'
  ): Promise<FundingRateData> {
    // TODO: Реализовать реальный запрос к API биржи
    // Пример для Bybit:
    // const response = await axios.get(`${BYBIT_BASE_URL}/v5/market/funding/history`, {
    //   params: { category: 'linear', symbol }
    // });

    logger.debug('Fetching funding rate', { symbol, exchange });

    // Моковые данные для разработки
    const mockRate = this.generateMockFundingRate();
    const nextFundingTime = this.getNextFundingTime();

    return {
      rate: mockRate,
      nextFundingTime,
      predictedRate: mockRate * 1.1 // Прогноз на 10% выше
    };
  }

  /**
   * Рассчитать стоимость funding для позиции
   * 
   * Формула: funding_cost = position_value × funding_rate × direction_multiplier
   * - Для long: если rate > 0, платим (cost > 0)
   * - Для short: если rate > 0, получаем (cost < 0)
   */
  calculateFundingCost(
    positionSize: number,
    price: number,
    fundingRate: number,
    direction: PositionDirection
  ): number {
    const positionValue = positionSize * price;
    
    // Направление влияет на знак
    const directionMultiplier = direction === 'long' ? 1 : -1;
    
    // Расчет стоимости
    const cost = positionValue * fundingRate * directionMultiplier;

    return cost;
  }

  /**
   * Рассчитать общую стоимость funding за период
   * 
   * @param holdingPeriodHours - Сколько часов держим позицию
   */
  calculateTotalFundingCost(
    positionSize: number,
    price: number,
    fundingRate: number,
    direction: PositionDirection,
    holdingPeriodHours: number
  ): FundingCostCalculation {
    // Количество funding событий
    const fundingEvents = Math.floor(holdingPeriodHours / 8);
    
    // Одиночная стоимость
    const singleCost = this.calculateFundingCost(
      positionSize,
      price,
      fundingRate,
      direction
    );

    // Общая стоимость
    const totalCost = singleCost * fundingEvents;
    const positionValue = positionSize * price;

    return {
      cost: totalCost,
      rate: fundingRate,
      positionValue,
      timestamp: Date.now(),
      shouldAvoid: this.shouldAvoidPosition(fundingRate, direction, 0.05)
    };
  }

  /**
   * Определить, следует ли избегать позицию из-за funding rate
   * 
   * @param threshold - Порог в процентах (например 0.05 = 0.05%)
   */
  shouldAvoidPosition(
    fundingRate: number,
    direction: PositionDirection,
    threshold: number = 0.05 // 0.05% по умолчанию
  ): boolean {
    const ratePercent = fundingRate * 100;

    if (direction === 'long') {
      // Для long избегаем высокого положительного funding
      return ratePercent > threshold;
    } else {
      // Для short избегаем высокого отрицательного funding
      return ratePercent < -threshold;
    }
  }

  /**
   * Определить благоприятное направление на основе funding
   * 
   * Логика:
   * - Если funding > 0 (лонги платят шортам) → выгоднее short
   * - Если funding < 0 (шорты платят лонгам) → выгоднее long
   */
  getFavorableDirection(fundingRate: number): PositionDirection | null {
    const ratePercent = Math.abs(fundingRate * 100);

    // Если funding слишком мал, не даем рекомендации
    if (ratePercent < 0.01) {
      return null;
    }

    return fundingRate > 0 ? 'short' : 'long';
  }

  /**
   * Проверить, наступило ли время funding
   */
  isFundingTime(timestamp: number): boolean {
    const date = new Date(timestamp);
    const hour = date.getUTCHours();
    const minute = date.getUTCMinutes();

    // Проверяем, совпадает ли час и минуты близки к 0
    return this.FUNDING_HOURS.includes(hour) && minute < 5;
  }

  /**
   * Получить время следующего funding
   */
  getNextFundingTime(currentTimestamp: number = Date.now()): number {
    const date = new Date(currentTimestamp);
    const currentHour = date.getUTCHours();

    // Найти следующее время funding
    let nextHour = this.FUNDING_HOURS.find(h => h > currentHour);
    
    if (!nextHour) {
      // Если не нашли (значит уже после 16:00), берем 00:00 следующего дня
      nextHour = this.FUNDING_HOURS[0];
      date.setUTCDate(date.getUTCDate() + 1);
    }

    date.setUTCHours(nextHour, 0, 0, 0);
    return date.getTime();
  }

  /**
   * Рассчитать время до следующего funding (в миллисекундах)
   */
  getTimeUntilNextFunding(currentTimestamp: number = Date.now()): number {
    const nextFundingTime = this.getNextFundingTime(currentTimestamp);
    return nextFundingTime - currentTimestamp;
  }

  /**
   * Оценить влияние funding на стратегию
   * 
   * Возвращает рекомендации:
   * - "avoid": избегать позицию
   * - "favorable": выгодное направление
   * - "neutral": нейтрально
   */
  assessFundingImpact(
    fundingRate: number,
    direction: PositionDirection,
    settings: FundingSettings
  ): {
    recommendation: 'avoid' | 'favorable' | 'neutral';
    reason: string;
    expectedCostPercent: number;
  } {
    if (!settings.enabled) {
      return {
        recommendation: 'neutral',
        reason: 'Funding rate не учитывается в настройках',
        expectedCostPercent: 0
      };
    }

    const ratePercent = fundingRate * 100;
    const expectedCostPercent = Math.abs(ratePercent) * 3; // За 24 часа (3 события)

    // Проверка на избежание
    if (settings.avoidHighFunding && this.shouldAvoidPosition(fundingRate, direction, settings.maxRate)) {
      return {
        recommendation: 'avoid',
        reason: `Высокий funding rate (${ratePercent.toFixed(3)}%) для ${direction} позиции`,
        expectedCostPercent
      };
    }

    // Проверка на благоприятное направление
    if (settings.favorDirection) {
      const favorable = this.getFavorableDirection(fundingRate);
      if (favorable === direction) {
        return {
          recommendation: 'favorable',
          reason: `Funding rate (${ratePercent.toFixed(3)}%) благоприятен для ${direction}`,
          expectedCostPercent: -expectedCostPercent // Получаем, а не платим
        };
      }
    }

    return {
      recommendation: 'neutral',
      reason: `Funding rate (${ratePercent.toFixed(3)}%) в приемлемых пределах`,
      expectedCostPercent
    };
  }

  /**
   * Генерация моковой ставки funding для тестирования
   * Обычно funding rate находится в диапазоне -0.1% до +0.1%
   */
  private generateMockFundingRate(): number {
    // Случайное значение от -0.001 до +0.001 (-0.1% до +0.1%)
    return (Math.random() - 0.5) * 0.002;
  }

  /**
   * Форматировать funding rate для отображения
   */
  formatFundingRate(rate: number): string {
    const percent = (rate * 100).toFixed(4);
    return `${rate >= 0 ? '+' : ''}${percent}%`;
  }
}

// Экспорт singleton instance
export const fundingManager = new FundingManager();




