# 🔧 Исправление Изоляции Сессий в Сканнере

**Дата:** 18.10.2025  
**Статус:** ✅ **ЗАВЕРШЕНО**

---

## 📋 Проблема

**Симптом:**
При создании новой сессии WebSocket отправлял данные **ВСЕХpositions из Redis**, включая позиции из других (остановленных) сессий.

**Ожидаемое поведение:**
- Каждая сессия должна видеть только свои позиции
- При создании новой сессии должны показываться только её данные
- Данные других сессий хранятся в БД, но не в Redis текущей сессии

---

## 🔍 Корневая Причина

### **1. ExecutionRecord не содержал sessionId**

**Файл:** `backend/src/modules/scanner/scanner.types.ts`

**Было:**
```typescript
export interface ExecutionRecord {
  id: string
  pairSymbol: string
  // ...
  // ❌ НЕТ sessionId!
}
```

**Проблема:**
- Позиции создавались БЕЗ привязки к сессии
- Все позиции хранились в общем Redis хеше
- Фильтрация по сессии была невозможна

---

### **2. aggregatePosition не сохранял sessionId**

**Файл:** `backend/src/modules/scanner/adapters.ts`

**Было:**
```typescript
private aggregatePosition(existing: ExecutionRecord | null, signal: ConfirmedSignal): ExecutionRecord {
  if (!existing) {
    return {
      id: leg.id,
      // ...
      // ❌ НЕТ sessionId!
    };
  }
}
```

**Проблема:**
- Новые позиции создавались без `sessionId`
- Привязка к сессии существовала только в БД, не в Redis

---

### **3. WebSocket отправлял ВСЕ позиции**

**Файл:** `backend/src/websocket.ts`

**Было:**
```typescript
const openPositions = await executionManager.getOpenPositions();  // ❌ ВСЕ!
const recentExecutions = await executionManager.getExecutions(50); // ❌ ВСЕ!
```

**Проблема:**
- `getOpenPositions()` возвращал ВСЕ позиции из Redis
- Не было фильтрации по текущей сессии
- UI показывал позиции из других сессий

---

### **4. broadcastSnapshot не фильтровал**

**Файл:** `backend/src/modules/scanner/adapters.ts`

**Было:**
```typescript
async broadcastSnapshot(): Promise<void> {
  const open = await this.getOpenPositions();  // ❌ ВСЕ!
  const recent = await this.getExecutions(50); // ❌ ВСЕ!
  await broadcast({ type: 'executions_snapshot', payload: { open, recent } });
}
```

**Проблема:**
- При запуске сканера отправлялись все позиции
- Не было изоляции между сессиями

---

## ✅ Исправления

### **Исправление 1: Добавлен sessionId в ExecutionRecord**

**Файл:** `backend/src/modules/scanner/scanner.types.ts`

```typescript
export interface ExecutionRecord {
  id: string
  positionKey?: string
  pairSymbol: string
  timeframe: string
  // ...existing fields...
  sessionId?: string  // ✅ НОВОЕ: Для изоляции позиций между сессиями
  source?: string     // ✅ НОВОЕ: Источник создания (для restore)
}
```

---

### **Исправление 6: REST API `/scanner/executions` теперь изолирован по сессии**

**Файл:** `backend/src/modules/scanner/routes.ts`

```typescript
router.get('/executions', async (req, res) => {
  const requestedSessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined;
  const currentSessionId = requestedSessionId || sessionManager.getCurrentSessionId();

  if (!currentSessionId) {
    return res.json({ executions: [], openPositions: [], sessionId: null, mode });
  }

  const executions = await executionManager.getExecutionsBySession(currentSessionId, limit);
  const openPositions = await executionManager.getOpenPositionsBySession(currentSessionId);

  return res.json({ executions, openPositions, sessionId: currentSessionId, mode });
});
```

**Что изменилось:**
- Эндпоинт принимает опциональный `sessionId`.
- При отсутствии активной сессии возвращает пустые массивы.
- Клиент больше не получает позиции/историю других сессий ни через WebSocket, ни через REST.

