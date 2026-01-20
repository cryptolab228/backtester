# 📋 Структура Логики Сканнера: Открытие Позиций и Параметры

## 🎯 Обзор Архитектуры

Сканнер работает по **3-уровневой архитектуре**:
1. **Signal Engine** - обнаружение сигналов
2. **Confirmation Queue** - подтверждение сигналов  
3. **Execution Manager** - исполнение позиций

---

## 🔄 Полный Цикл Открытия Позиции

### 1️⃣ **Signal Detection** (Обнаружение сигнала)

**Файл:** `scanner.service.ts` - `applyStrategyLogic()`

```typescript
// Параметры стратегии
interface StrategyParameters {
  atrMultiplier: number;        // Множитель ATR для стоп-лосса
  volumeThreshold: number;     // Порог объема для подтверждения
  minSignalStrength: number;   // Минимальная сила сигнала
  confirmationDelay: number;   // Задержка подтверждения (мс)
  takeProfitMultiplier: number; // Множитель для тейк-профита
}

// Детекция сигнала
const signal: DetectedSignal = {
  id: generateSignalId(),
  pairSymbol: 'BTCUSDT',
  direction: 'long' | 'short',
  entryPrice: 45000,
  strength: 0.85,              // 0-1, сила сигнала
  detectedAt: Date.now(),
  timeframe: '1h',
  strategyId: 'basic-strategy',
  metadata: {
    atr: 1500,                 // ATR для стоп-лосса
    volume: 1000000,           // Объем для подтверждения
    delta: 500000,             // Дельта объема
  }
};
```

### 2️⃣ **Signal Validation** (Валидация сигнала)

**Файл:** `scanner.service.ts` - `validateSignal()`

```typescript
// Проверки валидации
const validation = {
  minStrength: signal.strength >= params.minSignalStrength,    // Минимальная сила
  volumeThreshold: signal.metadata.volume >= params.volumeThreshold, // Порог объема
  priceDeviation: Math.abs(signal.entryPrice - currentPrice) / currentPrice <= 0.01, // Отклонение цены <= 1%
  timeFilter: !isSignalTooRecent(signal.pairSymbol, signal.timeframe), // Не слишком недавний
  marketConditions: checkMarketConditions(signal.pairSymbol), // Состояние рынка
};
```

### 3️⃣ **Signal Confirmation** (Подтверждение сигнала)

**Файл:** `scanner.service.ts` - `calculateConfirmationTarget()`

```typescript
// Цель подтверждения (движение цены)
const confirmationTarget = {
  long: signal.entryPrice * (1 + 0.0005),  // +0.05% для LONG
  short: signal.entryPrice * (1 - 0.0005), // -0.05% для SHORT
};

// Очередь подтверждения
await confirmationQueue.add({
  signalId: signal.id,
  pairSymbol: signal.pairSymbol,
  targetPrice: confirmationTarget,
  timeout: params.confirmationDelay, // Обычно 15 минут
  maxAttempts: 3,
});
```

### 4️⃣ **Position Sizing** (Расчет размера позиции)

**Файл:** `portfolio/PortfolioAllocator.ts`

```typescript
// Параметры управления капиталом
interface RiskSettings {
  maxPositionSize: number;      // Макс. размер позиции (% от капитала)
  maxConcurrentPositions: number; // Макс. одновременных позиций
  riskPerTrade: number;         // Риск на сделку (%)
  maxLeverage: number;          // Макс. плечо
}

// Расчет размера позиции
const positionCalculation = {
  availableCapital: sessionMetrics.capitalRemaining,
  riskAmount: availableCapital * (riskSettings.riskPerTrade / 100),
  stopLossDistance: signal.metadata.atr * params.atrMultiplier,
  positionSize: Math.min(
    riskAmount / stopLossDistance,
    availableCapital * (riskSettings.maxPositionSize / 100)
  ),
  leverage: Math.min(
    riskSettings.maxLeverage,
    calculateOptimalLeverage(signal.pairSymbol)
  ),
};
```

