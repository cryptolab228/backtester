# План интеграции Bybit API в проект Backtester V2

## Анализ текущего состояния проекта

### Критическая проблема текущей реализации
Анализ файлов проекта выявил фатальную ошибку в алгоритме получения свечей:
- Отсутствует правильное управление API лимитами при массовой загрузке
- Одновременные запросы множества пар приводят к превышению лимитов биржи
- Нет координации между воркерами BullMQ при обращении к API
- RateLimiter работает только в рамках одного процесса, не учитывая параллельные воркеры

### Анализ затронутых компонентов

#### Backend компоненты:
1. **Сервисы API**:
   - `backend/src/services/okxService.ts` - текущий OKX API сервис
   - `backend/src/services/rateLimiter.ts` - локальный rate limiter (требует переработки)
   - `backend/src/services/optimizedCandleFetcher.ts` - оптимизированный загрузчик

2. **Модели данных**:
   - `backend/src/models/TradingPair.ts` - НЕ СОДЕРЖИТ поле exchange
   - `backend/src/models/Candle.ts` - НЕ СОДЕРЖИТ поле exchange
   - Необходимо добавить поле `exchange` для поддержки мультибиржевости

3. **Сервисы данных**:
   - `backend/src/services/dataService.ts` - работа с БД (требует модификации)

4. **Воркеры и очереди**:
   - `backend/src/jobs/dataWorker.ts` - основной воркер обработки задач
   - Типы задач: `FETCH_PAIRS`, `FETCH_CANDLES`, `FETCH_CANDLES_AND_RUN_BACKTEST`, `FETCH_PORTFOLIO_DATA_AND_RUN_BACKTEST`

5. **API контроллеры**:
   - `backend/src/modules/data/dataController.ts` - контроллер данных
   - `backend/src/modules/data/dataRoutes.ts` - маршруты API

#### Frontend компоненты:
1. **Представления**:
   - `frontend/src/views/DataManagementView.vue` - управление данными (НЕ ПОДДЕРЖИВАЕТ выбор биржи)
   - `frontend/src/views/BacktesterView.vue` - бектестер (НЕ ПОДДЕРЖИВАЕТ выбор биржи)
   - `frontend/src/views/SettingsView.vue` - настройки

2. **Сервисы**:
   - API сервисы frontend для взаимодействия с backend

## Детальный план интеграции

### Этап 1: Создание Redis-based Rate Limiter и Bybit API Service

#### 1.1 Переработка Rate Limiter
**Файл: `backend/src/services/smartRateLimiter.ts`** (новый)
```typescript
// Redis-based RateLimiter для координации между воркерами
// Поддержка различных лимитов для разных бирж
```

**Изменения в `backend/src/services/rateLimiter.ts`**:
- Заменить на Redis-based реализацию
- Сохранить обратную совместимость

#### 1.2 Создание Bybit API Service
**Файл: `backend/src/services/bybitService.ts`** (новый)
```typescript
// Реализация API методов для Bybit
// getHistoricalCandlesForSymbolBybit()
// getFuturesPairs() для Bybit
// validateTradingPair() для Bybit
```

#### 1.3 Обновление переменных окружения
**Файл: `backend/.env`**
```env
# Bybit API
BYBIT_API_KEY=
BYBIT_API_SECRET=
BYBIT_API_URL=https://api.bybit.com

# Redis для координации RateLimiter
REDIS_URL=redis://redis:6379
```

### Этап 2: Модификация моделей данных

#### 2.1 Обновление модели TradingPair
**Файл: `backend/src/models/TradingPair.ts`**
```typescript
@Column({ type: 'varchar', length: 20, default: 'okx' })
exchange!: string; // 'okx' | 'bybit'

// Обновить уникальный индекс
@Index(['symbol', 'exchange'], { unique: true })
```

#### 2.2 Обновление модели Candle
**Файл: `backend/src/models/Candle.ts`**
```typescript
// Добавить связь с exchange через TradingPair
// Обновить составной уникальный индекс
@Index(['tradingPair', 'timestamp', 'timeframe'], { unique: true })
```

#### 2.3 Создание миграции БД
**Файл: `backend/migrations/xxx_add_exchange_support.ts`**
- Добавить поле `exchange` в таблицу `trading_pairs`
- Обновить индексы

### Этап 3: Обновление DataService

#### 3.1 Модификация DataService
**Файл: `backend/src/services/dataService.ts`**
```typescript
// Добавить параметр exchange во все методы
saveOrUpdateTradingPairs(pairs: TradingPairInfo[], exchange: string)
getCandles(symbol: string, timeframe: string, startTime?: number, endTime?: number, exchange?: string)
getAllTradingPairs(exchange?: string)
```

### Этап 4: Обновление воркеров и задач

#### 4.1 Модификация dataWorker
**Файл: `backend/src/jobs/dataWorker.ts`**

**Обновление интерфейсов задач**:
```typescript
interface FetchPairsJobData {
  exchange: 'okx' | 'bybit';
  isUserPaused?: boolean;
}

interface FetchCandlesJobData {
  symbol: string;
  timeframe: string;
  exchange: 'okx' | 'bybit';
  startTime?: number;
  endTime?: number;
  limit?: number;
  isUserPaused?: boolean;
}
```

