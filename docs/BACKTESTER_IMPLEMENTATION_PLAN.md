## План Реализации Этапа 3: Базовый Бектест-Движок

**Обновление по Управлению Настройками (ранее Этап 4)**

*   **Перераспределение Ответственности:**
    *   **Страница "Настройки" (`SettingsView.vue`)**: Теперь отвечает **исключительно** за управление конфигурациями подключений к API бирж (API ключи, секреты и т.д.). Эти настройки сохраняются и загружаются через backend API (`/api/settings`).
    *   **Страница "Бектестер" (`BacktesterView.vue`)**: Теперь отвечает за определение, изменение и (при необходимости) сохранение **параметров торговой стратегии** (DLC, NWE, Clusters, Risk Management, Global ATR, Avg Volume Period и т.д.). Эти параметры используются непосредственно при запуске бектестов.
*   **Backend (`SettingsService`, `SettingsController`, модель `Setting`):**
    *   Должны быть адаптированы для сохранения и загрузки **конфигураций подключений к биржам**.
    *   Функционал, связанный с сохранением/загрузкой глобальных `strategyParameters` через эти сервисы, должен быть пересмотрен:
        *   Либо он удаляется, если параметры стратегии задаются только на лету для каждого бектеста.
        *   Либо он адаптируется для сохранения/загрузки именованных **пресетов параметров стратегии**, которые пользователь может создавать и выбирать на странице "Бектестер".
*   **Frontend:**
    *   **`appConfigStore.ts`**: Управляет конфигурациями подключений к биржам, взаимодействуя с `/api/settings`.
    *   **`settingsStore.ts`**: Его область действия привязана к странице "Бектестер". Он отвечает за хранение текущих параметров стратегии, которые пользователь настраивает для бектеста, и, возможно, за взаимодействие с бэкендом для сохранения/загрузки пресетов этих параметров.
    *   **`backtestStore.ts` (новый)**: Отвечает за управление состоянием самого процесса бэктеста (запуск, отслеживание `isLoading`, `results`, `error`) и включает механизм отмены запросов через `AbortController`.
    *   **`SettingsView.vue`**: UI только для управления подключениями к биржам.
    *   **`BacktesterView.vue`**: Содержит UI для полного набора параметров стратегии.

**Статус Текущей Реализации (до этих изменений):**
-   **Frontend `SettingsView.vue`**: Ранее содержал UI для всех параметров `StrategyParameters`. **Требует переделки** для отображения и управления только подключениями к биржам.
-   **Frontend `appConfigStore.ts`**: Уже содержит логику для `ExchangeConnectionSettings`. **Необходимо убедиться, что он правильно работает с бэкендом для сохранения/загрузки этих данных.**
-   **Frontend `settingsStore.ts`**: Ранее отвечал за глобальные `StrategyParameters`. **Его роль и интеграция должны быть пересмотрены в контексте `BacktesterView.vue`.**
-   **Backend (`SettingsService`, `SettingsController`, модель `Setting`)**: Ранее сохраняли `strategyParameters` из `SettingsView.vue`. **Требуют адаптации** для работы с `exchangeConnections` и пересмотра механизма сохранения `strategyParameters`.

**Общее описание из `promt.md`:**
- Модуль `backtester`: Функция `runBacktest`.
- Загрузка свечей (пока параметр, в будущем из БД).
- Вызов `applyStrategyLogic`.
- Имитация торговли: входы, выходы (SL/TP/Trailing), `max_trades_per_day`, P&L, equity.
- Расчет размера позиции и SL/TP с использованием ATR.
- Расчет базовых метрик.
- Возврат `metrics` и `trades_list`.
- (Будущее) Очередь Задач (BullMQ) и API.

**Статус и План Действий для `runBacktest` в `backend/src/modules/backtester/backtester.ts`:**

### A. Загрузка Свечей из БД
- **Статус:** [ОТЛОЖЕНО] Функция принимает `candles: CandleData[]` как параметр.
- **План:** Интеграция с БД (Этап 1) будет позже. Пока продолжаем с передачей свечей как параметра.

### B. Имитация Торговли (Основная логика в цикле по свечам)

