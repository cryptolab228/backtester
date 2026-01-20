# Детальный Аудит Логики Бэктестера
**Дата:** 15 октября 2025  
**Анализ:** Независимый глубокий аудит логики расчетов, управления капиталом и генерации сигналов

---

## 🎯 EXECUTIVE SUMMARY

### Критические Проблемы Обнаружены
1. ❌ **КРИТИЧЕСКАЯ ОШИБКА в управлении капиталом**: Отсутствует проверка на достаточность капитала ПЕРЕД блокировкой маржи
2. ❌ **КРИТИЧЕСКАЯ ОШИБКА в режиме с плечом**: При использовании leverage > 1 размер позиции умножается ПОСЛЕ расчета, что приводит к некорректному риск-менеджменту
3. ⚠️ **ЛОГИЧЕСКАЯ ДЫРА**: Множественные сигналы на одной паре в одном направлении игнорируются без логирования
4. ⚠️ **ЛОГИЧЕСКАЯ ДЫРА**: Противоположные сигналы могут появиться на той же свече при определенных условиях
5. ⚠️ **НЕСОГЛАСОВАННОСТЬ**: В одиночном бэктестере только одна активная позиция на пару, но логика не проверяет повторные сигналы
6. ⚠️ **МАТЕМАТИЧЕСКАЯ ОШИБКА**: Расчет PnL для SHORT позиций использует упрощенную формулу без учета процентного изменения

---

## 📊 СХЕМА РАБОТЫ БЭКТЕСТЕРА (ДРЕВО ЛОГИКИ)

### 1️⃣ ИНИЦИАЛИЗАЦИЯ

```
START
│
├─ Загрузка параметров (BacktestRunParameters)
│  ├─ initialCapital (стартовый капитал)
│  ├─ strategyParameters (параметры стратегии)
│  ├─ executionProfile (комиссии, плечо, проскальзывание)
│  └─ simulateConfirmation (режим подтверждения сигнала)
│
├─ Загрузка свечей (CandleData[])
│  └─ Применение логики стратегии → StrategyCandle[]
│     ├─ Расчет ATR (14 периодов по умолчанию)
│     ├─ Расчет NWE (Nadaraya-Watson Envelope)
│     ├─ Расчет Volume Profile (POC, VAH, VAL)
│     ├─ Определение объемных кластеров
│     └─ Генерация сигналов (entryConditionLong/Short, signalStrength)
│
└─ Инициализация переменных
   ├─ currentCapital = initialCapital
   ├─ activeTrade = null
   ├─ trades = []
   ├─ peakCapital = initialCapital
   ├─ maxDrawdown = 0
   └─ equityCurve = [{timestamp, capital: initialCapital}]
```

---

### 2️⃣ ОСНОВНОЙ ЦИКЛ (ПО КАЖДОЙ СВЕЧЕ)

