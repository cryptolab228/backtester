## План Реализации Этапа 3: Базовый Бектест-Движок

**Обновление по Этапу 4: Централизованное Управление Настройками**
- **Статус Фронтенд:** [РЕАЛИЗОВАНО]
  - Пользовательский интерфейс в `SettingsView.vue` для редактирования всех параметров `StrategyParameters` (DLC, NWE, Clusters, Risk Management, Global) завершен.
  - Настройки сохраняются и загружаются через API `/settings`.
- **Статус Бэкенд:** [РЕАЛИЗОВАНО] (Как указано в основном плане `promt.md`)
  - Реализованы `SettingsService` и `SettingsController` для сохранения и получения настроек из БД (сущность `Setting`).

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