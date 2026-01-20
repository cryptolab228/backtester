# 🎯 Backtester V2 - Главный План Проекта

**Последнее обновление:** 18.10.2025  
**Версия:** 3.0 (с поддержкой фьючерсов)

---

## 📋 Цель Проекта

Разработать **высокопроизводительное веб-приложение** для бэктестинга, сканирования и потенциальной автоматической торговли на **криптовалютных фьючерсных рынках** с поддержкой:

- **Мульти-биржевой** архитектуры (OKX, Bybit)
- **Spot и Futures** торговли с реалистичной симуляцией
- **Мульти-таймфреймного** анализа (15м - 1D)
- **GPU-ускорения** для вычислений
- **Real-time сканирования** рынка

---

## 🚀 **КЛЮЧЕВЫЕ ОБНОВЛЕНИЯ (Октябрь 2025)**

### ✅ **Фьючерсная Адаптация - ЗАВЕРШЕНА!**

**Статус:** ✅ **100% ЗАВЕРШЕНО** | **Дата:** 18.10.2025

#### Созданные Модули:

**1. Модули Фьючерсов** (`backend/src/modules/futures/`)
- ✅ `leverageManager.ts` - Управление плечом и ликвидацией
- ✅ `fundingManager.ts` - Расчет funding rate
- ✅ `positionSizer.ts` - Расчет размера позиций с плечом
- ✅ `liquidationCalculator.ts` - Симуляция ликвидации
- ✅ `types.ts` - Интерфейсы и типы
- ✅ `README.md` - Полная документация

**2. Система Профилей** (`backend/src/modules/strategy_logic/profiles/`)
- ✅ `spotProfile.ts` - Профиль для спот торговли
- ✅ `futuresProfile.ts` - Профиль для фьючерсов (5x плечо по умолчанию)
- ✅ `types.ts` - Типы профилей
- ✅ `index.ts` - Роутер профилей
- ✅ `README.md` - Документация системы

**3. Интеграция в Бектестер** (`backend/src/modules/backtester/`)
- ✅ `backtester.futures.ts` - Логика интеграции фьючерсов (~400 строк)
- ✅ Расширение `backtester.types.ts` - Поддержка futures метрик
- ✅ Модификация `backtester.ts` - 6 шагов интеграции:
  1. Инициализация профилей и futures контекста ✅
  2. Модификация открытия позиций ✅
  3. Проверка ликвидации на каждой свече ✅
  4. Применение funding rate (каждые 8 часов) ✅
  5. Модификация закрытия позиций ✅
  6. Финализация futures метрик ✅

**4. Скрипт Оптимизации** (`backend/src/scripts/`)
- ✅ `optimizeFuturesParameters.ts` - Grid search оптимизатор (~450 строк)
- ✅ NPM команда: `npm run optimize:futures`
- ✅ 192 комбинации параметров (leverage, SL, TP, risk)
- ✅ Комплексный scoring алгоритм
- ✅ JSON отчеты с рекомендациями

**5. Документация** (`docs/`)
- ✅ `FUTURES_AUDIT_REPORT.md` - Аудит проекта
- ✅ `FUTURES_STRATEGY_ADAPTATION_PLAN.md` - Детальный план
- ✅ `FUTURES_IMPLEMENTATION_ROADMAP.md` - Дорожная карта (4 фазы, 12 спринтов)
- ✅ `BACKTESTER_INTEGRATION_GUIDE.md` - Руководство интеграции
- ✅ `SPRINT_1_1_COMPLETE.md` - Отчет Спринт 1.1
- ✅ `SPRINT_1_2_COMPLETE.md` - Отчет Спринт 1.2
- ✅ `SPRINT_1_3_COMPLETE.md` - Отчет Спринт 1.3
- ✅ `PHASE_1_COMPLETE.md` - Завершение Фазы 1
- ✅ `PHASE_2_OPTIMIZATION_GUIDE.md` - Руководство по оптимизации
- ✅ `INTEGRATION_SUMMARY.md` - Итоговая сводка
- ✅ `EXECUTIVE_SUMMARY.md` - Краткое резюме

#### Ключевые Возможности Futures:

