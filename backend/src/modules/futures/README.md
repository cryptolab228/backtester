# 📦 Модули Фьючерсной Торговли

Набор модулей для работы с фьючерсными контрактами, включая управление плечом, учет funding rate, расчет позиций и предотвращение ликвидации.

## 📁 Структура

```
futures/
├── types.ts                    # Типы и интерфейсы
├── leverageManager.ts          # Управление плечом
├── fundingManager.ts           # Учет финансирования
├── positionSizer.ts            # Расчет размера позиций
├── liquidationCalculator.ts    # Расчеты ликвидации
├── index.ts                    # Экспорт модулей
└── README.md                   # Этот файл
```

## 🚀 Быстрый Старт

### Импорт модулей

```typescript
import { 
  leverageManager, 
  fundingManager, 
  futuresPositionSizer,
  liquidationCalculator 
} from '@/modules/futures';
```

## 📖 Примеры Использования

### 1. LeverageManager - Управление Плечом

#### Рассчитать цену ликвидации

```typescript
const entryPrice = 50000;
const leverage = 10;
const direction = 'long';

const liquidationPrice = leverageManager.calculateLiquidationPrice(
  entryPrice,
  leverage,
  direction
);

console.log(`Цена ликвидации: $${liquidationPrice.toFixed(2)}`);
// Результат: Цена ликвидации: $45200.00
```

#### Проверить безопасность плеча

```typescript
const currentPrice = 51000;
const entryPrice = 50000;
const liquidationPrice = 45200;
const bufferPercent = 20;

const isSafe = leverageManager.isLeverageSafe(
  currentPrice,
  entryPrice,
  liquidationPrice,
  'long',
  bufferPercent
);

console.log(`Позиция безопасна: ${isSafe}`);
// Результат: Позиция безопасна: true
```

#### Рекомендовать плечо на основе волатильности

```typescript
const atr = 2000;  // ATR = $2000
const price = 50000;
const maxLeverage = 10;

const recommended = leverageManager.recommendLeverage(
  atr,
  price,
  maxLeverage
);

console.log(`Рекомендуемое плечо: ${recommended}x`);
// Результат: Рекомендуемое плечо: 5.5x
```

#### Комплексный расчет метрик

```typescript
const metrics = leverageManager.calculateLeverageMetrics(
  50000,      // entry price
  51000,      // current price
  10,         // leverage
  'long',     // direction
  10000,      // account balance
  0.2,        // position size (BTC)
  2000,       // ATR
  {           // settings
    enabled: true,
    value: 10,
    mode: 'dynamic',
    maxLeverage: 15
  }
);

console.log('Метрики плеча:', metrics);
// {
//   recommendedLeverage: 5.5,
//   effectiveLeverage: 10.2,
//   liquidationPrice: 45200,
//   distanceToLiquidation: 11.37,
//   isSafe: false,
//   riskLevel: 'high'
// }
```

---

### 2. FundingManager - Учет Финансирования

#### Получить текущую ставку funding rate

```typescript
const fundingData = await fundingManager.getCurrentFundingRate(
  'BTCUSDT',
  'bybit'
);

console.log(`Funding rate: ${fundingManager.formatFundingRate(fundingData.rate)}`);
console.log(`Следующее funding: ${new Date(fundingData.nextFundingTime)}`);
// Результат: 
// Funding rate: +0.0120%
// Следующее funding: 2025-10-18T16:00:00.000Z
```

#### Рассчитать стоимость funding

```typescript
const positionSize = 1;      // 1 BTC
const price = 50000;
const fundingRate = 0.0001;  // 0.01%
const direction = 'long';

const cost = fundingManager.calculateFundingCost(
  positionSize,
  price,
  fundingRate,
  direction
);

console.log(`Стоимость funding: $${cost.toFixed(2)}`);
// Результат: Стоимость funding: $5.00 (платим)
```

#### Рассчитать общую стоимость за период

```typescript
const totalCost = fundingManager.calculateTotalFundingCost(
  1,          // position size
  50000,      // price
  0.0001,     // funding rate
  'long',     // direction
  72          // holding period (3 дня = 72 часа)
);

console.log(`Общая стоимость за 3 дня: $${totalCost.cost.toFixed(2)}`);
console.log(`Избегать позицию: ${totalCost.shouldAvoid}`);
// Результат:
// Общая стоимость за 3 дня: $45.00 (9 событий по $5)
// Избегать позицию: false
```

