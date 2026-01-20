import WebSocket, { WebSocketServer } from 'ws';
import { Server as HttpServer } from 'http';
import logger from '@/utils/logger';
import zlib from 'zlib';
// Импортируем необходимые функции из dataController
import { getSanitizedJobCounts, getJobsWithSanitizedData } from '@/modules/data/dataController'; // Используем корректные экспорты

let wss: WebSocketServer;
const clients = new Set<WebSocket>();

// Максимальный размер WebSocket сообщения (в символах)
const MAX_WEBSOCKET_MESSAGE_SIZE = 10 * 1024 * 1024; // Уменьшено до 10MB (было 50MB)
const LARGE_MESSAGE_THRESHOLD = 5 * 1024 * 1024; // Уменьшено до 5MB (было 10MB) - порог для сжатия

// Функция для сжатия больших данных
const compressData = (data: any): Promise<string> => {
  return new Promise((resolve, reject) => {
    const jsonString = JSON.stringify(data);
    if (jsonString.length < LARGE_MESSAGE_THRESHOLD) {
      resolve(jsonString);
      return;
    }

    zlib.gzip(jsonString, (err, compressed) => {
      if (err) {
        logger.error('[WebSocket] Error compressing data:', err);
        // Fallback: отправляем без сжатия, но с уменьшенными данными
        const reducedData = reduceDataSize(data);
        resolve(JSON.stringify(reducedData));
      } else {
        const base64Compressed = compressed.toString('base64');
        resolve(JSON.stringify({
          _compressed: true,
          data: base64Compressed,
          originalSize: jsonString.length,
          compressedSize: base64Compressed.length
        }));
      }
    });
  });
};

// Функция для уменьшения размера данных портфельного бэктеста
const reduceDataSize = (data: any): any => {
  if (data.type === 'PORTFOLIO_BACKTEST_COMPLETED' && data.payload?.result) {
    const result = data.payload.result;
    
    // Считаем общее количество сделок
    const totalTrades = Object.values(result.tradesByPair || {}).reduce((sum: number, trades: unknown) => {
      return sum + (Array.isArray(trades) ? trades.length : 0);
    }, 0);
    
    // АДАПТИВНОЕ ограничение сделок
    let tradesPerPair: number;
    if (totalTrades <= 2000) {
      tradesPerPair = 2000; // Увеличено с 1000: если всего мало сделок - отправляем все
    } else if (totalTrades <= 10000) {
      tradesPerPair = 1000; // Увеличено с 500: умеренное ограничение
    } else {
      tradesPerPair = 500; // Увеличено с 200: агрессивное ограничение только для очень больших результатов
    }
    
    const reducedResult = {
      // Оставляем только основные метрики
      overallMetrics: result.overallMetrics,
      
      // АДАПТИВНОЕ ограничение сделок на основе общего количества
      tradesByPair: Object.fromEntries(
        Object.entries(result.tradesByPair || {}).map(([pair, trades]) => [
          pair,
          Array.isArray(trades) ? trades.slice(0, tradesPerPair) : []
        ])
      ),
      
      metricsByPair: result.metricsByPair,
      
      // УБИРАЕМ strategyCandlesByPair для портфельных бэктестов - слишком много данных
      // strategyCandlesByPair: undefined,
      
      _dataReduced: totalTrades > tradesPerPair,
      _dataReductionLevel: totalTrades <= 2000 ? 'none' : totalTrades <= 10000 ? 'moderate' : 'aggressive',
      _originalTradesCount: totalTrades,
      _reducedTradesCount: Object.values(result.tradesByPair || {}).reduce((sum: number, trades: unknown) => {
        return sum + (Array.isArray(trades) ? Math.min(trades.length, tradesPerPair) : 0);
      }, 0),
      _tradesPerPairLimit: tradesPerPair,
      _note: totalTrades > tradesPerPair 
        ? `Portfolio backtest data reduced for WebSocket transmission (${totalTrades} -> ${Math.min(totalTrades, tradesPerPair * Object.keys(result.tradesByPair || {}).length)} trades). Full results available via API.`
        : 'Full portfolio backtest results transmitted.'
    };

    return {
      ...data,
      payload: {
        ...data.payload,
        result: reducedResult
      }
    };
  }
  return data;
};

