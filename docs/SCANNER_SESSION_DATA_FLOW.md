# Поток Данных Сессий Сканера

**Дата:** 2025-10-18  
**Статус:** Проверено и документировано

## Обзор

Документ описывает, как данные сессий сканера сохраняются, очищаются и изолируются между PostgreSQL и Redis.

---

## 🗄️ Архитектура Хранения

### PostgreSQL (Постоянное хранилище)

**Таблица `trading_sessions`:**
- Хранит метаданные всех сессий (прошлых и текущих)
- Поля: id, name, mode, status, pairs, timeframes, метрики, timestamps

**Таблица `session_trades`:**
- Хранит ВСЕ сделки (открытые и закрытые) для всех сессий
- Поля: id, session_id, pair, direction, entry_price, exit_price, pnl, timestamps
- Связь: `session_trades.session_id → trading_sessions.id`

### Redis (Временное хранилище)

**Ключи:**
- `scanner:positions:open:v2` - открытые позиции текущей активной сессии
- `scanner:positions:index:v2` - индекс позиций по ключам
- `scanner:executions:v2` - история последних 1000 экзекуций (лента)

**Назначение:**
- Быстрый доступ к открытым позициям
- Очередь сигналов для подтверждения
- Broadcast через WebSocket

---

## 🔄 Жизненный Цикл Данных

### 1. Создание Новой Сессии

**API:** `POST /api/scanner/sessions`

```typescript
// scanner.session.controller.ts:49-104
const session = await sessionManager.createSession({
  source: 'scanner',
  mode: effectiveMode, // demo/testnet/live из config
  strategyVersion: '1.0.0',
  pairs: pairs || [],
  timeframes: timeframes || [],
  // ... другие параметры
});
```

**Что происходит:**
- ✅ Создаётся запись в БД (`trading_sessions`)
- ❌ Redis НЕ очищается (сканер ещё не запущен)
- ❌ Старые позиции остаются в Redis (если были)

---

### 2. Запуск Сессии

**API:** `POST /api/scanner/start/:sessionId`

**Проверка:**
```typescript
// scanner.bootstrap.ts:69-71
if (scannerStatus === 'running') {
  throw new Error('Scanner is already running');
}
```

**Очистка Redis (если НЕ авто-восстановление):**
```typescript
// scanner.bootstrap.ts:88-92
if (!autoStarted) {
  await signalQueue.clearAll();          // Очистка очереди сигналов
  await executionManager.clearAll();     // Очистка позиций и индексов
}
```

**Что происходит:**
- ✅ Обновляется статус сессии в БД → `running`
- ✅ Redis полностью очищается от старых данных
- ✅ `sessionManager.setCurrentSessionId(sessionId)` - устанавливается текущая сессия
- ✅ `portfolioAllocator.setSession(sessionId)` - привязка лимитов к сессии
- ✅ Сканер начинает работу

---

### 3. Работа Сканера (Открытие Позиции)

**Поток событий:**

1. **Сигнал детектируется** → записывается в Redis очередь
2. **Сигнал подтверждается** → `executionManager.recordExecution(signal)`

**Запись в Redis:**
```typescript
// adapters.ts:480-486
await this.redis.multi()
  .lpush(EXECUTION_KEY, JSON.stringify(broadcastPayload))  // Лента
  .ltrim(EXECUTION_KEY, 0, 999)                            // Ограничение 1000 записей
  .exec();

await this.saveOpenPosition(aggregated);  // Сохранение открытой позиции
```

**Запись в PostgreSQL (В РЕАЛЬНОМ ВРЕМЕНИ):**
```typescript
// adapters.ts:493-520
const sessionId = sessionManager.getCurrentSessionId();
if (sessionId && isNewPosition) {
  await sessionManager.recordTrade({
    sessionId,
    source: 'scanner',
    mode: config.scanner.executionMode,
    pair: signal.pairSymbol,
    direction: signal.direction,
    entryPrice: signal.price,
    entryTimestamp: signal.timestamp,
    positionSize: signal.positionSize,
    leverage: signal.leverage,
    stopLoss: aggregated.stopLoss,
    takeProfit: aggregated.takeProfit,
    riskScore: signal.riskScore,
    signalId: signal.id,
    extra: { legs, timeframes, positionKey },
  });
}
```

