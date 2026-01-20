# Руководство по использованию торговых сессий

## 📊 Обзор

Система торговых сессий позволяет отслеживать, анализировать и сравнивать результаты работы сканнера и бэктестера. Все сделки автоматически записываются в БД с детальной статистикой и метриками производительности.

---

## 🚀 Быстрый старт

### 1. Автоматическая запись сессий

**Сканнер:**
- При старте сканнера (`/api/scanner/start`) автоматически создаётся новая торговая сессия
- Каждая открытая сделка записывается в таблицу `session_trades`
- Метрики обновляются при каждом изменении (открытие/закрытие позиции)
- При остановке сканнера сессия автоматически завершается со статусом `completed`

**Бэктестер:**
- ✅ Результаты автоматически сохраняются в систему сессий после каждого запуска
- Одиночный бэктест (`/api/backtest/run`) → создаёт сессию для одной пары
- Портфельный бэктест (`/api/backtest/portfolio`) → создаёт портфельную сессию
- Формат данных идентичен live-сессиям для корректного сравнения
- `sessionId` возвращается в поле `jobId` ответа API

### 2. Просмотр сессий

**Frontend (Web UI):**
```
http://localhost:5173/sessions
```

Функции:
- Фильтрация по источнику (scanner/backtester), режиму, статусу
- Просмотр активных сессий в реальном времени
- Детальный просмотр метрик каждой сессии
- Экспорт данных в JSON/CSV

**API:**
```bash
# Получить список сессий
curl http://localhost:5000/api/sessions

# Детали сессии
curl http://localhost:5000/api/sessions/{session-id}

# Сделки сессии
curl http://localhost:5000/api/sessions/{session-id}/trades
```

---

## 📈 Метрики производительности

Каждая сессия автоматически рассчитывает:

| Метрика | Описание |
|---------|----------|
| **Total PnL** | Общая прибыль/убыток (realized + unrealized) |
| **Win Rate** | Процент прибыльных сделок |
| **Profit Factor** | Отношение общей прибыли к общим убыткам |
| **Expectancy** | Математическое ожидание PnL на сделку |
| **Avg Trade PnL** | Средний PnL на сделку |
| **Max Drawdown** | Максимальная просадка за сессию |
| **Trade Count** | Общее количество сделок |
| **Latency** | Средняя и P95 задержка исполнения |

---

## 🔍 Сравнение сессий

### Зачем сравнивать?

- **Scanner vs Backtester**: проверить, насколько live-результаты соответствуют бэктесту
- **Разные параметры стратегии**: A/B тестирование параметров
- **Разные периоды**: влияние рыночных условий

### Как сравнить (API)

```bash
curl -X POST http://localhost:5000/api/sessions/{session-1-id}/compare \
  -H "Content-Type: application/json" \
  -d '{"otherSessionId": "{session-2-id}"}'
```

**Ответ:**
```json
{
  "success": true,
  "base": {
    "sessionId": "uuid-1",
    "totalPnl": 1250.50,
    "winRatePct": 65.50,
    "profitFactor": 2.15
  },
  "reference": {
    "sessionId": "uuid-2",
    "totalPnl": 1100.00,
    "winRatePct": 60.00,
    "profitFactor": 1.80
  },
  "delta": {
    "totalPnl": { "abs": 150.50, "pct": 13.68 },
    "winRatePct": { "abs": 5.50 },
    "profitFactor": { "abs": 0.35 }
  },
  "significant": false,
  "notes": ["Metrics are similar"]
}
```

**Интерпретация:**
- `significant: true` → расхождение > порога (winRate ±5%, PnL ±20%, profitFactor ±0.5)
- `delta.abs` → абсолютная разница
- `delta.pct` → процентное изменение

---

## 📥 Экспорт данных

### JSON экспорт

```bash
curl http://localhost:5000/api/sessions/{session-id}/export?format=json -o session.json
```

**Структура:**
```json
{
  "session": { /* метаданные сессии */ },
  "metrics": { /* метрики производительности */ },
  "trades": [ /* все сделки с деталями */ ]
}
```

