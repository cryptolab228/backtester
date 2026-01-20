# 📈 План Адаптации Стратегии под Фьючерсную Торговлю

## 🎯 Цель
Адаптировать текущую торговую стратегию для оптимальной работы с фьючерсными/бессрочными контрактами, сохранив совместимость со старым функционалом.

## 📊 Текущее Состояние

### ✅ Что уже реализовано:
- **Bybit API интеграция** с бессрочными USDT-контрактами (perpetual swaps)
- **Category: 'linear'** - линейные фьючерсы в Bybit API V5
- **Мультитаймфреймный анализ**: 15m, 1h, 4h, 1d
- **Основные индикаторы**: ATR, Volume Profile, NWE, Clusters
- **Портфельный бектестер** с управлением капиталом

### ⚠️ Важное открытие:
**Проект УЖЕ использует фьючерсные данные!**
- Bybit perpetual swaps (бессрочные контракты) - это **фьючерсный инструмент**
- Отличия от традиционных фьючерсов: нет экспирации, есть funding rate
- Торгуются с кредитным плечом
- Расчеты в USDT (не обратные контракты)

## 🔍 Ключевые Отличия: Спот vs Фьючерсы

### Спот-торговля:
- ✅ Физическая поставка актива
- ✅ Без кредитного плеча (или минимальное)
- ✅ Нет комиссий за финансирование
- ✅ Нет риска ликвидации
- ❌ Меньшая капиталоэффективность
- ❌ Только длинные позиции (без шорта без маржи)

### Фьючерсная торговля (Perpetual Swaps):
- ✅ Высокая капиталоэффективность (плечо до 100x)
- ✅ Возможность шортить без займа
- ✅ Длинные и короткие позиции равноценны
- ✅ Глубокая ликвидность
- ❌ Funding rate каждые 8 часов
- ❌ Риск ликвидации при неправильном управлении плечом
- ❌ Более волатильный PnL из-за плеча

## 🎯 Стратегия Адаптации

### Этап 1: Аудит Текущих Параметров ✅

**Действия:**
1. Проверить, что используются фьючерсные свечи (category: 'linear')
2. Изучить текущие параметры стратегии
3. Выявить спот-специфичные настройки

**Файлы для проверки:**
- `backend/src/services/bybitApiService.ts`
- `backend/src/modules/strategy/*.ts`
- `backend/src/modules/indicators/*.ts`

### Этап 2: Новые Параметры для Фьючерсов 🆕

#### 2.1. Параметры управления плечом:
```typescript
interface FuturesStrategyParams {
  // Существующие параметры стратегии
  ...existingParams,
  
  // Новые параметры для фьючерсов
  leverage: {
    enabled: boolean;           // Использовать ли плечо
    value: number;              // Размер плеча (1-100x)
    mode: 'fixed' | 'dynamic';  // Фиксированное или динамическое
    maxLeverage: number;        // Максимальное плечо для dynamic
  },
  
  // Управление рисками при ликвидации
  liquidation: {
    bufferPercent: number;      // Буфер до цены ликвидации (%)
    autoReduceEnabled: boolean; // Авто-снижение плеча при риске
    warningThreshold: number;   // Порог предупреждения (%)
  },
  
  // Учет финансирования (funding rate)
  funding: {
    enabled: boolean;           // Учитывать ли funding rate
    maxRate: number;            // Макс. приемлемая ставка (%)
    avoidHighFunding: boolean;  // Избегать позиций с высоким funding
    checkInterval: number;      // Интервал проверки (мс)
  },
  
  // Размер позиции с учетом плеча
  positionSizing: {
    mode: 'capital' | 'risk' | 'kelly'; // Метод расчета
    riskPerTrade: number;       // Риск на сделку (% от капитала)
    maxPositionSize: number;    // Макс. размер позиции (% капитала)
    useEffectiveLeverage: boolean; // Использовать эффективное плечо
  }
}
```

