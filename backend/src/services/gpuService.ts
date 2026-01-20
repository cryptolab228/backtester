import axios, { AxiosError } from 'axios';
import logger from '../utils/logger';
import { BacktestRunParameters, BacktestResult, BacktestMetrics, Trade, TradeDirection, StrategyCandle } from '../modules/backtester/backtester.types';
import type { CandleData } from '../interfaces/marketData.interface';
import { diagnosticManager, ErrorType } from '../diagnostics/TestDiagnosticManager';

// ИСПРАВЛЕНИЕ: Правильная конфигурация для Docker среды
const GPU_SERVICE_URL = process.env.GPU_SERVICE_URL || 'http://gpu-service:6000';

// Флаг для отключения GPU сервиса в development
const DISABLE_GPU_SERVICE = process.env.DISABLE_GPU_SERVICE === 'true';
const GPU_SERVICE_TIMEOUT = parseInt(process.env.GPU_SERVICE_TIMEOUT || '120000'); // Увеличено до 2 минут
const GPU_MAX_RETRIES = 3; // Количество повторных попыток

// Интерфейс для запроса к GPU API
interface GPUBacktestRequest {
  candles: Array<{
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
  strategy: string;
  parameters: {
    [key: string]: any;
  };
  initial_capital: number;
  symbol?: string;
  pairSymbol?: string;
  compressed?: boolean;
}

// Интерфейс для ответа от GPU API
interface GPUBacktestResponse {
  success: boolean;
  data?: {
    // Старый формат (для совместимости)
    metrics?: {
      total_pnl: number;
      total_trades: number;
      winning_trades: number;
      losing_trades: number;
      win_rate: number;
      profit_factor: number;
      max_drawdown: number;
      sharpe_ratio?: number;
      initial_capital: number;
      final_capital: number;
    };
    trades?: Array<{
      entry_time: number;
      entry_price: number;
      exit_time?: number;
      exit_price?: number;
      direction: 'long' | 'short';
      size: number;
      pnl?: number;
      entry_reason?: string;
      exit_reason?: string;
    }>;
    equity_curve?: Array<{
      timestamp: number;
      capital: number;
    }>;
    // НОВОЕ: Поддержка нового формата от Python worker
    backtest_results?: {
      total_trades: number;
      profitable_trades: number;
      total_profit: number;
      final_balance: number;
      return_percentage: number;
      max_drawdown: number;
      win_rate: number;
      trades: Array<{
        entry_price: number;
        exit_price: number;
        profit: number;
        entry_reason: string;
        exit_reason: string;
      }>;
    };
    message?: string;
    processed_candles_count?: number;
    signals_generated?: number;
  };
  error?: string;
  processing_time?: number;
}

/**
 * Проверяет доступность GPU сервиса
 */
export const checkGPUServiceHealth = async (): Promise<boolean> => {
  // Если GPU сервис отключен, всегда возвращаем false без попытки подключения
  if (DISABLE_GPU_SERVICE) {
    logger.debug('[GPUService] GPU service disabled by environment variable');
    return false;
  }

  try {
    const response = await axios.get(`${GPU_SERVICE_URL}/health`, {
      timeout: 5000
    });
    return response.status === 200;
  } catch (error: any) {
    logger.debug(`[GPUService] Health check failed: ${error.message}`);
    return false;
  }
};

/**
 * Получает список доступных индикаторов от GPU сервиса
 */
export const getGPUIndicators = async (): Promise<string[]> => {
  try {
    const response = await axios.get(`${GPU_SERVICE_URL}/api/gpu/indicators`, {
      timeout: 10000
    });
    
    return response.data.indicators || [];
  } catch (error: any) {
    logger.error(`[GPUService] Failed to get indicators: ${error.message}`);
    return [];
  }
}

/**
 * НОВОЕ: Сжимает массив свечей для более эффективной передачи
 */
const compressCandleData = (candles: CandleData[]): any[] => {
  // Конвертируем в более компактный формат с округлением для уменьшения размера
  return candles.map(candle => [
    candle.timestamp,
    Math.round(candle.open * 100000) / 100000,      // 5 знаков после запятой
    Math.round(candle.high * 100000) / 100000,
    Math.round(candle.low * 100000) / 100000,
    Math.round(candle.close * 100000) / 100000,
    Math.round(candle.volume * 100) / 100          // 2 знака после запятой для объема
  ]);
};

/**
 * НОВОЕ: Декомпрессирует массив свечей после получения от GPU
 */
const decompressCandleData = (compressedCandles: any[]): CandleData[] => {
  return compressedCandles.map(candle => ({
    timestamp: candle[0],
    open: candle[1],
    high: candle[2],
    low: candle[3],
    close: candle[4],
    volume: candle[5]
  }));
};

/**
 * Преобразует параметры стратегии из внутреннего формата в формат GPU API
 * ИСПРАВЛЕНО: Передаем полные параметры стратегии напрямую в GPU
 */
const convertStrategyParameters = (strategyParams: any): { strategy: string; parameters: any } => {
  logger.info(`[GPUService] Converting strategy parameters:`, {
    keys: Object.keys(strategyParams || {}),
    dlc: !!strategyParams?.dlc,
    nwe: !!strategyParams?.nwe,
    clusters: !!strategyParams?.clusters,
    risk: !!strategyParams?.risk
  });

  // ИСПРАВЛЕНИЕ: Передаем полную структуру параметров стратегии в GPU
  // GPU Python worker ожидает именно такой формат, как в CPU версии
  const fullStrategyParams = {
    // Передаем все параметры "как есть" - GPU Python worker их обработает
    ...strategyParams,
    
    // Добавляем базовые значения по умолчанию, если они отсутствуют
    global: strategyParams?.global || {
      atrPeriod: 14,
      avgVolumePeriod: 20
    },
    
    dlc: strategyParams?.dlc || {
      period: 40,
      pocLookback: 5,
      numProfiles: 1,
      vaPercentage: 0.7
    },
    
    nwe: strategyParams?.nwe || {
      enabled: true,
      bandwidth: 8,
      multiplier: 3
    },
    
    clusters: strategyParams?.clusters || {
      minVolumeThresholdMultiplier: 1.5,
      deltaThreshold: 0.7,
      lookbackPeriod: 20,
      confirmationBars: 1 // ИЗМЕНЕНО с 2 на 1
    },
    
    risk: strategyParams?.risk || {
      atrPeriod: 14,
      positionSizePercentage: 0.02,
      maxRiskPerTradePercentage: 0.02,
      stopLossMultiplier: 2.0,
      takeProfitMultiplier: 5.0,
      useTrailingStop: true, // Добавлено для консистентности
      trailingStopOffsetMultiplier: 2.0, // Добавлено
      trailingStopStepMultiplier: 1.0, // Добавлено
      maxTradesPerDay: 2
    }
  };

  logger.info(`[GPUService] Passing full strategy params to GPU:`, {
    paramCount: Object.keys(fullStrategyParams).length,
    hasAllSections: !!(fullStrategyParams.dlc && fullStrategyParams.nwe && fullStrategyParams.clusters && fullStrategyParams.risk)
  });

  // Возвращаем полные параметры - GPU Python worker разберет их сам
  return {
    strategy: fullStrategyParams, // Передаем всю структуру как "strategy"
    parameters: fullStrategyParams // И дублируем в "parameters" для совместимости
  };
};

/**
 * Преобразует результат GPU бэктеста в формат внутреннего API
 * ИСПРАВЛЕНО: Адаптировано под новый формат ответа Python worker
 */
const convertGPUResult = (gpuResult: GPUBacktestResponse['data'], runParams: BacktestRunParameters): BacktestResult => {
  if (!gpuResult) {
    throw new Error('No data in GPU response');
  }

  logger.info(`[GPUService] Converting GPU result:`, {
    keys: Object.keys(gpuResult),
    hasBacktestResults: !!gpuResult.backtest_results,
    hasMetrics: !!gpuResult.metrics
  });

  // НОВОЕ: Поддержка нового формата ответа Python worker
  let rawMetrics: any;
  let rawTrades: any[] = [];

  if (gpuResult.backtest_results) {
    // Новый формат от Python worker
    rawMetrics = gpuResult.backtest_results;
    rawTrades = gpuResult.backtest_results.trades || [];
  } else if (gpuResult.metrics) {
    // Старый формат (если есть)
    rawMetrics = gpuResult.metrics;
    rawTrades = gpuResult.trades || [];
  } else {
    throw new Error('No metrics found in GPU response');
  }

  logger.info(`[GPUService] Raw metrics:`, rawMetrics);

  // Преобразуем метрики с поддержкой разных полей
  const totalPnl = rawMetrics.total_profit || rawMetrics.total_pnl || 0;
  const totalTrades = rawMetrics.total_trades || 0;
  const winningTrades = rawMetrics.profitable_trades || rawMetrics.winning_trades || 0;
  const losingTrades = totalTrades - winningTrades;
  
  // ИСПРАВЛЕНИЕ: Проверяем, уже ли винрейт в процентах или нужно конвертировать
  // ИСПРАВЛЕНО: GPU Python worker возвращает winRate уже в процентах (0-100)
  let winRate = rawMetrics.win_rate || 0;
  
  // Проверяем, если winRate больше 100 или кажется неправильным - пересчитываем
  if (winRate > 100 || (winRate <= 1 && totalTrades > 0 && winningTrades > 0)) {
    // Пересчитываем правильный винрейт в процентах
    winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
    logger.warn(`[GPUService] Recalculated win rate: ${winRate.toFixed(1)}% (was: ${rawMetrics.win_rate})`);
  }
  // GPU уже возвращает в процентах, НЕ умножаем на 100!
  
  const initialCapital = runParams.initialCapital;
  const finalCapital = rawMetrics.final_balance || (initialCapital + totalPnl);
  const totalPnlPercentage = rawMetrics.return_percentage || ((finalCapital - initialCapital) / initialCapital) * 100;
  const maxDrawdown = rawMetrics.max_drawdown || 0;

  // ДИАГНОСТИКА: Подробное логирование винрейта
  logger.info(`[GPUService] Win rate calculation:`, {
    rawWinRate: rawMetrics.win_rate,
    totalTrades,
    winningTrades,
    losingTrades,
    calculatedWinRate: winRate,
    winRatePercent: `${winRate.toFixed(2)}%`
  });

  // Рассчитываем производные метрики правильно
  // Получаем данные из GPU результата
  const grossProfit = rawMetrics.gross_profit || 0;
  const grossLoss = Math.abs(rawMetrics.gross_loss || 0);
  const profitFactor = rawMetrics.profit_factor || (grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0));

