<!--
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
    <h1 class="text-4xl font-bold mb-8 text-gray-900">Backtester</h1>

    <!-- Переключатель режимов бектестера -->
    <div class="mb-6 bg-white rounded-lg shadow p-4">
      <div class="flex items-center justify-between">
        <div class="flex items-center space-x-4">
          <h2 class="text-lg font-semibold text-gray-800">Режим бектестера</h2>
          <div class="flex items-center space-x-3">
            <span class="text-sm" :class="!backtestStore.isPortfolioMode ? 'font-semibold text-blue-600' : 'text-gray-600'">
              Одиночный
            </span>
            <InputSwitch 
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
                <Dropdown id="pairSymbol" v-model="pairSymbol" :options="tradingPairOptions" optionLabel="label" optionValue="value" placeholder="Выберите символ" :filter="true" filterPlaceholder="Поиск символа" class="w-full" />
              </div>
              <div>
                <label for="timeframe" class="block text-sm font-medium text-gray-700 mb-1">Таймфрейм</label>
                <Dropdown id="timeframe" v-model="timeframe" :options="timeframes" optionLabel="label" optionValue="value" placeholder="Выберите таймфрейм" class="w-full" />
              </div>
              <div>
                <label for="startDate" class="block text-sm font-medium text-gray-700 mb-1">Дата Начала</label>
                <Calendar id="startDate" v-model="startDate" :showIcon="true" dateFormat="dd.mm.yy" placeholder="ДД.ММ.ГГГГ" class="w-full" />
              </div>
              <div>
                <label for="endDate" class="block text-sm font-medium text-gray-700 mb-1">Дата Окончания</label>
                <Calendar id="endDate" v-model="endDate" :showIcon="true" dateFormat="dd.mm.yy" placeholder="ДД.ММ.ГГГГ" class="w-full" />
              </div>
              <div class="md:col-span-2">
                <label for="initialCapital" class="block text-sm font-medium text-gray-700 mb-1">Начальный Капитал ($)</label>
                <InputNumber id="initialCapital" v-model="initialCapital" mode="currency" currency="USD" locale="en-US" :minFractionDigits="0" :maxFractionDigits="2" placeholder="Введите сумму" class="w-full" />
              </div>
            </div>
          </div>

          <!-- Параметры запуска для портфельного бектеста -->
          <div v-else class="mb-6">
            <h2 class="text-xl font-semibold mb-4 text-gray-800 border-b pb-2">Параметры Портфельного Бектеста</h2>
            <div class="space-y-6">
              <PortfolioSettingsForm 
                v-model="portfolioParams"
                :tradingPairOptions="tradingPairOptions"
              />
              
              <!-- Общие параметры для портфеля -->
              <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                <div>
                  <label for="portfolioTimeframe" class="block text-sm font-medium text-gray-700 mb-1">Таймфрейм</label>
                  <Dropdown id="portfolioTimeframe" v-model="portfolioTimeframe" :options="timeframes" optionLabel="label" optionValue="value" placeholder="Выберите таймфрейм" class="w-full" />
                </div>
                <div></div> <!-- Пустая ячейка для грида -->
                <div>
                  <label for="portfolioStartDate" class="block text-sm font-medium text-gray-700 mb-1">Дата Начала</label>
                  <Calendar id="portfolioStartDate" v-model="portfolioStartDate" :showIcon="true" dateFormat="dd.mm.yy" placeholder="ДД.ММ.ГГГГ" class="w-full" />
                </div>
                <div>
                  <label for="portfolioEndDate" class="block text-sm font-medium text-gray-700 mb-1">Дата Окончания</label>
                  <Calendar id="portfolioEndDate" v-model="portfolioEndDate" :showIcon="true" dateFormat="dd.mm.yy" placeholder="ДД.ММ.ГГГГ" class="w-full" />
                </div>
              </div>
            </div>
          </div>

          <!-- Управление бектестом -->
          <div class="mb-6">
            <h2 class="text-xl font-semibold mb-4 text-gray-800 border-b pb-2">Управление Бектестом</h2>
            
            <!-- Индикатор восстановленного состояния -->
            <div v-if="pendingJobId && backtestIsLoading" class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
              <div class="flex items-center">
                <i class="pi pi-sync spin text-blue-600 mr-2"></i>
                <div>
                  <h4 class="text-sm font-medium text-blue-800 mb-1">Активное сканирование</h4>
                  <p class="text-sm text-blue-700">
                    ID задачи: <span class="font-mono">{{ pendingJobId }}</span>
                  </p>
                  <p class="text-xs text-blue-600 mt-1">
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
            </div>
            <div v-if="backtestIsLoading" class="mt-5">
              <ProgressBar mode="indeterminate" style="height: .6em" />
              <p class="text-sm text-gray-600 mt-2">
                {{ backtestStore.isPortfolioMode ? 'Выполняется портфельный бектест...' : 'Выполняется бектест...' }}
              </p>
            </div>
          </div>

          <!-- Результаты -->
          <div>
            <h2 class="text-xl font-semibold mb-4 text-gray-800 border-b pb-2">Результаты</h2>
            <Message v-if="backtestError" severity="error" :closable="false">{{ backtestError }}</Message>
            
            <TabView class="mt-2">
              <!-- Результаты обычного бектеста -->
              <TabPanel v-if="!backtestStore.isPortfolioMode" header="Сводка">
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
              <TabPanel v-if="backtestStore.isPortfolioMode" header="Результаты Портфеля">
                <PortfolioResultsDisplay :portfolioResults="portfolioResultsStore" />
              </TabPanel>

              <!-- Список сделок для обычного бектеста -->
              <TabPanel v-if="!backtestStore.isPortfolioMode" header="Список сделок">
                <div v-if="backtestResultsStore?.trades && backtestResultsStore.trades.length > 0" class="bg-white rounded-lg shadow p-6">
                  <h3 class="text-xl font-semibold text-gray-900 mb-4 flex items-center">
                    <i class="pi pi-history mr-2 text-purple-600"></i>
                    Все сделки
                  </h3>
                  <DataTable 
                    :value="backtestResultsStore.trades" 
                    responsiveLayout="scroll" 
                    :paginator="true"
                    :rows="20"
                    :rowsPerPageOptions="[10, 20, 50]"
                    currentPageReportTemplate="Показано с {first} по {last} из {totalRecords} сделок"
                    stripedRows
                    sortMode="single"
                    sortField="entryTimestamp"
                    :sortOrder="-1"
                    :emptyMessage="'Нет сделок для отображения'"
                    :scrollable="false"
                    class="compact-table"
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
              <TabPanel v-if="backtestStore.isPortfolioMode" header="Список сделок">
                <div v-if="portfolioResultsStore && getAllPortfolioTrades().length > 0" class="bg-white rounded-lg shadow p-6">
                  <h3 class="text-xl font-semibold text-gray-900 mb-4 flex items-center">
                    <i class="pi pi-history mr-2 text-purple-600"></i>
                    Все сделки портфеля
                  </h3>
                  <DataTable 
                    :value="getAllPortfolioTrades()" 
                    responsiveLayout="scroll" 
                    :paginator="true"
                    :rows="20"
                    :rowsPerPageOptions="[10, 20, 50]"
                    currentPageReportTemplate="Показано с {first} по {last} из {totalRecords} сделок"
                    stripedRows
                    sortMode="single"
                    sortField="entryTimestamp"
                    :sortOrder="-1"
                    :emptyMessage="'Нет сделок для отображения'"
                    :scrollable="false"
                    class="compact-table"
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
              
              <TabPanel header="Графики">
                <p class="m-0 p-4 text-gray-600 bg-gray-50 rounded-md">
                  Здесь будут отображаться графики производительности, кривая капитала и другие визуализации.
                </p>
              </TabPanel>
              <TabPanel header="Логи">
                <p class="m-0 p-4 text-gray-600 bg-gray-50 rounded-md">
                  Здесь будут выводиться логи процесса бектестинга для детального анализа.
                </p>
              </TabPanel>
            </TabView>
          </div>
        </Panel>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, onUnmounted } from 'vue';
