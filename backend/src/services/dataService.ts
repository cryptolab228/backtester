import { Repository, Between, MoreThanOrEqual, LessThanOrEqual } from 'typeorm';
import { AppDataSource } from '@/config/dataSource';
import { TradingPair } from '@/models/TradingPair';
import { Candle } from '@/models/Candle';
import { TradingPairInfo, CandleData } from './okxService';
import logger from '@/utils/logger';

export class DataService {
  private pairRepository: Repository<TradingPair>;
  private candleRepository: Repository<Candle>;
  // ОПТИМИЗАЦИЯ: Добавляем кэш для торговых пар
  private tradingPairCache = new Map<string, TradingPair | null>();

  constructor() {
    this.pairRepository = AppDataSource.getRepository(TradingPair);
    this.candleRepository = AppDataSource.getRepository(Candle);
  }

  /**
   * Сохраняет или обновляет список торговых пар.
   * Использует 'upsert' для добавления новых или обновления существующих по `symbol` и `exchange`.
   */
  async saveOrUpdateTradingPairs(pairs: TradingPairInfo[], exchange: string = 'okx'): Promise<void> {
    if (!pairs || pairs.length === 0) {
      logger.warn('No trading pairs provided to saveOrUpdateTradingPairs.');
      return;
    }

    logger.info(`Attempting to save/update ${pairs.length} trading pairs for ${exchange}...`);
    try {
      // Добавляем exchange ко всем парам
      const pairsWithExchange = pairs.map(pair => ({
        ...pair,
        exchange
      }));
      
      const result = await this.pairRepository.upsert(pairsWithExchange, ['symbol', 'exchange']);
      logger.info(`Successfully saved/updated trading pairs for ${exchange}. Upsert result: ${result.identifiers.length} affected.`);
    } catch (error) {
      logger.error(`Error saving/updating trading pairs for ${exchange}:`, error);
      // Можно добавить более специфическую обработку ошибок
    }
  }