  const metrics: BacktestMetrics = {
    totalPnl,
    totalPnlPercentage,
    totalTrades,
    winningTrades,
    losingTrades,
    winRate,
    profitFactor,
    maxDrawdown,
    sharpeRatio: rawMetrics.sharpe_ratio,
    initialCapital,
    finalCapital,
    grossProfit,
    grossLoss,
    averageTradePnl: totalTrades > 0 ? totalPnl / totalTrades : 0,
    avgWinningTrade: winningTrades > 0 ? grossProfit / winningTrades : 0,
    avgLosingTrade: losingTrades > 0 ? grossLoss / losingTrades : 0,
    expectancy: totalTrades > 0 ? totalPnl / totalTrades : 0,
    equityCurve: gpuResult.equity_curve || []
  };

  // Преобразуем сделки
  const trades: Trade[] = rawTrades.map((trade, index) => ({
    id: `gpu-trade-${Date.now()}-${index}`,
    pair: runParams.pairSymbol,
    entryTimestamp: trade.entry_time || Date.now(),
    exitTimestamp: trade.exit_time,
    direction: (trade.direction === 'short' || (trade.profit && trade.profit < 0)) ? TradeDirection.SHORT : TradeDirection.LONG,
    entryPrice: trade.entry_price || 0,
    exitPrice: trade.exit_price || 0,
    size: trade.size || 1,
    pnl: trade.profit || trade.pnl || 0,
    entryReason: trade.entry_reason || 'GPU Signal',
    exitReason: trade.exit_reason || 'GPU Exit',
    status: trade.exit_time ? 'closed' : 'active'
  }));

