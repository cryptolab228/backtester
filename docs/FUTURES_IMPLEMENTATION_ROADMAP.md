# 🗺️ Пошаговый План Адаптации под Фьючерсную Торговлю

**Статус:** 🔄 В разработке  
**Дата старта:** 18.10.2025  
**Оценка:** 3-4 недели  
**Прогресс:** 35% (данные готовы, логика требует доработки)

---

## 🎯 Главная Цель

Адаптировать текущую торговую стратегию для **оптимальной работы с фьючерсными/бессрочными контрактами**, сохранив полную **обратную совместимость** с существующим функционалом.

## ✅ Что УЖЕ Работает

| Компонент | Статус | Описание |
|-----------|--------|----------|
| **Источники данных** | ✅ 100% | Bybit linear + OKX SWAP/FUTURES |
| **Базовая стратегия** | ✅ 100% | Volume Profile, NWE, Clusters, ATR |
| **Бектестер** | ✅ 85% | Работает, но нужна адаптация |
| **Портфельный режим** | ✅ 100% | Мультипара с общим капиталом |
| **UI/UX** | ✅ 90% | Основной функционал готов |

## ❌ Что Нужно Добавить

| Компонент | Статус | Критичность |
|-----------|--------|-------------|
| **Управление плечом** | ❌ 0% | 🔴 Критично |
| **Учет funding rate** | ❌ 0% | 🔴 Критично |
| **Расчет ликвидации** | ❌ 0% | 🔴 Критично |
| **Оптимизация параметров** | ❌ 0% | 🟡 Важно |
| **Фьючерсные фильтры** | ❌ 0% | 🟡 Важно |
| **UI для фьючерсов** | ❌ 0% | 🟢 Желательно |

---

## 📅 Детальный План Реализации

### **ФАЗА 1: Базовая Инфраструктура (Неделя 1)** 🏗️

#### **Спринт 1.1: Создание Модулей Фьючерсов (Дни 1-2)**

**Цель:** Создать базовые модули для работы с фьючерсами

**Задачи:**
1. ✅ Создать `backend/src/modules/futures/leverageManager.ts`
2. ✅ Создать `backend/src/modules/futures/fundingManager.ts`
3. ✅ Создать `backend/src/modules/futures/positionSizer.ts`
4. ✅ Создать `backend/src/modules/futures/liquidationCalculator.ts`

**Файлы:**
```
backend/src/modules/futures/
├── index.ts                    # Экспорт всех модулей
├── leverageManager.ts          # Управление плечом
├── fundingManager.ts           # Учет финансирования
├── positionSizer.ts            # Расчет позиций с плечом
├── liquidationCalculator.ts    # Расчет цены ликвидации
└── types.ts                    # Типы для фьючерсов
```

**Примерная структура `leverageManager.ts`:**
```typescript
export class LeverageManager {
  // Рассчитать эффективное плечо
  calculateEffectiveLeverage(
    positionValue: number,
    accountBalance: number
  ): number;
  
  // Рассчитать цену ликвидации
  calculateLiquidationPrice(
    entryPrice: number,
    leverage: number,
    direction: 'long' | 'short',
    maintenanceMarginRate: number = 0.004
  ): number;
  
  // Проверить безопасность плеча
  isLeverageSafe(
    currentPrice: number,
    entryPrice: number,
    liquidationPrice: number,
    bufferPercent: number = 20
  ): boolean;
  
  // Рекомендовать плечо на основе волатильности
  recommendLeverage(
    atr: number,
    price: number,
    maxLeverage: number = 10
  ): number;
}
```

**Критерии приемки:**
- [ ] Все 4 модуля созданы с базовыми методами
- [ ] Типы TypeScript определены
- [ ] Базовые юнит-тесты написаны
- [ ] Модули экспортируются через `index.ts`

---

#### **Спринт 1.2: Система Профилей Стратегий (Дни 3-4)**

**Цель:** Создать систему переключения между спотовым и фьючерсным режимами

**Задачи:**
1. ✅ Создать `backend/src/modules/strategy_logic/profiles/`
2. ✅ Реализовать `spotProfile.ts` (текущие параметры)
3. ✅ Реализовать `futuresProfile.ts` (новые параметры)
4. ✅ Обновить типы `StrategyParameters`

**Файлы:**
```
backend/src/modules/strategy_logic/profiles/
├── index.ts                    # Роутер профилей
├── spotProfile.ts              # Профиль для спота (legacy)
├── futuresProfile.ts           # Профиль для фьючерсов
└── types.ts                    # Расширенные типы
```

