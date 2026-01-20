ходимо<!--
ВАЖНОЕ АРХИТЕКТУРНОЕ ИЗМЕНЕНИЕ (Отражено в планах проекта promt.md, READMEF.md, docs/BACKTESTER_IMPLEMENTATION_PLAN.md):

Этот компонент (`BacktesterView.vue`) теперь несет основную ответственность за управление параметрами торговой стратегии.
Ранее предполагалось, что глобальные параметры стратегии будут настраиваться на отдельной странице "Настройки" (`SettingsView.vue`) 
и сохраняться через общий API настроек.

Теперь:
1. `BacktesterView.vue` содержит полный пользовательский интерфейс для ввода, изменения и отображения ВСЕХ параметров стратегии 
   (таких как параметры DLC, NWE, кластеров, управления рисками, глобальные параметры ATR, период среднего объема и т.д.).
2. Эти параметры используются непосредственно для запуска бектестов с этой страницы.
3. Если требуется сохранение и загрузка наборов (пресетов) параметров стратегии, эта логика также будет управляться 
   из `BacktesterView.vue` (возможно, с использованием `settingsStore.ts` в новом контексте и соответствующего API на бэкенде, 
   специализированного для пресетов стратегий, а не глобальных настроек).
4. Страница `SettingsView.vue` теперь отвечает ИСКЛЮЧИТЕЛЬНО за управление подключениями к API бирж.

Влияние на Backend:
- Бэкенд API, ранее отвечавший за сохранение глобальных `strategyParameters` (например, через `SettingsController` и модель `Setting`), 
  должен быть адаптирован. Он теперь в первую очередь будет обрабатывать настройки подключений к биржам.
- Если будет реализована функция сохранения пресетов параметров стратегии, для этого потребуется отдельный API endpoint на бэкенде, 
  вызываемый со страницы `BacktesterView.vue`.