**Обновление обработчиков**:
```typescript
const processFetchPairs = async (job: Job<FetchPairsJobData>) => {
  const { exchange } = job.data;
  
  if (exchange === 'bybit') {
    pairs = await bybitService.getFuturesPairs();
  } else {
    pairs = await okxService.getFuturesPairs();
  }
  
  await dataService.saveOrUpdateTradingPairs(pairs, exchange);
}

const processFetchCandles = async (job: Job<FetchCandlesJobData>) => {
  const { symbol, timeframe, exchange, startTime, endTime, limit } = job.data;
  
  let candles;
  if (exchange === 'bybit') {
    candles = await bybitService.getHistoricalCandlesForSymbolBybit(symbol, timeframe, startTime, endTime, limit);
  } else {
    candles = await okxService.getHistoricalCandlesOptimized(symbol, timeframe, startTime, endTime, limit);
  }
  
  await dataService.saveCandles(symbol, timeframe, candles, exchange);
}
```

### Этап 5: Обновление API контроллеров

#### 5.1 Модификация dataController
**Файл: `backend/src/modules/data/dataController.ts`**
```typescript
// Добавить параметр exchange в методы
triggerFetchPairs(req, res) {
  const { exchange = 'okx' } = req.body;
  // Создать задачу с exchange
}

triggerFetchCandles(req, res) {
  const { exchange = 'okx', ...otherParams } = req.body;
  // Передать exchange в задачу
}

getAllTradingPairs(req, res) {
  const { exchange } = req.query;
  // Фильтровать по exchange
}
```

### Этап 6: Обновление Frontend

#### 6.1 Модификация DataManagementView
**Файл: `frontend/src/views/DataManagementView.vue`**
```vue
<template>
  <!-- Добавить выбор биржи -->
  <div class="flex flex-col gap-2">
    <label for="exchange">Exchange</label>
    <Dropdown 
      id="exchange" 
      v-model="selectedExchange" 
      :options="['okx', 'bybit']" 
      placeholder="Select Exchange"
    />
  </div>
</template>

<script setup lang="ts">
const selectedExchange = ref('okx');

const handleFetchPairs = async () => {
  const response = await triggerFetchPairsJob({ exchange: selectedExchange.value });
}

const handleFetchCandles = async () => {
  const params = {
    exchange: selectedExchange.value,
    symbol: fetchParams.selectedSymbol.symbol,
    timeframes: fetchParams.selectedTimeframes,
    // ... другие параметры
  };
  const response = await triggerFetchCandlesJob(params);
}
</script>
```

#### 6.2 Модификация BacktesterView
**Файл: `frontend/src/views/BacktesterView.vue`**
```vue
<!-- Добавить выбор биржи в форму бектеста -->
<div class="flex flex-col gap-2">
  <label for="exchange">Exchange</label>
  <Dropdown 
    id="exchange" 
    v-model="backtestParams.exchange" 
    :options="['okx', 'bybit']" 
    placeholder="Select Exchange"
  />
</div>
```

#### 6.3 Обновление API сервисов Frontend
**Файл: `frontend/src/services/apiService.ts`**
```typescript
interface FetchCandlesParams {
  symbol: string;
  timeframes: string[];
  exchange: 'okx' | 'bybit';
  startTime?: number;
  endTime?: number;
  limit?: number;
}

export const triggerFetchPairsJob = async (params: { exchange: string }) => {
  // Передать exchange в запросе
}
```

### Этап 7: Обновление модулей бектестера

#### 7.1 Модификация backtester
**Файл: `backend/src/modules/backtester/backtester.ts`**
```typescript
interface BacktestRunParameters {
  // ... существующие параметры
  exchange: 'okx' | 'bybit';
}

export async function runBacktest(params: BacktestRunParameters, candlesData?: CandleData[]) {
  // Если candlesData не предоставлены, загрузить с учетом exchange
  if (!candlesData) {
    candlesData = await dataService.getCandles(
      params.symbol, 
      params.timeframe, 
      params.startTime, 
      params.endTime, 
      params.exchange
    );
  }
  // ... остальная логика
}
```

## Возможные проблемы и решения

### 1. Различия в форматах данных
**Проблема**: Bybit и OKX могут возвращать данные в разных форматах
**Решение**: Создать адаптеры для унификации данных

### 2. Миграция существующих данных
**Проблема**: Существующие данные в БД не имеют поля exchange
**Решение**: Миграция с установкой значения по умолчанию 'okx'

### 3. Обратная совместимость API
**Проблема**: Изменение API может сломать существующие интеграции
**Решение**: Сделать параметр exchange опциональным с значением по умолчанию 'okx'

### 4. Координация Rate Limiter между воркерами
**Проблема**: Множественные воркеры BullMQ должны координировать запросы к API
**Решение**: Использовать Redis для хранения состояния RateLimiter

### 5. Различные лимиты API
**Проблема**: Bybit (120 req/sec) и OKX (30 req/sec) имеют разные лимиты
**Решение**: Отдельные экземпляры RateLimiter с разными настройками

## Порядок реализации

1. **Этап 1**: Создание Redis-based RateLimiter и Bybit API Service
2. **Этап 2**: Модификация моделей данных и миграция БД
3. **Этап 3**: Обновление DataService
4. **Этап 4**: Обновление воркеров и задач
5. **Этап 5**: Обновление API контроллеров
6. **Этап 6**: Обновление Frontend
7. **Этап 7**: Обновление модулей бектестера
8. **Этап 8**: Тестирование и отладка

## Тестирование

1. Проверить работу с обеими биржами
2. Протестировать массовую загрузку данных
3. Убедиться в соблюдении API лимитов
4. Проверить корректность бектестинга с данными разных бирж
5. Тестировать UI для выбора биржи 