```
FOR каждая свеча (i = 0; i < strategyCandles.length; i++)
│
├─ 🔹 ФАЗА 1: ОБНОВЛЕНИЕ ДНЕВНОГО СЧЕТЧИКА
│  │
│  └─ IF новый день (UTC)
│     └─ tradesOpenedToday = 0
│
├─ 🔹 ФАЗА 2: УПРАВЛЕНИЕ АКТИВНОЙ СДЕЛКОЙ
│  │
│  └─ IF activeTrade существует
│     │
│     ├─ A) Проверка Trailing Stop (если useTrailingStop = true)
│     │  ├─ Инициализация trailingStop при первом проходе
│     │  │  ├─ LONG: trailingStop = entryPrice - (ATR * offsetMultiplier)
│     │  │  └─ SHORT: trailingStop = entryPrice + (ATR * offsetMultiplier)
│     │  │
│     │  ├─ Обновление уровня от экстремума с момента входа
│     │  │  ├─ LONG: candidate = highestHigh - offset
│     │  │  │  └─ IF candidate > trailingStop + step → UPDATE
│     │  │  └─ SHORT: candidate = lowestLow + offset
│     │  │     └─ IF candidate < trailingStop - step → UPDATE
│     │  │
│     │  └─ Проверка срабатывания
│     │     ├─ LONG: IF currentCandle.low <= trailingStop → EXIT
│     │     └─ SHORT: IF currentCandle.high >= trailingStop → EXIT
│     │
│     ├─ B) Проверка Stop Loss (если TRAIL не сработал)
│     │  ├─ LONG: IF currentCandle.low <= stopLoss → EXIT (SL)
│     │  └─ SHORT: IF currentCandle.high >= stopLoss → EXIT (SL)
│     │
│     ├─ C) Проверка Take Profit (если SL не сработал)
│     │  ├─ LONG: IF currentCandle.high >= takeProfit → EXIT (TP)
│     │  └─ SHORT: IF currentCandle.low <= takeProfit → EXIT (TP)
│     │
│     ├─ D) Выход по противоположному сигналу (опционально)
│     │  └─ IF exitOnOppositeSignal = true
│     │     ├─ LONG активен + entryConditionShort → EXIT (OPPOSITE)
│     │     └─ SHORT активен + entryConditionLong → EXIT (OPPOSITE)
│     │
│     └─ E) ЗАКРЫТИЕ СДЕЛКИ (если exitReason определен)
│        │
│        ├─ 1. Расчет PnL
│        │  ├─ LONG: pnl = (exitPrice - entryPrice) * size
│        │  └─ SHORT: pnl = (entryPrice - exitPrice) * size
│        │
│        ├─ 2. Расчет комиссии на выход
│        │  └─ exitFee = exitPrice * size * tradingFeeRate
│        │
│        ├─ 3. Обновление капитала
│        │  ├─ pnl -= exitFee
│        │  ├─ currentCapital += margin (РАЗБЛОКИРОВКА!)
│        │  └─ currentCapital += pnl
│        │
│        ├─ 4. Обновление метрик
│        │  ├─ peakCapital = max(peakCapital, currentCapital)
│        │  ├─ drawdown = (peakCapital - currentCapital) / peakCapital * 100
│        │  └─ maxDrawdown = max(maxDrawdown, drawdown)
│        │
│        ├─ 5. Сохранение сделки
│        │  └─ trades.push(trade)
│        │
│        └─ 6. Обнуление активной позиции
│           └─ activeTrade = null
│
└─ 🔹 ФАЗА 3: ОТКРЫТИЕ НОВОЙ СДЕЛКИ
   │
   └─ IF activeTrade == null
      │
      ├─ РЕЖИМ 1: С ПОДТВЕРЖДЕНИЕМ (simulateConfirmation = true)
      │  │
      │  ├─ A) Проверка ожидающего сигнала (pendingSignal)
      │  │  │
      │  │  └─ IF pendingSignal существует
      │  │     │
      │  │     ├─ Проверка подтверждения
      │  │     │  ├─ LONG: priceHit = currentCandle.high >= entryPrice
      │  │     │  └─ SHORT: priceHit = currentCandle.low <= entryPrice
      │  │     │
      │  │     ├─ Проверка срабатывания SL до входа
      │  │     │  ├─ LONG: stopHit = currentCandle.low <= stopLoss
      │  │     │  └─ SHORT: stopHit = currentCandle.high >= stopLoss
      │  │     │
      │  │     └─ IF priceHit && !stopHit
      │  │        │
      │  │        ├─ 1. Расчет цены исполнения с проскальзыванием
      │  │        │  └─ fillPrice = entryPrice * (1 + slippageBps/10000 * direction)
      │  │        │
      │  │        ├─ 2. Расчет размера позиции
      │  │        │  └─ positionSize = calculatePositionSize(currentCapital, fillPrice, candle, risk)
      │  │        │
      │  │        ├─ 3. ⚠️ ПРИМЕНЕНИЕ ПЛЕЧА (ПОТЕНЦИАЛЬНАЯ ПРОБЛЕМА!)
      │  │        │  └─ size = positionSize * max(leverage, 1)
      │  │        │
      │  │        ├─ 4. Расчет требуемой маржи
      │  │        │  └─ requiredMargin = fillPrice * size / max(leverage, 1)
      │  │        │
      │  │        ├─ 5. ❌ КРИТИЧЕСКАЯ ТОЧКА: БЛОКИРОВКА БЕЗ ПРОВЕРКИ!
      │  │        │  ├─ entryFee = fillPrice * size * tradingFeeRate
      │  │        │  ├─ currentCapital -= requiredMargin (БЛОКИРОВКА)
      │  │        │  └─ currentCapital -= entryFee
      │  │        │
      │  │        ├─ 6. Создание активной сделки
      │  │        │  └─ activeTrade = {id, pair, direction, entryTimestamp, 
      │  │        │                     entryPrice: fillPrice, size, 
      │  │        │                     stopLoss, takeProfit, margin, fees}
      │  │        │
      │  │        └─ 7. Сброс ожидающего сигнала
      │  │           └─ pendingSignal = null
      │  │
      │  └─ B) Создание нового ожидающего сигнала
      │     │
      │     └─ IF !pendingSignal && (entryConditionLong || entryConditionShort)
      │        │
      │        ├─ Определение направления
      │        ├─ Расчет SL и TP от текущей свечи
      │        │  ├─ SL от Low/High свечи ± (ATR * stopLossMultiplier)
      │        │  └─ TP от Close свечи ± (ATR * takeProfitMultiplier)
      │        │
      │        └─ pendingSignal = {direction, entryPrice: close, 
      │                           stopLoss, takeProfit, detectedAt, 
      │                           detectionCandle, attempts: 0}
      │
      └─ РЕЖИМ 2: БЕЗ ПОДТВЕРЖДЕНИЯ (simulateConfirmation = false)
         │
         └─ IF entryConditionLong || entryConditionShort
            │
            ├─ 1. Проверка лимита сделок в день
            │  └─ IF maxTradesPerDay > 0 && tradesOpenedToday >= maxTradesPerDay
            │     └─ SKIP (без логирования!)
            │
            ├─ 2. Проверка ATR
            │  └─ IF !ATR || ATR <= 0 → SKIP
            │
            ├─ 3. Расчет параметров входа
            │  ├─ fillPrice = close * (1 + slippage)
            │  └─ positionSize = calculatePositionSize(currentCapital, fillPrice, candle, risk)
            │
            ├─ 4. IF positionSize > 0
            │  │
            │  ├─ Расчет SL и TP
            │  ├─ requiredMargin = fillPrice * positionSize / leverage
            │  ├─ entryFee = fillPrice * positionSize * tradingFeeRate
            │  │
            │  ├─ ❌ КРИТИЧЕСКАЯ ТОЧКА: БЛОКИРОВКА БЕЗ ПРОВЕРКИ!
            │  │  ├─ currentCapital -= requiredMargin
            │  │  └─ currentCapital -= entryFee
            │  │
            │  ├─ activeTrade = {...}
            │  └─ tradesOpenedToday += 1
            │
            └─ ELSE
               └─ Логируется предупреждение о нулевом размере
```

