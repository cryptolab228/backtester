/**
 * Модуль Walk-Forward Optimizer
 * ТЗ: Разработка модуля «Walk-Forward Optimizer»
 * 
 * Алгоритм:
 * 1. Делим историю на скользящие окна (12 мес обучение + 3 мес тест)
 * 2. На каждой итерации: оптимизируем на In-Sample, тестируем на Out-of-Sample
 * 3. Сдвигаем окно на 3 месяца и повторяем
 * 4. Генерируем Heatmap стабильности и склеенную OOS эквити
 */

import { v4 as uuidv4 } from 'uuid';
import logger from '@/utils/logger';
import { runPortfolioBacktest } from '@/modules/backtester/backtester';
import type { PortfolioBacktestRunParameters } from '@/modules/backtester/backtester.types';
import type { CandleData } from '@/interfaces/marketData.interface';
import {
  OptimizerConfig,
  OptimizationResult,
  OptimizationRunResult,
  OptimizationProgress,
  ParameterSet,
  ParameterDefinition,
  OptimizationConstraints,
  WalkForwardConfig,
  WFAIteration,
  WFAOptimizationResult,
  EquityPoint,
  HeatmapData,
  HeatmapCell,
  DEFAULT_CONSTRAINTS,
  DEFAULT_WALK_FORWARD,
  isParameterRange,
  isParameterValues
} from './optimizer.types';

/**
 * Генерирует все возможные значения для параметра
 */
function generateParameterValues(param: ParameterDefinition): (number | string)[] {
  if (isParameterValues(param)) {
    return param.values;
  }
  
  if (isParameterRange(param)) {
    const values: number[] = [];
    for (let v = param.min; v <= param.max; v += param.step) {
      values.push(Math.round(v * 1000) / 1000); // Округляем до 3 знаков
    }
    return values;
  }
  
  return [];
}

/**
 * Генерирует все комбинации параметров (Grid Search)
 */
export function generateParameterCombinations(config: OptimizerConfig): ParameterSet[] {
  const grid = config.parameterGrid;
  const combinations: ParameterSet[] = [];
  
  // Собираем все параметры и их возможные значения
  const paramNames: string[] = [];
  const paramValueArrays: (number | string)[][] = [];
  
  // Дефолтные значения для параметров
  const defaults: Record<string, number> = {
    risk_per_trade: 0.01,
    stop_loss_atr_multiplier: 1.5,
    take_profit_atr_multiplier: 3.0,
    min_reward_risk_ratio: 2.0,
    adx_period: 14,
    adx_trend_threshold: 25,
    adx_range_threshold: 20,
    nwe_multiplier: 2.5,
    nwe_period: 100,
    dlc_period: 48,
    cluster_volume_threshold: 1.5,
    cluster_delta_threshold: 0.3
  };
  
  for (const [key, paramDef] of Object.entries(grid)) {
    if (paramDef) {
      const values = generateParameterValues(paramDef);
      if (values.length > 0) {
        paramNames.push(key);
        paramValueArrays.push(values);
      }
    }
  }
  
  if (paramNames.length === 0) {
    // Если нет параметров для оптимизации, возвращаем дефолтный набор
    return [defaults as ParameterSet];
  }
  
  // Генерируем декартово произведение всех значений
  function cartesianProduct(arrays: (number | string)[][]): (number | string)[][] {
    return arrays.reduce<(number | string)[][]>(
      (acc, curr) => acc.flatMap(a => curr.map(c => [...a, c])),
      [[]]
    );
  }
  
  const allCombinations = cartesianProduct(paramValueArrays);
  
  // Ограничиваем количество комбинаций
  const maxCombinations = config.maxCombinations || 10000;
  const limitedCombinations = allCombinations.slice(0, maxCombinations);
  
  if (allCombinations.length > maxCombinations) {
    logger.warn(`[Optimizer] Too many combinations (${allCombinations.length}). Limited to ${maxCombinations}.`);
  }
  
  // Преобразуем в ParameterSet
  for (const combo of limitedCombinations) {
    const paramSet: ParameterSet = { ...defaults } as ParameterSet;
    
    for (let i = 0; i < paramNames.length; i++) {
      const value = combo[i];
      paramSet[paramNames[i]] = typeof value === 'number' ? value : parseFloat(value) || 0;
    }
    
    combinations.push(paramSet);
  }
  
  logger.info(`[Optimizer] Generated ${combinations.length} parameter combinations for grid search.`);
  return combinations;
}

