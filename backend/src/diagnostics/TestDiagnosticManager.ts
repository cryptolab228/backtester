import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';
import { broadcast } from '../websocket';
import { dataService } from '../services/dataService';

// Типы ошибок
export enum ErrorType {
  DATA_MISSING = 'DATA_MISSING',
  DATA_INCOMPLETE = 'DATA_INCOMPLETE',
  MEMORY_OVERFLOW = 'MEMORY_OVERFLOW',
  GPU_SERVICE_DOWN = 'GPU_SERVICE_DOWN',
  GPU_PERFORMANCE_ISSUE = 'GPU_PERFORMANCE_ISSUE',
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  CALCULATION_ERROR = 'CALCULATION_ERROR',
  STATE_CORRUPTION = 'STATE_CORRUPTION',
  API_RATE_LIMIT = 'API_RATE_LIMIT',
  NETWORK_ERROR = 'NETWORK_ERROR',
  PORTFOLIO_INCOMPLETE = 'PORTFOLIO_INCOMPLETE',
  CONFIGURATION_ERROR = 'CONFIGURATION_ERROR'
}

// Интерфейсы
export interface TestError {
  id: string;
  timestamp: Date;
  type: ErrorType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  testId: string;
  testType: 'single' | 'portfolio' | 'gpu' | 'system';
  description: string;
  context: ErrorContext;
  impact: number; // 0-1
  autoFixable: boolean;
  suggestions: FixSuggestion[];
  stackTrace?: string;
  metadata: Record<string, any>;
  resolved: boolean;
  resolvedAt?: Date;
}

export interface ErrorContext {
  pairSymbol?: string;
  timeframe?: string;
  exchange?: string;
  dateRange?: { startDate: Date; endDate: Date };
  endpoint?: string;
  method?: string;
  userId?: string;
  jobId?: string;
  [key: string]: any;
}

export interface FixSuggestion {
  type: string;
  description: string;
  action: string;
  params: Record<string, any>;
  priority: 'low' | 'medium' | 'high';
  estimatedTime?: string;
}

export interface PairDataStatus {
  symbol: string;
  exchange: string;
  status: 'available' | 'missing' | 'incomplete' | 'problematic';
  coverage: number; // 0-1
  totalCandles: number;
  missingRanges?: Array<{ start: Date; end: Date }>;
  lastUpdated?: Date;
  memoryEstimate: number; // в MB
}

export interface PortfolioDataAnalysis {
  totalPairs: number;
  availablePairs: PairDataStatus[];
  missingPairs: PairDataStatus[];
  incompletePairs: PairDataStatus[];
  problematicPairs: PairDataStatus[];
  memoryEstimate: number; // общая оценка в MB
  recommendations: DiagnosticRecommendation[];
  canProceed: boolean;
  warningLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
}

export interface DiagnosticRecommendation {
  id: string;
  type: 'info' | 'warning' | 'error';
  title: string;
  description: string;
  actions?: Array<{
    id: string;
    label: string;
    action: string;
    params: any;
  }>;
  priority: number; // 1-10
}

export interface SystemMetrics {
  cpu: {
    usage: number;
    cores: number;
    load: number[];
  };
  memory: {
    used: number;
    total: number;
    percentage: number;
  };
  disk: {
    used: number;
    total: number;
    percentage: number;
  };
  gpu?: {
    available: boolean;
    healthy: boolean;
    memoryUsed: number;
    memoryTotal: number;
    utilization: number;
  };
}

/**
 * Централизованный менеджер диагностики тестов
 * Отвечает за:
 * - Регистрацию и классификацию ошибок
 * - Предварительную валидацию портфелей
 * - Автоматическое исправление проблем
 * - Генерацию рекомендаций
 * - Мониторинг системных ресурсов
 */
export class TestDiagnosticManager {
  private errors: TestError[] = [];
  private maxErrorHistory = 1000; // Максимальное количество ошибок в истории
  private systemMetrics: SystemMetrics = {} as SystemMetrics;
  private memoryLimit = 6144; // MB - лимит памяти из docker-compose
  
  constructor() {
    // Инициализируем системные метрики синхронно
    this.initializeSystemMetrics();
    // Запускаем мониторинг системных ресурсов
    this.startSystemMonitoring();
  }