ДОБАВЛЕНО: Поддержка Мульти-Бектестера (Портфельного Бектестера)
-->
<template>
  <div class="p-4 surface-ground min-h-screen">
    <div class="flex justify-between items-center mb-8">
      <h1 class="text-4xl font-bold text-gray-900">Backtester</h1>
      <!-- Переключатель диагностики удален -->
    </div>

    <!-- Переключатель режимов бектестера -->
    <div class="mb-6 bg-white rounded-lg shadow p-4">
      <div class="flex items-center justify-between">
        <div class="flex items-center space-x-4">
          <h2 class="text-lg font-semibold text-gray-800">Режим бектестера</h2>
          <div class="flex items-center space-x-3">
            <span class="text-sm" :class="!backtestStore.isPortfolioMode ? 'font-semibold text-blue-600' : 'text-gray-600'">
              Одиночный
            </span>
            <ToggleSwitch 
              v-model="backtestStore.isPortfolioMode" 
              @change="onModeChange"
            />
            <span class="text-sm" :class="backtestStore.isPortfolioMode ? 'font-semibold text-blue-600' : 'text-gray-600'">
              Портфельный
            </span>
          </div>
        </div>
        <div class="text-sm text-gray-500">
          <i class="pi pi-info-circle mr-1"></i>
          {{ backtestStore.isPortfolioMode ? 'Тестирование на нескольких парах с общим капиталом' : 'Тестирование на одной торговой паре' }}
        </div>
      </div>
    </div>

    <!-- НОВОЕ: Выбор биржи -->
    <div class="mb-6 bg-white rounded-lg shadow p-4">
      <div class="flex items-center justify-between">
        <div class="flex items-center space-x-4">
          <h2 class="text-lg font-semibold text-gray-800">
            <i class="pi pi-building mr-2"></i>
            Биржа для бектеста
          </h2>
          <div class="flex items-center space-x-3">
            <div class="flex align-items-center">
              <RadioButton v-model="selectedExchange" inputId="okx" name="exchange" value="okx" />
              <label for="okx" class="ml-2 cursor-pointer text-sm">OKX (30 req/s, 300 candles/req)</label>
            </div>
            <div class="flex align-items-center">
              <RadioButton v-model="selectedExchange" inputId="bybit" name="exchange" value="bybit" />
              <label for="bybit" class="ml-2 cursor-pointer text-sm">Bybit (120 req/s, 1000 candles/req) ⚡</label>
            </div>
          </div>
        </div>
        <div class="text-sm text-gray-500">
          <i class="pi pi-info-circle mr-1"></i>
          <span v-if="settingsStore.filteredTradingPairs.length > 0">
            Найдено: {{ settingsStore.filteredTradingPairs.length }} из {{ settingsStore.availableTradingPairs.length }} пар
          </span>
          <span v-else>
            {{ settingsStore.availableTradingPairs.length }} пар доступно
          </span>
        </div>
      </div>
      <div class="mt-2 text-xs text-gray-600">
        <strong>Производительность:</strong> Bybit примерно в 13 раз быстрее благодаря высоким лимитам API и большему размеру пакетов
      </div>
    </div>

    <!-- НОВОЕ: Выбор ускорения (CPU/GPU) -->
    <div class="mb-6 bg-white rounded-lg shadow p-4">
      <div class="flex items-center justify-between">
        <div class="flex items-center space-x-4">
          <h2 class="text-lg font-semibold text-gray-800">
            <i class="pi pi-bolt mr-2"></i>
            Ускорение вычислений
          </h2>
          <div class="flex items-center space-x-3">
            <span class="text-sm" :class="!useGPU ? 'font-semibold text-blue-600' : 'text-gray-600'">
              CPU
            </span>
            <ToggleSwitch 
              v-model="useGPU" 
              @change="onGPUModeChange"
              :disabled="!gpuAvailable"
            />
            <span class="text-sm" :class="useGPU ? 'font-semibold text-green-600' : 'text-gray-600'">
              GPU ⚡
            </span>
          </div>
        </div>
        <div class="text-sm text-gray-500">
          <i class="pi pi-info-circle mr-1"></i>
          {{ useGPU ? `GPU-ускоренные вычисления (RTX 4060) • Статус: ${gpuStatus}` : 'Стандартные CPU вычисления' }}
        </div>
      </div>
      <div class="mt-2 text-xs text-gray-600">
        <strong>GPU режим:</strong> 
        <span v-if="useGPU" class="text-green-600">
          ⚡ 7 GPU-ускоренных индикаторов, 4 стратегии, массовый бэктест и оптимизация параметров
        </span>
        <span v-else class="text-gray-600">
          🖥️ Классические CPU вычисления с полной совместимостью
        </span>
      </div>
      <div v-if="useGPU" class="mt-2 flex items-center justify-between text-xs text-green-700 bg-green-50 rounded px-2 py-1">
        <div class="flex items-center">
          <i class="pi pi-check-circle mr-1"></i>
          GPU-сервис доступен на порту 6000 • CuPy/CUDA ускорение • Производственная готовность
        </div>
        <Button 
          icon="pi pi-refresh" 
          size="small" 
          text 
          @click="checkGPUStatus"
          v-tooltip.bottom="'Проверить статус GPU'"
          class="p-button-sm"
        />
      </div>
      <div v-else-if="!gpuAvailable" class="mt-2 flex items-center justify-between text-xs text-orange-700 bg-orange-50 rounded px-2 py-1">
        <div class="flex items-center">
          <i class="pi pi-exclamation-triangle mr-1"></i>
          GPU сервис недоступен. Используется CPU режим.
        </div>
        <Button 
          icon="pi pi-refresh" 
          size="small" 
          text 
          @click="checkGPUStatus"
          v-tooltip.bottom="'Повторить проверку GPU'"
          class="p-button-sm"
        />
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <!-- Панель конфигурации стратегии -->
      <div class="lg:col-span-1">
        <Panel header="Настройки стратегии" toggleable>
          <template #icons>
            <button v-tooltip.bottom="'Свернуть/Развернуть'" class="p-panel-header-icon p-link mr-2" @click="toggleSettingsPanel">
              <span class="pi pi-cog text-lg"></span>
            </button>
          </template>
          <div v-if="localStrategyParams" class="py-2 px-1">
            <StrategySettingsForm v-model="localStrategyParams" />
          </div>
          <div v-else class="flex justify-center items-center" style="min-height: 200px;">
            <ProgressSpinner animationDuration=".8s" strokeWidth="4"/>
          </div>
        </Panel>
      </div>

      <!-- Основная панель для управления и результатов -->
      <div class="lg:col-span-2">
        <Panel header="Управление и Результаты" toggleable>
          <template #icons>
            <button v-tooltip.bottom="'Свернуть/Развернуть'" class="p-panel-header-icon p-link mr-2" @click="toggleResultsPanel">
              <span class="pi pi-chart-line text-lg"></span>
            </button>
          </template>
          
          <!-- Параметры запуска для одиночного бектеста -->
          <div v-if="!backtestStore.isPortfolioMode" class="mb-6">
            <h2 class="text-xl font-semibold mb-4 text-gray-800 border-b pb-2">Параметры Запуска</h2>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 mb-6">
              <div>
                <label for="pairSymbol" class="block text-sm font-medium text-gray-700 mb-1">Символ Пары</label>
                <Select
                  id="pairSymbol"
                  v-model="pairSymbol"
                  :options="tradingPairOptions"
                  option-label="label"
                  option-value="value"
                  placeholder="Выберите символ"
                  filter
                  filterPlaceholder="Поиск символа"
                  :virtualScrollerOptions="{ itemSize: 38 }"
                  :loading="settingsStore.isLoading"
                  class="w-full"
                  show-clear
                  @filter="optimizedFilter"
                />
              </div>
              <div>
                <label for="timeframe" class="block text-sm font-medium text-gray-700 mb-1">Таймфрейм</label>
                <Select id="timeframe" v-model="timeframe" :options="timeframes" option-label="label" option-value="value" placeholder="Выберите таймфрейм" class="w-full" />
              </div>
              <div>
                <label for="startDate" class="block text-sm font-medium text-gray-700 mb-1">Дата Начала</label>
                <DatePicker id="startDate" v-model="startDate" showIcon dateFormat="dd.mm.yy" placeholder="ДД.ММ.ГГГГ" class="w-full" />
              </div>
              <div>
                <label for="endDate" class="block text-sm font-medium text-gray-700 mb-1">Дата Окончания</label>
                <DatePicker id="endDate" v-model="endDate" showIcon dateFormat="dd.mm.yy" placeholder="ДД.ММ.ГГГГ" class="w-full" />
              </div>
              <div class="md:col-span-2">
                <label for="initialCapital" class="block text-sm font-medium text-gray-700 mb-1">Начальный Капитал ($)</label>
                <InputNumber id="initialCapital" v-model="initialCapital" mode="currency" currency="USD" locale="en-US" :minFractionDigits="0" :maxFractionDigits="2" placeholder="Введите сумму" class="w-full" />
              </div>
            </div>

            <div class="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-6">
              <div class="flex items-start justify-between mb-3 flex-col md:flex-row md:items-center">
                <h3 class="text-lg font-semibold text-gray-800 flex items-center gap-2">
                  <i class="pi pi-sliders-h text-sm text-blue-500"></i>
                  Имитация исполнения
                </h3>
                <div class="flex flex-col md:flex-row md:items-center gap-3 text-sm text-gray-500">
                  <div class="flex items-center gap-2">
                    <Checkbox v-model="useExecutionProfile" :binary="true" inputId="useExecutionProfile" />
                    <label for="useExecutionProfile" class="cursor-pointer">Учитывать комиссии, проскальзывание и маржу</label>
                  </div>
                  <div class="flex items-center gap-2" :class="!useExecutionProfile ? 'text-gray-400' : ''">
                    <Checkbox v-model="simulateConfirmation" :binary="true" inputId="simulateConfirmation" :disabled="!useExecutionProfile" />
                    <label for="simulateConfirmation" class="cursor-pointer">Подтверждение сигналов (как у сканнера)</label>
                  </div>
                </div>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-3 gap-4" :class="!useExecutionProfile ? 'opacity-50 pointer-events-none select-none' : ''">
                <div>
                  <label class="block text-xs font-medium text-gray-600 mb-1" for="execFee">
                    Комиссия за сделку (мейкер/тейкер)
                  </label>
                  <InputNumber
                    id="execFee"
                    v-model.number="executionProfile.tradingFeeRate"
                    mode="decimal"
                    :min="0"
                    :max="0.01"
                    :step="0.0001"
                    :minFractionDigits="4"
                    :maxFractionDigits="4"
                    suffix=""
                    class="w-full"
                  />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-600 mb-1" for="execSlippage">
                    Проскальзывание, bps
                  </label>
                  <InputNumber
                    id="execSlippage"
                    v-model.number="executionProfile.slippageBps"
                    :min="0"
                    :max="200"
                    :step="1"
                    class="w-full"
                  />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-600 mb-1" for="execLeverage">
                    Плечо (leverage)
                  </label>
                  <InputNumber
                    id="execLeverage"
                    v-model.number="executionProfile.leverage"
                    :min="1"
                    :max="100"
                    :step="1"
                    class="w-full"
                  />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-600 mb-1" for="execConfirmWindow">
                    Окно подтверждения (свечи)
                  </label>
                  <InputNumber
                    id="execConfirmWindow"
                    v-model.number="executionProfile.confirmWindowSize"
                    :min="1"
                    :max="10"
                    :step="1"
                    class="w-full"
                  />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-600 mb-1" for="execConfirmAttempts">
                    Попытки подтверждения
                  </label>
                  <InputNumber
                    id="execConfirmAttempts"
                    v-model.number="executionProfile.maxConfirmationAttempts"
                    :min="1"
                    :max="10"
                    :step="1"
                    class="w-full"
                  />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-600 mb-1" for="execFundingBuffer">
                    Буфер по фандингу
                  </label>
                  <InputNumber
                    id="execFundingBuffer"
                    v-model.number="executionProfile.fundingRateBuffer"
                    mode="decimal"
                    :min="0"
                    :max="0.01"
                    :step="0.0001"
                    :minFractionDigits="4"
                    :maxFractionDigits="4"
                    class="w-full"
                  />
                </div>
              </div>

              <p class="mt-3 text-xs text-gray-500 flex items-center gap-2">
                <i class="pi pi-info-circle text-blue-500"></i>
                Включите переключатель, чтобы симулировать реальные условия исполнения (комиссии, проскальзывание, плечо). При выключенном режиме выполняется идеальный тест.
              </p>
            </div>
          </div>

          <!-- Параметры запуска для портфельного бектеста -->
          <div v-else class="mb-6">
            <h2 class="text-xl font-semibold mb-4 text-gray-800 border-b pb-2">Параметры Портфельного Бектеста</h2>
            <div class="space-y-6">
              <PortfolioSettingsForm
                v-model="portfolioParams"
                :tradingPairOptions="tradingPairOptions"
                :isLoadingPairs="settingsStore.isLoading"
              />
              
              <!-- Общие параметры для портфеля -->
              <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                <div>
                  <label for="portfolioTimeframe" class="block text-sm font-medium text-gray-700 mb-1">Таймфрейм</label>
                  <Select id="portfolioTimeframe" v-model="portfolioTimeframe" :options="timeframes" option-label="label" option-value="value" placeholder="Выберите таймфрейм" class="w-full" />
                </div>
                <div></div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">Дата Начала</label>
                  <DatePicker id="portfolioStartDate" v-model="portfolioStartDate" showIcon dateFormat="dd.mm.yy" placeholder="ДД.ММ.ГГГГ" class="w-full" />
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">Дата Окончания</label>
                  <DatePicker id="portfolioEndDate" v-model="portfolioEndDate" showIcon dateFormat="dd.mm.yy" placeholder="ДД.ММ.ГГГГ" class="w-full" />
                </div>
              </div>
            </div>

            <div class="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-6">
              <div class="flex items-start justify-between mb-3 flex-col md:flex-row md:items-center">
                <h3 class="text-lg font-semibold text-gray-800 flex items-center gap-2">
                  <i class="pi pi-sliders-h text-sm text-blue-500"></i>
                  Имитация исполнения
                </h3>
                <div class="flex flex-col md:flex-row md:items-center gap-3 text-sm text-gray-500">
                  <div class="flex items-center gap-2">
                    <Checkbox v-model="portfolioUseExecutionProfile" :binary="true" inputId="portfolioUseExecutionProfile" />
                    <label for="portfolioUseExecutionProfile" class="cursor-pointer">Учитывать комиссии, проскальзывание и маржу</label>
                  </div>
                  <div class="flex items-center gap-2" :class="!portfolioUseExecutionProfile ? 'text-gray-400' : ''">
                    <Checkbox v-model="portfolioSimulateConfirmation" :binary="true" inputId="portfolioSimulateConfirmation" :disabled="!portfolioUseExecutionProfile" />
                    <label for="portfolioSimulateConfirmation" class="cursor-pointer">Подтверждение сигналов (как у сканнера)</label>
                  </div>
                </div>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-3 gap-4" :class="!portfolioUseExecutionProfile ? 'opacity-50 pointer-events-none select-none' : ''">
                <div>
                  <label class="block text-xs font-medium text-gray-600 mb-1" for="portfolioFee">Комиссия за сделку (мейкер/тейкер)</label>
                  <InputNumber id="portfolioFee" v-model.number="portfolioExecutionProfile.tradingFeeRate" mode="decimal" :min="0" :max="0.01" :step="0.0001" :minFractionDigits="4" :maxFractionDigits="4" class="w-full" />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-600 mb-1" for="portfolioSlippage">Проскальзывание, bps</label>
                  <InputNumber id="portfolioSlippage" v-model.number="portfolioExecutionProfile.slippageBps" :min="0" :max="200" :step="1" class="w-full" />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-600 mb-1" for="portfolioLeverage">Плечо (leverage)</label>
                  <InputNumber id="portfolioLeverage" v-model.number="portfolioExecutionProfile.leverage" :min="1" :max="100" :step="1" class="w-full" />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-600 mb-1" for="portfolioConfirmWindow">Окно подтверждения (свечи)</label>
                  <InputNumber id="portfolioConfirmWindow" v-model.number="portfolioExecutionProfile.confirmWindowSize" :min="1" :max="10" :step="1" class="w-full" />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-600 mb-1" for="portfolioConfirmAttempts">Попытки подтверждения</label>
                  <InputNumber id="portfolioConfirmAttempts" v-model.number="portfolioExecutionProfile.maxConfirmationAttempts" :min="1" :max="10" :step="1" class="w-full" />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-600 mb-1" for="portfolioFundingBuffer">Буфер по фандингу</label>
                  <InputNumber id="portfolioFundingBuffer" v-model.number="portfolioExecutionProfile.fundingRateBuffer" mode="decimal" :min="0" :max="0.01" :step="0.0001" :minFractionDigits="4" :maxFractionDigits="4" class="w-full" />
                </div>
              </div>

              <p class="mt-3 text-xs text-gray-500 flex items-center gap-2">
                <i class="pi pi-info-circle text-blue-500"></i>
                Включите переключатель, чтобы симулировать реальные условия исполнения портфельного бэктеста. При выключенном режиме тест выполняется без комиссий и задержек.
              </p>
            </div>
          </div>

          <!-- Управление бектестом -->
          <div class="mb-6">
            <h2 class="text-xl font-semibold mb-4 text-gray-800 border-b pb-2">Управление Бектестом</h2>
            
            <!-- Индикатор восстановленного состояния и статуса задач -->
            <div v-if="pendingJobId && backtestIsLoading" class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
              <div class="flex items-center">
                <i class="pi pi-sync spin text-blue-600 mr-2"></i>
                <div>
                  <h4 class="text-sm font-medium text-blue-800 mb-1">
                    {{ currentJobStatus === 'waiting' || currentJobStatus === 'wait' ? 'Задача в очереди' : 'Активный бектест' }}
                  </h4>
                  <p class="text-sm text-blue-700">
                    ID задачи: <span class="font-mono">{{ pendingJobId }}</span>
                  </p>
                  <p class="text-xs text-blue-600 mt-1" v-if="currentJobStatus">
                    Статус: <span class="font-semibold">{{ getJobStatusText(currentJobStatus) }}</span>
                  </p>
                  <p class="text-xs text-blue-600 mt-1" v-if="currentJobStatus === 'waiting' || currentJobStatus === 'wait'">
                    ⏳ Задача ожидает обработки в очереди...
                  </p>
                  <p class="text-xs text-blue-600 mt-1" v-else-if="currentJobStatus === 'active'">
                    🔄 Задача выполняется...
                  </p>
                  <p class="text-xs text-blue-600 mt-1" v-else>
                    Состояние восстановлено. Ожидание результатов...
                  </p>
                </div>
              </div>
            </div>
            
            <div class="flex items-center space-x-3">
              <Button 
                :label="backtestStore.isPortfolioMode ? 'Запустить Портфельный Бектест' : 'Старт'" 
                icon="pi pi-play" 
                class="p-button-success" 
                @click="startBacktest" 
                :disabled="!localStrategyParams || backtestIsLoading"
                v-tooltip.bottom="backtestStore.isPortfolioMode ? 'Запустить портфельный бектест' : 'Запустить обычный бектест'"
              />
              <Button 
                label="Стоп" 
                icon="pi pi-stop" 
                class="p-button-danger" 
                @click="stopBacktest" 
                :disabled="!backtestIsLoading"
                v-tooltip.bottom="'Остановить текущий бектест'"
              />
              <Button 
                label="Сброс настроек" 
                icon="pi pi-refresh" 
                class="p-button-warning" 
                @click="resetBacktestSettings" 
                :disabled="backtestIsLoading"
                v-tooltip.bottom="'Сбросить параметры стратегии к значениям по умолчанию'"
              />
              <Button 
                label="Очистить кеш результатов" 
                icon="pi pi-trash" 
                class="p-button-secondary" 
                @click="clearResultsCache" 
                :disabled="backtestIsLoading"
                v-tooltip.bottom="'Очистить сохраненные результаты и запустить свежий бектест'"
              />
              <Button 
                label="Проверить активные задачи" 
                icon="pi pi-search" 
                class="p-button-info" 
                @click="manualCheckActiveJobs" 
                :disabled="backtestIsLoading"
                v-tooltip.bottom="'Проверить активные задачи на сервере и восстановить состояние'"
              />
            </div>
            <!-- Современный прогресс-бар для портфельного бэктеста -->
            <ModernPortfolioProgress
              v-if="backtestIsLoading && backtestStore.isPortfolioMode"
              :title="`Портфельный бэктест`"
              :isActive="true"
              :isCompleted="false"
              :currentStage="progressData.stage || 'Выполнение'"
              :currentStageDescription="progressData.stageDescription || 'Обработка данных...'"
              :processedItems="progressData.processedItems || 0"
              :totalItems="progressData.totalItems || 100"
              :startTime="progressData.startTime || Date.now()"
              :currentPairs="progressData.currentPairs || []"
              :loadingQueue="progressData.loadingQueue"
              :portfolioStats="progressData.portfolioStats"
              :gpuStats="progressData.gpuStats"
              :activityLog="progressData.activityLog || []"
              class="mt-5"
            />
            
            <!-- Стандартный прогресс-бар для обычного бэктеста -->
            <AdvancedProgressBar
              v-if="backtestIsLoading && !backtestStore.isPortfolioMode"
              :title="`Выполняется обычный бэктест`"
              :isActive="true"
              :isCompleted="false"
              :currentStage="progressData.stage || 'Выполнение'"
              :currentStageDescription="progressData.stageDescription || 'Обработка данных...'"
              :processedItems="progressData.processedItems || 0"
              :totalItems="progressData.totalItems || 100"
              :startTime="progressData.startTime || Date.now()"
              :stageBreakdown="progressData.stageBreakdown || []"
              :portfolioStats="progressData.portfolioStats"
              :gpuStats="progressData.gpuStats"
              :showActivityLog="true"
              :activityLog="progressData.activityLog || []"
              class="mt-5"
            />
          </div>

          <!-- Результаты -->
          <div>
            <h2 class="text-xl font-semibold mb-4 text-gray-800 border-b pb-2">Результаты</h2>
            <Message v-if="backtestError" severity="error" :closable="false">{{ backtestError }}</Message>
            
            <TabView class="mt-2">
              <!-- Результаты обычного бектеста -->
              <TabPanel v-if="!backtestStore.isPortfolioMode" header="Сводка" value="summary">
                <div v-if="backtestResultsStore?.metrics" class="space-y-6">
                  <!-- Основные метрики в карточках -->
                  <div class="bg-white rounded-lg shadow p-6">
                    <h3 class="text-xl font-semibold text-gray-900 mb-4 flex items-center">
                      <i class="pi pi-chart-line mr-2 text-blue-600"></i>
                      Основные результаты
                    </h3>
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                      <div class="bg-gradient-to-r from-green-50 to-green-100 p-4 rounded-lg">
                        <div class="text-sm text-green-600 font-medium">Total PnL</div>
                        <div class="text-2xl font-bold" :class="(backtestResultsStore.metrics.totalPnl || 0) >= 0 ? 'text-green-700' : 'text-red-700'">
                          ${{ formatMetric('totalPnl', backtestResultsStore.metrics.totalPnl) }}
                </div>
                      </div>
                      <div class="bg-gradient-to-r from-blue-50 to-blue-100 p-4 rounded-lg">
                        <div class="text-sm text-blue-600 font-medium">Всего сделок</div>
                        <div class="text-2xl font-bold text-blue-700">
                          {{ backtestResultsStore.metrics.totalTrades || 0 }}
                        </div>
                      </div>
                      <div class="bg-gradient-to-r from-purple-50 to-purple-100 p-4 rounded-lg">
                        <div class="text-sm text-purple-600 font-medium">Винрейт</div>
                        <div class="text-2xl font-bold text-purple-700">
                          {{ formatMetric('winRate', backtestResultsStore.metrics.winRate) }}
                        </div>
                      </div>
                      <div class="bg-gradient-to-r from-orange-50 to-orange-100 p-4 rounded-lg">
                        <div class="text-sm text-orange-600 font-medium">Profit Factor</div>
                        <div class="text-2xl font-bold text-orange-700">
                          {{ formatMetric('profitFactor', backtestResultsStore.metrics.profitFactor) }}
                        </div>
                      </div>
                    </div>
                    
                    <div class="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div class="bg-gray-50 p-4 rounded-lg">
                        <div class="text-sm text-gray-600">Начальный капитал</div>
                        <div class="text-lg font-semibold text-gray-800">
                          ${{ formatMetric('initialCapital', backtestResultsStore.metrics.initialCapital) }}
                        </div>
                      </div>
                      <div class="bg-gray-50 p-4 rounded-lg">
                        <div class="text-sm text-gray-600">Финальный капитал</div>
                        <div class="text-lg font-semibold text-gray-800">
                          ${{ formatMetric('finalCapital', backtestResultsStore.metrics.finalCapital) }}
                        </div>
                      </div>
                      <div class="bg-gray-50 p-4 rounded-lg">
                        <div class="text-sm text-gray-600">Max Drawdown</div>
                        <div class="text-lg font-semibold text-red-600">
                          {{ formatMetric('maxDrawdown', backtestResultsStore.metrics.maxDrawdown) }}
                        </div>
                      </div>
                    </div>

                    <div class="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div class="bg-indigo-50 p-4 rounded-lg">
                        <div class="text-sm text-indigo-600">Прибыльные сделки</div>
                        <div class="text-lg font-semibold text-indigo-700">
                          {{ backtestResultsStore.metrics.winningTrades || 0 }}
                        </div>
                      </div>
                      <div class="bg-indigo-50 p-4 rounded-lg">
                        <div class="text-sm text-indigo-600">Убыточные сделки</div>
                        <div class="text-lg font-semibold text-indigo-700">
                          {{ backtestResultsStore.metrics.losingTrades || 0 }}
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- Дополнительные метрики -->
                  <div class="bg-white rounded-lg shadow p-6">
                    <h3 class="text-xl font-semibold text-gray-900 mb-4 flex items-center">
                      <i class="pi pi-calculator mr-2 text-green-600"></i>
                      Детальные метрики
                    </h3>
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      <div v-for="(value, key) in getAdditionalMetrics(backtestResultsStore.metrics)" :key="key" class="bg-gray-50 p-3 rounded-lg">
                        <div class="text-sm text-gray-600">{{ getDisplayKey(key) }}</div>
                        <div class="text-lg font-semibold text-gray-800">{{ formatMetric(key, value) }}</div>
                      </div>
                    </div>
                  </div>
                </div>
                <div v-else class="text-center py-12">
                  <i class="pi pi-chart-line text-6xl text-gray-300 mb-4"></i>
                  <h3 class="text-xl text-gray-500 mb-2">Результаты бектестинга</h3>
                  <p class="text-gray-400">Запустите бектест для просмотра результатов</p>
                </div>
              </TabPanel>
              
              <!-- Результаты портфельного бектеста -->
              <TabPanel v-if="backtestStore.isPortfolioMode" header="Результаты Портфеля" value="portfolio-results">
                <PortfolioResultsDisplay :portfolioResults="portfolioResultsStore" />
              </TabPanel>

              <!-- Список сделок для обычного бектеста -->
              <TabPanel v-if="!backtestStore.isPortfolioMode" header="Список сделок" value="trades-single">
                <div v-if="backtestResultsStore?.trades && backtestResultsStore.trades.length > 0" class="bg-white rounded-lg shadow p-6">
                  <h3 class="text-xl font-semibold text-gray-900 mb-4 flex items-center">
                    <i class="pi pi-history mr-2 text-purple-600"></i>
                    Все сделки
                  </h3>
                  <DataTable 
                    :value="backtestResultsStore.trades" 
                    responsiveLayout="scroll" 
                    :paginator="true"
                    :rows="500"
                    :rowsPerPageOptions="[100, 250, 500, 1000, 2000, 5000]"
                    currentPageReportTemplate="Показано с {first} по {last} из {totalRecords} сделок"
                    stripedRows
                    sortMode="single"
                    sortField="entryTimestamp"
                    :sortOrder="-1"
                    :emptyMessage="'Нет сделок для отображения'"
                    :scrollable="false"
                    class="compact-table clickable-trades"
                    @rowClick="onTradeClick"
                  >
                    <Column field="id" header="ID" :sortable="true" style="width: 70px; max-width: 70px;">
                      <template #body="slotProps">
                        <span :title="slotProps.data.id" class="text-xs font-mono">{{ slotProps.data.id.substring(0, 6) }}...</span>
                      </template>
                    </Column>
                    <Column field="pair" header="Пара" :sortable="true" style="width: 90px; max-width: 90px;">
                      <template #body="slotProps">
                        <span class="text-sm font-medium">{{ slotProps.data.pair }}</span>
                      </template>
                    </Column>
                    <Column field="direction" header="Направление" :sortable="true" style="width: 75px; max-width: 75px;">
                      <template #body="slotProps">
                        <span :class="{'text-green-600 font-semibold': slotProps.data.direction === 'long', 'text-red-600 font-semibold': slotProps.data.direction === 'short'}" class="text-xs">
                          {{ slotProps.data.direction === 'long' ? 'LONG' : 'SHORT' }}
                        </span>
                      </template>
                    </Column>
                    <Column field="entryTimestamp" header="Время входа" :sortable="true" style="width: 120px; max-width: 120px;">
                      <template #body="slotProps">
                        <span class="text-xs">{{ formatDate(slotProps.data.entryTimestamp) }}</span>
                      </template>
                    </Column>
                    <Column field="entryPrice" header="Цена входа" :sortable="true" style="width: 85px; max-width: 85px;">
                        <template #body="slotProps">
                        <span class="text-sm">{{ slotProps.data.entryPrice?.toFixed(4) }}</span>
                        </template>
                    </Column>
                    <Column field="exitPrice" header="Цена выхода" :sortable="true" style="width: 85px; max-width: 85px;">
                      <template #body="slotProps">
                        <span class="text-sm">{{ slotProps.data.exitPrice?.toFixed(4) || '-' }}</span>
                      </template>
                    </Column>
                    <Column field="size" header="Размер" :sortable="true" style="width: 70px; max-width: 70px;">
                      <template #body="slotProps">
                        <span class="text-sm">{{ slotProps.data.size?.toFixed(2) }}</span>
                      </template>
                    </Column>
                    <Column field="pnl" header="PnL ($)" :sortable="true" style="width: 75px; max-width: 75px;">
                      <template #body="slotProps">
                        <span :class="(slotProps.data.pnl || 0) >= 0 ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'" class="text-sm">
                          ${{ (slotProps.data.pnl || 0).toFixed(2) }}
                        </span>
                      </template>
                    </Column>
                    <Column field="exitReason" header="Причина выхода" :sortable="true" style="width: 85px; max-width: 85px;">
                        <template #body="slotProps">
                        <span class="text-xs">{{ slotProps.data.exitReason || '-' }}</span>
                      </template>
                    </Column>
                  </DataTable>
                </div>
                <div v-else class="text-center py-12">
                  <i class="pi pi-list text-6xl text-gray-300 mb-4"></i>
                  <h3 class="text-xl text-gray-500 mb-2">Список сделок</h3>
                  <p class="text-gray-400">Список сделок будет доступен здесь после выполнения бектеста</p>
                </div>
              </TabPanel>
              
              <!-- Список сделок для портфельного бектеста -->
              <TabPanel v-if="backtestStore.isPortfolioMode" header="Список сделок" value="trades-portfolio">
                <div v-if="portfolioResultsStore && getAllPortfolioTrades().length > 0" class="bg-white rounded-lg shadow p-6">
                  <h3 class="text-xl font-semibold text-gray-900 mb-4 flex items-center">
                    <i class="pi pi-history mr-2 text-purple-600"></i>
                    Все сделки портфеля
                  </h3>
                  <DataTable 
                    :value="getAllPortfolioTrades()" 
                    responsiveLayout="scroll" 
                    :paginator="true"
                    :rows="500"
                    :rowsPerPageOptions="[100, 250, 500, 1000, 2000, 5000]"
                    currentPageReportTemplate="Показано с {first} по {last} из {totalRecords} сделок"
                    stripedRows
                    sortMode="single"
                    sortField="entryTimestamp"
                    :sortOrder="-1"
                    :emptyMessage="'Нет сделок для отображения'"
                    :scrollable="false"
                    class="compact-table clickable-trades"
                    @rowClick="onTradeClick"
                  >
                    <Column field="pair" header="Пара" :sortable="true" style="width: 90px; max-width: 90px;">
                      <template #body="slotProps">
                        <Badge :value="slotProps.data.pair" severity="success" />
                      </template>
                    </Column>
                    <Column field="direction" header="Направление" :sortable="true" style="width: 75px; max-width: 75px;">
                      <template #body="slotProps">
                        <span :class="slotProps.data.direction === 'long' ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'" class="text-xs">
                          {{ slotProps.data.direction === 'long' ? 'LONG' : 'SHORT' }}
                            </span>
                        </template>
                    </Column>
                    <Column field="entryTimestamp" header="Время входа" :sortable="true" style="width: 120px; max-width: 120px;">
                        <template #body="slotProps">
                        <span class="text-xs">{{ formatDate(slotProps.data.entryTimestamp) }}</span>
                        </template>
                    </Column>
                    <Column field="entryPrice" header="Цена входа" :sortable="true" style="width: 85px; max-width: 85px;">
                        <template #body="slotProps">
                        <span class="text-sm">{{ slotProps.data.entryPrice?.toFixed(4) }}</span>
                      </template>
                    </Column>
                    <Column field="exitPrice" header="Цена выхода" :sortable="true" style="width: 85px; max-width: 85px;">
                      <template #body="slotProps">
                        <span class="text-sm">{{ slotProps.data.exitPrice?.toFixed(4) || '-' }}</span>
                      </template>
                    </Column>
                    <Column field="size" header="Размер" :sortable="true" style="width: 70px; max-width: 70px;">
                      <template #body="slotProps">
                        <span class="text-sm">{{ slotProps.data.size?.toFixed(2) }}</span>
                      </template>
                    </Column>
                    <Column field="pnl" header="PnL ($)" :sortable="true" style="width: 75px; max-width: 75px;">
                      <template #body="slotProps">
                        <span :class="(slotProps.data.pnl || 0) >= 0 ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'" class="text-sm">
                          ${{ (slotProps.data.pnl || 0).toFixed(2) }}
                        </span>
                      </template>
                    </Column>
                    <Column field="exitReason" header="Причина выхода" :sortable="true" style="width: 85px; max-width: 85px;">
                      <template #body="slotProps">
                        <span class="text-xs">{{ slotProps.data.exitReason || '-' }}</span>
                        </template>
                    </Column>
                  </DataTable>
                </div>
                <div v-else class="text-center py-12">
                  <i class="pi pi-list text-6xl text-gray-300 mb-4"></i>
                  <h3 class="text-xl text-gray-500 mb-2">Список сделок портфеля</h3>
                  <p class="text-gray-400">Список сделок будет доступен здесь после выполнения портфельного бектеста</p>
                </div>
              </TabPanel>
              
              <TabPanel header="Графики" value="charts">
                <div class="space-y-6">
                  <!-- График кривой баланса для одиночного бектеста -->
                  <div v-if="!backtestStore.isPortfolioMode">
                    <EquityCurveChart 
                      :equityData="backtestResultsStore?.metrics?.equityCurve || null"
                      title="Кривая баланса (Одиночный бектест)"
                      :isLoading="backtestIsLoading"
                      noDataMessage="Запустите одиночный бектест для просмотра кривой баланса"
                      color="rgb(59, 130, 246)"
                      fillColor="rgba(59, 130, 246, 0.1)"
                    />
                  </div>

                  <!-- График кривой баланса для портфельного бектеста -->
                  <div v-else>
                    <!-- Общая кривая портфеля -->
                    <EquityCurveChart 
                      :equityData="portfolioResultsStore?.overallMetrics?.portfolioEquityCurve || null"
                      title="Общая кривая баланса портфеля"
                      :isLoading="backtestIsLoading"
                      noDataMessage="Запустите портфельный бектест для просмотра общей кривой баланса"
                      color="rgb(16, 185, 129)"
                      fillColor="rgba(16, 185, 129, 0.1)"
                    />

                    <!-- Кривые по отдельным парам -->
                    <div v-if="portfolioResultsStore?.metricsByPair" class="mt-6">
                      <h3 class="text-xl font-semibold text-gray-900 mb-4">Кривые баланса по парам</h3>
                      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div v-for="(metrics, pair) in portfolioResultsStore.metricsByPair" :key="pair">
                          <EquityCurveChart 
                            :equityData="metrics.equityCurve || null"
                            :title="`Кривая баланса: ${pair}`"
                            :isLoading="false"
                            :noDataMessage="`Нет данных кривой для ${pair}`"
                            color="rgb(168, 85, 247)"
                            fillColor="rgba(168, 85, 247, 0.1)"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </TabPanel>

              <TabPanel header="Логи" value="logs">
                <div class="flex flex-col items-center justify-center h-full">
                  <div class="text-center">
                    <i class="pi pi-list text-6xl text-gray-300 mb-4"></i>
                    <h3 class="text-xl text-gray-500 mb-2">Логи процесса бектестинга</h3>
                    <p class="text-gray-400">Здесь будут выводиться логи процесса бектестинга для детального анализа.</p>
                  </div>
                </div>
              </TabPanel>
            </TabView>
          </div>
        </Panel>
      </div>
    </div>

    <!-- Диагностическая панель отключена -->

    <!-- Модальное окно графика сделки -->
    <TradeChartModal
      v-model:visible="showTradeChart"
      :trade="selectedTrade"
      :candleData="tradeCandleData"
      @close="onTradeChartClose"
      @retry-load="retryLoadChart"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, onUnmounted } from 'vue';
