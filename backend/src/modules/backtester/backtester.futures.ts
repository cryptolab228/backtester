/**
 * Futures Integration for Backtester
 * 
 * Содержит логику интеграции фьючерсных модулей в бектестер
 */

import logger from '@/utils/logger';
import { 
  leverageManager,
  fundingManager,
  futuresPositionSizer,
  liquidationCalculator,
  type FuturesBacktestStats,
  type PositionDirection,
  type LiquidationData
} from '../futures';
import type { ExtendedStrategyParameters } from '../strategy_logic/profiles';
import type { Trade, TradeDirection } from './backtester.types';

/**
 * Контекст фьючерсного бектеста
 */
export interface FuturesBacktestContext {
  // Параметры фьючерсов
  leverage: number;
  
  // Статистика
  stats: FuturesBacktestStats;
  
  // Флаги
  isEnabled: boolean;
  trackFunding: boolean;
  trackLiquidation: boolean;
  
  // Последнее время funding
  lastFundingTime: number;
  
  // Активная позиция
  activePosition?: {
    entryPrice: number;
    direction: PositionDirection;
    size: number;
    liquidationPrice: number;
  };
}

/**
 * Инициализировать контекст фьючерсов
 */
export function initializeFuturesContext(
  params: ExtendedStrategyParameters
): FuturesBacktestContext | null {
  // Проверить, используются ли фьючерсы
  if (params.marketType !== 'futures' || !params.futures) {
    return null;
  }
  
  const leverage = params.futures.leverage?.value || 1;
  
  logger.info('[Futures] Initializing futures context', {
    leverage,
    fundingEnabled: params.futures.funding?.enabled,
    liquidationBufferPercent: params.futures.liquidation?.bufferPercent
  });
  
  return {
    leverage,
    stats: {
      averageLeverage: leverage,
      maxLeverage: leverage,
      liquidations: 0,
      fundingPaid: 0,
      fundingReceived: 0,
      netFunding: 0,
      effectiveROI: 0,
      capitalEfficiency: 0,
      averageDistanceToLiquidation: 0,
      minDistanceToLiquidation: Infinity,
      marginCallsAvoided: 0
    },
    isEnabled: true,
    trackFunding: params.futures.funding?.enabled || false,
    trackLiquidation: true,
    lastFundingTime: 0
  };
}

/**
 * Рассчитать размер позиции для фьючерсов
 */
export function calculateFuturesPositionSize(
  accountBalance: number,
  entryPrice: number,
  stopLoss: number,
  riskPercent: number,
  leverage: number,
  maxPositionPercent: number = 80
) {
  return futuresPositionSizer.calculatePositionSize(
    accountBalance,
    riskPercent,
    entryPrice,
    stopLoss,
    leverage,
    maxPositionPercent
  );
}

/**
 * Проверить ликвидацию позиции
 */
export function checkLiquidation(
  currentPrice: number,
  context: FuturesBacktestContext
): { liquidated: boolean; liquidationPrice: number } {
  if (!context.activePosition) {
    return { liquidated: false, liquidationPrice: 0 };
  }
  
  const { entryPrice, direction, liquidationPrice } = context.activePosition;
  
  const isLiquidated = liquidationCalculator.isLiquidated(
    currentPrice,
    liquidationPrice,
    direction
  );
  
  if (isLiquidated) {
    logger.warn('[Futures] LIQUIDATION occurred!', {
      currentPrice,
      liquidationPrice,
      direction,
      entryPrice
    });
    
    context.stats.liquidations++;
  }
  
  return { liquidated: isLiquidated, liquidationPrice };
}

/**
 * Рассчитать и применить funding rate
 */
export async function applyFundingRate(
  timestamp: number,
  context: FuturesBacktestContext,
  symbol: string,
  exchange: 'bybit' | 'okx'
): Promise<number> {
  if (!context.trackFunding || !context.activePosition) {
    return 0;
  }
  
  // Проверить, наступило ли время funding
  if (!fundingManager.isFundingTime(timestamp)) {
    return 0;
  }
  
  // Проверить, не применяли ли уже funding в это время
  const nextFundingTime = fundingManager.getNextFundingTime(context.lastFundingTime);
  if (timestamp < nextFundingTime - 60000) { // 1 минута буфер
    return 0;
  }
  
  try {
    // Получить funding rate
    const fundingData = await fundingManager.getCurrentFundingRate(symbol, exchange);
    
    // Рассчитать стоимость
    const cost = fundingManager.calculateFundingCost(
      context.activePosition.size,
      context.activePosition.entryPrice, // Используем entry price как текущий
      fundingData.rate,
      context.activePosition.direction
    );
    
    // Обновить статистику
    if (cost > 0) {
      context.stats.fundingPaid += cost;
    } else {
      context.stats.fundingReceived += Math.abs(cost);
    }
    context.stats.netFunding = context.stats.fundingReceived - context.stats.fundingPaid;
    
    // Обновить время последнего funding
    context.lastFundingTime = timestamp;
    
    logger.debug('[Futures] Funding rate applied', {
      timestamp: new Date(timestamp).toISOString(),
      rate: fundingData.rate,
      cost,
      direction: context.activePosition.direction
    });
    
    return cost;
  } catch (error) {
    logger.error('[Futures] Error applying funding rate', { error });
    return 0;
  }
}

