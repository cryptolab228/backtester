import { Repository } from 'typeorm';
import { AppDataSource } from '@/config/dataSource';
import { TradingPair } from '@/models/TradingPair';
import { Candle } from '@/models/Candle';
import { TradingPairInfo, CandleData } from './okxService';
import logger from '@/utils/logger';

export class DataService {
  private pairRepository: Repository<TradingPair>;
  private candleRepository: Repository<Candle>;

  constructor() {
    this.pairRepository = AppDataSource.getRepository(TradingPair);
    this.candleRepository = AppDataSource.getRepository(Candle);
  }

  /**
   * Сохраняет или обновляет список торговых пар.
   * Использует 'upsert' для добавления новых или обновления существующих по `symbol`.
   */
  async saveOrUpdateTradingPairs(pairs: TradingPairInfo[]): Promise<void> {
    if (!pairs || pairs.length === 0) {
      logger.warn('No trading pairs provided to saveOrUpdateTradingPairs.');
      return;
    }

    logger.info(`Attempting to save/update ${pairs.length} trading pairs...`);
    try {
      const result = await this.pairRepository.upsert(pairs, ['symbol']);
      logger.info(`Successfully saved/updated trading pairs. Upsert result: ${result.identifiers.length} affected.`);
    } catch (error) {
      logger.error('Error saving/updating trading pairs:', error);
      // Можно добавить более специфическую обработку ошибок
    }
  }

  /**
   * Сохраняет исторические свечи для указанной пары и таймфрейма.
   * Использует 'insert' с опцией 'onConflict' для игнорирования дубликатов.
   * @param symbol - Символ пары (должен существовать в таблице trading_pairs)
   * @param timeframe - Таймфрейм свечей
   * @param candles - Массив данных свечей
   */
  async saveCandles(symbol: string, timeframe: string, candles: CandleData[]): Promise<void> {
    if (!candles || candles.length === 0) {
      // logger.debug(`No candles provided to save for ${symbol} (${timeframe}).`);
      return;
    }

    logger.info(`Attempting to save ${candles.length} candles for ${symbol} (${timeframe})...`);

    try {
      // Находим ID пары по символу
      const tradingPair = await this.pairRepository.findOne({ where: { symbol } });
      if (!tradingPair) {
        logger.error(`Trading pair with symbol ${symbol} not found. Cannot save candles.`);
        return;
      }

      // Подготавливаем данные для вставки
      const candleEntities = candles.map(c => ({
        tradingPair: tradingPair, // Связываем с найденной парой
        timestamp: c.timestamp,
        timeframe: timeframe,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
        volumeQuote: c.volumeQuote,
      }));

      // Используем insert и onConflict для игнорирования дубликатов
      // Это эффективнее для больших объемов данных, чем upsert или find/save
      await this.candleRepository
        .createQueryBuilder()
        .insert()
        .into(Candle)
        .values(candleEntities)
        .onConflict(`("pair_id", "timestamp", "timeframe") DO NOTHING`) // Игнорировать при конфликте уникального индекса
        .execute();

      logger.info(`Successfully processed ${candles.length} candles for ${symbol} (${timeframe}). Duplicates (if any) were ignored.`);

    } catch (error) {
      logger.error(`Error saving candles for ${symbol} (${timeframe}):`, error);
    }
  }

   /**
   * Получает свечи из базы данных.
   */
  async getCandles(
        symbol: string,
        timeframe: string,
        startTime?: number,
        endTime?: number
    ): Promise<Candle[]> {
        logger.info(`Fetching candles from DB for ${symbol} (${timeframe}) between ${startTime ? new Date(startTime) : ''} and ${endTime ? new Date(endTime) : ''}`);

        const tradingPair = await this.pairRepository.findOne({ where: { symbol } });
        if (!tradingPair) {
            logger.warn(`Trading pair ${symbol} not found in DB.`);
            return [];
        }

        const query = this.candleRepository.createQueryBuilder('candle')
            .where('candle.pair_id = :pairId', { pairId: tradingPair.id })
            .andWhere('candle.timeframe = :timeframe', { timeframe });

        if (startTime) {
            query.andWhere('candle.timestamp >= :startTime', { startTime });
        }
        if (endTime) {
            query.andWhere('candle.timestamp <= :endTime', { endTime });
        }

        query.orderBy('candle.timestamp', 'ASC'); // Сортируем по времени

        try {
            const candles = await query.getMany();
            logger.info(`Fetched ${candles.length} candles from DB for ${symbol} (${timeframe}).`);
            return candles;
        } catch (error) {
            logger.error(`Error fetching candles from DB for ${symbol} (${timeframe}):`, error);
            return [];
        }
    }

  /**
   * Получает все торговые пары из базы данных.
   */
  async getAllTradingPairs(): Promise<TradingPair[]> {
    logger.info('Fetching all trading pairs from DB...');
    try {
      const pairs = await this.pairRepository.find({
        order: {
          symbol: 'ASC' // Сортируем по символу для единообразия
        }
      });
      logger.info(`Fetched ${pairs.length} trading pairs from DB.`);
      return pairs;
    } catch (error) {
      logger.error('Error fetching all trading pairs from DB:', error);
      return []; // Возвращаем пустой массив в случае ошибки
    }
  }

   // Можно добавить другие методы, например, для получения последней свечи и т.д.
}

// Экспортируем инстанс сервиса для удобства использования
export const dataService = new DataService(); 