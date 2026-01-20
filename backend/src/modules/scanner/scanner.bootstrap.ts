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
export async function initializeScanner(): Promise<void> {
  try {
    SCANNER_LOG.info('Initializing scanner components...');
    
    // Инициализация Redis Signal Store
    await RedisSignalStore.init();
    
    // Очистка кэшей
    await clearExecutionCaches();
    
    SCANNER_LOG.info('Scanner initialized successfully');
  } catch (error) {
    SCANNER_LOG.error('Failed to initialize scanner', { error: (error as Error)?.message || error });
    throw error;
  }
}

/**
 * Запуск сканнера с указанной сессией
 */
export async function startScanner(sessionId: string, options?: ScannerServiceOptions): Promise<void> {
  if (scannerStatus === 'running') {
    SCANNER_LOG.warn('Scanner already running');
    return;
  }

  try {
    SCANNER_LOG.info('Starting scanner with session', { sessionId });
    
    // Получаем конфигурацию сессии
    const session = await sessionManager.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Создаем execution managers
    testnetManager = new BybitTestnetExecutionManager(executionManager);
    demoManager = new BybitDemoExecutionManager(executionManager);

    // Запускаем WebSocket соединения
    if (session.mode === 'testnet' && testnetManager) {
      await testnetManager.start();
    } else if (session.mode === 'demo' && demoManager) {
      await demoManager.start();
    }

    // Создаем экземпляр сканнера
    const scannerOptions: ScannerServiceOptions = {
      marketDataSource: new LiveMarketDataSource((session.exchange || 'bybit') as any),
      signalPublisher: new WebSocketSignalPublisher(),
      executionAdapter: new MultiModeExecutionAdapter(executionManager),
      riskGateway: new BasicRiskGateway(),
      confirmWindowSize: 2,
      riskScoreThreshold: 0.5,
      portfolioAllocator,
      executionManager,
      engineManager: signalEngineManager,
      testnetExecutionManager: testnetManager,
      demoExecutionManager: demoManager,
    };

    scannerInstance = new ScannerService(scannerOptions);
    await scannerInstance.start();

    // Устанавливаем текущую сессию
    sessionManager.setCurrentSessionId(sessionId);
    portfolioAllocator.setSession(sessionId);

    scannerStatus = 'running';
    SCANNER_LOG.info('Scanner started successfully', { sessionId, mode: session.mode });
  } catch (error) {
    SCANNER_LOG.error('Failed to start scanner', { error: (error as Error)?.message || error });
    scannerStatus = 'idle';
    throw error;
  }
}

/**
 * Остановка сканнера и завершение сессии
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
    scannerStatus = 'idle';
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
 * Получение статуса сканнера
 */
export function getScannerStatus(): 'idle' | 'running' | 'stopped' {
  return scannerStatus;
}

/**
 * Получение экземпляра сканнера
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
 * Запуск сканнера с выбранной сессией
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

    // Запускаем сканнер
    await startScanner(sessionId);

    SCANNER_LOG.info('Scanner started successfully with session', { sessionId });
  } catch (error) {
    SCANNER_LOG.error('Failed to start scanner with session', { 
      sessionId, 
      error: (error as Error)?.message || error 
    });
    scannerStatus = 'idle';
    throw error;
  }
};

/**
 * Остановка сканера и завершение сессии
 */
export async function stopScannerAndEndSession(): Promise<void> {
  if (scannerStatus !== 'running') {
    SCANNER_LOG.warn('Cannot stop scanner: not running');
    return;
  }

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
      let closedSuccessfully = 0;

      for (const position of openPositions) {
        try {
          const currentPrice = await getCurrentPrice(position.pairSymbol);
          const pnl = position.direction === 'long' 
            ? (currentPrice - position.entryPrice) * position.size
            : (position.entryPrice - currentPrice) * position.size;
          
          totalPnl += pnl;

          // Закрываем позицию в памяти
          await executionManager.closePosition(position.id, {
            exitReason: 'manual',
            exitPrice: currentPrice,
            exitAt: Date.now(),
          });

          closedSuccessfully++;
          SCANNER_LOG.debug('Position closed in memory', {
            positionId: position.id,
            pair: position.pairSymbol,
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
        closedSuccessfully,
        totalPnl: totalPnl.toFixed(2),
      });
    }

    // Очищаем состояние
    await signalQueue.clearAll();
    if (typeof executionManager.clearAll === 'function') {
      await executionManager.clearAll();
    }
    await portfolioAllocator.clearSessionState();

    scannerStatus = 'stopped';
    SCANNER_LOG.info('Scanner stopped completely', { sessionId, closedPositions: openPositions.length });
  } catch (error) {
    SCANNER_LOG.error('Error while stopping scanner', { error: (error as Error)?.message || error });
    scannerStatus = 'idle';
    throw error;
  } finally {
    scannerInstance = null;
    testnetManager = undefined;
    demoManager = undefined;
    sessionManager.setCurrentSessionId(null);
    portfolioAllocator.setSession(null);
    scannerStatus = 'idle';
  }
};

/**
 * Инициализация сканнера при старте сервера
 */
export const bootstrapScanner = async (): Promise<void> => {
  if (!config.scanner.enabled) {
    SCANNER_LOG.info('Scanner is disabled. Skipping bootstrap.');
    return;
  }

  try {
    // Инициализация зависимостей
    await RedisSignalStore.init();
    await clearExecutionCaches();

    SCANNER_LOG.info('Scanner dependencies initialized. Waiting for session selection...');
    
    scannerStatus = 'idle';
  } catch (error) {
    SCANNER_LOG.error('Failed to initialize scanner', { error: (error as Error)?.message || error });
    scannerStatus = 'idle';
  }
};

/**
 * @deprecated Use stopScanner() instead
 */
export const stopScannerLegacy = async (reason: string = 'Scanner stopped manually'): Promise<void> => {
  SCANNER_LOG.warn('stopScannerLegacy() is deprecated. Use stopScanner() instead.');
  await stopScanner();
};