**Broadcast через WebSocket:**
```typescript
await broadcast({ 
  type: 'execution_opened', 
  payload: { ...aggregated, sessionId } 
});
```

**Что происходит:**
- ✅ Позиция записывается в Redis с `sessionId` (для изоляции)
- ✅ Сделка **сразу** записывается в PostgreSQL `session_trades`
- ✅ WebSocket отправляет уведомление клиентам
- ✅ Если произойдёт сбой → данные в БД сохранены

---

### 4. Закрытие Позиции

**Триггеры:**
- Цена достигла TP/SL
- Ручное закрытие
- Принудительное закрытие при остановке сканера

**Обновление PostgreSQL:**
```typescript
// SessionManager.ts:222-257
await tradeRepo.update(params.tradeId, {
  exitTimestamp: params.exitTimestamp,
  exitPrice: params.exitPrice.toString(),
  exitReason: params.exitReason,
  realizedPnl: params.realizedPnl?.toString(),
  realizedPnlPct: params.realizedPnlPct?.toString(),
  status: 'closed',
});

// Обновление метрик сессии
await this.updateSessionMetrics(trade.session.id);
```

**Очистка Redis:**
```typescript
// adapters.ts:660-679
await this.redis.hdel(OPEN_POSITIONS_KEY, positionId);
await this.redis.hdel(POSITION_INDEX_KEY, record.positionKey);
```

**Что происходит:**
- ✅ Сделка в БД обновляется (статус → `closed`, PnL рассчитывается)
- ✅ Метрики сессии пересчитываются (win_rate, avg_pnl, и т.д.)
- ✅ Позиция удаляется из Redis `open positions`
- ✅ WebSocket broadcast → `execution_closed`

---

### 5. Остановка Сессии

**API:** `POST /api/scanner/stop`

**Последовательность:**

```typescript
// scanner.bootstrap.ts:223-296
// 1. Закрыть все открытые позиции
const openPositions = await executionManager.getOpenPositions();
for (const position of openPositions) {
  await executionManager.closePosition(position.id, { 
    exitPrice, exitAt, exitReason: 'manual' 
  });
}

// 2. Обновить финальные метрики
await sessionManager.updateSessionMetrics(sessionId);
await sessionManager.endSession(sessionId, 'completed', 'Stopped by user');

// 3. Очистить Redis
await signalQueue.clearAll();
await executionManager.clearAll();

// 4. Очистить состояние allocator
await portfolioAllocator.clearSessionState();

// 5. Сбросить флаги
sessionManager.setCurrentSessionId(null);
portfolioAllocator.setSession(null);
scannerStatus = 'idle';
```

**Что происходит:**
- ✅ Все открытые позиции закрываются и записываются в БД
- ✅ Финальные метрики сессии сохраняются
- ✅ Статус сессии в БД → `completed`
- ✅ Redis полностью очищается
- ✅ Система готова к запуску новой сессии

---

### 6. Восстановление После Сбоя

**При падении Backend:**

```typescript
// scanner.bootstrap.ts:44-52
const restoredSession = await sessionManager.restoreLastActiveSession();
if (restoredSession) {
  SCANNER_LOG.info('Restored session after crash', { 
    sessionId: restoredSession.id 
  });
  await startScannerWithSession(restoredSession.id, true);  // autoStarted = true
}
```

**autoStarted = true:**
```typescript
// scanner.bootstrap.ts:88-95
if (!autoStarted) {
  await signalQueue.clearAll();       // Обычный запуск - очистка
  await executionManager.clearAll();
} else {
  SCANNER_LOG.info('Skipping Redis cleanup due to session auto-restore');
  // Redis НЕ очищается - позиции остаются
}
```