---

## 🔬 ДЕТАЛЬНЫЙ АНАЛИЗ КОМПОНЕНТОВ

### 🧮 1. РАСЧЕТ РАЗМЕРА ПОЗИЦИИ (calculatePositionSize)

**Местоположение:** `backend/src/modules/backtester/backtester.ts:25-68`

**Логика:**

```typescript
function calculatePositionSize(
  currentCapital: number,
  entryPrice: number,
  currentCandle: StrategyCandle,
  riskSettings?: RiskManagementSettings
): number
```

**Приоритет расчета:**

1️⃣ **ВАРИАНТ 2 (приоритетный):** На основе риска ATR
```
IF (maxRiskPerTradePercentage > 0 && stopLossMultiplier > 0 && ATR > 0 && entryPrice > 0)
  riskPerTradeCapital = currentCapital * maxRiskPerTradePercentage
  atrBasedStopLossAmountPerUnit = ATR * stopLossMultiplier
  size = riskPerTradeCapital / atrBasedStopLossAmountPerUnit
  RETURN size
```

**Пример расчета:**
- currentCapital = 10,000
- maxRiskPerTradePercentage = 0.02 (2%)
- stopLossMultiplier = 2.0
- ATR = 50
- entryPrice = 2000

```
riskPerTradeCapital = 10,000 * 0.02 = 200
atrBasedStopLossAmount = 50 * 2.0 = 100
size = 200 / 100 = 2.0 (единиц актива)
```

2️⃣ **ВАРИАНТ 1 (запасной):** Процент от капитала
```
IF (positionSizePercentage > 0 && entryPrice > 0)
  capitalToRisk = currentCapital * positionSizePercentage
  size = capitalToRisk / entryPrice
  RETURN size
```

**Пример расчета:**
- currentCapital = 10,000
- positionSizePercentage = 0.02 (2%)
- entryPrice = 2000

```
capitalToRisk = 10,000 * 0.02 = 200
size = 200 / 2000 = 0.1 (единиц актива)
```

3️⃣ **ВАРИАНТ 3 (по умолчанию):** size = 1

---

### ⚠️ **КРИТИЧЕСКАЯ ПРОБЛЕМА #1: Применение плеча**

**Местоположение:** `backtester.ts:355`

```typescript
const positionSizeBase = calculatePositionSize(currentCapital, fillPrice, confirmCandle, riskSettings);
const size = positionSizeBase * Math.max(executionProfile.leverage, 1); // ❌ ОШИБКА!
```

**Проблема:** Размер позиции умножается на leverage ПОСЛЕ расчета риска, что нарушает логику риск-менеджмента.

**Пример некорректного поведения:**
- Рассчитанный размер на основе риска: 2.0
- Leverage = 5
- Итоговый size = 2.0 * 5 = 10.0

