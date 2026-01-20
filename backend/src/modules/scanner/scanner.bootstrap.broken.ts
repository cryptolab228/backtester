import config from '@/config';
import RedisSignalStore from '@/services/RedisSignalStore';
import logger from '@/utils/logger';

import { MultiModeExecutionAdapter, WebSocketSignalPublisher, executionManager, clearExecutionCaches } from './adapters';
import { LiveMarketDataSource } from './liveDataSource';
import portfolioAllocator from './portfolioAllocator';
import scannerConfigService from './scannerConfig.service';
import { ScannerService } from './scanner.service';
import { ScannerServiceOptions } from './scanner.types';
import { BasicRiskGateway } from './adapters';
import { signalEngineManager } from './engineManager';
import { BybitTestnetExecutionManager } from './bybitTestnetExecutionManager';
import { BybitDemoExecutionManager } from './bybitDemoExecutionManager';
import { sessionManager } from './services/SessionManager';
import { DefaultStrategyParameters } from '../strategy_logic/strategy';
import signalQueue from './signalQueue';

// Вспомогательная функция для получения текущей цены
async function getCurrentPrice(pairSymbol: string): Promise<number> {
  try {
    const dataSource = new LiveMarketDataSource('bybit');
    const candles = await dataSource.getLatestCandles(pairSymbol, '1h', 1);
    return candles.length > 0 ? candles[0].close : 0;
  } catch (error) {
    SCANNER_LOG.warn('Failed to get current price', { pairSymbol, error });
    return 0;
  }
}

const SCANNER_LOG = logger.child({ module: 'ScannerBootstrap' });

let scannerInstance: ScannerService | null = null;
let testnetManager: BybitTestnetExecutionManager | undefined;
let demoManager: BybitDemoExecutionManager | undefined;
let scannerStatus: 'idle' | 'running' | 'stopped' = 'idle';

/**
 * Инициализация сканера (БЕЗ автозапуска)
 * Запускается при старте сервера
 */
export const bootstrapScanner = async (): Promise<void> => {
  if (!config.scanner.enabled) {
    SCANNER_LOG.info('Scanner is disabled. Skipping bootstrap.');
    return;
  }

  try {
    // Инициализация зависимостей
    await scannerConfigService.init();
    await RedisSignalStore.init();
    await clearExecutionCaches();

    SCANNER_LOG.info('Scanner dependencies initialized. Waiting for session selection...');

    // Проверяем, была ли активная сессия до падения
    const restoredSession = await sessionManager.restoreLastActiveSession();
    
    if (restoredSession) {
      SCANNER_LOG.info('Found active session from previous run. Auto-starting...', {
        sessionId: restoredSession.id,
        name: restoredSession.configSnapshot?.name || 'Unnamed',
      });

      // Автоматически запускаем сканер с восстановленной сессией
      await startScannerWithSession(restoredSession.id, true);
    } else {
      SCANNER_LOG.info('No active session found. Scanner is in IDLE state. Waiting for user to select/create session.');
      scannerStatus = 'idle';
    }
  } catch (error) {
    SCANNER_LOG.error('Failed to initialize scanner', error);
    scannerStatus = 'idle';
  }
};

/**
 * Запуск сканера с выбранной сессией
 */
