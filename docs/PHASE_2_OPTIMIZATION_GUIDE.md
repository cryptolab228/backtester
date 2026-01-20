# 📊 Фаза 2: Оптимизация Параметров - Руководство

**Дата:** 18.10.2025  
**Статус:** 🔄 В процессе

---

## 🎯 Цель

Найти оптимальные параметры для futures стратегии через систематический бэктестинг на исторических данных.

---

## 🚀 Быстрый Старт

### **1. Запуск Оптимизации:**

```bash
cd backend
npm run optimize:futures
```

Скрипт выполнит:
- ✅ Grid search по параметрам (leverage, SL, TP, risk)
- ✅ ~192 комбинации параметров
- ✅ Ранжирование по комплексному скору
- ✅ Генерацию отчета с рекомендациями

---

## ⚙️ Конфигурация

### **Переменные Окружения (.env):**

```bash
# Путь к фикстуре с данными
OPTIMIZATION_FIXTURE=data/fixtures/btc-1h-3months.json

# Выходной файл отчета
OPTIMIZATION_OUTPUT=backend/public/optimization-results/futures-optimization-report.json
```

### **Параметры Grid Search:**

**Файл:** `backend/src/scripts/optimizeFuturesParameters.ts` (строки 29-34)

```typescript
const PARAMETER_GRID = {
  leverage: [3, 5, 7, 10],                      // Плечо
  stopLossMultiplier: [1.0, 1.5, 2.0, 2.5],    // SL (в ATR)
  takeProfitMultiplier: [2.0, 3.0, 4.0, 5.0],  // TP (в ATR)
  maxRiskPerTradePercentage: [0.01, 0.015, 0.02], // Риск на сделку
};
```

**Итого:** 4 × 4 × 4 × 3 = **192 комбинации**

---

## 📥 Подготовка Данных

### **Вариант 1: Использовать Существующие Данные**

Если у вас уже есть данные в БД:

```bash
# Экспортировать данные из БД в фикстуру
cd backend
npm run export:candles -- --pair BTCUSDT --timeframe 1h --days 90
```

### **Вариант 2: Скачать из API**

```bash
# Скачать свежие данные
cd backend
npm run fetch:candles -- --pair BTCUSDT --timeframe 1h --days 90
```

### **Вариант 3: Создать Тестовую Фикстуру**

```bash
# Создать минимальную фикстуру для тестирования
cd backend
npm run create:test-fixture
```

---

## 🔍 Что Оптимизируется

### **Параметры:**

1. **Leverage (Плечо):** 3x, 5x, 7x, 10x
   - Влияет на размер позиции и риск ликвидации
   
2. **Stop Loss Multiplier:** 1.0, 1.5, 2.0, 2.5 ATR
   - Чем меньше - тем тайтовее стоп, больше стопаутов
   - Чем больше - тем шире стоп, меньше стопаутов, но больше риск
   
3. **Take Profit Multiplier:** 2.0, 3.0, 4.0, 5.0 ATR
   - Чем меньше - тем быстрее фиксация прибыли
   - Чем больше - тем дольше держим позицию
   
4. **Max Risk per Trade:** 1%, 1.5%, 2%
   - Процент капитала, рискуемый на сделку

### **Метрики Оценки:**

**Комплексный скор** рассчитывается как:

```typescript
score = 
  + totalPnlPercentage           // Прибыль (основной компонент)
  + winRate * 0.5                // Win rate (вес 0.5)
  + min(profitFactor * 10, 50)   // Profit factor (cap 50)
  - maxDrawdown * 2              // Штраф за просадку
  + min(totalTrades / 10, 10)    // Бонус за кол-во сделок
  + effectiveROI * 0.2           // Effective ROI (futures)
  + capitalEfficiency * 0.1      // Capital efficiency
  + avgDistanceToLiq * 0.5       // Расстояние до ликвидации
  - abs(netFunding) * 0.1        // Штраф за funding costs
  - liquidations * 1000          // СИЛЬНЫЙ штраф за ликвидации!
```

---

## 📊 Результаты

### **Выходной Отчет:**

**Путь:** `backend/public/optimization-results/futures-optimization-report.json`