import { storeToRefs } from 'pinia';
import Panel from 'primevue/panel';
import Button from 'primevue/button';
import ProgressSpinner from 'primevue/progressspinner';
import TabView from 'primevue/tabview';
import TabPanel from 'primevue/tabpanel';
import StrategySettingsForm from '@/components/StrategySettingsForm.vue';
import { useSettingsStore } from '@/stores/settingsStore';
import { useBacktestStore } from '@/stores/backtestStore';
import type { 
  BacktestRunParameters, 
  BacktestResult, 
  PortfolioBacktestRunParameters, 
  PortfolioBacktestResult,
  ExecutionProfile,
} from '@/types/strategy';
import { useToast } from "primevue/usetoast";
import DatePicker from 'primevue/datepicker';
import InputNumber from 'primevue/inputnumber';
import Message from 'primevue/message';
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';
import ToggleSwitch from 'primevue/toggleswitch';
import PortfolioSettingsForm from '@/components/PortfolioSettingsForm.vue';
import PortfolioResultsDisplay from '@/components/PortfolioResultsDisplay.vue';
import Badge from 'primevue/badge';
import TradeChartModal from '@/components/TradeChartModal.vue';
import EquityCurveChart from '@/components/EquityCurveChart.vue';
import RadioButton from 'primevue/radiobutton';
import Select from 'primevue/select';
import AdvancedProgressBar from '@/components/AdvancedProgressBar.vue';
import ModernPortfolioProgress from '@/components/ModernPortfolioProgress.vue';
import type { BacktestProgressUpdate, PortfolioProgressStats } from '@/types/progress';
import Fieldset from 'primevue/fieldset';
import Checkbox from 'primevue/checkbox';

const settingsStore = useSettingsStore();
const backtestStore = useBacktestStore();
const toast = useToast();

const { parameters: localStrategyParams } = storeToRefs(settingsStore);
const { tradingPairOptions } = storeToRefs(settingsStore);
const { fetchAvailableTradingPairs } = settingsStore;

const { 
  isLoading: backtestIsLoading, 
  results: backtestResultsStore, 
  portfolioResults: portfolioResultsStore,
  error: backtestError 
} = storeToRefs(backtestStore);

const BACKTESTER_PARAMS_KEY = 'backtester_launch_params';
const PORTFOLIO_PARAMS_KEY = 'portfolio_backtester_params';
const BACKTESTER_RESULTS_KEY = 'backtester_last_results';
const PORTFOLIO_RESULTS_KEY = 'portfolio_backtester_results';
const ACTIVE_JOB_KEY = 'backtester_active_job';
const BACKTESTER_MODE_KEY = 'backtester_mode';
const pendingJobId = ref<string | null>(null);
const currentJobStatus = ref<string | null>(null);
const isComponentMounted = ref(false);

let debounceTimer: number | undefined = undefined;
let filterDebounceTimer: number | undefined = undefined;

// WebSocket相关
let websocket: WebSocket | null = null;
const WEBSOCKET_URL = 'ws://localhost:5000';
const logger = console;

// Оптимизированная фильтрация для торговых пар с дебаунсом
const optimizedFilter = (event: any) => {
  if (filterDebounceTimer) {
    clearTimeout(filterDebounceTimer);
  }

  filterDebounceTimer = setTimeout(() => {
    // Используем store для оптимизированной фильтрации
    if (event.value && event.value.trim()) {
      settingsStore.filterTradingPairs(event.value);
    } else {
      settingsStore.clearTradingPairsFilter();
    }
    console.log('Optimized filter applied via store:', event.value);
  }, 300);
}; 

const JOB_TYPES_FRONTEND = {
  FETCH_CANDLES_AND_RUN_BACKTEST: 'fetch-candles-and-run-backtest',
  FETCH_PORTFOLIO_DATA_AND_RUN_BACKTEST: 'FETCH_PORTFOLIO_DATA_AND_RUN_BACKTEST'
};

// Обычный бектест параметры
const pairSymbol = ref<string | null>(null);
const timeframe = ref<string>('1h');
const timeframes = ref([
    { label: '1 минута', value: '1m' },
    { label: '3 минуты', value: '3m' },
    { label: '5 минут', value: '5m' },
    { label: '15 минут', value: '15m' },
    { label: '30 минут', value: '30m' },
    { label: '1 час', value: '1h' },
    { label: '2 часа', value: '2h' },
    { label: '4 часа', value: '4h' },
    { label: '6 часов', value: '6h' },
    { label: '12 часов', value: '12h' },
    { label: '1 день', value: '1d' },
]);
const startDate = ref<Date | null>(null);
const endDate = ref<Date | null>(null);
const initialCapital = ref<number>(10000);
const useExecutionProfile = ref<boolean>(false);
const simulateConfirmation = ref<boolean>(true);
const executionProfile = ref<ExecutionProfile>({
  tradingFeeRate: 0.0006,
  fundingRateBuffer: 0.00025,
  slippageBps: 5,
  leverage: 10,
  maxConfirmationAttempts: 3,
  confirmWindowSize: 2,
});

// Портфельный бектест параметры
const portfolioParams = ref({
  pairSymbols: [] as string[],
  initialPortfolioCapital: 10000,
  portfolioSettings: {
    maxConcurrentTradesPortfolio: undefined as number | undefined
  }
});
const portfolioTimeframe = ref<string>('1h');
const portfolioStartDate = ref<Date | null>(null);
const portfolioEndDate = ref<Date | null>(null);
const portfolioUseExecutionProfile = ref<boolean>(false);
const portfolioSimulateConfirmation = ref<boolean>(true);
const portfolioExecutionProfile = ref<ExecutionProfile>({
  tradingFeeRate: 0.0006,
  fundingRateBuffer: 0.00025,
  slippageBps: 5,
  leverage: 10,
  maxConfirmationAttempts: 3,
  confirmWindowSize: 2,
});

// Состояние для модального окна графика сделки
const selectedTrade = ref<any | null>(null);
const showTradeChart = ref(false);
const tradeCandleData = ref<any[] | null>(null);

// Диагностическая панель отключена
// const showDiagnostics = ref(false); // Диагностическая панель отключена

// НОВОЕ: Поддержка выбора биржи
const { selectedExchange } = storeToRefs(settingsStore);

// НОВОЕ: Поддержка GPU ускорения
const useGPU = ref<boolean>(false);
const gpuAvailable = ref<boolean>(false);
const gpuStatus = ref<string>('Проверка...');

// Данные для продвинутого прогресс-бара
const progressData = ref<BacktestProgressUpdate>({
  jobId: '',
  stage: 'initializing',
  stageDescription: 'Подготовка к запуску...',
  processedItems: 0,
  totalItems: 100,
  startTime: Date.now(),
  stageBreakdown: [
    { name: 'Инициализация', status: 'pending', progress: 0 },
    { name: 'Загрузка данных', status: 'pending', progress: 0 },
    { name: 'Расчет индикаторов', status: 'pending', progress: 0 },
    { name: 'Выполнение бэктеста', status: 'pending', progress: 0 },
    { name: 'Расчет метрик', status: 'pending', progress: 0 },
    { name: 'Сохранение результатов', status: 'pending', progress: 0 }
  ],
  portfolioStats: undefined,
  gpuStats: undefined,
  activityLog: [],
  memoryUsage: 0,
  estimatedCompletion: 0
});

// Следим за изменением биржи и перезагружаем торговые пары
watch(selectedExchange, (newExchange) => {
  if (newExchange) {
    console.log(`[BacktesterView] Exchange changed to: ${newExchange}`);
    settingsStore.setExchange(newExchange);
    // Очищаем выбранную пару при смене биржи
    pairSymbol.value = null;
    portfolioParams.value.pairSymbols = [];
  }
}, { immediate: false });