  /**
   * Сохраняет исторические свечи для указанной пары и таймфрейма.
   * Использует 'insert' с опцией 'onConflict' для игнорирования дубликатов.
   * @param symbol - Символ пары (должен существовать в таблице trading_pairs)
   * @param timeframe - Таймфрейм свечей
   * @param candles - Массив данных свечей
   * @param exchange - Биржа (okx | bybit)
   */
  async saveCandles(symbol: string, timeframe: string, candles: CandleData[], exchange: string = 'okx'): Promise<void> {
    if (!candles || candles.length === 0) {
      logger.debug(`No candles provided to save for ${symbol} (${timeframe}) from ${exchange}.`);
      return;
    }

    logger.info(`Attempting to save ${candles.length} candles for ${symbol} (${timeframe}) from ${exchange}...`);

    try {
      // ОПТИМИЗАЦИЯ: Используем кэш для поиска торговой пары
      const cacheKey = `${symbol}_${exchange}`;
      let tradingPair = this.tradingPairCache.get(cacheKey);
      
      if (tradingPair === undefined) {
        logger.debug(`[DataService] Looking up trading pair for symbol: ${symbol} on ${exchange} (cache miss)`);
        tradingPair = await this.pairRepository.findOne({ 
          where: { symbol, exchange } 
        });
        this.tradingPairCache.set(cacheKey, tradingPair);
      } else {
        logger.debug(`[DataService] Using cached trading pair for symbol: ${symbol} on ${exchange}`);
      }
      
      if (!tradingPair) {
        logger.error(`Trading pair with symbol ${symbol} on ${exchange} not found. Cannot save candles.`);
        return;
      }
      logger.debug(`[DataService] Found trading pair ID ${tradingPair.id} for symbol ${symbol} on ${exchange}`);

      // Подготавливаем данные для вставки
      logger.debug(`[DataService] Preparing ${candles.length} candle entities for ${symbol} (${timeframe}) from ${exchange}`);
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

      // ОПТИМИЗАЦИЯ: Увеличиваем размер чанка для лучшей производительности
      const chunkSize = 1000; // Увеличено обратно до 1000 для скорости
      const totalChunks = Math.ceil(candleEntities.length / chunkSize);
      logger.debug(`[DataService] Will process ${totalChunks} chunks of max ${chunkSize} candles each`);
      
      for (let i = 0; i < candleEntities.length; i += chunkSize) {
        const chunkIndex = i / chunkSize + 1;
        const chunk = candleEntities.slice(i, i + chunkSize);
        logger.debug(`[DataService] Processing chunk ${chunkIndex}/${totalChunks}: ${chunk.length} candles for ${symbol} (${timeframe}) from ${exchange}`);
        
        try {
          // Добавляем таймаут для предотвращения зависания
          const insertPromise = this.candleRepository
            .createQueryBuilder()
            .insert()
            .into(Candle)
            .values(chunk) // Вставляем чанк
            .onConflict(`("trading_pair_id", "timestamp", "timeframe") DO UPDATE SET 
              open = EXCLUDED.open, 
              high = EXCLUDED.high,
              low = EXCLUDED.low,
              close = EXCLUDED.close,
              volume = EXCLUDED.volume,
              "volumeQuote" = EXCLUDED."volumeQuote"`) // Обновлять при конфликте уникального индекса
            .execute();

          // Устанавливаем таймаут 30 секунд на операцию
          const result = await Promise.race([
            insertPromise,
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error(`Database insert timeout for chunk ${chunkIndex}`)), 30000)
            )
          ]);
          
          // Логируем результат операции вставки с подробностями
          logger.info(`[DataService] INSERT RESULT for ${symbol} (${timeframe}) from ${exchange}, chunk ${chunkIndex}/${totalChunks}: ${JSON.stringify(result)}`);
          
          // Проверяем структуру ответа result и узнаем, сколько записей вставлено
          const insertResult = result as any;
          if (insertResult && insertResult.identifiers && insertResult.identifiers.length) {
            logger.info(`[DataService] INSERT SUCCESS: ${insertResult.identifiers.length} new records inserted for ${symbol} (${timeframe}) from ${exchange}, chunk ${chunkIndex}/${totalChunks}`);
          } else {
            logger.warn(`[DataService] INSERT WARNING: No new records inserted for ${symbol} (${timeframe}) from ${exchange}, chunk ${chunkIndex}/${totalChunks}. Все записи уже существуют или произошла ошибка.`);
          }

          // ОПТИМИЗАЦИЯ: Убираем избыточную проверку количества записей для ускорения
          // (эта проверка делается после каждого чанка и замедляет работу)
          
          logger.debug(`[DataService] Successfully processed chunk ${chunkIndex}/${totalChunks} for ${symbol} (${timeframe}) from ${exchange}`);
        } catch (chunkError: any) {
          logger.error(`[DataService] Error processing chunk ${chunkIndex}/${totalChunks} for ${symbol} (${timeframe}) from ${exchange}: ${chunkError.message}`);
          // Не прерываем весь процесс из-за одного чанка, продолжаем с остальными
          continue;
        }
      }

      // Логируем первую и последнюю свечу для отладки временного диапазона
      if (candles.length > 0) {
        const firstCandle = candles[0];
        const lastCandle = candles[candles.length - 1];
        logger.info(`Successfully processed ${candles.length} candles for ${symbol} (${timeframe}) from ${exchange}. Диапазон: ${new Date(firstCandle.timestamp)} - ${new Date(lastCandle.timestamp)}. Duplicates (if any) were ignored.`);
      } else {
        logger.info(`Successfully processed ${candles.length} candles for ${symbol} (${timeframe}) from ${exchange}. Duplicates (if any) were ignored.`);
      }

    } catch (error: any) {
      logger.error(`Error saving candles for ${symbol} (${timeframe}) from ${exchange}: ${error.message}`, { 
        stack: error.stack,
        symbol,
        timeframe,
        exchange,
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
        endTime?: number,
        exchange?: string
    ): Promise<Candle[]> {
        logger.info(`Fetching candles from DB for ${symbol} (${timeframe}) from ${exchange || 'any exchange'} between ${startTime ? new Date(startTime) : ''} and ${endTime ? new Date(endTime) : ''}`);

        // Строим условие поиска пары
        const whereCondition: any = { symbol };
        if (exchange) {
          whereCondition.exchange = exchange;
        }

        // Проверяем, существует ли торговая пара
        const tradingPair = await this.pairRepository.findOne({ where: whereCondition });
        if (!tradingPair) {
            logger.warn(`Trading pair ${symbol}${exchange ? ` on ${exchange}` : ''} not found in DB.`);
            
            // Дополнительная диагностика
            if (exchange) {
              // Проверим, существует ли эта пара для других бирж
              const anyExchangePair = await this.pairRepository.findOne({ 
                where: { symbol }
              });
              
              if (anyExchangePair) {
                logger.warn(`ВАЖНО: Пара ${symbol} найдена в БД для биржи ${anyExchangePair.exchange}, а запрос был для ${exchange}. Возможно, неверный параметр exchange!`);
              } else {
                logger.warn(`Пара ${symbol} не найдена ни для одной биржи в БД.`);
              }
            }
            
            return [];
        }
        
        // ОПТИМИЗАЦИЯ: Убираем предварительную проверку количества свечей
        // Эта проверка замедляет работу, а информация о количестве будет получена в основном запросе

        // ИСПРАВЛЕНО: Используем Repository.find() для применения ValueTransformers
        try {
            const whereConditions: any = {
                tradingPair: { id: tradingPair.id }, // Правильное имя связи
                timeframe: timeframe
            };

            // Добавляем временные условия (PostgreSQL синтаксис)
            if (startTime && endTime) {
                whereConditions.timestamp = Between(startTime, endTime);
            } else if (startTime) {
                whereConditions.timestamp = MoreThanOrEqual(startTime);
            } else if (endTime) {
                whereConditions.timestamp = LessThanOrEqual(endTime);
            }

            const candles = await this.candleRepository.find({
                where: whereConditions,
                order: {
                    timestamp: 'ASC'
                },
                relations: ['tradingPair'] // Правильное имя связи
            });

            // Добавляем подробное логирование результатов запроса с временным диапазоном
            if (candles.length > 0) {
                const firstTimestamp = Number(candles[0].timestamp);
                const lastTimestamp = Number(candles[candles.length - 1].timestamp);
                
                logger.info(`Fetched ${candles.length} candles from DB for ${symbol} (${timeframe}) from ${exchange || 'any exchange'}. Диапазон данных: ${new Date(firstTimestamp).toISOString()} - ${new Date(lastTimestamp).toISOString()}.`);
                
                // Проверяем, соответствует ли диапазон запрашиваемому
                if (startTime && firstTimestamp > startTime) {
                    logger.warn(`WARNING: First candle (${new Date(firstTimestamp).toISOString()}) is AFTER requested start time (${new Date(startTime).toISOString()}) for ${symbol}. Data may be incomplete!`);
                }
                
                if (endTime && lastTimestamp < endTime) {
                    logger.warn(`WARNING: Last candle (${new Date(lastTimestamp).toISOString()}) is BEFORE requested end time (${new Date(endTime).toISOString()}) for ${symbol}. Data may be incomplete!`);
                }
            } else {
                logger.info(`Fetched ${candles.length} candles from DB for ${symbol} (${timeframe}) from ${exchange || 'any exchange'}.`);
            }
            return candles;
        } catch (error) {
            logger.error(`Error fetching candles from DB for ${symbol} (${timeframe}) from ${exchange || 'any exchange'}:`, error);
            return [];
        }
    }

  /**
   * Получает все торговые пары из базы данных с возможностью фильтрации по бирже.
   */
  async getAllTradingPairs(exchange?: string): Promise<TradingPair[]> {
    logger.info(`Fetching all trading pairs from DB${exchange ? ` for ${exchange}` : ''}...`);
    try {
      const whereCondition = exchange ? { exchange } : {};
      
      const pairs = await this.pairRepository.find({
        where: whereCondition,
        order: {
          exchange: 'ASC',
          symbol: 'ASC' // Сортируем сначала по бирже, потом по символу
        }
      });
      logger.info(`Fetched ${pairs.length} trading pairs from DB${exchange ? ` for ${exchange}` : ''}.`);
      return pairs;
    } catch (error) {
      logger.error(`Error fetching all trading pairs from DB${exchange ? ` for ${exchange}` : ''}:`, error);
      return []; // Возвращаем пустой массив в случае ошибки
    }
  }

  /**
   * Получает исторические данные свечей в формате API.
   */
  async getHistoricalCandles(params: {
    symbol: string;
    timeframe: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
    exchange?: string;
  }): Promise<any[]> {
    const { symbol, timeframe, startTime, endTime, limit, exchange } = params;
    
    logger.info(`Fetching historical candles for ${symbol} (${timeframe}) from ${exchange || 'any exchange'}:`, {
      startTime: startTime ? new Date(startTime).toISOString() : 'not specified',
      endTime: endTime ? new Date(endTime).toISOString() : 'not specified',
      limit
    });

    try {
      const candles = await this.getCandles(symbol, timeframe, startTime, endTime, exchange);
      
      if (candles.length === 0) {
        logger.warn(`No candles found for ${symbol} (${timeframe}) from ${exchange || 'any exchange'}`);
        return [];
      }

      // ИСПРАВЛЕНО: Применяем лимит с учетом временного диапазона
      let limitedCandles: any[];

      if (limit && candles.length > limit) {
        // Если указаны временные рамки (startTime/endTime), приоритет отдаем данным в этом диапазоне
        if (startTime || endTime) {
          // Берем данные с начала диапазона (самые ранние)
          limitedCandles = candles.slice(0, limit);
          logger.info(`Applied limit ${limit} from start of time range for ${symbol} (${timeframe}). Showing earliest data.`);
        } else {
          // Если временной диапазон не указан, берем последние данные (как раньше)
          limitedCandles = candles.slice(-limit);
          logger.info(`Applied limit ${limit} from end (latest data) for ${symbol} (${timeframe}).`);
        }
      } else {
        limitedCandles = candles;
      }
      
      // Конвертируем в формат API
      const result = limitedCandles.map(candle => [
        candle.timestamp.toString(),
        candle.open.toString(),
        candle.high.toString(),
        candle.low.toString(),
        candle.close.toString(),
        candle.volume.toString(),
        candle.volumeQuote?.toString() || '0'
      ]);

      logger.info(`Returning ${result.length} historical candles for ${symbol} (${timeframe}) from ${exchange || 'any exchange'}`);
      return result;

    } catch (error: any) {
      logger.error(`Error fetching historical candles for ${symbol} (${timeframe}) from ${exchange || 'any exchange'}:`, error);
      return [];
    }
  }

  /**
   * Получает торговую пару по символу и (опционально) бирже.
   */
  async getTradingPairBySymbol(symbol: string, exchange?: string): Promise<TradingPair | null> {
    // Используем стандартный обменник, если не указан
    const targetExchange = exchange || 'bybit';
    
    // ОПТИМИЗАЦИЯ: Используем кэш для поиска торговой пары
    const cacheKey = `${symbol}_${targetExchange}`;
    let tradingPair = this.tradingPairCache.get(cacheKey);
    
    if (tradingPair !== undefined) {
      logger.debug(`Using cached trading pair for symbol: ${symbol} on ${targetExchange}`);
      return tradingPair;
    }
    
    logger.debug(`Looking up trading pair for symbol: ${symbol} on ${targetExchange} (cache miss)`);
    
    try {
      // Сначала ищем точное совпадение с указанным обменником
      const whereCondition = { symbol, exchange: targetExchange };
      
      tradingPair = await this.pairRepository.findOne({ where: whereCondition });
      
      // Кэшируем результат (может быть null)
      this.tradingPairCache.set(cacheKey, tradingPair);
      
      if (tradingPair) {
        logger.debug(`Found trading pair ID ${tradingPair.id} for symbol ${symbol} on ${targetExchange}`);
        return tradingPair;
      } else {
        logger.warn(`Trading pair ${symbol} on ${targetExchange} not found. Пара не существует в базе данных.`);
        
        // Проверяем, существует ли пара для других обменников - только для диагностики
        const anyExchangePair = await this.pairRepository.findOne({ where: { symbol } });
        if (anyExchangePair) {
          logger.warn(`ВНИМАНИЕ: Пара ${symbol} существует в БД для обменника ${anyExchangePair.exchange}, но не для ${targetExchange}! Возможно, неверно указан обменник при запросе.`);
        }
        
        return null;
      }
    } catch (error) {
      logger.error(`Error looking up trading pair ${symbol} on ${targetExchange}:`, error);
      // Кэшируем null для избежания повторных ошибочных запросов
      this.tradingPairCache.set(cacheKey, null);
      return null;
    }
  }
}

// Экспортируем инстанс сервиса для удобства использования
export const dataService = new DataService(); 