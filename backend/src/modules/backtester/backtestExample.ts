/**
 * Пример использования новой событийной архитектуры бэктестера
 * Демонстрирует интеграцию всех компонентов
 */

import {
  BacktestRunParameters,
  BacktestResult,
  BacktestEventType,
  BacktestContext,
  CommissionModel,
  SlippageModel,
  StrategyCandle
} from './backtester.types';

import {
  EventHandlerFactory,
  EventFactory,
  DefaultEventHandlerRegistry
} from './eventSystem';

import {
  CommissionSlippageFactory,
  CommissionUtils
} from './commissionModels';

import {
  BacktestDataValidator,
  DataValidatorFactory
} from './dataValidator';

import { applyStrategyLogic } from '../strategy_logic/strategy';
import logger from '../../utils/logger';

/**
 * Пример нового событийно-ориентированного бэктестера
 */
export class EventDrivenBacktester {
  private context: BacktestContext;
  private dataValidator: BacktestDataValidator;
  private isRunning = false;

  constructor(
    params: BacktestRunParameters,
    candles: StrategyCandle[]
  ) {
    // Создаем модели комиссий и проскальзывания
    const { commission, slippage } = CommissionSlippageFactory.createCryptoModels();

    // Создаем контекст бэктеста
    this.context = this.createBacktestContext(params, candles, commission, slippage);

    // Создаем валидатор данных
    this.dataValidator = DataValidatorFactory.createStandardValidator();

    // Инициализируем систему событий
    this.initializeEventSystem();
  }

  /**
   * Создает контекст бэктеста
   */
  private createBacktestContext(
    params: BacktestRunParameters,
    candles: StrategyCandle[],
    commission: CommissionModel,
    slippage: SlippageModel
  ): BacktestContext {
    return {
      candles,
      currentIndex: 0,
      currentCandle: candles[0],
      portfolio: {
        cash: params.initialCapital,
        positions: new Map(),
        totalValue: params.initialCapital,
        totalReturn: 0
      },
      initialCapital: params.initialCapital,
      commissionModel: commission,
      slippageModel: slippage,
      riskSettings: params.strategyParameters.risk || {},
      events: new DefaultEventHandlerRegistry(),
      startTime: Date.now(),
      currentTime: Date.now()
    };
  }

  /**
   * Инициализирует систему событий
   */
  private initializeEventSystem(): void {
    const handlers = EventHandlerFactory.createStandardHandlers(this.context);
    const eventTypes = Object.values(BacktestEventType);

    for (const handler of handlers) {
      // Регистрируем обработчики для всех типов событий
      for (const eventType of eventTypes) {
        this.context.events.register(eventType, handler);
      }
    }

    logger.info(`[EventDrivenBacktester] Initialized with ${handlers.length} event handlers`);
  }

  /**
   * Запускает бэктест
   */
  async run(): Promise<BacktestResult> {
    logger.info('[EventDrivenBacktester] Starting backtest...');

    try {
      // Валидируем данные
      const validation = this.dataValidator.validateCandles(this.context.candles);
      if (!validation.isValid) {
        throw new Error(`Data validation failed: ${validation.errors.length} errors, ${validation.warnings.length} warnings`);
      }

      // Создаем событие начала бэктеста
      const startEvent = EventFactory.createBacktestLifecycleEvent(
        BacktestEventType.ON_BACKTEST_START,
        'Backtest started'
      );
      await this.context.events.emit(startEvent);

      // Основной цикл бэктеста
      await this.runBacktestLoop();

      // Создаем событие завершения бэктеста
      const endEvent = EventFactory.createBacktestLifecycleEvent(
        BacktestEventType.ON_BACKTEST_END,
        'Backtest completed successfully'
      );
      await this.context.events.emit(endEvent);

      // Возвращаем результаты
      return this.generateResults();

    } catch (error: any) {
      logger.error('[EventDrivenBacktester] Backtest failed:', error);

      // Создаем событие ошибки
      const errorEvent = EventFactory.createBacktestLifecycleEvent(
        BacktestEventType.ON_BACKTEST_ERROR,
        'Backtest failed',
        error
      );
      await this.context.events.emit(errorEvent);

      throw error;
    }
  }

