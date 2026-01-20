# Сравнение алгоритмов Сканнера и Бэктестера

## 📊 Общая архитектура

### Бэктестер (Backtester)
- **Режим работы**: Исторический анализ (оффлайн)
- **Источник данных**: Готовые исторические свечи из БД
- **Обработка**: Последовательный перебор всех свечей в цикле
- **Цель**: Оценка эффективности стратегии на исторических данных

### Сканнер (Scanner)
- **Режим работы**: Реальное время (онлайн)
- **Источник данных**: Живые данные с биржи через `LiveMarketDataSource`
- **Обработка**: Периодические циклы по расписанию (интервалы)
- **Цель**: Обнаружение и подтверждение торговых сигналов в реальном времени

---

## 🔍 Обнаружение сигналов

### Бэктестер

**Файл**: `backend/src/modules/backtester/backtester.ts`

```typescript
// Строки 745-766
if (currentCandle.entryConditionLong && currentCandle.signalStrength > 0) {
  direction = TradeDirection.LONG;
  signalStrength = currentCandle.signalStrength;
} else if (currentCandle.entryConditionShort && currentCandle.signalStrength > 0) {
  direction = TradeDirection.SHORT;
  signalStrength = currentCandle.signalStrength;
}

// Если есть сигнал, добавляем его в список ожидающих сигналов
if (direction && signalStrength > 0) {
  pendingSignalsAtTimestamp.push({
    pairSymbol,
    direction,
    signalStrength,
    candle: currentCandle,
  });
}
```

**Особенности**:
- ✅ Сигнал обнаруживается **мгновенно** на каждой свече
- ✅ Все свечи уже имеют рассчитанные индикаторы (`entryConditionLong/Short`, `signalStrength`)
- ✅ Нет задержек - данные уже готовы
- ✅ Сигналы накапливаются в `pendingSignalsAtTimestamp` для обработки в конце временного шага

### Сканнер

**Файл**: `backend/src/modules/scanner/engines/basicSignalEngine.ts`

```typescript
// Строки 15-101
async evaluate(candles: any[], context: SignalContext): Promise<SignalMetadata | null> {
  const strategyParams = getDefaultStrategyParameters();
  
  // 1. ВЫЗЫВАЕМ applyStrategyLogic для расчета индикаторов
  const strategyResult = applyStrategyLogic(candles, strategyParams);
  const lastCandle = strategyResult.strategyCandles?.[strategyResult.strategyCandles.length - 1];

  if (!lastCandle) return null;

  // 2. Проверяем условия входа
  const direction = lastCandle.entryConditionLong
    ? 'long'
    : lastCandle.entryConditionShort
    ? 'short'
    : null;

  if (!direction) return null;

  // 3. Формируем сигнал
  const signal: SignalMetadata = {
    pairSymbol: context.pairSymbol,
    timeframe: context.timeframe,
    detectedAt: lastCandle.timestamp ?? Date.now(),
    direction,
    entryPrice: lastCandle.close,
    stopLoss: ...,
    takeProfit: ...,
  };

  return signal;
}
```

**Особенности**:
- ⚠️ Индикаторы рассчитываются **в реальном времени** при каждом вызове
- ⚠️ Вызывается `applyStrategyLogic` на **всех 600 свечах** каждый цикл
- ⚠️ Более высокая нагрузка на CPU
- ✅ Гибкость - можно изменять параметры стратегии на лету

---

## ⏱️ Подтверждение сигналов

### Бэктестер

**НЕТ МЕХАНИЗМА ПОДТВЕРЖДЕНИЯ**

```typescript
// Сигналы обрабатываются сразу после обнаружения
if (direction && signalStrength > 0) {
  pendingSignalsAtTimestamp.push({...});
}

// В конце временного шага сразу открываются позиции
currentPortfolioCapital = await processPortfolioPendingSignals(
  pendingSignalsAtTimestamp,
  currentPortfolioCapital,
  activeTradesPortfolio,
  maxConcurrentTrades,
  ...
);
```

**Особенности**:
- ✅ Сигнал = немедленный вход в позицию (если есть капитал и слоты)
- ✅ Нет задержек на подтверждение
- ❌ Нет фильтрации ложных сигналов
- ❌ Может входить в позиции по "шуму"

### Сканнер

**ЕСТЬ ДВУХЭТАПНАЯ СИСТЕМА**

**Файл**: `backend/src/modules/scanner/scanner.service.ts`

#### Этап 1: Обнаружение (Detection)