**Структура:**
```json
{
  "config": {
    "pairSymbol": "BTCUSDT",
    "timeframe": "1h",
    "startDate": "2024-07-01",
    "endDate": "2024-10-01",
    "initialCapital": 10000
  },
  "parameterGrid": { /* ... */ },
  "timestamp": "2025-10-18T12:00:00.000Z",
  "results": [
    {
      "parameters": {
        "leverage": 5,
        "stopLossMultiplier": 1.5,
        "takeProfitMultiplier": 3.0,
        "maxRiskPerTradePercentage": 0.01
      },
      "metrics": {
        "totalPnl": 1500.00,
        "totalPnlPercentage": 15.00,
        "totalTrades": 45,
        "winRate": 62.22,
        "profitFactor": 2.45,
        "maxDrawdown": 8.50,
        "liquidations": 0,
        "netFunding": -25.50,
        "effectiveROI": 75.00,
        "capitalEfficiency": 125.00,
        "avgDistanceToLiquidation": 35.50
      },
      "score": 125.75
    },
    /* ... топ-10 результатов ... */
  ],
  "statistics": {
    "totalCombinations": 192,
    "profitableCount": 145,
    "noLiquidationsCount": 178,
    "avgPnl": 5.25,
    "avgWinRate": 55.50,
    "avgLiquidations": 0.15
  },
  "recommendation": {
    "parameters": { /* ... лучшие параметры ... */ },
    "expectedMetrics": { /* ... ожидаемая производительность ... */ }
  }
}
```

### **Консольный Вывод:**

```
================================================================================
🏆 TOP 10 RESULTS:
================================================================================

#1 | Score: 125.75
  Leverage: 5x | SL: 1.5 | TP: 3.0 | Risk: 1.0%
  PnL: 15.00% ($1500.00) | Trades: 45 | Win Rate: 62.22%
  Profit Factor: 2.45 | Max DD: 8.50% | Expectancy: 33.33
  Liquidations: 0 | Net Funding: $-25.50 | Effective ROI: 75.00%
  Capital Efficiency: 125.00% | Avg Distance to Liq: 35.50%

#2 | Score: 118.50
  ...

================================================================================
💡 RECOMMENDATIONS:
================================================================================

✅ Best parameters:
  Leverage: 5x
  Stop Loss Multiplier: 1.5
  Take Profit Multiplier: 3.0
  Max Risk per Trade: 1.0%

  Expected Performance:
    • PnL: 15.00%
    • Win Rate: 62.22%
    • Profit Factor: 2.45
    • Max Drawdown: 8.50%
    • Liquidations: 0
```

---

## 🧪 Тестирование

### **Шаг 1: Тест на Обучающем Периоде (In-Sample)**

```bash
# Запустить оптимизацию на 3 месяца
npm run optimize:futures
```

### **Шаг 2: Валидация на Тестовом Периоде (Out-of-Sample)**

```bash
# Изменить даты в конфиге
# startDate: '2024-10-01'
# endDate: '2024-11-01'

# Запустить с найденными параметрами
npm run optimize:futures
```

### **Шаг 3: Walk-Forward Анализ**

```bash
# Создать скрипт для walk-forward
npm run walkforward:futures
```

---

## 📈 Интерпретация Результатов

### **Хорошие Результаты:**

✅ **Score > 100** - Отличная стратегия  
✅ **Liquidations = 0** - Нет ликвидаций  
✅ **Win Rate > 55%** - Высокий процент выигрышных сделок  
✅ **Profit Factor > 2.0** - Прибыльные сделки вдвое превышают убыточные  
✅ **Max Drawdown < 15%** - Умеренная просадка  
✅ **Total Trades > 30** - Достаточно сделок для статистической значимости  

### **Плохие Результаты:**

❌ **Liquidations > 0** - КРИТИЧНО! Стратегия слишком рискованная  
❌ **Win Rate < 45%** - Низкий процент выигрышей  
❌ **Profit Factor < 1.5** - Недостаточно прибыльна  
❌ **Max Drawdown > 25%** - Слишком высокая просадка  
❌ **Total Trades < 10** - Недостаточно данных  