const handleWebSocketMessage = (event: MessageEvent) => {
  try {
    const message = JSON.parse(event.data as string);
    logger.debug('[BacktesterView] WebSocket message received:', message);

    // Проверяем, что компонент еще смонтирован
    if (!websocket || !isComponentMounted.value) {
      return; // Компонент размонтирован
    }

    // Обработка прогресса бэктеста
    if (message.type === 'BACKTEST_PROGRESS' && message.payload) {
      const progressUpdate = message.payload as BacktestProgressUpdate;
      
      // ОТЛАДКА: Детальная диагностика данных
      console.log('📡 WebSocket BACKTEST_PROGRESS received:', {
        stage: progressUpdate.stage,
        processedItems: progressUpdate.processedItems,
        totalItems: progressUpdate.totalItems,
        portfolioStats: progressUpdate.portfolioStats,
        loadingQueue: progressUpdate.loadingQueue,
        currentPairs: progressUpdate.currentPairs
      });
      
      console.log('🔍 Current progressData before update:', {
        'totalItems (current)': progressData.value.totalItems,
        'portfolioStats.totalPairs (current)': progressData.value.portfolioStats?.totalPairs,
        'portfolioStats.processedPairs (current)': progressData.value.portfolioStats?.processedPairs
      });
      
      // Сохраняем startTime если он не был установлен
      const currentStartTime = progressData.value.startTime || progressUpdate.startTime || Date.now();
      
      // Обновляем этапы прогресса
      let updatedStageBreakdown = progressData.value.stageBreakdown;
      if (progressUpdate.stageBreakdown && progressUpdate.stageBreakdown.length > 0) {
        updatedStageBreakdown = progressUpdate.stageBreakdown;
      } else if (progressUpdate.stage) {
        // Обновляем этапы на основе текущего stage
        updatedStageBreakdown = progressData.value.stageBreakdown.map(stage => {
          const stageName = stage.name.toLowerCase();
          const currentStage = progressUpdate.stage;
          
          if (currentStage === 'initializing' && stageName.includes('инициализация')) {
            return { ...stage, status: 'active' as const, progress: Math.min(100, progressUpdate.processedItems * 10) };
          } else if (currentStage === 'loading_data' && stageName.includes('загрузка')) {
            return { ...stage, status: 'active' as const, progress: Math.min(100, (progressUpdate.processedItems / progressUpdate.totalItems) * 100) };
          } else if (currentStage === 'processing_indicators' && stageName.includes('индикатор')) {
            return { ...stage, status: 'active' as const, progress: Math.min(100, (progressUpdate.processedItems / progressUpdate.totalItems) * 100) };
          } else if (currentStage === 'running_backtest' && stageName.includes('выполнение')) {
            return { ...stage, status: 'active' as const, progress: Math.min(100, (progressUpdate.processedItems / progressUpdate.totalItems) * 100) };
          } else if (currentStage === 'calculating_metrics' && stageName.includes('метрик')) {
            return { ...stage, status: 'active' as const, progress: Math.min(100, (progressUpdate.processedItems / progressUpdate.totalItems) * 100) };
          } else if (currentStage === 'saving_results' && stageName.includes('сохранение')) {
            return { ...stage, status: 'active' as const, progress: Math.min(100, (progressUpdate.processedItems / progressUpdate.totalItems) * 100) };
          } else if (currentStage === 'completed') {
            return { ...stage, status: 'completed' as const, progress: 100 };
          }
          
          return stage;
        });
      }
      
      // ИСПРАВЛЕНО: Аккуратное обновление данных прогресса
      // Сохраняем важные изначальные данные для портфеля
      const isPortfolioMode = progressData.value.portfolioStats !== undefined;
      const originalPortfolioStats = progressData.value.portfolioStats;
      const originalTotalItems = progressData.value.totalItems;
      const originalCurrentPairs = progressData.value.currentPairs;
      const originalLoadingQueue = progressData.value.loadingQueue;
      
      progressData.value = {
        ...progressData.value,
        // Обновляем основные поля прогресса
        jobId: progressUpdate.jobId || progressData.value.jobId,
        stage: progressUpdate.stage || progressData.value.stage,
        stageDescription: progressUpdate.stageDescription || progressData.value.stageDescription,
        processedItems: progressUpdate.processedItems !== undefined ? progressUpdate.processedItems : progressData.value.processedItems,
        
        // ДЛЯ ПОРТФЕЛЯ: Сохраняем изначальные totalItems, не перетираем бэкендовскими данными!
        totalItems: isPortfolioMode ? originalTotalItems : (progressUpdate.totalItems || progressData.value.totalItems),
        
        startTime: currentStartTime,
        stageBreakdown: updatedStageBreakdown,
        
        // УМНОЕ ОБНОВЛЕНИЕ portfolioStats с типизацией
        portfolioStats: isPortfolioMode && originalPortfolioStats ? {
          // Все обязательные поля с правильными типами
          processedPairs: progressUpdate.portfolioStats?.processedPairs ?? originalPortfolioStats.processedPairs,
          totalPairs: originalPortfolioStats.totalPairs, // НЕ ПЕРЕТИРАЕМ!
          totalTrades: progressUpdate.portfolioStats?.totalTrades ?? originalPortfolioStats.totalTrades,
          dataLoaded: progressUpdate.portfolioStats?.dataLoaded ?? originalPortfolioStats.dataLoaded,
          currentPair: progressUpdate.portfolioStats?.currentPair ?? originalPortfolioStats.currentPair,
          pairsWithData: progressUpdate.portfolioStats?.pairsWithData ?? originalPortfolioStats.pairsWithData,
          pairsNeedingData: progressUpdate.portfolioStats?.pairsNeedingData ?? originalPortfolioStats.pairsNeedingData,
          apiCallsMade: progressUpdate.portfolioStats?.apiCallsMade ?? originalPortfolioStats.apiCallsMade,
          dbQueriesMade: progressUpdate.portfolioStats?.dbQueriesMade ?? originalPortfolioStats.dbQueriesMade
        } as PortfolioProgressStats : progressUpdate.portfolioStats,
        
        // Обновляем остальные поля
        gpuStats: progressUpdate.gpuStats || progressData.value.gpuStats,
        memoryUsage: progressUpdate.memoryUsage !== undefined ? progressUpdate.memoryUsage : progressData.value.memoryUsage,
        estimatedCompletion: progressUpdate.estimatedCompletion !== undefined ? progressUpdate.estimatedCompletion : progressData.value.estimatedCompletion,
        
        // Обновляем детальные данные по парам если есть
        currentPairs: progressUpdate.currentPairs || originalCurrentPairs || [],
        loadingQueue: progressUpdate.loadingQueue || originalLoadingQueue,
        
        activityLog: [
          ...progressData.value.activityLog,
          {
            timestamp: Date.now(),
            message: progressUpdate.stageDescription || 'Обновление прогресса',
            level: 'info' as const,
            stage: progressUpdate.stage
          }
        ].slice(-50) // Оставляем только последние 50 записей
      };
      
      // ОТЛАДКА: Логируем результат обновления
      console.log('✅ progressData AFTER smart update:', {
        'totalItems (final)': progressData.value.totalItems,
        'portfolioStats.totalPairs (final)': progressData.value.portfolioStats?.totalPairs,
        'portfolioStats.processedPairs (final)': progressData.value.portfolioStats?.processedPairs,
        'isPortfolioMode': isPortfolioMode,
        'preservedOriginalTotalItems': originalTotalItems
      });
      
      // Обновляем сохраненный прогресс
      if (progressUpdate.jobId) {
        localStorage.setItem('backtester_progress', JSON.stringify({
          jobId: progressUpdate.jobId,
          startTime: currentStartTime,
          type: progressUpdate.portfolioStats ? 'portfolio' : 'single',
          stage: progressUpdate.stage
        }));
      }
      
      logger.debug('[BacktesterView] Progress updated:', progressUpdate);
    }
    // Обработка обычного бектеста
    else if (message.type === 'BACKTEST_COMPLETED' && message.payload) {
      const { jobId: completedJobId, result, symbol: msgSymbol, timeframe: msgTimeframe } = message.payload;
      
      if (pendingJobId.value && pendingJobId.value !== completedJobId) {
        logger.info(`[BacktesterView] Received BACKTEST_COMPLETED for job ${completedJobId}, but was expecting ${pendingJobId.value}.`);
      }
      
      logger.info(`[BacktesterView] Backtest (Job ID: ${completedJobId}) completed for ${msgSymbol} (${msgTimeframe}). Updating results.`);
      
      // Проверяем, что компонент еще активен перед обновлением состояния
      if (backtestStore && websocket && isComponentMounted.value) {
        // ИСПРАВЛЕНО: Используем новый метод store для установки результатов
        backtestStore.setResults(result as BacktestResult);
        
      if (pendingJobId.value === completedJobId) {
         pendingJobId.value = null;
         currentJobStatus.value = null;
         backtestStore.clearCurrentAbortController();
         clearActiveJobState();
         
         // Очищаем сохраненный прогресс
         localStorage.removeItem('backtester_progress');
      }

      try {
        // Безопасное сохранение результатов обычного бэктеста
        const resultString = JSON.stringify(result);
        const resultSizeKB = new Blob([resultString]).size / 1024;
        
        if (resultSizeKB < 2048) { // Лимит 2MB для обычных результатов
          localStorage.setItem(BACKTESTER_RESULTS_KEY, resultString);
          console.log(`[BacktesterView] Backtest results saved to localStorage (${resultSizeKB.toFixed(1)}KB)`);
        } else {
          console.warn(`[BacktesterView] Backtest results too large for localStorage (${resultSizeKB.toFixed(1)}KB), skipping save`);
        }
      } catch (error) {
        console.warn('[BacktesterView] Failed to save backtest results to localStorage:', error);
      }

        safeToast({ 
        severity: 'success', 
        summary: 'Бектест Завершен', 
        detail: `Бектест для ${msgSymbol} (${msgTimeframe}) успешно завершен.`, 
        life: 5000 
      });
      }
    } 
    // Обработка портфельного бектеста
    else if (message.type === 'PORTFOLIO_BACKTEST_COMPLETED' && message.payload) {
      const { jobId: completedJobId, result, fileInfo } = message.payload;
      
      if (pendingJobId.value && pendingJobId.value !== completedJobId) {
        logger.info(`[BacktesterView] Received PORTFOLIO_BACKTEST_COMPLETED for job ${completedJobId}, but was expecting ${pendingJobId.value}.`);
      }
      
      logger.info(`[BacktesterView] Portfolio backtest (Job ID: ${completedJobId}) completed. Updating results.`);
      
      // Проверяем, что компонент еще активен перед обновлением состояния
      if (backtestStore && websocket && isComponentMounted.value) {
        // ИСПРАВЛЕНО: Используем новый метод store для установки результатов
        backtestStore.setPortfolioResults(result as PortfolioBacktestResult);
        
      if (pendingJobId.value === completedJobId) {
         pendingJobId.value = null;
           currentJobStatus.value = null;
         backtestStore.clearCurrentAbortController();
         clearActiveJobState();
         
         // Очищаем сохраненный прогресс
         localStorage.removeItem('backtester_progress');
      }

      try {
        // Сохраняем только основные метрики, чтобы избежать превышения лимита localStorage
        const summaryResult = {
          overallMetrics: result.overallMetrics,
          metricsByPair: result.metricsByPair,
          configUsed: result.configUsed,
          _largeDataSavedToFile: result._largeDataSavedToFile,
          _downloadUrl: result._downloadUrl,
          _fullDataSize: result._fullDataSize,
          _dataReduced: result._dataReduced,
          _reducedTradesCount: result._reducedTradesCount,
          _originalTradesCount: result._originalTradesCount,
          timestamp: Date.now()
        };
        
        const resultString = JSON.stringify(summaryResult);
        const resultSizeKB = new Blob([resultString]).size / 1024;
        
        // Сохраняем только если размер меньше 1MB
        if (resultSizeKB < 1024) {
          localStorage.setItem(PORTFOLIO_RESULTS_KEY, resultString);
          console.log(`[BacktesterView] Portfolio summary saved to localStorage (${resultSizeKB.toFixed(1)}KB)`);
        } else {
          console.warn(`[BacktesterView] Portfolio results too large for localStorage (${resultSizeKB.toFixed(1)}KB), skipping save`);
        }
      } catch (error) {
        console.warn('[BacktesterView] Failed to save portfolio results to localStorage:', error);
      }

        // Проверяем, сохранены ли результаты в файл
        if (result._largeDataSavedToFile && fileInfo) {
          logger.info(`[BacktesterView] Large results saved to file: ${fileInfo.filename} (${fileInfo.sizeMB}MB)`);

        safeToast({ 
        severity: 'success', 
        summary: 'Портфельный Бектест Завершен', 
            detail: `Бектест завершен! Результаты (${fileInfo.sizeMB}MB) сохранены в файл. Доступна ссылка для скачивания.`, 
            life: 8000 
          });
          
          // Показываем дополнительное уведомление о скачивании
          setTimeout(() => {
            safeToast({ 
              severity: 'info', 
              summary: 'Файл результатов доступен', 
              detail: `Полные результаты доступны по ссылке в разделе результатов. Файл: ${fileInfo.filename}`, 
              life: 10000 
            });
          }, 2000);
          
        } else {
          // Обычные результаты через WebSocket
          let detailMessage = `Портфельный бектест успешно завершен. Всего сделок: ${result.overallMetrics?.totalPortfolioTrades || 0}`;
          
          // Проверяем, были ли данные сокращены
          if (result._dataReduced) {
            const originalCount = result._originalTradesCount || 0;
            detailMessage += `. Данные сокращены для передачи (было ${originalCount} сделок).`;
          }
          
          safeToast({ 
            severity: 'success', 
            summary: 'Портфельный Бектест Завершен', 
            detail: detailMessage, 
        life: 5000 
      });
        }
      }
    }
    // Обработка ошибок обычного бектеста
    else if (message.type === 'BACKTEST_FAILED' && message.payload) {
      const { jobId: failedJobId, symbol: msgSymbol, timeframe: msgTimeframe, error: errPayload } = message.payload;
      if (pendingJobId.value && pendingJobId.value !== failedJobId) {
        logger.info(`[BacktesterView] Received BACKTEST_FAILED for job ${failedJobId}, but was expecting ${pendingJobId.value}.`);
      }

      logger.error(`[BacktesterView] Backtest (Job ID: ${failedJobId}) failed for ${msgSymbol} (${msgTimeframe}):`, errPayload.message);
      backtestStore.error = errPayload.message || 'Неизвестная ошибка при выполнении бектеста в очереди.';
      backtestStore.isLoading = false;
      if (pendingJobId.value === failedJobId) {
        pendingJobId.value = null;
        currentJobStatus.value = null;
        backtestStore.clearCurrentAbortController();
      }

      safeToast({ 
        severity: 'error',
        summary: 'Ошибка Бектеста',
        detail: `Ошибка при выполнении бектеста для ${msgSymbol} (${msgTimeframe}) в очереди: ${errPayload.message}`,
        life: 7000
      });
    }
    // Обработка ошибок портфельного бектеста
    else if (message.type === 'PORTFOLIO_BACKTEST_FAILED' && message.payload) {
      const { jobId: failedJobId, error: errPayload } = message.payload;
      if (pendingJobId.value && pendingJobId.value !== failedJobId) {
        logger.info(`[BacktesterView] Received PORTFOLIO_BACKTEST_FAILED for job ${failedJobId}, but was expecting ${pendingJobId.value}.`);
      }

      logger.error(`[BacktesterView] Portfolio backtest (Job ID: ${failedJobId}) failed:`, errPayload.message);
      
      // Создаем детальное сообщение об ошибке
      let errorMessage = errPayload.message || 'Неизвестная ошибка при выполнении портфельного бектеста в очереди.';
      
      // Если ошибка связана с недостающими данными
      if (errorMessage.includes('No candles found') || errorMessage.includes('insufficient data')) {
        errorMessage = `Ошибка: Недостаточно данных для некоторых торговых пар. ${errorMessage}`;
        
        safeToast({ 
          severity: 'error',
          summary: 'Недостаточно данных',
          detail: `Для некоторых пар отсутствуют исторические данные. Попробуйте загрузить данные через раздел "Управление данными" или выберите другой период.`,
          life: 10000
        });
      } else {
        safeToast({ 
          severity: 'error',
          summary: 'Ошибка Портфельного Бектеста',
          detail: `Ошибка при выполнении портфельного бектеста в очереди: ${errorMessage}`,
          life: 7000
        });
      }
      
      backtestStore.error = errorMessage;
      backtestStore.isLoading = false;
      
      if (pendingJobId.value === failedJobId) {
        pendingJobId.value = null;
        currentJobStatus.value = null;
        backtestStore.clearCurrentAbortController();
        clearActiveJobState();
      }
    }

    // Обработка WebSocket ошибок (новое)
    else if (message.type === 'WEBSOCKET_ERROR' && message.payload) {
      logger.warn(`[BacktesterView] WebSocket error received:`, message.payload);
      
      if (message.payload.message?.includes('Portfolio backtest results too large')) {
        safeToast({ 
          severity: 'warn',
          summary: 'Результаты слишком большие',
          detail: 'Результаты портфельного бэктеста слишком велики для передачи. Попробуйте обновить страницу для отображения сохраненных результатов.',
          life: 8000
        });
        
        // Попытаемся загрузить результаты из localStorage
        const savedResults = localStorage.getItem(PORTFOLIO_RESULTS_KEY);
        if (savedResults) {
          try {
            const parsedResults = JSON.parse(savedResults);
            backtestStore.portfolioResults = parsedResults;
            backtestStore.isLoading = false;
            
            safeToast({ 
              severity: 'info',
              summary: 'Результаты восстановлены',
              detail: 'Результаты успешно загружены из локального хранилища.',
              life: 5000
            });
          } catch (e) {
            logger.error('[BacktesterView] Failed to parse saved portfolio results:', e);
          }
        }
      } else {
        safeToast({ 
          severity: 'error',
          summary: 'Ошибка WebSocket',
          detail: message.payload.message || 'Произошла ошибка при передаче данных',
          life: 5000
        });
      }
    }

    // Обработка сжатых данных (новое)
    else if (message._compressed) {
      try {
        logger.info(`[BacktesterView] Received compressed message. Original size: ${message.originalSize}, Compressed size: ${message.compressedSize}`);
        
        safeToast({ 
          severity: 'info',
          summary: 'Данные сжаты',
          detail: `Получены сжатые результаты (${Math.round(message.compressedSize / 1024)}KB). Обработка...`,
          life: 3000
        });
        
        // Здесь можно добавить логику для декомпрессии данных если необходимо
        // В текущей реализации backend отправляет уже готовые к использованию данные
      } catch (error) {
        logger.error('[BacktesterView] Error handling compressed message:', error);
      }
    }

    // Обработка уведомлений о уменьшенных данных (новое)
    else if (message.payload?.result?._dataReduced) {
      const originalCount = message.payload.result._originalTradesCount || 0;
      safeToast({ 
        severity: 'warn',
        summary: 'Данные сокращены',
        detail: `Отображаются сокращенные результаты из-за большого объема данных. Всего было ${originalCount} сделок.`,
        life: 6000
      });
    }
    else if (message.type === 'job_updated' && 
             (message.payload?.name === JOB_TYPES_FRONTEND.FETCH_CANDLES_AND_RUN_BACKTEST ||
              message.payload?.name === JOB_TYPES_FRONTEND.FETCH_PORTFOLIO_DATA_AND_RUN_BACKTEST)) {
        
        // Отслеживаем статус наших задач
        if (message.payload.jobId === pendingJobId.value) {
          currentJobStatus.value = message.payload.status;
          
          if (message.payload.status === 'active') {
            const isPortfolio = message.payload.name === JOB_TYPES_FRONTEND.FETCH_PORTFOLIO_DATA_AND_RUN_BACKTEST;
            safeToast({ 
                severity: 'info', 
                summary: 'Обработка Задачи', 
                detail: isPortfolio 
                  ? `Задача на портфельный бектест начала выполняться.`
                  : `Задача на бектест для ${message.payload.data?.symbol} (${message.payload.data?.timeframe}) начала выполняться.`, 
                life: 3000 
            });
          } else if (message.payload.status === 'waiting' || message.payload.status === 'wait') {
            const isPortfolio = message.payload.name === JOB_TYPES_FRONTEND.FETCH_PORTFOLIO_DATA_AND_RUN_BACKTEST;
            safeToast({ 
                severity: 'info', 
                summary: 'Задача в очереди', 
                detail: isPortfolio 
                  ? `Портфельный бектест поставлен в очередь и ожидает обработки.`
                  : `Бектест для ${message.payload.data?.symbol} (${message.payload.data?.timeframe}) в очереди.`, 
                life: 3000 
            });
          }
        }
    }
  } catch (e) {
    logger.error('[BacktesterView] Error parsing WebSocket message or processing it:', e);
  }
};

