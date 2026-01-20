import {
  CommissionModel,
  PerTradeCommission,
  PerShareCommission,
  PerDollarCommission,
  SlippageModel,
  FixedSlippage,
  VolumeShareSlippage,
  Order
} from './backtester.types';
import logger from '../../utils/logger';

// === РЕАЛИЗАЦИИ МОДЕЛЕЙ КОМИССИЙ ===

/**
 * Фиксированная комиссия за сделку
 */
export class DefaultPerTradeCommission implements PerTradeCommission {
  fixedFee: number;

  constructor(fixedFee: number = 5.0) {
    this.fixedFee = fixedFee;
    logger.debug(`[Commission] PerTradeCommission initialized with fixed fee: $${fixedFee}`);
  }

  calculate(order: Order, executionPrice: number): number {
    // Фиксированная комиссия за каждую сделку
    return this.fixedFee;
  }
}

/**
 * Комиссия за акцию/контракт
 */
export class DefaultPerShareCommission implements PerShareCommission {
  costPerShare: number;
  minCost?: number;

  constructor(costPerShare: number = 0.005, minCost?: number) {
    this.costPerShare = costPerShare;
    this.minCost = minCost;
    logger.debug(`[Commission] PerShareCommission initialized with cost per share: $${costPerShare}${minCost ? `, min cost: $${minCost}` : ''}`);
  }

  calculate(order: Order, executionPrice: number): number {
    const commission = order.quantity * this.costPerShare;

    if (this.minCost && commission < this.minCost) {
      return this.minCost;
    }

    return commission;
  }
}

/**
 * Процентная комиссия от объема сделки
 */
export class DefaultPerDollarCommission implements PerDollarCommission {
  rate: number;

  constructor(rate: number = 0.001) { // 0.1% по умолчанию
    this.rate = rate;
    logger.debug(`[Commission] PerDollarCommission initialized with rate: ${(rate * 100)}%`);
  }

  calculate(order: Order, executionPrice: number): number {
    const tradeValue = order.quantity * executionPrice;
    return tradeValue * this.rate;
  }
}

/**
 * Комбинированная модель комиссий (Interactive Brokers style)
 */
export class InteractiveBrokersCommission implements CommissionModel {
  private perShareRate: number;
  private minPerOrder: number;
  private maxPerOrder: number;

  constructor(perShareRate: number = 0.005, minPerOrder: number = 1.0, maxPerOrder: number = 0.5) {
    this.perShareRate = perShareRate;
    this.minPerOrder = minPerOrder;
    this.maxPerOrder = maxPerOrder; // Процент от объема сделки
    logger.debug(`[Commission] InteractiveBrokersCommission initialized: per share $${perShareRate}, min $${minPerOrder}`);
  }

  calculate(order: Order, executionPrice: number): number {
    const tradeValue = order.quantity * executionPrice;
    const perShareCommission = order.quantity * this.perShareRate;
    const percentCommission = tradeValue * this.maxPerOrder;

    // Берем максимум из per-share и percent комиссий, но минимум minPerOrder
    const commission = Math.max(perShareCommission, percentCommission);
    return Math.max(commission, this.minPerOrder);
  }
}

/**
 * Адаптивная комиссия (зависит от биржи и типа инструмента)
 */
export class AdaptiveCommission implements CommissionModel {
  private cryptoCommission: CommissionModel;
  private stocksCommission: CommissionModel;
  private futuresCommission: CommissionModel;

  constructor() {
    this.cryptoCommission = new DefaultPerDollarCommission(0.001); // 0.1% для крипты
    this.stocksCommission = new InteractiveBrokersCommission(); // IBKR для акций
    this.futuresCommission = new DefaultPerTradeCommission(2.0); // $2 за контракт фьючерсов
    logger.debug(`[Commission] AdaptiveCommission initialized for multiple asset types`);
  }

  calculate(order: Order, executionPrice: number): number {
    // Определяем тип инструмента по символу
    const symbol = order.symbol.toUpperCase();

    if (symbol.includes('BTC') || symbol.includes('ETH') || symbol.includes('USDT')) {
      return this.cryptoCommission.calculate(order, executionPrice);
    } else if (symbol.includes('-')) {
      // Фьючерсы обычно имеют дефис в названии
      return this.futuresCommission.calculate(order, executionPrice);
    } else {
      // Акции
      return this.stocksCommission.calculate(order, executionPrice);
    }
  }
}

// === РЕАЛИЗАЦИИ МОДЕЛЕЙ ПРОСКАЛЬЗЫВАНИЯ ===

/**
 * Фиксированное проскальзывание
 */
export class DefaultFixedSlippage implements FixedSlippage {
  spread: number;

  constructor(spread: number = 0.0002) { // 0.02% по умолчанию
    this.spread = spread;
    logger.debug(`[Slippage] FixedSlippage initialized with spread: ${(spread * 100)}%`);
  }

  calculate(order: Order, barPrice: number): number {
    // Простое фиксированное проскальзывание
    return barPrice * this.spread;
  }
}

/**
 * Пропорциональное проскальзывание на основе объема
 */