  /**
   * Регистрация новой ошибки
   */
  async registerError(errorData: Partial<TestError>): Promise<TestError> {
    const fullError: TestError = {
      id: uuidv4(),
      timestamp: new Date(),
      severity: this.calculateSeverity(errorData),
      impact: this.calculateImpact(errorData),
      autoFixable: this.isAutoFixable(errorData),
      suggestions: await this.generateSuggestions(errorData),
      resolved: false,
      testId: errorData.testId || 'unknown',
      testType: errorData.testType || 'system',
      type: errorData.type || ErrorType.CALCULATION_ERROR,
      description: errorData.description || 'Unknown error',
      context: errorData.context || {},
      metadata: errorData.metadata || {},
      stackTrace: errorData.stackTrace,
    };
    
    // Добавляем в историю
    this.errors.unshift(fullError);
    
    // Ограничиваем размер истории
    if (this.errors.length > this.maxErrorHistory) {
      this.errors = this.errors.slice(0, this.maxErrorHistory);
    }
    
    logger.error(`[DiagnosticManager] Registered error: ${fullError.type} - ${fullError.description}`, {
      errorId: fullError.id,
      testId: fullError.testId,
      severity: fullError.severity
    });
    
    // WebSocket уведомление
    broadcast({
      type: 'DIAGNOSTIC_ERROR',
      error: {
        ...fullError,
        timestamp: fullError.timestamp.toISOString()
      }
    });
    
    // Попытка автоисправления
    if (fullError.autoFixable) {
      setTimeout(async () => {
        try {
          await this.attemptAutoFix(fullError);
        } catch (fixError) {
          logger.warn(`[DiagnosticManager] Auto-fix failed for error ${fullError.id}:`, fixError);
        }
      }, 1000);
    }
    
    return fullError;
  }

  /**
   * Предварительная оценка потребления памяти для портфеля
   */
  async estimateMemoryUsage(
    pairSymbols: string[],
    timeframe: string, 
    startDate: Date,
    endDate: Date
  ): Promise<{
    estimatedMemoryMB: number;
    warningLevel: 'safe' | 'warning' | 'critical';
    recommendation?: string;
  }> {
    const daysSpan = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    
    // Примерная оценка свечей на основе timeframe
    let candlesPerDay: number;
    switch (timeframe) {
      case '1m': candlesPerDay = 1440; break;
      case '5m': candlesPerDay = 288; break;
      case '15m': candlesPerDay = 96; break;
      case '1h': candlesPerDay = 24; break;
      case '4h': candlesPerDay = 6; break;
      case '1d': candlesPerDay = 1; break;
      default: candlesPerDay = 24;
    }
    
    const totalCandles = pairSymbols.length * daysSpan * candlesPerDay;
    
    // Оценка памяти: ~200 байт на свечу + накладные расходы
    const baseCandleSize = 200; // bytes per candle
    const strategyOverhead = 1.8; // 80% накладные расходы на индикаторы/стратегию
    const systemOverhead = 2.2; // 120% общие накладные расходы Node.js/V8
    
    const estimatedMemoryBytes = totalCandles * baseCandleSize * strategyOverhead * systemOverhead;
    const estimatedMemoryMB = Math.round(estimatedMemoryBytes / (1024 * 1024));
    
    // Определяем уровень предупреждения (лимит 8GB heap)
    let warningLevel: 'safe' | 'warning' | 'critical';
    let recommendation: string | undefined;
    
    if (estimatedMemoryMB > 7000) {
      warningLevel = 'critical';
      recommendation = `Портфель слишком большой! Оценка: ${estimatedMemoryMB}MB. Рекомендации: уменьшите количество пар до ${Math.floor(pairSymbols.length * 6000 / estimatedMemoryMB)} или разделите на батчи по временным периодам.`;
    } else if (estimatedMemoryMB > 5000) {
      warningLevel = 'warning';  
      recommendation = `Высокое потребление памяти: ~${estimatedMemoryMB}MB. Следите за состоянием системы во время теста.`;
    } else {
      warningLevel = 'safe';
    }
    
    logger.info(`[DiagnosticManager] Memory estimation: ${totalCandles} candles across ${pairSymbols.length} pairs = ${estimatedMemoryMB}MB (${warningLevel})`);
    
    return { estimatedMemoryMB, warningLevel, recommendation };
  }

