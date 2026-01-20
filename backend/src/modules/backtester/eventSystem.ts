import {
  BacktestEventType,
  AnyBacktestEvent,
  EventHandler,
  EventHandlerRegistry,
  BacktestContext,
  BacktestEvent
} from './backtester.types';
import logger from '../../utils/logger';

// === РЕАЛИЗАЦИЯ СИСТЕМЫ СОБЫТИЙ ===

/**
 * Реализация регистра обработчиков событий
 */
export class DefaultEventHandlerRegistry implements EventHandlerRegistry {
  private handlers: Map<BacktestEventType, EventHandler[]> = new Map();

  register(eventType: BacktestEventType, handler: EventHandler): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }
    this.handlers.get(eventType)!.push(handler);

    // Сортируем по приоритету (чем выше число, тем выше приоритет)
    this.handlers.get(eventType)!.sort((a, b) => b.getPriority() - a.getPriority());

    logger.debug(`[EventRegistry] Registered handler for ${eventType} (priority: ${handler.getPriority()})`);
  }

  unregister(eventType: BacktestEventType, handler: EventHandler): void {
    const handlers = this.handlers.get(eventType);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
        logger.debug(`[EventRegistry] Unregistered handler for ${eventType}`);
      }
    }
  }

  getHandlers(eventType: BacktestEventType): EventHandler[] {
    return this.handlers.get(eventType) || [];
  }

  async emit(event: AnyBacktestEvent): Promise<void> {
    const handlers = this.getHandlers(event.type);

    logger.debug(`[EventRegistry] Emitting ${event.type} event with ${handlers.length} handlers`);

    for (const handler of handlers) {
      try {
        await handler.handle(event);
      } catch (error) {
        logger.error(`[EventRegistry] Error in handler for ${event.type}:`, error);
        // Продолжаем обработку других обработчиков
      }
    }
  }
}

/**
 * Базовый обработчик событий
 */
export abstract class BaseEventHandler implements EventHandler {
  protected name: string;

  constructor(name: string) {
    this.name = name;
  }

  abstract handle(event: AnyBacktestEvent): Promise<void> | void;

  getPriority(): number {
    return 0; // Базовый приоритет
  }

  protected getEventData<T>(event: BacktestEvent): T {
    return event.data as T;
  }
}

/**
 * Обработчик событий бара (onBar)
 */
export class BarEventHandler extends BaseEventHandler {
  constructor() {
    super('BarEventHandler');
  }

  async handle(event: AnyBacktestEvent): Promise<void> {
    if (event.type !== BacktestEventType.ON_BAR) return;

    const { candle, index } = this.getEventData<{ candle: any; index: number }>(event);
    logger.debug(`[BarHandler] Processing bar ${index} at ${new Date(candle.timestamp).toISOString()}`);
  }

  getPriority(): number {
    return 100; // Высокий приоритет - обрабатывается первым
  }
}

/**
 * Обработчик событий сигналов
 */
export class SignalEventHandler extends BaseEventHandler {
  private context: BacktestContext;

  constructor(context: BacktestContext) {
    super('SignalEventHandler');
    this.context = context;
  }

  async handle(event: AnyBacktestEvent): Promise<void> {
    if (event.type !== BacktestEventType.ON_SIGNAL) return;

    const { signal, strength, candle } = this.getEventData<{ signal: string; strength: number; candle: any }>(event);

    logger.debug(`[SignalHandler] Processing ${signal} signal with strength ${strength}`);

    // Создаем событие ордера на основе сигнала
    const orderEvent = this.createOrderFromSignal(signal, candle);
    if (orderEvent) {
      await this.context.events.emit(orderEvent);
    }
  }

  private createOrderFromSignal(signal: string, candle: any): AnyBacktestEvent | null {
    // Логика создания ордера на основе сигнала
    // Это будет реализовано позже
    return null;
  }

  getPriority(): number {
    return 90;
  }
}

/**
 * Обработчик событий ордеров
 */
export class OrderEventHandler extends BaseEventHandler {
  private context: BacktestContext;