### 5️⃣ **Order Execution** (Исполнение ордера)

**Файл:** `execution/BybitDemoExecutionManager.ts`

```typescript
// Параметры ордера
const orderParams = {
  symbol: signal.pairSymbol,
  side: signal.direction === 'long' ? 'Buy' : 'Sell',
  orderType: 'Market',           // или 'Limit'
  qty: positionCalculation.positionSize,
  
  // Для лимитных ордеров
  price: signal.entryPrice,
  timeInForce: 'GTC',
  
  // Управление риском
  stopLoss: {
    price: signal.entryPrice - (signal.metadata.atr * params.atrMultiplier),
    size: positionCalculation.positionSize,
  },
  takeProfit: {
    price: signal.entryPrice + (signal.metadata.atr * params.takeProfitMultiplier),
    size: positionCalculation.positionSize,
  },
  
  // Метаданные
  orderLinkId: signal.id,
  meta: {
    signalId: signal.id,
    strategyId: signal.strategyId,
    detectedAt: signal.detectedAt,
    strength: signal.strength,
  },
};
```

### 6️⃣ **Position Recording** (Запись позиции)

**Файл:** `services/SessionManager.ts` - `recordTrade()`

```typescript
// Параметры записи сделки
const tradeRecord: RecordTradeParams = {
  sessionId: currentSession.id,
  source: 'scanner',
  mode: 'demo',
  pair: signal.pairSymbol,
  timeframe: signal.timeframe,
  direction: signal.direction,
  entryPrice: executionResult.fillPrice,
  positionSize: executionResult.filledQuantity,
  entryTimestamp: new Date(),
  exchange: 'bybit',
  
  // Управление риском
  stopLoss: orderParams.stopLoss.price,
  takeProfit: orderParams.takeProfit.price,
  leverage: positionCalculation.leverage,
  
  // Метрики
  riskScore: calculateRiskScore(signal),
  latencyMs: Date.now() - signal.detectedAt,
  
  // Дополнительно
  orderLinkId: signal.id,
  signalId: signal.id,
  strategyId: signal.strategyId,
  extra: {
    signalStrength: signal.strength,
    confirmationPrice: confirmationTarget,
    atr: signal.metadata.atr,
    volume: signal.metadata.volume,
  },
};
```

---

## 📊 **Ключевые Параметры Конфигурации**

### **Стратегия:**
```typescript
const defaultStrategyParams = {
  atrMultiplier: 2.0,           // Стоп-лосс = 2x ATR
  takeProfitMultiplier: 3.0,    // Тейк-профит = 3x ATR  
  volumeThreshold: 1000000,     // Мин. объем $1M
  minSignalStrength: 0.7,      // Мин. сила сигнала 70%
  confirmationDelay: 900000,   // 15 минут на подтверждение
  maxConfirmationAttempts: 3,  // Максимум 3 попытки
  confirmationThreshold: 0.0005, // 0.05% движение для подтверждения
};
```

### **Риск-менеджмент:**
```typescript
const defaultRiskSettings = {
  maxPositionSize: 10,         // 10% капитала на позицию
  maxConcurrentPositions: 5,    // Максимум 5 позиций
  riskPerTrade: 2,             // 2% риска на сделку
  maxLeverage: 5,              // Максимум 5x плечо
  maxDrawdown: 15,             // Макс. просадка 15%
  dailyLossLimit: 5,           // Дневной лимит убытков 5%
};
```

### **Портфель:**
```typescript
const portfolioSettings = {
  initialCapital: 100000,       // $100K начальный капитал
  reserveRatio: 0.1,           // 10% резерва
  rebalanceThreshold: 0.05,    // Ребаланс при 5% отклонении
  correlationLimit: 0.7,       // Лимит корреляции позиций
};
```

---

## 🔄 **Обновление в Реальном Времени**