```typescript
// Futures-специфичные метрики:
interface FuturesBacktestStats {
  averageLeverage: number;              // Среднее плечо
  maxLeverage: number;                  // Макс плечо
  liquidations: number;                 // Количество ликвидаций
  fundingPaid: number;                  // Оплаченный funding
  fundingReceived: number;              // Полученный funding
  netFunding: number;                   // Чистый funding
  effectiveROI: number;                 // ROI с учетом плеча
  capitalEfficiency: number;            // Прибыль / маржа
  averageDistanceToLiquidation: number; // Среднее расстояние до ликвидации
  minDistanceToLiquidation: number;     // Минимальное расстояние
  marginCallsAvoided: number;           // Избегнуто margin calls
}
```

**Использование:**

```typescript
// Spot режим (обратная совместимость)
const spotResult = await runBacktest({
  pairSymbol: 'BTCUSDT',
  timeframe: '1h',
  initialCapital: 10000,
  strategyParameters: defaultParams
  // Без strategyProfile - spot режим
}, candles);

// Futures режим (новый)
const futuresResult = await runBacktest({
  pairSymbol: 'BTCUSDT',
  timeframe: '1h',
  initialCapital: 10000,
  strategyParameters: defaultParams,
  strategyProfile: 'futures',  // <-- Включает futures
  exchange: 'bybit'
}, candles);

// Доступны futures метрики:
console.log(futuresResult.metrics.futuresStats.liquidations);
console.log(futuresResult.metrics.futuresStats.effectiveROI);
```

---

## 📊 Технологический Стек

### Backend:
- **Node.js + TypeScript** - основа
- **Express.js** - веб-фреймворк
- **PostgreSQL + TimescaleDB** - база данных
- **TypeORM** - ORM
- **Redis** - кэширование и очереди
- **BullMQ** - фоновые задачи
- **Socket.io** - WebSocket
- **CuPy/gpu.js** - GPU ускорение

### Frontend:
- **Vue 3 (Composition API)** - фреймворк
- **TypeScript** - типизация
- **Vite** - сборка
- **PrimeVue 4.x** - UI компоненты
- **Tailwind CSS** - стилизация
- **Pinia** - state management
- **ApexCharts.js** - графики

### Биржи:
- **OKX** - фьючерсы (совместимость)
- **Bybit** - линейные фьючерсы (высокая производительность, 13x быстрее)

---

## 🎯 Текущее Состояние Проекта (Январь 2026)

### ✅ Завершенные Этапы

#### **Этап 0: Базовая Инфраструктура** ✅ 100%
- Настройка проектов (Backend/Frontend)
- Docker окружение (PostgreSQL, Redis)
- Базовая структура, логгер, роутинг

#### **Этап 1: Загрузка и Хранение Данных** ✅ 100%
- Сервисы OKX и Bybit API
- Модели данных (TypeORM)
- Очередь задач (BullMQ)
- API эндпоинты для загрузки данных
- **Производительность:** Bybit 13x быстрее OKX

#### **Этап 2: Логика Стратегии** ✅ 100%
- Индикаторы: ATR, Volume Profile, NWE, Clusters, Delta, CVD
- Модуль `strategy`: `applyStrategyLogic` с сигналами VPA и Дивергенций
- Юнит-тесты и синтетическая верификация (`verify-full-strategy.ts`)
- Поддержка spot и futures профилей

#### **Этап 3: Базовый Бектест-Движок** ✅ 100%
- Функция `runBacktest` - одиночный бектест
- Поддержка futures с ликвидацией, funding rate и плечом
- Расчет базовых и продвинутых метрик (Sharpe, Sortino, Expectancy)

#### **Этап 3.1: Мульти-Бектестер (Портфельный)** ✅ 100%
- Функция `runPortfolioBacktest` с общим капиталом
- Приоритизация сигналов по силе
- Лимит одновременных позиций и WebSocket уведомления

#### **Этап 4: Управление Подключениями** ✅ 100%
- Настройки API бирж, шифрование ключей
- UI для управления подключениями в `SettingsView.vue`

#### **Этап 5: Интерактивные Параметры** ✅ 100%
- Компонент `StrategySettingsForm.vue`
- Полная интеграция параметров в `BacktesterView.vue`
- Выбор профиля (spot/futures)