#### B.1. Расчет Размера Позиции
- **Статус:** [РЕАЛИЗОВАНО]
- **План:**
  - [x] Извлечь `RiskManagementSettings` из `params.strategyParameters`.
  - [x] Реализована вспомогательная функция `calculatePositionSize(capital: number, entryPrice: number, currentCandle: StrategyCandle, riskSettings: RiskManagementSettings): number`.
    - [x] **Вариант 2 (На основе риска ATR):** Реализован как приоритетный. Если заданы `riskSettings.maxRiskPerTradePercentage`, `riskSettings.stopLossMultiplier`, и `currentCandle.atr` доступен:
        - `riskPerTradeCapital = capital * riskSettings.maxRiskPerTradePercentage`.
        - `atrBasedStopLossAmountPerUnit = currentCandle.atr * riskSettings.stopLossMultiplier`.
        - `size = riskPerTradeCapital / atrBasedStopLossAmountPerUnit`.
    - [x] **Вариант 1 (Простой):** Используется, если Вариант 2 не применим. Если `riskSettings.positionSizePercentage` задан, расчет `% от капитала`: `(capital * percentage) / entryPrice`.
    - [x] Возвращается `1` или `0` в случае некорректных данных или если размер не может быть рассчитан.
  - [x] `calculatePositionSize` используется при открытии сделки.

#### B.2. Обработка Активной Сделки (Выходы)
- **Статус:** [РЕАЛИЗОВАНО (SL/TP)]
- **План:**
  - [x] Проверить, есть ли `activeTrade.stopLoss` и `activeTrade.takeProfit`.
  - [x] **Выход по Stop Loss:**
    - [x] Для Long: Если `currentCandle.low <= activeTrade.stopLoss`.
    - [x] Для Short: Если `currentCandle.high >= activeTrade.stopLoss`.
    - [x] Если условие выполнено:
      - [x] `activeTrade.exitPrice = activeTrade.stopLoss`.
      - [x] `activeTrade.exitTimestamp = currentCandle.timestamp`.
      - [x] `activeTrade.exitReason = 'SL'`.
      - [x] Рассчитать PnL для сделки.
      - [x] Обновить `currentCapital`.
      - [x] Добавить `activeTrade` в массив `trades`.
      - [x] `activeTrade = null`.
  - [x] **Выход по Take Profit:**
    - [x] Для Long: Если `currentCandle.high >= activeTrade.takeProfit`.
    - [x] Для Short: Если `currentCandle.low <= activeTrade.takeProfit`.
    - [x] Если условие выполнено (аналогично SL, но `exitPrice = activeTrade.takeProfit`, `exitReason = 'TP'`, PnL, капитал, добавление в trades, `activeTrade = null`).
  - [ ] **Выход по Trailing Stop:** [ОТЛОЖЕНО]
  - [ ] **Выход по Противоположному Сигналу:** [ОТЛОЖЕНО]

#### B.3. Проверка Условий Входа (Открытие Новых Сделок)
- **Статус:** [РЕАЛИЗОВАНО] (Базовая логика открытия сделок по сигналам `entryConditionLong`/`Short` и расчет SL/TP есть. Дальнейшие доработки по плану).
- **План:**
  - [x] Если `!activeTrade`.
  - [x] Получение `riskSettings`.
  - [x] Проверка `currentCandle.entryConditionLong` и `currentCandle.entryConditionShort`.
  - [x] Расчет `entryPrice`, `positionSize` (используя `calculatePositionSize`).
  - [x] Создание `newTrade` с SL/TP на основе ATR, если `positionSize > 0`.
  - [x] Присвоение `activeTrade = newTrade`.

#### B.4. Учет `max_trades_per_day`
- **Статус:** [ОТЛОЖЕНО]
- **План:** Потребуется отслеживать количество сделок за текущий "день" бэктеста. 

#### B.5. Обновление Equity и Расчет Max Drawdown
- **Статус:** [В ПРОЦЕССЕ] (Базовый расчет после закрытия сделки добавлен)
- **План:**
  - [x] `peakCapital` обновляется после каждой закрытой сделки.
  - [x] `maxDrawdown` рассчитывается и обновляется после каждой закрытой сделки.
  - [ ] Рассмотреть необходимость обновления equity (mark-to-market) на каждой свече, а не только при закрытии сделки для более точного `maxDrawdown` (особенно для длительных сделок).

#### B.6. Расчет PnL для Сделки и Обновление Капитала (Объединен с B.2)
- **Статус:** [РЕАЛИЗОВАНО] (Как часть логики закрытия сделок в B.2)