**Последствия:**
- При leverage > 1 реальный риск увеличивается в `leverage` раз
- Нарушается принцип "maxRiskPerTradePercentage"

**Правильная логика:**
```typescript
// Размер позиции должен учитывать leverage ДО расчета риска
// ИЛИ не умножать на leverage, если риск уже рассчитан
```

---

### 💰 2. УПРАВЛЕНИЕ КАПИТАЛОМ

#### 📌 **БЛОКИРОВКА КАПИТАЛА** (Вход в сделку)

**Без плеча (leverage = 1):**
```typescript
requiredMargin = fillPrice * size / 1 = fillPrice * size
entryFee = fillPrice * size * tradingFeeRate
currentCapital -= requiredMargin  // ← Блокировка
currentCapital -= entryFee
```

**Пример:**
- fillPrice = 2000
- size = 2.0
- tradingFeeRate = 0.0006 (0.06%)
- currentCapital = 10,000

```
requiredMargin = 2000 * 2.0 / 1 = 4,000
entryFee = 2000 * 2.0 * 0.0006 = 2.4
currentCapital = 10,000 - 4,000 - 2.4 = 5,997.6
```

**С плечом (leverage = 5):**
```typescript
size = positionSizeBase * 5  // ← Умножение на плечо
requiredMargin = fillPrice * size / 5  // ← Деление на плечо
entryFee = fillPrice * size * tradingFeeRate
currentCapital -= requiredMargin
currentCapital -= entryFee
```

**Пример:**
- fillPrice = 2000
- positionSizeBase = 2.0
- size = 2.0 * 5 = 10.0
- leverage = 5

```
requiredMargin = 2000 * 10.0 / 5 = 4,000  ← Та же маржа!
entryFee = 2000 * 10.0 * 0.0006 = 12.0   ← Комиссия выше!
currentCapital = 10,000 - 4,000 - 12.0 = 5,988.0
```

**❌ ПРОБЛЕМА:** При увеличении leverage:
- Маржа остается той же
- Но комиссия растет пропорционально размеру позиции
- Риск увеличивается, но капитал блокируется так же

---

#### 📌 **РАЗБЛОКИРОВКА КАПИТАЛА** (Выход из сделки)

**Местоположение:** `backtester.ts:299-333`

```typescript
// 1. Расчет PnL
if (direction === LONG) {
  pnl = (exitPrice - entryPrice) * size
} else { // SHORT
  pnl = (entryPrice - exitPrice) * size
}

// 2. Комиссия на выход
exitFee = exitPrice * size * tradingFeeRate

// 3. Вычитание комиссии из PnL
pnl -= exitFee

// 4. РАЗБЛОКИРОВКА маржи
currentCapital += margin

// 5. Добавление/вычитание PnL
currentCapital += pnl
```

**Пример (LONG с прибылью):**
- entryPrice = 2000
- exitPrice = 2100
- size = 2.0
- margin = 4,000
- exitFee = 2100 * 2.0 * 0.0006 = 2.52
- currentCapital (до закрытия) = 5,997.6

```
pnl = (2100 - 2000) * 2.0 = 200
pnl -= 2.52 = 197.48
currentCapital = 5,997.6 + 4,000 + 197.48 = 10,195.08
```

**Пример (SHORT с убытком):**
- entryPrice = 2000
- exitPrice = 2100
- size = 2.0

```
pnl = (2000 - 2100) * 2.0 = -200
pnl -= 2.52 = -202.52
currentCapital = 5,997.6 + 4,000 + (-202.52) = 9,795.08
```

---

### ⚠️ **КРИТИЧЕСКАЯ ПРОБЛЕМА #2: Нет проверки достаточности капитала**

**Местоположение:** `backtester.ts:491-496`

```typescript
const requiredMargin = fillPrice * positionSize / Math.max(executionProfile.leverage, 1);
const entryFee = fillPrice * positionSize * executionProfile.tradingFeeRate;
currentCapital -= requiredMargin;  // ❌ Нет проверки!
currentCapital -= entryFee;
```

**Проблема:** Если `requiredMargin + entryFee > currentCapital`, капитал уйдет в отрицательные значения!

**Сценарий:**
- currentCapital = 100
- requiredMargin = 80
- entryFee = 30

```
currentCapital = 100 - 80 - 30 = -10  ← ОТРИЦАТЕЛЬНЫЙ КАПИТАЛ!
```

**Последствия:**
- Бэктестер продолжает работать с отрицательным капиталом
- Последующие сделки рассчитываются от отрицательной базы
- Результаты не отражают реальную торговлю

