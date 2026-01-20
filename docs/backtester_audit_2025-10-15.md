# Backtester Audit — 15 Oct 2025

## Цель
Зафиксировать текущую логику бэктестера (одиночный и портфельный режимы), описать поток данных и последовательность операций, а также перечислить выявленные расхождения с «идеальным» режимом и предложить корректировки.

## 1. Состав входных данных
- **Параметры запуска** (`BacktestRunParameters` / `PortfolioBacktestRunParameters`): сроки теста, начальный капитал, `StrategyParameters`, флаги симуляции (`simulateConfirmation`, `executionProfile`).
- **Свечи** (`CandleData[]`): массив чистых OHLCV.
- **ExecutionProfile**: профиль исполнения (комиссии, плечо, проскальзывание, окна подтверждения). При отсутствии используется `DEFAULT_EXECUTION_PROFILE` (0.06% комиссия, плечо 10, 5 bps проскальзывание).
- **Дополнительные ресурсы**: результаты бэктестов (`backend/backend/test-results/*.json`), экспортированные сводки (`backend/backend/public/portfolio-results/*.json`).

## 2. Генерация сигналов — `applyStrategyLogic`

### 2.1. Расчёт индикаторов
- `calculateATR`: длина = `risk.atrPeriod` (по умолчанию 14) → используется для стопов, трейлинга и размера позиции.
- `calculateNWE`: строит адаптивные верх/низ для оценки отклонений (использует сглаживание с параметрами `bandwidth`, `multiplier`, `source`).
- `calculateVolumeProfile`: каждые 10 свечей строит профиль объёма за окно `dlcPeriod` (по умолчанию 40); извлекает POC/VAH/VAL.
- `calculateAvgVolume` + `calculateApproxDelta`: средний объём за период и приближённая дельта для оценки «кластеров».

### 2.2. Формирование стратегических свечей
- На выходе — `StrategyCandle` с полями:
  - исходный OHLCV,
  - индикаторы (ATR, NWE, VAH/VAL/POC, avgVolume, approxDelta, признаки кластеров),
  - потенциальные стоп/тейк (ATR * множители),
  - флаги `entryConditionLong`, `entryConditionShort`.

### 2.3. Логика сигналов (упрощённо)
- **Long** активируется, если выполняются комбинации:
  - свеча касается VAL/POC снизу и закрывается выше,
  - цена отбивается от нижней NWE,
  - наличие «бычьего» кластера (объём выше среднего, положительная approxDelta).
- **Short** — зеркальные условия (от VAH/POC сверху, NWE верхняя, кластер с отрицательной дельтой).
- Каждая компонента добавляет к `signalStrength`; конфлюентность даёт бонусы.
- Итоговый `StrategyCandle.signal` = 1 (long), -1 (short) или 0 (нет входа).

## 3. Одиночный бэктест — `runBacktest`

### 3.1. Инициализация
- `currentCapital = initialCapital`.
- `activeTrade: InternalTrade | null = null` — хранит открытую позицию.
- `pendingSignal: PendingBacktestSignal | null = null` — буфер для подтверждения.
- `equityCurve` c первой точкой (timestamp первой свечи, capital = initialCapital).
- Метрический трекер: пик капитала, drawdown, дневной лимит сделок.

### 3.2. Основная петля по StrategyCandles
1. **Обновление дневного лимита**: новый UTC-день → `tradesOpenedToday = 0` (с учётом `risk.maxTradesPerDay`).
2. **Если есть активная сделка**:
   - **Trailing stop**: при `risk.useTrailingStop` пересчитывается на основе экстремума цены с момента входа (high для long, low для short) с учётом `trailingStopOffsetMultiplier` и `trailingStopStepMultiplier`.
   - **Stop Loss**: срабатывает, если low/ high пересекает заданный уровень SL.
   - **Take Profit**: аналогично для TP.
   - **Opposite signal** (опционально): если активирован `exitOnOppositeSignal`, закрываем по close текущей свечи при сигнале противоположного направления.
   - При закрытии:
     - `pnlRaw = (exitPrice - entryPrice) * size` для long / зеркально для short.
     - `exitFee = exitPrice * size * tradingFeeRate`.
     - `pnlNet = pnlRaw - exitFee`.
     - `currentCapital += margin + pnlNet`; `margin` снимается из `activeTrade`.
     - Обновляем метрики и `equityCurve`.
