## План Реализации Этапа 3: Базовый Бектест-Движок

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
- **Статус:** [В ПРОЦЕССЕ]
- **План:**
  - [x] Извлечь `RiskManagementSettings` из `params.strategyParameters`.
  - [ ] Реализовать вспомогательную функцию `calculatePositionSize(capital: number, entryPrice: number, riskSettings: RiskManagementSettings, currentCandle: StrategyCandle): number`.
    - [x] **Вариант 1 (Простой):** Если `riskSettings.positionSizePercentage` задан, расчет `% от капитала`: `(capital * percentage) / entryPrice`.
    - [ ] **Вариант 2 (На основе риска ATR):** Если заданы `stopLossMultiplier` и `atrPeriod` (в `riskSettings` или глобально), и `currentCandle.atr` доступен: 
        - `risk_per_contract_currency = currentCandle.atr * riskSettings.stopLossMultiplier`.
        - `max_contracts = (capital * (riskSettings.maxRiskPerTradePercentage ?? 0.01)) / risk_per_contract_currency` (где `maxRiskPerTradePercentage` - параметр в `RiskManagementSettings`, например, 1% = 0.01).
        - Учесть минимальный размер контракта и доступный капитал.
    - [ ] **Начальная реализация:** Можно начать с Варианта 1 или даже временно оставить фиксированный размер `1` с `TODO`.
  - [ ] Использовать `calculatePositionSize` при открытии сделки. (Интегрировано в проверку условий входа, полное использование будет при реализации B.3)

#### B.2. Обработка Активной Сделки (Выходы)
- **Статус:** [НЕ НАЧАТО] Сейчас: Заглушка `if (activeTrade) { ... }`.
- **План:**
  - [ ] Проверить, есть ли `activeTrade.stopLoss` и `activeTrade.takeProfit`.
  - [ ] **Выход по Stop Loss:**
    - [ ] Для Long: Если `currentCandle.low <= activeTrade.stopLoss`.
    - [ ] Для Short: Если `currentCandle.high >= activeTrade.stopLoss`.
    - [ ] Если условие выполнено:
      - [ ] `activeTrade.exitPrice = activeTrade.stopLoss`.
      - [ ] `activeTrade.exitTimestamp = currentCandle.timestamp`.
      - [ ] `activeTrade.exitReason = 'SL'`.
      - [ ] Рассчитать PnL для сделки (см. B.6).
      - [ ] Обновить `currentCapital` (см. B.6).
      - [ ] Добавить `activeTrade` в массив `trades`.
      - [ ] `activeTrade = null`.
  - [ ] **Выход по Take Profit:**
    - [ ] Для Long: Если `currentCandle.high >= activeTrade.takeProfit`.
    - [ ] Для Short: Если `currentCandle.low <= activeTrade.takeProfit`.
    - [ ] Если условие выполнено (аналогично SL, но `exitPrice = activeTrade.takeProfit`, `exitReason = 'TP'`).
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
- **Статус:** [НЕ НАЧАТО] Сейчас: `currentCapital` не обновляется, `maxDrawdown`