### **WebSocket Обновления:**
```typescript
// Обновление PnL позиции
ws.on('position_update', (data) => {
  executionManager.attachExternalOrder(positionId, {
    markPrice: data.markPrice,
    unrealizedPnl: data.unrealizedPnl,
    updatedAt: Date.now(),
  });
});

// Транслируем на фронтенд
broadcast({
  type: 'execution_updated',
  payload: updatedPosition,
});
```

### **Метрики Сессии:**
```typescript
// Обновление каждые 5 секунд
setInterval(async () => {
  await sessionManager.updateSessionMetrics(sessionId);
  
  const metrics = await sessionManager.getSessionMetrics(sessionId);
  broadcast({
    type: 'session_metrics_updated',
    payload: {
      totalPnl: metrics.totalPnl,
      unrealizedPnl: metrics.unrealizedPnl,
      openPositions: metrics.openPositions,
      winRate: metrics.winRatePct,
    },
  });
}, 5000);
```

---

## 🚨 **Обработка Ошибок**

### **Неудачное исполнение:**
```typescript
try {
  const result = await executionManager.executeOrder(orderParams);
  await sessionManager.recordTrade(tradeRecord);
} catch (error) {
  // Логируем ошибку
  logger.error('Order execution failed', { error, orderParams });
  
  // Обновляем метрики ошибок
  await sessionManager.updateSessionMetrics(sessionId, {
    failedOrders: increment,
    lastError: error.message,
  });
  
  // Отправляем алерт
  broadcast({
    type: 'execution_failed',
    payload: { signalId: signal.id, error: error.message },
  });
}
```

### **Проблемы с позицией:**
```typescript
// Мониторинг здоровья позиции
const healthCheck = {
  unrealizedPnlThreshold: -0.1,  // -10% unrealized PnL
  timeLimit: 24 * 60 * 60 * 1000, // 24 часа
  inactivityThreshold: 60 * 60 * 1000, // 1 час без обновлений
};

if (position.unrealizedPnl <= healthCheck.unrealizedPnlThreshold) {
  await executionManager.closePosition(position.id, {
    exitReason: 'manual',
    exitPrice: currentPrice,
    exitAt: Date.now(),
  });
}
```

---

## 📈 **Производительность и Оптимизация**

### **Кэширование:**
- Redis для сигналов и позиций
- Кэш метрик сессии (TTL: 30 секунд)
- Кэш рыночных данных (TTL: 5 секунд)

### **Batch операции:**
- Пакетное обновление позиций (каждые 5 секунд)
- Пакетный расчет метрик (каждые 10 секунд)
- Пакетная трансляция WebSocket (каждую секунду)

### **Rate Limiting:**
- Bybit: 120 запросов/сек
- OKX: 30 запросов/сек
- Локальные лимиты: 1000 операций/сек

---

## 🔧 **Конфигурация Окружения**

```typescript
// .env настройки
SCANNER_MODE=demo              // demo | testnet | live
SCANNER_EXCHANGE=bybit         // bybit | okx
SCANNER_TIMEFRAMES=1h,4h,1d   // Таймфреймы для сканирования
SCANNER_PAIRS=BTCUSDT,ETHUSDT // Пары для сканирования
SCANNER_MAX_POSITIONS=5        // Максимум позиций
SCANNER_RISK_PER_TRADE=2      // % риска на сделку

// WebSocket
WS_PORT=5001
WS_HEARTBEAT_INTERVAL=30000

// База данных
DB_POOL_SIZE=10
DB_TIMEOUT=30000
```

---

## 🎯 **Ключевые Точки Мониторинга**

1. **Signal Detection Rate:** > 10 сигналов/час
2. **Confirmation Rate:** > 60% подтвержденных
3. **Execution Latency:** < 500мс
4. **PnL Update Frequency:** Каждые 5 секунд
5. **Error Rate:** < 1% неудачных исполнений
6. **Memory Usage:** < 512MB
7. **CPU Usage:** < 50%

---

**Дата создания:** 16.01.2026  
**Версия:** 1.0  
**Статус:** ✅ **PRODUCTION READY**