**Решение:**
```typescript
const totalRequired = requiredMargin + entryFee;
if (currentCapital < totalRequired) {
  logger.warn(`Insufficient capital. Required: ${totalRequired}, Available: ${currentCapital}`);
  continue; // Пропустить сделку
}
currentCapital -= totalRequired;
```

---

### 🎯 3. ГЕНЕРАЦИЯ СИГНАЛОВ СТРАТЕГИИ

**Местоположение:** `backend/src/modules/strategy_logic/strategy.ts:336-435`

#### 📊 **Компоненты сигнала:**

**1. DLC (Delta Level Candles / Volume Profile)**
- POC (Point of Control)
- VAH (Value Area High)
- VAL (Value Area Low)

**LONG сигналы:**
```typescript
// Отбой от VAL снизу
if (candle.low <= VAL && candle.close > VAL) {
  dlcLongActive = true
}

// Отбой от POC снизу (строгий)
if (candle.low <= POC && candle.close > POC && candle.open > POC) {
  dlcLongActive = true
}
```

**SHORT сигналы:**
```typescript
// Отбой от VAH сверху
if (candle.high >= VAH && candle.close < VAH) {
  dlcShortActive = true
}

// Отбой от POC сверху (строгий)
if (candle.high >= POC && candle.close < POC && candle.open < POC) {
  dlcShortActive = true
}
```

**2. NWE (Nadaraya-Watson Envelope)**
- nweLower (поддержка)
- nweUpper (сопротивление)

**LONG сигналы:**
```typescript
if (nweEnabled && candle.low <= nweLower && candle.close > nweLower) {
  nweLongActive = true
}
```

**SHORT сигналы:**
```typescript
if (nweEnabled && candle.high >= nweUpper && candle.close < nweUpper) {
  nweShortActive = true
}
```

**3. CLUSTER (Объемные кластеры)**

**LONG сигналы (бычий кластер):**
```typescript
if (isVolumeCluster && approxDelta > (deltaThreshold * avgVolume * 0.01)) {
  clusterLongActive = true
}
```

**SHORT сигналы (медвежий кластер):**
```typescript
if (isVolumeCluster && approxDelta < (-deltaThreshold * avgVolume * 0.01)) {
  clusterShortActive = true
}
```

---

#### 💪 **РАСЧЕТ СИЛЫ СИГНАЛА (signalStrength)**

**Базовая сила:**
```
signalStrength = 0

IF dlcActive: signalStrength += 1.0
IF nweActive: signalStrength += 1.0
IF clusterActive: signalStrength += 1.0 + (clusterStrength * 0.2)
```

**Бонус за конфлюентность:**
```
activeCount = count(dlcActive, nweActive, clusterActive)

IF activeCount == 2: signalStrength += 1.0
IF activeCount == 3: signalStrength += 1.5
```

**Пример максимального сигнала:**
- DLC: +1.0
- NWE: +1.0
- Cluster: +1.0 + (5.0 * 0.2) = +2.0
- Confluence bonus (3 компонента): +1.5
- **TOTAL: 5.5**

---

### ⚠️ **КРИТИЧЕСКАЯ ПРОБЛЕМА #3: Одновременные сигналы Long и Short**

**Местоположение:** `strategy.ts:409-426`

```typescript
// Если уже есть Long сигнал, Short не рассматриваем
if (!isLongSignal && (dlcShortActive || nweShortActive || clusterShortActive)) {
  isShortSignal = true
  // ...
}
```

**Проблема:** При определенных условиях возможна ситуация:
- DLC дает Long (отбой от VAL)
- NWE дает Short (отбой от nweUpper)

**Текущее решение:** Приоритет Long сигналу.

**⚠️ Логическая дыра:** Нет логирования конфликтующих сигналов.

---

### 🔄 4. ОБРАБОТКА МНОЖЕСТВЕННЫХ СИГНАЛОВ

#### 📌 **ОДИНОЧНЫЙ БЭКТЕСТЕР (runBacktest)**

**Поведение:**
- Только ОДНА активная позиция в любой момент времени
- Если `activeTrade != null`, новые сигналы игнорируются

**❌ ПРОБЛЕМА:** Нет логирования пропущенных сигналов

**Сценарий 1: Повторный сигнал в ту же сторону**
```
T0: LONG сигнал → activeTrade = LONG
T1: LONG сигнал (пока T0 активен) → ИГНОРИРУЕТСЯ молча
T2: Выход из T0
T3: LONG сигнал → Открывается новая сделка
```

**Сценарий 2: Противоположный сигнал**
```
T0: LONG сигнал → activeTrade = LONG
T1: SHORT сигнал (пока T0 активен)
    IF exitOnOppositeSignal = true → Закрывается LONG
    IF exitOnOppositeSignal = false → Игнорируется, LONG продолжается
```