  /**
   * Предварительный анализ данных портфеля
   */
  async analyzePortfolioData(
    pairSymbols: string[], 
    timeframe: string, 
    startDate: Date, 
    endDate: Date,
    exchange: string = 'okx'
  ): Promise<PortfolioDataAnalysis> {
    logger.info(`[DiagnosticManager] Analyzing portfolio data: ${pairSymbols.length} pairs on ${exchange}`);
    
    // НОВОЕ: Предварительная оценка памяти ПЕРЕД анализом данных
    const memoryEstimation = await this.estimateMemoryUsage(pairSymbols, timeframe, startDate, endDate);
    
    const analysis: PortfolioDataAnalysis = {
      totalPairs: pairSymbols.length,
      availablePairs: [],
      missingPairs: [],
      incompletePairs: [],
      problematicPairs: [],
      memoryEstimate: memoryEstimation.estimatedMemoryMB,
      recommendations: [],
      canProceed: false,
      warningLevel: 'none'
    };

    // Добавляем критические предупреждения о памяти В НАЧАЛО
    if (memoryEstimation.warningLevel === 'critical') {
      analysis.warningLevel = 'critical';
      analysis.canProceed = false;
      analysis.recommendations.unshift({
        id: uuidv4(),
        title: 'Критическое потребление памяти',
        type: 'error',
        priority: 10,
        description: memoryEstimation.recommendation || 'КРИТИЧЕСКИ высокое потребление памяти! Тест может привести к переполнению.'
      });
      
      // Регистрируем критическую ошибку сразу
      await this.registerError({
        type: ErrorType.MEMORY_OVERFLOW,
        testType: 'portfolio',
        description: `Предварительная оценка: портфель требует ${memoryEstimation.estimatedMemoryMB}MB памяти (превышает лимит)`,
        context: {
          estimatedMemoryMB: memoryEstimation.estimatedMemoryMB,
          pairsCount: pairSymbols.length,
          timeframe,
          daysSpan: Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
        }
      });
      
    } else if (memoryEstimation.warningLevel === 'warning') {
      analysis.recommendations.unshift({
        id: uuidv4(),
        title: 'Высокое потребление памяти',
        type: 'warning', 
        priority: 7,
        description: memoryEstimation.recommendation || `Высокое потребление памяти: ~${memoryEstimation.estimatedMemoryMB}MB`
      });
    }
    
    // Проверяем каждую пару
    for (const symbol of pairSymbols) {
      try {
        const pairStatus = await this.checkPairDataStatus(symbol, timeframe, startDate, endDate, exchange);
        
        switch (pairStatus.status) {
          case 'available':
            analysis.availablePairs.push(pairStatus);
            break;
          case 'missing':
            analysis.missingPairs.push(pairStatus);
            await this.registerDataMissingError(symbol, timeframe, startDate, endDate, exchange);
            break;
          case 'incomplete':
            analysis.incompletePairs.push(pairStatus);
            await this.registerDataIncompleteError(symbol, pairStatus, timeframe, exchange);
            break;
          case 'problematic':
            analysis.problematicPairs.push(pairStatus);
            break;
        }
        
        analysis.memoryEstimate += pairStatus.memoryEstimate;
        
      } catch (error: any) {
        logger.warn(`[DiagnosticManager] Error checking pair ${symbol}:`, error.message);
        
        // Добавляем как проблемную пару
        const problematicStatus: PairDataStatus = {
          symbol,
          exchange,
          status: 'problematic',
          coverage: 0,
          totalCandles: 0,
          memoryEstimate: 0
        };
        
        analysis.problematicPairs.push(problematicStatus);
      }
    }
    
    // Проверка лимитов памяти
    if (analysis.memoryEstimate > this.memoryLimit) {
      await this.registerError({
        type: ErrorType.MEMORY_OVERFLOW,
        severity: 'critical',
        testId: 'portfolio-validation',
        testType: 'portfolio',
        description: `Estimated memory usage (${Math.round(analysis.memoryEstimate)}MB) exceeds limit (${this.memoryLimit}MB)`,
        context: {
          pairSymbols,
          memoryEstimate: analysis.memoryEstimate,
          memoryLimit: this.memoryLimit
        }
      });
      
      analysis.warningLevel = 'critical';
      analysis.canProceed = false;
    }
    
    // Генерация рекомендаций
    analysis.recommendations = await this.generatePortfolioRecommendations(analysis);
    
    // Определение возможности продолжения
    const availableRatio = analysis.availablePairs.length / analysis.totalPairs;
    analysis.canProceed = availableRatio >= 0.7 && analysis.warningLevel !== 'critical';
    
    if (availableRatio < 0.5) {
      analysis.warningLevel = 'critical';
    } else if (availableRatio < 0.7) {
      analysis.warningLevel = 'high';
    } else if (analysis.incompletePairs.length > 0) {
      analysis.warningLevel = 'medium';
    }
    
    logger.info(`[DiagnosticManager] Portfolio analysis complete: ${analysis.availablePairs.length}/${analysis.totalPairs} pairs available, warning level: ${analysis.warningLevel}`);
    
    return analysis;
  }