  logger.info(`[GPUService] Converted result: ${totalTrades} trades, PnL: ${totalPnl.toFixed(2)}, Win rate: ${winRate.toFixed(1)}%`);

  return {
    metrics,
    trades,
    configUsed: runParams,
    message: `GPU backtest completed successfully. ${gpuResult.message || ''}`
  };
};

/**
 * Преобразует результат ОПТИМИЗИРОВАННОГО GPU бэктеста в формат внутреннего API
 */
const convertOptimizedGPUResult = (optimizedGpuResult: any, runParams: BacktestRunParameters): BacktestResult => {
  if (!optimizedGpuResult) {
    throw new Error('No data in optimized GPU response');
  }

  logger.info(`[GPUService-OPTIMIZED] Converting optimized GPU result:`, {
    hasBacktestResults: !!optimizedGpuResult.backtest_results,
    gpu_enabled: optimizedGpuResult.gpu_enabled,
    processing_time: optimizedGpuResult.processing_time
  });

  const backtest_results = optimizedGpuResult.backtest_results;
  if (!backtest_results) {
    throw new Error('No backtest_results found in optimized GPU response');
  }

  // Extract metrics from optimized format
  const totalPnl = backtest_results.total_profit || 0;
  const totalTrades = backtest_results.total_trades || 0;
  const winningTrades = backtest_results.profitable_trades || 0;
  const losingTrades = backtest_results.losing_trades || (totalTrades - winningTrades);
  
  // Win rate is already in percentage (0-100) from optimized GPU
  const winRate = backtest_results.win_rate || 0;
  
  const initialCapital = runParams.initialCapital;
  const finalCapital = backtest_results.final_balance || (initialCapital + totalPnl);
  const totalPnlPercentage = backtest_results.return_percentage || 0;
  const maxDrawdown = backtest_results.max_drawdown || 0;
  const profitFactor = backtest_results.profit_factor || 0;
  const grossProfit = backtest_results.gross_profit || 0;
  const grossLoss = backtest_results.gross_loss || 0;

  // Enhanced metrics logging
  logger.info(`[GPUService-OPTIMIZED] Metrics conversion:`, {
    totalTrades,
    winningTrades,
    losingTrades,
    winRate: `${winRate.toFixed(1)}%`,
    totalPnl: totalPnl.toFixed(2),
    returnPct: `${totalPnlPercentage.toFixed(1)}%`
  });

  const metrics: BacktestMetrics = {
    totalPnl,
    totalPnlPercentage,
    totalTrades,
    winningTrades,
    losingTrades,
    winRate,
    profitFactor,
    maxDrawdown,
    sharpeRatio: 0, // Not calculated in optimized version yet
    initialCapital,
    finalCapital,
    grossProfit,
    grossLoss,
    averageTradePnl: totalTrades > 0 ? totalPnl / totalTrades : 0,
    avgWinningTrade: winningTrades > 0 ? grossProfit / winningTrades : 0,
    avgLosingTrade: losingTrades > 0 ? grossLoss / losingTrades : 0,
    expectancy: totalTrades > 0 ? totalPnl / totalTrades : 0,
    equityCurve: [], // Not included in optimized version for performance
    durationMs: (optimizedGpuResult.processing_time_seconds || 0) * 1000
  };

  // Convert trades (limit to avoid huge payloads)
  const rawTrades = backtest_results.trades || [];
  const trades: Trade[] = rawTrades.slice(0, 200).map((trade: any, index: number) => ({
    id: `gpu-optimized-${Date.now()}-${index}`,
    pair: runParams.pairSymbol,
    entryTimestamp: trade.entry_time || Date.now(),
    exitTimestamp: trade.exit_time || Date.now(),
    direction: trade.direction === 'short' ? TradeDirection.SHORT : TradeDirection.LONG,
    entryPrice: trade.entry_price || 0,
    exitPrice: trade.exit_price || 0,
    size: trade.size || 1,
    pnl: trade.pnl || 0,
    entryReason: trade.entry_reason || 'Optimized GPU Signal',
    exitReason: trade.exit_reason || 'Optimized GPU Exit',
    status: trade.exit_time ? 'closed' : 'active'
  }));

  logger.info(`[GPUService-OPTIMIZED] Conversion complete: ${totalTrades} trades, PnL: ${totalPnl.toFixed(2)}, Win rate: ${winRate.toFixed(1)}%, GPU: ${optimizedGpuResult.gpu_enabled}`);

  return {
    metrics,
    trades,
    configUsed: runParams,
    message: `Optimized GPU backtest completed successfully. GPU: ${optimizedGpuResult.gpu_enabled ? 'YES' : 'NO'}`
  };
};