export async function startScannerWithSession(sessionId: string, autoStarted: boolean = false): Promise<void> {
  if (scannerStatus === 'running') {
    throw new Error('Scanner is already running');
  }

  const session = await sessionManager.getSession(sessionId);
  if (!session) {
    throw new Error('Session not found');
  }

  SCANNER_LOG.info('Starting scanner with session', {
    sessionId,
    name: session.configSnapshot?.name || 'Unnamed',
    mode: session.mode,
    pairs: session.pairs,
    autoStarted,
  });

  try {
    // Очистить состояние только при запуске НОВОЙ сессии (не при авто-восстановлении после падения)
    if (!autoStarted) {
      await signalQueue.clearAll();
      if (typeof executionManager.clearAll === 'function') {
        await executionManager.clearAll();
      }
    } else {
      SCANNER_LOG.info('Skipping Redis cleanup due to session auto-restore', { sessionId });
    }

    // Устанавливаем сессию в SessionManager
    sessionManager.setCurrentSessionId(sessionId);
    
    // Устанавливаем сессию в PortfolioAllocator для изоляции лимитов
    portfolioAllocator.setSession(sessionId);
    SCANNER_LOG.info('Portfolio allocator session set', { sessionId });

    // Извлекаем конфигурацию из сессии
    const pairs = session.pairs || [];
    const timeframes = session.timeframes || ['1h'];
    const mode = session.mode || 'demo';
    
    // Пытаемся получить детальную конфигурацию пар (symbol + timeframes) из snapshot
    const detailedPairs = session.configSnapshot?.tradingPairs as { symbol: string; timeframes: string[] }[] | undefined;

    // Обновляем runtime config под сессию
    const resolvedMode: ScannerServiceOptions['executionAdapter']['mode'] =
      mode === 'live' || mode === 'demo' || mode === 'testnet'
        ? mode
        : 'paper';

    const runtimeConfig: ScannerServiceOptions['runtimeConfig'] = {
      ...scannerConfigService.getConfig(),
      pairs: detailedPairs && detailedPairs.length > 0 
        ? detailedPairs.map(p => ({
            symbol: p.symbol,
            timeframes: p.timeframes && p.timeframes.length > 0 ? p.timeframes : ['1h']
          }))
        : pairs.map((symbol: string) => ({
            symbol,
            timeframes,
          })),
      executionMode: resolvedMode,
    };

    // Инициализация execution managers
    testnetManager = mode === 'testnet'
      ? new BybitTestnetExecutionManager(executionManager)
      : undefined;

    demoManager = mode === 'demo'
      ? new BybitDemoExecutionManager(executionManager)
      : undefined;

    // Создание опций сканера
    const options: ScannerServiceOptions = {
      marketDataSource: new LiveMarketDataSource('bybit'),
      signalPublisher: new WebSocketSignalPublisher(),
      executionAdapter: new MultiModeExecutionAdapter(executionManager, { mode: resolvedMode }),
      riskGateway: new BasicRiskGateway(),
      confirmWindowSize: runtimeConfig.confirmWindowSize,
      riskScoreThreshold: runtimeConfig.riskScoreThreshold,
      portfolioAllocator,
      executionManager,
      engineManager: signalEngineManager,
      testnetExecutionManager: testnetManager,
      demoExecutionManager: demoManager,
      runtimeConfig,
    };

    // Создание и запуск сканера
    scannerInstance = new ScannerService(options);
    
    // Установить текущую сессию
    sessionManager.setCurrentSessionId(sessionId);

    // Восстановить открытые позиции (если есть)
    const validPositions = await sessionManager.restoreAndValidateOpenPositions(sessionId);
    
    if (validPositions.length > 0) {
      SCANNER_LOG.info('Restoring open positions', {
        count: validPositions.length,
        pairs: validPositions.map((t) => t.pair),
      });
      
      for (const trade of validPositions) {
        await executionManager.restorePosition(trade);
      }
      
      // Проверяем позиции против текущего рынка
      const marketDataSource = new LiveMarketDataSource('bybit');
      const closedCount = await executionManager.validateAndClosePhantomPositions(marketDataSource);
      
      if (closedCount > 0) {
        SCANNER_LOG.info('Closed phantom positions', { count: closedCount });
      }
    }

    try {
      await portfolioAllocator.syncWithTrades(
        validPositions.map((trade) => ({
          id: trade.id,
          pair: trade.pair,
          timeframe: trade.timeframe,
          entryPrice: trade.entryPrice ? Number(trade.entryPrice) : null,
          positionSize: trade.positionSize ? Number(trade.positionSize) : null,
          exchange: trade.exchange,
        })),
      );
    } catch (error: any) {
      SCANNER_LOG.warn('Failed to sync allocator state with restored positions', {
        sessionId,
        error: error?.message || error,
      });
    }

    // Запуск сканера
    await scannerInstance.start();
    scannerStatus = 'running';

    // Активируем сессию (переводим в статус running и обновляем startedAt)
    if (!autoStarted) {
      await sessionManager.activateSession(sessionId);
    }

    // Пометить сессию как auto_started если это восстановление
    if (autoStarted) {
      await sessionManager.markSessionAutoStarted(sessionId);
    }

    SCANNER_LOG.info('Scanner started successfully', { sessionId, status: 'running' });
  } catch (error) {
    SCANNER_LOG.error('Failed to start scanner', { error: (error as Error)?.message || error });
    scannerStatus = 'idle';
    scannerInstance = null;
    throw error;
  }
}