  /**
   * Основной цикл бэктеста
   */
  private async runBacktestLoop(): Promise<void> {
    const validCandles = this.dataValidator.validateCandles(this.context.candles).cleanedData!;

    logger.info(`[EventDrivenBacktester] Processing ${validCandles.length} candles`);

    for (let i = 0; i < validCandles.length; i++) {
      this.context.currentIndex = i;
      this.context.currentCandle = validCandles[i];

      // Создаем событие бара
      const barEvent = EventFactory.createBarEvent(validCandles[i], i);
      await this.context.events.emit(barEvent);

      // Применяем логику стратегии
      await this.applyStrategyLogic(validCandles.slice(0, i + 1));

      // Небольшая пауза для предотвращения перегрузки
      if (i % 1000 === 0 && i > 0) {
        await new Promise(resolve => setTimeout(resolve, 1));
      }
    }
  }

  /**
   * Применяет логику стратегии к текущим данным
   */
  private async applyStrategyLogic(candles: StrategyCandle[]): Promise<void> {
    // Применяем стратегию
    const strategyResult = applyStrategyLogic(candles, {
      dlc: { period: 40 },
      nwe: { enabled: true },
      clusters: { source: 'volume' },
      risk: {
        atrPeriod: 14,
        stopLossMultiplier: 2,
        takeProfitMultiplier: 5,
        positionSizePercentage: 0.02
      }
    });

    // Проверяем сигналы на текущей свече
    const currentCandle = strategyResult.strategyCandles[strategyResult.strategyCandles.length - 1];

    if (currentCandle.entryConditionLong) {
      const signalEvent = EventFactory.createSignalEvent('long', 1.0, currentCandle);
      await this.context.events.emit(signalEvent);
    } else if (currentCandle.entryConditionShort) {
      const signalEvent = EventFactory.createSignalEvent('short', 1.0, currentCandle);
      await this.context.events.emit(signalEvent);
    }
  }

  /**
   * Генерирует результаты бэктеста
   */
  private generateResults(): BacktestResult {
    return {
      jobId: `event-driven-${Date.now()}`,
      status: 'completed',
      message: 'Backtest completed using event-driven architecture',
      metrics: {
        totalPnl: this.context.portfolio.totalReturn,
        totalPnlPercentage: (this.context.portfolio.totalReturn / this.context.initialCapital) * 100,
        totalTrades: 0, // Будет заполнено обработчиками событий
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        maxDrawdown: 0,
        profitFactor: 0,
        avgTradePnl: 0,
        avgWinningTrade: 0,
        avgLosingTrade: 0,
        sharpeRatio: 0,
        sortinoRatio: 0,
        expectancy: 0,
        durationMs: Date.now() - this.context.startTime,
        equityCurve: [],
        grossProfit: 0,
        grossLoss: 0,
        initialCapital: this.context.initialCapital,
        finalCapital: this.context.portfolio.totalValue
      },
      trades: [], // Будут заполнены обработчиками событий
      logs: [`Event-driven backtest completed in ${Date.now() - this.context.startTime}ms`]
    };
  }
}

/**
 * Функция для запуска примера
 */
export async function runEventDrivenBacktestExample(
  params: BacktestRunParameters,
  candles: StrategyCandle[]
): Promise<BacktestResult> {
  logger.info('[Example] Starting event-driven backtest example');

  const backtester = new EventDrivenBacktester(params, candles);
  const results = await backtester.run();

  logger.info(`[Example] Backtest completed. Final capital: $${(results.metrics.finalCapital || 0).toFixed(2)}`);
  logger.info(`[Example] Total return: ${results.metrics.totalPnlPercentage.toFixed(2)}%`);
  logger.info(`[Example] Duration: ${results.metrics.durationMs}ms`);

  return results;
}

/**
 * Демонстрация преимуществ новой архитектуры
 */
export async function demonstrateArchitectureBenefits(): Promise<void> {
  logger.info('=== Демонстрация преимуществ событийной архитектуры ===');

  logger.info('✅ Модульность: Каждый компонент независим');
  logger.info('✅ Расширяемость: Легко добавлять новые обработчики');
  logger.info('✅ Отказоустойчивость: Ошибки в одном обработчике не влияют на другие');
  logger.info('✅ Производительность: Асинхронная обработка событий');
  logger.info('✅ Отладка: Четкое логирование всех событий');
  logger.info('✅ Тестирование: Легко тестировать отдельные компоненты');

  // Показываем модели комиссий
  logger.info('\n=== Модели комиссий ===');
  const { commission, slippage } = CommissionSlippageFactory.createCryptoModels();
  logger.info(`Commission model: ${commission.constructor.name}`);
  logger.info(`Slippage model: ${slippage.constructor.name}`);

  // Показываем валидацию данных
  logger.info('\n=== Валидация данных ===');
  const validator = DataValidatorFactory.createStandardValidator();
  logger.info(`Validator config: ${JSON.stringify(validator['config'])}`);

  logger.info('\n=== Архитектура готова к использованию ===');
}
