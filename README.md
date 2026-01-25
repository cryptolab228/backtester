# Backtester V2

Профессиональная платформа для бэктестинга и сканирования криптовалютных рынков.

## Быстрый старт

```bash
npm run install:all
npm run dev
```

**Требования:** PostgreSQL (5432), Redis (6379)

## Настройка

### backend/.env
```env
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=your_password
DB_DATABASE=backtester
REDIS_HOST=localhost
REDIS_PORT=6379
PORT=5000
```

## Возможности

| Модуль | Описание |
|--------|----------|
| **Backtester** | Одиночный и портфельный бектест, spot/futures |
| **Scanner** | Real-time сканирование, Bybit Demo/Testnet |
| **Optimizer** | Grid search оптимизация параметров |
| **Data** | Загрузка данных Bybit (13x быстрее OKX) |

## Структура

```
backend/src/modules/
  backtester/      - Бектест-движок
  scanner/         - Real-time сканер
  optimizer/       - Оптимизатор
  futures/         - Leverage, liquidation
  strategy_logic/  - Индикаторы, стратегия

frontend/src/
  views/           - BacktesterView, ScannerView
  stores/          - Pinia stores
```

## Команды

```bash
npm run dev              # Запуск
npm run build            # Сборка
docker-compose up -d     # Docker
```

## Диагностика

- Backend: http://localhost:5000
- Frontend: http://localhost:5173
- Логи: backend/logs/combined.log

## Документация

- promt.md - главный план проекта
- BYBIT_ALGORITM.MD - алгоритм загрузки данных
- frontend/READMEF.md - фронтенд документация
