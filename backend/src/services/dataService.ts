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
      logger.debug(`No candles provided to save for ${symbol} (${timeframe}).`);
      return;
    }

    logger.info(`Attempting to save ${candles.length} candles for ${symbol} (${timeframe})...`);

    try {
      // Находим ID пары по символу
      logger.debug(`[DataService] Looking up trading pair for symbol: ${symbol}`);
      const tradingPair = await this.pairRepository.findOne({ where: { symbol } });
      if (!tradingPair) {
        logger.error(`Trading pair with symbol ${symbol} not found. Cannot save candles.`);
        return;
      }
      logger.debug(`[DataService] Found trading pair ID ${tradingPair.id} for symbol ${symbol}`);

      // Подготавливаем данные для вставки
      logger.debug(`[DataService] Preparing ${candles.length} candle entities for ${symbol} (${timeframe})`);
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

      // Определяем размер чанка - уменьшаем для стабильности
      const chunkSize = 500; // Уменьшено с 1000 для стабильности
      const totalChunks = Math.ceil(candleEntities.length / chunkSize);
      logger.debug(`[DataService] Will process ${totalChunks} chunks of max ${chunkSize} candles each`);
      
      for (let i = 0; i < candleEntities.length; i += chunkSize) {
        const chunkIndex = i / chunkSize + 1;
        const chunk = candleEntities.slice(i, i + chunkSize);
        logger.debug(`[DataService] Processing chunk ${chunkIndex}/${totalChunks}: ${chunk.length} candles for ${symbol} (${timeframe})`);
        
        try {
          // Добавляем таймаут для предотвращения зависания
          const insertPromise = this.candleRepository
            .createQueryBuilder()
            .insert()
            .into(Candle)
            .values(chunk) // Вставляем чанк
            .onConflict(`("pair_id", "timestamp", "timeframe") DO NOTHING`) // Игнорировать при конфликте уникального индекса
            .execute();

          // Устанавливаем таймаут 30 секунд на операцию
          const result = await Promise.race([
            insertPromise,
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error(`Database insert timeout for chunk ${chunkIndex}`)), 30000)
            )
          ]);

          logger.debug(`[DataService] Successfully processed chunk ${chunkIndex}/${totalChunks} for ${symbol} (${timeframe})`);
        } catch (chunkError: any) {
          logger.error(`[DataService] Error processing chunk ${chunkIndex}/${totalChunks} for ${symbol} (${timeframe}): ${chunkError.message}`);
          // Не прерываем весь процесс из-за одного чанка, продолжаем с остальными
          continue;
        }
      }

      logger.info(`Successfully processed ${candles.length} candles for ${symbol} (${timeframe}). Duplicates (if any) were ignored.`);

    } catch (error: any) {
      logger.error(`Error saving candles for ${symbol} (${timeframe}): ${error.message}`, { 
        stack: error.stack,
        symbol,
        timeframe,
        candleCount: candles.length 
      });
      throw error; // Перебрасываем ошибку наверх для обработки в воркере
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

  /**
   * Получает торговую пару по символу.
   */
  async getTradingPairBySymbol(symbol: string): Promise<TradingPair | null> {
    logger.debug(`Fetching trading pair by symbol from DB: ${symbol}`);
    try {
      const pair = await this.pairRepository.findOne({ where: { symbol } });
      if (pair) {
        logger.debug(`Trading pair ${symbol} found in DB.`);
      } else {
        logger.debug(`Trading pair ${symbol} not found in DB.`);
      }
      return pair;
    } catch (error) {
      logger.error(`Error fetching trading pair ${symbol} from DB:`, error);
      return null;
    }
  }

   // Можно добавить другие методы, например, для получения последней свечи и т.д.
}

// Экспортируем инстанс сервиса для удобства использования
export const dataService = new DataService(); 