---

#### 📌 **ПОРТФЕЛЬНЫЙ БЭКТЕСТЕР (runPortfolioBacktest)**

**Поведение:**
- Несколько активных позиций одновременно (разные пары)
- Только ОДНА позиция на одну пару
- Сигналы собираются на одном timestamp, затем обрабатываются по силе

**Ключевая особенность:**
```typescript
activeTradesPortfolio: Map<string, Trade>  // Key = pairSymbol
```

**Логика обработки:**

1️⃣ **Сбор сигналов на timestamp**
```typescript
if (!activeTradesPortfolio.has(pairSymbol)) {
  if (entryConditionLong || entryConditionShort) {
    pendingSignalsAtTimestamp.push({
      pairSymbol,
      direction,
      signalStrength,
      candle
    })
  }
}
```

2️⃣ **Обработка при смене timestamp**
```typescript
if (currentCandle.timestamp !== currentTimestamp) {
  // Сортировка по силе сигнала (убывание)
  pendingSignalsAtTimestamp.sort((a, b) => b.signalStrength - a.signalStrength)
  
  // Открытие сделок с учетом лимита
  for (signal of pendingSignalsAtTimestamp) {
    if (activeTradesPortfolio.size >= maxConcurrentTrades) {
      logger.info('SKIPPED - limit reached')
      continue  // ⚠️ НЕ break!
    }
    // Открыть сделку
  }
}
```

**✅ ПРАВИЛЬНО:** Сигналы приоритизируются по силе

**⚠️ ПРОБЛЕМА:** Что если на одном timestamp по BTCUSDT два сигнала?
- Только последний попадет в массив (предыдущий перезапишется)
- Нет обработки множественных сигналов на одной паре в один момент

---

## 🧪 СЦЕНАРИИ ТЕСТИРОВАНИЯ

### 📍 **СЦЕНАРИЙ 1: Повторный сигнал в ту же сторону**

**Данные:**
- Пара: BTCUSDT
- T0: LONG сигнал (strength = 3.0)
- T1: LONG сигнал (strength = 4.5) - через 2 свечи, сделка еще активна
- T2: Выход по TP

**Ожидаемое поведение (одиночный бэктестер):**
```
T0: Открыть LONG
T1: Игнорировать (activeTrade != null)
T2: Закрыть LONG
```

**Фактическое поведение:**
- ✅ Корректно игнорирует
- ❌ НЕ логирует пропуск

**Рекомендация:**
```typescript
if (activeTrade && (currentCandle.entryConditionLong || currentCandle.entryConditionShort)) {
  logger.debug(`Signal ignored for ${params.pairSymbol} - active trade exists`)
}
```

---

### 📍 **СЦЕНАРИЙ 2: Противоположный сигнал**

**Данные:**
- Пара: BTCUSDT
- T0: LONG сигнал
- T1: SHORT сигнал (через 3 свечи)

**Случай A: exitOnOppositeSignal = true**
```
T0: Открыть LONG (entry = 2000)
T1: Обнаружен SHORT сигнал
    → Закрыть LONG (exit = 2050, reason = OPPOSITE)
    → Открыть SHORT? НЕТ! (цикл продолжается на той же свече)
```

**⚠️ ПРОБЛЕМА:** После закрытия по OPPOSITE на текущей свече Short НЕ открывается!

**Местоположение:** `backtester.ts:287-297`

```typescript
if (!exitReason && riskSettings?.exitOnOppositeSignal) {
  const oppositeSignal = activeTrade.direction === TradeDirection.LONG
    ? currentCandle.entryConditionShort
    : currentCandle.entryConditionLong;
  if (oppositeSignal) {
    exitReason = 'OPPOSITE';
    exitPrice = currentCandle.close;
  }
}
// ... закрытие сделки ...
// activeTrade = null

// ⬇️ Далее в том же цикле:
if (activeTrade == null) {
  // Проверка новых сигналов
  // НО! Мы уже на этой свече, и entryCondition проверяется снова
}
```

**Фактическое поведение:**
- Если на свече и Long и Short условия активны одновременно - возможен реверс

**Случай B: exitOnOppositeSignal = false**
```
T0: Открыть LONG
T1: SHORT сигнал игнорируется (activeTrade != null)
T2: Закрытие LONG по SL/TP/TRAIL
```

---

### 📍 **СЦЕНАРИЙ 3: Недостаточный капитал**

**Данные:**
- currentCapital = 100
- Сигнал требует:
  - requiredMargin = 80
  - entryFee = 25