#### Оценить влияние на стратегию

```typescript
const assessment = fundingManager.assessFundingImpact(
  0.0005,     // funding rate (высокий!)
  'long',     // direction
  {           // settings
    enabled: true,
    maxRate: 0.05,
    avoidHighFunding: true,
    favorDirection: false
  }
);

console.log(`Рекомендация: ${assessment.recommendation}`);
console.log(`Причина: ${assessment.reason}`);
console.log(`Ожидаемая стоимость: ${assessment.expectedCostPercent.toFixed(2)}%`);
// Результат:
// Рекомендация: avoid
// Причина: Высокий funding rate (0.050%) для long позиции
// Ожидаемая стоимость: 0.15%
```

---

### 3. FuturesPositionSizer - Расчет Размера Позиций

#### Базовый расчет на основе риска

```typescript
const position = futuresPositionSizer.calculatePositionSize(
  10000,      // account balance
  2,          // risk % per trade
  50000,      // entry price
  48000,      // stop loss
  10          // leverage
);

console.log('Расчет позиции:');
console.log(`Контракты: ${position.contracts.toFixed(4)} BTC`);
console.log(`Номинал: $${position.notionalValue.toFixed(2)}`);
console.log(`Требуемая маржа: $${position.requiredMargin.toFixed(2)}`);
console.log(`Эффективное плечо: ${position.effectiveLeverage.toFixed(2)}x`);
console.log(`Макс. убыток: $${position.maxLoss.toFixed(2)}`);
// Результат:
// Контракты: 0.0500 BTC
// Номинал: $2500.00
// Требуемая маржа: $250.00
// Эффективное плечо: 0.25x
// Макс. убыток: $100.00
```

#### Расчет с учетом тейк-профита

```typescript
const positionWithTP = futuresPositionSizer.calculatePositionSizeWithTP(
  10000,      // account balance
  2,          // risk %
  50000,      // entry price
  48000,      // stop loss
  55000,      // take profit
  10          // leverage
);

console.log(`R/R соотношение: ${positionWithTP.riskRewardRatio.toFixed(2)}`);
// Результат: R/R соотношение: 2.50 (выигрыш в 2.5 раза больше риска)
```

#### Kelly Criterion

```typescript
const kellyPosition = futuresPositionSizer.calculateKellyPositionSize(
  10000,      // account balance
  50000,      // entry price
  48000,      // stop loss
  5,          // leverage
  {           // Kelly params
    winRate: 0.55,
    avgWin: 500,
    avgLoss: 200,
    leverage: 5,
    maxKelly: 0.25
  }
);

console.log(`Kelly размер: ${kellyPosition.contracts.toFixed(4)} BTC`);
console.log(`Требуемая маржа: $${kellyPosition.requiredMargin.toFixed(2)}`);
```

#### Проверка достаточности маржи

```typescript
const hasSufficient = futuresPositionSizer.hasSufficientMargin(
  10000,      // account balance
  2500,       // required margin
  10          // reserve %
);

console.log(`Достаточно маржи: ${hasSufficient}`);
// Результат: Достаточно маржи: true (2500 < 9000)
```

---

### 4. LiquidationCalculator - Расчеты Ликвидации

#### Рассчитать цену ликвидации

```typescript
const liqPrice = liquidationCalculator.calculateLiquidationPrice(
  50000,      // entry price
  10,         // leverage
  'long'      // direction
);

console.log(`Цена ликвидации: $${liqPrice.toFixed(2)}`);
// Результат: Цена ликвидации: $45250.00
```

#### Проверить риск ликвидации

```typescript
const isRisk = liquidationCalculator.isLiquidationRisk(
  51000,      // current price
  45250,      // liquidation price
  'long',     // direction
  20          // warning threshold %
);

console.log(`Риск ликвидации: ${isRisk}`);
// Результат: Риск ликвидации: false
```

#### Получить полные данные о ликвидации

```typescript
const liqData = liquidationCalculator.getLiquidationData(
  50000,      // entry price
  51000,      // current price
  10,         // leverage
  'long',     // direction
  0.5         // position size
);

console.log('Данные о ликвидации:', liqData);
// {
//   price: 45250,
//   distance: 11.27,
//   maintenanceMarginRate: 0.005,
//   isAtRisk: false,
//   bufferAmount: 2875.00
// }
```

