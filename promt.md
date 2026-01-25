# 🎯 Backtester V2 - Главный План Проекта

**Последнее обновление:** 25.01.2026  
**Версия:** 4.0

---

## 📋 Цель Проекта

**Высокопроизводительная платформа** для бэктестинга, сканирования и автоматической торговли на криптовалютных фьючерсных рынках:

- **Мульти-биржевая** архитектура (Bybit — основная, OKX — совместимость)
- **Spot и Futures** торговля с реалистичной симуляцией
- **Real-time Scanner** с Bybit Demo/Testnet
- **Оптимизатор параметров** с grid search

---

## 📊 Технологический Стек

### Backend
- **Node.js + TypeScript**, Express.js
- **PostgreSQL** + TypeORM
- **Redis** + BullMQ (очереди)
- **Socket.io** (WebSocket)

### Frontend
- **Vue 3** (Composition API) + Vite
- **PrimeVue 4.x** + Tailwind CSS
- **Pinia** (state management)

### Биржи
- **Bybit** — основная (13x быстрее OKX)
- **OKX** — совместимость

---

## 🎯 Состояние Проекта

### ✅ Завершено (100%)
| Модуль | Описание |
|--------|----------|
| **Инфраструктура** | Docker, PostgreSQL, Redis, логгер |
| **Загрузка данных** | Bybit/OKX API, BullMQ очереди |
| **Стратегия** | ATR, Volume Profile, NWE, Clusters, Delta, CVD, VPA |
| **Бектестер** | `runBacktest`, `runPortfolioBacktest`, spot/futures |
| **Futures** | Leverage, funding rate, liquidation, profiles |
| **Scanner** | ScannerService, Bybit Demo/Testnet, сессии |
| **Optimizer** | Grid search, `npm run optimize:futures` |

### 🔄 В процессе
| Модуль | Прогресс | Осталось |
|--------|----------|----------|
| **UI результатов** | 70% | Графики сигналов, Volume Profile зоны |
| **Scanner** | 85% | Paper trading, live торговля |
| **Тестирование** | 30% | Unit/Integration тесты |

---

## 📁 Структура Проекта

```
backend/src/modules/
├── backtester/          # Бектест-движок (spot + futures)
├── futures/             # Leverage, funding, liquidation
├── strategy_logic/      # Индикаторы, стратегия, профили
├── scanner/             # Real-time сканер
├── optimizer/           # Grid search оптимизатор
└── data/                # Загрузка данных

frontend/src/
├── views/               # BacktesterView, ScannerView, SettingsView
├── stores/              # Pinia stores
└── components/          # UI компоненты
```

---

## 🚀 Быстрый Старт

```bash
# Установка
npm run install:all

# Запуск (frontend + backend)
npm run dev

# Оптимизация параметров
cd backend && npm run optimize:futures
```

**Требования:** PostgreSQL (5432), Redis (6379)

---

## 📝 Приоритеты

1. **Walk-forward validation** для оптимизатора
2. **Paper trading** в Scanner
3. **Unit-тесты** для futures модулей
4. **Визуализация** Volume Profile зон

---

**Версия:** 4.0 | **Статус:** Production Ready