3. **Если сделки нет**:
   - **Режим подтверждения (`simulateConfirmation`)**:
     - При появлении `entryCondition` создаётся `pendingSignal`: фиксируются entryPrice (close ± slippage), SL, TP, timestamp, `attempts=0`.
     - На каждой новой свече проверяется:
       - достигла ли цена целевого уровня (`high >= entryPrice` для long),
       - не выбил ли стоп до достижения цели,
       - не превышено ли `maxConfirmationAttempts` или окно `confirmWindowSize`.
     - Если условия выполнены, открываем сделку (см. ниже). Иначе увеличиваем `attempts` или сбрасываем сигнал.
   - **Без подтверждения**: вход происходит немедленно при сигнале.

### 3.3. Расчёт размера и открытие позиции
1. `calculatePositionSize(currentCapital, entryPrice, candle, riskSettings)`:
   - Если доступны `maxRiskPerTradePercentage`, `stopLossMultiplier`, `ATR` → размер = (капитал * риск на сделку) / (ATR * SL-множитель).
   - Иначе используется `risk.positionSizePercentage`.
   - Если оба подхода недоступны, fallback = 1 контракт.
2. `size` дополнительно масштабируется на `executionProfile.leverage` (важно: в текущей версии перемножение, поэтому для идеального режима нужно `leverage=1`).
3. Проверка дневного лимита: если `tradesOpenedToday >= maxTradesPerDay`, сигнал игнорируется.
4. Открытие:
   - `requiredMargin = entryPrice * size / max(leverage, 1)`.
   - `entryFee = entryPrice * size * tradingFeeRate`.
   - `currentCapital -= requiredMargin + entryFee`.
   - `activeTrade` заполняется данными (id, направление, цена входа, размер, SL/TP, trailingStop, `fees=entryFee`, `margin=requiredMargin`).
   - `tradesOpenedToday++`.

### 3.4. После цикла
- Формируются метрики `BacktestMetrics`: PnL, PnL%, количество сделок, винрейт, профит-фактор, max drawdown, gross profit/loss, equity curve и т. д.
- Возвращаем `BacktestResult` (метрики + `trades` + `strategyCandles`).

### Поведение при множественных сигналах одной пары
- Пока `activeTrade` существует, все новые сигналы игнорируются (нет пирамидинга).
- Сигнал того же направления, полученный во время ожидания подтверждения, заменяет текущий `pendingSignal` после исчерпания попыток.
- Противоположный сигнал закрывает позицию только при `risk.exitOnOppositeSignal = true`.

## 4. Портфельный бэктест — `runPortfolioBacktest`

### 4.1. Подготовка
- Для каждой пары: `applyStrategyLogic` → `strategyCandlesByPair[pairSymbol]`.
- Синхронизирующая структура `allSynchronizedCandles`: каждая свеча дополняется `pairSymbol` и помещается в общий массив, сортируется по timestamp.
- Инициализация:
  - `currentPortfolioCapital = initialPortfolioCapital`.
  - `activeTradesPortfolio = new Map()`.
  - `tradesByPair[pairSymbol] = []`.
  - Метрики: `peakPortfolioCapital`, `maxPortfolioDrawdown`, `portfolioEquityCurve`.
  - Очередь `pendingSignalsAtTimestamp: PotentialSignal[]`.

### 4.2. Цикл по синхронизированным свечам
1. **При смене timestamp** обрабатываем накопленные `pendingSignalsAtTimestamp`:
   - Если капитал упал ниже 5% первоначального и открытых сделок нет → аварийное завершение.
   - `processPortfolioPendingSignals(...)`:
     - Фильтрует сигналы по лимиту одновременных сделок (`maxConcurrentTradesPortfolio`).
     - Для каждого сигнала рассчитывается размер (аналогично одиночному режиму, но на `currentPortfolioCapital`).
     - Проводится проверка на наличие активной сделки по той же паре.
     - Блокируется маржа (`requiredMargin = entryPrice * size / leverage`), списывается комиссия.
     - Заполняется `newTrade`, помещается в `activeTradesPortfolio` и логируется.
   - Очередь очищается.
