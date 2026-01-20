# 📊 Strategy Profiles System - Система Профилей Стратегий

Система управления профилями торговых стратегий с поддержкой спотового и фьючерсного рынков.

## 🎯 Цель

Предоставить гибкую систему переключения между спотовым и фьючерсным режимами торговли с сохранением полной обратной совместимости.

## 📁 Структура

```
profiles/
├── types.ts            # Типы и интерфейсы
├── spotProfile.ts      # Профиль для спота (legacy)
├── futuresProfile.ts   # Профиль для фьючерсов
├── index.ts            # Роутер профилей
└── README.md           # Этот файл
```

## 🚀 Быстрый Старт

### Импорт

```typescript
import { 
  getStrategyProfile, 
  spotProfile, 
  futuresProfile 
} from '@/modules/strategy_logic/profiles';
```

### Использование

```typescript
// Получить спот-профиль (по умолчанию)
const spotParams = getStrategyProfile('spot');

// Получить фьючерс-профиль
const futuresParams = getStrategyProfile('futures');

// Автоопределение профиля
const profile = detectProfile(params);
```

## 📖 Детальное Руководство

### 1. Spot Profile (Спотовый Профиль)

**Характеристики:**
- ✅ Без кредитного плеча
- ✅ Нет комиссий за финансирование
- ✅ Нет риска ликвидации
- ✅ Консервативные параметры
- ✅ Обратная совместимость

**Параметры:**
```typescript
{
  profileName: 'spot',
  marketType: 'spot',
  risk: {
    stopLossMultiplier: 2.0,      // Широкий SL
    takeProfitMultiplier: 5.0,    // Широкий TP
    maxTradesPerDay: 2,           // Меньше сделок
    positionSizePercentage: 0.02  // 2% капитала
  },
  futures: undefined                // Нет фьючерс настроек
}
```

**Пример использования:**
```typescript
const spotParams = getSpotParameters();
console.log('Market type:', spotParams.marketType); // 'spot'
```

---

### 2. Futures Profile (Фьючерсный Профиль)

**Характеристики:**
- ✅ Плечо 5x (консервативное)
- ✅ Учет funding rate
- ✅ Защита от ликвидации
- ✅ Оптимизированные параметры
- ✅ Динамическое управление плечом

**Параметры:**
```typescript
{
  profileName: 'futures',
  marketType: 'futures',
  risk: {
    stopLossMultiplier: 1.8,      // Узкий SL
    takeProfitMultiplier: 3.5,    // Близкий TP
    maxTradesPerDay: 4,           // Больше сделок
    positionSizePercentage: 0.015 // 1.5% маржи
  },
  futures: {
    leverage: {
      enabled: true,
      value: 5,                   // 5x плечо
      mode: 'dynamic',            // Динамическое
      maxLeverage: 10
    },
    liquidation: {
      bufferPercent: 25,          // 25% буфер
      autoAdjust: true
    },
    funding: {
      enabled: true,
      maxRate: 0.05,
      avoidHighFunding: true
    }
  }
}
```

**Пример использования:**
```typescript
const futuresParams = getFuturesParameters();
console.log('Leverage:', futuresParams.futures?.leverage.value); // 5
```

---

### 3. Получение Профилей

#### Базовое получение

```typescript
// Spot по умолчанию
const params = getStrategyProfile();

// Конкретный профиль
const spotParams = getStrategyProfile('spot');
const futuresParams = getStrategyProfile('futures');
```

#### С переопределениями

```typescript
const customParams = getStrategyProfile('futures', {
  overrides: {
    futures: {
      leverage: {
        enabled: true,
        value: 7,  // Изменить плечо на 7x
        mode: 'fixed',
        maxLeverage: 10
      }
    },
    risk: {
      maxTradesPerDay: 6  // Больше сделок
    }
  }
});
```

#### С валидацией

```typescript
const params = getStrategyProfile('futures', {
  strict: true,  // Строгая валидация
  applyConstraints: true  // Применить ограничения
});
```

---

### 4. Валидация Профилей

```typescript
import { validateProfile } from '@/modules/strategy_logic/profiles';

const validation = validateProfile(params);

if (!validation.isValid) {
  console.error('Errors:', validation.errors);
  // ['Invalid leverage: 150. Must be between 1 and 100']
}

if (validation.warnings.length > 0) {
  console.warn('Warnings:', validation.warnings);
  // ['High leverage detected: 15x. Consider using lower leverage']
}
```

---

### 5. Конвертация Профилей

#### Spot → Futures

```typescript
import { convertToFutures } from '@/modules/strategy_logic/profiles';

const spotParams = getSpotParameters();
const futuresParams = convertToFutures(spotParams, 5); // 5x leverage

console.log('Converted to futures with 5x leverage');
```

#### Futures → Spot

```typescript
import { convertToSpot } from '@/modules/strategy_logic/profiles';

const futuresParams = getFuturesParameters();
const spotParams = convertToSpot(futuresParams);

console.log('Converted to spot (removed leverage)');
```

---

### 6. Кастомные Профили