#### 2.2. Модифицированные параметры стоп-лоссов:
```typescript
interface FuturesStopLoss {
  // Стандартный ATR-based SL
  atrMultiplier: number;        // 1.5-3.0 для фьючерсов (было 2-4)
  
  // Новое: SL с учетом ликвидации
  liquidationAware: {
    enabled: boolean;
    minDistanceToLiq: number;   // Мин. расстояние до ликвидации (%)
    adjustStopLoss: boolean;    // Подвинуть SL если близко к ликвидации
  },
  
  // Новое: Динамический SL для фьючерсов
  dynamic: {
    enabled: boolean;
    tightenOnProfit: boolean;   // Ужесточить SL при прибыли
    widentOnVolatility: boolean; // Расширить при волатильности
    fundingAdjustment: boolean; // Учесть funding при трейлинге
  }
}
```

#### 2.3. Оптимизированные параметры входа:
```typescript
interface FuturesEntryParams {
  // Более агрессивные параметры для фьючерсов
  minClusterStrength: number;   // 1.3-1.8 (было 1.5-2.0)
  volumeThreshold: number;      // 1.5-2.0 (было 2.0-2.5)
  
  // Фильтры специфичные для фьючерсов
  fundingRateFilter: {
    enabled: boolean;
    maxAbsValue: number;        // Макс. |funding rate| для входа
    favorDirection: boolean;    // Входить по направлению funding
  },
  
  // Анализ открытого интереса (Open Interest)
  openInterestFilter: {
    enabled: boolean;
    minChange: number;          // Мин. изменение OI для сигнала
    direction: 'long' | 'short' | 'both';
  },
  
  // Ликвидность и спред
  liquidityFilter: {
    enabled: boolean;
    minVolume24h: number;       // Мин. объем 24ч (USDT)
    maxSpreadPercent: number;   // Макс. спред bid-ask (%)
  }
}
```

### Этап 3: Система Профилей Стратегий 🔄

**Создать два профиля:**

#### Профиль "Spot Legacy" (совместимость):
```typescript
const spotProfile: StrategyProfile = {
  name: "Spot Strategy (Legacy)",
  marketType: "spot",
  leverage: { enabled: false, value: 1 },
  funding: { enabled: false },
  liquidation: { enabled: false },
  // Старые параметры стратегии
  ...legacySpotParams
}
```

#### Профиль "Futures Optimized" (новый):
```typescript
const futuresProfile: StrategyProfile = {
  name: "Futures Strategy (Optimized)",
  marketType: "futures",
  leverage: { 
    enabled: true, 
    value: 5,              // Консервативное 5x
    mode: 'dynamic',
    maxLeverage: 10
  },
  funding: { 
    enabled: true,
    maxRate: 0.05,         // Макс. 0.05% за 8ч
    avoidHighFunding: true 
  },
  liquidation: {
    bufferPercent: 20,     // 20% буфер до ликвидации
    autoReduceEnabled: true,
    warningThreshold: 30
  },
  // Оптимизированные параметры
  ...optimizedFuturesParams
}
```

### Этап 4: Реализация Модулей 🛠️

#### 4.1. Модуль управления плечом:
```typescript
// backend/src/modules/futures/leverageManager.ts
export class LeverageManager {
  calculateEffectiveLeverage(
    positionSize: number,
    accountBalance: number,
    leverage: number
  ): number;
  
  calculateLiquidationPrice(
    entryPrice: number,
    leverage: number,
    direction: 'long' | 'short',
    maintenanceMarginRate: number
  ): number;
  
  adjustLeverageForRisk(
    currentLeverage: number,
    distanceToLiquidation: number,
    volatility: number
  ): number;
}
```

#### 4.2. Модуль учета финансирования:
```typescript
// backend/src/modules/futures/fundingManager.ts
export class FundingManager {
  async getCurrentFundingRate(
    symbol: string,
    exchange: 'bybit' | 'okx'
  ): Promise<number>;
  
  calculateFundingCost(
    positionSize: number,
    fundingRate: number,
    holdingPeriodHours: number
  ): number;
  
  shouldAvoidPosition(
    fundingRate: number,
    direction: 'long' | 'short',
    threshold: number
  ): boolean;
}
```

#### 4.3. Модуль расчета позиции:
```typescript
// backend/src/modules/futures/positionSizer.ts
export class FuturesPositionSizer {
  calculatePositionSize(
    accountBalance: number,
    riskPercent: number,
    entryPrice: number,
    stopLoss: number,
    leverage: number
  ): {
    contracts: number;
    notionalValue: number;
    requiredMargin: number;
    effectiveLeverage: number;
  };
  
  // Kelly Criterion для фьючерсов
  kellyPositionSize(
    winRate: number,
    avgWin: number,
    avgLoss: number,
    leverage: number,
    maxKelly: number
  ): number;
}
```

