# API Документация: Торговые сессии

## Базовый URL
```
http://localhost:5000/api/sessions
```

## Endpoints

### 1. Список сессий

**GET** `/api/sessions`

Получение списка торговых сессий с фильтрацией и пагинацией.

**Query Parameters:**
- `source` (optional): `scanner` | `backtester`
- `mode` (optional): `dry-run` | `paper` | `shadow` | `demo` | `testnet` | `live` | `backtest`
- `strategyVersion` (optional): строка версии стратегии
- `limit` (optional, default: 50): количество записей
- `offset` (optional, default: 0): смещение

**Response:**
```json
{
  "success": true,
  "sessions": [
    {
      "id": "uuid",
      "source": "scanner",
      "mode": "demo",
      "strategyVersion": "1.0.0",
      "strategyParamsHash": "sha256hash",
      "exchange": "bybit",
      "pairs": ["BTCUSDT", "ETHUSDT"],
      "timeframes": ["15m", "1h"],
      "portfolioMode": false,
      "startedAt": "2025-10-13T15:00:00.000Z",
      "endedAt": null,
      "status": "running",
      "notes": null,
      "createdAt": "2025-10-13T15:00:00.000Z",
      "createdBy": "scanner-service"
    }
  ],
  "pagination": {
    "total": 10,
    "limit": 50,
    "offset": 0
  }
}
```

---

### 2. Детали сессии

**GET** `/api/sessions/:id`

Получение детальной информации о сессии и её метриках.

**Response:**
```json
{
  "success": true,
  "session": {
    "id": "uuid",
    "source": "scanner",
    "mode": "demo",
    ...
  },
  "metrics": {
    "id": "uuid",
    "sessionId": "uuid",
    "updatedAt": "2025-10-13T18:00:00.000Z",
    "totalPnl": "1250.50",
    "realizedPnl": "1100.00",
    "unrealizedPnl": "150.50",
    "totalReturnPct": "0.00",
    "winRatePct": "65.50",
    "profitFactor": "2.15",
    "avgTradePnl": "125.05",
    "avgWinPnl": "250.00",
    "avgLossPnl": "150.00",
    "sharpeRatio": "0.00",
    "sortinoRatio": "0.00",
    "maxDrawdownPct": "8.50",
    "maxDrawdownAmount": "450.00",
    "expectancy": "62.75",
    "tradeCount": 10,
    "winningTrades": 6,
    "losingTrades": 4,
    "openPositions": 2,
    "closedPositions": 8,
    "avgConcurrentTrades": "0.00",
    "peakConcurrentTrades": 0,
    "latencyMsAvg": "1250.00",
    "latencyMsP95": "2100.00",
    "metadata": null
  }
}
```

---

### 3. Сделки сессии

**GET** `/api/sessions/:id/trades`

Получение списка сделок для конкретной сессии.

**Query Parameters:**
- `status` (optional): `open` | `closed` | `cancelled`
- `limit` (optional, default: 100): количество записей
- `offset` (optional, default: 0): смещение

**Response:**
```json
{
  "success": true,
  "trades": [
    {
      "id": "uuid",
      "source": "scanner",
      "mode": "demo",
      "pair": "BTCUSDT",
      "timeframe": "15m",
      "exchange": "bybit",
      "strategyId": "basic-strategy-engine",
      "signalId": "uuid",
      "allocationId": null,
      "orderLinkId": "BTCUSDT:15m:1697210400000",
      "entryTimestamp": "2025-10-13T15:30:00.000Z",
      "entryPrice": "42500.00",
      "entryFee": "2.12",
      "entryReason": null,
      "exitTimestamp": "2025-10-13T16:15:00.000Z",
      "exitPrice": "43200.00",
      "exitFee": "2.16",
      "exitReason": "take_profit",
      "positionSize": "0.05",
      "leverage": "10.00",
      "realizedPnl": "35.00",
      "realizedPnlPct": "1.65",
      "maxFavorableExcursion": null,
      "maxAdverseExcursion": null,
      "stopLoss": "41800.00",
      "takeProfit": "43500.00",
      "trailingStop": null,
      "riskScore": "0.50",
      "confirmationAttempts": null,
      "latencyMs": null,
      "status": "closed",
      "extra": {
        "correlationId": "1697210400000-abc123",
        "recommendedOrderType": "market"
      },
      "createdAt": "2025-10-13T15:30:00.000Z"
    }
  ],
  "pagination": {
    "total": 10,
    "limit": 100,
    "offset": 0
  }
}
```

---

### 4. Экспорт сессии

**GET** `/api/sessions/:id/export?format=json|csv`

Экспорт данных сессии в JSON или CSV формате.

**Query Parameters:**
- `format` (optional, default: `json`): `json` | `csv`