// Helper function to send data safely
const safeSend = (client: WebSocket, data: any) => {
  if (client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(data), (err) => {
      if (err) {
        logger.error('[WebSocket] Error sending message to client:', err);
        // Consider removing the client if sending consistently fails
        // clients.delete(client);
      }
    });
  } else {
      logger.warn('[WebSocket] Attempted to send message to client with readyState:', client.readyState);
  }
};

// Безопасная отправка больших данных
const safeSendLarge = async (client: WebSocket, data: any) => {
  if (client.readyState !== WebSocket.OPEN) {
    logger.warn('[WebSocket] Attempted to send large message to client with readyState:', client.readyState);
    return;
  }

  try {
    const compressedData = await compressData(data);
    
    if (compressedData.length > MAX_WEBSOCKET_MESSAGE_SIZE) {
      logger.warn(`[WebSocket] Message too large even after compression (${compressedData.length} chars). Reducing data size.`);
      const reducedData = reduceDataSize(data);
      const finalData = JSON.stringify(reducedData);
      
      if (finalData.length > MAX_WEBSOCKET_MESSAGE_SIZE) {
        logger.error(`[WebSocket] Message still too large after reduction (${finalData.length} chars). Skipping send.`);
        // Отправляем уведомление об ошибке вместо данных
        safeSend(client, {
          type: 'WEBSOCKET_ERROR',
          payload: {
            message: 'Portfolio backtest results too large to send via WebSocket',
            suggestion: 'Results saved locally, refresh the page to see them'
          }
        });
        return;
      }
      
      client.send(finalData, (err) => {
        if (err) {
          logger.error('[WebSocket] Error sending reduced large message to client:', err);
        }
      });
    } else {
      client.send(compressedData, (err) => {
        if (err) {
          logger.error('[WebSocket] Error sending compressed large message to client:', err);
        }
      });
    }
  } catch (error: unknown) {
    logger.warn('[WebSocket] Error sending large message to client (client may have disconnected):', error);
  }
};

export const initWebSocket = (httpServer: HttpServer) => {
  wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', async (ws: WebSocket) => {
    clients.add(ws);
    logger.info('[WebSocket] New client connected. Total clients: ' + clients.size);

    try {
      logger.debug('[WebSocket] Sending current state to newly connected client...');
      
      // 1. Отправляем текущие счетчики
      const currentCounts = await getSanitizedJobCounts(); 
      safeSend(ws, { type: 'job_counts_updated', counts: currentCounts });
      logger.debug('[WebSocket] Sent current job counts to new client.');

      // 2. Отправляем текущий список задач (можно ограничить)
      const currentJobs = await getJobsWithSanitizedData({ 
          // status: ['active', 'wait', 'waiting', 'failed', 'delayed', 'paused', 'prioritized'] // Пример фильтра
      }); 
      currentJobs.forEach((job: any) => { // Добавляем тип any для job, т.к. возвращаемый тип Promise<any[]>
          safeSend(ws, { type: 'job_updated', ...job }); 
      });
      logger.debug(`[WebSocket] Sent ${currentJobs.length} current jobs to new client.`);

      // 3. НОВОЕ: Отправляем snapshot позиций сканнера (только текущей сессии)
      try {
        const { executionManager } = await import('@/modules/scanner/adapters');
        const { sessionManager } = await import('@/modules/scanner/services/SessionManager');
        
        if (executionManager && sessionManager) {
          const currentSessionId = sessionManager.getCurrentSessionId();
          
          if (currentSessionId) {
            // ИСПРАВЛЕНО: Отправляем только позиции текущей сессии
            const openPositions = await executionManager.getOpenPositionsBySession(currentSessionId);
            const recentExecutions = await executionManager.getExecutionsBySession(currentSessionId, 50);
            
            safeSend(ws, { 
              type: 'executions_snapshot', 
              payload: { open: openPositions, recent: recentExecutions } 
            });
            logger.debug(`[WebSocket] Sent ${openPositions.length} open positions and ${recentExecutions.length} recent executions for session ${currentSessionId} to new client.`);
          } else {
            logger.debug('[WebSocket] No active session, skipping executions snapshot.');
          }
        }
      } catch (error) {
        logger.warn('[WebSocket] Scanner execution manager not available (scanner may not be running):', error);
      }

    } catch (error) {
      logger.error('[WebSocket] Error sending initial state to client:', error);
    }
    
    ws.on('message', (message: Buffer) => {
      logger.debug(`[WebSocket] Received message from client: ${message.toString()}`);
    });

    ws.on('close', () => {
      clients.delete(ws);
      logger.info('[WebSocket] Client disconnected. Total clients: ' + clients.size);
    });

    ws.on('error', (error: Error) => {
      logger.error('[WebSocket] Error on client connection:', error);
      clients.delete(ws); 
    });

  });

  wss.on('error', (error: Error) => {
    logger.error('[WebSocket] WebSocket Server error:', error);
  });

  logger.info('[WebSocket] WebSocket server initialized and attached to HTTP server.');
};