/**
 * НОВАЯ ОПТИМИЗИРОВАННАЯ версия: Выполняет бэктест с использованием нового GPU микросервиса
 */
export const runOptimizedGPUBacktest = async (
  runParams: BacktestRunParameters,
  candles: CandleData[]
): Promise<BacktestResult> => {
  logger.info(`[GPUService-OPTIMIZED] ==> runOptimizedGPUBacktest function CALLED for ${runParams.pairSymbol}.`);
  logger.info(`[GPUService-OPTIMIZED] Starting OPTIMIZED GPU backtest for ${runParams.pairSymbol} with ${candles.length} candles`);

  let lastError: any;

  // OPTIMIZED: Single attempt with better error handling
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      // Health check on first attempt (только если GPU не отключен)
      if (attempt === 1 && !DISABLE_GPU_SERVICE) {
        const isHealthy = await checkGPUServiceHealth();
        if (!isHealthy) {
          throw new Error('GPU service is not available');
        }
      }

      // Convert strategy parameters (same as before)
      const { strategy, parameters } = convertStrategyParameters(runParams.strategyParameters);
      logger.info(`[GPUService-OPTIMIZED] Using GPU strategy with parameters:`, Object.keys(parameters || {}));

      // OPTIMIZATION: Use compressed array format from the start
      const compressedCandles = compressCandleData(candles);
      const originalSize = JSON.stringify(candles).length;
      const compressedSize = JSON.stringify(compressedCandles).length;
      const compressionRatio = ((originalSize - compressedSize) / originalSize * 100).toFixed(1);
      
      logger.info(`[GPUService-OPTIMIZED] Data compression: ${originalSize} -> ${compressedSize} bytes (${compressionRatio}% reduction)`);

      // OPTIMIZED request payload
      const optimizedGpuRequest = {
        candles: compressedCandles,
        strategy: strategy,
        parameters: parameters,
        initial_capital: runParams.initialCapital,
        symbol: runParams.pairSymbol,
        pairSymbol: runParams.pairSymbol,
        compressed: true
      };

      logger.info(`[GPUService-OPTIMIZED] Sending request to OPTIMIZED GPU endpoint (attempt ${attempt})`);

      // Call OPTIMIZED endpoint
      const startTime = Date.now();
      const response = await axios.post(
        `${GPU_SERVICE_URL}/api/gpu/backtest-optimized`,
        optimizedGpuRequest,
        {
          timeout: GPU_SERVICE_TIMEOUT,
          headers: {
            'Content-Type': 'application/json',
            'Accept-Encoding': 'gzip, deflate'
          },
          maxContentLength: 100 * 1024 * 1024,
          maxBodyLength: 100 * 1024 * 1024
        }
      );

      const processingTime = Date.now() - startTime;
      logger.info(`[GPUService-OPTIMIZED] OPTIMIZED GPU backtest completed in ${processingTime}ms (attempt ${attempt})`);

      // Enhanced response logging
      logger.info(`[GPUService-OPTIMIZED] Response:`, {
        success: response.data.success,
        optimization_used: response.data.optimization_used,
        gpu_enabled: response.data.data?.gpu_enabled,
        api_processing_time: response.data.api_processing_time_ms,
        total_time: processingTime
      });

      if (!response.data.success) {
        throw new Error(response.data.error || 'Optimized GPU backtest failed');
      }

      if (!response.data.data) {
        throw new Error('No data returned from optimized GPU service');
      }

      // Log performance metrics
      const perfMetrics = response.data.data.performance_metrics;
      if (perfMetrics) {
        logger.info(`[GPUService-OPTIMIZED] Performance: ${perfMetrics.candles_per_second?.toFixed(0)} candles/sec, GPU: ${perfMetrics.gpu_acceleration_used}`);
      }

      // Log GPU memory usage
      const memUsage = response.data.data.gpu_memory_usage;
      if (memUsage) {
        logger.info(`[GPUService-OPTIMIZED] GPU Memory: ${memUsage.peak_usage_mb?.toFixed(1)}MB peak usage`);
      }

      // Convert optimized result format
      const result = convertOptimizedGPUResult(response.data.data, runParams);
      
      logger.info(`[GPUService-OPTIMIZED] SUCCESS: ${result.metrics.totalTrades} trades, PnL: $${result.metrics.totalPnl?.toFixed(2)}, GPU: ${response.data.data.gpu_enabled}`);

      return result;

    } catch (error: any) {
      lastError = error;
      
      if (error.code === 'ECONNREFUSED') {
        logger.error(`[GPUService-OPTIMIZED] GPU service connection refused (attempt ${attempt}/2)`);
      } else if (error.response?.status === 413) {
        logger.error(`[GPUService-OPTIMIZED] Payload too large (attempt ${attempt}/2): ${error.message}`);
        break; // No retry for payload size issues
      } else {
        logger.error(`[GPUService-OPTIMIZED] Error (attempt ${attempt}/2): ${error.message}`);
      }

      // Wait before retry
      if (attempt < 2) {
        const waitTime = 2000; // 2 seconds
        logger.info(`[GPUService-OPTIMIZED] Waiting ${waitTime}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }

  // All attempts failed
  logger.error(`[GPUService-OPTIMIZED] All attempts failed. Last error: ${lastError?.message}`, {
    pairSymbol: runParams.pairSymbol,
    candlesCount: candles.length,
    error: lastError?.response?.data || lastError?.message
  });

  // НОВОЕ: Регистрация в диагностической системе
  try {
    await diagnosticManager.registerError({
      type: ErrorType.GPU_SERVICE_DOWN,
      testId: `gpu-${runParams.pairSymbol}`,
      testType: 'gpu',
      description: `GPU backtest failed after all retry attempts: ${lastError?.message}`,
      context: {
        pairSymbol: runParams.pairSymbol,
        candlesCount: candles.length,
        gpuServiceUrl: GPU_SERVICE_URL,
        maxRetries: 2,
        lastError: lastError?.message,
        responseStatus: lastError?.response?.status,
        responseData: lastError?.response?.data
      },
      stackTrace: lastError?.stack,
      metadata: {
        timestamp: new Date().toISOString(),
        source: 'gpuService',
        function: 'runOptimizedGPUBacktest',
        serviceUrl: GPU_SERVICE_URL
      }
    });
  } catch (diagnosticError) {
    logger.warn('[GPUService-OPTIMIZED] Failed to register diagnostic error:', diagnosticError);
  }

  throw new Error(`Optimized GPU backtest failed: ${lastError?.message}`);
};

/**
 * СТАНДАРТНАЯ версия: Выполняет бэктест с использованием GPU микросервиса
 * Включает сжатие данных, retry логику и улучшенную обработку ошибок
 */
export const runGPUBacktest = async (
  runParams: BacktestRunParameters,
  candles: CandleData[]
): Promise<BacktestResult> => {
  logger.info(`[GPUService] ==> runGPUBacktest function CALLED for ${runParams.pairSymbol}.`);
  logger.info(`[GPUService] Starting OPTIMIZED GPU backtest for ${runParams.pairSymbol} with ${candles.length} candles`);

  let lastError: any;

  // НОВОЕ: Retry логика для надежности
  for (let attempt = 1; attempt <= GPU_MAX_RETRIES; attempt++) {
    try {
      // Проверяем доступность GPU сервиса только на первой попытке
      if (attempt === 1) {
        const isHealthy = await checkGPUServiceHealth();
        if (!isHealthy) {
          throw new Error('GPU service is not available');
        }
      }

      // Преобразуем параметры стратегии
      const { strategy, parameters } = convertStrategyParameters(runParams.strategyParameters);
      logger.info(`[GPUService] Using GPU strategy: ${strategy} with parameters:`, parameters);

      // ОПТИМИЗАЦИЯ: Сжимаем данные свечей для более эффективной передачи
      const compressedCandles = compressCandleData(candles);
      const originalSize = JSON.stringify(candles).length;
      const compressedSize = JSON.stringify(compressedCandles).length;
      const compressionRatio = ((originalSize - compressedSize) / originalSize * 100).toFixed(1);
      
      logger.info(`[GPUService] Data compression: ${originalSize} -> ${compressedSize} bytes (${compressionRatio}% reduction)`);

      // Подготавливаем запрос для GPU API с сжатыми данными
      const gpuRequest: GPUBacktestRequest = {
        candles: compressedCandles,
        strategy,
        parameters,
        initial_capital: runParams.initialCapital,
        symbol: runParams.pairSymbol, // ИСПРАВЛЕНИЕ: Передаем символ для правильного отображения
        pairSymbol: runParams.pairSymbol, // Дублируем для совместимости с Python
        compressed: true // Флаг для GPU сервиса о сжатых данных
      };

      // ИСПРАВЛЕНИЕ: Детальное логирование запроса для диагностики
      logger.info(`[GPUService] GPU Request details:`, {
        symbol: gpuRequest.symbol,
        pairSymbol: gpuRequest.pairSymbol,
        strategy: gpuRequest.strategy,
        candlesCount: gpuRequest.candles.length,
        initialCapital: gpuRequest.initial_capital,
        parametersKeys: Object.keys(gpuRequest.parameters || {})
      });

      logger.debug(`[GPUService] Sending request to GPU service (attempt ${attempt}): ${candles.length} candles, strategy: ${strategy}`);

      // Отправляем запрос к GPU микросервису с увеличенным таймаутом
      const startTime = Date.now();
      const response = await axios.post<GPUBacktestResponse>(
        `${GPU_SERVICE_URL}/api/gpu/backtest`,
        gpuRequest,
        {
          timeout: GPU_SERVICE_TIMEOUT,
          headers: {
            'Content-Type': 'application/json',
            'Accept-Encoding': 'gzip, deflate', // Поддержка сжатия ответа
          },
          maxContentLength: 100 * 1024 * 1024, // 100MB
          maxBodyLength: 100 * 1024 * 1024     // 100MB
        }
      );

      const processingTime = Date.now() - startTime;
      logger.info(`[GPUService] GPU backtest completed in ${processingTime}ms (attempt ${attempt})`);

      // НОВОЕ: Детальное логирование ответа для диагностики
      logger.info(`[GPUService] Raw GPU response:`, {
        success: response.data.success,
        hasData: !!response.data.data,
        dataKeys: response.data.data ? Object.keys(response.data.data) : [],
        responseSize: JSON.stringify(response.data).length
      });

      // НОВОЕ: Временное логирование полного ответа для диагностики
      logger.info(`[GPUService] Full response data:`, JSON.stringify(response.data.data, null, 2));

      if (!response.data.success) {
        throw new Error(response.data.error || 'GPU backtest failed');
      }

      if (!response.data.data) {
        throw new Error('No data returned from GPU service');
      }

      // НОВОЕ: Логируем структуру данных
      if (response.data.data.backtest_results) {
        logger.info(`[GPUService] Backtest results found:`, {
          totalTrades: response.data.data.backtest_results.total_trades,
          totalProfit: response.data.data.backtest_results.total_profit,
          hasFinalBalance: 'final_balance' in response.data.data.backtest_results
        });
      } else {
        logger.warn(`[GPUService] No backtest_results in response data:`, response.data.data);
      }

      // Преобразуем результат
      const result = convertGPUResult(response.data.data, runParams);
      
      logger.info(`[GPUService] GPU backtest successful: ${result.metrics.totalTrades} trades, PnL: $${result.metrics.totalPnl?.toFixed(2)}`);

      return result;

    } catch (error: any) {
      lastError = error;
      
      if (error.code === 'ECONNREFUSED') {
        logger.error(`[GPUService] GPU service connection refused (attempt ${attempt}/${GPU_MAX_RETRIES})`);
      } else if (error.response?.status === 413) {
        logger.error(`[GPUService] Payload too large (attempt ${attempt}/${GPU_MAX_RETRIES}): ${error.message}`);
        // Для 413 ошибки не повторяем попытки - данные слишком большие
        break;
      } else if (error.response?.status >= 500) {
        logger.error(`[GPUService] GPU service error ${error.response.status} (attempt ${attempt}/${GPU_MAX_RETRIES}): ${error.message}`);
      } else {
        logger.error(`[GPUService] GPU backtest error (attempt ${attempt}/${GPU_MAX_RETRIES}): ${error.message}`);
      }

      // Ждем перед повторной попыткой (exponential backoff)
      if (attempt < GPU_MAX_RETRIES) {
        const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Max 5 секунд
        logger.info(`[GPUService] Waiting ${waitTime}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }

  // Если все попытки неудачны
  logger.error(`[GPUService] All ${GPU_MAX_RETRIES} attempts failed. Last error: ${lastError?.message}`, {
    pairSymbol: runParams.pairSymbol,
    candlesCount: candles.length,
    error: lastError?.response?.data || lastError?.message
  });

  // НОВОЕ: Регистрация в диагностической системе
  try {
    await diagnosticManager.registerError({
      type: ErrorType.GPU_SERVICE_DOWN,
      testId: `gpu-${runParams.pairSymbol}`,
      testType: 'gpu',
      description: `GPU backtest failed after all retry attempts: ${lastError?.message}`,
      context: {
        pairSymbol: runParams.pairSymbol,
        candlesCount: candles.length,
        gpuServiceUrl: GPU_SERVICE_URL,
        maxRetries: GPU_MAX_RETRIES,
        lastError: lastError?.message,
        responseStatus: lastError?.response?.status,
        responseData: lastError?.response?.data
      },
      stackTrace: lastError?.stack,
      metadata: {
        timestamp: new Date().toISOString(),
        source: 'gpuService',
        function: 'runGPUBacktest',
        serviceUrl: GPU_SERVICE_URL
      }
    });
  } catch (diagnosticError) {
    logger.warn('[GPUService] Failed to register diagnostic error:', diagnosticError);
  }

  throw new Error(`GPU backtest failed after ${GPU_MAX_RETRIES} attempts: ${lastError?.message}`);
};

/**
 * Режим валидации: отправляет предвычисленные сигналы и OHLCV/ATR (из CPU стратегии)
 * для точного воспроизведения сделок на стороне GPU и сравнения результатов.
 */
export const runGPUBacktestValidation = async (
  runParams: BacktestRunParameters,
  strategyCandles: StrategyCandle[]
): Promise<BacktestResult> => {
  logger.info(`[GPUService] Starting VALIDATION GPU backtest for ${runParams.pairSymbol} with ${strategyCandles.length} strategy candles`);

  // Формируем массивы сигналов и OHLCV
  const ohlcv = {
    timestamp: strategyCandles.map(c => Number(c.timestamp)),
    open: strategyCandles.map(c => c.open),
    high: strategyCandles.map(c => c.high),
    low: strategyCandles.map(c => c.low),
    close: strategyCandles.map(c => c.close),
    volume: strategyCandles.map(c => c.volume),
    atr: strategyCandles.map(c => (typeof c.atr === 'number' ? c.atr : 0))
  };
  const signals = {
    entry_condition_long: strategyCandles.map(c => !!c.entryConditionLong),
    entry_condition_short: strategyCandles.map(c => !!c.entryConditionShort),
    exit_condition_long: new Array(strategyCandles.length).fill(false),
    exit_condition_short: new Array(strategyCandles.length).fill(false)
  };

  // Передаем полные параметры стратегии, как и в обычном режиме
  const { strategy, parameters } = convertStrategyParameters(runParams.strategyParameters);

  const gpuRequest = {
    strategy,
    parameters: {
      ...parameters,
      // Прокидываем флаг выхода по противоположному сигналу на верхний уровень
      exitOnOppositeSignal: !!runParams.strategyParameters?.risk?.exitOnOppositeSignal
    },
    initial_capital: runParams.initialCapital,
    symbol: runParams.pairSymbol,
    pairSymbol: runParams.pairSymbol,
    // Валидация использует точные данные, без "compressed"
    ohlcv,
    signals
  };

  const startTime = Date.now();
  const response = await axios.post<GPUBacktestResponse>(
    `${GPU_SERVICE_URL}/api/gpu/backtest`,
    gpuRequest,
    {
      timeout: GPU_SERVICE_TIMEOUT,
      headers: { 'Content-Type': 'application/json' }
    }
  );
  logger.info(`[GPUService] VALIDATION GPU backtest completed in ${Date.now() - startTime}ms`);

  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error || 'GPU validation backtest failed');
  }

  return convertGPUResult(response.data.data, runParams);
};