  /**
   * Проверка статуса данных для одной пары
   */
  private async checkPairDataStatus(
    symbol: string,
    timeframe: string,
    startDate: Date,
    endDate: Date,
    exchange: string
  ): Promise<PairDataStatus> {
    try {
      // Проверяем наличие торговой пары в БД
      const tradingPair = await dataService.getTradingPairBySymbol(symbol, exchange);
      if (!tradingPair) {
        return {
          symbol,
          exchange,
          status: 'missing',
          coverage: 0,
          totalCandles: 0,
          memoryEstimate: 0
        };
      }

      // Проверяем данные свечей
      const candles = await dataService.getCandles(
        symbol,
        timeframe,
        startDate.getTime(),
        endDate.getTime(),
        exchange
      );

      if (candles.length === 0) {
        return {
          symbol,
          exchange,
          status: 'missing',
          coverage: 0,
          totalCandles: 0,
          memoryEstimate: 0
        };
      }

      // Расчет покрытия временного диапазона
      const firstCandle = candles[0];
      const lastCandle = candles[candles.length - 1];
      const actualStart = Math.max(firstCandle.timestamp, startDate.getTime());
      const actualEnd = Math.min(lastCandle.timestamp, endDate.getTime());
      const requestedRange = endDate.getTime() - startDate.getTime();
      const actualRange = actualEnd - actualStart;
      const coverage = Math.max(0, Math.min(1, actualRange / requestedRange));

      // Оценка потребления памяти (примерно 1KB на свечу)
      const memoryEstimate = candles.length * 0.001; // MB

      const status: PairDataStatus = {
        symbol,
        exchange,
        status: coverage >= 0.95 ? 'available' : coverage >= 0.5 ? 'incomplete' : 'missing',
        coverage,
        totalCandles: candles.length,
        memoryEstimate,
        lastUpdated: new Date()
      };

      // Определяем пропущенные диапазоны для неполных данных
      if (status.status === 'incomplete') {
        status.missingRanges = this.findMissingRanges(candles, startDate, endDate, timeframe);
      }

      return status;

    } catch (error: any) {
      logger.error(`[DiagnosticManager] Error checking pair data status for ${symbol}:`, error);
      return {
        symbol,
        exchange,
        status: 'problematic',
        coverage: 0,
        totalCandles: 0,
        memoryEstimate: 0
      };
    }
  }

  /**
   * Поиск пропущенных временных диапазонов в данных
   */
  private findMissingRanges(
    candles: any[],
    startDate: Date,
    endDate: Date,
    timeframe: string
  ): Array<{ start: Date; end: Date }> {
    if (candles.length === 0) {
      return [{ start: startDate, end: endDate }];
    }

    const missingRanges: Array<{ start: Date; end: Date }> = [];
    const sortedCandles = candles.sort((a, b) => a.timestamp - b.timestamp);
    
    // Проверяем начало
    if (sortedCandles[0].timestamp > startDate.getTime()) {
      missingRanges.push({
        start: startDate,
        end: new Date(sortedCandles[0].timestamp)
      });
    }

    // Проверяем конец
    if (sortedCandles[sortedCandles.length - 1].timestamp < endDate.getTime()) {
      missingRanges.push({
        start: new Date(sortedCandles[sortedCandles.length - 1].timestamp),
        end: endDate
      });
    }

    return missingRanges;
  }

  /**
   * Регистрация ошибки отсутствующих данных
   */
  private async registerDataMissingError(
    symbol: string,
    timeframe: string,
    startDate: Date,
    endDate: Date,
    exchange: string
  ) {
    await this.registerError({
      type: ErrorType.DATA_MISSING,
      testId: 'portfolio-validation',
      testType: 'portfolio',
      description: `No data available for ${symbol} on ${exchange}`,
      context: { symbol, timeframe, dateRange: { startDate, endDate }, exchange },
      severity: 'medium'
    });
  }