const connectWebSocket = () => {
  if (websocket && websocket.readyState === WebSocket.OPEN) {
    logger.info('[BacktesterView] WebSocket already connected.');
    return;
  }
  logger.info('[BacktesterView] Attempting to connect WebSocket...');
  websocket = new WebSocket(WEBSOCKET_URL);

  websocket.onopen = () => {
    logger.info('[BacktesterView] WebSocket connection established.');
    safeToast({ severity: 'info', summary: 'WebSocket', detail: 'Соединение для обновлений установлено.', life: 2000 });
  };

  websocket.onmessage = handleWebSocketMessage;

  websocket.onerror = (error) => {
    logger.error('[BacktesterView] WebSocket error:', error);
    safeToast({ severity: 'error', summary: 'WebSocket Ошибка', detail: 'Ошибка соединения WebSocket.', life: 4000 });
  };

  websocket.onclose = (event) => {
    logger.info('[BacktesterView] WebSocket connection closed:', event.reason, `Code: ${event.code}`);
    if (!event.wasClean) {
        safeToast({ severity: 'warn', summary: 'WebSocket', detail: 'Соединение для обновлений потеряно. Попытка переподключения через 5с...', life: 4000 });
        setTimeout(connectWebSocket, 5000);
    }
  };
};

const closeWebSocket = () => {
  if (websocket) {
    logger.info('[BacktesterView] Closing WebSocket connection.');
    websocket.removeEventListener('message', handleWebSocketMessage);
    websocket.removeEventListener('open', () => {});
    websocket.removeEventListener('error', () => {});
    websocket.removeEventListener('close', () => {});
    
    if (websocket.readyState === WebSocket.OPEN || websocket.readyState === WebSocket.CONNECTING) {
    websocket.close();
    }
    websocket = null;
  }
};

onMounted(async () => {
  isComponentMounted.value = true;
  await fetchAvailableTradingPairs();

  if (!localStrategyParams.value) {
      logger.warn('[BacktesterView] localStrategyParams are null onMounted after attempting to load. Ensure settingsStore initializes them.');
  }

  // Восстановление режима бектестера
  const savedModeRaw = localStorage.getItem(BACKTESTER_MODE_KEY);
  if (savedModeRaw) {
    try {
      const savedMode = JSON.parse(savedModeRaw);
      // ИСПРАВЛЕНИЕ: Используем безопасную функцию восстановления режима
      backtestStore.restorePortfolioMode(savedMode.isPortfolioMode || false);
      logger.info(`[BacktesterView] Restored backtester mode: ${backtestStore.isPortfolioMode ? 'portfolio' : 'single'}`);
    } catch (e) {
      logger.error('[BacktesterView] Failed to parse backtester mode:', e);
      localStorage.removeItem(BACKTESTER_MODE_KEY);
    }
  }

  // НОВОЕ: Восстановление режима GPU ускорения
  const savedGPUModeRaw = localStorage.getItem('backtester_gpu_mode');
  if (savedGPUModeRaw) {
    try {
      const savedGPUMode = JSON.parse(savedGPUModeRaw);
      useGPU.value = savedGPUMode.useGPU || false;
      logger.info(`[BacktesterView] Restored GPU mode: ${useGPU.value ? 'enabled' : 'disabled'}`);
    } catch (e) {
      logger.error('[BacktesterView] Failed to parse GPU mode:', e);
      localStorage.removeItem('backtester_gpu_mode');
    }
  }

  // Загрузка параметров обычного бектеста
  const savedParamsRaw = localStorage.getItem(BACKTESTER_PARAMS_KEY);
  if (savedParamsRaw) {
    try {
      const savedParams = JSON.parse(savedParamsRaw);
      pairSymbol.value = savedParams.pairSymbol || null;
      timeframe.value = savedParams.timeframe || '1h';
      startDate.value = savedParams.startDate ? new Date(savedParams.startDate) : null;
      endDate.value = savedParams.endDate ? new Date(savedParams.endDate) : null;
      initialCapital.value = savedParams.initialCapital || 10000;
      if (typeof savedParams.useExecutionProfile === 'boolean') {
        useExecutionProfile.value = savedParams.useExecutionProfile;
      }
      if (typeof savedParams.simulateConfirmation === 'boolean') {
        simulateConfirmation.value = savedParams.simulateConfirmation;
      }
      if (savedParams.executionProfile) {
        executionProfile.value = {
          ...executionProfile.value,
          ...savedParams.executionProfile,
        } as ExecutionProfile;
      }
      logger.info('[BacktesterView] Loaded launch parameters from localStorage.');
    } catch (e) {
      logger.error('[BacktesterView] Failed to parse launch parameters from localStorage:', e);
      localStorage.removeItem(BACKTESTER_PARAMS_KEY);
    }
  }

  // Загрузка параметров портфельного бектеста
  const savedPortfolioParamsRaw = localStorage.getItem(PORTFOLIO_PARAMS_KEY);
  if (savedPortfolioParamsRaw) {
    try {
      const savedPortfolioParams = JSON.parse(savedPortfolioParamsRaw);
      portfolioParams.value = savedPortfolioParams.portfolioParams || portfolioParams.value;
      portfolioTimeframe.value = savedPortfolioParams.timeframe || '1h';
      portfolioStartDate.value = savedPortfolioParams.startDate ? new Date(savedPortfolioParams.startDate) : null;
      portfolioEndDate.value = savedPortfolioParams.endDate ? new Date(savedPortfolioParams.endDate) : null;
      if (typeof savedPortfolioParams.useExecutionProfile === 'boolean') {
        portfolioUseExecutionProfile.value = savedPortfolioParams.useExecutionProfile;
      }
      if (typeof savedPortfolioParams.simulateConfirmation === 'boolean') {
        portfolioSimulateConfirmation.value = savedPortfolioParams.simulateConfirmation;
      }
      if (savedPortfolioParams.executionProfile) {
        portfolioExecutionProfile.value = {
          ...portfolioExecutionProfile.value,
          ...savedPortfolioParams.executionProfile,
        } as ExecutionProfile;
      }
      logger.info('[BacktesterView] Loaded portfolio parameters from localStorage.');
    } catch (e) {
      logger.error('[BacktesterView] Failed to parse portfolio parameters from localStorage:', e);
      localStorage.removeItem(PORTFOLIO_PARAMS_KEY);
    }
  }

  // Загрузка результатов
  const savedResultsRaw = localStorage.getItem(BACKTESTER_RESULTS_KEY);
  if (savedResultsRaw) {
    try {
      const savedResults = JSON.parse(savedResultsRaw);
      backtestStore.results = savedResults as BacktestResult;
      logger.info('[BacktesterView] Loaded last backtest results from localStorage:', {
        hasTrades: savedResults.trades?.length || 0,
        hasMetrics: !!savedResults.metrics,
        totalPnl: savedResults.metrics?.totalPnl
      });
    } catch (e) {
      logger.error('[BacktesterView] Failed to parse backtest results from localStorage:', e);
      localStorage.removeItem(BACKTESTER_RESULTS_KEY);
    }
  }

  const savedPortfolioResultsRaw = localStorage.getItem(PORTFOLIO_RESULTS_KEY);
  if (savedPortfolioResultsRaw) {
    try {
      const savedPortfolioResults = JSON.parse(savedPortfolioResultsRaw);
      backtestStore.portfolioResults = savedPortfolioResults as PortfolioBacktestResult;
      logger.info('[BacktesterView] Loaded last portfolio results from localStorage:', {
        hasTradesByPair: !!savedPortfolioResults.tradesByPair,
        pairsCount: Object.keys(savedPortfolioResults.tradesByPair || {}).length,
        hasPortfolioMetrics: !!savedPortfolioResults.portfolioMetrics
      });
    } catch (e) {
      logger.error('[BacktesterView] Failed to parse portfolio results from localStorage:', e);
      localStorage.removeItem(PORTFOLIO_RESULTS_KEY);
    }
  }

  connectWebSocket();
  
  // НОВОЕ: Проверка статуса GPU сервиса
  await checkGPUStatus();
  
  // Восстановление состояния активного сканирования (после подключения WebSocket)
  // Увеличиваем timeout и добавляем retry логику
  let retryCount = 0;
  const maxRetries = 3;
  
  const tryRestoreActiveJobState = async () => {
    try {
      logger.info(`[BacktesterView] Attempting to restore active job state (attempt ${retryCount + 1}/${maxRetries})`);
      
    if (isComponentMounted.value) {
      await restoreActiveJobState();
        logger.info('[BacktesterView] Active job state restoration completed successfully');
    }
    } catch (error) {
      logger.error(`[BacktesterView] Error restoring active job state (attempt ${retryCount + 1}):`, error);
      
      retryCount++;
      if (retryCount < maxRetries) {
        logger.info(`[BacktesterView] Retrying restore in 2 seconds...`);
        setTimeout(tryRestoreActiveJobState, 2000);
      } else {
        logger.error('[BacktesterView] Max retries reached for restoring active job state');
        safeToast({
          severity: 'warning',
          summary: 'Предупреждение',
          detail: 'Не удалось восстановить состояние активных задач. Проверьте подключение к серверу.',
          life: 5000
        });
      }
    }
  };

  // Увеличиваем задержку до 2 секунд для более надёжного подключения WebSocket
  setTimeout(tryRestoreActiveJobState, 2000);
});

onUnmounted(() => {
  isComponentMounted.value = false;
  if (debounceTimer) clearTimeout(debounceTimer);
  closeWebSocket();
  logger.info('[BacktesterView] Cleaned up on unmount.');
});

watch(localStrategyParams, (newValue) => {
  if (newValue) {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = window.setTimeout(() => {
      settingsStore.setSettings(JSON.parse(JSON.stringify(newValue)));
    }, 1000);
  }
}, { deep: true });

// Функция для восстановления прогресса из localStorage
const restoreProgressFromStorage = () => {
  try {
    const savedProgress = localStorage.getItem('backtester_progress');
    if (savedProgress && pendingJobId.value) {
      const progressInfo = JSON.parse(savedProgress);
      
      // Проверяем, что сохраненный прогресс соответствует текущему jobId
      if (progressInfo.jobId === pendingJobId.value && progressInfo.startTime) {
        const now = Date.now();
        const elapsedTime = now - progressInfo.startTime;
        
        // Восстанавливаем базовую структуру прогресса
        progressData.value = {
          ...progressData.value,
          jobId: progressInfo.jobId,
          startTime: progressInfo.startTime,
          stage: progressInfo.stage || 'initializing',
          stageDescription: 'Восстановление прогресса...',
          activityLog: [
            ...progressData.value.activityLog,
            {
              timestamp: now,
              message: `Прогресс восстановлен (выполняется ${Math.floor(elapsedTime / 1000)}с)`,
              level: 'info' as const,
              stage: progressInfo.stage || 'initializing'
            }
          ]
        };
        
        logger.info(`[BacktesterView] Progress restored for job ${progressInfo.jobId}, elapsed: ${elapsedTime}ms`);
      }
    }
  } catch (error) {
    logger.warn('[BacktesterView] Failed to restore progress from storage:', error);
  }
};

// Функция для инициализации прогресса
const initializeProgress = (jobId: string, type: 'single' | 'portfolio') => {
  const now = Date.now();
  progressData.value = {
    jobId,
    stage: 'initializing',
    stageDescription: 'Подготовка к запуску бэктеста...',
    processedItems: 0,
    totalItems: type === 'portfolio' ? portfolioParams.value.pairSymbols.length : 1,
    startTime: now,
    stageBreakdown: [
      { name: 'Инициализация', status: 'active', progress: 10, startTime: now },
      { name: 'Загрузка данных', status: 'pending', progress: 0 },
      { name: 'Расчет индикаторов', status: 'pending', progress: 0 },
      { name: 'Выполнение бэктеста', status: 'pending', progress: 0 },
      { name: 'Расчет метрик', status: 'pending', progress: 0 },
      { name: 'Сохранение результатов', status: 'pending', progress: 0 }
    ],
    portfolioStats: type === 'portfolio' ? {
      processedPairs: 0,
      totalPairs: portfolioParams.value.pairSymbols.length,
      totalTrades: 0,
      dataLoaded: '0 MB',
      currentPair: portfolioParams.value.pairSymbols[0] || '',
      pairsWithData: 0,
      pairsNeedingData: portfolioParams.value.pairSymbols.length,
      apiCallsMade: 0,
      dbQueriesMade: 0
    } : undefined,
    currentPairs: type === 'portfolio' ? portfolioParams.value.pairSymbols.map(symbol => ({
      symbol,
      status: 'queued' as const,
      progress: 0,
      exchange: selectedExchange.value
    })) : [],
    loadingQueue: type === 'portfolio' ? {
      totalPairs: portfolioParams.value.pairSymbols.length,
      completedPairs: 0,
      activePairs: [],
      queuedPairs: [...portfolioParams.value.pairSymbols],
      failedPairs: [],
      totalCandlesExpected: 0,
      totalCandlesLoaded: 0,
      totalDataSize: 0,
      estimatedTimePerPair: 0,
      currentThroughput: 0,
      peakThroughput: 0,
      averagePairLoadTime: 0
    } : undefined,
    gpuStats: {
      enabled: false, // Будет обновлено при наличии GPU
      status: 'idle',
      utilization: 0,
      memoryUsage: '0 MB',
      memoryTotal: '0 MB',
      speedup: 1,
      kernelsExecuted: 0,
      averageKernelTime: 0
    },
    activityLog: [
      {
        timestamp: now,
        message: `Запуск ${type === 'portfolio' ? 'портфельного' : 'обычного'} бэктеста`,
        level: 'info' as const,
        stage: 'initializing' as const
      }
    ],
    memoryUsage: 0,
    estimatedCompletion: 0
  };
  
  // Сохраняем прогресс в localStorage для восстановления после перезагрузки
  localStorage.setItem('backtester_progress', JSON.stringify({
    jobId,
    startTime: now,
    type,
    stage: 'initializing'
  }));
};