/**
 * Проверяет, должен ли использоваться GPU для данного бэктеста
 * ОПТИМИЗАЦИЯ: Более интеллектуальная логика выбора
 */
export const shouldUseGPU = (runParams: BacktestRunParameters, candlesCount: number): boolean => {
  // Если GPU сервис отключен, всегда возвращаем false
  if (DISABLE_GPU_SERVICE) {
    logger.debug('[GPUService] GPU service disabled by environment variable');
    return false;
  }

  // НОВОЕ: Более гибкие критерии для GPU
  const MIN_CANDLES_FOR_GPU = 500;     // Снижен минимум
  const OPTIMAL_CANDLES_FOR_GPU = 1000; // Оптимальное количество
  const MAX_CANDLES_FOR_GPU = 20000;   // Максимум для одного запроса

  // Трейлинг-стоп теперь поддерживается в GPU-ядре
  // Раньше здесь была проверка на useTrailingStop, но теперь она не нужна

  const useGPU = !!(
    runParams.useGPU && 
    candlesCount >= MIN_CANDLES_FOR_GPU &&
    candlesCount <= MAX_CANDLES_FOR_GPU
  );

  if (useGPU && candlesCount >= OPTIMAL_CANDLES_FOR_GPU) {
    logger.info(`[GPUService] GPU recommended for ${runParams.pairSymbol}: ${candlesCount} candles (optimal)`);
  } else if (useGPU) {
    logger.info(`[GPUService] GPU acceptable for ${runParams.pairSymbol}: ${candlesCount} candles (minimal)`);
  }

  return useGPU;
};

/**
 * Получает статистику GPU сервиса
 */
export const getGPUStats = async (): Promise<any> => {
  // Если GPU сервис отключен, возвращаем null без попытки подключения
  if (DISABLE_GPU_SERVICE) {
    logger.debug('[GPUService] GPU service disabled, returning null stats');
    return null;
  }

  try {
    const response = await axios.get(`${GPU_SERVICE_URL}/api/gpu/stats`, {
      timeout: 5000
    });

    return response.data;
  } catch (error: any) {
    logger.warn(`[GPUService] Failed to get GPU stats: ${error.message}`);
    return null;
  }
};

export default {
  checkGPUServiceHealth,
  getGPUIndicators,
  runGPUBacktest,
  runOptimizedGPUBacktest,
  runGPUBacktestValidation,
  shouldUseGPU,
  getGPUStats
}; 