### **Futures-Специфичные Метрики:**

- **Effective ROI:** ROI с учетом плеча (должен быть > 50%)
- **Capital Efficiency:** Прибыль / использованная маржа (> 100%)
- **Avg Distance to Liq:** Среднее расстояние до ликвидации (> 25%)
- **Net Funding:** Чистая стоимость funding (ближе к 0 - лучше)

---

## ⚠️ Важные Замечания

### **1. Overfitting (Переобучение)**

```
⚠️ РИСК: Параметры могут быть переоптимизированы под конкретный период

✅ РЕШЕНИЕ:
  • Тестировать на разных периодах (walk-forward)
  • Использовать out-of-sample данные
  • Проверять стабильность результатов
  • Не гнаться за максимальным score
```

### **2. Рыночные Условия**

```
⚠️ РИСК: Параметры могут работать только в определенных условиях

✅ РЕШЕНИЕ:
  • Тестировать на трендовых и флэтовых рынках
  • Анализировать по волатильности
  • Адаптивные параметры (будущая версия)
```

### **3. Liquidation Risk**

```
⚠️ РИСК: Даже одна ликвидация может обнулить прибыль

✅ РЕШЕНИЕ:
  • ВСЕГДА выбирать параметры с liquidations = 0
  • Мониторить distance to liquidation > 20%
  • Начинать с консервативного плеча (3-5x)
```

---

## 🔄 Следующие Шаги

### **После Оптимизации:**

1. **Проанализировать топ-10 результатов**
   - Выбрать несколько кандидатов с близкими скорами
   - Сравнить стабильность результатов

2. **Walk-forward валидация**
   - Разбить данные на периоды
   - Оптимизировать на каждом периоде
   - Тестировать на следующем

3. **Demo-тестирование**
   - Запустить на demo-счете с найденными параметрами
   - Мониторить 1-2 недели
   - Сравнить с бэктестом

4. **Production запуск**
   - Начать с минимальным капиталом
   - Постепенно увеличивать
   - Постоянно мониторить

---

## 📚 Полезные Команды

```bash
# Запустить оптимизацию
npm run optimize:futures

# Запустить с кастомной фикстурой
OPTIMIZATION_FIXTURE=data/my-data.json npm run optimize:futures

# Экспортировать данные из БД
npm run export:candles -- --pair BTCUSDT --timeframe 1h --days 90

# Просмотреть результаты
cat backend/public/optimization-results/futures-optimization-report.json | jq '.recommendation'

# Сравнить топ-3 результата
cat backend/public/optimization-results/futures-optimization-report.json | jq '.results[0:3]'
```

---

## 🎓 Дополнительные Материалы

### **Теория:**
- [Position Sizing](https://www.investopedia.com/terms/p/positionsizing.asp)
- [Walk-Forward Analysis](https://www.investopedia.com/terms/w/walk-forward-analysis.asp)
- [Overfitting in Trading](https://www.quantstart.com/articles/Successful-Backtesting-of-Algorithmic-Trading-Strategies-Part-I/)

### **Наши Документы:**
- `docs/PHASE_1_COMPLETE.md` - Завершенная инфраструктура
- `docs/INTEGRATION_SUMMARY.md` - Итоговая сводка
- `backend/src/modules/futures/README.md` - Документация модулей

---

## ❓ FAQ

**Q: Сколько времени займет оптимизация?**  
A: ~5-10 минут для 192 комбинаций на 90 днях данных (зависит от мощности ПК)

**Q: Можно ли добавить свои параметры?**  
A: Да, редактируйте `PARAMETER_GRID` в скрипте

**Q: Что делать, если все результаты с ликвидациями?**  
A: Уменьшите leverage или увеличьте stopLossMultiplier

**Q: Как интерпретировать score?**  
A: Выше = лучше. Score > 100 - отлично, < 0 - плохо

**Q: Нужно ли использовать ровно эти параметры?**  
A: Нет, это отправная точка. Можете fine-tune вручную

---

**Автор:** AI Senior Assistant  
**Дата:** 18.10.2025  
**Версия:** 1.0  
**Статус:** 📊 READY TO OPTIMIZE