**Расширение `StrategyParameters`:**
```typescript
export interface StrategyParameters {
  // Существующие параметры
  dlc?: DLCSettings;
  nwe?: NWESettings;
  clusters?: ClusterSettings;
  risk?: RiskManagementSettings;
  
  // НОВЫЕ параметры для фьючерсов
  marketType?: 'spot' | 'futures';  // Тип рынка
  futures?: FuturesSettings;         // Настройки фьючерсов
}

export interface FuturesSettings {
  leverage: {
    enabled: boolean;
    value: number;              // 1-100
    mode: 'fixed' | 'dynamic';
    maxLeverage: number;
  };
  
  liquidation: {
    bufferPercent: number;      // Буфер до ликвидации
    autoAdjust: boolean;        // Авто-корректировка
    warningThreshold: number;
  };
  
  funding: {
    enabled: boolean;
    maxRate: number;            // Макс. приемлемая ставка
    avoidHigh: boolean;
    favorDirection: boolean;
  };
}
```

**Критерии приемки:**
- [ ] Профили созданы и экспортируются
- [ ] Типы обновлены без breaking changes
- [ ] Дефолтный профиль = 'spot' (обратная совместимость)
- [ ] Функция `getStrategyProfile(type)` работает

---

#### **Спринт 1.3: Интеграция с Бектестером (День 5)**

**Цель:** Обновить бектестер для поддержки фьючерсов

**Задачи:**
1. ✅ Обновить `backend/src/modules/backtester/backtester.ts`
2. ✅ Добавить расчет P&L с учетом плеча
3. ✅ Добавить расчет funding costs
4. ✅ Добавить проверку ликвидации

**Изменения в `runBacktest`:**
```typescript
export async function runBacktest(params: BacktestParams) {
  const { strategyProfile = 'spot' } = params;
  
  // Загрузить профиль
  const profile = getStrategyProfile(strategyProfile);
  
  // Инициализация модулей фьючерсов (если нужно)
  let leverageManager, fundingManager, positionSizer;
  if (profile.marketType === 'futures') {
    leverageManager = new LeverageManager();
    fundingManager = new FundingManager();
    positionSizer = new FuturesPositionSizer();
  }
  
  // Основной цикл бектеста
  for (const candle of candles) {
    // ... существующая логика ...
    
    if (profile.marketType === 'futures') {
      // Проверка ликвидации
      const liquidationPrice = leverageManager.calculateLiquidationPrice(...);
      if (isLiquidated(candle.close, liquidationPrice)) {
        // Закрыть позицию с убытком
        // Обновить статистику ликвидаций
      }
      
      // Расчет funding cost (каждые 8 часов)
      if (isFundingTime(candle.timestamp)) {
        const fundingCost = fundingManager.calculateCost(...);
        currentCapital -= fundingCost;
      }
      
      // Расчет P&L с учетом плеча
      const pnl = calculatePnLWithLeverage(
        positionSize,
        entryPrice,
        exitPrice,
        leverage
      );
    }
  }
  
  return results;
}
```

**Критерии приемки:**
- [ ] Бектестер поддерживает оба режима (spot/futures)
- [ ] Расчет P&L корректен для фьючерсов
- [ ] Funding costs учитываются
- [ ] Ликвидация обрабатывается
- [ ] Старый код работает без изменений

---

### **ФАЗА 2: Оптимизация Параметров (Неделя 2)** 🎯

#### **Спринт 2.1: Подготовка Данных для Оптимизации (Дни 6-7)**

**Цель:** Подготовить качественные данные для тестирования

**Задачи:**
1. ✅ Загрузить 1-2 года исторических данных (Bybit)
2. ✅ Получить историю funding rates через API
3. ✅ Создать тестовые наборы (train/test split)
4. ✅ Подготовить benchmark стратегию

**Пары для тестирования:**
- **Major:** BTCUSDT, ETHUSDT
- **Altcoins:** SOLUSDT, BNBUSDT, XRPUSDT
- **Volatile:** DOGEUSDT, SHIBUSDT

**Периоды:**
- **Train:** 12 месяцев (70%)
- **Test:** 6 месяцев (30%)
- **Validation:** Последние 2 месяца

---

#### **Спринт 2.2: Grid Search Оптимизация (Дни 8-10)**

**Цель:** Найти оптимальные параметры для фьючерсов

**Сетка параметров:**
```typescript
const optimizationGrid = {
  // Плечо
  leverage: [3, 5, 7, 10],
  
  // Stop Loss
  stopLoss: {
    atrMultiplier: [1.5, 2.0, 2.5, 3.0]
  },
  
  // Take Profit
  takeProfit: {
    riskRewardRatio: [1.5, 2.0, 2.5, 3.0]
  },
  
  // Параметры входа
  entry: {
    minClusterStrength: [1.3, 1.5, 1.8],
    volumeThreshold: [1.5, 1.8, 2.0]
  },
  
  // Funding
  funding: {
    maxRate: [0.03, 0.05, 0.08]
  }
};
```

