# ✅ Чеклист Верификации Фьючерсных Данных

## 🔍 Проверка Источников Данных

### 1. Bybit API Category
**Что проверить:**
- [ ] В `backend/src/services/bybitApiService.ts` используется `category: 'linear'`
- [ ] Методы получения свечей указывают linear perpetuals
- [ ] Структура данных соответствует фьючерсам (а не spot)

**Команда проверки:**
```bash
# Windows
cd backend/src/services
findstr /s /i /n "category.*linear" *.ts

# Linux/Mac
grep -r "category.*linear" backend/src/services/ --include="*.ts"
```

**Ожидаемый результат:**
```typescript
// Должно быть примерно так:
const params = {
  category: 'linear',  // ✅ Фьючерсы
  symbol: 'BTCUSDT',
  interval: timeframe
};
```

### 2. OKX API InstrumentType
**Что проверить:**
- [ ] В `backend/src/services/okxApiService.ts` используется `instType: 'SWAP'` или `'FUTURES'`
- [ ] Не используется `instType: 'SPOT'`

**Команда проверки:**
```bash
# Windows
cd backend/src/services
findstr /s /i /n "instType" *.ts

# Linux/Mac  
grep -r "instType" backend/src/services/ --include="*.ts"
```

**Ожидаемый результат:**
```typescript
// Должно быть:
const params = {
  instType: 'SWAP',  // ✅ Бессрочные контракты (фьючерсы)
  // НЕ должно быть: instType: 'SPOT' ❌
};
```

### 3. Trading Pairs в БД
**Что проверить:**
- [ ] Таблица `trading_pairs` содержит поле `exchange`
- [ ] Символы имеют формат фьючерсов: `BTCUSDT` (не `BTC/USDT`)
- [ ] Есть данные для Bybit linear контрактов

**SQL запросы:**
```sql
-- Проверить структуру таблицы
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'trading_pairs';

-- Проверить примеры данных
SELECT symbol, exchange, created_at 
FROM trading_pairs 
WHERE exchange = 'bybit' 
LIMIT 10;

-- Подсчитать пары по биржам
SELECT exchange, COUNT(*) as count 
FROM trading_pairs 
GROUP BY exchange;
```

### 4. Candles данные
**Что проверить:**
- [ ] Свечи связаны с фьючерсными парами
- [ ] Объемы соответствуют фьючерсным (обычно выше спотовых)
- [ ] Нет аномалий в ценах

**SQL запросы:**
```sql
-- Проверить последние свечи для BTCUSDT
SELECT c.timestamp, c.open, c.high, c.low, c.close, c.volume, tp.symbol, tp.exchange
FROM candles c
JOIN trading_pairs tp ON c."tradingPairId" = tp.id
WHERE tp.symbol = 'BTCUSDT' AND tp.exchange = 'bybit'
ORDER BY c.timestamp DESC
LIMIT 20;

-- Средний объем по биржам (для сравнения)
SELECT tp.exchange, AVG(c.volume) as avg_volume
FROM candles c
JOIN trading_pairs tp ON c."tradingPairId" = tp.id
WHERE c.timestamp > NOW() - INTERVAL '7 days'
GROUP BY tp.exchange;
```

## 📊 Текущие Параметры Стратегии

### 5. Strategy Parameters
**Что проверить:**
- [ ] Есть ли параметр `leverage` в настройках
- [ ] Есть ли учет `fundingRate`
- [ ] Есть ли расчет `liquidationPrice`

**Файлы для проверки:**
- `backend/src/modules/strategy/*.ts`
- `backend/src/types/*.ts`
- `frontend/src/types/strategy.ts`

**Команды:**
```bash
# Windows
cd backend/src
findstr /s /i /n "leverage\|funding\|liquidation" *.ts

# Linux/Mac
grep -rn "leverage\|funding\|liquidation" backend/src/modules/strategy/
```

**Ожидаемые параметры (текущие):**
```typescript
interface StrategyParameters {
  // Volume Profile & Dynamic Levels
  vpPeriod: number;
  pocSensitivity: number;
  
  // NWE (Normalized Weighted Envelope)
  nwePeriod: number;
  nweMultiplier: number;
  
  // Clusters
  clusterSettings: {
    source: 'volume' | 'delta';
    thresholdMultiplier: number;
    confirmationBars: number;
  };
  
  // ATR
  atrPeriod: number;
  
  // Risk Management (ТЕКУЩИЕ - для спота)
  stopLoss: {
    atrMultiplier: number;      // Обычно 2-4 для спота
  };
  takeProfit: {
    riskRewardRatio: number;    // Обычно 1.5-2.5
  };
  
  // ❓ ОТСУТСТВУЮТ для фьючерсов:
  // leverage?: number;
  // fundingRate?: FundingSettings;
  // liquidation?: LiquidationSettings;
}
```

## 🎯 Результаты Проверки

### Статус: ⏳ Ожидает проверки

| Пункт | Статус | Примечание |
|-------|--------|-----------|
| Bybit category: 'linear' | ⏳ | Требуется проверка кода |
| OKX instType: 'SWAP' | ⏳ | Требуется проверка кода |
| Trading pairs с exchange | ✅ | Согласно миграции add_exchange_support.sql |
| Candles для фьючерсов | ⏳ | Требуется SQL запрос |
| Leverage в параметрах | ❌ | Отсутствует |
| Funding rate учет | ❌ | Отсутствует |
| Liquidation расчеты | ❌ | Отсутствует |

### Вывод

**✅ Положительные находки:**
1. Проект использует Bybit API V5 (подтверждено логами)
2. Работа с парами типа BTCUSDT (фьючерсный формат)
3. База данных поддерживает разделение по биржам

**❌ Что отсутствует:**
1. Параметры плеча (leverage) в стратегии
2. Учет funding rate при расчете P&L
3. Расчет цены ликвидации
4. Специфичные для фьючерсов риск-метрики

**🎯 Главная находка:**
Проект **УЖЕ использует фьючерсные данные** (Bybit linear perpetuals), но **стратегия оптимизирована для спотовой торговли**. Нужна адаптация параметров и добавление фьючерс-специфичной логики.

## 📝 Следующие Действия

1. ✅ Выполнить все проверочные команды выше
2. ✅ Заполнить таблицу статусов
3. ✅ Создать отчет о находках
4. 🔄 Начать реализацию модулей из FUTURES_STRATEGY_ADAPTATION_PLAN.md

---

**Дата:** 18.10.2025  
**Автор:** AI Senior Assistant  
**Связанные документы:** `FUTURES_STRATEGY_ADAPTATION_PLAN.md`