/**
 * Проверяет результат на соответствие Hard Constraints (ТЗ 3.2)
 */
function validateResult(
  result: Partial<OptimizationRunResult>,
  constraints: OptimizationConstraints
): { isValid: boolean; reasons: string[] } {
  const reasons: string[] = [];
  
  if (result.maxDrawdownPercent !== undefined && result.maxDrawdownPercent > constraints.maxDrawdownLimit) {
    reasons.push(`Max Drawdown ${result.maxDrawdownPercent.toFixed(1)}% > ${constraints.maxDrawdownLimit}% limit`);
  }
  
  if (result.totalTrades !== undefined && result.totalTrades < constraints.minTradesCount) {
    reasons.push(`Trades count ${result.totalTrades} < ${constraints.minTradesCount} minimum`);
  }
  
  if (result.winRate !== undefined && result.winRate < constraints.minWinRate) {
    reasons.push(`Win Rate ${result.winRate.toFixed(1)}% < ${constraints.minWinRate}% minimum`);
  }
  
  return {
    isValid: reasons.length === 0,
    reasons
  };
}

/**
 * Конвертирует ParameterSet в параметры стратегии для бэктестера
 */
function parameterSetToStrategyParams(params: ParameterSet, baseParams?: Record<string, any>): Record<string, any> {
  return {
    ...baseParams,
    risk: {
      maxRiskPerTradePercentage: params.risk_per_trade,
      stopLossMultiplier: params.stop_loss_atr_multiplier,
      takeProfitMultiplier: params.take_profit_atr_multiplier,
      minRewardRiskRatio: params.min_reward_risk_ratio,
      useRegimeFilter: true,
      adxPeriod: params.adx_period,
      adxTrendThreshold: params.adx_trend_threshold,
      adxRangeThreshold: params.adx_range_threshold
    },
    nwe: {
      enabled: true,
      multiplier: params.nwe_multiplier,
      period: params.nwe_period
    },
    dlc: {
      period: params.dlc_period
    },
    cluster: {
      volumeThreshold: params.cluster_volume_threshold,
      deltaThreshold: params.cluster_delta_threshold
    }
  };
}

/**
 * Запускает один прогон бэктеста с заданными параметрами
 */
async function runSingleBacktest(
  params: ParameterSet,
  candlesData: Record<string, CandleData[]>,
  config: OptimizerConfig,
  startTimestamp: number,
  endTimestamp: number
): Promise<Partial<OptimizationRunResult>> {
  const startTime = Date.now();
  
  try {
    const strategyParams = parameterSetToStrategyParams(params, config.baseStrategyParameters);
    
    const backtestParams: PortfolioBacktestRunParameters = {
      pairSymbols: config.pairSymbols,
      timeframe: config.timeframe,
      startDate: new Date(startTimestamp).toISOString().split('T')[0],
      endDate: new Date(endTimestamp).toISOString().split('T')[0],
      strategyParameters: strategyParams,
      initialPortfolioCapital: 10000,
      exchange: config.exchange
    };
    
    const result = await runPortfolioBacktest(backtestParams, candlesData);
    const metrics = result.overallMetrics;
    
    const netProfit = metrics.totalPortfolioPnl;
    const netProfitPercent = metrics.totalPortfolioPnlPercentage;
    const maxDrawdown = metrics.portfolioMaxDrawdown || 0;
    const maxDrawdownPercent = metrics.portfolioMaxDrawdown || 0;
    
    // Рассчитываем целевые метрики (ТЗ 3.2)
    const calmarRatio = maxDrawdownPercent > 0 ? netProfitPercent / maxDrawdownPercent : 0;
    const recoveryFactor = maxDrawdown > 0 ? netProfit / maxDrawdown : 0;
    
    return {
      parameters: params,
      netProfit,
      netProfitPercent,
      maxDrawdown,
      maxDrawdownPercent,
      totalTrades: metrics.totalPortfolioTrades,
      winRate: metrics.portfolioWinRate,
      profitFactor: metrics.portfolioProfitFactor || 0,
      calmarRatio,
      recoveryFactor,
      executionTimeMs: Date.now() - startTime
    };
    
  } catch (error: any) {
    logger.error(`[Optimizer] Backtest failed for params:`, error.message);
    return {
      parameters: params,
      netProfit: 0,
      netProfitPercent: 0,
      maxDrawdown: 0,
      maxDrawdownPercent: 0,
      totalTrades: 0,
      winRate: 0,
      profitFactor: 0,
      calmarRatio: 0,
      recoveryFactor: 0,
      executionTimeMs: Date.now() - startTime
    };
  }
}

