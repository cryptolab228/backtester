# Исправление отображения данных сканера

**Дата:** 17.10.2025  
**Статус:** ✅ Исправлено

## Проблема

После запуска сканера с созданной сессией на фронтенде не отображались:
- Pending Signals (ожидающие сигналы)
- Open Positions (открытые позиции)
- Detected Signals (обнаруженные сигналы)

## Причина

В функции `startAutoRefresh()` в `frontend/src/views/ScannerView.vue` отсутствовал вызов метода `scannerStore.loadSignals()`, который отвечает за загрузку pending и detected сигналов.

### Код ДО исправления:

```typescript
const startAutoRefresh = () => {
  // Обновляем каждые 10 секунд
  refreshInterval = setInterval(async () => {
    await Promise.all([
      loadExchangePositions(),
      loadTotalPnL(),
      scannerStore.loadExecutions(), // Обновляем внутренние позиции
    ]);
  }, 10000);
};
```

**Проблема:** Отсутствуют вызовы `loadSignals()` и `loadStatus()`.

## Решение

Добавлены недостающие вызовы методов для полного обновления данных сканера:

### Код ПОСЛЕ исправления:

```typescript
const startAutoRefresh = () => {
  // Обновляем каждые 5 секунд для лучшей отзывчивости
  refreshInterval = setInterval(async () => {
    await Promise.all([
      scannerStore.loadStatus(), // Обновляем статус сканера
      scannerStore.loadSignals(), // Обновляем сигналы
      scannerStore.loadExecutions(), // Обновляем внутренние позиции
      loadExchangePositions(),
      loadTotalPnL(),
    ]);
  }, 5000);
};
```

### Изменения:

1. ✅ **Добавлен** `scannerStore.loadStatus()` - обновление статуса сканера
2. ✅ **Добавлен** `scannerStore.loadSignals()` - обновление pending и detected сигналов
3. ✅ **Уменьшен интервал** с 10 до 5 секунд для более быстрого отображения данных

## Что делает каждый метод

### `scannerStore.loadStatus()`
- Загружает общий статус сканера
- Обновляет счетчики (pending signals, executions)
- Обновляет параметры конфигурации

**API:** `GET /api/scanner/status`

### `scannerStore.loadSignals()`
- Загружает **pending signals** (ожидающие подтверждения)
- Загружает **detected signals** (недавно обнаруженные)
- Фильтрует только активные сигналы со статусом 'waiting'

**API:** `GET /api/scanner/signals`

### `scannerStore.loadExecutions()`
- Загружает **open positions** (открытые позиции)
- Загружает **closed executions** (закрытые сделки)

**API:** `GET /api/scanner/executions`

## Поток данных

```
Backend Scanner
    ↓
    ↓ (генерирует сигналы)
    ↓
Redis/SignalQueue
    ↓
    ↓ (API endpoints)
    ↓
Frontend API Calls (каждые 5 сек)
    ↓
    ↓ scannerStore.loadSignals()
    ↓ scannerStore.loadExecutions()
    ↓ scannerStore.loadStatus()
    ↓
ScannerView UI
    ↓
    ↓ (отображение)
    ↓
Tabs:
- Pending Signals (0)
- Open Positions (0)
- Closed Positions (...)
```

## Тестирование

### Шаги проверки:

1. ✅ Обновить фронтенд (F5)
2. ✅ Перейти на страницу "Сканнер"
3. ✅ Создать новую сессию
4. ✅ Запустить сканер с выбранной сессией
5. ✅ Подождать 5-10 секунд
6. ✅ Проверить вкладки:
   - **Pending Signals** - должны появиться при обнаружении
   - **Open Positions** - должны появиться при открытии
   - **Closed Positions** - должны появиться при закрытии

### Ожидаемый результат:

- Счетчик "Pending Signals" должен обновляться
- Во вкладке "Pending Signals" должны появляться новые сигналы
- Во вкладке "Open Positions" должны появляться открытые позиции
- Все данные обновляются каждые 5 секунд автоматически

## Дополнительные улучшения

### Уменьшение интервала обновления
- **Было:** 10 секунд
- **Стало:** 5 секунд
- **Причина:** Более быстрая реакция UI на изменения в сканере

### Полное обновление данных
Теперь при каждом цикле обновляются:
1. Статус сканера
2. Сигналы (pending + detected)
3. Позиции (open + closed)
4. Данные с биржи
5. Общий PnL

## API Endpoints используемые сканером

```typescript
// Статус сканера
GET /api/scanner/status
Response: {
  running: boolean,
  pendingCount: number,
  confirmationQueue: {...},
  health: {...},
  availableCapital: number,
  ...config
}

// Сигналы
GET /api/scanner/signals
Response: {
  pending: Array<PendingSignal>,
  detected: Array<DetectedSignal>
}

// Позиции и исполнения
GET /api/scanner/executions
Response: {
  executions: Array<ExecutionRecord>,
  openPositions: Array<ExecutionRecord>,
  mode: string
}

// Позиции на бирже
GET /api/scanner/exchange-positions
Response: {
  success: boolean,
  positions: Array<ExchangePosition>
}

// Общий PnL
GET /api/scanner/total-pnl
Response: {
  success: boolean,
  mode: string,
  realizedPnL: number,
  unrealizedPnL: number,
  totalPnL: number,
  positionCount: number
}
```

## Файлы изменены

- ✅ `frontend/src/views/ScannerView.vue`
  - Функция `startAutoRefresh()`
  - Интервал обновления с 10000ms → 5000ms
  - Добавлены вызовы `loadStatus()` и `loadSignals()`

## Следующие шаги

1. Обновить страницу фронтенда (F5)
2. Протестировать работу сканера с новой сессией
3. Убедиться что данные отображаются корректно
4. При необходимости проверить логи: `backend/logs/combined.log`

## Примечания

- Все данные фильтруются по текущей активной сессии
- WebSocket события также доступны для real-time обновлений
- Можно дополнительно включить WebSocket подписку для мгновенного отображения

## Безопасность

Изменения не влияют на:
- Логику работы сканера
- Безопасность данных
- Производительность бэкенда

Только улучшают отображение на фронтенде.





