/**
 * Модули для работы с фьючерсной торговлей
 * 
 * Этот модуль предоставляет инструменты для:
 * - Управления кредитным плечом (leverage)
 * - Учета ставки финансирования (funding rate)
 * - Расчета размера позиций с учетом плеча
 * - Расчета и предотвращения ликвидации
 */

// Экспорт типов
export * from './types';

// Экспорт классов
export { LeverageManager, leverageManager } from './leverageManager';
export { FundingManager, fundingManager } from './fundingManager';
export { FuturesPositionSizer, futuresPositionSizer } from './positionSizer';
export { LiquidationCalculator, liquidationCalculator } from './liquidationCalculator';

// Удобный экспорт всех singleton instance
export const futuresModules = {
  leverageManager: require('./leverageManager').leverageManager,
  fundingManager: require('./fundingManager').fundingManager,
  positionSizer: require('./positionSizer').futuresPositionSizer,
  liquidationCalculator: require('./liquidationCalculator').liquidationCalculator
};

/**
 * Пример использования:
 * 
 * import { leverageManager, fundingManager, futuresPositionSizer } from '@/modules/futures';
 * 
 * // Рассчитать цену ликвидации
 * const liqPrice = leverageManager.calculateLiquidationPrice(50000, 10, 'long');
 * 
 * // Получить funding rate
 * const fundingRate = await fundingManager.getCurrentFundingRate('BTCUSDT', 'bybit');
 * 
 * // Рассчитать размер позиции
 * const position = futuresPositionSizer.calculatePositionSize(
 *   10000,  // balance
 *   2,      // risk %
 *   50000,  // entry
 *   48000,  // stop loss
 *   10      // leverage
 * );
 */