```typescript
import { createCustomFuturesProfile } from '@/modules/strategy_logic/profiles';

// Создать профиль с кастомным плечом
const custom7x = createCustomFuturesProfile(7, 12);

console.log('Custom profile:', custom7x.futures?.leverage.value); // 7
```

---

### 7. Сравнение Профилей

```typescript
import { compareProfiles } from '@/modules/strategy_logic/profiles';

const spot = getSpotParameters();
const futures = getFuturesParameters();

const comparison = compareProfiles(spot, futures);

console.log('Identical:', comparison.identical); // false
console.log('Differences:', comparison.differences);
// [
//   'Market type: spot vs futures',
//   'Leverage: 1x vs 5x',
//   'Stop Loss: 2 vs 1.8',
//   'Take Profit: 5 vs 3.5'
// ]
```

---

### 8. Рекомендации

```typescript
import { getRecommendedProfile } from '@/modules/strategy_logic/profiles';

const recommended = getRecommendedProfile({
  volatility: 'medium',
  trend: 'trending',
  experience: 'intermediate'
});

console.log('Recommended:', recommended); // 'futures'
```

---

## 🔄 Интеграция в Бектестер

### Пример базовой интеграции

```typescript
import { getStrategyProfile } from '@/modules/strategy_logic/profiles';

export async function runBacktest(params: BacktestParams) {
  // Получить профиль (spot по умолчанию)
  const strategyProfile = params.strategyProfile || 'spot';
  const profile = getStrategyProfile(strategyProfile);
  
  // Проверить тип рынка
  if (profile.marketType === 'futures') {
    // Использовать модули фьючерсов
    const { leverageManager, fundingManager, futuresPositionSizer } = 
      await import('@/modules/futures');
    
    // Логика для фьючерсов
    // ...
  } else {
    // Логика для спота
    // ...
  }
}
```

### Полный пример с фьючерсами

```typescript
import { getStrategyProfile } from '@/modules/strategy_logic/profiles';
import { 
  leverageManager, 
  fundingManager, 
  futuresPositionSizer 
} from '@/modules/futures';

async function runFuturesBacktest(params: BacktestParams) {
  const profile = getStrategyProfile('futures');
  const leverage = profile.futures!.leverage.value;
  
  for (const candle of candles) {
    // Рассчитать размер позиции
    const position = futuresPositionSizer.calculatePositionSize(
      accountBalance,
      profile.risk!.maxRiskPerTradePercentage! * 100,
      candle.close,
      stopLossPrice,
      leverage
    );
    
    // Проверить ликвидацию
    const liqPrice = leverageManager.calculateLiquidationPrice(
      entryPrice,
      leverage,
      direction
    );
    
    if (leverageManager.isLiquidated(candle.close, liqPrice, direction)) {
      // Обработать ликвидацию
      closeTrade('liquidation');
    }
    
    // Учесть funding
    if (fundingManager.isFundingTime(candle.timestamp)) {
      const fundingData = await fundingManager.getCurrentFundingRate(
        params.symbol,
        params.exchange
      );
      
      const cost = fundingManager.calculateFundingCost(
        position.contracts,
        candle.close,
        fundingData.rate,
        direction
      );
      
      accountBalance -= cost;
    }
  }
}
```

---

## 📊 Сравнение Профилей

| Параметр | Spot | Futures |
|----------|------|---------|
| **Плечо** | 1x | 5x |
| **Stop Loss** | 2.0 ATR | 1.8 ATR |
| **Take Profit** | 5.0 ATR | 3.5 ATR |
| **Max Trades/Day** | 2 | 4 |
| **Position Size** | 2% | 1.5% маржи |
| **Trailing Stop** | ❌ | ✅ |
| **Funding Rate** | N/A | ✅ Учитывается |
| **Liquidation** | N/A | ✅ Контролируется |

---

## ⚠️ Важные Замечания

### 1. Обратная Совместимость

```typescript
// Старый код ПРОДОЛЖАЕТ РАБОТАТЬ без изменений
const params = getStrategyProfile(); // По умолчанию 'spot'

// Все существующие запросы без указания профиля
// автоматически используют spot профиль
```

### 2. Миграция

```typescript
// Если вы хотите переключиться на фьючерсы,
// просто передайте 'futures' в параметрах
const params = getStrategyProfile('futures');

// Или явно укажите в API запросе
POST /api/backtest/run
{
  "strategyProfile": "futures",  // <-- НОВОЕ
  "pairSymbol": "BTCUSDT",
  // ... остальные параметры
}
```

### 3. Безопасность

- **Начинайте с spot профиля** для изучения
- **Переходите на futures** только после тестирования
- **Используйте консервативное плечо** (3-5x)
- **Обязательно тестируйте** на истории

---

## 📝 TODO

- [ ] Добавить unit-тесты для профилей
- [ ] Создать UI для выбора профилей
- [ ] Добавить сохранение кастомных профилей в БД
- [ ] Реализовать A/B тестирование профилей
- [ ] Добавить экспорт/импорт профилей

---

**Версия:** 1.0  
**Дата:** 18.10.2025  
**Автор:** AI Senior Assistant