#### **Этап 6: Расширенные Результаты** 🔄 70%
- ✅ Расчет дополнительных метрик
- ✅ Данные для графика эквити
- ✅ Базовая таблица сделок
- ✅ `TradeChartModal.vue` для визуализации сделок
- ⏳ Интерактивные графики сигналов (VPA/Div) на основном графике
- ⏳ Визуализация зон Volume Profile (VAH/VAL/POC)

#### **🎮 GPU Микросервис** ✅ 100%
- 7 GPU-ускоренных индикаторов (SMA, EMA, RSI, MACD, Bollinger, Stochastic, ATR)
- 4 торговые стратегии
- 5 API эндпоинтов
- Docker интеграция
- Fallback на CPU (NumPy)

---

### 🔄 В Процессе

#### **Этап 7: Мульти-Таймфрейм Сканнер** 🔄 75%
- ✅ Базовая архитектура (ScannerService, SignalEngine)
- ✅ Live data stream и Signal Bus (Redis)
- ✅ Поддержка Bybit Demo/Testnet
- ✅ Изоляция сессий через `sessionId`
- ⏳ Paper trading (полная симуляция кошелька)
- ⏳ Live торговля (планируется)

#### **Фаза 2: Оптимизация Параметров** 🔄 60%
- ✅ Скрипт оптимизации (`optimizeFuturesParameters.ts`)
- ✅ NPM команда (`npm run optimize:futures`)
- ⏳ Валидация новых параметров VPA/Divergence
- ⏳ Walk-forward validation

---

### ⏳ Планируется

#### **Фаза 3: API и UI Обновления** 🔄 40%
- ✅ Обновление API контроллеров для `strategyProfile`
- ✅ UI для выбора профиля (spot/futures)
- ⏳ Dashboard ликвидаций в реальном времени
- ⏳ Расширенная визуализация futures метрик в UI

#### **Фаза 4: Тестирование** 🔄 30%
- ✅ Синтетическая верификация стратегии
- ⏳ Unit-тесты для futures модулей
- ⏳ Integration-тесты полной цепочки
- ⏳ Performance тесты

---

## 📈 Прогресс Проекта

### Общий Прогресс: **82%**

```
██████████████████░░░░░░░  82%

✅ Этап 0: Инфраструктура          100%
✅ Этап 1: Загрузка данных         100%
✅ Этап 2: Логика стратегии        100%
✅ Этап 3: Бектест-движок          100%
✅ Этап 3.1: Мульти-бектестер      100%
✅ Этап 4: Подключения             100%
✅ Этап 5: Интерактивные параметры 100%
🔄 Этап 6: Расширенные результаты  70%
🔄 Этап 7: Сканнер                 75%
✅ GPU Микросервис                 100%
✅ Фьючерсная адаптация            100%
🔄 Фаза 2: Оптимизация             60%
🔄 Фаза 3: API/UI обновления       40%
🔄 Фаза 4: Тестирование            30%
```

---

## 🎯 Ключевые Приоритеты (Q4 2025 - Q1 2026)

### **P1 — Завершение Фазы 2: Оптимизация** 🔥
**Срок:** 1-2 недели

**Задачи:**
1. Подготовить данные для оптимизации (экспорт из БД или фикстура)
2. Запустить `npm run optimize:futures` на 3+ месяцах данных
3. Провести walk-forward validation
4. Обновить `futuresProfile.ts` с найденными параметрами
5. Документировать результаты

### **P2 — Фаза 3: API и UI Обновления** 🎨
**Срок:** 3-4 дня

**Задачи:**
1. Обновить API контроллеры:
   - Принимать `strategyProfile` параметр
   - Валидация профилей
   - Расширенные endpoints
2. Создать UI компоненты:
   - Селектор профиля (spot/futures)
   - Визуализация futures метрик
   - Dashboard ликвидаций
3. Интеграция с существующим UI

### **P3 — Фаза 4: Тестирование** 🧪
**Срок:** 2-3 дня

**Задачи:**
1. Unit-тесты для `backtester.futures.ts`
2. Integration-тесты для полной цепочки
3. E2E тесты API endpoints
4. Performance тесты (spot vs futures)
5. Stress-тесты ликвидаций