---

### **Исправление 2: aggregatePosition сохраняет sessionId**

**Файл:** `backend/src/modules/scanner/adapters.ts`

```typescript
private aggregatePosition(existing: ExecutionRecord | null, signal: ConfirmedSignal): ExecutionRecord {
  const leg = this.buildLeg(signal);
  if (!existing) {
    // ✅ НОВОЕ: Получаем текущую сессию для изоляции данных
    const currentSessionId = sessionManager.getCurrentSessionId();
    
    return {
      id: leg.id,
      positionKey: this.buildPositionKey(signal),
      // ...other fields...
      sessionId: currentSessionId || undefined,  // ✅ НОВОЕ: Привязка к сессии
    };
  }
  // ...
}
```

---

### **Исправление 3: restorePosition получает sessionId**

**Файл:** `backend/src/modules/scanner/adapters.ts`

```typescript
async restorePosition(trade: any): Promise<ExecutionRecord | null> {
  try {
    const record: ExecutionRecord = {
      id: trade.id,
      // ...other fields...
      executedAt: trade.entryTimestamp ? trade.entryTimestamp.getTime() : Date.now(),
      status: 'open',
      riskScore: 0,
      source: 'restored',
      sessionId: trade.session?.id || trade.sessionId,  // ✅ ИСПРАВЛЕНО: правильная привязка
    };
    // ...
  }
}
```

---

### **Исправление 4: WebSocket фильтрует по сессии**

**Файл:** `backend/src/websocket.ts`

```typescript
// 3. НОВОЕ: Отправляем snapshot позиций сканнера (только текущей сессии)
try {
  const { executionManager } = await import('@/modules/scanner/adapters');
  const { sessionManager } = await import('@/modules/scanner/services/SessionManager');
  
  if (executionManager && sessionManager) {
    const currentSessionId = sessionManager.getCurrentSessionId();
    
    if (currentSessionId) {
      // ✅ ИСПРАВЛЕНО: Отправляем только позиции текущей сессии
      const openPositions = await executionManager.getOpenPositionsBySession(currentSessionId);
      const recentExecutions = await executionManager.getExecutionsBySession(currentSessionId, 50);
      
      safeSend(ws, { 
        type: 'executions_snapshot', 
        payload: { open: openPositions, recent: recentExecutions } 
      });
      logger.debug(`[WebSocket] Sent ${openPositions.length} open positions for session ${currentSessionId}`);
    } else {
      logger.debug('[WebSocket] No active session, skipping executions snapshot.');
    }
  }
} catch (error) {
  logger.warn('[WebSocket] Scanner not running:', error);
}
```

---

### **Исправление 5: broadcastSnapshot фильтрует**

**Файл:** `backend/src/modules/scanner/adapters.ts`

```typescript
async broadcastSnapshot(): Promise<void> {
  await this.init();
  // ✅ ИСПРАВЛЕНО: Фильтруем по текущей сессии
  const currentSessionId = sessionManager.getCurrentSessionId();
  
  if (currentSessionId) {
    const open = await this.getOpenPositionsBySession(currentSessionId);
    const recent = await this.getExecutionsBySession(currentSessionId, 50);
    await broadcast({ type: 'executions_snapshot', payload: { open, recent } });
    ADAPTER_LOG.debug(`Broadcasting snapshot for session ${currentSessionId}: ${open.length} open, ${recent.length} recent`);
  } else {
    // Если нет активной сессии, отправляем пустой snapshot
    await broadcast({ type: 'executions_snapshot', payload: { open: [], recent: [] } });
    ADAPTER_LOG.debug('No active session, broadcasting empty snapshot');
  }
}
```

---

## 🧪 Тестирование

### **Сценарий 1: Создание новой сессии**

**Шаги:**
1. Остановить текущую сессию (если есть)
2. Создать новую сессию "Test Session 1"
3. Запустить сканнер
4. Открыть DevTools → Network → WS
5. Проверить сообщение `executions_snapshot`