### Этап 5: Интеграция в Бектестер ⚙️

#### 5.1. Обновить бектест-движок:
```typescript
// backend/src/modules/backtester/runBacktest.ts
export async function runBacktest(params: BacktestParams) {
  const strategyProfile = params.strategyProfile || 'spot'; // Default spot
  
  if (strategyProfile === 'futures') {
    // Использовать FuturesPositionSizer
    // Учесть funding rate в P&L
    // Проверять ликвидацию на каждой свече
    // Применить динамическое плечо
  }
  
  // Существующая логика для spot
}
```

#### 5.2. Новые метрики для фьючерсов:
```typescript
interface FuturesBacktestMetrics extends BaseMetrics {
  // Специфичные метрики
  averageLeverage: number;
  maxLeverage: number;
  liquidations: number;              // Количество ликвидаций
  fundingPaidReceived: number;       // Чистый funding P&L
  effectiveROI: number;              // ROI с учетом плеча
  capitalEfficiency: number;         // Прибыль / использованная маржа
  
  // Риск-метрики
  averageDistanceToLiquidation: number;
  minDistanceToLiquidation: number;
  marginCallsAvoided: number;
}
```

### Этап 6: Оптимизация Параметров 📊

#### 6.1. Параметры для оптимизации:
```typescript
const futuresOptimizationGrid = {
  // Плечо
  leverage: [3, 5, 7, 10],
  
  // Стоп-лосс
  stopLoss: {
    atrMultiplier: [1.5, 2.0, 2.5, 3.0]
  },
  
  // Тейк-профит
  takeProfit: {
    riskRewardRatio: [1.5, 2.0, 2.5, 3.0]
  },
  
  // Вход
  entry: {
    minClusterStrength: [1.3, 1.5, 1.8],
    volumeThreshold: [1.5, 1.8, 2.0]
  },
  
  // Funding
  funding: {
    maxRate: [0.03, 0.05, 0.08, 0.10]
  }
};
```

#### 6.2. Методология оптимизации:
1. **Walk-Forward Analysis**
   - Обучающий период: 70% данных
   - Тестовый период: 30% данных
   - Окно: скользящее 3 месяца

2. **Monte Carlo с плечом**
   - 10,000 симуляций
   - Случайное перемешивание сделок
   - Учет funding rate вариативности

3. **Stress Testing**
   - Тест на черных лебедей (падение 30-50%)
   - Тест на высокую волатильность
   - Тест на экстремальный funding rate

### Этап 7: UI/UX Изменения 🎨

#### 7.1. Фронтенд компоненты:
```vue
<!-- frontend/src/components/FuturesSettingsForm.vue -->
<template>
  <div class="futures-settings">
    <!-- Выбор профиля стратегии -->
    <SelectButton 
      v-model="strategyProfile" 
      :options="['spot', 'futures']"
      @change="onProfileChange"
    />
    
    <!-- Настройки плеча (только для futures) -->
    <div v-if="strategyProfile === 'futures'">
      <InputNumber 
        v-model="leverage" 
        :min="1" 
        :max="100"
        prefix="Плечо: "
        suffix="x"
      />
      
      <!-- Предупреждение о рисках -->
      <Message severity="warn" v-if="leverage > 10">
        Высокое плечо увеличивает риск ликвидации!
      </Message>
    </div>
    
    <!-- Визуализация ликвидации -->
    <LiquidationChart 
      :entry-price="entryPrice"
      :leverage="leverage"
      :direction="direction"
    />
  </div>
</template>
```

#### 7.2. Дополнительные элементы UI:
- **Калькулятор ликвидации** - показ цены ликвидации
- **Funding rate индикатор** - текущие ставки
- **Риск-метр** - визуализация риска с учетом плеча
- **Сравнительная таблица** - Spot vs Futures метрики

## 📁 Структура Файлов

