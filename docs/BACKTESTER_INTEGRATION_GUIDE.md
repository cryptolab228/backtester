# 🔧 Руководство по Интеграции Фьючерсов в Бектестер

**Дата:** 18.10.2025  
**Статус:** 🔄 В процессе  

---

## 📋 Что Было Сделано

### ✅ Созданные Файлы:

#### 1. **backtester.types.ts** - Расширение
- ✅ Добавлен `strategyProfile?: ProfileName`
- ✅ Добавлен `extendedParameters?: ExtendedStrategyParameters`
- ✅ Добавлен `futuresStats?: FuturesBacktestStats` в метрики
- ✅ Импорты модулей futures и profiles

#### 2. **backtester.futures.ts** - Новый Файл
**Размер:** ~400 строк  
**Содержание:**
- ✅ `FuturesBacktestContext` - контекст фьючерсов
- ✅ `initializeFuturesContext()` - инициализация
- ✅ `calculateFuturesPositionSize()` - расчет позиции
- ✅ `checkLiquidation()` - проверка ликвидации
- ✅ `applyFundingRate()` - применение funding
- ✅ `openFuturesPosition()` - открытие позиции
- ✅ `closeFuturesPosition()` - закрытие позиции
- ✅ `updateLiquidationDistance()` - обновление статистики
- ✅ `finalizeFuturesStats()` - финализация статистики

---

## 🔄 Следующие Шаги Интеграции

### Что Нужно Сделать:

#### Шаг 1: Обновить начало `runBacktest()`
```typescript
export const runBacktest = async (
  params: BacktestRunParameters,
  candles: CandleData[]
): Promise<BacktestResult> => {
  // ... существующий код ...
  
  // НОВОЕ: Получить профиль стратегии
  let effectiveParams: ExtendedStrategyParameters;
  if (params.strategyProfile) {
    effectiveParams = getStrategyProfile(params.strategyProfile);
  } else if (params.extendedParameters) {
    effectiveParams = params.extendedParameters;
  } else {
    // Обратная совместимость - определить профиль автоматически
    effectiveParams = params.strategyParameters as ExtendedStrategyParameters;
    const detectedProfile = detectProfile(effectiveParams);
    effectiveParams.profileName = detectedProfile;
  }
  
  // НОВОЕ: Инициализировать контекст фьючерсов
  const futuresContext = initializeFuturesContext(effectiveParams);
  const isFuturesMode = futuresContext !== null;
  
  logger.info(`[RunBacktest] Mode: ${isFuturesMode ? 'FUTURES' : 'SPOT'}`, {
    profileName: effectiveParams.profileName,
    leverage: futuresContext?.leverage
  });
  
  // ... продолжить существующий код ...
}
```

#### Шаг 2: Модифицировать Открытие Позиций
```typescript
// В существующем коде, где открывается позиция
if (isFuturesMode && futuresContext) {
  // Использовать фьючерсную логику
  const positionCalc = calculateFuturesPositionSize(
    currentCapital,
    fillPrice,
    stopLossPrice,
    riskSettings.maxRiskPerTradePercentage! * 100,
    futuresContext.leverage
  );
  
  const { requiredMargin, liquidationPrice } = openFuturesPosition(
    fillPrice,
    direction,
    positionCalc.contracts,
    futuresContext.leverage,
    futuresContext
  );
  
  currentCapital -= requiredMargin;
  activeTrade.margin = requiredMargin;
  
} else {
  // Существующая логика для спота
  const requiredMargin = fillPrice * size / Math.max(executionProfile.leverage, 1);
  currentCapital -= requiredMargin;
  activeTrade.margin = requiredMargin;
}
```

#### Шаг 3: Добавить Проверку Ликвидации в Цикл
```typescript
// В цикле по свечам, ПЕРЕД проверкой SL/TP
if (activeTrade && isFuturesMode && futuresContext) {
  // Проверить ликвидацию
  const { liquidated, liquidationPrice } = checkLiquidation(
    currentCandle.close,
    futuresContext
  );
  
  if (liquidated) {
    // Закрыть позицию с ликвидацией
    const { pnl } = closeFuturesPosition(liquidationPrice, futuresContext);
    
    activeTrade.exitPrice = liquidationPrice;
    activeTrade.exitTimestamp = currentCandle.timestamp;
    activeTrade.exitReason = 'LIQUIDATION';
    activeTrade.pnl = pnl;
    
    // Маржа теряется при ликвидации
    // currentCapital НЕ возвращается margin
    
    trades.push({ ...activeTrade });
    activeTrade = null;
    
    continue; // Пропустить остальные проверки
  }
  
  // Обновить статистику расстояния
  updateLiquidationDistance(currentCandle.close, futuresContext);
}
```

