import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Candle } from '../models/Candle';
import { TradingPair } from '../models/TradingPair';
import { AppDataSource } from '../config/dataSource';
import { applyStrategyLogic } from '../modules/strategy_logic/strategy';
import { CandleData } from '../interfaces/marketData.interface';
import { DefaultStrategyParameters } from '../modules/strategy_logic/strategy';
import { StrategyParameters, StrategyCandle } from '../modules/backtester/backtester.types';
import { 
  calculateATR, 
  calculateVolumeProfile, 
  calculateNWE, 
  calculateAvgVolume, 
  calculateApproxDelta 
} from '../modules/strategy_logic/indicators';


// --- Параметры для верификации ---
const VERIFICATION_PARAMS = {
  pairSymbol: 'BTCUSDT',
  timeframe: '1h',
  startDate: '2024-05-01T00:00:00.000Z',
  endDate: '2024-05-03T23:59:59.000Z',
};
// ----------------------------------

/**
 * Основная функция для верификации логики стратегии
 */
async function verifyStrategy() {
  console.log('--- Запуск верификационного скрипта ---');

  try {
    // 1. Инициализация подключения к БД
    await AppDataSource.initialize();
    console.log('Успешное подключение к базе данных.');

    const candleRepo = AppDataSource.getRepository(Candle);
    const pairRepo = AppDataSource.getRepository(TradingPair);

    // 2. Поиск торговой пары
    const tradingPair = await pairRepo.findOne({ where: { symbol: VERIFICATION_PARAMS.pairSymbol } });
    if (!tradingPair) {
      throw new Error(`Торговая пара ${VERIFICATION_PARAMS.pairSymbol} не найдена в базе данных.`);
    }
    console.log(`Найдена торговая пара: ${tradingPair.symbol} (ID: ${tradingPair.id})`);

    // 3. Загрузка "сырых" свечей из БД
    const startDate = new Date(VERIFICATION_PARAMS.startDate).getTime();
    const endDate = new Date(VERIFICATION_PARAMS.endDate).getTime();

    const rawCandles = await candleRepo
      .createQueryBuilder('candle')
      .where('candle.trading_pair_id = :pairId', { pairId: tradingPair.id })
      .andWhere('candle.timeframe = :timeframe', { timeframe: VERIFICATION_PARAMS.timeframe })
      .andWhere('candle.timestamp >= :startDate', { startDate })
      .andWhere('candle.timestamp <= :endDate', { endDate })
      .orderBy('candle.timestamp', 'ASC')
      .getMany();

    if (rawCandles.length === 0) {
      throw new Error('Не найдено ни одной свечи для указанного диапазона.');
    }

    console.log(`Загружено ${rawCandles.length} "сырых" свечей из БД.`);

    // Преобразование данных для функции стратегии
    const candleDataForStrategy: CandleData[] = rawCandles.map((c: Candle) => ({
      timestamp: Number(c.timestamp),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));
    
    // 4. Детальный пошаговый анализ (ПОКА ЗАГЛУШКА)
    await detailedStepByStepAnalysis(candleDataForStrategy, DefaultStrategyParameters);


    // 5. Завершение работы
    await AppDataSource.destroy();
    console.log('Соединение с базой данных закрыто.');

  } catch (error) {
    console.error('Ошибка во время выполнения скрипта:', error);
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
    process.exit(1);
  }

  console.log('--- Верификационный скрипт завершил работу ---');
}

/**
 * Функция для детального анализа и логирования расчетов
 * @param candles - Массив свечей для анализа
 * @param params - Параметры стратегии
 */
async function detailedStepByStepAnalysis(candles: CandleData[], params: StrategyParameters) {
    console.log('\n--- Начало детального пошагового анализа ---');
    console.log(`Будет проанализировано ${candles.length} свечей.`);
    console.log('Параметры стратегии для теста:', JSON.stringify(params, null, 2));

    // Проверки на undefined, чтобы TypeScript был уверен в наличии параметров
    if (!params.risk || !params.nwe || !params.dlc || !params.clusters) {
        throw new Error('Один из ключевых наборов параметров (risk, nwe, dlc, clusters) отсутствует.');
    }
    // Дополнительная проверка для atrPeriod, который используется в нескольких местах
    if (typeof params.risk.atrPeriod !== 'number') {
        throw new Error('params.risk.atrPeriod должен быть числом.');
    }
    
    // Пройдемся по каждой свече, симулируя нарастающий итог
    for (let i = 0; i < candles.length; i++) {
        const currentCandle = candles[i];
        const historicalCandles = candles.slice(0, i + 1);
        
        console.log(`\n----------------------------------------------------`);
        console.log(`[Свеча #${i+1}] Timestamp: ${new Date(currentCandle.timestamp).toISOString()}`);
        console.log(`  O: ${currentCandle.open}, H: ${currentCandle.high}, L: ${currentCandle.low}, C: ${currentCandle.close}, V: ${currentCandle.volume}`);
        console.log(`----------------------------------------------------`);

        const calculatedIndicators: Partial<StrategyCandle> = { ...currentCandle };

        // 1. Расчет ATR
        if (params.risk.atrPeriod && historicalCandles.length >= params.risk.atrPeriod) {
            const atrValues = calculateATR(historicalCandles, params.risk.atrPeriod);
            calculatedIndicators.atr = atrValues[atrValues.length - 1];
            console.log(`  => ATR(${params.risk.atrPeriod}): ${calculatedIndicators.atr?.toFixed(4) ?? 'N/A'}`);
        } else {
            console.log(`  => ATR(${params.risk.atrPeriod}): N/A (недостаточно данных)`);
        }

        // 2. Расчет NWE
        // ВАЖНО: В реализации calculateNWE используются внутренние lookbackPeriod и atrPeriod,
        // а из настроек берутся source, bandwidth, multiplier.
        const nweCalcParams = {
            source: params.nwe.source!,
            bandwidth: params.nwe.bandwidth!,
            multiplier: params.nwe.multiplier!,
            // Эти параметры нужны для соответствия типу, но могут не влиять на расчет, если логика в calculateNWE их переопределяет
            lookbackPeriod: 500, // Пример, как в applyStrategyLogic
            atrPeriod: params.risk.atrPeriod,
        };
        const nweResults = calculateNWE(historicalCandles, nweCalcParams);
        const lastNwe = nweResults[nweResults.length - 1];
        if (lastNwe) {
            calculatedIndicators.nweUpper = lastNwe.nweUpper;
            calculatedIndicators.nweLower = lastNwe.nweLower;
        }
        console.log(`  => NWE: Upper=${lastNwe?.nweUpper?.toFixed(4) ?? 'N/A'}, Lower=${lastNwe?.nweLower?.toFixed(4) ?? 'N/A'}`);
        
        // 3. Расчет Volume Profile
        if (params.dlc.period) {
            const vpLookback = Math.min(historicalCandles.length, params.dlc.period);
            const vpCandles = historicalCandles.slice(-vpLookback);
            const vpResult = calculateVolumeProfile(vpCandles, params.dlc.numBins);
            calculatedIndicators.poc = vpResult.poc;
            calculatedIndicators.vah = vpResult.vah;
            calculatedIndicators.val = vpResult.val;
            console.log(`  => VP(${vpLookback} свечей): POC=${vpResult.poc?.toFixed(4) ?? 'N/A'}, VAH=${vpResult.vah?.toFixed(4) ?? 'N/A'}, VAL=${vpResult.val?.toFixed(4) ?? 'N/A'}`);
        }

        // 4. Расчет среднего объема
        if (params.clusters.lookbackPeriod) {
            const avgVolumeValues = calculateAvgVolume(historicalCandles, params.clusters.lookbackPeriod);
            calculatedIndicators.avgVolume = avgVolumeValues[avgVolumeValues.length - 1];
            console.log(`  => AvgVolume(${params.clusters.lookbackPeriod}): ${calculatedIndicators.avgVolume?.toFixed(2) ?? 'N/A'}`);
        }

        // 5. Расчет Approx Delta
        const deltaValues = calculateApproxDelta(historicalCandles);
        calculatedIndicators.approxDelta = deltaValues[deltaValues.length - 1];
        console.log(`  => ApproxDelta: ${calculatedIndicators.approxDelta?.toFixed(2) ?? 'N/A'}`);

        // 6. Расчет кумулятивной дельты
        if (params.clusters.lookbackPeriod) {
            const clusterLookback = Math.min(historicalCandles.length, params.clusters.lookbackPeriod);
            const deltaSlice = deltaValues.slice(-clusterLookback);
            calculatedIndicators.cumulativeDelta = deltaSlice.reduce((a, b) => a + b, 0);
            console.log(`  => CumulativeDelta(${clusterLookback} свечей): ${calculatedIndicators.cumulativeDelta?.toFixed(2) ?? 'N/A'}`);
        }

        // 7. Получение итогового сигнала (логика скопирована из applyStrategyLogic)
        // --- Начало скопированной логики ---
        let dlcLongActive = false;
        let nweLongActive = false;
        let clusterLongActive = false;
        let dlcShortActive = false;
        let nweShortActive = false;
        let clusterShortActive = false;

        // Проверяем, что ключевые значения существуют, перед использованием
        if (calculatedIndicators.val != null && calculatedIndicators.low != null && calculatedIndicators.close != null) {
            if (calculatedIndicators.low <= calculatedIndicators.val && calculatedIndicators.close > calculatedIndicators.val) {
                dlcLongActive = true;
            }
        }
        if (params.nwe.enabled && calculatedIndicators.nweLower != null && calculatedIndicators.low != null && calculatedIndicators.close != null) {
            if (calculatedIndicators.low <= calculatedIndicators.nweLower && calculatedIndicators.close > calculatedIndicators.nweLower) {
                nweLongActive = true;
            }
        }
        
        const avgVolume = calculatedIndicators.avgVolume ?? 0;
        const approxDelta = calculatedIndicators.approxDelta ?? 0;
        const volume = calculatedIndicators.volume;

        if (volume == null) {
            throw new Error(`Volume is null or undefined for candle at timestamp ${calculatedIndicators.timestamp}`);
        }

        const isVolumeCluster = volume > avgVolume * (params.clusters.minVolumeThresholdMultiplier ?? 1.5);

        if (isVolumeCluster && approxDelta > avgVolume * (params.clusters.deltaThreshold ?? 0.7) * 0.01) {
             clusterLongActive = true;
        }

        if (calculatedIndicators.vah != null && calculatedIndicators.high != null && calculatedIndicators.close != null) {
            if (calculatedIndicators.high >= calculatedIndicators.vah && calculatedIndicators.close < calculatedIndicators.vah) {
                dlcShortActive = true;
            }
        }
        if (params.nwe.enabled && calculatedIndicators.nweUpper != null && calculatedIndicators.high != null && calculatedIndicators.close != null) {
            if (calculatedIndicators.high >= calculatedIndicators.nweUpper && calculatedIndicators.close < calculatedIndicators.nweUpper) {
                nweShortActive = true;
            }
        }
        if (isVolumeCluster && approxDelta < -(avgVolume * (params.clusters.deltaThreshold ?? 0.7) * 0.01)) {
            clusterShortActive = true;
        }
        
        let signal: 0 | 1 | -1 = 0;
        if (dlcLongActive || nweLongActive || clusterLongActive) {
            signal = 1;
        } else if (dlcShortActive || nweShortActive || clusterShortActive) {
            signal = -1;
        }
        // --- Конец скопированной логики ---

        calculatedIndicators.signal = signal;
        const signalText = signal === 1 ? 'LONG' : signal === -1 ? 'SHORT' : 'NEUTRAL';
        console.log(`  \x1b[1m\x1b[33m==> ИТОГОВЫЙ СИГНАЛ: ${signalText}\x1b[0m`);
    }

    console.log('\n--- Детальный анализ завершен ---');
}


// Запуск скрипта
verifyStrategy();