/**
 * Открыть фьючерсную позицию
 */
export function openFuturesPosition(
  entryPrice: number,
  direction: TradeDirection,
  size: number,
  leverage: number,
  context: FuturesBacktestContext
): { requiredMargin: number; liquidationPrice: number } {
  // Конвертировать TradeDirection в PositionDirection
  const posDirection: PositionDirection = direction === TradeDirection.LONG ? 'long' : 'short';
  
  // Рассчитать цену ликвидации
  const liquidationPrice = leverageManager.calculateLiquidationPrice(
    entryPrice,
    leverage,
    posDirection
  );
  
  // Рассчитать требуемую маржу
  const notionalValue = size * entryPrice;
  const requiredMargin = notionalValue / leverage;
  
  // Сохранить данные позиции
  context.activePosition = {
    entryPrice,
    direction: posDirection,
    size,
    liquidationPrice
  };
  
  // Обновить статистику
  context.stats.averageLeverage = (context.stats.averageLeverage + leverage) / 2;
  context.stats.maxLeverage = Math.max(context.stats.maxLeverage, leverage);
  
  logger.debug('[Futures] Position opened', {
    entryPrice,
    direction: posDirection,
    size,
    leverage,
    liquidationPrice,
    requiredMargin
  });
  
  return { requiredMargin, liquidationPrice };
}

/**
 * Закрыть фьючерсную позицию
 */
export function closeFuturesPosition(
  exitPrice: number,
  context: FuturesBacktestContext
): { pnl: number; pnlWithLeverage: number } {
  if (!context.activePosition) {
    return { pnl: 0, pnlWithLeverage: 0 };
  }
  
  const { entryPrice, direction, size } = context.activePosition;
  
  // Рассчитать P&L
  let pnl: number;
  if (direction === 'long') {
    pnl = (exitPrice - entryPrice) * size;
  } else {
    pnl = (entryPrice - exitPrice) * size;
  }
  
  // P&L с учетом плеча (для статистики effectiveROI)
  const pnlWithLeverage = pnl * context.leverage;
  
  // Обновить расстояние до ликвидации (для закрытых позиций)
  const finalDistance = leverageManager.calculateDistanceToLiquidation(
    exitPrice,
    context.activePosition.liquidationPrice,
    direction
  );
  
  context.stats.averageDistanceToLiquidation = 
    (context.stats.averageDistanceToLiquidation + finalDistance) / 2;
  context.stats.minDistanceToLiquidation = 
    Math.min(context.stats.minDistanceToLiquidation, finalDistance);
  
  // Очистить активную позицию
  context.activePosition = undefined;
  
  logger.debug('[Futures] Position closed', {
    exitPrice,
    pnl,
    pnlWithLeverage,
    finalDistance
  });
  
  return { pnl, pnlWithLeverage };
}

/**
 * Обновить статистику расстояния до ликвидации на каждой свече
 */
export function updateLiquidationDistance(
  currentPrice: number,
  context: FuturesBacktestContext
): void {
  if (!context.activePosition) {
    return;
  }
  
  const distance = leverageManager.calculateDistanceToLiquidation(
    currentPrice,
    context.activePosition.liquidationPrice,
    context.activePosition.direction
  );
  
  context.stats.minDistanceToLiquidation = 
    Math.min(context.stats.minDistanceToLiquidation, distance);
  
  // Проверить риск
  const bufferPercent = 20; // Стандартный буфер
  if (distance < bufferPercent && distance > 10) {
    context.stats.marginCallsAvoided++;
    
    logger.warn('[Futures] Close to liquidation', {
      currentPrice,
      distance: distance.toFixed(2),
      liquidationPrice: context.activePosition.liquidationPrice
    });
  }
}

/**
 * Финализировать статистику фьючерсов
 */
export function finalizeFuturesStats(
  context: FuturesBacktestContext,
  totalPnl: number,
  initialCapital: number,
  totalMarginUsed: number
): FuturesBacktestStats {
  // Эффективный ROI с учетом плеча
  context.stats.effectiveROI = (totalPnl / initialCapital) * 100;
  
  // Capital efficiency (прибыль / использованная маржа)
  context.stats.capitalEfficiency = totalMarginUsed > 0 
    ? (totalPnl / totalMarginUsed) * 100 
    : 0;
  
  // Если minDistance остался Infinity, установить 0
  if (context.stats.minDistanceToLiquidation === Infinity) {
    context.stats.minDistanceToLiquidation = 0;
  }
  
  logger.info('[Futures] Final statistics', {
    liquidations: context.stats.liquidations,
    netFunding: context.stats.netFunding.toFixed(2),
    effectiveROI: context.stats.effectiveROI.toFixed(2),
    capitalEfficiency: context.stats.capitalEfficiency.toFixed(2),
    avgDistanceToLiquidation: context.stats.averageDistanceToLiquidation.toFixed(2),
    minDistanceToLiquidation: context.stats.minDistanceToLiquidation.toFixed(2)
  });
  
  return context.stats;
}




