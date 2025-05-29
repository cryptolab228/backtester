### Portfolio Backtester Usage

1. **Mode Selection**: Toggle the switcher at the top of the page to enable Portfolio mode
2. **Trading Pairs Selection**: 
   - Use the multi-select dropdown to choose trading pairs
   - **NEW**: Quick selection buttons:
     - **"Выбрать все"** - Select all available trading pairs
     - **"Очистить"** - Clear all selected pairs
   - Search functionality for easy pair finding
   - Visual chips showing selected pairs with removal option
3. **Portfolio Configuration**:
   - Set total portfolio capital (shared among all pairs)
   - Configure maximum concurrent trades limit (optional)
4. **Execution Parameters**: Set timeframe and date range for the backtest
5. **Run Backtest**: Execute the portfolio backtesting with real-time progress tracking

#### Error Handling Features
- **Missing Data Detection**: Automatic detection of pairs without sufficient historical data
- **Detailed Error Messages**: Clear information about which pairs need data
- **Data Loading Integration**: Automatic queueing of data fetching jobs for missing data
- **User-Friendly Warnings**: Visual indicators in results when some pairs lack data
- **Validation**: Pre-execution validation of parameters and date ranges

#### State Persistence Features ✨ NEW!
- **Active Scan Recovery**: Automatic detection and restoration of running backtests after page refresh
- **Mode Persistence**: Remembers selected backtester mode (single/portfolio) between sessions
- **Parameter Persistence**: Saves and restores all form parameters for convenience
- **Results Persistence**: Keeps last backtest results available after page reload
- **Job Tracking**: Real-time tracking of active jobs with WebSocket reconnection
- **Visual Status Indicators**: Clear display of active scanning status with job IDs
- **Session Continuity**: Seamless continuation of long-running portfolio backtests 

### Установка и запуск компонентов

После каждого созданного компонента:

#### PortfolioResultsDisplay Component (Обновлен с исправлениями и улучшениями дизайна)
- **Местоположение**: `frontend/src/components/PortfolioResultsDisplay.vue`
- **Установка**: Автоматически подключается в BacktesterView.vue
- **Запуск**: 
  1. Переключиться в портфельный режим в Бектестере
  2. Выбрать несколько торговых пар
  3. Запустить портфельный бектест
- **Обновления дизайна**:
  - ✅ **Унификация дизайна**: Применен дизайн портфельного режима к одиночному бектестеру
  - ✅ **Карточки метрик**: Основные метрики отображаются в цветных градиентных карточках
  - ✅ **Разделение списков сделок**: Список сделок перенесен в отдельную вкладку для обоих режимов
  - ✅ **Оптимизация таблиц**: Фиксированная ширина колонок для устранения горизонтальных скроллбаров
  - ✅ **Улучшенная типографика**: Лучшие размеры шрифтов и интервалы для читаемости таблиц
  - ✅ **Компактные колонки**: Сокращение "LONG/SHORT" до "L/S" для экономии места
  - ✅ **Исправление винрейта**: Устранена проблема выхода текста за границы в портфельном режиме
  - ✅ **Сохранение состояния**: Результаты и параметры теперь сохраняются при переключении режимов
- **Отладка**: 
  - ✅ **Исправлены критические ошибки**: DataTable multisortField, vnode/parentNode errors
  - ✅ **Улучшена стабильность**: Добавлены защитные проверки данных и безопасная очистка ресурсов
  - ✅ **Исправление колонки направления**: Устранена проблема пересечения колонок и наложения содержимого
  - Проверить консоль браузера на отсутствие ошибок при навигации
  - Убедиться в корректном отображении результатов после завершения бектеста
  - Проверить сохранение состояния при перезагрузке страницы
  - Убедиться в отсутствии горизонтальных скроллбаров в таблицах

### Планируемые функции для графиков сделок 📊 **НОВОЕ!**

#### Интерактивные графики сделок
- **Цель**: Реализовать возможность просмотра детального графика при клике на конкретную сделку
- **Планируемая реализация**:
  1. **TradeChartModal component** - модальное окно для отображения графика сделки
  2. **Кликабельные таблицы** - обработчики клика на строки таблиц сделок
  3. **Детальная визуализация**:
     - Ценовой график с candlestick данными за период сделки
     - Маркеры точек входа и выхода
     - Уровни Stop Loss и Take Profit
     - Технические индикаторы (ATR, объемы)
  4. **Интерактивные возможности**:
     - Масштабирование и панорамирование
     - Переключение временных рамок
     - Анимация процесса сделки
     - Экспорт графика

#### Требования к реализации
- **Библиотека**: Chart.js, ApexCharts или D3.js (требует исследования)
- **Данные**: Расширение BacktestResult для включения candlestick данных
- **Производительность**: Оптимизация для больших наборов данных
- **UX**: Hover эффекты и индикаторы интерактивности в таблицах 