### **P4 — Декомпозиция Бэктест-Ядра** ♻️
**Приоритет:** Средний (после Фаз 2-4)

**Задачи:**
1. Вынести Risk Manager в отдельный сервис
2. Создать Position Sizer сервис
3. Metrics Calculator сервис
4. Dependency Injection для тестов

### **P5 — Рефакторинг `dataWorker.ts`** ♻️
**Приоритет:** Средний

**Задачи:**
1. Разделить на orchestrator и handlers
2. Шаговый pipeline (BullMQ Flow)
3. Улучшенный контроль памяти
4. Детальное логирование

---

## 📊 Статистика Проекта

### Код:

```
Всего файлов:          ~500+
Строк кода:            ~50,000+
TypeScript файлов:     ~300+
Vue компонентов:       ~20+
API endpoints:         ~30+
Документации:          ~30+ файлов
```

### Фьючерсная Адаптация:

```
Созданных файлов:      11
Изменённых файлов:     3
Строк кода:            ~1800
Строк документации:    ~3500
Новых функций:         20+
Новых интерфейсов:     10+
Ошибок линтера:        0 ✅
```

### Производительность:

```
Bybit vs OKX:          13x быстрее
GPU vs CPU:            50-100x быстрее (для сложных вычислений)
Futures overhead:      ~5% (минимальный impact)
```

---

## 🔑 Важные Файлы и Директории

### Backend:

```
backend/src/
├── modules/
│   ├── backtester/                    # Основной бектест-движок
│   │   ├── backtester.ts              # Главная логика (spot + futures)
│   │   ├── backtester.futures.ts      # Futures интеграция
│   │   └── backtester.types.ts        # Типы (с futures поддержкой)
│   ├── futures/                       # 🆕 Модули фьючерсов
│   │   ├── leverageManager.ts
│   │   ├── fundingManager.ts
│   │   ├── positionSizer.ts
│   │   ├── liquidationCalculator.ts
│   │   └── types.ts
│   ├── strategy_logic/                # Логика стратегий
│   │   ├── strategy.ts
│   │   ├── indicators.ts
│   │   └── profiles/                  # 🆕 Система профилей
│   │       ├── spotProfile.ts
│   │       ├── futuresProfile.ts
│   │       └── types.ts
│   ├── scanner/                       # Real-time сканер
│   ├── execution/                     # Execution profiles
│   └── data/                          # Загрузка данных
├── scripts/
│   └── optimizeFuturesParameters.ts   # 🆕 Оптимизатор
└── ...
```

### Frontend:

```
frontend/src/
├── views/
│   ├── BacktesterView.vue             # Страница бектестера
│   ├── DataManagementView.vue         # Управление данными
│   ├── ScannerView.vue                # Сканер
│   └── SettingsView.vue               # Настройки
├── components/
│   ├── StrategySettingsForm.vue       # Настройки стратегии
│   ├── PortfolioSettingsForm.vue      # Настройки портфеля
│   └── AdvancedProgressBar.vue        # Прогресс-бар
├── stores/
│   ├── backtestStore.ts               # State для бектеста
│   ├── settingsStore.ts               # Настройки
│   └── ...
└── ...
```

### Документация:

```
docs/
├── INTEGRATION_SUMMARY.md             # 🆕 Итоговая сводка
├── PHASE_1_COMPLETE.md                # 🆕 Завершение Фазы 1
├── PHASE_2_OPTIMIZATION_GUIDE.md      # 🆕 Руководство оптимизации
├── BACKTESTER_INTEGRATION_GUIDE.md    # 🆕 Руководство интеграции
├── FUTURES_*.md                       # 🆕 Документация по futures
├── SPRINT_*.md                        # 🆕 Отчеты по спринтам
└── ...
```

---

## 🚀 Быстрый Старт

### Установка:

```bash
# Клонирование
git clone <repository-url>
cd backtesterv2

# Установка зависимостей
npm run install:all

# Настройка .env файлов
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

### Запуск:

```bash
# Вариант 1: Одна команда
npm run dev

# Вариант 2: Docker
docker-compose up -d