const startBacktest = async () => {
  if (!localStrategyParams.value) {
    safeToast({ severity: 'error', summary: 'Ошибка', detail: 'Параметры стратегии не установлены!', life: 3000 });
    return;
  }

  if (backtestStore.isPortfolioMode) {
    return startPortfolioBacktest();
  } else {
    return startSingleBacktest();
  }
};

const startSingleBacktest = async () => {
  if (!pairSymbol.value || !timeframe.value || !startDate.value || !endDate.value || initialCapital.value === null || initialCapital.value <= 0) {
    safeToast({ severity: 'error', summary: 'Ошибка', detail: 'Не все параметры для запуска бектеста заполнены корректно!', life: 4000 });
    return;
  }

  // Проверка логики дат для обычного бектеста
  if (startDate.value >= endDate.value) {
    safeToast({ 
      severity: 'error', 
      summary: 'Ошибка валидации', 
      detail: 'Дата начала должна быть раньше даты окончания!', 
      life: 4000 
    });
    return;
  }

  // Проверка слишком далекого будущего для обычного бектеста  
  const now = new Date();
  if (endDate.value > now) {
    safeToast({ 
      severity: 'warn', 
      summary: 'Предупреждение', 
      detail: 'Дата окончания в будущем. Для данной пары могут отсутствовать данные.', 
      life: 5000 
    });
  }

  const runParams: BacktestRunParameters = {
    pairSymbol: pairSymbol.value,
    timeframe: timeframe.value,
    startDate: startDate.value.toISOString().split('T')[0],
    endDate: endDate.value.toISOString().split('T')[0],
    initialCapital: initialCapital.value,
    strategyParameters: JSON.parse(JSON.stringify(localStrategyParams.value)),
    exchange: selectedExchange.value,
    useGPU: useGPU.value,
    simulateConfirmation: useExecutionProfile.value ? simulateConfirmation.value : undefined,
    executionProfile: useExecutionProfile.value ? JSON.parse(JSON.stringify(executionProfile.value)) : undefined,
  };

  const paramsToStore = {
      pairSymbol: runParams.pairSymbol,
      timeframe: runParams.timeframe,
      startDate: runParams.startDate,
      endDate: runParams.endDate,
      initialCapital: runParams.initialCapital,
      strategyParameters: runParams.strategyParameters,
      exchange: runParams.exchange,
      useExecutionProfile: useExecutionProfile.value,
      simulateConfirmation: runParams.simulateConfirmation,
      executionProfile: runParams.executionProfile,
  };
  localStorage.setItem(BACKTESTER_PARAMS_KEY, JSON.stringify(paramsToStore));

  safeToast({ severity: 'info', summary: 'Запуск Бектеста', detail: 'Инициация процесса бектестинга...', life: 3000 });
  pendingJobId.value = null;
  backtestStore.isLoading = true;
  backtestStore.error = null;
  backtestStore.results = null;
  
  // НОВОЕ: Добавляем timeout для предотвращения зависания UI
  const backtestTimeout = setTimeout(() => {
    if (backtestStore.isLoading && !pendingJobId.value) {
      console.warn('[BacktesterView] Backtest timeout reached, forcing cleanup');
      backtestStore.forceStateCleanup();
      safeToast({ 
        severity: 'warn', 
        summary: 'Превышено время ожидания', 
        detail: 'Время выполнения бэктеста превышено. Попробуйте еще раз.', 
        life: 7000 
      });
    }
  }, 120000); // 2 минуты timeout
  
  try {
    const response = await backtestStore.runBacktest(runParams);

    if (response && response.status === 202) {
      pendingJobId.value = response.data?.jobDetails?.jobId || response.data?.jobIds?.[0] || null;
      
      // Инициализируем прогресс с реальным jobId
      if (pendingJobId.value) {
        initializeProgress(pendingJobId.value, 'single');
      }
      
      // Сохраняем состояние активного сканирования
      saveActiveJobState(pendingJobId.value, 'single', {
        pairSymbol: runParams.pairSymbol,
        timeframe: runParams.timeframe,
        startDate: runParams.startDate,
        endDate: runParams.endDate
      });
      
      safeToast({
        severity: 'info',
        summary: 'Бектест в Очереди',
        detail: response.data?.message || 'Бектест поставлен в очередь и будет выполнен фоново.',
        life: 5000
      });
    } else if (response && response.status === 200) {
      // ИСПРАВЛЕНО: Используем новые методы store для установки результатов
      backtestStore.setResults(response.data as BacktestResult);
      
      // НОВОЕ: Очищаем timeout при успешном завершении
      clearTimeout(backtestTimeout);
      
      try {
        // Безопасное сохранение результатов обычного бэктеста
        const resultString = JSON.stringify(response.data);
        const resultSizeKB = new Blob([resultString]).size / 1024;
        
        if (resultSizeKB < 2048) { // Лимит 2MB для обычных результатов
          localStorage.setItem(BACKTESTER_RESULTS_KEY, resultString);
          console.log(`[BacktesterView] Backtest results saved to localStorage (${resultSizeKB.toFixed(1)}KB)`);
        } else {
          console.warn(`[BacktesterView] Backtest results too large for localStorage (${resultSizeKB.toFixed(1)}KB), skipping save`);
        }
      } catch (error) {
        console.warn('[BacktesterView] Failed to save backtest results to localStorage:', error);
      }
      safeToast({ severity: 'success', summary: 'Завершено', detail: 'Бектест успешно выполнен!', life: 3000 });
    } else {
        let detailMessage = 'Получен неожиданный ответ от сервера.';
        if (response && response.data && typeof response.data === 'string') {
            detailMessage = response.data;
        } else if (response && response.data?.message) {
            detailMessage = response.data.message;
        } else if (response && response.status) {
            detailMessage = `Сервер вернул статус ${response.status}.`;
        }
        
        // ИСПРАВЛЕНО: Используем новый метод store для установки ошибки
        backtestStore.setError(detailMessage);
        
        // НОВОЕ: Очищаем timeout при ошибке
        clearTimeout(backtestTimeout);
        
        safeToast({ severity: 'error', summary: 'Ошибка Сервера', detail: detailMessage, life: 7000 });
    }

  } catch (error: any) {
    logger.error('[BacktesterView] Error in single backtest:', error);
    backtestStore.isLoading = false;
    handleBacktestError(error);
  }
};

const startPortfolioBacktest = async () => {
  if (!portfolioParams.value.pairSymbols || portfolioParams.value.pairSymbols.length < 2) {
    safeToast({ 
      severity: 'error', 
      summary: 'Ошибка валидации', 
      detail: 'Выберите как минимум 2 торговые пары для портфельного бектеста!', 
      life: 4000 
    });
    return;
  }

  if (!portfolioTimeframe.value || !portfolioStartDate.value || !portfolioEndDate.value || portfolioParams.value.initialPortfolioCapital <= 0) {
    let missingFields = [];
    if (!portfolioTimeframe.value) missingFields.push('таймфрейм');
    if (!portfolioStartDate.value) missingFields.push('дата начала');
    if (!portfolioEndDate.value) missingFields.push('дата окончания');
    if (portfolioParams.value.initialPortfolioCapital <= 0) missingFields.push('корректный начальный капитал');
    
    safeToast({ 
      severity: 'error', 
      summary: 'Ошибка валидации', 
      detail: `Не заполнены следующие поля: ${missingFields.join(', ')}.`, 
      life: 4000 
    });
    return;
  }

  // Проверка логики дат
  if (portfolioStartDate.value >= portfolioEndDate.value) {
    safeToast({ 
      severity: 'error', 
      summary: 'Ошибка валидации', 
      detail: 'Дата начала должна быть раньше даты окончания!', 
      life: 4000 
    });
    return;
  }

  // Проверка слишком далекого будущего
  const now = new Date();
  if (portfolioEndDate.value > now) {
    safeToast({ 
      severity: 'warn', 
      summary: 'Предупреждение', 
      detail: 'Дата окончания в будущем. Для некоторых пар могут отсутствовать данные.', 
      life: 5000 
    });
  }

  const runParams: PortfolioBacktestRunParameters = {
    pairSymbols: portfolioParams.value.pairSymbols,
    timeframe: portfolioTimeframe.value,
    startDate: portfolioStartDate.value.toISOString().split('T')[0],
    endDate: portfolioEndDate.value.toISOString().split('T')[0],
    initialPortfolioCapital: portfolioParams.value.initialPortfolioCapital,
    strategyParameters: JSON.parse(JSON.stringify(localStrategyParams.value)),
    useGPU: useGPU.value,
    portfolioSettings: portfolioParams.value.portfolioSettings,
    exchange: selectedExchange.value,
    simulateConfirmation: portfolioUseExecutionProfile.value ? portfolioSimulateConfirmation.value : undefined,
    executionProfile: portfolioUseExecutionProfile.value ? JSON.parse(JSON.stringify(portfolioExecutionProfile.value)) : undefined,
  };

  const paramsToStore = {
      portfolioParams: portfolioParams.value,
      timeframe: portfolioTimeframe.value,
      startDate: portfolioStartDate.value.toISOString().split('T')[0],
      endDate: portfolioEndDate.value.toISOString().split('T')[0],
      exchange: selectedExchange.value,
      useExecutionProfile: portfolioUseExecutionProfile.value,
      simulateConfirmation: portfolioSimulateConfirmation.value,
      executionProfile: portfolioExecutionProfile.value,
  };
  localStorage.setItem(PORTFOLIO_PARAMS_KEY, JSON.stringify(paramsToStore));

  safeToast({ severity: 'info', summary: 'Запуск Портфельного Бектеста', detail: 'Инициация процесса портфельного бектестинга...', life: 3000 });
  pendingJobId.value = null;
  backtestStore.isLoading = true;
  backtestStore.error = null;
  backtestStore.portfolioResults = null;
  
  try {
    const response = await backtestStore.runPortfolioBacktest(runParams);

    if (response && response.status === 202) {
      pendingJobId.value = response.data?.jobDetails?.jobId || response.data?.jobIds?.[0] || null;
      
      // Инициализируем прогресс с реальным jobId
      if (pendingJobId.value) {
        initializeProgress(pendingJobId.value, 'portfolio');
      }
      
      // Сохраняем состояние активного портфельного сканирования
      saveActiveJobState(pendingJobId.value, 'portfolio', {
        pairSymbols: runParams.pairSymbols,
        timeframe: runParams.timeframe,
        startDate: runParams.startDate,
        endDate: runParams.endDate,
        initialPortfolioCapital: runParams.initialPortfolioCapital
      });
      
      // Дополнительная информация о парах
      const jobDetails = response.data?.jobDetails;
      let detailMessage = response.data?.message || 'Портфельный бектест поставлен в очередь и будет выполнен фоново.';
      
      if (jobDetails) {
        if (jobDetails.pairsNeedingData && jobDetails.pairsNeedingData.length > 0) {
          detailMessage += ` Дозагрузка данных требуется для: ${jobDetails.pairsNeedingData.join(', ')}.`;
        }
        if (jobDetails.pairsReady && jobDetails.pairsReady.length > 0) {
          detailMessage += ` Готовы к тестированию: ${jobDetails.pairsReady.join(', ')}.`;
        }
      }
      
      safeToast({
        severity: 'info',
        summary: 'Портфельный Бектест в Очереди',
        detail: detailMessage,
        life: 8000
      });
    } else if (response && response.status === 200) {
      backtestStore.portfolioResults = response.data as PortfolioBacktestResult;
      backtestStore.isLoading = false;
      try {
        // Безопасное сохранение портфельных результатов
        const resultData = response.data;
        const summaryResult = {
          overallMetrics: resultData.overallMetrics,
          metricsByPair: resultData.metricsByPair,
          configUsed: resultData.configUsed,
          _largeDataSavedToFile: resultData._largeDataSavedToFile,
          _downloadUrl: resultData._downloadUrl,
          _fullDataSize: resultData._fullDataSize,
          _dataReduced: resultData._dataReduced,
          _reducedTradesCount: resultData._reducedTradesCount,
          _originalTradesCount: resultData._originalTradesCount,
          timestamp: Date.now()
        };
        
        const resultString = JSON.stringify(summaryResult);
        const resultSizeKB = new Blob([resultString]).size / 1024;
        
        if (resultSizeKB < 1024) {
          localStorage.setItem(PORTFOLIO_RESULTS_KEY, resultString);
          console.log(`[BacktesterView] Portfolio results saved to localStorage (${resultSizeKB.toFixed(1)}KB)`);
        } else {
          console.warn(`[BacktesterView] Portfolio results too large for localStorage (${resultSizeKB.toFixed(1)}KB), skipping save`);
        }
      } catch (error) {
        console.warn('[BacktesterView] Failed to save portfolio results to localStorage:', error);
      }
      safeToast({ severity: 'success', summary: 'Завершено', detail: 'Портфельный бектест успешно выполнен!', life: 3000 });
      backtestStore.clearCurrentAbortController();
    } else {
        backtestStore.isLoading = false;
        let detailMessage = 'Получен неожиданный ответ от сервера.';
        if (response && response.data && typeof response.data === 'string') {
            detailMessage = response.data;
        } else if (response && response.data?.message) {
            detailMessage = response.data.message;
        }
        
        backtestStore.error = detailMessage;
        safeToast({ severity: 'error', summary: 'Ошибка Сервера', detail: detailMessage, life: 7000 });
    }

  } catch (error: any) {
    logger.error('[BacktesterView] Error in portfolio backtest:', error);
    backtestStore.isLoading = false;
    handleBacktestError(error);
  }
};

const handleBacktestError = (error: any) => {
  let errorMessage = 'Произошла ошибка при запуске бектеста.';
  let errorSummary = 'Ошибка Запуска';

  if (error.name === 'AbortError') {
      errorMessage = 'Бектест был отменен.';
      errorSummary = 'Отменено';
  } else if (error.response && error.response.data) {
    if (typeof error.response.data === 'string') {
      errorMessage = error.response.data;
    } else if (error.response.data.message) {
      errorMessage = error.response.data.message;
    }
    errorSummary = `Ошибка ${error.response.status || 'Сервера'}`;
    backtestStore.clearCurrentAbortController();
  } else if (error.message) {
      errorMessage = error.message;
      backtestStore.clearCurrentAbortController();
  }
  
  backtestStore.error = errorMessage;
  safeToast({ severity: 'error', summary: errorSummary, detail: errorMessage, life: 7000 });
};

const stopBacktest = () => {
  console.log('Остановка бектеста...');
  if (backtestStore.abortRequest) {
    backtestStore.abortRequest();
    safeToast({ severity: 'warn', summary: 'Остановка', detail: 'Запрос на остановку бектеста отправлен.', life: 3000 });
  } else {
    safeToast({ severity: 'info', summary: 'Остановка', detail: 'Функция остановки не реализована в сторе.', life: 3000 });
  }
};

const resetBacktestSettings = () => {
  settingsStore.resetToDefaults();
  safeToast({ severity: 'info', summary: 'Настройки сброшены', detail: 'Параметры стратегии установлены по умолчанию.', life: 3000 });
};

const toggleSettingsPanel = (event: any) => {
  console.log('Settings Panel toggled', event);
};

const toggleResultsPanel = (event: any) => {
  console.log('Results Panel toggled', event);
};

const onModeChange = () => {
  console.log('Mode changed to:', backtestStore.isPortfolioMode);
  
  // Сохраняем режим бектестера
  localStorage.setItem(BACKTESTER_MODE_KEY, JSON.stringify({
    isPortfolioMode: backtestStore.isPortfolioMode
  }));
  
  // Если есть активное сканирование, предупреждаем пользователя
  if (pendingJobId.value) {
    safeToast({
      severity: 'warn',
      summary: 'Внимание',
      detail: 'Смена режима во время активного сканирования может привести к потере отслеживания прогресса.',
      life: 5000
    });
  }
  
  safeToast({ 
    severity: 'info', 
    summary: 'Режим изменен', 
    detail: backtestStore.isPortfolioMode ? 'Переключено на портфельный бектест' : 'Переключено на обычный бектест',
    life: 3000 
  });
};