  /**
   * Регистрация ошибки неполных данных
   */
  private async registerDataIncompleteError(
    symbol: string,
    pairStatus: PairDataStatus,
    timeframe: string,
    exchange: string
  ) {
    await this.registerError({
      type: ErrorType.DATA_INCOMPLETE,
      testId: 'portfolio-validation',
      testType: 'portfolio',
      description: `Incomplete data for ${symbol}: ${Math.round(pairStatus.coverage * 100)}% coverage`,
      context: { 
        symbol, 
        coverage: pairStatus.coverage,
        timeframe,
        exchange,
        missingRanges: pairStatus.missingRanges
      },
      severity: pairStatus.coverage < 0.5 ? 'high' : 'medium'
    });
  }

  /**
   * Генерация рекомендаций для портфеля
   */
  private async generatePortfolioRecommendations(analysis: PortfolioDataAnalysis): Promise<DiagnosticRecommendation[]> {
    const recommendations: DiagnosticRecommendation[] = [];

    // Рекомендация по отсутствующим данным
    if (analysis.missingPairs.length > 0) {
      recommendations.push({
        id: 'fetch-missing-data',
        type: 'warning',
        title: `Отсутствуют данные для ${analysis.missingPairs.length} пар`,
        description: `Пары: ${analysis.missingPairs.map(p => p.symbol).join(', ')}. Рекомендуется загрузить данные или исключить эти пары.`,
        actions: [
          {
            id: 'fetch-all-missing',
            label: 'Загрузить все недостающие данные',
            action: 'FETCH_MISSING_DATA',
            params: { pairs: analysis.missingPairs.map(p => p.symbol) }
          },
          {
            id: 'exclude-missing',
            label: 'Исключить недоступные пары',
            action: 'EXCLUDE_PAIRS',
            params: { pairs: analysis.missingPairs.map(p => p.symbol) }
          }
        ],
        priority: 8
      });
    }

    // Рекомендация по неполным данным
    if (analysis.incompletePairs.length > 0) {
      recommendations.push({
        id: 'fix-incomplete-data',
        type: 'warning',
        title: `Неполные данные для ${analysis.incompletePairs.length} пар`,
        description: `Среднее покрытие: ${Math.round(analysis.incompletePairs.reduce((sum, p) => sum + p.coverage, 0) / analysis.incompletePairs.length * 100)}%`,
        actions: [
          {
            id: 'fetch-missing-ranges',
            label: 'Дозагрузить недостающие диапазоны',
            action: 'FETCH_MISSING_RANGES',
            params: { pairs: analysis.incompletePairs }
          }
        ],
        priority: 6
      });
    }

    // Рекомендация по памяти
    if (analysis.memoryEstimate > this.memoryLimit * 0.8) {
      recommendations.push({
        id: 'memory-optimization',
        type: 'error',
        title: `Высокое потребление памяти: ${Math.round(analysis.memoryEstimate)}MB`,
        description: `Приближается к лимиту ${this.memoryLimit}MB. Рекомендуется уменьшить количество пар.`,
        actions: [
          {
            id: 'reduce-pairs',
            label: 'Уменьшить количество пар',
            action: 'REDUCE_PAIRS',
            params: { 
              currentCount: analysis.totalPairs,
              recommendedCount: Math.floor(analysis.totalPairs * 0.7)
            }
          },
          {
            id: 'split-portfolio',
            label: 'Разделить на батчи',
            action: 'SPLIT_PORTFOLIO',
            params: { batchSize: Math.floor(analysis.totalPairs / 2) }
          }
        ],
        priority: 9
      });
    }

    return recommendations.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Вычисление серьезности ошибки
   */
  private calculateSeverity(errorData: Partial<TestError>): 'low' | 'medium' | 'high' | 'critical' {
    if (errorData.severity) return errorData.severity;

    switch (errorData.type) {
      case ErrorType.MEMORY_OVERFLOW:
      case ErrorType.GPU_SERVICE_DOWN:
        return 'critical';
      case ErrorType.DATA_MISSING:
      case ErrorType.PORTFOLIO_INCOMPLETE:
        return 'high';
      case ErrorType.DATA_INCOMPLETE:
      case ErrorType.GPU_PERFORMANCE_ISSUE:
        return 'medium';
      default:
        return 'low';
    }
  }

  /**
   * Вычисление влияния ошибки (0-1)
   */
  private calculateImpact(errorData: Partial<TestError>): number {
    switch (errorData.type) {
      case ErrorType.MEMORY_OVERFLOW: return 1.0;
      case ErrorType.GPU_SERVICE_DOWN: return 0.8;
      case ErrorType.DATA_MISSING: return 0.7;
      case ErrorType.PORTFOLIO_INCOMPLETE: return 0.6;
      case ErrorType.DATA_INCOMPLETE: return 0.4;
      default: return 0.2;
    }
  }

  /**
   * Проверка возможности автоисправления
   */
  private isAutoFixable(errorData: Partial<TestError>): boolean {
    switch (errorData.type) {
      case ErrorType.DATA_MISSING:
      case ErrorType.DATA_INCOMPLETE:
      case ErrorType.GPU_SERVICE_DOWN:
        return true;
      default:
        return false;
    }
  }

  /**
   * Генерация предложений по исправлению
   */
  private async generateSuggestions(errorData: Partial<TestError>): Promise<FixSuggestion[]> {
    const suggestions: FixSuggestion[] = [];

    switch (errorData.type) {
      case ErrorType.DATA_MISSING:
        suggestions.push({
          type: 'fetch_data',
          description: `Загрузить данные для ${errorData.context?.symbol}`,
          action: 'FETCH_DATA',
          params: { 
            symbol: errorData.context?.symbol,
            timeframe: errorData.context?.timeframe,
            exchange: errorData.context?.exchange
          },
          priority: 'high',
          estimatedTime: '2-5 минут'
        });
        suggestions.push({
          type: 'exclude_pair',
          description: `Исключить ${errorData.context?.symbol} из тестирования`,
          action: 'EXCLUDE_PAIR',
          params: { symbol: errorData.context?.symbol },
          priority: 'medium',
          estimatedTime: 'немедленно'
        });
        break;

      case ErrorType.GPU_SERVICE_DOWN:
        suggestions.push({
          type: 'restart_gpu',
          description: 'Перезапустить GPU сервис',
          action: 'RESTART_GPU_SERVICE',
          params: {},
          priority: 'high',
          estimatedTime: '30-60 секунд'
        });
        suggestions.push({
          type: 'fallback_cpu',
          description: 'Использовать CPU вместо GPU',
          action: 'FALLBACK_TO_CPU',
          params: {},
          priority: 'medium',
          estimatedTime: 'немедленно'
        });
        break;

      case ErrorType.MEMORY_OVERFLOW:
        suggestions.push({
          type: 'reduce_data',
          description: 'Уменьшить объем обрабатываемых данных',
          action: 'REDUCE_DATA_SIZE',
          params: { reduction: 0.3 },
          priority: 'high',
          estimatedTime: 'немедленно'
        });
        break;
    }

    return suggestions;
  }

  /**
   * Попытка автоматического исправления
   */
  private async attemptAutoFix(error: TestError): Promise<boolean> {
    logger.info(`[DiagnosticManager] Attempting auto-fix for error ${error.id}: ${error.type}`);

    try {
      switch (error.type) {
        case ErrorType.DATA_MISSING:
          return await this.autoFixMissingData(error);
        default:
          return false;
      }
    } catch (fixError: any) {
      logger.error(`[DiagnosticManager] Auto-fix failed for error ${error.id}:`, fixError);
      return false;
    }
  }

  /**
   * Автоисправление отсутствующих данных
   */
  private async autoFixMissingData(error: TestError): Promise<boolean> {
    // Здесь будет логика автоматической загрузки данных
    // Пока заглушка
    logger.info(`[DiagnosticManager] Auto-fix for missing data not yet implemented`);
    return false;
  }

  /**
   * Автоисправление GPU сервиса
   */
  /**
   * Отметить ошибку как решенную
   */
  resolveError(errorId: string): void {
    const error = this.errors.find(e => e.id === errorId);
    if (error) {
      error.resolved = true;
      error.resolvedAt = new Date();
      
      broadcast({
        type: 'DIAGNOSTIC_ERROR_RESOLVED',
        errorId,
        resolvedAt: error.resolvedAt.toISOString()
      });
      
      logger.info(`[DiagnosticManager] Error ${errorId} marked as resolved`);
    }
  }

  /**
   * Получение ошибок с фильтрацией
   */
  getErrors(filters: {
    type?: ErrorType;
    severity?: string;
    testId?: string;
    resolved?: boolean;
    startDate?: Date;
    endDate?: Date;
  }, limit: number = 100): TestError[] {
    let filtered = this.errors;

    if (filters.type) {
      filtered = filtered.filter(e => e.type === filters.type);
    }
    if (filters.severity) {
      filtered = filtered.filter(e => e.severity === filters.severity);
    }
    if (filters.testId) {
      filtered = filtered.filter(e => e.testId === filters.testId);
    }
    if (filters.resolved !== undefined) {
      filtered = filtered.filter(e => e.resolved === filters.resolved);
    }
    if (filters.startDate) {
      filtered = filtered.filter(e => e.timestamp >= filters.startDate!);
    }
    if (filters.endDate) {
      filtered = filtered.filter(e => e.timestamp <= filters.endDate!);
    }

    return filtered.slice(0, limit);
  }

  /**
   * Получение системных метрик
   */
  async getSystemHealth(): Promise<{
    status: 'healthy' | 'warning' | 'critical';
    metrics: SystemMetrics;
    recommendations: DiagnosticRecommendation[];
  }> {
    // Обновляем метрики асинхронно
    this.updateSystemMetrics().catch(error => {
      logger.warn('[DiagnosticManager] Failed to update system metrics:', error);
    });
    
    const recommendations: DiagnosticRecommendation[] = [];
    let status: 'healthy' | 'warning' | 'critical' = 'healthy';

    // Проверка памяти (с защитой от undefined)
    const memoryPercentage = this.systemMetrics.memory?.percentage;
    if (memoryPercentage !== undefined && memoryPercentage > 90) {
      status = 'critical';
      recommendations.push({
        id: 'memory-critical',
        type: 'error',
        title: 'Критически низкая память',
        description: `Использование памяти: ${memoryPercentage}%`,
        priority: 10
      });
    } else if (memoryPercentage !== undefined && memoryPercentage > 80) {
      status = 'warning';
      recommendations.push({
        id: 'memory-warning',
        type: 'warning',
        title: 'Высокое использование памяти',
        description: `Использование памяти: ${memoryPercentage}%`,
        priority: 7
      });
    }

    // Проверка CPU (с защитой от undefined)
    const cpuUsage = this.systemMetrics.cpu?.usage;
    if (cpuUsage !== undefined && cpuUsage > 90) {
      status = 'critical';
      recommendations.push({
        id: 'cpu-critical',
        type: 'error',
        title: 'Критическая загрузка CPU',
        description: `Использование CPU: ${cpuUsage}%`,
        priority: 9
      });
    }

    return {
      status,
      metrics: this.systemMetrics,
      recommendations
    };
  }

  /**
   * Инициализация системных метрик (синхронная)
   */
  private initializeSystemMetrics(): void {
    const memInfo = process.memoryUsage();

    this.systemMetrics = {
      cpu: {
        usage: process.cpuUsage().user / 1000000,
        cores: require('os').cpus().length,
        load: require('os').loadavg()
      },
      memory: {
        used: Math.round(memInfo.heapUsed / 1024 / 1024),
        total: Math.round(memInfo.heapTotal / 1024 / 1024),
        percentage: Math.round((memInfo.heapUsed / memInfo.heapTotal) * 100)
      },
      disk: {
        used: 0,
        total: 0,
        percentage: 0
      }
    };
  }

  /**
   * Обновление системных метрик
   */
  private async updateSystemMetrics(): Promise<void> {
    // Получение метрик системы
    const memInfo = process.memoryUsage();
    
    this.systemMetrics = {
      cpu: {
        usage: process.cpuUsage().user / 1000000, // Примерный расчет
        cores: require('os').cpus().length,
        load: require('os').loadavg()
      },
      memory: {
        used: Math.round(memInfo.heapUsed / 1024 / 1024), // MB
        total: Math.round(memInfo.heapTotal / 1024 / 1024), // MB
        percentage: Math.round((memInfo.heapUsed / memInfo.heapTotal) * 100)
      },
      disk: {
        used: 0, // Здесь будет реальная проверка диска
        total: 0,
        percentage: 0
      },
      gpu: this.systemMetrics.gpu ?? {
        available: false,
        healthy: false,
        memoryUsed: 0,
        memoryTotal: 0,
        utilization: 0
      }
    };
  }

  /**
   * Запуск мониторинга системных ресурсов
   */
  private startSystemMonitoring(): void {
    // УЛУЧШЕННЫЙ мониторинг - каждые 15 секунд с проверкой памяти
    setInterval(async () => {
      try {
        await this.updateSystemMetrics();
        await this.checkMemoryThresholds(); // НОВОЕ: Проактивная проверка памяти
      } catch (error) {
        logger.warn('[DiagnosticManager] Error in system monitoring:', error);
      }
    }, 15000); // Увеличена частота

    logger.info('[DiagnosticManager] Enhanced system monitoring started (15s intervals with memory alerts)');
  }

  /**
   * НОВАЯ функция проактивной проверки памяти
   */
  private async checkMemoryThresholds(): Promise<void> {
    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
    const rssMB = Math.round(memUsage.rss / 1024 / 1024);
    const heapLimit = 8192; // 8GB лимит из NODE_OPTIONS
    
    // Критический уровень - немедленное реагирование
    if (heapUsedMB > heapLimit * 0.85) { // 85% от лимита
      await this.registerError({
        type: ErrorType.MEMORY_OVERFLOW,
        severity: 'critical',
        testType: 'system',
        description: `КРИТИЧЕСКОЕ переполнение памяти! Heap: ${heapUsedMB}MB/${heapLimit}MB (${Math.round(heapUsedMB/heapLimit*100)}%)`,
        context: {
          heapUsedMB,
          heapTotalMB,
          rssMB,
          heapLimit,
          usagePercent: Math.round(heapUsedMB/heapLimit*100)
        }
      });
      
      // Экстренная очистка памяти
      if (global.gc) {
        logger.warn('[DiagnosticManager] CRITICAL MEMORY! Forcing garbage collection...');
        global.gc();
        global.gc(); // Двойная очистка
        
        const memAfterGC = process.memoryUsage();
        const heapAfterMB = Math.round(memAfterGC.heapUsed / 1024 / 1024);
        logger.warn(`[DiagnosticManager] Memory after GC: ${heapAfterMB}MB (freed: ${heapUsedMB - heapAfterMB}MB)`);
        
        if (heapAfterMB > heapLimit * 0.8) { // Все еще критично
          logger.error('[DiagnosticManager] MEMORY LEAK DETECTED! GC ineffective');
          
          broadcast({
            type: 'CRITICAL_MEMORY_WARNING',
            data: {
              heapUsed: heapAfterMB,
              heapLimit,
              recommendation: 'Перезапустите сервер или уменьшите размер портфеля'
            }
          });
        }
      }
      
    // Высокий уровень - предупреждение  
    } else if (heapUsedMB > heapLimit * 0.70) { // 70% от лимита
      logger.warn(`[DiagnosticManager] High memory usage: ${heapUsedMB}MB/${heapLimit}MB (${Math.round(heapUsedMB/heapLimit*100)}%)`);
      
      if (global.gc) {
        global.gc();
      }
      
      broadcast({
        type: 'MEMORY_WARNING',
        data: {
          heapUsed: heapUsedMB,
          heapLimit,
          usagePercent: Math.round(heapUsedMB/heapLimit*100)
        }
      });
    }
  }

  /**
   * Получение краткой сводки по ошибкам
   */
  getErrorSummary(): {
    total: number;
    critical: number;
    unresolved: number;
    lastHour: number;
    mostCommon: { type: ErrorType; count: number }[];
  } {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const unresolved = this.errors.filter(e => !e.resolved);
    const lastHour = this.errors.filter(e => e.timestamp > hourAgo);
    
    // Подсчет по типам
    const typeCounts = new Map<ErrorType, number>();
    this.errors.forEach(error => {
      typeCounts.set(error.type, (typeCounts.get(error.type) || 0) + 1);
    });
    
    const mostCommon = Array.from(typeCounts.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      total: this.errors.length,
      critical: this.errors.filter(e => e.severity === 'critical').length,
      unresolved: unresolved.length,
      lastHour: lastHour.length,
      mostCommon
    };
  }
}

// Экспорт singleton instance
export const diagnosticManager = new TestDiagnosticManager();