**Response (JSON):**
```json
{
  "session": {
    "id": "uuid",
    "source": "scanner",
    "mode": "demo",
    "strategyVersion": "1.0.0",
    "strategyParamsHash": "sha256hash",
    "exchange": "bybit",
    "pairs": ["BTCUSDT", "ETHUSDT"],
    "timeframes": ["15m", "1h"],
    "startedAt": "2025-10-13T15:00:00.000Z",
    "endedAt": "2025-10-13T18:00:00.000Z",
    "status": "completed"
  },
  "metrics": {
    "totalPnl": 1250.50,
    "realizedPnl": 1100.00,
    "unrealizedPnl": 150.50,
    "winRatePct": 65.50,
    "profitFactor": 2.15,
    "avgTradePnl": 125.05,
    "expectancy": 62.75,
    "tradeCount": 10,
    "winningTrades": 6,
    "losingTrades": 4,
    "maxDrawdownPct": 8.50
  },
  "trades": [
    {
      "id": "uuid",
      "pair": "BTCUSDT",
      "timeframe": "15m",
      "signalId": "uuid",
      "entryTimestamp": "2025-10-13T15:30:00.000Z",
      "entryPrice": 42500.00,
      "exitTimestamp": "2025-10-13T16:15:00.000Z",
      "exitPrice": 43200.00,
      "exitReason": "take_profit",
      "positionSize": 0.05,
      "leverage": 10.00,
      "realizedPnl": 35.00,
      "realizedPnlPct": 1.65,
      "stopLoss": 41800.00,
      "takeProfit": 43500.00,
      "status": "closed"
    }
  ]
}
```

**Response (CSV):**
Файл `session-{id}-trades.csv` со всеми сделками.

---

### 5. Сравнение сессий

**POST** `/api/sessions/:id/compare`

Сравнение метрик двух торговых сессий.

**Request Body:**
```json
{
  "otherSessionId": "uuid"
}
```

**Response:**
```json
{
  "success": true,
  "base": {
    "sessionId": "uuid-1",
    "totalPnl": 1250.50,
    "winRatePct": 65.50,
    "profitFactor": 2.15,
    "avgTradePnl": 125.05,
    "expectancy": 62.75,
    "tradeCount": 10
  },
  "reference": {
    "sessionId": "uuid-2",
    "totalPnl": 1100.00,
    "winRatePct": 60.00,
    "profitFactor": 1.80,
    "avgTradePnl": 110.00,
    "expectancy": 55.00,
    "tradeCount": 10
  },
  "delta": {
    "totalPnl": {
      "abs": 150.50,
      "pct": 13.68
    },
    "winRatePct": {
      "abs": 5.50
    },
    "profitFactor": {
      "abs": 0.35
    },
    "avgTradePnl": {
      "abs": 15.05,
      "pct": 13.68
    },
    "expectancy": {
      "abs": 7.75,
      "pct": 14.09
    },
    "maxDrawdownPct": {
      "abs": -1.50
    },
    "tradeCount": {
      "abs": 0
    }
  },
  "significant": false,
  "notes": [
    "Metrics are similar"
  ]
}
```

---

### 6. Добавление заметок

**POST** `/api/sessions/:id/notes`

Добавление или обновление заметок к сессии.

**Request Body:**
```json
{
  "notes": "Стратегия работает хорошо, но на волатильных парах появляются ложные сигналы. Нужно увеличить confirmation window."
}
```

**Response:**
```json
{
  "success": true,
  "message": "Notes updated"
}
```

---

### 7. Завершение сессии

**POST** `/api/sessions/:id/end`

Завершение торговой сессии вручную.

**Request Body:**
```json
{
  "status": "completed",
  "notes": "Ручная остановка для корректировки параметров"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Session ended"
}
```

---

## Примеры использования

### Curl

```bash
# Получить список сессий сканнера
curl "http://localhost:5000/api/sessions?source=scanner&limit=10"

# Получить детали сессии
curl "http://localhost:5000/api/sessions/uuid"

# Экспорт в CSV
curl "http://localhost:5000/api/sessions/uuid/export?format=csv" -o session-trades.csv

# Сравнить две сессии
curl -X POST "http://localhost:5000/api/sessions/uuid-1/compare" \
  -H "Content-Type: application/json" \
  -d '{"otherSessionId":"uuid-2"}'
```

### JavaScript (fetch)

```javascript
// Получить список сессий
const sessions = await fetch('http://localhost:5000/api/sessions?source=scanner')
  .then(r => r.json());

// Сравнить сессии
const comparison = await fetch('http://localhost:5000/api/sessions/uuid-1/compare', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ otherSessionId: 'uuid-2' })
}).then(r => r.json());

console.log('Delta PnL:', comparison.delta.totalPnl.abs);
console.log('Significant:', comparison.significant);
```

---

## Коды ошибок

- `400` — Неверные параметры запроса
- `404` — Сессия не найдена
- `500` — Внутренняя ошибка сервера

Все ошибки возвращаются в формате:
```json
{
  "success": false,
  "message": "Error description",
  "error": "Detailed error message"
}
```