// НОВОЕ: Обработчик изменения GPU режима
const onGPUModeChange = () => {
  console.log('GPU mode changed to:', useGPU.value);
  
  // Сохраняем режим GPU в localStorage
  localStorage.setItem('backtester_gpu_mode', JSON.stringify({
    useGPU: useGPU.value
  }));
  
  // Если есть активное сканирование, предупреждаем пользователя
  if (pendingJobId.value) {
    safeToast({
      severity: 'warn',
      summary: 'Внимание',
      detail: 'Смена режима ускорения во время активного бектеста может привести к неожиданным результатам.',
      life: 5000
    });
  }
  
  safeToast({ 
    severity: useGPU.value ? 'success' : 'info', 
    summary: 'Режим ускорения изменен', 
    detail: useGPU.value ? 
      '⚡ GPU ускорение включено! Бэктесты будут выполняться на RTX 4060 с CuPy/CUDA.' : 
      '🖥️ Переключено на CPU вычисления. Классический режим.',
    life: 4000 
  });
};

// НОВОЕ: Проверка статуса GPU сервиса
const checkGPUStatus = async () => {
  try {
    gpuStatus.value = 'Проверка...';
    const { checkGPUHealth } = await import('@/services/apiService');
    const healthResponse = await checkGPUHealth();
    
    gpuAvailable.value = healthResponse.gpu_available;
    
    if (healthResponse.gpu_available) {
      gpuStatus.value = 'Доступен ✅';
      logger.info('[BacktesterView] GPU service is available');
    } else {
      gpuStatus.value = 'Недоступен ❌';
      logger.warn('[BacktesterView] GPU service is not available:', healthResponse.error);
      
      // Если GPU недоступен, автоматически отключаем GPU режим
      if (useGPU.value) {
        useGPU.value = false;
        safeToast({
          severity: 'warn',
          summary: 'GPU недоступен',
          detail: 'GPU сервис недоступен. Переключено на CPU режим.',
          life: 5000
        });
      }
    }
  } catch (error: any) {
    gpuAvailable.value = false;
    gpuStatus.value = 'Ошибка ❌';
    logger.error('[BacktesterView] Error checking GPU status:', error);
    
    // При ошибке также отключаем GPU режим
    if (useGPU.value) {
      useGPU.value = false;
      safeToast({
        severity: 'error',
        summary: 'Ошибка GPU',
        detail: 'Не удалось проверить статус GPU сервиса. Переключено на CPU режим.',
        life: 5000
      });
    }
  }
};

// Словарик для отображаемых названий ключей метрик
const displayMetricKeys: Record<string, string> = {
  totalPnl: 'Total PnL',
  totalPnlPercentage: 'Total PnL %',
  totalTrades: 'Total Trades',
  winningTrades: 'Winning Trades',
  losingTrades: 'Losing Trades',
  winRate: 'Win Rate %',
  maxDrawdown: 'Max Drawdown %',
  profitFactor: 'Profit Factor',
  initialCapital: 'Initial Capital',
  finalCapital: 'Final Capital',
  grossProfit: 'Gross Profit',
  grossLoss: 'Gross Loss',
  averageTradePnl: 'Average Trade PnL',
  avgWinningTrade: 'Avg Winning Trade',
  avgLosingTrade: 'Avg Losing Trade',
  expectancy: 'Expectancy',
  sharpeRatio: 'Sharpe Ratio',
  sortinoRatio: 'Sortino Ratio',
  cagr: 'CAGR %',
  volatility: 'Volatility %',
  equityCurve: 'Equity Curve',
  durationMs: 'Duration (ms)',
};

const getDisplayKey = (key: string | number) => {
  return displayMetricKeys[key.toString()] || key.toString();
};

const formatMetric = (key: string | number, value: any): string => {
  const sKey = key.toString();

  if (typeof value === 'string' && value.includes('%')) {
    return value;
  }

  if (typeof value === 'number') {
    const percentageKeys = [
      'totalPnlPercentage', 
      'winRate', 
      'maxDrawdown',
    ];

    const currencyLikeKeys = [
      'totalPnl',
      'initialCapital',
      'finalCapital',
      'grossProfit',
      'grossLoss',
      'averageTradePnl',
      'avgWinningTrade',
      'avgLosingTrade',
      'expectancy'
    ];

    if (sKey === 'winRate') {
      return `${(value * 100).toFixed(2)}%`;
    } else if (percentageKeys.includes(sKey)) {
      return `${value.toFixed(2)}%`;
    }
    if (currencyLikeKeys.includes(sKey)) {
      return value.toFixed(2);
    }
    if (Number.isInteger(value)) {
        return value.toString();
    }
    return value.toFixed(2);
  }

  if (Array.isArray(value)) {
    return '[Equity Data]';
  }
  
  return String(value);
};

watch(startDate, (newVal) => {
  console.log('Start date changed:', newVal);
});
watch(endDate, (newVal) => {
  console.log('End date changed:', newVal);
});

watch(localStrategyParams, (newVal) => {
  console.log('Strategy parameters in BacktesterView updated:', newVal);
}, { deep: true });

watch(() => localStrategyParams.value?.dlc?.numProfiles, (newVal) => {
    console.log('DLC numProfiles changed in BacktesterView:', newVal);
});

// Функции для работы с состоянием активного сканирования
const saveActiveJobState = (jobId: string | null, jobType: 'single' | 'portfolio', jobParams?: any) => {
  if (jobId) {
    const activeJobState = {
      jobId,
      jobType,
      jobParams,
      timestamp: Date.now()
    };
    localStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify(activeJobState));
    logger.info(`[BacktesterView] Saved active job state: ${jobId} (${jobType})`);
  } else {
    localStorage.removeItem(ACTIVE_JOB_KEY);
    logger.info('[BacktesterView] Cleared active job state');
  }
};

const restoreActiveJobState = async () => {
  logger.info('[BacktesterView] Starting restoreActiveJobState...');
  
  const savedJobStateRaw = localStorage.getItem(ACTIVE_JOB_KEY);
  if (!savedJobStateRaw) {
    logger.info('[BacktesterView] No active job state found in localStorage');
    
    // ДОПОЛНИТЕЛЬНАЯ ПРОВЕРКА: Проверяем активные задачи на сервере
    try {
      logger.info('[BacktesterView] Checking for active jobs on server...');
      const { getJobs } = await import('@/services/apiService');
      // ИСПРАВЛЕНИЕ: Исключаем завершенные задачи из поиска активных
      const activeJobs = await getJobs({ status: ['active', 'waiting', 'wait'] });
      
      if (activeJobs && activeJobs.length > 0) {
        // Ищем задачи связанные с бэктестом
        const backtestJobs = activeJobs.filter(job => 
          job.name === 'FETCH_CANDLES_AND_RUN_BACKTEST' || 
          job.name === 'FETCH_PORTFOLIO_DATA_AND_RUN_BACKTEST'
        );
        
        if (backtestJobs.length > 0) {
          const job = backtestJobs[0]; // Берем первую найденную задачу
          const jobType = job.name === 'FETCH_PORTFOLIO_DATA_AND_RUN_BACKTEST' ? 'portfolio' : 'single';
          
          logger.info(`[BacktesterView] Found backtest job on server: ${job.id} (${jobType}) with status: ${job.status}`);
          
          // ИСПРАВЛЕНИЕ: Проверяем детальный статус задачи перед восстановлением
          const { getJobDetails } = await import('@/services/apiService');
          const jobDetails = await getJobDetails(job.id);
          
          // Восстанавливаем ТОЛЬКО если задача действительно активна или ожидает выполнения
          if (jobDetails.status === 'active' || jobDetails.status === 'waiting' || jobDetails.status === 'wait') {
            logger.info(`[BacktesterView] Restoring active job from server: ${job.id} with status: ${jobDetails.status}`);
            
            // Восстанавливаем состояние активной задачи
            pendingJobId.value = job.id;
            currentJobStatus.value = jobDetails.status;
            backtestStore.isLoading = true;
            
            // Сохраняем найденную задачу в localStorage для будущих восстановлений
            saveActiveJobState(job.id, jobType);
            
            // Восстанавливаем прогресс
            restoreProgressFromStorage();
            
            safeToast({
              severity: 'info',
              summary: 'Восстановление состояния',
              detail: `Обнаружена активная задача ${jobType === 'portfolio' ? 'портфельного' : 'обычного'} бектеста. Статус: ${getJobStatusText(jobDetails.status)}. ID: ${job.id}`,
              life: 5000
            });
            
            logger.info(`[BacktesterView] Successfully restored active job from server: ${job.id}`);
            return;
          } else {
            logger.info(`[BacktesterView] Job ${job.id} has status '${jobDetails.status}', not restoring as active`);
          }
        }
      }
      
      logger.info('[BacktesterView] No active backtest jobs found on server');
    } catch (serverCheckError) {
      logger.warn('[BacktesterView] Failed to check active jobs on server:', serverCheckError);
    }
    
    return;
  }

    try {
      const savedJobState = JSON.parse(savedJobStateRaw);
      const { jobId, jobType, timestamp } = savedJobState;
    
    logger.info(`[BacktesterView] Found saved job state:`, { jobId, jobType, timestamp });
    
    if (!jobId || !jobType) {
      logger.warn('[BacktesterView] Invalid job state data, clearing');
      localStorage.removeItem(ACTIVE_JOB_KEY);
      return;
    }
      
      // Проверяем, что задача не слишком старая (максимум 24 часа)
      const maxAge = 24 * 60 * 60 * 1000; // 24 часа
      if (Date.now() - timestamp > maxAge) {
      logger.info('[BacktesterView] Active job state too old, clearing job state only');
        localStorage.removeItem(ACTIVE_JOB_KEY);
        return;
      }
      
      // Проверяем реальный статус задачи на сервере
      try {
      logger.info(`[BacktesterView] Checking job status for jobId: ${jobId}`);
        const { getJobDetails } = await import('@/services/apiService');
        const jobDetails = await getJobDetails(jobId);
        
      logger.info(`[BacktesterView] Received job details:`, jobDetails);
      
      // Восстанавливаем ТОЛЬКО если задача все еще активна или ожидает выполнения
        if (jobDetails.status === 'active' || jobDetails.status === 'waiting' || jobDetails.status === 'wait') {
        logger.info(`[BacktesterView] Restoring active job: ${jobId} with status: ${jobDetails.status}`);
        
          pendingJobId.value = jobId;
        currentJobStatus.value = jobDetails.status;
          backtestStore.isLoading = true;
          
          // Восстанавливаем прогресс
          restoreProgressFromStorage();
          
          // Показываем уведомление о восстановлении состояния
          safeToast({
            severity: 'info',
            summary: 'Восстановление состояния',
          detail: `Обнаружен активный ${jobType === 'portfolio' ? 'портфельный' : 'обычный'} бектест. Статус: ${getJobStatusText(jobDetails.status)}. ID: ${jobId}`,
            life: 5000
          });
          
        logger.info(`[BacktesterView] Successfully restored active job state: ${jobId} (${jobType}) with status: ${jobDetails.status}`);
        } else if (jobDetails.status === 'completed') {
        // Задача завершена - просто очищаем состояние активной задачи, НО результаты оставляем!
        logger.info(`[BacktesterView] Job ${jobId} completed, results should be available`);
          safeToast({
          severity: 'success',
            summary: 'Задача завершена',
          detail: `${jobType === 'portfolio' ? 'Портфельный' : 'Обычный'} бектест завершен. Результаты доступны.`,
          life: 5000
          });
        // Очищаем только состояние активной задачи, но НЕ трогаем результаты!
          localStorage.removeItem(ACTIVE_JOB_KEY);
        } else if (jobDetails.status === 'failed') {
        // Задача провалилась - очищаем состояние и показываем ошибку
        logger.info(`[BacktesterView] Job ${jobId} failed, clearing active job state`);
          safeToast({
            severity: 'error',
            summary: 'Задача провалилась',
          detail: `${jobType === 'portfolio' ? 'Портфельный' : 'Обычный'} бектест завершился с ошибкой.`,
            life: 7000
          });
        // Очищаем только состояние активной задачи
          localStorage.removeItem(ACTIVE_JOB_KEY);
        } else {
        // Неизвестный статус - очищаем состояние активной задачи
        logger.info(`[BacktesterView] Job ${jobId} has status: ${jobDetails.status}, clearing active job state`);
          localStorage.removeItem(ACTIVE_JOB_KEY);
        }
    } catch (jobCheckError: any) {
        // Если не можем получить статус задачи (возможно, она была удалена)
        logger.warn(`[BacktesterView] Could not check job ${jobId} status:`, jobCheckError);
      
      // Проверяем тип ошибки
      if (jobCheckError.response?.status === 404) {
        logger.info(`[BacktesterView] Job ${jobId} not found (404), clearing state`);
        safeToast({
          severity: 'info',
          summary: 'Задача не найдена',
          detail: `Задача ${jobId} не найдена на сервере. Возможно, она была завершена или удалена.`,
          life: 5000
        });
      } else {
        logger.error(`[BacktesterView] API error checking job status:`, jobCheckError);
        safeToast({
          severity: 'warning',
          summary: 'Ошибка подключения',
          detail: `Не удалось проверить статус задачи. Результаты сохранены локально.`,
          life: 5000
        });
        
        // При ошибке API все равно пытаемся восстановить состояние загрузки
        // если задача была недавно сохранена (менее 10 минут назад)
        const recentJobAge = 10 * 60 * 1000; // 10 минут
        if (Date.now() - timestamp < recentJobAge) {
          logger.info(`[BacktesterView] Recent job (${jobId}), attempting to restore loading state`);
          pendingJobId.value = jobId;
          currentJobStatus.value = 'unknown';
          backtestStore.isLoading = true;
          
          safeToast({
            severity: 'info',
            summary: 'Восстановление состояния',
            detail: `Восстановлено состояние недавней задачи ${jobId}. Статус будет обновлен при подключении.`,
            life: 5000
          });
        }
      }
      
      // Очищаем только состояние активной задачи, результаты оставляем
        localStorage.removeItem(ACTIVE_JOB_KEY);
      }
    } catch (e) {
      logger.error('[BacktesterView] Failed to parse active job state:', e);
      localStorage.removeItem(ACTIVE_JOB_KEY);
    throw e; // Пробрасываем ошибку для retry логики
  }
};

const clearActiveJobState = () => {
  pendingJobId.value = null;
  currentJobStatus.value = null;
  saveActiveJobState(null, 'single');
};

// Безопасный показ toast уведомлений
const safeToast = (toastConfig: any) => {
  if (isComponentMounted.value && toast) {
    try {
      toast.add(toastConfig);
    } catch (error) {
      console.warn('[BacktesterView] Failed to show toast:', error);
    }
  }
};

// Функция для получения дополнительных метрик (исключая основные карточки)
const getAdditionalMetrics = (metrics: any) => {
  if (!metrics) return {};
  
  const mainMetrics = ['totalPnl', 'totalTrades', 'winRate', 'profitFactor', 'initialCapital', 'finalCapital', 'maxDrawdown', 'winningTrades', 'losingTrades'];
  const additional: any = {};
  
  Object.keys(metrics).forEach(key => {
    if (!mainMetrics.includes(key) && key !== 'equityCurve') {
      additional[key] = metrics[key];
    }
  });
  
  return additional;
};

