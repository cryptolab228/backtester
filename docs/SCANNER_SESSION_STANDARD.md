# Стандарт хранения сессий сканнера и бэктестера

## Цели

- Единый формат хранения результатов торговли и метрик для live-сканнера и бэктестера.
- Возможность сквозного сравнения (эквити, winrate, pnl, риск) между оффлайн тестами и реальными сессиями.
- Простая выгрузка (JSON/CSV) и визуализация в UI/BI.
- Отслеживание эволюции стратегии (strategy_version, параметры) и влияния изменений.

## 1. Сущность `trading_sessions`

```text
id (uuid, pk)
source (enum: 'scanner' | 'backtester')
mode (enum: 'dry-run' | 'paper' | 'shadow' | 'demo' | 'testnet' | 'live' | 'backtest')
strategy_version (text)
strategy_params_hash (text)
strategy_params_snapshot (jsonb)
exchange (text)
pairs (text[])
timeframes (text[])
portfolio_mode (boolean)
config_snapshot (jsonb)
risk_settings_snapshot (jsonb)
allocator_config_snapshot (jsonb)
started_at (timestamptz)
ended_at (timestamptz)
status (enum: 'running' | 'completed' | 'failed' | 'aborted')
notes (text)
created_at (timestamptz, default now())
created_by (text)
```

% комментарии: 1) hash по канонизированному JSON; 2) snapshots — для UI/дебага; 3) ended_at и status заполняем при stop.

## 2. Сущность `session_metrics`

```text
id (uuid, pk)
session_id (uuid, fk -> trading_sessions.id)
updated_at (timestamptz)
total_pnl (numeric)
realized_pnl (numeric)
unrealized_pnl (numeric)
total_return_pct (numeric)
win_rate_pct (numeric)
profit_factor (numeric)
avg_trade_pnl (numeric)
avg_win_pnl (numeric)
avg_loss_pnl (numeric)
sharpe_ratio (numeric)
sortino_ratio (numeric)
max_drawdown_pct (numeric)
max_drawdown_amount (numeric)
expectancy (numeric)
trade_count (integer)
winning_trades (integer)
losing_trades (integer)
open_positions (integer)
closed_positions (integer)
avg_concurrent_trades (numeric)
peak_concurrent_trades (integer)
latency_ms_avg (numeric)
latency_ms_p95 (numeric)
metadata (jsonb)
```

% комментарии: 1) для сканнера обновляем на каждом закрытии позиции; 2) latency — задержки подтверждения/исполнения; 3) metadata — производные метрики/заметки.

## 3. Сущность `session_trades`

```text
id (uuid, pk)
session_id (uuid, fk -> trading_sessions.id)
source (enum: 'scanner' | 'backtester')
mode (text)
pair (text)
timeframe (text)
exchange (text)
strategy_id (text)
signal_id (text)
allocation_id (text)
order_link_id (text)
entry_timestamp (timestamptz)
entry_price (numeric)
entry_fee (numeric)
entry_reason (text)
exit_timestamp (timestamptz)
exit_price (numeric)
exit_fee (numeric)
exit_reason (text)
position_size (numeric)
leverage (numeric)
realized_pnl (numeric)
realized_pnl_pct (numeric)
max_favorable_excursion (numeric)
max_adverse_excursion (numeric)
stop_loss (numeric)
take_profit (numeric)
trailing_stop (numeric)
risk_score (numeric)
confirmation_attempts (integer)
latency_ms (integer)
status (enum: 'open' | 'closed' | 'cancelled')
extra (jsonb)
created_at (timestamptz, default now())
```

% комментарии: 1) MFE/MAE — для анализа; 2) latency_ms = delay между сигналом и подтверждением/входом; 3) risk_score — факт из Allocation.

### Дополнительные таблицы (опционально)

- `session_equity_curve` — хранит агрегированную кривую эквити (timestamp, capital, drawdown_pct). Нарезка не чаще 1 точки в минуту.
- `session_events` — журнал значимых событий (сигналы, отказы PortfolioAllocator, подтверждения, ошибки API).
- `session_params_history` — изменения параметров внутри сессии (если hot reload).

## 4. Канонизация параметров стратегии

- Формируем JSON вида `{ strategy_id, strategy_params, risk_settings, filters }`.
- Сортируем ключи рекурсивно (deterministic order). Can use `json-stable-stringify`.
- Hash = `sha256(stable_json_string)` → `strategy_params_hash`.
- Snapshot (jsonb) сохраняем для прозрачности.

## 5. Потоки записи

### 5.1. Сканнер (live)

1. При запуске — создаём `trading_sessions` (mode = текущий, source = scanner, status = running).
2. На каждом `confirmPendingSignal` → создаём запись в `session_trades` (статус `open`).
3. При закрытии сделки (через executionManager, auto-close, ручное) → обновляем trade (exit*, realized_pnl) и пересчитываем `session_metrics`.
4. Периодически (каждые N мин) записываем срез в `session_equity_curve`.
5. При синхронизации настроек (если пользователь меняет параметры) → пишем в `session_params_history`.
6. При остановке — обновляем `trading_sessions.status = completed`, `ended_at = now()`.

