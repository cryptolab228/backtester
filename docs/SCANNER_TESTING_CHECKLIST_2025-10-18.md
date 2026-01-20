# Чек-лист Тестирования Сканера (Финальный)

**Дата:** 2025-10-18  
**Цель:** Проверить исправления режима выполнения и изоляции сессий

---

## 🛠️ Подготовка

### 1. Проверка Конфигурации

```bash
# Проверить executionMode в конфиге
cd d:\backtesterv2\backend
grep -A 5 "executionMode" src/config/scanner.config.ts
```

**Ожидаемый результат:**
```typescript
executionMode: (process.env.SCANNER_EXECUTION_MODE as ExecutionMode) || 'demo',
```

Убедитесь, что в `.env`:
```
SCANNER_EXECUTION_MODE=demo
BYBIT_DEMO_API_KEY=your_demo_key
BYBIT_DEMO_API_SECRET=your_demo_secret
```

### 2. Очистка Старых Данных

```bash
# Остановить backend (если запущен)
# Ctrl+C в терминале где npm run dev

# Перезапустить Redis (опционально)
# Если хотите полностью очистить кэш
redis-cli FLUSHDB

# Запустить backend
npm run dev
```

---

## ✅ Тест 1: Режим Выполнения (КРИТИЧЕСКИЙ)

### Цель
Убедиться, что новая сессия использует `executionMode` из `config`, а не дефолтный 'live'.

### Шаги

1. **Открыть UI** → `http://localhost:5173`
2. **Создать новую сессию:**
   - Name: `Test Demo Execution`
   - Pairs: `BTCUSDT`
   - Timeframes: `15m`
   - **НЕ указывать** режим (mode) явно
3. **Запустить сессию**
4. **Дождаться первого сигнала**

### Проверка Логов

```bash
# В реальном времени смотрим логи
tail -f backend/logs/combined.log | grep -E "execution_opened|Live execution|Network execution|executionMode"
```

**✅ УСПЕХ:**
```log
info: Starting scanner with session ... "mode":"demo"
debug: MultiModeExecutionAdapter initialized {"mode":"demo"}
info: Network execution (DEMO) successful {"pair":"BTCUSDT","side":"Buy","price":67890}
```

**❌ ПРОВАЛ:**
```log
info: Live execution placeholder {"pair":"BTCUSDT"}
```

### Проверка Bybit Demo Account

