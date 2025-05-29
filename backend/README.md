## Запуск тестов

Для запуска всех тестов:
```bash
npm test
```

Для запуска конкретного тестового файла:
```bash
npx jest src/modules/backtester/backtester.test.ts
```

Для запуска конкретного теста:
```bash
npx jest src/modules/backtester/backtester.test.ts -t "should create portfolio trades with crafted test data"
```

### Мульти-Бектестер (Портфельный Бектестер) ✅ ЗАВЕРШЕН

Реализован **полнофункциональный мульти-бектестер** со следующими возможностями:

#### 🚀 Основные Возможности
- **Портфельный бектест:** Одновременное тестирование стратегии на нескольких торговых парах
- **Общий капитал:** Управление единым капиталом портфеля с реинвестированием
- **Приоритизация сигналов:** Сигналы приоритизируются по силе (`signalStrength`)
- **Портфельные метрики:** Sharpe Ratio, среднее/пиковое количество одновременных сделок
- **Синхронизация данных:** Корректная обработка свечей по timestamps для всех пар
- **Автоматическая загрузка данных:** Интеграция с очередью задач для дозагрузки
- **WebSocket уведомления:** Реальные обновления о статусе бектестинга

#### 📡 API Endpoints
```bash
# Обычный бектест (одна пара)
POST /api/backtest/run

# Портфельный бектест (множественные пары) - НОВЫЙ ✅
POST /api/backtest/portfolio/run
```

#### 🧪 Тестирование
**Интеграционный тест показывает:**
```
Результат: 1 сделка LONG на BTCUSDT
- Вход: 108, Выход: 114 (Take Profit)
- PnL: +300 (прибыль)
- Размер позиции: 50
- Время: 2000ms → 3000ms
```

**Запуск тестов:**
```bash
# Все тесты мульти-бектестера
npx jest src/modules/backtester/backtester.test.ts --testNamePattern="Multi-Backtester"

# Интеграционный тест с реальными данными
npx jest src/modules/backtester/backtester.integration.test.ts

# Конкретный успешный тест
npx jest src/modules/backtester/backtester.test.ts -t "should create portfolio trades with crafted test data"

# Тестирование API (требует запущенного сервера)
node test-portfolio-api.js
```

#### 💼 Использование API
```typescript
const portfolioParams = {
  pairSymbols: ['BTCUSDT', 'ETHUSDT'],
  timeframe: '1h',
  startDate: '2024-01-01',
  endDate: '2024-01-02',
  initialPortfolioCapital: 10000,
  strategyParameters: DefaultStrategyParameters,
  portfolioSettings: {
    maxConcurrentTradesPortfolio: 5,
  },
};

const result = await runPortfolioBacktest(params, candlesByPair);
```

#### 🔄 Очередь Задач
Добавлена поддержка автоматической загрузки данных:
```
JOB_TYPE: FETCH_PORTFOLIO_DATA_AND_RUN_BACKTEST
- Загружает недостающие данные для всех пар портфеля
- Запускает портфельный бектест после загрузки
- Отправляет результаты через WebSocket
```

#### 📊 Портфельные Метрики
- `totalPortfolioTrades` - общее количество сделок
- `totalPortfolioPnL` - общий PnL портфеля  
- `portfolioWinRate` - общий винрейт портфеля
- `sharpeRatioPortfolio` - коэффициент Шарпа
- `avgConcurrentTrades` - среднее количество одновременных сделок
- `peakConcurrentTrades` - пиковое количество одновременных сделок
- `portfolioEquityCurve` - кривая эквити портфеля

#### ⚡ Особенности Реализации
- **Синхронизация по времени:** Все свечи обрабатываются в хронологическом порядке
- **Управление капиталом:** Динамическое распределение капитала между парами
- **Приоритизация:** При нехватке капитала приоритет сигналам с большей силой
- **Лимиты позиций:** Контроль максимального количества одновременных сделок
- **Реинвестирование:** Автоматическое реинвестирование прибыли обратно в портфель 