#### Шаг 4: Добавить Учет Funding Rate
```typescript
// В цикле по свечам, если есть активная позиция
if (activeTrade && isFuturesMode && futuresContext && futuresContext.trackFunding) {
  const fundingCost = await applyFundingRate(
    currentCandle.timestamp,
    futuresContext,
    params.pairSymbol,
    (params.exchange as 'bybit' | 'okx') || 'bybit'
  );
  
  if (fundingCost !== 0) {
    currentCapital -= fundingCost;
    
    logger.debug('[RunBacktest] Funding applied', {
      cost: fundingCost,
      newCapital: currentCapital
    });
  }
}
```

#### Шаг 5: Модифицировать Закрытие Позиций
```typescript
// При закрытии позиции (SL/TP/Manual)
if (isFuturesMode && futuresContext) {
  const { pnl, pnlWithLeverage } = closeFuturesPosition(
    exitPrice,
    futuresContext
  );
  
  activeTrade.pnl = pnl;
  
  // Вернуть маржу
  const marginToRelease = activeTrade.margin || 0;
  currentCapital += marginToRelease;
  
} else {
  // Существующая логика для спота
  // ... расчет pnl ...
}
```

#### Шаг 6: Финализировать Метрики
```typescript
// В конце функции, при формировании результатов
const metrics: BacktestMetrics = {
  // ... существующие метрики ...
  
  // НОВОЕ: Добавить фьючерсные метрики
  futuresStats: isFuturesMode && futuresContext 
    ? finalizeFuturesStats(
        futuresContext,
        totalPnl,
        params.initialCapital,
        totalMarginUsed
      )
    : undefined
};
```

---

## ⚠️ Важные Моменты

### 1. Обратная Совместимость
- ✅ Старый код БЕЗ `strategyProfile` работает как раньше
- ✅ Автоматическое определение профиля через `detectProfile()`
- ✅ Фьючерсная логика активируется только если `futuresContext !== null`

### 2. Расчет P&L
- Для **спота**: `pnl = (exitPrice - entryPrice) * size`
- Для **фьючерсов**: то же, но учитывается funding cost
- **Маржа** возвращается только при нормальном закрытии, не при ликвидации

### 3. Funding Rate
- Применяется **каждые 8 часов** (00:00, 08:00, 16:00 UTC)
- Может быть **положительным** (платим) или **отрицательным** (получаем)
- Вычитается/добавляется к `currentCapital`

### 4. Ликвидация
- Проверяется **на каждой свече**
- При ликвидации **маржа теряется полностью**
- Позиция закрывается по **цене ликвидации**

---

## 📊 Пример Результата

### Spot Backtest Result:
```json
{
  "metrics": {
    "totalPnl": 1500,
    "totalTrades": 20,
    "winRate": 60,
    "futuresStats": null  // Нет для спота
  }
}
```

### Futures Backtest Result:
```json
{
  "metrics": {
    "totalPnl": 3500,
    "totalTrades": 35,
    "winRate": 55,
    "futuresStats": {
      "averageLeverage": 5.2,
      "maxLeverage": 7,
      "liquidations": 2,
      "fundingPaid": 125,
      "fundingReceived": 80,
      "netFunding": -45,
      "effectiveROI": 35,
      "capitalEfficiency": 87.5,
      "averageDistanceToLiquidation": 25.3,
      "minDistanceToLiquidation": 12.1,
      "marginCallsAvoided": 3
    }
  }
}
```

---

## 🧪 Тестирование

### Минимальный Тест:
```typescript
// Тест 1: Spot режим (обратная совместимость)
const spotResult = await runBacktest({
  pairSymbol: 'BTCUSDT',
  timeframe: '1h',
  startDate: '2024-01-01',
  endDate: '2024-01-02',
  initialCapital: 10000,
  strategyParameters: defaultParams
  // НЕТ strategyProfile - должен работать как раньше
}, candles);

console.assert(!spotResult.metrics.futuresStats, 'No futures stats for spot');

// Тест 2: Futures режим
const futuresResult = await runBacktest({
  pairSymbol: 'BTCUSDT',
  timeframe: '1h',
  startDate: '2024-01-01',
  endDate: '2024-01-02',
  initialCapital: 10000,
  strategyParameters: defaultParams,
  strategyProfile: 'futures'  // <-- Включить фьючерсы
}, candles);

console.assert(futuresResult.metrics.futuresStats, 'Has futures stats');
console.assert(futuresResult.metrics.futuresStats.liquidations >= 0, 'Has liquidation count');
```

---

## 📝 TODO

- [ ] Реализовать все шаги 1-6 в `backtester.ts`
- [ ] Добавить unit-тесты для `backtester.futures.ts`
- [ ] Протестировать на реальных данных
- [ ] Обновить API контроллер для приема `strategyProfile`
- [ ] Создать UI для выбора профиля
- [ ] Документировать изменения API

---

**Автор:** AI Senior Assistant  
**Версия:** 1.0  
**Связанные файлы:**
- `backtester.ts` - основной файл
- `backtester.futures.ts` - логика фьючерсов
- `backtester.types.ts` - типы