  constructor(context: BacktestContext) {
    super('OrderEventHandler');
    this.context = context;
  }

  async handle(event: AnyBacktestEvent): Promise<void> {
    if (!event.type.startsWith('onOrder')) return;

    const { order, reason } = this.getEventData<{ order: any; reason?: string }>(event);

    logger.debug(`[OrderHandler] Processing ${event.type} for order ${order.id}`);

    switch (event.type) {
      case BacktestEventType.ON_ORDER_CREATED:
        await this.handleOrderCreated(order);
        break;
      case BacktestEventType.ON_ORDER_FILLED:
        await this.handleOrderFilled(order);
        break;
      case BacktestEventType.ON_ORDER_REJECTED:
        await this.handleOrderRejected(order, reason);
        break;
    }
  }

  private async handleOrderCreated(order: any): Promise<void> {
    // Валидация ордера
    const riskCheckPassed = await this.validateRisk(order);
    if (!riskCheckPassed) {
      // Отклоняем ордер
      const rejectEvent: AnyBacktestEvent = {
        type: BacktestEventType.ON_ORDER_REJECTED,
        timestamp: Date.now(),
        data: { order, reason: 'Risk validation failed' }
      };
      await this.context.events.emit(rejectEvent);
      return;
    }

    // Исполняем ордер
    await this.executeOrder(order);
  }

  private async handleOrderFilled(order: any): Promise<void> {
    // Обновляем позицию
    await this.updatePosition(order);

    // Обновляем портфель
    await this.updatePortfolio();
  }

  private async handleOrderRejected(order: any, reason?: string): Promise<void> {
    logger.warn(`[OrderHandler] Order ${order.id} rejected: ${reason}`);
  }

  private async validateRisk(order: any): Promise<boolean> {
    // Проверяем рисковые ограничения
    const riskEvent: AnyBacktestEvent = {
      type: BacktestEventType.ON_RISK_CHECK,
      timestamp: Date.now(),
      data: {
        checkType: 'position_size' as const,
        value: order.quantity * order.price,
        limit: this.context.riskSettings.maxRiskPerTradePercentage! * this.context.initialCapital,
        passed: true
      }
    };

    await this.context.events.emit(riskEvent);
    return riskEvent.data.passed;
  }

  private async executeOrder(order: any): Promise<void> {
    // Рассчитываем комиссию и проскальзывание
    const commission = this.context.commissionModel.calculate(order, order.price);
    const slippage = this.context.slippageModel.calculate(order, order.price);

    const executionPrice = order.price + slippage;
    const totalCost = order.quantity * executionPrice + commission;

    // Проверяем достаточность средств
    if (this.context.portfolio.cash < totalCost) {
      const rejectEvent: AnyBacktestEvent = {
        type: BacktestEventType.ON_ORDER_REJECTED,
        timestamp: Date.now(),
        data: { order, reason: 'Insufficient funds' }
      };
      await this.context.events.emit(rejectEvent);
      return;
    }

    // Создаем заполненный ордер
    const filledOrder = {
      ...order,
      status: 'filled',
      filledAt: Date.now(),
      filledQuantity: order.quantity,
      filledPrice: executionPrice,
      fees: commission,
      slippage
    };

    const fillEvent: AnyBacktestEvent = {
      type: BacktestEventType.ON_ORDER_FILLED,
      timestamp: Date.now(),
      data: { order: filledOrder }
    };

    await this.context.events.emit(fillEvent);
  }

  private async updatePosition(order: any): Promise<void> {
    // Логика обновления позиции
    // Это будет реализовано позже
  }

  private async updatePortfolio(): Promise<void> {
    // Логика обновления портфеля
    const portfolioEvent: AnyBacktestEvent = {
      type: BacktestEventType.ON_PORTFOLIO_UPDATED,
      timestamp: Date.now(),
      data: {
        portfolioValue: this.context.portfolio.totalValue,
        positions: Array.from(this.context.portfolio.positions.values()),
        cash: this.context.portfolio.cash,
        totalReturn: this.context.portfolio.totalReturn
      }
    };

    await this.context.events.emit(portfolioEvent);
  }