/**
 * Генерирует окна Walk-Forward Analysis (ТЗ 2.1 - Алгоритм скользящего окна)
 * 
 * Пример: trainWindowMonths=12, testWindowMonths=3, stepMonths=3
 * Итерация 1: Train (Янв 2023 - Дек 2023) -> Test (Янв 2024 - Март 2024)
 * Итерация 2: Train (Апр 2023 - Март 2024) -> Test (Апр 2024 - Июнь 2024)
 */
interface WFAWindow {
  iterationNumber: number;
  trainStart: Date;
  trainEnd: Date;
  testStart: Date;
  testEnd: Date;
}

function generateWFAWindows(
  dataStartDate: Date,
  dataEndDate: Date,
  trainWindowMonths: number,
  testWindowMonths: number,
  stepMonths: number
): WFAWindow[] {
  const windows: WFAWindow[] = [];
  let iterationNumber = 1;
  
  // Начинаем с первого окна
  let trainStart = new Date(dataStartDate);
  
  while (true) {
    // Конец обучения = начало + trainWindowMonths
    const trainEnd = new Date(trainStart);
    trainEnd.setMonth(trainEnd.getMonth() + trainWindowMonths);
    
    // Начало теста = конец обучения
    const testStart = new Date(trainEnd);
    
    // Конец теста = начало теста + testWindowMonths
    const testEnd = new Date(testStart);
    testEnd.setMonth(testEnd.getMonth() + testWindowMonths);
    
    // Если тестовый период выходит за пределы данных - останавливаемся
    if (testEnd > dataEndDate) {
      break;
    }
    
    windows.push({
      iterationNumber,
      trainStart: new Date(trainStart),
      trainEnd: new Date(trainEnd),
      testStart: new Date(testStart),
      testEnd: new Date(testEnd)
    });
    
    // Сдвигаем окно на stepMonths
    trainStart.setMonth(trainStart.getMonth() + stepMonths);
    iterationNumber++;
    
    // Защита от бесконечного цикла
    if (iterationNumber > 100) break;
  }
  
  return windows;
}

/**
 * Фильтрует свечи по временному диапазону
 */
function filterCandlesByDateRange(
  candlesData: Record<string, CandleData[]>,
  startDate: Date,
  endDate: Date
): Record<string, CandleData[]> {
  const filtered: Record<string, CandleData[]> = {};
  const startTs = startDate.getTime();
  const endTs = endDate.getTime();
  
  for (const [symbol, candles] of Object.entries(candlesData)) {
    filtered[symbol] = candles.filter(c => c.timestamp >= startTs && c.timestamp < endTs);
  }
  
  return filtered;
}

/**
 * Основная функция Walk-Forward оптимизации (ТЗ 2.1)
 * 
 * Алгоритм:
 * 1. Генерируем скользящие окна (12 мес обучение + 3 мес тест)
 * 2. Для каждого окна: оптимизируем на In-Sample, тестируем лучшие на Out-of-Sample
 * 3. Собираем склеенную OOS эквити и Heatmap стабильности
 */