// Функция для получения всех сделок портфеля
const getAllPortfolioTrades = () => {
  if (!portfolioResultsStore.value || !portfolioResultsStore.value.tradesByPair) {
    console.log('[BacktesterView] No portfolio results or tradesByPair');
    return [];
  }
  
  try {
    const trades: (any & { pair: string })[] = [];
    
    console.log('[BacktesterView] Portfolio results analysis:', {
      portfolioResults: portfolioResultsStore.value,
      tradesByPair: portfolioResultsStore.value.tradesByPair,
      totalPairsWithTrades: Object.keys(portfolioResultsStore.value.tradesByPair || {}).length,
      overallMetrics: portfolioResultsStore.value.overallMetrics
    });
    
    Object.entries(portfolioResultsStore.value.tradesByPair).forEach(([pair, pairTrades]) => {
      if (pairTrades && Array.isArray(pairTrades)) {
        console.log(`[BacktesterView] Processing trades for ${pair}: ${pairTrades.length} trades`);
        
        if (pairTrades.length > 0) {
          // Анализ временного диапазона сделок
          const timestamps = pairTrades
            .map((trade: any) => trade.entryTimestamp)
            .filter(t => t && typeof t === 'number')
            .sort((a, b) => a - b);
            
          if (timestamps.length > 0) {
            const earliestTrade = new Date(timestamps[0]).toISOString();
            const latestTrade = new Date(timestamps[timestamps.length - 1]).toISOString();
            
            console.log(`[BacktesterView] ${pair} trade dates: ${earliestTrade} to ${latestTrade}`);
            
            // Группировка по годам
            const tradesByYear: Record<string, number> = {};
            timestamps.forEach(ts => {
              const year = new Date(ts).getFullYear().toString();
              tradesByYear[year] = (tradesByYear[year] || 0) + 1;
            });
            
            console.log(`[BacktesterView] ${pair} trades by year:`, tradesByYear);
          }
        }
        
        pairTrades.forEach((trade: any) => {
          if (trade && typeof trade === 'object') {
            trades.push({ 
              ...trade, 
              pair: pair || 'Unknown',
              pnl: trade.pnl || 0,
              entryTimestamp: trade.entryTimestamp || 0,
              exitTimestamp: trade.exitTimestamp || 0,
              entryPrice: trade.entryPrice || 0,
              exitPrice: trade.exitPrice || 0,
              size: trade.size || 0
            });
          }
        });
      } else {
        console.log(`[BacktesterView] No trades for ${pair} or invalid format`);
      }
    });
    
    // Финальная статистика
    const finalTradesByYear: Record<string, number> = {};
    trades.forEach(trade => {
      if (trade.entryTimestamp) {
        const year = new Date(trade.entryTimestamp).getFullYear().toString();
        finalTradesByYear[year] = (finalTradesByYear[year] || 0) + 1;
      }
    });
    
    console.log('[BacktesterView] Final portfolio trades summary:', {
      totalTrades: trades.length,
      tradesByYear: finalTradesByYear,
      overallMetricsTotalTrades: portfolioResultsStore.value.overallMetrics?.totalPortfolioTrades,
      dataReduced: portfolioResultsStore.value._dataReduced,
      originalTradesCount: portfolioResultsStore.value._originalTradesCount,
      reducedTradesCount: portfolioResultsStore.value._reducedTradesCount,
      note: portfolioResultsStore.value._note
    });
    
    // Сортируем по времени входа (новые сначала)
    return trades.sort((a: any, b: any) => (b.entryTimestamp || 0) - (a.entryTimestamp || 0));
  } catch (error) {
    console.error('Error processing all trades data:', error);
    return [];
  }
};

// Функция для форматирования даты
const formatDate = (timestamp: number) => {
  return new Date(timestamp).toLocaleString('ru-RU', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
};

// Функция для обработки клика на сделку
const onTradeClick = async (event: any) => {
  console.log('[BacktesterView] Trade clicked:', event.data);
  await openTradeChart(event.data);
};

const onTradeChartClose = () => {
  showTradeChart.value = false;
  selectedTrade.value = null;
  tradeCandleData.value = null;
};

// Функция для получения читаемого текста статуса
const getJobStatusText = (status: string): string => {
  const statusMap: Record<string, string> = {
    'waiting': 'Ожидает в очереди',
    'wait': 'Ожидает в очереди', 
    'active': 'Выполняется',
    'completed': 'Завершена',
    'failed': 'Ошибка',
    'delayed': 'Отложена',
    'paused': 'Приостановлена'
  };
  return statusMap[status] || status;
};

const manualCheckActiveJobs = async () => {
  try {
    logger.info('[BacktesterView] Checking for active jobs on server...');
    const { getJobs } = await import('@/services/apiService');
    const activeJobs = await getJobs({ status: ['active', 'waiting', 'wait'] });
    
    if (activeJobs && activeJobs.length > 0) {
      logger.info('[BacktesterView] Active jobs found on server:', activeJobs);
      safeToast({
        severity: 'success',
        summary: 'Активные задачи найдены',
        detail: `На сервере найдены активные задачи: ${activeJobs.map(job => job.name).join(', ')}`,
        life: 5000
      });
    } else {
      logger.info('[BacktesterView] No active jobs found on server');
      safeToast({
        severity: 'info',
        summary: 'Активные задачи не найдены',
        detail: 'На сервере не найдено активных задач.',
        life: 5000
      });
    }
  } catch (error) {
    logger.error('[BacktesterView] Error checking active jobs:', error);
    safeToast({
      severity: 'error',
      summary: 'Ошибка проверки активных задач',
      detail: 'Не удалось получить информацию о активных задачах на сервере.',
      life: 7000
    });
  }
};

// Функция для повторной попытки загрузки графика с другим таймфреймом
const retryLoadChart = async () => {
  if (!selectedTrade.value) return;
  
  safeToast({
    severity: 'info',
    summary: 'Повторная загрузка',
    detail: 'Пробуем загрузить график с другими параметрами...',
    life: 3000
  });
  
  // Повторно вызываем openTradeChart для той же сделки
  await openTradeChart(selectedTrade.value);
};

const openTradeChart = async (trade: any) => {
  if (!trade) return;
  
  selectedTrade.value = trade;
  showTradeChart.value = true;
  tradeCandleData.value = null; // Сброс данных
  
  try {
    console.log(`[BacktesterView] Fetching candle data for trade:`, {
      pair: trade.pair,
      entryTime: trade.entryTimestamp && trade.entryTimestamp > 0 ? new Date(trade.entryTimestamp).toISOString() : 'Invalid',
      exitTime: trade.exitTimestamp && trade.exitTimestamp > 0 ? new Date(trade.exitTimestamp).toISOString() : 'ongoing'
    });
    
    // УПРОЩЕННАЯ ЛОГИКА: 1500 свеч до входа + 1500 после выхода (или до настоящего времени)
    const entryTime = trade.entryTimestamp;
    const exitTime = trade.exitTimestamp || Date.now();
    
    // Получаем фактический таймфрейм бектеста
    let backtestTimeframe: string;
    if (backtestStore.isPortfolioMode) {
      backtestTimeframe = portfolioTimeframe.value || '1h';
    } else {
      backtestTimeframe = timeframe.value || '1h';
    }
    
    // Вычисляем интервал таймфрейма в миллисекундах
    const timeframeToMs: Record<string, number> = {
      '1m': 60 * 1000,
      '3m': 3 * 60 * 1000,
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '30m': 30 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '2h': 2 * 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '12h': 12 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
    };
    
    const intervalMs = timeframeToMs[backtestTimeframe] || 60 * 60 * 1000; // default 1h
    
    // НОВАЯ ЛОГИКА: 1500 свеч до входа и 1500 после выхода
    const CANDLES_BEFORE = 1500;
    const CANDLES_AFTER = 1500;
    
    const startTime = entryTime - (CANDLES_BEFORE * intervalMs);
    const endTime = exitTime + (CANDLES_AFTER * intervalMs);
    
    // Ограничиваем датами
    const now = Date.now();
    const earliestReasonableDate = new Date('2020-01-01').getTime();
    
    const effectiveStartTime = Math.max(startTime, earliestReasonableDate);
    const effectiveEndTime = Math.min(endTime, now);
    
    console.log(`[BacktesterView] SIMPLIFIED chart logic:`, {
      timeframe: backtestTimeframe,
      intervalMs,
      trade: {
        entry: new Date(entryTime).toISOString(),
        exit: exitTime > entryTime ? new Date(exitTime).toISOString() : 'ongoing'
      },
      requestedRange: {
        from: new Date(effectiveStartTime).toISOString(),
        to: new Date(effectiveEndTime).toISOString(),
        totalDays: Math.round((effectiveEndTime - effectiveStartTime) / (24 * 60 * 60 * 1000)),
        expectedCandles: CANDLES_BEFORE + CANDLES_AFTER
      }
    });
    
    // Устанавливаем информацию о таймфрейме для TradeChartModal
    selectedTrade.value.backtestTimeframe = backtestTimeframe;
    selectedTrade.value.backtestTimeRange = {
      startTime: effectiveStartTime,
      endTime: effectiveEndTime
    };
    
    // Определяем лимит свечей
    const limit = Math.min(CANDLES_BEFORE + CANDLES_AFTER + 500, 5000); // Максимум 5000 свечей
    
    // Запрос к API для получения данных в таймфрейме бектеста
    const response = await fetch('/api/data/candles', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        symbol: trade.pair,
        timeframe: backtestTimeframe,
        startTime: effectiveStartTime,
        endTime: effectiveEndTime,
        limit: limit
      })
    });
    
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }
    
    const apiData = await response.json();
    
    if (apiData.success && apiData.data && Array.isArray(apiData.data) && apiData.data.length > 0) {
      console.log(`[BacktesterView] Successfully loaded ${apiData.data.length} candles for timeframe ${backtestTimeframe}`);
      
      // Проверяем покрытие времени сделки
      const firstCandle = apiData.data[0];
      const lastCandle = apiData.data[apiData.data.length - 1];
      
      // Функция получения timestamp с поддержкой разных форматов
      const getTimestamp = (candle: any): number => {
        if (candle.timestamp && typeof candle.timestamp === 'number' && candle.timestamp > 0) {
          return candle.timestamp;
        }
        if (candle.openTime) {
          const openTime = typeof candle.openTime === 'string' ? parseInt(candle.openTime, 10) : candle.openTime;
          if (typeof openTime === 'number' && openTime > 0) {
            return openTime;
          }
        }
        if (candle.time) {
          const time = typeof candle.time === 'string' ? parseInt(candle.time, 10) : candle.time;
          if (typeof time === 'number' && time > 0) {
            return time;
          }
        }
        return 0;
      };
      
      const dataStartTime = getTimestamp(firstCandle);
      const dataEndTime = getTimestamp(lastCandle);
      const coversTradeEntry = dataStartTime && dataEndTime && dataStartTime <= trade.entryTimestamp && dataEndTime >= trade.entryTimestamp;
      
      if (coversTradeEntry) {
        safeToast({
          severity: 'success',
          summary: 'График загружен',
          detail: `График загружен: ${apiData.data.length} свечей (${backtestTimeframe}). Покрывает период сделки.`,
          life: 3000
        });
      } else {
        safeToast({
          severity: 'warn',
          summary: 'Частичные данные',
          detail: `Загружено ${apiData.data.length} свечей (${backtestTimeframe}), но данные могут не полностью покрывать период сделки.`,
          life: 5000
        });
      }
      
      tradeCandleData.value = apiData.data;
    } else {
      // Если нет данных - показываем график без данных
      console.warn(`[BacktesterView] No data found for timeframe ${backtestTimeframe}`);
      
      safeToast({
        severity: 'warn',
        summary: 'Нет данных',
        detail: `Данные для таймфрейма ${backtestTimeframe} отсутствуют. Используйте переключение таймфреймов в графике.`,
        life: 6000
      });
      
      tradeCandleData.value = null;
    }
    
  } catch (error) {
    console.error('[BacktesterView] Error fetching candle data:', error);
    
    safeToast({
      severity: 'error',
      summary: 'Ошибка загрузки данных',
      detail: `Не удалось загрузить данные для ${trade.pair}. Попробуйте переключить таймфрейм в графике.`,
      life: 5000
    });
    
    // Показываем график без данных
    tradeCandleData.value = null;
  }
};

const clearResultsCache = () => {
  // Очищаем все сохраненные результаты
  localStorage.removeItem(BACKTESTER_RESULTS_KEY);
  localStorage.removeItem(PORTFOLIO_RESULTS_KEY);
  localStorage.removeItem(ACTIVE_JOB_KEY);
  
  // Сбрасываем состояние в store
  backtestStore.results = null;
  backtestStore.portfolioResults = null;
  backtestStore.error = null;
  backtestStore.isLoading = false;
  
  // Очищаем активную задачу
  pendingJobId.value = null;
  currentJobStatus.value = null;
  
  console.log('[BacktesterView] Results cache cleared - все сохраненные результаты удалены');
  
  safeToast({ 
    severity: 'success', 
    summary: 'Кеш очищен', 
    detail: 'Все сохраненные результаты удалены. Теперь можно запустить свежий бектест.', 
    life: 4000 
  });
};

</script>

<style scoped>
.surface-ground {
  background-color: #f8f9fa; /* A slightly off-white for the page background */
}

:deep(.p-panel .p-panel-header) {
  background-color: #f1f5f9; /* Light slate gray for panel headers */
  border-bottom: 1px solid #e2e8f0;
  padding: 0.75rem 1rem; /* Adjust padding for a tighter look if desired */
}

:deep(.p-panel .p-panel-content) {
  background-color: #ffffff; /* White for panel content */
  padding: 1rem; /* Ensure consistent padding */
}

:deep(.p-panel .p-panel-header .p-panel-title) {
  font-size: 1.1rem; /* Slightly larger panel titles */
}

.p-button {
  transition: background-color 0.2s, box-shadow 0.2s, transform 0.1s;
}

.p-button:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(0,0,0,0.1);
}

/* Specific hover states from before, can be kept or rely on PrimeVue defaults */
.p-button-success:enabled:hover {
  background-color: #15803d !important;
}
.p-button-danger:enabled:hover {
  background-color: #b91c1c !important;
}
.p-button-warning:enabled:hover {
  background-color: #c2410c !important;
}

/* Styling for TabView */
:deep(.p-tabview .p-tabview-nav) {
  background-color: #f8f9fa; /* Light background for tab headers */
}

:deep(.p-tabview .p-tabview-nav li .p-tabview-nav-link) {
  transition: background-color 0.2s, color 0.2s;
}

:deep(.p-tabview .p-tabview-nav li:not(.p-highlight) .p-tabview-nav-link:hover) {
  background-color: #e9ecef;
  border-color: #dee2e6;
}

:deep(.p-tabview .p-tabview-panels) {
  background-color: #ffffff;
  padding: 0; /* Remove default panel padding if using custom inside */
}

/* Styles for sub-headers within panels */
.text-xl.font-semibold.border-b {
  color: #374151; /* Darker gray for better contrast */
  border-color: #e5e7eb; /* Light border */
}

/* Анимация для индикатора загрузки */
.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* Стили для ID задачи */
.font-mono {
  font-family: 'Courier New', monospace;
  font-size: 0.8rem;
  background-color: rgba(59, 130, 246, 0.1);
  padding: 2px 6px;
  border-radius: 4px;
}

/* Стили для компактных таблиц */
:deep(.compact-table) {
  font-size: 0.875rem;
}

:deep(.compact-table .p-datatable-wrapper) {
  overflow-x: auto;
  max-width: 100%;
}

:deep(.compact-table .p-datatable-table) {
  table-layout: fixed;
  width: 100%;
}

:deep(.compact-table .p-column-header-content) {
  padding: 0.5rem 0.25rem;
  font-size: 0.75rem;
  font-weight: 600;
}

:deep(.compact-table .p-datatable-tbody > tr > td) {
  padding: 0.4rem 0.25rem;
  word-wrap: break-word;
  overflow: hidden;
  text-overflow: ellipsis;
}

:deep(.compact-table .p-paginator) {
  padding: 0.5rem;
  font-size: 0.75rem;
}

/* Исправление для скроллбара */
:deep(.compact-table .p-datatable-scrollable-wrapper) {
  overflow: visible;
}

:deep(.compact-table .p-datatable-scrollable-body) {
  overflow: visible;
}

/* Стили для кликабельных строк таблиц */
:deep(.clickable-trades .p-datatable-tbody > tr) {
  cursor: pointer;
  transition: background-color 0.2s ease;
}

:deep(.clickable-trades .p-datatable-tbody > tr:hover) {
  background-color: rgba(59, 130, 246, 0.05) !important;
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

:deep(.clickable-trades .p-datatable-tbody > tr:active) {
  background-color: rgba(59, 130, 246, 0.1) !important;
}

/* Индикатор интерактивности */
:deep(.clickable-trades .p-datatable-tbody > tr td:first-child::before) {
  content: '👁️';
  opacity: 0;
  margin-right: 8px;
  transition: opacity 0.2s ease;
}

:deep(.clickable-trades .p-datatable-tbody > tr:hover td:first-child::before) {
  opacity: 0.6;
}
</style> 