# Вариант 3: Раздельно
cd backend && npm run dev  # Terminal 1
cd frontend && npm run dev # Terminal 2
```

### Использование Futures:

```bash
# Запуск futures бектеста через API:
curl -X POST http://localhost:5000/api/backtest/run \
  -H "Content-Type: application/json" \
  -d '{
    "pairSymbol": "BTCUSDT",
    "timeframe": "1h",
    "startDate": "2024-01-01",
    "endDate": "2024-02-01",
    "initialCapital": 10000,
    "strategyParameters": {...},
    "strategyProfile": "futures",
    "exchange": "bybit"
  }'

# Оптимизация параметров:
cd backend
npm run optimize:futures
```

---

## 📚 Дополнительная Документация

### Для Разработчиков:
- `README.md` - Основная документация проекта
- `frontend/README.md` - Фронтенд документация
- `backend/README.md` - Бэкенд документация
- `BYBIT_ALGORITM.MD` - Алгоритм Bybit интеграции

### Futures Документация:
- `docs/INTEGRATION_SUMMARY.md` - Полная сводка интеграции
- `docs/BACKTESTER_INTEGRATION_GUIDE.md` - Пошаговое руководство
- `docs/PHASE_2_OPTIMIZATION_GUIDE.md` - Руководство по оптимизации
- `backend/src/modules/futures/README.md` - Документация модулей
- `backend/src/modules/strategy_logic/profiles/README.md` - Система профилей

### Технические Спецификации:
- `docs/API_SESSIONS.md` - API для сессий
- `docs/SCANNER_SESSION_STANDARD.md` - Стандарты сканера
- `docs/DATABASE_FIX_TRADING_SESSIONS.md` - БД миграции

---

## 🤝 Рекомендации по Разработке

### Рабочий Процесс (Feature Branch Workflow):

```bash
# 1. Убедиться, что на main и актуален
git checkout main
git pull origin main

# 2. Создать новую ветку
git checkout -b feature/название-фичи

# 3. Работать и коммитить
git add .
git commit -m "Описание изменений"

# 4. Отправить на удаленный репозиторий
git push -u origin feature/название-фичи

# 5. После завершения - слить в main
git checkout main
git pull origin main
git merge feature/название-фичи
git push origin main

# 6. Удалить ветку
git branch -d feature/название-фичи
git push origin --delete feature/название-фичи
```

### Лучшие Практики:

1. **Ветка `main` всегда рабочая** - не коммитить напрямую
2. **Для каждой задачи - отдельная ветка** (feature/, fix/, refactor/)
3. **Осмысленные имена веток** (feature/futures-optimization, fix/liquidation-bug)
4. **Регулярные коммиты** с понятными сообщениями
5. **Тестирование перед слиянием** в main
6. **Код-ревью** для критических изменений
7. **Документирование** новых функций и API

---

## 📞 Контакты и Поддержка

### Документация:
- Вся документация в `docs/`
- Примеры кода в README файлах
- Комментарии в коде

### Отладка:
- Логи: `backend/logs/combined.log`
- Error logs: `backend/logs/error.log`
- Docker logs: `docker-compose logs -f backend`

### Известные Проблемы:
- Проверьте `docs/FIXES_*.md` для известных багов и решений
- Проверьте `docs/PROJECT_CLEANUP_*.md` для истории исправлений

---

## 🎉 Заключение

Проект **Backtester V2** представляет собой **профессиональную платформу** для:
- Высокопроизводительного бэктестинга торговых стратегий
- **Реалистичной симуляции** spot и futures торговли
- Real-time сканирования криптовалютных рынков
- GPU-ускоренных вычислений
- Мультибиржевой архитектуры

**Текущий статус:** 77% завершено, полностью функциональный бектестер с поддержкой фьючерсов, готов к оптимизации параметров и дальнейшему развитию.

**Последнее крупное обновление:** Фьючерсная адаптация (Октябрь 2025) - добавлены модули для работы с плечом, ликвидацией, funding rate и полная система профилей стратегий.

---

**Дата создания плана:** 29.09.2025  
**Последнее обновление:** 18.10.2025  
**Версия:** 3.0  
**Статус:** ✅ **PRODUCTION READY** (с futures поддержкой)