export async function runOptimization(
  config: OptimizerConfig,
  candlesData: Record<string, CandleData[]>,
  onProgress?: (progress: OptimizationProgress) => void
): Promise<WFAOptimizationResult> {
  const jobId = uuidv4();
  const startTime = Date.now();
  const errors: string[] = [];
  
  logger.info(`[WFA Optimizer] Starting job ${jobId}`);
  logger.info(`[WFA Optimizer] Config: ${config.pairSymbols.length} pairs, ${config.timeframe} timeframe`);
  
  // Применяем дефолты
  const constraints = { ...DEFAULT_CONSTRAINTS, ...config.constraints };
  const walkForward = { ...DEFAULT_WALK_FORWARD, ...config.walkForward };
  
  // Генерируем все комбинации параметров
  const combinations = generateParameterCombinations(config);
  const totalCombinations = combinations.length;
  
  logger.info(`[WFA Optimizer] Total parameter combinations: ${totalCombinations}`);
  
  // Определяем временные границы данных
  const allTimestamps = Object.values(candlesData)
    .flat()
    .map(c => c.timestamp)
    .filter(t => t > 0);
  
  const dataStartDate = new Date(Math.min(...allTimestamps));
  const dataEndDate = new Date(Math.max(...allTimestamps));
  
  logger.info(`[WFA Optimizer] Data range: ${dataStartDate.toISOString().split('T')[0]} - ${dataEndDate.toISOString().split('T')[0]}`);
  
  // Генерируем WFA окна
  const wfaWindows = walkForward.enabled 
    ? generateWFAWindows(
        dataStartDate,
        dataEndDate,
        walkForward.trainWindowMonths,
        walkForward.testWindowMonths,
        walkForward.stepMonths
      )
    : [];
  
  logger.info(`[WFA Optimizer] Generated ${wfaWindows.length} Walk-Forward windows`);
  
  const allResults: OptimizationRunResult[] = [];
  const wfaIterations: WFAIteration[] = [];
  const walkForwardEquity: EquityPoint[] = [];
  let completedCount = 0;
  let bestResult: OptimizationRunResult | undefined;
  
  // Если WFA включен - запускаем по окнам
  if (walkForward.enabled && wfaWindows.length > 0) {
    for (const window of wfaWindows) {
      logger.info(`[WFA] Iteration ${window.iterationNumber}: Train ${window.trainStart.toISOString().split('T')[0]} - ${window.trainEnd.toISOString().split('T')[0]}, Test ${window.testStart.toISOString().split('T')[0]} - ${window.testEnd.toISOString().split('T')[0]}`);
      
      // Фильтруем данные для In-Sample периода
      const trainData = filterCandlesByDateRange(candlesData, window.trainStart, window.trainEnd);
      const testData = filterCandlesByDateRange(candlesData, window.testStart, window.testEnd);
      
      // Оптимизируем на In-Sample
      let bestInSampleResult: Partial<OptimizationRunResult> | undefined;
      let bestInSampleParams: ParameterSet | undefined;
      
      for (const params of combinations) {
        // Отправляем прогресс
        if (onProgress) {
          onProgress({
            jobId,
            status: 'running',
            totalCombinations: totalCombinations * wfaWindows.length,
            completedCombinations: completedCount,
            progressPercent: Math.round((completedCount / (totalCombinations * wfaWindows.length)) * 100),
            currentParameters: params,
            startTime,
            elapsedTime: Date.now() - startTime,
            bestResultSoFar: bestResult,
            errors
          });
        }
        
        try {
          const result = await runSingleBacktest(
            params,
            trainData,
            config,
            window.trainStart.getTime(),
            window.trainEnd.getTime()
          );
          
          // Валидация по Hard Constraints (ТЗ 3)
          const validation = validateResult(result, constraints);
          
          if (validation.isValid) {
            const calmar = result.calmarRatio || 0;
            if (!bestInSampleResult || calmar > (bestInSampleResult.calmarRatio || 0)) {
              bestInSampleResult = result;
              bestInSampleParams = params;
            }
          }
          
        } catch (error: any) {
          errors.push(`Window ${window.iterationNumber}, Combo: ${error.message}`);
        }
        
        completedCount++;
      }
      
      // Тестируем лучшие параметры на Out-of-Sample
      if (bestInSampleParams && bestInSampleResult) {
        try {
          const oosResult = await runSingleBacktest(
            bestInSampleParams,
            testData,
            config,
            window.testStart.getTime(),
            window.testEnd.getTime()
          );
          
          // Рассчитываем падение производительности (Calmar)
          const isCalmar = bestInSampleResult.calmarRatio || 0;
          const oosCalmar = oosResult.calmarRatio || 0;
          const performanceDrop = isCalmar > 0 
            ? ((isCalmar - oosCalmar) / isCalmar) * 100 
            : 0;
          
          const isStable = performanceDrop <= constraints.maxOosPerformanceDrop;
          
          // Сохраняем итерацию WFA
          const wfaIteration: WFAIteration = {
            iterationNumber: window.iterationNumber,
            trainStart: window.trainStart.toISOString().split('T')[0],
            trainEnd: window.trainEnd.toISOString().split('T')[0],
            testStart: window.testStart.toISOString().split('T')[0],
            testEnd: window.testEnd.toISOString().split('T')[0],
            bestParameters: bestInSampleParams,
            inSampleMetrics: {
              netProfitPercent: bestInSampleResult.netProfitPercent || 0,
              maxDrawdownPercent: bestInSampleResult.maxDrawdownPercent || 0,
              calmarRatio: bestInSampleResult.calmarRatio || 0,
              winRate: bestInSampleResult.winRate || 0,
              totalTrades: bestInSampleResult.totalTrades || 0,
              profitFactor: bestInSampleResult.profitFactor || 0
            },
            outOfSampleMetrics: {
              netProfitPercent: oosResult.netProfitPercent || 0,
              maxDrawdownPercent: oosResult.maxDrawdownPercent || 0,
              calmarRatio: oosResult.calmarRatio || 0,
              winRate: oosResult.winRate || 0,
              totalTrades: oosResult.totalTrades || 0,
              profitFactor: oosResult.profitFactor || 0
            },
            performanceDrop,
            isStable
          };
          
          wfaIterations.push(wfaIteration);
          
          // Добавляем точку в OOS эквити (ТЗ 4.Б)
          walkForwardEquity.push({
            timestamp: window.testEnd.getTime(),
            date: window.testEnd.toISOString().split('T')[0],
            equity: 10000 * (1 + (oosResult.netProfitPercent || 0) / 100),
            equityPercent: oosResult.netProfitPercent || 0,
            drawdown: oosResult.maxDrawdown || 0,
            drawdownPercent: oosResult.maxDrawdownPercent || 0,
            isOutOfSample: true,
            iterationNumber: window.iterationNumber
          });
          
          // Сохраняем полный результат
          const fullResult: OptimizationRunResult = {
            id: uuidv4(),
            parameters: bestInSampleParams,
            netProfit: oosResult.netProfit || 0,
            netProfitPercent: oosResult.netProfitPercent || 0,
            maxDrawdown: oosResult.maxDrawdown || 0,
            maxDrawdownPercent: oosResult.maxDrawdownPercent || 0,
            totalTrades: oosResult.totalTrades || 0,
            winRate: oosResult.winRate || 0,
            profitFactor: oosResult.profitFactor || 0,
            calmarRatio: oosResult.calmarRatio || 0,
            recoveryFactor: oosResult.recoveryFactor || 0,
            inSampleResult: {
              netProfitPercent: bestInSampleResult.netProfitPercent || 0,
              maxDrawdownPercent: bestInSampleResult.maxDrawdownPercent || 0,
              winRate: bestInSampleResult.winRate || 0
            },
            outOfSampleResult: {
              netProfitPercent: oosResult.netProfitPercent || 0,
              maxDrawdownPercent: oosResult.maxDrawdownPercent || 0,
              winRate: oosResult.winRate || 0
            },
            oosPerformanceDrop: performanceDrop,
            oosStatus: isStable ? 'passed' : 'failed',
            isValid: isStable,
            invalidReasons: isStable ? [] : [`OOS performance drop ${performanceDrop.toFixed(1)}% > ${constraints.maxOosPerformanceDrop}%`],
            executionTimeMs: (oosResult.executionTimeMs || 0) + (bestInSampleResult.executionTimeMs || 0)
          };
          
          allResults.push(fullResult);
          
          if (fullResult.isValid && (!bestResult || fullResult.calmarRatio > bestResult.calmarRatio)) {
            bestResult = fullResult;
          }
          
          logger.info(`[WFA] Iteration ${window.iterationNumber}: IS Calmar=${isCalmar.toFixed(2)}, OOS Calmar=${oosCalmar.toFixed(2)}, Drop=${performanceDrop.toFixed(1)}%, Stable=${isStable}`);
          
        } catch (error: any) {
          errors.push(`Window ${window.iterationNumber} OOS test: ${error.message}`);
        }
      }
    }
  } else {
    // Простой режим без WFA - оптимизация на всех данных
    for (const params of combinations) {
      if (onProgress) {
        onProgress({
          jobId,
          status: 'running',
          totalCombinations,
          completedCombinations: completedCount,
          progressPercent: Math.round((completedCount / totalCombinations) * 100),
          currentParameters: params,
          startTime,
          elapsedTime: Date.now() - startTime,
          bestResultSoFar: bestResult,
          errors
        });
      }
      
      try {
        const result = await runSingleBacktest(
          params,
          candlesData,
          config,
          dataStartDate.getTime(),
          dataEndDate.getTime()
        );
        
        const validation = validateResult(result, constraints);
        
        const fullResult: OptimizationRunResult = {
          id: uuidv4(),
          parameters: params,
          netProfit: result.netProfit || 0,
          netProfitPercent: result.netProfitPercent || 0,
          maxDrawdown: result.maxDrawdown || 0,
          maxDrawdownPercent: result.maxDrawdownPercent || 0,
          totalTrades: result.totalTrades || 0,
          winRate: result.winRate || 0,
          profitFactor: result.profitFactor || 0,
          calmarRatio: result.calmarRatio || 0,
          recoveryFactor: result.recoveryFactor || 0,
          oosStatus: 'not_tested',
          isValid: validation.isValid,
          invalidReasons: validation.reasons,
          executionTimeMs: result.executionTimeMs || 0
        };
        
        allResults.push(fullResult);
        
        if (fullResult.isValid && (!bestResult || fullResult.calmarRatio > bestResult.calmarRatio)) {
          bestResult = fullResult;
        }
        
      } catch (error: any) {
        errors.push(`Combination ${completedCount + 1}: ${error.message}`);
      }
      
      completedCount++;
    }
  }
  
  // Сортируем результаты по Calmar Ratio
  const sortedResults = [...allResults]
    .filter(r => r.isValid)
    .sort((a, b) => b.calmarRatio - a.calmarRatio);
  
  const topResults = sortedResults.slice(0, 20);
  
  // Рассчитываем WFA Summary (ТЗ 4)
  const stableIterations = wfaIterations.filter(i => i.isStable).length;
  const wfaSummary = {
    totalIterations: wfaIterations.length,
    stableIterations,
    stabilityRatio: wfaIterations.length > 0 ? stableIterations / wfaIterations.length : 0,
    averageOosCalmar: wfaIterations.length > 0 
      ? wfaIterations.reduce((sum, i) => sum + i.outOfSampleMetrics.calmarRatio, 0) / wfaIterations.length 
      : 0,
    averageOosProfit: wfaIterations.length > 0 
      ? wfaIterations.reduce((sum, i) => sum + i.outOfSampleMetrics.netProfitPercent, 0) / wfaIterations.length 
      : 0,
    averageOosDrawdown: wfaIterations.length > 0 
      ? wfaIterations.reduce((sum, i) => sum + i.outOfSampleMetrics.maxDrawdownPercent, 0) / wfaIterations.length 
      : 0,
    combinedOosProfit: walkForwardEquity.reduce((sum, e) => sum + e.equityPercent, 0),
    combinedOosMaxDrawdown: Math.max(...walkForwardEquity.map(e => e.drawdownPercent), 0),
    recommendedParameters: bestResult?.parameters || combinations[0]
  };
  
  const endTime = Date.now();
  
  logger.info(`[WFA Optimizer] Completed. Stable iterations: ${stableIterations}/${wfaIterations.length}, Best Calmar: ${bestResult?.calmarRatio.toFixed(2) || 'N/A'}`);
  
  return {
    jobId,
    config,
    status: 'completed',
    allResults,
    topResults,
    bestResult,
    totalCombinations,
    validCombinations: sortedResults.length,
    invalidCombinations: allResults.length - sortedResults.length,
    startTime,
    endTime,
    totalExecutionTimeMs: endTime - startTime,
    errors,
    wfaIterations,
    walkForwardEquity,
    wfaSummary
  };
}