export const broadcast = async (data: any) => {
  if (!wss) {
    logger.warn('[WebSocket] Broadcast called before WebSocket server is initialized.');
    return;
  }

  // Проверяем размер данных перед логированием
  const dataString = JSON.stringify(data);
  const dataSizeKB = Math.round(dataString.length / 1024);
  
  if (dataSizeKB > 1024) { // Больше 1MB
    logger.info(`[WebSocket] Broadcasting large message (${dataSizeKB}KB) to ${clients.size} clients. Type: ${data.type}`);
  } else {
    logger.debug(`[WebSocket] Broadcasting message to ${clients.size} clients: ${dataString.substring(0, 500)}${dataString.length > 500 ? '...' : ''}`);
  }

  // Сохраняем клиентов, которым не удалось отправить сообщение
  const clientsToRemove = new Set<WebSocket>();

  // Определяем, нужна ли специальная обработка для больших сообщений
  const isLargeMessage = dataSizeKB > 100; // 100KB порог

  if (isLargeMessage) {
    logger.info(`[WebSocket] Processing large message (${dataSizeKB}KB) with compression...`);
    
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        await safeSendLarge(client, data);
      } else {
        logger.warn(`[WebSocket] Client not open during large broadcast (readyState: ${client.readyState}). Removing client.`);
        clientsToRemove.add(client);
      }
    }
  } else {
    // Обычная отправка для небольших сообщений
    clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(dataString, (err) => {
            if (err) {
              logger.error('[WebSocket] Error sending broadcast message to a client:', err);
              clientsToRemove.add(client);
            }
          });
        } catch (error) {
          logger.warn('[WebSocket] Error sending message to client (client may have disconnected):', error);
          clientsToRemove.add(client);
        }
      } else {
        logger.warn(`[WebSocket] Client not open during broadcast (readyState: ${client.readyState}). Removing client.`);
        clientsToRemove.add(client);
      }
    });
  }

  // Удаляем клиентов, которым не удалось отправить или которые были не готовы
  clientsToRemove.forEach(client => clients.delete(client));
  if (clientsToRemove.size > 0) {
      logger.info(`[WebSocket] Removed ${clientsToRemove.size} unresponsive clients after broadcast. Total clients: ${clients.size}`);
  }
};

// Опционально: функция для получения количества активных клиентов
export const getActiveClientsCount = (): number => {
  return clients.size;
}; 