import { storeToRefs } from 'pinia';
import Panel from 'primevue/panel';
import Button from 'primevue/button';
import ProgressBar from 'primevue/progressbar';
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
  PortfolioBacktestResult 
} from '@/types/strategy';
import { useToast } from "primevue/usetoast";
import Dropdown from 'primevue/dropdown';
import Calendar from 'primevue/calendar';
import InputNumber from 'primevue/inputnumber';
import Message from 'primevue/message';
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';
import InputSwitch from 'primevue/inputswitch';
import PortfolioSettingsForm from '@/components/PortfolioSettingsForm.vue';
import PortfolioResultsDisplay from '@/components/PortfolioResultsDisplay.vue';
import Badge from 'primevue/badge';

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
const isComponentMounted = ref(false);

let debounceTimer: number | undefined = undefined;

// WebSocket相关
let websocket: WebSocket | null = null;
const WEBSOCKET_URL = 'ws://localhost:5000';
const logger = console; 

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

const handleWebSocketMessage = (event: MessageEvent) => {
  try {
    const message = JSON.parse(event.data as string);
    logger.debug('[BacktesterView] WebSocket message received:', message);

    // Проверяем, что компонент еще смонтирован
    if (!websocket || !isComponentMounted.value) {
      return; // Компонент размонтирован
    }

    // Обработка обычного бектеста
    if (message.type === 'BACKTEST_COMPLETED' && message.payload) {
      const { jobId: completedJobId, result, symbol: msgSymbol, timeframe: msgTimeframe } = message.payload;
      
      if (pendingJobId.value && pendingJobId.value !== completedJobId) {
        logger.info(`[BacktesterView] Received BACKTEST_COMPLETED for job ${completedJobId}, but was expecting ${pendingJobId.value}.`);
      }
      
      logger.info(`[BacktesterView] Backtest (Job ID: ${completedJobId}) completed for ${msgSymbol} (${msgTimeframe}). Updating results.`);
      
      // Проверяем, что компонент еще активен перед обновлением состояния
      if (backtestStore && websocket && isComponentMounted.value) {
        backtestStore.results = result as BacktestResult;
        backtestStore.error = null;
        backtestStore.isLoading = false;
        
        if (pendingJobId.value === completedJobId) {
           pendingJobId.value = null;
           backtestStore.clearCurrentAbortController();
           clearActiveJobState();
        }

        localStorage.setItem(BACKTESTER_RESULTS_KEY, JSON.stringify(result));

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
      const { jobId: completedJobId, result } = message.payload;
      
      if (pendingJobId.value && pendingJobId.value !== completedJobId) {
        logger.info(`[BacktesterView] Received PORTFOLIO_BACKTEST_COMPLETED for job ${completedJobId}, but was expecting ${pendingJobId.value}.`);
      }
      
      logger.info(`[BacktesterView] Portfolio backtest (Job ID: ${completedJobId}) completed. Updating results.`);
      
      // Проверяем, что компонент еще активен перед обновлением состояния
      if (backtestStore && websocket && isComponentMounted.value) {
        backtestStore.portfolioResults = result as PortfolioBacktestResult;
        backtestStore.error = null;
        backtestStore.isLoading = false;
        
        if (pendingJobId.value === completedJobId) {
           pendingJobId.value = null;
           backtestStore.clearCurrentAbortController();
           clearActiveJobState();
        }

        localStorage.setItem(PORTFOLIO_RESULTS_KEY, JSON.stringify(result));

        safeToast({ 
          severity: 'success', 
          summary: 'Портфельный Бектест Завершен', 
          detail: `Портфельный бектест успешно завершен. Всего сделок: ${result.overallMetrics?.totalPortfolioTrades || 0}`, 
          life: 5000 
        });
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
        backtestStore.clearCurrentAbortController();
      }
    }
    else if (message.type === 'job_updated' && 
             (message.payload?.name === JOB_TYPES_FRONTEND.FETCH_CANDLES_AND_RUN_BACKTEST ||
              message.payload?.name === JOB_TYPES_FRONTEND.FETCH_PORTFOLIO_DATA_AND_RUN_BACKTEST)) {
        if(message.payload.jobId === pendingJobId.value && message.payload.status === 'active'){
            const isPortfolio = message.payload.name === JOB_TYPES_FRONTEND.FETCH_PORTFOLIO_DATA_AND_RUN_BACKTEST;
            safeToast({ 
                severity: 'info', 
                summary: 'Обработка Задачи', 
                detail: isPortfolio 
                  ? `Задача на портфельный бектест начала выполняться.`
                  : `Задача на бектест для ${message.payload.data?.symbol} (${message.payload.data?.timeframe}) начала выполняться.`, 
                life: 3000 
            });
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
      backtestStore.isPortfolioMode = savedMode.isPortfolioMode || false;
      logger.info(`[BacktesterView] Restored backtester mode: ${backtestStore.isPortfolioMode ? 'portfolio' : 'single'}`);
    } catch (e) {
      logger.error('[BacktesterView] Failed to parse backtester mode:', e);
      localStorage.removeItem(BACKTESTER_MODE_KEY);
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
      logger.info('[BacktesterView] Loaded last backtest results from localStorage.');
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
      logger.info('[BacktesterView] Loaded last portfolio results from localStorage.');
    } catch (e) {
      logger.error('[BacktesterView] Failed to parse portfolio results from localStorage:', e);
      localStorage.removeItem(PORTFOLIO_RESULTS_KEY);
    }
  }

  connectWebSocket();
  
  // Восстановление состояния активного сканирования (после подключения WebSocket)
  setTimeout(() => {
    if (isComponentMounted.value) {
      restoreActiveJobState();
    }
  }, 1000); // Небольшая задержка для установки WebSocket соединения
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

  const runParams: BacktestRunParameters = {
    pairSymbol: pairSymbol.value,
    timeframe: timeframe.value,
    startDate: startDate.value.toISOString().split('T')[0],
    endDate: endDate.value.toISOString().split('T')[0],
    initialCapital: initialCapital.value,
    strategyParameters: JSON.parse(JSON.stringify(localStrategyParams.value)),
  };

  const paramsToStore = {
      pairSymbol: runParams.pairSymbol,
      timeframe: runParams.timeframe,
      startDate: runParams.startDate,
      endDate: runParams.endDate,
      initialCapital: runParams.initialCapital,
      strategyParameters: runParams.strategyParameters
  };
  localStorage.setItem(BACKTESTER_PARAMS_KEY, JSON.stringify(paramsToStore));

  safeToast({ severity: 'info', summary: 'Запуск Бектеста', detail: 'Инициация процесса бектестинга...', life: 3000 });
  pendingJobId.value = null;
  backtestStore.isLoading = true;
  backtestStore.error = null;
  backtestStore.results = null;

  try {
    const response = await backtestStore.runBacktest(runParams);

    if (response && response.status === 202) {
      pendingJobId.value = response.data?.jobDetails?.jobId || response.data?.jobIds?.[0] || null;
      
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
      backtestStore.results = response.data as BacktestResult;
      backtestStore.isLoading = false;
      localStorage.setItem(BACKTESTER_RESULTS_KEY, JSON.stringify(response.data));
      safeToast({ severity: 'success', summary: 'Завершено', detail: 'Бектест успешно выполнен!', life: 3000 });
      backtestStore.clearCurrentAbortController();
    } else {
        backtestStore.isLoading = false;
        let detailMessage = 'Получен неожиданный ответ от сервера.';
        if (response && response.data && typeof response.data === 'string') {
            detailMessage = response.data;
        } else if (response && response.data?.message) {
            detailMessage = response.data.message;
        } else if (response && response.status) {
            detailMessage = `Сервер вернул статус ${response.status}.`;
        }
        
        backtestStore.error = detailMessage;
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
    portfolioSettings: portfolioParams.value.portfolioSettings,
  };

  const paramsToStore = {
      portfolioParams: portfolioParams.value,
      timeframe: portfolioTimeframe.value,
      startDate: portfolioStartDate.value.toISOString().split('T')[0],
      endDate: portfolioEndDate.value.toISOString().split('T')[0],
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
      localStorage.setItem(PORTFOLIO_RESULTS_KEY, JSON.stringify(response.data));
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

const restoreActiveJobState = () => {
  const savedJobStateRaw = localStorage.getItem(ACTIVE_JOB_KEY);
  if (savedJobStateRaw) {
    try {
      const savedJobState = JSON.parse(savedJobStateRaw);
      const { jobId, jobType, timestamp } = savedJobState;
      
      // Проверяем, что задача не слишком старая (максимум 24 часа)
      const maxAge = 24 * 60 * 60 * 1000; // 24 часа
      if (Date.now() - timestamp > maxAge) {
        logger.info('[BacktesterView] Active job state too old, clearing');
        localStorage.removeItem(ACTIVE_JOB_KEY);
        return;
      }
      
      pendingJobId.value = jobId;
      backtestStore.isLoading = true;
      
      // Показываем уведомление о восстановлении состояния
      safeToast({
        severity: 'info',
        summary: 'Восстановление состояния',
        detail: `Обнаружено активное сканирование (${jobType === 'portfolio' ? 'портфельный' : 'обычный'} бектест). ID: ${jobId}`,
        life: 5000
      });
      
      logger.info(`[BacktesterView] Restored active job state: ${jobId} (${jobType})`);
    } catch (e) {
      logger.error('[BacktesterView] Failed to parse active job state:', e);
      localStorage.removeItem(ACTIVE_JOB_KEY);
    }
  }
};

const clearActiveJobState = () => {
  pendingJobId.value = null;
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
  if (!portfolioResultsStore.value || !portfolioResultsStore.value.tradesByPair) return [];
  
  try {
    const trades: (any & { pair: string })[] = [];
    Object.entries(portfolioResultsStore.value.tradesByPair).forEach(([pair, pairTrades]) => {
      if (pairTrades && Array.isArray(pairTrades)) {
        pairTrades.forEach(trade => {
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
      }
    });
    
    // Сортируем по времени входа (новые сначала)
    return trades.sort((a, b) => (b.entryTimestamp || 0) - (a.entryTimestamp || 0));
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
</style> 