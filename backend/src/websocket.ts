import WebSocket, { WebSocketServer } from 'ws';
import { Server as HttpServer } from 'http';
import logger from '@/utils/logger';
// Импортируем необходимые функции из dataController
import { getSanitizedJobCounts, getJobsWithSanitizedData } from '@/modules/data/dataController'; // Используем корректные экспорты

let wss: WebSocketServer;
const clients = new Set<WebSocket>();

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

export const broadcast = (data: any) => {
  if (!wss) {
    logger.warn('[WebSocket] Broadcast called before WebSocket server is initialized.');
    return;
  }
  logger.debug(`[WebSocket] Broadcasting message to ${clients.size} clients: ${JSON.stringify(data)}`); // Логируем перед отправкой

  // Сохраняем клиентов, которым не удалось отправить сообщение
  const clientsToRemove = new Set<WebSocket>();

  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data), (err) => { // Используем JSON.stringify здесь
        if (err) {
          logger.error('[WebSocket] Error sending broadcast message to a client:', err);
          // Можно добавить клиента в список на удаление, если отправка не удалась
          // clientsToRemove.add(client);
        }
      });
    } else {
        // Если клиент не готов, возможно, его стоит удалить
        logger.warn(`[WebSocket] Client not open during broadcast (readyState: ${client.readyState}). Removing client.`);
        clientsToRemove.add(client);
    }
  });

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