```typescript
// Строки 313-435
private async processSignal(signal: SignalMetadata): Promise<void> {
  // 1. Проверка на дубликаты
  if (this.isDuplicateSignal(signal)) {
    return; // Пропускаем
  }

  // 2. Оценка риска
  const riskScore = this.calculateRiskScore(signal);
  if (riskScore > this.config.riskScoreThreshold) {
    return; // Слишком рискованно
  }

  // 3. Проверка через PortfolioAllocator
  const allocation = await portfolioAllocator.requestAllocation({...});
  if (!allocation.approved) {
    return; // Нет свободных слотов
  }

  // 4. Создание pending signal
  const pending: PendingSignal = {
    id: signalId,
    detectedAt: signal.detectedAt, // ⚠️ ВАЖНО: timestamp свечи обнаружения
    status: 'waiting',
    confirmationAttempts: 0,
    ...
  };

  // 5. Добавление в очередь подтверждения
  await signalQueue.enqueue(pending);
  await confirmationQueueManager.scheduleConfirmation(pending, delay);
}
```

#### Этап 2: Подтверждение (Confirmation)

```typescript
// Строки 518-599
private evaluatePendingSignal(pending: PendingSignal, candles: CandleData[]): 
  'waiting' | 'stop_loss_hit' | 'confirmation_failed' | 'confirm' {
  
  // 1. Фильтруем свечи ПОСЛЕ обнаружения
  const candlesAfterDetection = candles.filter(
    (candle) => candle.timestamp > pending.detectedAt
  );

  // 2. Если нет новых свечей - ждем
  if (!candlesAfterDetection.length) {
    return 'waiting';
  }

  // 3. Проверка Stop Loss
  if (this.isStopLossHit(pending, candlesAfterDetection)) {
    return 'stop_loss_hit';
  }

  // 4. Проверка достижения целевой цены
  const latestCandle = candlesAfterDetection[candlesAfterDetection.length - 1];
  const confirmationOk = this.directionSatisfied(pending, latestCandle);
  
  if (confirmationOk) {
    return 'confirm'; // ✅ Подтверждено!
  }

  // 5. Проверка окна подтверждения
  const requiredWindow = pending.confirmWindowSize ?? this.getConfirmWindowSize(pending.timeframe);
  
  if (candlesAfterDetection.length < requiredWindow) {
    return 'waiting'; // Еще есть время
  }

  return 'confirmation_failed'; // ❌ Время вышло
}
```

**Особенности**:
- ✅ Двухэтапная фильтрация сигналов
- ✅ Проверка движения цены в нужном направлении
- ✅ Окно подтверждения (по умолчанию 2-3 свечи)
- ✅ Защита от ложных пробоев
- ⚠️ Задержка входа в позицию (может пропустить быстрые движения)

---

## 📈 Использование стратегии

### Общая логика стратегии

**Файл**: `backend/src/modules/strategy_logic/strategy.ts`

Оба модуля используют **одну и ту же функцию** `applyStrategyLogic`:

```typescript
// Строки 140-455
export const applyStrategyLogic = (
  candlesInput: CandleData[], 
  params: StrategyParameters
): StrategyLogicResult => {
  // 1. Расчет индикаторов
  const atrValues = calculateATR(candles, atrPeriod);
  const nweValues = calculateNWE(candles, nweParams);
  const avgVolumeValues = calculateAvgVolume(candles, avgVolPeriod);
  const approxDeltaValues = calculateApproxDelta(candles);

  // 2. Расчет Volume Profile (с кэшированием)
  // 3. Определение кластеров
  // 4. Генерация сигналов на основе условий:
  //    - DLC (Volume Profile POC/VAH/VAL)
  //    - NWE (Nadaraya-Watson Envelope)
  //    - Clusters (объемные кластеры)

  // 5. Расчет силы сигнала (signalStrength)
  // 6. Установка Stop Loss и Take Profit

  return { strategyCandles, volumeProfile };
}
```

### Различия в применении

| Аспект | Бэктестер | Сканнер |
|--------|-----------|---------|
| **Частота вызова** | 1 раз для всего датасета | Каждый цикл (каждые N секунд) |
| **Количество свечей** | Весь исторический период | Последние 600 свечей |
| **Кэширование VP** | Эффективно (последовательная обработка) | Менее эффективно (перезапуск каждый цикл) |
| **Параметры стратегии** | Фиксированные на весь тест | Могут меняться в реальном времени |

---

## 🎯 Управление позициями

### Бэктестер

```typescript
// Одновременные позиции управляются через Map
const activeTradesPortfolio = new Map<string, ActiveTrade>();

// Проверка перед входом
if (!activeTradesPortfolio.has(pairSymbol)) {
  // Можно открыть новую позицию
}

// Проверка лимита
if (activeTradesPortfolio.size >= maxConcurrentTrades) {
  // Нельзя открыть больше позиций
}
```

**Особенности**:
- ✅ Простая логика
- ✅ Одна позиция на пару
- ✅ Жесткий лимит `maxConcurrentTrades`

### Сканнер

```typescript
// Управление через PortfolioAllocator
const allocation = await portfolioAllocator.requestAllocation({
  pairSymbol: signal.pairSymbol,
  direction: signal.direction,
  riskScore,
  ...
});

if (!allocation.approved) {
  // Причины: max_concurrent_reached, insufficient_capital, risk_limit_exceeded
  return;
}
```