### 5.2. Бэктестер

1. В начале прогона — создаём `trading_sessions` (source = backtester, mode = backtest).
2. После расчёта → Bulk insert trades/метрик/эквити.
3. `session_metrics` заполняем из `BacktestMetrics` (см. `backend/src/modules/backtester/backtester.types.ts`).
4. `trading_sessions.status = completed` по завершению.

## 6. API слой

- `GET /api/sessions` — фильтрация по source, mode, дате, версии стратегии.
- `GET /api/sessions/:id` — метаданные + метрики.
- `GET /api/sessions/:id/trades` — список сделок (пагинация, фильтры).
- `GET /api/sessions/:id/export` — формат `?format=json|csv` (по умолчанию json).
- `POST /api/sessions/:id/compare` — тело `{ otherSessionId }` (или query). Возвращает структуру:
  ```json
  {
    "base": { ...metrics },
    "reference": { ...metrics },
    "delta": {
      "total_pnl": { "abs": 123.45, "pct": 0.12 },
      "win_rate_pct": { "abs": -5.2 },
      "max_drawdown_pct": { "abs": 3.1 },
      ...
    },
    "notes": ["..."],
    "significant": true
  }
  ```
- `POST /api/sessions/:id/notes` — добавление заметок аналитика.
- WebSocket уведомления при обновлении метрик/новых сделках (для live UI).

## 7. Сравнение и адаптация стратегии

1. Подбираем matching сессии:
   - одинаковый `strategy_params_hash` или фиксируем версию.
   - идентичные пары/таймфреймы и временной диапазон (live → start/end попадает в range backtest).
2. Используем `compare` endpoint → анализ дельт (PnL, winrate, maxDD, expectancy, средняя задержка).
3. На основе дельт корректируем параметры (например, подтверждение, stopLossMultiplier).
4. Заносим решение в `trading_sessions.notes` + Jira/Notion.
5. При следующей сессии сохраняем новую версию (strategy_version + hash).

## 8. Нормы качества данных

- Все цены/PNL — numeric с точностью 1e-8.
- Timestamps — UTC (timestamptz).
- Размер позиции — положительное число (с учётом знака direction).
- Fees → всегда положительные; если неизвестны, 0, но фиксируем в `extra.missing_fee = true`.
- При отсутствии закрытия (позиция открыта) `exit_*` поля NULL.
- Для отменённых сигналов пишем status = `cancelled`, exit_reason = `cancelled`.

## 9. Минимальный MVP

✅ **Выполнено:**

1. ✓ Создать миграции для `trading_sessions`, `session_trades`, `session_metrics` (без equity/events).
2. ✓ Реализовать запись live-сделок (confirm/close) + метрики (winrate, pnl, trades).
3. ✓ Добавить экспорт JSON/CSV.
4. ⏳ UI: полоска текущей сессии + кнопка выгрузки (pending).
5. ⏳ Документация: обновить `backend/README`, `BACKTESTER_IMPLEMENTATION_PLAN.md`, `frontend/READMEF.md` (in progress).

### Реализованные API endpoints:

- `GET /api/sessions` — список сессий с фильтрацией (source, mode, strategyVersion)
- `GET /api/sessions/:id` — детали сессии + метрики
- `GET /api/sessions/:id/trades` — сделки сессии с пагинацией
- `GET /api/sessions/:id/export?format=json|csv` — экспорт данных
- `POST /api/sessions/:id/compare` — сравнение метрик двух сессий
- `POST /api/sessions/:id/notes` — добавление заметок аналитика
- `POST /api/sessions/:id/end` — завершение сессии вручную

## 10. Дальнейшее развитие

✅ **Интеграция с бэктестером (Реализовано)**

Бэктестер теперь автоматически сохраняет результаты в систему сессий:

- **Одиночный бэктест** (`POST /api/backtest/run`):
  - Создаётся сессия с `source: 'backtester'`, `mode: 'backtest'`
  - Все сделки записываются в `session_trades`
  - Метрики рассчитываются автоматически
  - `sessionId` возвращается в поле `jobId` ответа

- **Портфельный бэктест** (`POST /api/backtest/portfolio`):
  - Создаётся портфельная сессия с `portfolioMode: true`
  - Сделки со всех пар объединяются в одной сессии
  - Метрики агрегируются по всему портфелю

**Преимущества:**

- Единый интерфейс для просмотра результатов scanner и backtester
- Прямое сравнение live vs backtest через API `/api/sessions/:id/compare`
- Полная история всех тестов с фильтрацией по параметрам
- Экспорт результатов в JSON/CSV для дальнейшего анализа

**Будущее развитие:**

- Equity curve и события.
- Автоматический Alert, если расхождение с backtest > threshold.
- Визуализация сравнения scanner vs backtester в UI.
- Dashboard по сессиям (тренды по winrate, pnl).
- Интеграция с А/B хранилищем параметров стратегии.