/**
 * Получает значение целевой функции для сортировки
 */
function getObjectiveValue(result: OptimizationRunResult, objective: string): number {
  switch (objective) {
    case 'calmar_ratio':
      return result.calmarRatio;
    case 'recovery_factor':
      return result.recoveryFactor;
    case 'profit_factor':
      return result.profitFactor;
    case 'sharpe_ratio':
      return result.sharpeRatio || 0;
    default:
      return result.calmarRatio;
  }
}

/**
 * Экспортирует результаты в CSV формат (ТЗ 4)
 */
export function exportResultsToCSV(result: OptimizationResult): string {
  const headers = [
    'Rank',
    'ADX Trend',
    'ADX Range',
    'NWE Mult',
    'SL ATR',
    'TP ATR',
    'Net Profit %',
    'Max DD %',
    'Profit Factor',
    'Win Rate %',
    'Trades',
    'Calmar Ratio',
    'OOS Status'
  ];
  
  const rows = result.topResults.map((r, index) => [
    index + 1,
    r.parameters.adx_trend_threshold,
    r.parameters.adx_range_threshold,
    r.parameters.nwe_multiplier,
    r.parameters.stop_loss_atr_multiplier,
    r.parameters.take_profit_atr_multiplier,
    r.netProfitPercent.toFixed(2),
    r.maxDrawdownPercent.toFixed(2),
    r.profitFactor.toFixed(2),
    r.winRate.toFixed(1),
    r.totalTrades,
    r.calmarRatio.toFixed(2),
    r.oosStatus === 'passed' ? '✅ Passed' : r.oosStatus === 'failed' ? '❌ Failed' : '⏸ Not Tested'
  ]);
  
  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}