### C. Расчет Базовых Метрик
- **Статус:** [РЕАЛИЗОВАНО]
- **План:**
  - [x] `totalPnl` (агрегируется из сделок)
  - [x] `totalTrades` (длина массива `trades`)
  - [x] `winningTrades` (фильтрация `trades`)
  - [x] `losingTrades` (фильтрация `trades`)
  - [x] `winRate` (рассчитывается)
  - [x] `grossProfit` (рассчитывается из положительных `trade.pnl`)
  - [x] `grossLoss` (рассчитывается из отрицательных `trade.pnl`)
  - [x] `averageTradePnl = totalPnl / totalTrades` (рассчитывается)
  - [x] `profitFactor = grossProfit / Math.abs(grossLoss)` (рассчитывается, с обработкой `grossLoss = 0`)
  - [x] `maxDrawdown` (рассчитывается в цикле сделок и присваивается метрикам)
  - [x] `equityCurve` (массив `{ timestamp, capital }` формируется после каждой сделки)
  - [x] `avgWinningTrade = grossProfit / winningTrades` (рассчитывается)
  - [x] `avgLosingTrade = grossLoss / losingTrades` (рассчитывается, с обработкой `losingTradesCount = 0`)
  - [x] `expectancy = (Win Rate * Avg Win) - (Loss Rate * Avg Loss)` (рассчитывается, с использованием десятичных Win/Loss Rate и `Math.abs(avgLosingTrade)`)

### D. Возврат `metrics` и `trades_list`
- **Статус:** [РЕАЛИЗОВАНО]
- **План:**
  - [x] Возврат `metrics` и `trades_list` после завершения бэктеста.

### E. (Будущее) Очередь Задач (BullMQ) и API
- **Статус:** [ОТЛОЖЕНО]
- **План:**
  - [ ] Реализация очереди задач (BullMQ) для планирования и распределения бэктестов.
  - [ ] Разработка API для взаимодействия с внешними системами и пользователями.

## Этап 3.1: Мульти-Бектестер (Портфельный Бектестер) ✅ ЗАВЕРШЕН С ИСПРАВЛЕНИЯМИ

**Статус: ЗАВЕРШЕН С ИСПРАВЛЕНИЯМИ** ✅

### 3.1.1 Backend Implementation ✅
- [x] Создать interface PortfolioBacktestResult
- [x] Добавить portfolioSettings в StrategyParameters
- [x] Реализовать runPortfolioBacktest function
- [x] Добавить Portfolio metrics calculation
- [x] Создать unit tests для портфельного бектестера

### 3.1.2 API Integration ✅
- [x] Добавить endpoint `POST /api/backtest/portfolio/run`
- [x] Интегрировать с queue system (BullMQ)
- [x] Создать интеграционные тесты

### 3.1.3 Frontend Implementation ✅ **ОБНОВЛЕНО!**
- [x] **Создать PortfolioSettingsForm component**
- [x] **Создать PortfolioResultsDisplay component** 
- [x] **Добавить типы в frontend/src/types/strategy.ts**
- [x] **Обновить backtestStore для портфельного бектестера**
- [x] **Интегрировать UI в BacktesterView.vue**
- [x] **Добавить переключатель режимов бектестера**
- [x] **Реализовать отображение результатов по парам**
- [x] **Добавить WebSocket обработку портфельных результатов**

### 3.1.4 Исправления Критических Ошибок ✅ **НОВОЕ!**

#### A. Исправления DataTable ошибок
- [x] **Ошибка multisortField в PrimeVue DataTable**
  - Изменен `sortMode` с "multiple" на "single" во всех DataTable компонентах
  - Исправлен синтаксис `:sortField` вместо `:sortField="'field'"`
  - Добавлены `emptyMessage` для всех таблиц

#### B. Защитные проверки данных
- [x] **Защитные проверки в PortfolioResultsDisplay.vue**
  - Добавлены проверки `|| 0` для всех числовых значений в шаблонах
  - Обновлены computed свойства `pairSummaryData` и `allTrades` с try-catch блоками
  - Добавлены проверки на существование и корректность данных

#### C. Исправления ошибок жизненного цикла компонента
- [x] **Флаг отслеживания монтирования компонента**
  - Добавлен `isComponentMounted` флаг в BacktesterView.vue
  - Обновлены все проверки в handleWebSocketMessage
  - Предотвращение обновления состояния после размонтирования