### CSV экспорт

```bash
curl http://localhost:5000/api/sessions/{session-id}/export?format=csv -o trades.csv
```

Содержит таблицу всех сделок для анализа в Excel/Google Sheets.

---

## 🛠️ Типичные сценарии

### Сценарий 1: Проверка стратегии перед live-запуском

1. Запустить бэктест на исторических данных:
   ```bash
   curl -X POST http://localhost:5000/api/backtest/run \
     -H "Content-Type: application/json" \
     -d '{
       "pairSymbol": "BTCUSDT",
       "timeframe": "15m",
       "startDate": "2025-09-01",
       "endDate": "2025-10-01",
       "initialCapital": 10000,
       "exchange": "bybit",
       "strategyParameters": { ... }
     }'
   ```
   Ответ содержит `jobId` (это `session_id_backtest`)

2. Запустить scanner в `demo` режиме на 1-2 дня → получить `session_id_demo`
   
3. Сравнить сессии:
   ```bash
   curl -X POST http://localhost:5000/api/sessions/{session_id_demo}/compare \
     -H "Content-Type: application/json" \
     -d '{"otherSessionId": "{session_id_backtest}"}'
   ```
4. Если `significant: false` и метрики схожи → переходить на `live`

### Сценарий 2: Оптимизация параметров

1. Запустить сканнер с параметрами **v1** (например, RSI 30/70) → `session_1`
2. Остановить, изменить параметры на **v2** (RSI 25/75), запустить снова → `session_2`
3. Сравнить `session_1` vs `session_2`
4. Выбрать вариант с лучшим profit factor и expectancy

### Сценарий 3: Анализ деградации стратегии

1. Получить список последних 10 сессий:
   ```bash
   curl "http://localhost:5000/api/sessions?source=scanner&limit=10"
   ```
2. Сравнить последнюю сессию с предыдущей неделей
3. Если winRate падает на >10% → проверить изменения рынка, пересмотреть параметры

---

## 📝 Заметки аналитика

Добавление комментариев к сессии:

```bash
curl -X POST http://localhost:5000/api/sessions/{session-id}/notes \
  -H "Content-Type: application/json" \
  -d '{"notes": "Высокая волатильность, много ложных пробоев. Нужно увеличить confirmation_window."}'
```

Заметки сохраняются в поле `notes` и доступны через API и UI.

---

## 🔧 Ручное управление

### Завершить сессию вручную

Если сканнер завис или остановлен некорректно:

```bash
curl -X POST http://localhost:5000/api/sessions/{session-id}/end \
  -H "Content-Type: application/json" \
  -d '{"status": "aborted", "notes": "Сервер перезагружен"}'
```

**Статусы:**
- `completed` — нормальное завершение
- `failed` — ошибка
- `aborted` — прервано вручную

---

## 🧹 Управление сессиями

### Удаление сессии (Frontend)
1. Остановите сканнер (если сессия активна)
2. Перейдите в раздел `Сессии`
3. В карточке завершённой сессии нажмите `Удалить`
4. Подтвердите действие в диалоговом окне

### Удаление сессии (API)
```bash
# удалить завершённую сессию
curl -X DELETE http://localhost:5000/api/scanner/sessions/{session-id}
```

> ⚠️ Удаление необратимо: сессия и связанные сделки будут удалены из БД.

---

## 🗄️ Структура данных

### Таблица `trading_sessions`

```sql
id                      UUID PRIMARY KEY
source                  'scanner' | 'backtester'
mode                    'demo' | 'testnet' | 'live' | 'backtest'
strategy_version        TEXT (e.g., '1.0.0')
strategy_params_hash    SHA256 hash параметров
strategy_params_snapshot JSONB (полный снепшот)
exchange                TEXT (e.g., 'bybit')
pairs                   TEXT[] (e.g., ['BTCUSDT', 'ETHUSDT'])
timeframes              TEXT[] (e.g., ['15m', '1h'])
portfolio_mode          BOOLEAN
started_at              TIMESTAMPTZ
ended_at                TIMESTAMPTZ (NULL если running)
status                  'running' | 'completed' | 'failed' | 'aborted'
notes                   TEXT (комментарии аналитика)
```

