type WebSocketMessage = {
  type: string;
  payload?: any;
};

type Callback = (message: WebSocketMessage) => void;

class WebSocketManager {
  private socket: WebSocket | null = null;
  private callbacks: Set<Callback> = new Set();
  private reconnectAttempts = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(private url: string) {}

  connect() {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.socket = new WebSocket(this.url);

    this.socket.addEventListener('open', () => {
      console.info('[WebSocket] Connected');
      this.reconnectAttempts = 0;
    });

    this.socket.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);
        this.callbacks.forEach((cb) => cb(data));
      } catch (error) {
        console.warn('[WebSocket] Failed to parse message', error);
      }
    });

    this.socket.addEventListener('close', () => {
      console.warn('[WebSocket] Disconnected. Attempting to reconnect...');
      this.scheduleReconnect();
    });

    this.socket.addEventListener('error', (error) => {
      console.warn('[WebSocket] Error', error);
      this.socket?.close();
    });
  }

  private scheduleReconnect() {
    if (this.reconnectTimeout) {
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30_000);
    this.reconnectAttempts += 1;

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, delay);
  }

  subscribe(callback: Callback) {
    this.callbacks.add(callback);
  }

  unsubscribe(callback: Callback) {
    this.callbacks.delete(callback);
  }
}

const RAW_WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:5000';
let NORMALIZED_WS_URL = RAW_WS_URL;

if (!RAW_WS_URL.startsWith('ws')) {
  NORMALIZED_WS_URL = RAW_WS_URL.replace(/^https?:\/\//, 'ws://');
}

if (!NORMALIZED_WS_URL.endsWith('/ws')) {
  NORMALIZED_WS_URL = `${NORMALIZED_WS_URL.replace(/\/$/, '')}/ws`;
}

export const webSocketManager = new WebSocketManager(NORMALIZED_WS_URL);
webSocketManager.connect();

export default webSocketManager;