**Ожидаемое поведение:**
```
totalRequired = 80 + 25 = 105
IF 100 < 105:
  logger.warn('Insufficient capital')
  SKIP trade
```

**Фактическое поведение:**
```
currentCapital = 100 - 80 - 25 = -5  ← ОТРИЦАТЕЛЬНО!
activeTrade = {...}
Бэктест продолжается с отрицательным капиталом
```

**❌ КРИТИЧЕСКАЯ ОШИБКА!**

---

## 📋 МАТЕМАТИЧЕСКИЕ ФОРМУЛЫ

### 1️⃣ **PnL (Profit and Loss)**

**LONG:**
```
PnL_raw = (exitPrice - entryPrice) * size
PnL_net = PnL_raw - exitFee
```

**SHORT:**
```
PnL_raw = (entryPrice - exitPrice) * size
PnL_net = PnL_raw - exitFee
```

**⚠️ ПОТЕНЦИАЛЬНАЯ ПРОБЛЕМА:** Формула SHORT упрощена.

**Реальная торговля SHORT:**
1. Занимаем актив и продаем по `entryPrice`
2. Получаем `entryPrice * size` средств
3. Выкупаем обратно по `exitPrice`
4. Платим `exitPrice * size` средств
5. PnL = (entryPrice * size) - (exitPrice * size) = (entryPrice - exitPrice) * size

**Вывод:** Формула МАТЕМАТИЧЕСКИ корректна для спотового SHORT.

---

### 2️⃣ **Комиссии**

**При входе:**
```
entryFee = fillPrice * size * tradingFeeRate
```

**При выходе:**
```
exitFee = exitPrice * size * tradingFeeRate
```

**Общая комиссия:**
```
totalFees = entryFee + exitFee
```

**Пример (LONG):**
- fillPrice = 2000
- exitPrice = 2100
- size = 2.0
- tradingFeeRate = 0.0006

```
entryFee = 2000 * 2.0 * 0.0006 = 2.4
exitFee = 2100 * 2.0 * 0.0006 = 2.52
totalFees = 2.4 + 2.52 = 4.92
```

---

### 3️⃣ **Просадка (Drawdown)**

```
peakCapital = max всех предыдущих значений капитала
drawdown = ((peakCapital - currentCapital) / peakCapital) * 100
maxDrawdown = max всех drawdown
```

**Пример:**
- peakCapital = 12,000
- currentCapital = 10,200

```
drawdown = ((12,000 - 10,200) / 12,000) * 100 = 15%
```

---

### 4️⃣ **Win Rate**

```
winRate = (winningTrades / totalTrades) * 100
```

**Единицы:** Возвращается в ПРОЦЕНТАХ (0..100)

---

### 5️⃣ **Profit Factor**

```
grossProfit = sum всех прибыльных сделок
grossLoss = abs(sum всех убыточных сделок)
profitFactor = grossProfit / grossLoss
```

**Особые случаи:**
- Если `grossLoss = 0` и `grossProfit > 0`: `profitFactor = Infinity`
- Если оба = 0: `profitFactor = 0`

---

### 6️⃣ **Expectancy (Матожидание)**

```
avgWin = grossProfit / winningTrades
avgLoss = grossLoss / losingTrades
winRate_decimal = winningTrades / totalTrades
lossRate = 1 - winRate_decimal
expectancy = (winRate_decimal * avgWin) - (lossRate * avgLoss)
```

**Интерпретация:**
- expectancy > 0: Стратегия прибыльна в долгосрочной перспективе
- expectancy < 0: Стратегия убыточна

---

## 🎯 ВЫВОДЫ И РЕКОМЕНДАЦИИ

### ❌ **КРИТИЧЕСКИЕ ПРОБЛЕМЫ (требуют немедленного исправления)**

1. **Нет проверки достаточности капитала перед блокировкой**
   - Файл: `backtester.ts:491-496`
   - Риск: Отрицательный капитал, некорректные результаты
   - Приоритет: **КРИТИЧЕСКИЙ**

2. **Некорректное применение плеча в calculatePositionSize**
   - Файл: `backtester.ts:355`
   - Риск: Увеличение реального риска в `leverage` раз
   - Приоритет: **КРИТИЧЕСКИЙ**

3. **Отсутствие логирования пропущенных сигналов**
   - Файл: `backtester.ts` (основной цикл)
   - Риск: Невозможность отладки и анализа
   - Приоритет: **ВЫСОКИЙ**

---

### ⚠️ **ЛОГИЧЕСКИЕ ПРОБЛЕМЫ (требуют проверки)**