**Ожидаемый результат:**
```json
{
  "type": "executions_snapshot",
  "payload": {
    "open": [],      // ✅ Пустой массив!
    "recent": []     // ✅ Пустой массив!
  }
}
```

---

### **Сценарий 2: Открытие позиции**

**Шаги:**
1. Дождаться сигнала
2. Позиция открыта
3. Проверить в DevTools

**Ожидаемый результат:**
```json
{
  "type": "execution_opened",
  "payload": {
    "id": "xxx",
    "pairSymbol": "BTCUSDT",
    "sessionId": "current-session-id",  // ✅ Есть sessionId!
    // ...
  }
}
```

---

### **Сценарий 3: Переключение между сессиями**

**Шаги:**
1. Создать Session A, открыть 1 позицию
2. Остановить Session A
3. Создать Session B, запустить
4. Проверить WebSocket snapshot

**Ожидаемый результат:**
```json
{
  "type": "executions_snapshot",
  "payload": {
    "open": [],      // ✅ Нет позиций из Session A!
    "recent": []
  }
}
```

**В UI:**
- Session B показывает 0 открытых позиций ✅
- Session B показывает 0 истории ✅
- Позиция из Session A НЕ отображается ✅

---

### **Сценарий 4: Перезапуск той же сессии**

**Шаги:**
1. Session A с 1 открытой позицией
2. Остановить сканнер
3. Перезапустить сканнер (ту же Session A)
4. Обновить страницу

**Ожидаемый результат:**
```log
✅ Found open positions to restore: 1
✅ Restoring positions for session: session-a-id
✅ Position restored with sessionId
```

```json
{
  "type": "executions_snapshot",
  "payload": {
    "open": [
      {
        "id": "xxx",
        "pairSymbol": "BTCUSDT",
        "sessionId": "session-a-id",  // ✅ Правильная сессия!
        // ...
      }
    ]
  }
}
```

**В UI:**
- Позиция отображается ✅
- Правильные данные (pair, direction, SL/TP) ✅

---

## 📊 Архитектура Изоляции

### **До Исправлений:**

```
Redis: scanner:positions:open
├─ Position 1 (Session A) ❌ Нет sessionId
├─ Position 2 (Session B) ❌ Нет sessionId
└─ Position 3 (Session C) ❌ Нет sessionId

WebSocket → getOpenPositions() → ВСЕ 3 позиции ❌
```

### **После Исправлений:**

```
Redis: scanner:positions:open
├─ Position 1 { sessionId: "session-a" } ✅
├─ Position 2 { sessionId: "session-b" } ✅
└─ Position 3 { sessionId: "session-c" } ✅

Session Manager: currentSessionId = "session-b"

WebSocket → getOpenPositionsBySession("session-b")
         → filter(pos => pos.sessionId === "session-b")
         → ТОЛЬКО Position 2 ✅
```

---

## 🔄 Жизненный Цикл Позиции

### **1. Создание (новая позиция)**

```typescript
signal confirmed
  ↓
executionManager.recordExecution()
  ↓
aggregatePosition() 
  ↓
currentSessionId = sessionManager.getCurrentSessionId()  // "session-123"
  ↓
ExecutionRecord created with sessionId: "session-123" ✅
  ↓
Redis: HSET scanner:positions:open position-id "{...sessionId: 'session-123'}"
  ↓
broadcast: execution_opened (with sessionId)
```

### **2. Восстановление (после перезапуска)**

```typescript
Scanner starts with sessionId: "session-123"
  ↓
SessionManager.restoreAndValidateOpenPositions("session-123")
  ↓
DB: SELECT * FROM scanner_trades WHERE session_id = 'session-123' AND exit_timestamp IS NULL
  ↓
For each trade:
  executionManager.restorePosition(trade)
    ↓
    ExecutionRecord created with sessionId: trade.session.id ✅
    ↓
    Redis: HSET scanner:positions:open ...
```

### **3. Отправка в UI**

```typescript
WebSocket connected
  ↓
sessionManager.getCurrentSessionId()  // "session-123"
  ↓
executionManager.getOpenPositionsBySession("session-123")
  ↓
allPositions.filter(pos => pos.sessionId === "session-123") ✅
  ↓
safeSend(ws, { type: 'executions_snapshot', payload: { open: [...] } })
```