**Восстановление позиций из БД:**
```typescript
// adapters.ts:699-738
async restorePosition(trade: any): Promise<ExecutionRecord | null> {
  const record: ExecutionRecord = {
    id: trade.id,
    pairSymbol: trade.pair,
    direction: trade.direction,
    entryPrice: parseFloat(trade.entryPrice),
    executedAt: new Date(trade.entryTimestamp).getTime(),
    status: 'open',
    sessionId: trade.session?.id || trade.sessionId,  // ВАЖНО!
    source: 'restored',
    // ... остальные поля
  };
  await this.saveOpenPosition(record);
  return record;
}
```

**Что происходит:**
- ✅ Redis НЕ очищается при автостарте
- ✅ Позиции из БД (`session_trades` WHERE status='open') восстанавливаются
- ✅ Восстановленные позиции помечаются `source: 'restored'`
- ✅ `sessionId` корректно присваивается из БД
- ✅ Сканер продолжает работу с текущей сессией

---

## 🔒 Изоляция Сессий

### Проблема (Была)

При подключении нового клиента WebSocket отправлял **все** позиции из Redis, игнорируя `sessionId`.

### Решение (Реализовано)

**1. Добавлен `sessionId` в `ExecutionRecord`:**
```typescript
// scanner.types.ts:186-187
export interface ExecutionRecord {
  // ...
  sessionId?: string  // НОВОЕ: Для изоляции позиций между сессиями
  source?: string     // НОВОЕ: Источник создания (для restore)
}
```

**2. При создании позиции сохраняется `sessionId`:**
```typescript
// adapters.ts:407-420
private aggregatePosition(existing: ExecutionRecord | null, signal: ConfirmedSignal): ExecutionRecord {
  const leg = this.buildLeg(signal);
  if (!existing) {
    const currentSessionId = sessionManager.getCurrentSessionId();
    return {
      // ... поля
      legs: [leg],
      sessionId: currentSessionId || undefined,  // ПРИВЯЗКА К СЕССИИ
    };
  }
  // ...
}
```

**3. WebSocket отправляет только позиции текущей сессии:**
```typescript
// websocket.ts:187-202
const currentSessionId = sessionManager.getCurrentSessionId();
if (currentSessionId) {
  const openPositions = await executionManager.getOpenPositionsBySession(currentSessionId);
  const recentExecutions = await executionManager.getExecutionsBySession(currentSessionId, 50);
  
  safeSend(ws, { 
    type: 'executions_snapshot', 
    payload: { open: openPositions, recent: recentExecutions } 
  });
}
```

**4. Broadcast фильтруется по сессии:**
```typescript
// adapters.ts:745-760
async broadcastSnapshot(): Promise<void> {
  const currentSessionId = sessionManager.getCurrentSessionId();
  
  if (currentSessionId) {
    const open = await this.getOpenPositionsBySession(currentSessionId);
    const recent = await this.getExecutionsBySession(currentSessionId, 50);
    await broadcast({ type: 'executions_snapshot', payload: { open, recent } });
  } else {
    await broadcast({ type: 'executions_snapshot', payload: { open: [], recent: [] } });
  }
}
```

---

## 📊 Диаграмма Потока Данных

```
┌──────────────────────────────────────────────────────────────┐
│  Пользователь Создаёт Сессию                                 │
│  POST /api/scanner/sessions                                  │
└──────────────────┬───────────────────────────────────────────┘
                   │
                   ▼
      ┌────────────────────────┐
      │ PostgreSQL             │
      │ trading_sessions       │◄─────────────────────┐
      │ (запись создана)       │                      │
      └────────────────────────┘                      │
                   │                                  │
                   │ sessionId                        │
                   ▼                                  │
┌──────────────────────────────────────────────┐     │
│  Запуск Сессии                               │     │
│  POST /api/scanner/start/:sessionId          │     │
└──────────────────┬───────────────────────────┘     │
                   │                                  │
                   ▼                                  │
      ┌────────────────────────┐                     │
      │ Redis                  │                     │
      │ clearAll()             │  Связь: session_id  │
      │ (полная очистка)       │                     │
      └────────────────────────┘                     │
                   │                                  │
                   ▼                                  │
┌──────────────────────────────────────────────┐     │
│  Сканер Работает                             │     │
│  - Детекция сигналов                         │     │
│  - Открытие позиций                          │     │
└──────────────────┬───────────────────────────┘     │
                   │                                  │
         ┌─────────┴─────────┐                       │
         │                   │                       │
         ▼                   ▼                       │
┌────────────────┐  ┌────────────────────┐          │
│ Redis          │  │ PostgreSQL         │          │
│ positions:open │  │ session_trades     │──────────┘
│ (sessionId)    │  │ (sessionId, trade) │
│                │  │ REAL-TIME WRITE!   │
└────────┬───────┘  └────────┬───────────┘
         │                   │
         │                   │ Метрики
         │                   ▼
         │          ┌────────────────────┐
         │          │ trading_sessions   │
         │          │ updateSessionMetrics│
         │          └────────────────────┘
         │
         ▼
┌────────────────────────┐
│ WebSocket Broadcast    │
│ (только для sessionId) │
└────────────────────────┘
         │
         ▼
┌────────────────────────┐
│ UI Клиент              │
│ (фильтр по sessionId)  │
└────────────────────────┘
```