### Таблица `session_trades`

```sql
id                UUID PRIMARY KEY
session_id        UUID REFERENCES trading_sessions
source            'scanner' | 'backtester'
pair              TEXT (e.g., 'BTCUSDT')
timeframe         TEXT (e.g., '15m')
entry_timestamp   TIMESTAMPTZ
entry_price       DECIMAL(38,18)
exit_timestamp    TIMESTAMPTZ
exit_price        DECIMAL(38,18)
exit_reason       'take_profit' | 'stop_loss' | 'manual'
position_size     DECIMAL(38,18)
leverage          DECIMAL(20,4)
realized_pnl      DECIMAL(38,18)
realized_pnl_pct  DECIMAL(20,8)
status            'open' | 'closed' | 'cancelled'
```

### Таблица `session_metrics`

```sql
id                  UUID PRIMARY KEY
session_id          UUID REFERENCES trading_sessions
total_pnl           DECIMAL(38,18)
realized_pnl        DECIMAL(38,18)
unrealized_pnl      DECIMAL(38,18)
win_rate_pct        DECIMAL(20,8)
profit_factor       DECIMAL(20,8)
avg_trade_pnl       DECIMAL(38,18)
expectancy          DECIMAL(38,18)
max_drawdown_pct    DECIMAL(20,8)
trade_count         INTEGER
winning_trades      INTEGER
losing_trades       INTEGER
```

---

## 🐛 Troubleshooting

### Сессия не создалась при старте сканнера

**Проверка:**
```bash
# Проверить логи backend
tail -f backend/logs/combined.log | grep "Trading session created"

# Проверить БД
psql -U postgres -d backtester -h localhost -p 5555 \
  -c "SELECT * FROM trading_sessions ORDER BY started_at DESC LIMIT 5;"
```

**Решение:** Убедиться, что миграция `createTables.sql` выполнена.

### Метрики не обновляются

**Проверка:**
```bash
# Проверить обновления метрик
psql -U postgres -d backtester -h localhost -p 5555 \
  -c "SELECT session_id, updated_at, trade_count FROM session_metrics ORDER BY updated_at DESC LIMIT 5;"
```

**Решение:** Метрики пересчитываются при каждом открытии/закрытии сделки. Проверить, что сделки записываются в `session_trades`.

### CSV экспорт пустой

**Причина:** В сессии нет закрытых сделок.

**Решение:** CSV экспортирует только сделки. Использовать JSON для экспорта метрик.

---

## 📚 Дополнительные ресурсы

- **API документация**: [`docs/API_SESSIONS.md`](./API_SESSIONS.md)
- **Стандарт сессий**: [`docs/SCANNER_SESSION_STANDARD.md`](./SCANNER_SESSION_STANDARD.md)
- **Сравнение scanner vs backtester**: [`docs/SCANNER_VS_BACKTESTER_COMPARISON.md`](./SCANNER_VS_BACKTESTER_COMPARISON.md)

---

## ✅ Чеклист перед запуском live-торговли

- [ ] Запустить бэктест на последних 3 месяцах данных
- [ ] Запустить scanner в `demo` режиме минимум на 1 неделю
- [ ] Сравнить метрики demo vs backtest
- [ ] `significant: false` при сравнении (расхождения в пределах нормы)
- [ ] Win rate demo >= 50% (или другой порог для вашей стратегии)
- [ ] Profit factor demo >= 1.5
- [ ] Max drawdown demo < 15%
- [ ] Записать заметки по результатам тестирования
- [ ] Установить Stop Loss для всей сессии (например, -5% от депозита)

---

**Автор:** Backtester V2 Team  
**Дата:** 13 октября 2025  
**Версия:** 1.0.0