#### Рассчитать безопасное плечо

```typescript
const safeLeverage = liquidationCalculator.calculateSafeLeverage(
  2000,       // ATR
  50000,      // price
  30,         // target buffer %
  10          // max leverage
);

console.log(`Безопасное плечо: ${safeLeverage}x`);
// Результат: Безопасное плечо: 4x
```

#### Рассчитать максимальное плечо для стоп-лосса

```typescript
const maxLeverage = liquidationCalculator.calculateMaxLeverageForStopLoss(
  50000,      // entry price
  48000,      // stop loss
  'long',     // direction
  1.2         // buffer (20%)
);

console.log(`Макс. плечо для SL: ${maxLeverage}x`);
// Результат: Макс. плечо для SL: 20x
```

#### Симуляция ликвидации на истории

```typescript
const simulation = liquidationCalculator.simulateLiquidation(
  50000,                                    // entry price
  10,                                       // leverage
  'long',                                   // direction
  [51000, 50500, 49000, 48000, 45000]      // price history
);

console.log('Результат симуляции:', simulation);
// {
//   liquidated: true,
//   liquidationBar: 4,
//   liquidationPrice: 45000
// }
```

---

## 🔧 Интеграция в Бектестер

### Пример использования в backtester

```typescript
import {
  leverageManager,
  fundingManager,
  futuresPositionSizer,
  liquidationCalculator,
  type FuturesSettings
} from '@/modules/futures';

export async function runFuturesBacktest(params: BacktestParams) {
  const { strategyParams, futuresSettings } = params;
  
  // 1. Инициализация
  const leverage = futuresSettings.leverage.value;
  const accountBalance = params.initialCapital;
  
  // 2. Основной цикл бектеста
  for (const candle of candles) {
    // 3. Расчет размера позиции
    const position = futuresPositionSizer.calculatePositionSize(
      accountBalance,
      strategyParams.risk.maxRiskPerTradePercentage * 100,
      candle.close,
      stopLossPrice,
      leverage
    );
    
    // 4. Проверка ликвидации
    const liqPrice = liquidationCalculator.calculateLiquidationPrice(
      entryPrice,
      leverage,
      direction
    );
    
    if (liquidationCalculator.isLiquidated(candle.close, liqPrice, direction)) {
      // Обработать ликвидацию
      closeTrade('liquidation');
      continue;
    }
    
    // 5. Учет funding rate (каждые 8 часов)
    if (fundingManager.isFundingTime(candle.timestamp)) {
      const fundingData = await fundingManager.getCurrentFundingRate(
        params.symbol,
        params.exchange
      );
      
      const fundingCost = fundingManager.calculateFundingCost(
        position.contracts,
        candle.close,
        fundingData.rate,
        direction
      );
      
      accountBalance -= fundingCost;
    }
    
    // ... остальная логика бектеста
  }
}
```

---

## ⚠️ Важные Замечания

### 1. Funding Rate API
Метод `fundingManager.getCurrentFundingRate()` в текущей реализации возвращает моковые данные. Для продакшена необходимо реализовать реальные запросы к API биржи:

**Bybit:**
```typescript
GET https://api.bybit.com/v5/market/funding/history
?category=linear&symbol=BTCUSDT&limit=1
```

**OKX:**
```typescript
GET https://www.okx.com/api/v5/public/funding-rate
?instId=BTC-USDT-SWAP
```

### 2. Maintenance Margin Rate
Значения MMR могут отличаться на разных биржах и для разных инструментов. Текущие значения взяты из документации Bybit. Проверьте актуальные ставки для вашей биржи.

### 3. Плечо и Риски
- **Начинайте с консервативного плеча** (3-5x)
- **Обязательно тестируйте** на исторических данных
- **Используйте стоп-лоссы** всегда
- **Мониторьте расстояние до ликвидации**

---

## 📝 TODO

- [ ] Реализовать реальные запросы к Bybit API для funding rate
- [ ] Реализовать реальные запросы к OKX API для funding rate
- [ ] Добавить кэширование funding rate
- [ ] Добавить unit-тесты для всех модулей
- [ ] Добавить примеры интеграции с backtester
- [ ] Документировать различия MMR между биржами

---

**Версия:** 1.0  
**Дата:** 18.10.2025  
**Автор:** AI Senior Assistant




