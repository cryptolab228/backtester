import WebSocket from 'ws';
import crypto from 'crypto';
import { v4 as uuid } from 'uuid';

import logger from '@/utils/logger';

const HEARTBEAT_INTERVAL_MS = 15_000;

interface SubscribeRequest {
  op: 'subscribe' | 'unsubscribe' | 'auth' | 'ping';
  args?: string[];
}

interface AuthRequest {
  op: 'auth';
  args: [string, string, string];
}

export type BybitWebsocketMessage = Record<string, any> & {
  topic?: string;
  type?: string;
  success?: boolean;
  retCode?: number;
  retMsg?: string;
}

export interface BybitWebsocketClientConfig {
  url: string;
  apiKey: string;
  apiSecret: string;
  reconnectIntervalMs?: number;
}

type MessageHandler = (message: BybitWebsocketMessage) => void;

type ConnectionState = 'connecting' | 'connected' | 'disconnected';

const WS_LOG = logger.child({ module: 'BybitWsClient' });

export class BybitPrivateWebsocketClient {
  private readonly url: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly reconnectInterval: number;
  private ws?: WebSocket;
  private state: ConnectionState = 'disconnected';
  private messageHandlers: Set<MessageHandler> = new Set();
  private topics: Set<string> = new Set();
  private reconnectTimeout?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;

  constructor(config: BybitWebsocketClientConfig) {
    this.url = config.url;
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.reconnectInterval = config.reconnectIntervalMs ?? 5_000;
  }

  addMessageHandler(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  async connect(): Promise<void> {
    if (this.state === 'connecting' || this.state === 'connected') {
      return;
    }

    this.state = 'connecting';
    WS_LOG.info('Connecting to Bybit private websocket', { url: this.url });

    this.ws = new WebSocket(this.url);

    this.ws.on('open', () => this.onOpen());
    this.ws.on('message', (data) => this.onMessage(data));
    this.ws.on('close', (code, reason) => this.onClose(code, reason));
    this.ws.on('error', (error) => this.onError(error));
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close(1000, 'Client disconnect');
      this.ws = undefined;
    }
    this.state = 'disconnected';
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = undefined;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  subscribe(topics: string[]): void {
    topics.forEach((topic) => this.topics.add(topic));
    this.send({ op: 'subscribe', args: topics });
  }

  unsubscribe(topics: string[]): void {
    topics.forEach((topic) => this.topics.delete(topic));
    this.send({ op: 'unsubscribe', args: topics });
  }

  private async onOpen(): Promise<void> {
    this.state = 'connected';
    WS_LOG.info('Bybit websocket connected');

    try {
      await this.authenticate();
    } catch (error: any) {
      WS_LOG.error('Failed to authenticate with Bybit websocket', { error: error?.message || error });
      this.ws?.close(4000, 'auth_failed');
      return;
    }

    if (this.topics.size) {
      this.send({ op: 'subscribe', args: Array.from(this.topics) });
    }

    this.startHeartbeat();
  }

  private onMessage(data: WebSocket.RawData): void {
    let parsed: BybitWebsocketMessage | null = null;
    try {
      parsed = JSON.parse(String(data));
    } catch (error: any) {
      WS_LOG.warn('Failed to parse Bybit websocket message', { error: error?.message || error, raw: String(data) });
      return;
    }

    if (parsed?.op === 'pong') {
      return;
    }

    if (parsed?.op === 'auth' && parsed?.success === true) {
      WS_LOG.info('Bybit websocket authenticated');
      return;
    }

    if (parsed?.success === false && parsed?.retCode) {
      WS_LOG.warn('Bybit websocket returned error', parsed);
    }

    this.messageHandlers.forEach((handler) => {
      try {
        handler(parsed!);
      } catch (handlerError: any) {
        WS_LOG.error('Bybit websocket handler error', { error: handlerError?.message || handlerError });
      }
    });
  }

  private onClose(code: number, reason: Buffer): void {
    WS_LOG.warn('Bybit websocket closed', { code, reason: reason.toString() });
    this.state = 'disconnected';
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    this.tryReconnect();
  }

  private onError(error: Error): void {
    WS_LOG.error('Bybit websocket error', { error: error.message });
  }

  private tryReconnect(): void {
    if (this.reconnectTimeout || this.state === 'connecting') {
      return;
    }

    WS_LOG.info('Scheduling reconnect to Bybit websocket');
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = undefined;
      this.connect().catch((error) => {
        WS_LOG.error('Reconnect attempt failed', { error: error?.message || error });
        this.tryReconnect();
      });
    }, this.reconnectInterval);
  }

  private async authenticate(): Promise<void> {
    const timestamp = Date.now().toString();
    const expire = '5000';
    const signature = crypto
      .createHmac('sha256', this.apiSecret)
      .update(timestamp + this.apiKey + expire)
      .digest('hex');

    const authPayload: AuthRequest = {
      op: 'auth',
      args: [this.apiKey, timestamp, signature],
    };

    this.send(authPayload);
  }

  private send(payload: SubscribeRequest | AuthRequest): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    this.ws.send(JSON.stringify(payload));
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.send({ op: 'ping' });
      }
    }, HEARTBEAT_INTERVAL_MS);
  }
}