**Метрики оптимизации:**
- Sharpe Ratio (главная)
- Max Drawdown
- Win Rate
- Profit Factor
- Capital Efficiency (специфично для фьючерсов)

**Критерии приемки:**
- [ ] Запущено 500+ бектестов
- [ ] Найдены оптимальные параметры для каждой пары
- [ ] Результаты задокументированы
- [ ] Out-of-sample тестирование пройдено

---

#### **Спринт 2.3: Walk-Forward Analysis (Дни 11-12)**

**Цель:** Проверить устойчивость параметров во времени

**Методология:**
```
┌─────────────────────────────────────────┐
│  Walk-Forward Windows (3 месяца)       │
├─────────────────────────────────────────┤
│  [Train────][Test]                      │
│       [Train────][Test]                 │
│            [Train────][Test]            │
│                 [Train────][Test]       │
└─────────────────────────────────────────┘
```

**Критерии приемки:**
- [ ] Минимум 6 окон протестировано
- [ ] Параметры стабильны в 80%+ окон
- [ ] Degradation < 20% на out-of-sample

---

### **ФАЗА 3: UI/UX для Фьючерсов (Неделя 3)** 🎨

#### **Спринт 3.1: Фронтенд Компоненты (Дни 13-15)**

**Задачи:**
1. ✅ Создать `FuturesSettingsForm.vue`
2. ✅ Создать `LeverageCalculator.vue`
3. ✅ Создать `LiquidationChart.vue`
4. ✅ Создать `FundingRateDisplay.vue`

**Компоненты:**
```
frontend/src/components/futures/
├── FuturesSettingsForm.vue      # Основная форма настроек
├── LeverageCalculator.vue       # Калькулятор плеча
├── LiquidationChart.vue         # График ликвидации
├── FundingRateDisplay.vue       # Отображение funding
├── StrategyProfileSelector.vue  # Переключатель профилей
└── FuturesRiskMeter.vue         # Визуализация рисков
```

---

#### **Спринт 3.2: Интеграция в BacktesterView (Дни 16-17)**

**Обновление `BacktesterView.vue`:**
```vue
<template>
  <div class="backtester-view">
    <!-- Переключатель профилей -->
    <StrategyProfileSelector 
      v-model="selectedProfile"
      @change="onProfileChange"
    />
    
    <!-- Настройки спота (если spot) -->
    <StrategySettingsForm 
      v-if="selectedProfile === 'spot'"
      v-model="spotParams"
    />
    
    <!-- Настройки фьючерсов (если futures) -->
    <FuturesSettingsForm 
      v-if="selectedProfile === 'futures'"
      v-model="futuresParams"
    />
    
    <!-- Калькулятор рисков -->
    <LeverageCalculator 
      v-if="selectedProfile === 'futures'"
      :leverage="futuresParams.leverage"
      :entry-price="estimatedEntry"
    />
    
    <!-- Результаты -->
    <BacktestResults :results="results" />
  </div>
</template>
```

---

### **ФАЗА 4: Тестирование и Документация (Неделя 4)** ✅

#### **Спринт 4.1: Комплексное Тестирование (Дни 18-20)**

**Тесты:**
1. ✅ Unit-тесты для всех модулей фьючерсов
2. ✅ Интеграционные тесты бектестера
3. ✅ E2E тесты UI
4. ✅ Тесты обратной совместимости

**Сценарии:**
- Бектест со спот-профилем (старый функционал)
- Бектест с фьючерс-профилем (новый)
- Переключение профилей в UI
- Портфельный бектест (оба режима)
- Stress-тесты (экстремальные параметры)

---

#### **Спринт 4.2: Документация (Дни 21-23)**

**Документы для создания:**
1. ✅ `FUTURES_RISK_MANAGEMENT.md` - риск-менеджмент
2. ✅ `LEVERAGE_GUIDE.md` - гайд по плечу
3. ✅ `FUNDING_RATE_EXPLAINED.md` - механизм финансирования
4. ✅ `LIQUIDATION_PREVENTION.md` - как избежать ликвидации
5. ✅ `MIGRATION_GUIDE.md` - миграция с spot на futures
6. ✅ `API_CHANGES.md` - изменения API

---

#### **Спринт 4.3: Релиз (День 24-25)**

**Задачи:**
1. ✅ Code review
2. ✅ Финальное тестирование
3. ✅ Обновление README
4. ✅ Подготовка release notes
5. ✅ Деплой на production

---

## 📊 Прогресс-трекер

### Общий прогресс: 35%