2. **Закрытие активных сделок**: для текущей свечи пары выполняются проверки трейлинга, SL/TP, opposite; при закрытии возвращается маржа, рассчитывается `pnlNet` и обновляются глобальные метрики.
3. **Подготовка новых сигналов**:
   - Если для пары нет активной сделки, заполняем `pendingSignalsAtTimestamp` на основании `entryCondition` и режима подтверждения.
   - Для подтверждения используется `pendingMap` (Map `pairSymbol -> PendingBacktestSignal`), позволяющее отслеживать попытки по каждой паре отдельно.

### 4.3. Завершение
- После прохода всех свечей финализируем метрики `PortfolioBacktestResult`:
  - `overallMetrics` (PnL, ROI, winrate, profit factor, drawdown, среднее и пиковое число сделок).
  - `metricsByPair` (PnL, количество сделок, winrate, profit factor, max drawdown для каждой пары).
  - `tradesByPair` — список сделок (с margin, fees, pnl).
- Результат сохраняется в JSON (пример: `backend/backend/test-results/backtest-results-cpu_portfolio-2025-10-15.json`).

## Идеальный режим (без комиссий и плеча)
Чтобы симуляция соответствовала описанию «стратегия блокирует часть капитала, после закрытия возвращает капитал + PnL», нужно передавать профиль со следующими значениями:

```
{
  tradingFeeRate: 0,
  slippageBps: 0,
  leverage: 1,
  fundingRateBuffer: 0,
  maxConfirmationAttempts: 1,
  confirmWindowSize: 1
}
```

В текущей реализации отсутствие `executionProfile` приводит к автоподстановке `DEFAULT_EXECUTION_PROFILE` → комиссии 0.06% и плечо 10. Поэтому простой «unchecked» на фронте не даёт абсолютно идеального режима.

## Выявленные проблемы
1. **Идеальный режим неактивен по умолчанию.** Без явного профиля берём `DEFAULT_EXECUTION_PROFILE`, что добавляет комиссию и плечо в расчёты.
2. **Нет проверки достаточности капитала перед открытием сделки.** Возможен отрицательный остаток (`currentCapital < 0`) при `requiredMargin > свободных средств`.
3. **Очередь подтверждений удерживает лишь один сигнал** (одиночный режим). Если пользователь ожидает параллельной обработки нескольких сигналов подряд, логика потребует расширения. (По текущим требованиям — допустимо.)

## Предлагаемые решения
1. **Явный профиль для идеального режима**
   - На фронте: при выключенном переключателе «Учитывать комиссии…» отправлять в API `executionProfile` со значениями из блока выше.
   - На бэкенде: дополнительно можно обнулить профиль по умолчанию при `useExecutionProfile=false`.
2. **Проверка маржи**
   - Перед открытием сделки: `if (requiredMargin + entryFee > currentCapital) { skipSignal; log warn }`.
   - Логи: фиксировать пропуски входов из-за недостатка капитала.
3. **Расширение очереди сигналов (опционально)**
   - Ввести очередь `pendingSignals[]` (FIFO) и последовательную обработку, если потребуется поддержка нескольких сигналов подряд.

## Наблюдения по итоговым данным
- Итоговый PnL в отчёте (`overallMetrics.totalPortfolioPnl`) теперь совпадает с карточкой на фронте (пример: $3 259 при initial $10 000, ROI 32.59%).
- Сумма PnL по парам больше итогового результата (≈ $7 212), что ожидаемо: каждая пара отображает свой PnL без нормализации к общему капиталу.
- Для аналитики стоит явно указать на UI, что таблица «Результаты по парам» не предназначена для прямого суммирования.

## Следующие шаги
1. Реализовать защиту от входа при дефиците капитала и добавить тесты/логи.
2. Обновить фронт для явного «идеального профиля» и адаптировать бэкенд (опционально — fallback).
3. При необходимости — документировать в `README`/планах порядок выбора ExecutionProfile и отличия между «идеальным» и «реальным» режимами.