  getPriority(): number {
    return 80;
  }
}

/**
 * Обработчик событий риск-менеджмента
 */
export class RiskEventHandler extends BaseEventHandler {
  private context: BacktestContext;

  constructor(context: BacktestContext) {
    super('RiskEventHandler');
    this.context = context;
  }

  async handle(event: AnyBacktestEvent): Promise<void> {
    if (event.type !== BacktestEventType.ON_RISK_CHECK && event.type !== BacktestEventType.ON_RISK_VIOLATION) return;

    const { checkType, value, limit, passed } = this.getEventData<any>(event);

    logger.debug(`[RiskHandler] Processing ${checkType} check: ${value} vs ${limit} (passed: ${passed})`);

    if (!passed) {
      // Создаем событие нарушения риска
      const violationEvent: AnyBacktestEvent = {
        type: BacktestEventType.ON_RISK_VIOLATION,
        timestamp: Date.now(),
        data: {
          checkType,
          value,
          limit,
          action: this.determineRiskAction(checkType)
        }
      };

      await this.context.events.emit(violationEvent);
    }
  }

  private determineRiskAction(checkType: string): 'reject' | 'reduce' | 'stop' {
    switch (checkType) {
      case 'position_size':
        return 'reduce';
      case 'max_risk':
        return 'reject';
      case 'max_trades':
        return 'reject';
      case 'drawdown':
        return 'stop';
      default:
        return 'reject';
    }
  }

  getPriority(): number {
    return 95; // Высокий приоритет - проверка рисков важна
  }
}

/**
 * Фабрика для создания стандартных обработчиков событий
 */
export class EventHandlerFactory {
  static createStandardHandlers(context: BacktestContext): EventHandler[] {
    return [
      new BarEventHandler(),
      new SignalEventHandler(context),
      new OrderEventHandler(context),
      new RiskEventHandler(context)
    ];
  }

  static createEventRegistry(): EventHandlerRegistry {
    return new DefaultEventHandlerRegistry();
  }
}

/**
 * Утилиты для создания событий
 */
export class EventFactory {
  static createBarEvent(candle: any, index: number): AnyBacktestEvent {
    return {
      type: BacktestEventType.ON_BAR,
      timestamp: Date.now(),
      data: { candle, index }
    };
  }

  static createSignalEvent(signal: 'long' | 'short' | 'close', strength: number, candle: any): AnyBacktestEvent {
    return {
      type: BacktestEventType.ON_SIGNAL,
      timestamp: Date.now(),
      data: { signal, strength, candle }
    };
  }

  static createOrderEvent(type: BacktestEventType, order: any, reason?: string): AnyBacktestEvent {
    return {
      type: type,
      timestamp: Date.now(),
      data: { order, reason }
    };
  }

  static createPositionEvent(type: BacktestEventType, position: any, trade?: any): AnyBacktestEvent {
    return {
      type: type,
      timestamp: Date.now(),
      data: { position, trade }
    };
  }

  static createRiskEvent(checkType: 'position_size' | 'max_risk' | 'max_trades' | 'drawdown', value: number, limit: number, passed: boolean): AnyBacktestEvent {
    return {
      type: passed ? BacktestEventType.ON_RISK_CHECK : BacktestEventType.ON_RISK_VIOLATION,
      timestamp: Date.now(),
      data: { checkType, value, limit, passed }
    };
  }

  static createPortfolioEvent(portfolioValue: number, positions: any[], cash: number, totalReturn: number): AnyBacktestEvent {
    return {
      type: BacktestEventType.ON_PORTFOLIO_UPDATED,
      timestamp: Date.now(),
      data: { portfolioValue, positions, cash, totalReturn }
    };
  }

  static createBacktestLifecycleEvent(type: BacktestEventType, message?: string, error?: Error, metrics?: any): AnyBacktestEvent {
    return {
      type: type,
      timestamp: Date.now(),
      data: { message, error, metrics }
    };
  }
}