---

## 🎯 Преимущества

### **1. Полная Изоляция Сессий ✅**
- Каждая сессия видит только свои позиции
- Нет "утечки" данных между сессиями
- Безопасное параллельное использование

### **2. Правильное Восстановление ✅**
- После перезапуска восстанавливаются только позиции текущей сессии
- Исторические сессии не мешают текущей

### **3. Чистый UI ✅**
- Отображаются только релевантные данные
- Нет путаницы с позициями из других сессий

### **4. Масштабируемость ✅**
- Можно безопасно создавать множество сессий
- Каждая сессия независима
- История всех сессий хранится в БД

---

## ⚠️ Важные Замечания

### **1. Миграция Старых Позиций**

Старые позиции в Redis (без sessionId) будут:
- Возвращаться методом `getOpenPositions()` ✅
- НЕ возвращаться методом `getOpenPositionsBySession()` ❌
- Отфильтровываться как `undefined`

**Решение:**
- При очистке Redis старые позиции удалятся автоматически
- Или можно запустить миграцию:

```typescript
// Скрипт миграции (если нужно)
async function migrateOldPositions() {
  const allPositions = await executionManager.getOpenPositions();
  const currentSessionId = sessionManager.getCurrentSessionId();
  
  for (const pos of allPositions) {
    if (!pos.sessionId) {
      // Закрыть старую позицию без sessionId
      await executionManager.closePosition(pos.id, {
        exitPrice: pos.entryPrice,
        exitAt: Date.now(),
        exitReason: 'manual',
      });
    }
  }
}
```

---

### **2. Метод clearAll() очищает ВСЁ**

```typescript
async clearAll(): Promise<void> {
  await this.redis.del(EXECUTION_KEY);
  await this.redis.del(OPEN_POSITIONS_KEY);
  await this.redis.del(POSITION_INDEX_KEY);
  // ⚠️ Очищает позиции ВСЕХ сессий!
}
```

**Рекомендация:**
- Использовать только при полном сбросе
- Для очистки одной сессии использовать другой метод

**TODO:** Создать `clearSession(sessionId)`:
```typescript
async clearSession(sessionId: string): Promise<void> {
  const positions = await this.getOpenPositionsBySession(sessionId);
  for (const pos of positions) {
    await this.removePosition(pos);
  }
}
```

---

## 📝 Файлы Изменены

1. **`backend/src/modules/scanner/scanner.types.ts`**
   - Добавлен `sessionId?` в `ExecutionRecord`
   - Добавлен `source?` для отслеживания происхождения

2. **`backend/src/modules/scanner/adapters.ts`**
   - `aggregatePosition()`: добавлено сохранение `sessionId`
   - `restorePosition()`: исправлено получение `sessionId` из trade
   - `broadcastSnapshot()`: фильтрация по текущей сессии

3. **`backend/src/websocket.ts`**
   - При подключении отправляются только позиции текущей сессии
   - Использование `getOpenPositionsBySession()` и `getExecutionsBySession()`

---

## 🎉 Результат

### **До:**
- ❌ WebSocket отправлял ВСЕ позиции из Redis
- ❌ UI показывал позиции из других сессий
- ❌ Путаница между сессиями
- ❌ Нет изоляции данных

### **После:**
- ✅ WebSocket отправляет ТОЛЬКО позиции текущей сессии
- ✅ UI показывает только релевантные данные
- ✅ Полная изоляция между сессиями
- ✅ Правильное восстановление после перезапуска

---

## 🚀 Следующие Шаги

1. **Перезапустить Backend** для применения изменений
2. **Очистить Redis** (опционально):
   ```bash
   redis-cli FLUSHALL
   ```
3. **Создать новую сессию** и проверить изоляцию
4. **Протестировать сценарии** из раздела "Тестирование"

---

**Дата:** 18.10.2025  
**Автор:** AI Senior Assistant  
**Статус:** ✅ **READY FOR TESTING**