1. Перейти на [Bybit Testnet](https://testnet.bybit.com)
2. Проверить раздел **Positions** (Позиции)
3. Должна появиться новая позиция:
   - Symbol: `BTCUSDT`
   - Side: Long/Short (в зависимости от сигнала)
   - Qty: ~1 (или другое значение в зависимости от риска)

**✅ УСПЕХ:** Позиция видна на бирже  
**❌ ПРОВАЛ:** Позиции нет на бирже

---

## ✅ Тест 2: Изоляция Сессий

### Цель
Убедиться, что при создании новой сессии старые позиции не отображаются в UI.

### Шаги

#### 2.1. Первая Сессия

1. **Создать сессию:** `Session A`
2. **Запустить и дождаться 1-2 сигналов**
3. **Зафиксировать позиции в UI** (сделать скриншот или записать)
4. **Остановить сканер** (Stop Scanner)

#### 2.2. Вторая Сессия

5. **Создать новую сессию:** `Session B`
6. **Запустить сессию**
7. **Обновить страницу UI** (F5)

### Проверка UI

**Открыть DevTools → Network → WS (WebSocket)**

Найти сообщение `executions_snapshot`:
```json
{
  "type": "executions_snapshot",
  "payload": {
    "open": [],      // <--- Должно быть ПУСТЫМ для новой сессии!
    "recent": []     // <--- Должно быть ПУСТЫМ
  }
}
```

**✅ УСПЕХ:** 
- UI показывает 0 открытых позиций
- WebSocket snapshot пустой
- Позиции из Session A НЕ видны

**❌ ПРОВАЛ:**
- Видны старые позиции из Session A

### Проверка Логов

```bash
grep "Broadcasting snapshot for session" backend/logs/combined.log | tail -5
```

**Должно быть:**
```log
debug: Broadcasting snapshot for session SESSION_B_ID: 0 open, 0 recent
```

---

## ✅ Тест 3: Восстановление Позиций При Перезапуске

### Цель
Убедиться, что при перезапуске той же сессии позиции восстанавливаются из БД.

### Шаги

1. **Запустить Session A** (из предыдущего теста)
2. **Дождаться открытия 1-2 позиций**
3. **НЕ ОСТАНАВЛИВАЯ сканер, убить процесс backend:**
   ```bash
   # В терминале где npm run dev
   Ctrl+C
   ```
4. **Запустить backend снова:**
   ```bash
   npm run dev
   ```

### Проверка Логов

```bash
grep "Restored session after crash" backend/logs/combined.log
grep "Restored position from database" backend/logs/combined.log
```

**✅ УСПЕХ:**
```log
info: Restored session after crash {"sessionId":"SESSION_A_ID"}
info: Skipping Redis cleanup due to session auto-restore {"sessionId":"SESSION_A_ID"}
debug: Restored position from database {"positionId":"...","pair":"BTCUSDT","sessionId":"SESSION_A_ID"}
```

### Проверка UI

1. **Обновить страницу** (F5)
2. **Позиции должны появиться**

**✅ УСПЕХ:** Открытые позиции из Session A видны в UI  
**❌ ПРОВАЛ:** Позиции потеряны

---

## ✅ Тест 4: Данные Прошлых Сессий в БД

### Цель
Убедиться, что все сделки всех сессий сохранены в PostgreSQL.

### Проверка SQL

```bash
# Подключиться к PostgreSQL
psql -U testuser -d backtester_dev

# Выполнить запрос
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
WHERE ts.source = 'scanner'
GROUP BY ts.id
ORDER BY ts.created_at DESC;
```

**✅ УСПЕХ:**
```
 id | name     | status    | mode | total_trades | open_trades | closed_trades
----+----------+-----------+------+--------------+-------------+--------------
 10 | Session B| running   | demo | 2            | 2           | 0
  9 | Session A| completed | demo | 5            | 0           | 5
```

**❌ ПРОВАЛ:** Данных нет или неполные

### Детальная Проверка Сделок

```sql
SELECT 
  st.id,
  st.pair,
  st.direction,
  st.entry_price,
  st.exit_price,
  st.realized_pnl,
  st.status,
  st.entry_timestamp,
  st.session_id
FROM session_trades st
WHERE st.session_id = 'SESSION_A_ID'
ORDER BY st.entry_timestamp DESC;
```

**✅ УСПЕХ:** Все сделки Session A присутствуют со всеми деталями

---

## ✅ Тест 5: Redis Очистка При Смене Сессии

### Цель
Убедиться, что Redis очищается при запуске новой сессии.

### Шаги

1. **Session A: запущена, есть открытые позиции**
2. **Проверить Redis:**
   ```bash
   redis-cli HGETALL "scanner:positions:open:v2"
   ```
   Должны быть позиции.

3. **Остановить Session A** (Stop Scanner)
4. **Проверить Redis снова:**
   ```bash
   redis-cli HGETALL "scanner:positions:open:v2"
   ```
   **✅ УСПЕХ:** Пустой ответ `(empty array)`

5. **Создать и запустить Session B**
6. **Дождаться первого сигнала**
7. **Проверить Redis:**
   ```bash
   redis-cli HGETALL "scanner:positions:open:v2"
   ```
   **✅ УСПЕХ:** Есть ТОЛЬКО позиции Session B (с правильным `sessionId`)

### Проверка sessionId в Redis

```bash
redis-cli HGETALL "scanner:positions:open:v2" | grep -A 100 "{" | jq '.sessionId'
```

**✅ УСПЕХ:** Все позиции имеют `sessionId` равный `SESSION_B_ID`  
**❌ ПРОВАЛ:** sessionId отсутствует или неправильный

---

## 📊 Ожидаемые Результаты

| Тест | Что проверяем | Статус |
|------|---------------|--------|
| 1 | Режим выполнения = demo | ✅ |
| 2 | Изоляция сессий | ✅ |
| 3 | Восстановление после сбоя | ✅ |
| 4 | Данные в БД | ✅ |
| 5 | Очистка Redis | ✅ |

---

## 🐛 Что Делать При Провале Теста

### Тест 1 провален (Режим = live)

**Проблема:** `scanner.session.controller.ts` не обновлён

**Исправление:**
```typescript
// backend/src/modules/scanner/scanner.session.controller.ts:62
const effectiveMode = mode || require('@/config').default.scanner.executionMode;
```

**Проверка:**
```bash
grep "effectiveMode" backend/src/modules/scanner/scanner.session.controller.ts
```

---

### Тест 2 провален (Старые позиции видны)

**Проблема:** WebSocket отправляет все позиции без фильтрации

**Исправление:**
```typescript
// backend/src/websocket.ts:194
const openPositions = await executionManager.getOpenPositionsBySession(currentSessionId);
```

**Проверка:**
```bash
grep "getOpenPositionsBySession" backend/src/websocket.ts
```

---

### Тест 3 провален (Позиции не восстановились)

**Проблема:** `autoStarted` флаг не передаётся или `sessionId` не сохраняется

**Исправление:**
1. Проверить `scanner.bootstrap.ts:44-52` (restoreLastActiveSession)
2. Проверить `adapters.ts:730` (sessionId в restorePosition)

**Проверка:**
```bash
grep "autoStarted" backend/src/modules/scanner/scanner.bootstrap.ts
```

---

### Тест 4 провален (Данных нет в БД)

**Проблема:** `sessionManager.recordTrade()` не вызывается

**Исправление:**
```typescript
// backend/src/modules/scanner/adapters.ts:493
await sessionManager.recordTrade({ sessionId, ... });
```

**Проверка:**
```bash
grep "sessionManager.recordTrade" backend/src/modules/scanner/adapters.ts
```

---

### Тест 5 провален (Redis не очищается)

**Проблема:** `clearAll()` не вызывается в `scanner.bootstrap.ts`

**Исправление:**
```typescript
// scanner.bootstrap.ts:89-92
await signalQueue.clearAll();
await executionManager.clearAll();
```

**Проверка:**
```bash
grep "clearAll" backend/src/modules/scanner/scanner.bootstrap.ts
```

---

## 📝 Лог Тестирования (Заполнить)

```
Дата: _____________
Тестировщик: _____________

Тест 1 (Режим): [ ] PASS [ ] FAIL
  Комментарий: ___________________________________

Тест 2 (Изоляция): [ ] PASS [ ] FAIL
  Комментарий: ___________________________________

Тест 3 (Восстановление): [ ] PASS [ ] FAIL
  Комментарий: ___________________________________

Тест 4 (БД): [ ] PASS [ ] FAIL
  Комментарий: ___________________________________

Тест 5 (Redis): [ ] PASS [ ] FAIL
  Комментарий: ___________________________________

Общий результат: [ ] ВСЕ ТЕСТЫ ПРОШЛИ [ ] ЕСТЬ ОШИБКИ
```

---

## 🎯 Следующие Шаги После Успешного Тестирования

1. ✅ **Обновить TODO** - отметить задачи 23, 24 как completed
2. ✅ **Зафиксировать изменения** (git commit)
3. ✅ **Перейти к интеграции futures профилей** в сканер
4. ✅ **Оптимизация параметров** на исторических данных

---

**Важно:** Все исправления должны работать корректно перед переходом к следующему этапу!