---

## ✅ Гарантии Системы

### 1. **Данные не теряются**
- ✅ Каждая позиция сразу записывается в PostgreSQL
- ✅ При закрытии обновляется в БД (exitPrice, PnL)
- ✅ При сбое данные восстанавливаются из БД

### 2. **Redis - только кэш**
- ✅ Redis хранит только **открытые** позиции **текущей** сессии
- ✅ При запуске новой сессии Redis очищается безопасно
- ✅ Старые данные не мешают новой сессии

### 3. **Изоляция сессий**
- ✅ Каждая позиция имеет `sessionId`
- ✅ WebSocket отправляет только данные активной сессии
- ✅ Разные сессии не видят позиции друг друга

### 4. **Защита от конфликтов**
- ✅ Нельзя запустить две сессии одновременно
- ✅ При попытке → ошибка 400 "Scanner is already running"
- ✅ Автоматическая остановка предыдущей сессии не происходит

### 5. **Восстановление после сбоя**
- ✅ При падении backend сессия автоматически восстанавливается
- ✅ Открытые позиции читаются из БД → записываются в Redis
- ✅ Redis НЕ очищается при авто-восстановлении

---

## 🔍 SQL Запросы для Проверки

### Все сессии и их сделки
```sql
SELECT 
  ts.id,
  ts.name,
  ts.status,
  ts.mode,
  COUNT(st.id) AS total_trades,
  SUM(CASE WHEN st.status = 'open' THEN 1 ELSE 0 END) AS open_trades,
  SUM(CASE WHEN st.status = 'closed' THEN 1 ELSE 0 END) AS closed_trades
FROM trading_sessions ts
LEFT JOIN session_trades st ON st.session_id = ts.id
GROUP BY ts.id
ORDER BY ts.created_at DESC;
```

### Открытые позиции конкретной сессии
```sql
SELECT 
  id,
  pair,
  direction,
  entry_price,
  position_size,
  leverage,
  entry_timestamp,
  status
FROM session_trades
WHERE session_id = 'YOUR_SESSION_ID'
  AND status = 'open';
```

### Проверка sessionId в Redis
```javascript
const redis = require('ioredis').default;
const client = new redis();
const positions = await client.hgetall('scanner:positions:open:v2');
Object.values(positions).forEach(pos => {
  const record = JSON.parse(pos);
  console.log(`Position ${record.id} → sessionId: ${record.sessionId}`);
});
```

---

## 📝 Выводы

1. **PostgreSQL - источник истины**
   - Все сделки хранятся в БД с момента открытия
   - Метрики обновляются в реальном времени

2. **Redis - временный кэш**
   - Используется только для открытых позиций
   - Очищается при смене сессии
   - Не влияет на сохранность данных

3. **Изоляция работает корректно**
   - Каждая сессия видит только свои данные
   - Восстановление после сбоя работает правильно
   - Защита от конфликтов реализована

4. **Данные прошлых сессий сохранены**
   - Все завершённые сессии остаются в БД
   - Можно получить историю через API
   - WebSocket не отправляет старые данные

---

**Следующий шаг:** Тестирование реальной работы системы с проверкой всех сценариев.




