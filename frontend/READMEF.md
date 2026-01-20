# Vue 3 + TypeScript + Vite

This template should help get you started developing with Vue 3 and TypeScript in Vite. The template uses Vue 3 `<script setup>` SFCs, check out the [script setup docs](https://v3.vuejs.org/api/sfc-script-setup.html#sfc-script-setup) to learn more.

Learn more about the recommended Project Setup and IDE Support in the [Vue Docs TypeScript Guide](https://vuejs.org/guide/typescript/overview.html#project-setup).

## Структура Приложения и Навигация

Проект использует основной макет `src/layouts/DefaultLayout.vue`, который включает:

*   Боковую панель навигации, созданную с использованием компонента `PanelMenu` из PrimeVue.
*   Верхнюю панель для отображения заголовка текущего раздела (используется `$route.name`).
*   Основную область для контента страницы (`<router-view>`).
*   Футер.

Навигационные ссылки определены в `DefaultLayout.vue` и соответствуют маршрутам, настроенным в `src/router/index.ts`.

### Основные разделы:

*   **Home (`/`)**: Главная страница приложения (компонент `src/views/HomeView.vue`).
*   **Управление данными (`/data`)**: Страница для загрузки торговых пар и исторических данных (компонент `src/views/DataManagementView.vue`).
*   **Очередь задач (`/queue-manager`)**: Страница для управления и мониторинга фоновых задач (компонент `src/views/QueueManagerView.vue`).
*   **Бектестер (`/backtester`)**: Раздел для проведения бэктестинга торговых стратегий. **Здесь же производится настройка, изменение и сохранение параметров стратегии для бектестов.** (компонент `src/views/BacktesterView.vue`).
*   **Сканнер (`/scanner`)**: Раздел для сканирования рынка на наличие торговых сигналов (компонент `src/views/ScannerView.vue`).
*   **Настройки (`/settings`)**: Страница для **управления подключениями к API бирж** (компонент `src/views/SettingsView.vue`).

### Запуск и Отладка (Общее)

1.  Убедитесь, что все зависимости установлены: `npm install` (или `yarn`).
2.  Запустите dev-сервер: `npm run dev` (или `yarn dev`).
3.  Откройте приложение в браузере по адресу, указанному в консоли (обычно `http://localhost:5173` или аналогичный).

Убедитесь, что ваш `main.ts` (или `main.js`) корректно инициализирует Vue Router, PrimeVue (с необходимой темой и иконками) и Tailwind CSS. Пример подключения PrimeVue:

```typescript
// main.ts
import { createApp } from 'vue';
import App from './App.vue';
import router from './router';
import PrimeVue from 'primevue/config';
import ToastService from 'primevue/toastservice';

// Импорт темы PrimeVue (например, Lara Light Indigo)
import 'primevue/resources/themes/lara-light-indigo/theme.css';
// Импорт базовых стилей PrimeVue
import 'primevue/resources/primevue.min.css';
// Импорт иконок PrimeIcons
import 'primeicons/primeicons.css';

// Импорт стилей Tailwind
import './assets/main.css'; // Или где у вас основные стили Tailwind (index.css, style.css)

const app = createApp(App);

app.use(router);
app.use(PrimeVue);
app.use(ToastService);

// Глобальная регистрация компонентов PrimeVue (если не используете unplugin-vue-components)
// import Button from 'primevue/button';
// app.component('Button', Button);

app.mount('#app');
```

Убедитесь, что в `tailwind.config.js` путь к файлам PrimeVue добавлен в `content`, если вы планируете стилизовать их с помощью Tailwind:

```javascript
// tailwind.config.js
export default {
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
    "./node_modules/primevue/**/*.{vue,js,ts,jsx,tsx}" // Добавьте эту строку
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
```

### Управление Очередями Задач (`/queue-manager`)

Представление `QueueManagerView` позволяет отслеживать и управлять фоновыми задачами (например, загрузка данных).

**Возможности:**

*   **Отображение счетчиков:** Показывает количество задач в каждом статусе (Активные, Ожидают, На паузе, Завершенные, Ошибки, Отложенные).
*   **Фильтрация:** Позволяет фильтровать список задач по одному или нескольким статусам.
*   **Список задач:** Отображает детальную информацию о задачах (ID, Тип, Параметры, Статус, Время создания/обработки/завершения).
*   **Просмотр деталей:** При клике на строку или кнопку "Глаз" открывается модальное окно с полными данными задачи (включая результат или ошибку).
*   **Повторный запуск:** Кнопка "Повторить" (`pi-replay`) позволяет повторно запустить задачу, завершившуюся с ошибкой или успешно (для повторной обработки).
*   **Пауза/Возобновление:** 
    *   Кнопка "Пауза" (`pi-pause-circle`) доступна для активных и ожидающих задач. Позволяет приостановить выполнение задачи.
    *   Кнопка "Возобновить" (`pi-play-circle`) доступна для задач на паузе. Позволяет возобновить выполнение задачи.
*   **Удаление:** Кнопка "Удалить" (`pi-trash`) позволяет удалить задачу из очереди (требует подтверждения).
*   **Автообновление:** Данные на странице (счетчики и список задач) автоматически обновляются каждые 10 секунд. Обновление приостанавливается при открытии модального окна деталей задачи.
*   **Сохранение состояния таблицы:** Порядок сортировки, текущая страница и количество строк на странице сохраняются в `sessionStorage`.

### Бектестер (`/backtester`)

Раздел для проведения бэктестинга торговых стратегий (компонент `src/views/BacktesterView.vue`).
Он использует два основных хранилища Pinia:
*   **`settingsStore.ts`**: В контексте страницы "Бектестер", это хранилище отвечает за управление параметрами самой стратегии (DLC, NWE, кластеры, риски и т.д.). Параметры могут загружаться (например, из localStorage или будущих пресетов) и изменяются пользователем непосредственно в компоненте `StrategySettingsForm.vue`, который интегрирован в `BacktesterView.vue`.
*   **`backtestStore.ts`**: Для управления процессом запуска бэктеста, отслеживания его состояния (`isLoading`, `results`, `error`) и обработки отмены запроса.

**Структура `BacktesterView.vue`:**
*   **Заголовок страницы.**
*   **Основная сетка (grid) из двух колонок:**
    *   **Левая колонка:**
        *   `Panel` "Настройки стратегии" (сворачиваемая). Содержит компонент `StrategySettingsForm.vue` для ввода всех параметров стратегии.
    *   **Правая колонка:**
        *   `Panel` "Управление и Результаты" (сворачиваемая).
            *   Секция "Запуск Бектеста":
                *   Кнопки: "Старт", "Стоп", "Сброс настроек" (с иконками и всплывающими подсказками `v-tooltip`).
                *   `ProgressBar` для индикации выполнения.
            *   Секция "Результаты":
                *   Используется `TabView` с несколькими `TabPanel` ("Сводка", "Список сделок", "Графики", "Логи") для организации отображения результатов.

**Стилизация и компоненты:**
*   Используются компоненты PrimeVue: `Panel`, `Button`, `ProgressBar`, `ProgressSpinner`, `TabView`, `TabPanel`.
*   Директива `v-tooltip` используется для всплывающих подсказок.
*   Стилизация выполнена с помощью Tailwind CSS и кастомных scoped CSS для улучшения вида PrimeVue компонентов.
*   Присутствуют базовые анимации на кнопках.

**Важно по компонентам PrimeVue (`TabView`, `TabPanel`, `Tooltip`):**
*   Эти компоненты являются частью основного пакета `primevue`, который уже должен быть установлен (`"primevue": "^3.53.1"` в `package.json`).
*   Директива `v-tooltip` требует регистрации в `frontend/src/main.ts`:
    ```typescript
    // main.ts
    import Tooltip from 'primevue/tooltip';
    // ...
    app.directive('tooltip', Tooltip);
    ```
    Убедитесь, что эта регистрация присутствует.

**Изменения для Мульти-Бектестера (Портфельного Бектестера):**
*   **UI на `BacktesterView.vue`:**
    *   Будет добавлен переключатель "Портфельный бектест".
    *   При его активации:
        *   Поле выбора одного символа будет заменено/дополнено компонентом `MultiSelect` (PrimeVue) для выбора нескольких торговых пар.
        *   Поле "Начальный капитал" будет изменено на "Общий начальный капитал портфеля".
        *   Появится новое поле для ввода `maxConcurrentTradesPortfolio` (максимальное кол-во одновременных сделок в портфеле).
*   **Логика `backtestStore.ts`:**
    *   Будет расширен для обработки состояния и результатов портфельного бектеста (новый action `runPortfolioBacktest`, состояние для `portfolioResults`).
*   **Отображение результатов:**
    *   В `TabView` для результатов появится новая вкладка "Результаты Портфеля".
    *   На этой вкладке будут отображаться:
        *   Общие метрики портфеля (включая новые: Коэффициент Шарпа, среднее/пиковое кол-во одновременных сделок).
        *   График эквити всего портфеля.
        *   Таблица с детализацией метрик по каждой паре, участвовавшей в портфельном тесте.

**Дальнейшие шаги по развитию UI для `/backtester`:**
*   Заполнение `TabPanel` реальными компонентами для отображения результатов бектестинга (графики, таблицы и т.д.), включая специфичные для портфеля.
*   Интеграция с логикой бекенда для запуска, остановки и получения результатов одиночного и портфельного бектеста.

**Текущие проблемы и отладка:**
*   **Проблема (23.05.2025):** При запуске бэктеста для валютной пары, данные по свечам которой уже существуют в базе данных (т.е. бэктест выполняется немедленно, без постановки в очередь), результаты этого бэктеста не отображаются на странице `BacktesterView.vue` после его завершения. Фронтенд получает ответ `status: 200` от бэкенда, но UI не обновляется должным образом.
    *   **Действия по отладке:** В `frontend/src/views/BacktesterView.vue` в метод `startBacktest` добавлено расширенное логирование для отслеживания ответа от `backtestStore.runBacktest` и процесса присвоения результатов в `backtestStore.results` при получении статуса `200`. Цель - диагностировать, на каком этапе теряются или некорректно обрабатываются данные.

### Страница Настроек (`/settings`)
Страница `SettingsView.vue` предназначена для управления конфигурациями подключений к API бирж. 
Пользователь может добавлять новые подключения, редактировать существующие (API ключ, секрет, passphrase), выбирать активное подключение для использования приложением и удалять ненужные конфигурации. 
Параметры торговой стратегии на этой странице не настраиваются.

# Frontend Progress Update

## Completed Features ✅

### 1. Core Architecture ✅
- Vue 3 + TypeScript setup
- PrimeVue UI components integration  
- Responsive design with Tailwind CSS
- State management with Pinia

### 2. Strategy Settings Management ✅
- Complete strategy parameter forms
- DLC (Dollar Loss Control) configuration
- NWE (Net Worth Enhancement) settings
- ATR and volume parameters
- Risk management controls

### 3. Basic Backtester Interface ✅
- Single pair backtesting UI
- Parameter input forms (pair, timeframe, dates, capital)
- Real-time WebSocket integration
- Results display with metrics and trades table

### 4. **Portfolio Backtester UI** ✅ **UPDATED WITH DESIGN IMPROVEMENTS!**
- **Mode switcher** between single and portfolio backtesting
- **PortfolioSettingsForm component** for multi-pair selection
- **Portfolio parameters configuration** (capital, concurrent trades limit)
- **PortfolioResultsDisplay component** with:
  - Overall portfolio metrics dashboard
  - Per-pair performance breakdown
  - ~~Trade analysis across all pairs~~ **MOVED TO SEPARATE TAB!**
  - Visual progress indicators
- **WebSocket integration** for portfolio backtest notifications
- **Local storage** for portfolio parameters persistence
- **Design Unification** (Latest Update):
  - ✅ **Single Backtester Results Redesign** - Applied portfolio-style dashboard to single backtester
  - ✅ **Card-Based Metrics Display** - Primary metrics shown in colorful gradient cards
  - ✅ **Separated Trade Lists** - Portfolio trade list moved to dedicated "Список сделок" tab
  - ✅ **Optimized Table Columns** - Fixed width columns to eliminate horizontal scrollbars
  - ✅ **Improved Typography** - Better font sizes and spacing for table readability
  - ✅ **Consistent Empty States** - Unified empty state design across all tabs
  - ✅ **Responsive Design** - Tables adapt better to different screen sizes
  - ✅ **Compact Table Layout** - Optimized column widths and removed excess whitespace
  - ✅ **Direction Column Fix** - Shortened "LONG/SHORT" to "L/S" for better space utilization
  - ✅ **Win Rate Display Fix** - Fixed overflow issues in portfolio mode progress bars
  - ✅ **State Persistence Fix** - Results and parameters now persist when switching between modes
  - ✅ **Scrollbar Elimination** - Completely removed horizontal scrollbars from all tables
- **Critical Bug Fixes** (Previous Update):
  - ✅ **Fixed DataTable multisortField errors** - Changed sortMode from "multiple" to "single"
  - ✅ **Fixed vnode/parentNode errors** - Added component lifecycle tracking with `isComponentMounted` flag
  - ✅ **Safe Toast notifications** - Implemented `safeToast()` wrapper to prevent errors during navigation
  - ✅ **Data validation** - Added null checks and fallback values in all computed properties
  - ✅ **WebSocket memory leaks** - Proper cleanup with `removeEventListener` on component unmount
  - ✅ **State persistence** - Improved portfolio mode saving/restoring from localStorage

### 5. Data Management Interface ✅
- Trading pairs management
- Candlestick data operations
- Real-time data loading progress

### 6. Queue Management ✅  
- Background job monitoring
- Real-time job status updates
- Queue statistics and management

### 7. Settings Management ✅
- API connection configuration
- Strategy parameter persistence
- System preferences

## Technical Implementation ✅

### Components Architecture
```
src/
├── components/
│   ├── StrategySettingsForm.vue ✅
│   ├── PortfolioSettingsForm.vue ✅ NEW!
│   └── PortfolioResultsDisplay.vue ✅ NEW!
├── views/
│   ├── BacktesterView.vue ✅ (Updated with portfolio support)
│   ├── DataManagementView.vue ✅
│   ├── QueueManagerView.vue ✅
│   └── SettingsView.vue ✅
├── stores/
│   ├── backtestStore.ts ✅ (Updated with portfolio methods)
│   ├── settingsStore.ts ✅
│   └── dataStore.ts ✅
└── types/
    └── strategy.ts ✅ (Extended with portfolio types)
```

### New Portfolio Features

#### PortfolioSettingsForm.vue
- **Multi-select dropdown** for trading pairs selection
- **Portfolio capital input** with currency formatting
- **Maximum concurrent trades** configuration
- **Visual pair selection** with chips and removal functionality
- **Form validation** for minimum pair requirements

#### PortfolioResultsDisplay.vue  
- **Overall metrics dashboard** with colored performance indicators
- **Per-pair performance table** with sortable columns
- **Visual progress bars** for win rates and performance metrics
- **Trade distribution analysis** across portfolio pairs
- **Interactive data tables** with filtering and pagination

#### Enhanced BacktesterView.vue
- **Toggle switch** between single and portfolio modes
- **Dynamic form rendering** based on selected mode
- **Separate parameter management** for each mode
- **WebSocket handling** for both backtest types
- **Results routing** to appropriate display components

### WebSocket Integration ✅
- Real-time backtest progress updates
- Portfolio backtest completion notifications
- Error handling for failed portfolio operations
- Background job status monitoring

### State Management ✅
```typescript
// backtestStore.ts - Extended capabilities
interface BacktestState {
  isLoading: Ref<boolean>;
  results: Ref<BacktestResult | null>;
  portfolioResults: Ref<PortfolioBacktestResult | null>; // NEW!
  error: Ref<string | null>;
  isPortfolioMode: Ref<boolean>; // NEW!
}

// New methods:
- runPortfolioBacktest()
- clearResults()
- handlePortfolioWebSocketMessages()
```

### Type Safety ✅
```typescript
// Extended type definitions
interface PortfolioBacktestRunParameters {
  pairSymbols: string[];
  timeframe: string;
  startDate: string;
  endDate: string;
  initialPortfolioCapital: number;
  strategyParameters: StrategyParameters;
  portfolioSettings?: PortfolioSettings;
}

interface PortfolioBacktestResult {
  overallMetrics: PortfolioMetrics;
  tradesByPair: Record<string, Trade[]>;
  metricsByPair: Record<string, BacktestMetrics>;
  // ... additional portfolio-specific fields
}
```

## User Experience Features ✅

### Portfolio Backtesting Workflow
1. **Mode Selection**: Toggle switch for backtesting mode
2. **Pair Selection**: Multi-select dropdown with search functionality  
3. **Portfolio Configuration**: Capital and risk parameters
4. **Execution**: Real-time progress tracking via WebSocket
5. **Results Analysis**: Comprehensive portfolio performance dashboard

### Responsive Design ✅
- Mobile-friendly interface
- Adaptive layouts for different screen sizes
- Touch-friendly controls for mobile devices
- Progressive disclosure for complex forms

### Performance Optimizations ✅
- Lazy loading of heavy components
- Efficient state management
- Optimized re-rendering with proper Vue reactivity
- Local storage for parameter persistence

## Next Steps 🔄

### Charts and Visualizations
- [ ] Equity curve charts for portfolio performance
- [ ] Pair comparison charts
- [ ] Risk/return scatter plots
- [ ] Drawdown visualizations

### Advanced Portfolio Features  
- [ ] Portfolio composition pie charts
- [ ] Correlation analysis between pairs
- [ ] Risk metrics visualization
- [ ] Performance attribution analysis

### Enhanced User Experience
- [ ] Portfolio presets management
- [ ] Results export functionality  
- [ ] Advanced filtering and search
- [ ] Performance comparison tools

## Current Status: ~95% Complete

The frontend now provides a complete, production-ready interface for both single-pair and portfolio backtesting, with comprehensive results analysis and real-time progress tracking.

---

## 🎯 **ПЛАНИРУЕМЫЕ УЛУЧШЕНИЯ (ПРИОРИТЕТЫ 2025)**

### 🎲 **ПРИОРИТЕТ #1: Монте-Карло Анализ Interface**
**Цель**: Превратить интерфейс в профессиональную систему статистического анализа

#### **Monte Carlo Results Panel**
```vue
<template>
  <Panel header="🎲 Монте-Карло Анализ" class="mc-panel">
    <TabView>
      <TabPanel header="📊 Статистика">
        <div class="mc-statistics">
          <StatCard 
            title="Математическое ожидание"
            :value="mcResults.totalPnL.mean"
            :original="originalResult.totalPnL"
            format="currency"
          />
          <StatCard 
            title="Стандартное отклонение"  
            :value="mcResults.totalPnL.std"
            format="currency"
            severity="warning"
          />
          <StatCard
            title="Вероятность банкротства"
            :value="mcResults.probabilityOfRuin"
            format="percentage"
            severity="danger"
          />
        </div>
      </TabPanel>
      
      <TabPanel header="📈 Распределения">
        <HistogramChart 
          title="Распределение P&L" 
          :data="mcResults.distributions.pnl"
          :confidenceIntervals="[5, 95]"
        />
        <HistogramChart 
          title="Распределение просадок"
          :data="mcResults.distributions.drawdown"
        />
      </TabPanel>
      
      <TabPanel header="🎯 Риск-метрики">
        <div class="risk-dashboard">
          <RiskCard 
            title="Value at Risk (95%)"
            :value="riskMetrics.var95"
            severity="high"
          />
          <RiskCard 
            title="Expected Shortfall"
            :value="riskMetrics.expectedShortfall" 
            severity="critical"
          />
          <RiskCard 
            title="Коэффициент стабильности"
            :value="riskMetrics.consistencyRatio"
            severity="success"
          />
        </div>
      </TabPanel>
    </TabView>
  </Panel>
</template>
```

#### **Interactive Confidence Intervals**
- Доверительные полосы на кривой эквити
- Статистические границы для всех метрик  
- Интерактивные threshold настройки (90%, 95%, 99%)
- Comparison mode: оригинал vs симуляции

#### **Parameter Sensitivity Visualization**
- 3D heat maps чувствительности параметров
- Interactive sliders для real-time анализа
- Stability zones visualization
- Risk/return surface plots

### 🔍 **ПРИОРИТЕТ #2: Real-time Scanner Interface**

#### **Live Market Matrix**
```vue
<template>
  <div class="market-matrix">
    <DataTable 
      :value="scanResults" 
      :loading="isScanning"
      class="live-table"
      :refreshOnSort="false"
    >
      <Column field="symbol" header="Пара" :sortable="true" />
      <Column field="signalStrength" header="Сила Сигнала">
        <template #body="{ data }">
          <ProgressBar 
            :value="data.signalStrength * 100"
            :class="getSignalClass(data.signalStrength)"
          />
        </template>
      </Column>
      <Column field="direction" header="Направление">
        <template #body="{ data }">
          <Badge 
            :value="data.direction" 
            :severity="data.direction === 'LONG' ? 'success' : 'danger'"
          />
        </template>
      </Column>
    </DataTable>
  </div>
</template>
```

#### **Signal Strength Heatmap**
- Interactive heatmap всех пар
- Real-time updates через WebSocket
- Color-coded signal strength
- Click-to-analyze functionality

#### **Alert Management Panel**
- Smart alert configuration
- Historical alert performance
- ML-powered signal filtering
- Multi-channel notifications

### ⚙️ **ПРИОРИТЕТ #3: Advanced Optimization Interface (после MC)**

#### **Optimization Wizard**
```vue
<template>
  <Steps :model="optimizationSteps" />
  
  <div v-if="currentStep === 'monte-carlo'">
    <h3>Шаг 1: Проверка устойчивости (Монте-Карло)</h3>
    <p>Сначала проверим статистическую устойчивость текущих параметров</p>
    <MonteCarloSettings v-model="mcSettings" />
    <Button @click="runMonteCarloCheck">Проверить устойчивость</Button>
  </div>
  
  <div v-if="currentStep === 'optimization' && isStrategyStable">
    <h3>Шаг 2: Оптимизация параметров</h3>
    <p>Стратегия прошла проверку устойчивости. Можно оптимизировать.</p>
    <OptimizationSettings v-model="optSettings" />
    <Button @click="runOptimization">Запустить оптимизацию</Button>
  </div>
</template>
```

#### **Parameter Sensitivity Analysis**
- 3D visualization чувствительности
- Interactive parameter exploration
- Stability zones identification
- Risk/return trade-off analysis

#### **Multi-objective Optimization**
- Pareto frontier visualization  
- Trade-off analysis (прибыль vs риск vs стабильность)
- Custom objective function builder
- Solution ranking and selection

### 🤖 **БУДУЩЕЕ: AI/ML Integration Interface**
- **Prediction Models Dashboard**: Мониторинг LSTM моделей
- **Adaptive Strategy Monitor**: Отслеживание самообучающихся алгоритмов
- **Anomaly Detection Alerts**: Визуальные индикаторы аномалий
- **Sentiment Analysis Panel**: Real-time анализ новостей и соц. сетей

---

## 📋 **Frontend Development Roadmap**

### **Phase 1: Monte Carlo UI (Недели 1-2)**
- [ ] MonteCarloResultsPanel компонент
- [ ] RiskMetricsDashboard компонент  
- [ ] HistogramChart для распределений
- [ ] StatCard для сравнения метрик

### **Phase 2: Scanner UI (Недели 3-4)**
- [ ] LiveMarketMatrix компонент
- [ ] SignalStrengthHeatmap
- [ ] AlertManagementPanel
- [ ] WebSocket интеграция

### **Phase 3: Optimization UI (Недели 5-6)**
- [ ] OptimizationWizard компонент
- [ ] ParameterSensitivityPlots  
- [ ] MultiObjectiveVisualization
- [ ] OptimizationResults display

### **Phase 4: Polish & Testing (Неделя 7)**
- [ ] UI/UX тестирование
- [ ] Performance optimization
- [ ] Responsive design checks
- [ ] Documentation updates