/**
 * Остановка сканера и завершение сессии
 */
export async function stopScannerAndEndSession(): Promise<void> {
  if (scannerStatus !== 'running') {
    SCANNER_LOG.warn('Cannot stop scanner: not running');
  const sessionId = sessionManager.getCurrentSessionId();
  
  try {
    // 🔥 Сначала завершаем сессию и закрываем позиции в БД
    if (sessionId) {
      await sessionManager.endSession(sessionId, 'completed', 'Stopped by user');
      SCANNER_LOG.info('Session ended and positions closed in database', { sessionId });
    }

    // Остановить сканер (включая WebSocket)
    if (scannerInstance) {
      await scannerInstance.stop();
      scannerInstance = null;
      SCANNER_LOG.info('Scanner WebSocket stopped');
    }

    // Закрыть все открытые позиции в памяти (после остановки WebSocket)
    const openPositions = await executionManager.getOpenPositions();
    
    if (openPositions.length > 0) {
      SCANNER_LOG.info('Closing positions in memory after WebSocket stop', { 
        count: openPositions.length,
        sessionId,
        positions: openPositions.map(p => ({ pair: p.pairSymbol, direction: p.direction })),
      });
      
      let totalPnl = 0;
      let closedCount = 0;
      
      for (const position of openPositions) {
        try {
          // Получаем текущую цену для расчета PnL
          const currentPrice = await getCurrentPrice(position.pairSymbol);
          const pnl = position.direction === 'long'
            ? (currentPrice - position.entryPrice) * position.size
            : (position.entryPrice - currentPrice) * position.size;
          
          totalPnl += pnl;
          closedCount++;
          
          // Закрываем только в памяти, БД уже обновлена в endSession
          await executionManager.closePosition(position.id, {
            exitReason: 'manual',
            exitPrice: currentPrice,
            exitAt: Date.now(),
          });
          
          SCANNER_LOG.info('Position closed in memory', {
            positionId: position.id,
            pair: position.pairSymbol,
            direction: position.direction,
            entryPrice: position.entryPrice,
            exitPrice: currentPrice,
            pnl: pnl.toFixed(2),
          });
        } catch (error) {
          SCANNER_LOG.error('Failed to close position in memory', {
            positionId: position.id,
            pair: position.pairSymbol,
            error: (error as Error)?.message || error,
          });
        }
      }
      
      SCANNER_LOG.info('All positions closed in memory', {
        sessionId,
        totalPositions: openPositions.length,
        closedSuccessfully: closedCount,
        totalPnl: totalPnl.toFixed(2),
      });
    }

    // Очистить очереди и состояние
    try {
      await signalQueue.clearAll();
      if (typeof executionManager.clearAll === 'function') {
        await executionManager.clearAll();
      }
    } catch (cleanupError) {
      SCANNER_LOG.warn('Failed to clear scanner state', {
        error: (cleanupError as Error)?.message || cleanupError,
      });
    }

    // Очистить состояние allocator для этой сессии
    await portfolioAllocator.clearSessionState();

    scannerStatus = 'stopped';
    
    SCANNER_LOG.info('Scanner stopped completely', {
      sessionId,
      closedPositions: openPositions.length,
    });
  } catch (error) {
    SCANNER_LOG.error('Error while stopping scanner', { error: (error as Error)?.message || error });
  } finally {
    // Очистить состояние
    scannerInstance = null;
    testnetManager = undefined;
    demoManager = undefined;
    sessionManager.setCurrentSessionId(null);
    portfolioAllocator.setSession(null);
    scannerStatus = 'idle';
  }
}

/**
 * Остановка сканера
 */
export async function stopScanner(): Promise<void> {
  const sessionId = sessionManager.getCurrentSessionId();
  
  try {
    // 🔥 Сначала завершаем сессию и закрываем позиции в БД
    if (sessionId) {
      await sessionManager.endSession(sessionId, 'completed', 'Stopped by user');
      SCANNER_LOG.info('Session ended and positions closed in database', { sessionId });
    }

    // Остановить сканер (включая WebSocket)
    if (scannerInstance) {
      await scannerInstance.stop();
      scannerInstance = null;
      SCANNER_LOG.info('Scanner WebSocket stopped');
    }

    // Закрыть все открытые позиции в памяти (после остановки WebSocket)
    const openPositions = await executionManager.getOpenPositions();
    
    if (openPositions.length > 0) {
      SCANNER_LOG.info('Closing positions in memory after WebSocket stop', { 
        count: openPositions.length,
        sessionId,
        positions: openPositions.map(p => ({ pair: p.pairSymbol, direction: p.direction })),
      });
      
      let totalPnl = 0;
      let closedCount = 0;
      
      for (const position of openPositions) {
        try {
          // Получаем текущую цену для расчета PnL
          const currentPrice = await getCurrentPrice(position.pairSymbol);
          const pnl = position.direction === 'long'
            ? (currentPrice - position.entryPrice) * position.size
            : (position.entryPrice - currentPrice) * position.size;
          
          totalPnl += pnl;
          closedCount++;
          
          // Закрываем только в памяти, БД уже обновлена в endSession
          await executionManager.closePosition(position.id, {
            exitReason: 'manual',
            exitPrice: currentPrice,
            exitAt: Date.now(),
          });
          
          SCANNER_LOG.info('Position closed in memory', {
            positionId: position.id,
            pair: position.pairSymbol,
            direction: position.direction,
            entryPrice: position.entryPrice,
            exitPrice: currentPrice,
            pnl: pnl.toFixed(2),
          });
        } catch (error) {
          SCANNER_LOG.error('Failed to close position in memory', {
            positionId: position.id,
            pair: position.pairSymbol,
            error: (error as Error)?.message || error,
          });
        }
      }
      
      SCANNER_LOG.info('All positions closed in memory', {
        sessionId,
        totalPositions: openPositions.length,
        closedSuccessfully: closedCount,
        totalPnl: totalPnl.toFixed(2),
      });
    }

    // Очистить очереди и состояние
    try {
      await signalQueue.clearAll();
      if (typeof executionManager.clearAll === 'function') {
        await executionManager.clearAll();
      }
    } catch (cleanupError) {
      SCANNER_LOG.warn('Failed to clear scanner state', {
        error: (cleanupError as Error)?.message || cleanupError,
      });
    }

    // Очистить состояние allocator для этой сессии
    await portfolioAllocator.clearSessionState();

    scannerStatus = 'stopped';
    
    SCANNER_LOG.info('Scanner stopped completely', {
      sessionId,
      closedPositions: openPositions.length,
    });
  } catch (error) {
    SCANNER_LOG.error('Error while stopping scanner', { error: (error as Error)?.message || error });
    throw error;
  } finally {
    // Очистить состояние
    scannerInstance = null;
    testnetManager = undefined;
    demoManager = undefined;
    sessionManager.setCurrentSessionId(null);
    portfolioAllocator.setSession(null);
    scannerStatus = 'idle';
  }
}

/**
 * Получение текущего статуса сканера
 */
export function getScannerStatus(): 'idle' | 'running' | 'stopped' {
  return scannerStatus;
}

/**
 * Получение инстанса сканера
 */
export function getScannerInstance(): ScannerService | null {
  return scannerInstance;
}

/**
 * Получение testnet manager
 */
export function getTestnetManager(): BybitTestnetExecutionManager | undefined {
  return testnetManager;
}

/**
 * Получение demo manager
 */
export function getDemoManager(): BybitDemoExecutionManager | undefined {
  return demoManager;
}

/**
 * @deprecated Use stopScanner() instead
 */
export const stopScannerLegacy = async (reason: string = 'Scanner stopped manually'): Promise<void> => {
  SCANNER_LOG.warn('stopScannerLegacy() is deprecated. Use stopScanner() instead.');
  await stopScanner();
}
