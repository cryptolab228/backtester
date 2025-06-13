# Исправление проблемы отображения графиков сделок

## Проблема
При клике на сделки в результатах бектеста:
- **Bitcoin/Ethereum**: График отображается корректно с данными до входа в сделку (6 января)
- **SOL**: График начинается с 21 апреля, нет предыдущих свечей, уровни входа/tp/sl не совпадают

## Анализ причин

### 1. Состояние данных в базе
**Анализ показал неравномерное покрытие данных:**

```
SOL-USDT-SWAP:
- 1h:   12,337 свечей (2023-12-31 → 2025-05-28) ✅ Покрывает период бектеста
- 15m:   3,553 свечи (2025-04-21 → 2025-05-28) ❌ Начинается в будущем!
- 5m:         0 свечей                          ❌ Данные отсутствуют
- 4h:       100 свечей (2025-05-02 → 2025-05-19) ❌ Неполные данные
- 1d:       100 свечей (2025-02-03 → 2025-05-13) ❌ Неполные данные

BTC-USDT-SWAP и ETH-USDT-SWAP:
- 1h: Данные с 2023-12-31 ✅ Полное покрытие всех нужных периодов
- Другие таймфреймы также более полные
```

### 2. Проблемы в логике фронтенда

**BacktesterView.vue - функция openTradeChart:**
- Пыталась загрузить 5m данные (которых нет для SOL)
- Неправильная приоритизация таймфреймов
- Недостаточная валидация временных диапазонов
- Слабая обработка случаев отсутствия данных

**TradeChartModal.vue:**
- Ожидала данные в формате `{timestamp: ...}`, но API возвращает `{openTime: ...}`
- Недостаточная нормализация входных данных
- Проблемы с определением временных интервалов

## Реализованное решение

### 1. Улучшенная логика в BacktesterView.vue

```javascript
// КРИТИЧНОЕ ИСПРАВЛЕНИЕ: Валидация временных диапазонов
const now = Date.now();
const earliestReasonableDate = new Date('2020-01-01').getTime();

// Корректируем startTime если он слишком ранний или в будущем
if (startTime < earliestReasonableDate) {
  startTime = Math.max(earliestReasonableDate, trade.entryTimestamp - 30 * 24 * 60 * 60 * 1000);
}

// УЛУЧШЕННАЯ ПРИОРИТИЗАЦИЯ ТАЙМФРЕЙМОВ
const priorityTimeframes = [backtestTimeframe]; // Всегда начинаем с таймфрейма бектеста

// Исключаем проблемные таймфреймы (5m, 1m)
const fallbackTimeframes = ['1h', '4h', '1d', '15m']; 

// УЛУЧШЕННАЯ ПРОВЕРКА ДАННЫХ
const coversTradeEntry = dataStartTime <= trade.entryTimestamp && dataEndTime >= trade.entryTimestamp;

// Принимаем данные если они покрывают время входа ИЛИ если это лучшее что у нас есть
if (coversTradeEntry || tempApiData.data.length >= 100) {
  selectedTimeframe = timeframe;
  apiData = tempApiData;
  break;
}
```

### 2. Улучшенная обработка данных в TradeChartModal.vue

```javascript
// НОРМАЛИЗАЦИЯ ДАННЫХ: Поддержка разных форматов API
const normalizedCandles = rawCandles.map((candle, index) => {
  // Определяем timestamp из разных возможных полей
  let timestamp: number;
  
  if (candle.timestamp) {
    timestamp = candle.timestamp;
  } else if (candle.openTime) {  // ← Исправление для API формата
    timestamp = candle.openTime;
  } else if (candle.time) {
    timestamp = candle.time;
  }
  
  // Нормализуем к миллисекундам
  if (timestamp < 10000000000) {
    timestamp = timestamp * 1000;
  }
  
  // Валидация временных диапазонов
  const earliestDate = new Date('2020-01-01').getTime();
  const latestDate = now + 365 * 24 * 60 * 60 * 1000;
  
  if (timestamp < earliestDate || timestamp > latestDate) {
    return null; // Исключаем некорректные данные
  }
})

// УМНОЕ ОПРЕДЕЛЕНИЕ ВРЕМЕННОГО ИНТЕРВАЛА
const intervals: number[] = [];
for (let i = 1; i < Math.min(normalizedCandles.length, 10); i++) {
  const interval = (normalizedCandles[i].timestamp - normalizedCandles[i-1].timestamp) / 1000;
  if (interval > 0 && interval < 24 * 60 * 60) {
    intervals.push(interval);
  }
}

// Используем медианный интервал для защиты от выбросов
const medianInterval = intervals[Math.floor(intervals.length / 2)];
timeInterval = Math.round(medianInterval);
```

### 3. Улучшенные уведомления пользователю

```javascript
// Информативные toast уведомления
if (!isBacktestTimeframe) {
  safeToast({
    severity: 'info',
    summary: 'Альтернативный таймфрейм',
    detail: `Данные для таймфрейма бектеста (${backtestTimeframe}) недоступны. Используется ${selectedTimeframe}.`
  });
} else if (!coversTradeEntry) {
  safeToast({
    severity: 'warn', 
    summary: 'Ограниченные данные',
    detail: `Данные не полностью покрывают время сделки. Доступен диапазон: ${dateRange}`
  });
}
```

## Результат

**До исправления:**
- SOL графики не отображались или показывали некорректные данные
- Пользователь получал ошибку "No valid candles after filtering"
- Уровни входа/выхода не совпадали с графиком

**После исправления:**
- SOL графики отображаются с доступными 1h данными
- Корректная обработка разных форматов API данных
- Информативные уведомления о статусе данных
- Graceful degradation при отсутствии предпочтительных таймфреймов
- Правильное позиционирование маркеров входа/выхода

## Дополнительные возможности

Добавлены кнопки для загрузки недостающих данных:
- "Загрузить данные 5m" 
- "Загрузить данные 15m"
- "Попробовать другой таймфрейм"

Это позволяет пользователю самостоятельно инициировать загрузку недостающих исторических данных.

## Файлы изменены

1. `frontend/src/views/BacktesterView.vue` - улучшена функция `openTradeChart`
2. `frontend/src/components/TradeChartModal.vue` - улучшена обработка входных данных
3. Созданы диагностические скрипты: `analyze-sol-data.js`, `test-sol-api.js`

## Заключение

Проблема была в комбинации неполных данных в базе и недостаточно робустной логике обработки на фронтенде. Решение обеспечивает:

1. **Надёжность**: Работает даже при неполных данных
2. **Информативность**: Пользователь понимает что происходит  
3. **Гибкость**: Поддержка разных форматов API данных
4. **Расширяемость**: Возможность загрузки недостающих данных 