**Особенности**:
- ✅ Более сложная система управления рисками
- ✅ Учет капитала, риска, корреляций
- ✅ Динамическое распределение капитала
- ⚠️ Может отклонить сигнал даже если есть свободные слоты

---

## 🚨 Ключевые различия

### 1. **Источник данных**

| Бэктестер | Сканнер |
|-----------|---------|
| Готовые свечи из БД с уже рассчитанными индикаторами | Живые свечи с биржи, индикаторы рассчитываются на лету |
| `DataServiceMarketDataSource` | `LiveMarketDataSource` |

### 2. **Обработка сигналов**

| Бэктестер | Сканнер |
|-----------|---------|
| Сигнал → Немедленный вход | Сигнал → Pending → Подтверждение → Вход |
| Нет фильтрации | Двухэтапная фильтрация |

### 3. **Временная логика**

| Бэктестер | Сканнер |
|-----------|---------|
| Последовательный перебор свечей | Периодические циклы |
| Все свечи обрабатываются за один проход | Каждый цикл обрабатывает последние N свечей |
| `detectedAt` = timestamp свечи | `detectedAt` = timestamp свечи (было баг с `Date.now()`) |

### 4. **Производительность**

| Бэктестер | Сканнер |
|-----------|---------|
| Высокая (один проход, кэш работает эффективно) | Средняя (повторные вычисления каждый цикл) |
| Оптимизирован для больших объемов данных | Оптимизирован для низкой задержки |

### 5. **Точность результатов**

| Бэктестер | Сканнер |
|-----------|---------|
| Может быть завышена (нет задержек на подтверждение) | Более реалистична (учитывает задержки) |
| Все сигналы обрабатываются | Часть сигналов отфильтровывается |

---

## 🐛 Проблемы, которые были исправлены

### Проблема 1: `detectedAt` сбрасывался при refresh
**Было**: `detectedAt: Date.now()` при каждом обновлении  
**Стало**: `detectedAt: existing.detectedAt` (сохраняем оригинальное время)

### Проблема 2: Таймер подтверждения отменялся
**Было**: При каждом refresh отменялся и создавался новый таймер  
**Стало**: Таймер продолжает работать, обновляются только данные

### Проблема 3: Неправильная фильтрация свечей
**Было**: `candles.filter(c => c.timestamp >= pending.detectedAt)`  
**Стало**: `candles.filter(c => c.timestamp > pending.detectedAt)`

### Проблема 4: Дедупликация блокировала обновления
**Было**: Повторные сигналы полностью игнорировались  
**Стало**: Используется `refreshPendingSignal` для обновления существующих

---

## 💡 Рекомендации

### Для улучшения сканнера:

1. **Кэширование индикаторов**
   - Не пересчитывать все 600 свечей каждый цикл
   - Рассчитывать только новые свечи

2. **Инкрементальные вычисления**
   - Volume Profile можно обновлять инкрементально
   - ATR, NWE можно рассчитывать только для новых свечей

3. **Оптимизация подтверждения**
   - Использовать WebSocket для мгновенного получения новых свечей
   - Уменьшить окно подтверждения для быстрых таймфреймов

4. **Синхронизация с бэктестером**
   - Добавить режим "без подтверждения" для сравнения с бэктестом
   - Логировать причины отклонения сигналов для анализа

### Для улучшения бэктестера:

1. **Добавить режим с подтверждением**
   - Симулировать задержки как в сканнере
   - Более реалистичные результаты

2. **Учитывать проскальзывание**
   - Добавить slippage при входе/выходе
   - Учитывать спред bid/ask

3. **Комиссии биржи**
   - Вычитать комиссии из PnL
   - Учитывать funding rate для perpetual контрактов

---

## 📊 Итоговая таблица сравнения

| Критерий | Бэктестер | Сканнер | Победитель |
|----------|-----------|---------|------------|
| **Скорость обработки** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | Бэктестер |
| **Реалистичность** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | Сканнер |
| **Фильтрация сигналов** | ⭐ | ⭐⭐⭐⭐⭐ | Сканнер |
| **Простота логики** | ⭐⭐⭐⭐⭐ | ⭐⭐ | Бэктестер |
| **Управление рисками** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | Сканнер |
| **Использование ресурсов** | ⭐⭐⭐⭐ | ⭐⭐⭐ | Бэктестер |

---

## 🎯 Вывод

**Бэктестер** и **Сканнер** используют одну и ту же стратегию (`applyStrategyLogic`), но применяют её по-разному:

- **Бэктестер** оптимизирован для **быстрой оценки** стратегии на исторических данных
- **Сканнер** оптимизирован для **надежной работы** в реальном времени с фильтрацией ложных сигналов

Результаты бэктеста могут быть **оптимистичнее** реальной торговли, т.к. не учитывают:
- Задержки на подтверждение
- Отклонение сигналов по риск-менеджменту
- Проскальзывание и комиссии
- Задержки API биржи

Для более точной оценки стратегии рекомендуется добавить в бэктестер режим "реалистичной симуляции" с теми же проверками, что и в сканнере.