4. **Поведение exitOnOppositeSignal на той же свече**
   - Проверить: открывается ли противоположная позиция после закрытия
   - Приоритет: **СРЕДНИЙ**

5. **Обработка множественных сигналов на одной паре в портфеле**
   - Только один сигнал на пару на timestamp
   - Приоритет: **НИЗКИЙ** (по дизайну?)

6. **Конфликт Long и Short сигналов на одной свече**
   - Приоритет Long без логирования
   - Приоритет: **НИЗКИЙ**

---

### ✅ **КОРРЕКТНЫЕ ЭЛЕМЕНТЫ**

1. ✅ Расчет PnL для LONG и SHORT математически корректен
2. ✅ Разблокировка маржи после закрытия сделки
3. ✅ Расчет комиссий на вход и выход
4. ✅ Trailing Stop логика (обновление от экстремумов)
5. ✅ Приоритизация сигналов по силе в портфельном бэктестере
6. ✅ Расчет метрик (winRate, profitFactor, expectancy, drawdown)

---

## 🔧 ПРЕДЛОЖЕНИЯ ПО ИСПРАВЛЕНИЮ

### 🛠️ **ИСПРАВЛЕНИЕ #1: Проверка капитала**

```typescript
// В backtester.ts перед блокировкой маржи
const requiredMargin = fillPrice * positionSize / Math.max(executionProfile.leverage, 1);
const entryFee = fillPrice * positionSize * executionProfile.tradingFeeRate;
const totalRequired = requiredMargin + entryFee;

if (currentCapital < totalRequired) {
  logger.warn(`[RunBacktest] Insufficient capital for ${params.pairSymbol}. Required: ${totalRequired.toFixed(2)}, Available: ${currentCapital.toFixed(2)}`);
  continue; // Пропустить сделку
}

currentCapital -= requiredMargin;
currentCapital -= entryFee;
```

---

### 🛠️ **ИСПРАВЛЕНИЕ #2: Корректное применение плеча**

**Вариант A: Не умножать на leverage, если риск уже рассчитан**
```typescript
const positionSize = calculatePositionSize(currentCapital, fillPrice, confirmCandle, riskSettings);
// НЕ умножаем на leverage - размер уже учитывает риск

const requiredMargin = fillPrice * positionSize / Math.max(executionProfile.leverage, 1);
```

**Вариант B: Учитывать leverage внутри calculatePositionSize**
```typescript
// Внутри calculatePositionSize
const effectiveCapital = currentCapital * leverage; // Доступный размер позиции с плечом
const size = (effectiveCapital * maxRiskPerTradePercentage) / atrBasedStopLoss;
return size;
```

---

### 🛠️ **ИСПРАВЛЕНИЕ #3: Логирование пропущенных сигналов**

```typescript
// В основном цикле backtester.ts
if (activeTrade) {
  // Проверка новых сигналов при активной сделке
  if (currentCandle.entryConditionLong || currentCandle.entryConditionShort) {
    const signalDir = currentCandle.entryConditionLong ? 'LONG' : 'SHORT';
    const signalStrength = currentCandle.signalStrength || 0;
    logger.debug(`[RunBacktest] Signal SKIPPED for ${params.pairSymbol} (${signalDir}, strength: ${signalStrength.toFixed(2)}) - Active trade exists (${activeTrade.direction})`);
  }
}
```

---

## 📊 ИТОГОВАЯ ОЦЕНКА

| Компонент | Статус | Критичность | Комментарий |
|-----------|--------|-------------|-------------|
| Управление капиталом | ❌ | КРИТИЧЕСКАЯ | Нет проверки достаточности |
| Применение плеча | ❌ | КРИТИЧЕСКАЯ | Некорректный расчет риска |
| Генерация сигналов | ✅ | - | Логика корректна |
| Расчет PnL | ✅ | - | Математически верно |
| Комиссии | ✅ | - | Корректный расчет |
| Trailing Stop | ✅ | - | Правильная логика |
| Портфельный режим | ⚠️ | СРЕДНЯЯ | Проверить множественные сигналы |
| Логирование | ⚠️ | ВЫСОКАЯ | Недостаточно для отладки |

---

## 📝 СЛЕДУЮЩИЕ ШАГИ

1. ✅ Исправить проверку достаточности капитала
2. ✅ Пересмотреть логику применения плеча
3. ✅ Добавить детальное логирование пропущенных сигналов
4. ⚙️ Провести тестирование сценария exitOnOppositeSignal
5. ⚙️ Добавить юнит-тесты для calculatePositionSize
6. ⚙️ Провести нагрузочное тестирование с отрицательным капиталом

---

**Конец аудита.**