```
█████████░░░░░░░░░░░░░░░░  35%

✅ Фаза 0: Аудит               [████████████████████] 100%
🔄 Фаза 1: Инфраструктура      [████░░░░░░░░░░░░░░░░]  20%
⏳ Фаза 2: Оптимизация         [░░░░░░░░░░░░░░░░░░░░]   0%
⏳ Фаза 3: UI/UX               [░░░░░░░░░░░░░░░░░░░░]   0%
⏳ Фаза 4: Тестирование        [░░░░░░░░░░░░░░░░░░░░]   0%
```

### Детальная статистика:

| Модуль | Задачи | Завершено | Прогресс |
|--------|--------|-----------|----------|
| **Leverage Manager** | 8 | 0 | 0% |
| **Funding Manager** | 6 | 0 | 0% |
| **Position Sizer** | 5 | 0 | 0% |
| **Liquidation Calc** | 4 | 0 | 0% |
| **Strategy Profiles** | 6 | 0 | 0% |
| **Backtester Integration** | 12 | 2 | 17% |
| **Parameter Optimization** | 10 | 0 | 0% |
| **UI Components** | 15 | 0 | 0% |
| **Testing** | 20 | 0 | 0% |
| **Documentation** | 8 | 3 | 38% |
| **ИТОГО** | **94** | **5** | **5.3%** |

---

## 🚨 Риски и Митигация

| Риск | Вероятность | Влияние | Митигация |
|------|-------------|---------|-----------|
| Breaking changes для старого кода | Средняя | Высокое | Система профилей + тесты совместимости |
| Сложность оптимизации | Высокая | Среднее | Начать с малого набора параметров |
| Недостаток исторических данных | Низкая | Среднее | Использовать Bybit API (1000 свечей/запрос) |
| UI перегружен настройками | Средняя | Низкое | Скрыть продвинутые настройки в аккордеон |
| Ошибки в расчете ликвидации | Низкая | Критическое | Тщательное тестирование + cross-check с биржей |

---

## 📚 Связанные Документы

| Документ | Статус | Описание |
|----------|--------|----------|
| `FUTURES_STRATEGY_ADAPTATION_PLAN.md` | ✅ Готов | Детальный технический план |
| `FUTURES_AUDIT_REPORT.md` | ✅ Готов | Результаты аудита |
| `FUTURES_VERIFICATION_CHECKLIST.md` | ✅ Готов | Чеклист проверки |
| `FUTURES_RISK_MANAGEMENT.md` | ⏳ TODO | Руководство по рискам |
| `LEVERAGE_GUIDE.md` | ⏳ TODO | Гайд по плечу |
| `FUNDING_RATE_EXPLAINED.md` | ⏳ TODO | Механизм финансирования |

---

## 💬 Вопросы и Ответы

### **Q: Нужно ли мне что-то менять в текущем коде для продолжения работы?**
**A:** Нет! Система полностью обратно совместима. По умолчанию используется спот-профиль с текущими настройками.

### **Q: Как переключиться на фьючерсный режим?**
**A:** В UI будет переключатель "Spot / Futures". Также можно передать `strategyProfile: 'futures'` в API запросе.

### **Q: Какое плечо рекомендуется использовать?**
**A:** Для начала: 3-5x (консервативно), для опытных: 5-10x. Выше 10x - экстремально рискованно.

### **Q: Будет ли работать портфельный бектестер с фьючерсами?**
**A:** Да! Портфельный режим будет поддерживать оба профиля.

### **Q: Как понять, что параметры оптимизированы правильно?**
**A:** Смотрите на out-of-sample результаты и Walk-Forward Analysis. Если деградация < 20% - параметры устойчивы.

---

## 🎯 Следующие Шаги

### Для начала работы:
1. 📖 Прочитай `FUTURES_AUDIT_REPORT.md` - понять текущее состояние
2. 📋 Прочитай `FUTURES_STRATEGY_ADAPTATION_PLAN.md` - детали реализации
3. 🚀 Начни с **Фазы 1, Спринт 1.1** - создание базовых модулей

### Команды для старта:
```bash
# 1. Создать структуру папок
mkdir -p backend/src/modules/futures
mkdir -p backend/src/modules/strategy_logic/profiles
mkdir -p frontend/src/components/futures

# 2. Создать файлы модулей (см. Спринт 1.1)

# 3. Запустить тесты
npm run test

# 4. Начать оптимизацию (после реализации)
npm run optimize:futures
```

---

**Удачи в адаптации! 🚀**

Если возникнут вопросы, обращайся к документации или задавай вопросы в issue tracker.

---

**Автор:** AI Senior Assistant  
**Последнее обновление:** 18.10.2025  
**Версия:** 1.0