#### D. Безопасная обработка Toast уведомлений
- [x] **Функция safeToast**
  - Создана безопасная обертка для всех toast уведомлений
  - Заменены все `toast.add()` на `safeToast()` в BacktesterView.vue
  - Добавлена проверка состояния компонента перед показом уведомлений

#### E. Улучшенное управление WebSocket
- [x] **Безопасная очистка WebSocket соединения**
  - Добавлены `removeEventListener` при закрытии соединения
  - Улучшена проверка `readyState` перед закрытием
  - Предотвращение утечек памяти при размонтировании компонента

#### F. Сохранение состояния портфельного режима
- [x] **Корректное сохранение/восстановление состояния**
  - Добавлено сохранение режима бектестера в localStorage
  - Исправлена логика восстановления активных заданий
  - Улучшена синхронизация состояния при переходах между страницами

**Результат исправлений:**
- ✅ Устранены ошибки в консоли браузера при работе с DataTable
- ✅ Предотвращены ошибки vnode/parentNode при навигации
- ✅ Корректное отображение результатов портфельного бектеста
- ✅ Стабильная работа при перезагрузке страницы и навигации
- ✅ Безопасное управление ресурсами и предотвращение утечек памяти

## Этап 3.2: Интерактивные Графики и Диаграммы ⏳ ПЛАНИРУЕТСЯ

**Статус: ПЛАНИРУЕТСЯ**

### 3.2.1 Графики Сделок (Trade Charts) 📊 **НОВОЕ!**

#### A. Frontend - Chart Component
- [ ] **Создать TradeChartModal component**
  - Модальное окно для отображения детального графика сделки
  - Интеграция с Chart.js или аналогичной библиотекой
  - Отображение ценового графика с маркерами входа/выхода
  - Показ уровней Stop Loss и Take Profit

#### B. Interactive Trade Selection
- [ ] **Обновить таблицы сделок для кликабельности**
  - Добавить обработчик клика на строку таблицы в BacktesterView.vue
  - Добавить индикатор интерактивности (hover эффекты, курсор pointer)
  - Передача данных о сделке в TradeChartModal

#### C. Chart Data Integration
- [ ] **Расширить BacktestResult для графических данных**
  - Добавить candlestick данные для периода сделки
  - Включить технические индикаторы (ATR, объемы)
  - Метаданные о времени входа/выхода и причинах

#### D. Chart Features
- [ ] **Базовые возможности графика**
  - Масштабирование и панорамирование
  - Переключение временных рамок
  - Отображение объемов торгов
  - Маркеры ключевых событий сделки

#### E. Advanced Chart Features  
- [ ] **Расширенный функционал**
  - Наложение технических индикаторов
  - Анимация процесса сделки
  - Экспорт графика в PNG/PDF
  - Сравнение нескольких сделок

### 3.2.2 Dashboard Графики

#### A. Equity Curve Charts
- [ ] **График изменения капитала (Equity Curve)**
  - Для одиночного бектестера
  - Для портфельного бектестера (общий и по парам)
  - Отображение периодов drawdown

#### B. Performance Charts  
- [ ] **Графики производительности**
  - Месячные/недельные доходности
  - Распределение PnL сделок (гистограмма)
  - Win/Loss ratio по времени

#### C. Portfolio Analysis Charts
- [ ] **Портфельная аналитика**
  - Корреляционная матрица между парами
  - Вклад каждой пары в общий результат
  - Risk/Return scatter plot

### 3.2.3 Technical Requirements

#### A. Chart Library Selection
- [ ] **Выбор библиотеки для графиков**
  - Оценка Chart.js vs ApexCharts vs D3.js
  - Требования к производительности
  - Совместимость с Vue 3 и TypeScript

#### B. Data Processing
- [ ] **Обработка данных для графиков**
  - Оптимизация загрузки candlestick данных
  - Кэширование графических данных
  - Сжатие данных для больших временных периодов

#### C. Performance Optimization
- [ ] **Оптимизация производительности**
  - Виртуализация для больших наборов данных
  - Lazy loading для модальных окон
  - Debounce для интерактивных элементов

**Ожидаемый результат:**
- 📊 Интерактивные графики сделок с детальной визуализацией
- 🔍 Возможность анализа конкретных сделок через клик в таблице
- 📈 Комплексная визуализация результатов бектестинга
- 💡 Улучшенная аналитика для принятия торговых решений