export class DefaultVolumeShareSlippage implements VolumeShareSlippage {
  volumeLimit: number;
  priceImpact: number;

  constructor(volumeLimit: number = 0.1, priceImpact: number = 0.0001) {
    this.volumeLimit = volumeLimit; // 10% от объема бара
    this.priceImpact = priceImpact; // 0.01% воздействия
    logger.debug(`[Slippage] VolumeShareSlippage initialized: volume limit ${(volumeLimit * 100)}%, impact ${(priceImpact * 100)}%`);
  }

  calculate(order: Order, barPrice: number): number {
    // Простая модель: проскальзывание пропорционально размеру ордера
    const orderSize = order.quantity;
    const relativeSize = Math.min(orderSize / 1000000, 1.0); // Нормализация

    return barPrice * (this.priceImpact * relativeSize);
  }
}

/**
 * Реалистичное проскальзывание для криптовалют
 */
export class CryptoSlippage implements SlippageModel {
  private baseSlippage: number;
  private volatilityMultiplier: number;

  constructor(baseSlippage: number = 0.0005, volatilityMultiplier: number = 2.0) {
    this.baseSlippage = baseSlippage;
    this.volatilityMultiplier = volatilityMultiplier;
    logger.debug(`[Slippage] CryptoSlippage initialized: base ${(baseSlippage * 100)}%, volatility multiplier ${volatilityMultiplier}x`);
  }

  calculate(order: Order, barPrice: number): number {
    // Увеличиваем проскальзывание для крипты из-за волатильности
    return barPrice * this.baseSlippage * this.volatilityMultiplier;
  }
}

/**
 * Адаптивное проскальзывание (зависит от времени и ликвидности)
 */
export class AdaptiveSlippage implements SlippageModel {
  private lowLiquiditySlippage: SlippageModel;
  private highLiquiditySlippage: SlippageModel;
  private liquidityThreshold: number;

  constructor() {
    this.lowLiquiditySlippage = new CryptoSlippage(0.001, 3.0); // Высокое проскальзывание для низкой ликвидности
    this.highLiquiditySlippage = new DefaultFixedSlippage(0.0001); // Низкое для высокой ликвидности
    this.liquidityThreshold = 1000000; // $1M как порог высокой ликвидности
    logger.debug(`[Slippage] AdaptiveSlippage initialized: threshold $${this.liquidityThreshold.toLocaleString()}`);
  }

  calculate(order: Order, barPrice: number): number {
    const tradeValue = order.quantity * barPrice;

    // Для крупных ордеров используем модель низкой ликвидности
    if (tradeValue > this.liquidityThreshold) {
      return this.lowLiquiditySlippage.calculate(order, barPrice);
    } else {
      return this.highLiquiditySlippage.calculate(order, barPrice);
    }
  }
}

// === ФАБРИКА МОДЕЛЕЙ ===

/**
 * Фабрика для создания стандартных моделей комиссий и проскальзывания
 */
export class CommissionSlippageFactory {
  /**
   * Создает реалистичные модели для криптовалютных бирж
   */
  static createCryptoModels() {
    return {
      commission: new AdaptiveCommission(),
      slippage: new AdaptiveSlippage()
    };
  }

  /**
   * Создает модели для традиционных бирж (акции, фьючерсы)
   */
  static createTraditionalModels() {
    return {
      commission: new InteractiveBrokersCommission(),
      slippage: new DefaultVolumeShareSlippage()
    };
  }

  /**
   * Создает простые модели для тестирования
   */
  static createSimpleModels() {
    return {
      commission: new DefaultPerTradeCommission(5.0),
      slippage: new DefaultFixedSlippage(0.0001)
    };
  }

  /**
   * Создает нулевые модели (без комиссий и проскальзывания)
   */
  static createZeroModels() {
    return {
      commission: new DefaultPerTradeCommission(0),
      slippage: new DefaultFixedSlippage(0)
    };
  }
}

// === УТИЛИТЫ ДЛЯ РАССЧЕТА ===

/**
 * Утилиты для расчета комиссий и проскальзывания
 */
export class CommissionUtils {
  /**
   * Рассчитывает общую стоимость ордера с учетом комиссий и проскальзывания
   */
  static calculateTotalOrderCost(
    order: Order,
    executionPrice: number,
    commissionModel: CommissionModel,
    slippageModel: SlippageModel
  ): {
    executionPrice: number;
    slippage: number;
    commission: number;
    totalCost: number;
  } {
    const slippage = slippageModel.calculate(order, executionPrice);
    const adjustedPrice = executionPrice + slippage;
    const commission = commissionModel.calculate(order, adjustedPrice);

    return {
      executionPrice: adjustedPrice,
      slippage,
      commission,
      totalCost: (order.quantity * adjustedPrice) + commission
    };
  }

  /**
   * Проверяет, достаточно ли средств для ордера
   */
  static hasSufficientFunds(
    order: Order,
    availableCash: number,
    commissionModel: CommissionModel,
    slippageModel: SlippageModel,
    executionPrice: number
  ): boolean {
    const costs = this.calculateTotalOrderCost(order, executionPrice, commissionModel, slippageModel);
    return availableCash >= costs.totalCost;
  }
}