```
backend/src/modules/
├── futures/                          # НОВЫЙ модуль
│   ├── leverageManager.ts           # Управление плечом
│   ├── fundingManager.ts            # Учет финансирования
│   ├── positionSizer.ts             # Расчет позиций
│   ├── liquidationCalculator.ts     # Расчет ликвидации
│   └── futuresRiskManager.ts        # Риск-менеджмент
│
├── strategy/                         # Обновленный
│   ├── profiles/                     # НОВАЯ папка
│   │   ├── spotProfile.ts           # Профиль для спота
│   │   └── futuresProfile.ts        # Профиль для фьючерсов
│   ├── index.ts                      # Роутер профилей
│   └── ...existing files
│
├── backtester/
│   ├── runBacktest.ts               # Обновить: поддержка профилей
│   ├── runPortfolioBacktest.ts      # Обновить: учет funding
│   └── metrics/
│       └── futuresMetrics.ts        # НОВЫЙ: фьючерсные метрики
│
frontend/src/
├── components/
│   ├── FuturesSettingsForm.vue      # НОВЫЙ
│   ├── LiquidationChart.vue         # НОВЫЙ
│   ├── FundingRateDisplay.vue       # НОВЫЙ
│   └── StrategyProfileSelector.vue  # НОВЫЙ
│
└── views/
    └── BacktesterView.vue            # Обновить: интеграция профилей
```

## 🔄 Миграционный Путь

### Сохранение старого функционала:
1. **Не удалять существующий код** - добавить рядом
2. **Использовать профили** - spot (по умолчанию), futures (опционально)
3. **Обратная совместимость** - старые запросы без `strategyProfile` работают как раньше
4. **Постепенный переход** - пользователи могут тестировать оба режима

### Пример API запроса (обратная совместимость):
```typescript
// Старый запрос (работает как раньше)
POST /api/backtest/run
{
  "pairSymbol": "BTCUSDT",
  "timeframe": "1h",
  // старые параметры
}

// Новый запрос с профилем
POST /api/backtest/run
{
  "pairSymbol": "BTCUSDT",
  "timeframe": "1h",
  "strategyProfile": "futures",  // <-- НОВОЕ
  "leverage": 5,                 // <-- НОВОЕ
  // новые параметры
}
```

## 📝 Следующие Шаги

### Приоритет 1 (критично):
- [ ] Проверить текущие источники данных (category: 'linear')
- [ ] Создать модуль `FuturesPositionSizer`
- [ ] Создать модуль `LeverageManager`
- [ ] Реализовать систему профилей стратегий

### Приоритет 2 (важно):
- [ ] Добавить учет funding rate в бектестер
- [ ] Реализовать расчет цены ликвидации
- [ ] Создать UI компоненты для фьючерсов
- [ ] Оптимизировать параметры через бектестинг

### Приоритет 3 (улучшения):
- [ ] Monte Carlo с учетом плеча
- [ ] Walk-Forward Analysis для фьючерсов
- [ ] Advanced риск-метрики
- [ ] Real-time мониторинг funding rate

## ⚠️ Важные Замечания

1. **Риски высокого плеча:**
   - Начинать с консервативного плеча (3-5x)
   - Обязательно тестировать на истории
   - Использовать строгий риск-менеджмент

2. **Funding rate:**
   - Может значительно влиять на P&L при долгих позициях
   - Мониторить и учитывать в стратегии
   - Избегать позиций с экстремальным funding

3. **Ликвидность:**
   - Фьючерсы часто более ликвидны
   - Проверять глубину стакана
   - Учитывать проскальзывание

4. **Тестирование:**
   - Обязательный бектестинг перед live
   - Paper trading с реальным funding rate
   - Стресс-тестирование портфеля

## 📚 Дополнительная Документация

Создать отдельные гайды:
- `FUTURES_RISK_MANAGEMENT.md` - риск-менеджмент для фьючерсов
- `LEVERAGE_GUIDE.md` - руководство по использованию плеча
- `FUNDING_RATE_EXPLAINED.md` - объяснение механизма финансирования
- `LIQUIDATION_PREVENTION.md` - как избежать ликвидации

---

**Автор:** AI Senior Assistant  
**Дата создания:** 18.10.2025  
**Статус:** 🔄 В разработке  
**Версия:** 1.0




