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
-->
<template>
  <div class="p-4 surface-ground min-h-screen">
    <h1 class="text-4xl font-bold mb-8 text-gray-900">Backtester</h1>

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
          <div class="mb-6">
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

            <h2 class="text-xl font-semibold mb-4 text-gray-800 border-b pb-2">Управление Бектестом</h2>
            <div class="flex items-center space-x-3">
              <Button 
                label="Старт" 
                icon="pi pi-play" 
                class="p-button-success" 
                @click="startBacktest" 
                :disabled="!localStrategyParams || backtestIsLoading"
                v-tooltip.bottom="'Запустить новый бектест'"
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
              <p class="text-sm text-gray-600 mt-2">Выполняется бектест...</p>
            </div>
          </div>

          <div>
            <h2 class="text-xl font-semibold mb-4 text-gray-800 border-b pb-2">Результаты</h2>
            <Message v-if="backtestError" severity="error" :closable="false">{{ backtestError }}</Message>
            <TabView class="mt-2">
              <TabPanel header="Сводка">
                <div v-if="backtestResultsStore?.metrics" class="p-4 bg-white rounded-md shadow">
                  <h3 class="text-lg font-medium text-gray-900 mb-3">Основные Метрики:</h3>
                  <ul class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-2 text-sm">
                    <li v-for="(value, key) in backtestResultsStore.metrics" :key="key" class="flex justify-between py-1 border-b border-gray-200">
                      <span class="font-medium text-gray-600">{{ getDisplayKey(key) }}:</span>
                      <span class="text-gray-800">{{ formatMetric(key, value) }}</span>
                    </li>
                  </ul>
                </div>
                <p v-else class="m-0 p-4 text-gray-600 bg-gray-50 rounded-md">
                  Результаты бектестинга будут отображены здесь после его завершения.
                </p>
              </TabPanel>
              <TabPanel header="Список сделок">
                <div v-if="backtestResultsStore?.trades && backtestResultsStore.trades.length > 0" class="p-0 bg-white rounded-md shadow overflow-x-auto">
                  <DataTable :value="backtestResultsStore.trades" stripedRows responsiveLayout="scroll" paginator :rows="10" :rowsPerPageOptions="[10, 20, 50]" currentPageReportTemplate="Показано с {first} по {last} из {totalRecords} сделок" sortMode="multiple">
                    <Column field="id" header="ID" :sortable="true" style="min-width: 100px; font-size: 0.8rem; padding: 0.5rem;">
                      <template #body="slotProps">
                        <span :title="slotProps.data.id">{{ slotProps.data.id.substring(0, 8) }}...</span>
                      </template>
                    </Column>
                    <Column field="pair" header="Пара" :sortable="true" style="min-width: 120px; font-size: 0.8rem; padding: 0.5rem;"></Column>
                    <Column field="direction" header="Направление" :sortable="true" style="min-width: 100px; font-size: 0.8rem; padding: 0.5rem;">
                      <template #body="slotProps">
                        <span :class="{'text-green-600 font-semibold': slotProps.data.direction === 'long', 'text-red-600 font-semibold': slotProps.data.direction === 'short'}">
                          {{ slotProps.data.direction === 'long' ? 'Long' : 'Short' }}
                        </span>
                      </template>
                    </Column>
                    <Column field="entryTimestamp" header="Время Входа" :sortable="true" style="min-width: 160px; font-size: 0.8rem; padding: 0.5rem;">
                      <template #body="slotProps">
                        {{ new Date(slotProps.data.entryTimestamp).toLocaleString() }}
                      </template>
                    </Column>
                    <Column field="entryPrice" header="Цена Входа" :sortable="true" style="min-width: 100px; font-size: 0.8rem; padding: 0.5rem;">
                      <template #body="slotProps">
                        {{ slotProps.data.entryPrice?.toFixed(4) }}
                      </template>
                    </Column>
                    <Column field="size" header="Размер (контр.)" :sortable="true" style="min-width: 120px; font-size: 0.8rem; padding: 0.5rem;">
                        <template #body="slotProps">
                            {{ slotProps.data.size?.toFixed(4) }}
                        </template>
                    </Column>
                    <Column field="exitTimestamp" header="Время Выхода" :sortable="true" style="min-width: 160px; font-size: 0.8rem; padding: 0.5rem;">
                      <template #body="slotProps">
                        {{ slotProps.data.exitTimestamp ? new Date(slotProps.data.exitTimestamp).toLocaleString() : '-' }}
                      </template>
                    </Column>
                    <Column field="exitPrice" header="Цена Выхода" :sortable="true" style="min-width: 100px; font-size: 0.8rem; padding: 0.5rem;">
                      <template #body="slotProps">
                        {{ slotProps.data.exitPrice?.toFixed(4) }}
                      </template>
                    </Column>
                     <Column field="exitReason" header="Причина Выхода" :sortable="true" style="min-width: 120px; font-size: 0.8rem; padding: 0.5rem;"></Column>
                    <Column field="pnl" header="PnL ($)" :sortable="true" style="min-width: 100px; font-size: 0.8rem; padding: 0.5rem;">
                      <template #body="slotProps">
                        <span :class="{'text-green-600': slotProps.data.pnl > 0, 'text-red-600': slotProps.data.pnl < 0}">
                          {{ slotProps.data.pnl?.toFixed(2) }}
                        </span>
                      </template>
                    </Column>
                    <Column field="pnlPercentage" header="PnL (%)" :sortable="true" style="min-width: 100px; font-size: 0.8rem; padding: 0.5rem;">
                        <template #body="slotProps">
                             <span :class="{'text-green-600': slotProps.data.pnlPercentage > 0, 'text-red-600': slotProps.data.pnlPercentage < 0}">
                                {{ slotProps.data.pnlPercentage ? (slotProps.data.pnlPercentage * 100).toFixed(2) + '%' : '-'}}
                            </span>
                        </template>
                    </Column>
                    <Column field="stopLoss" header="SL" style="min-width: 90px; font-size: 0.8rem; padding: 0.5rem;">
                        <template #body="slotProps">
                            {{ slotProps.data.stopLoss?.toFixed(4) }}
                        </template>
                    </Column>
                    <Column field="takeProfit" header="TP" style="min-width: 90px; font-size: 0.8rem; padding: 0.5rem;">
                        <template #body="slotProps">
                            {{ slotProps.data.takeProfit?.toFixed(4) }}
                        </template>
                    </Column>
                  </DataTable>
                </div>
                <p v-else class="m-0 p-4 text-gray-600 bg-gray-50 rounded-md">
                  Список сделок будет доступен здесь после выполнения бектеста.
                </p>
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
import type { BacktestRunParameters, BacktestResult } from '@/types/strategy';
import { useToast } from "primevue/usetoast";
import Dropdown from 'primevue/dropdown';
import Calendar from 'primevue/calendar';
import InputNumber from 'primevue/inputnumber';
import Message from 'primevue/message';
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';

const settingsStore = useSettingsStore();
const backtestStore = useBacktestStore();
const toast = useToast();

const { parameters: localStrategyParams } = storeToRefs(settingsStore);
const { tradingPairOptions } = storeToRefs(settingsStore);
const { fetchAvailableTradingPairs } = settingsStore;

const { isLoading: backtestIsLoading, results: backtestResultsStore, error: backtestError } = storeToRefs(backtestStore);

const BACKTESTER_PARAMS_KEY = 'backtester_launch_params';
const BACKTESTER_RESULTS_KEY = 'backtester_last_results';
const pendingJobId = ref<string | null>(null);

let debounceTimer: number | undefined = undefined;

// WebSocket相关
let websocket: WebSocket | null = null;
const WEBSOCKET_URL = 'ws://localhost:5000'; // Используем тот же URL, что и в QueueManagerView
// Для логгирования, если глобальный logger недоступен
const logger = console; 

const JOB_TYPES_FRONTEND = {
  FETCH_CANDLES_AND_RUN_BACKTEST: 'fetch-candles-and-run-backtest'
};

const pairSymbol = ref<string | null>(null); // Инициализация по умолчанию или из localStorage
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


const handleWebSocketMessage = (event: MessageEvent) => {
  try {
    const message = JSON.parse(event.data as string);
    logger.debug('[BacktesterView] WebSocket message received:', message);

    if (message.type === 'BACKTEST_COMPLETED' && message.payload) {
      const { jobId: completedJobId, result, symbol: msgSymbol, timeframe: msgTimeframe } = message.payload;
      
      // Если у нас есть pendingJobId, мы можем проверить, соответствует ли он
      if (pendingJobId.value && pendingJobId.value !== completedJobId) {
        logger.info(`[BacktesterView] Received BACKTEST_COMPLETED for job ${completedJobId}, but was expecting ${pendingJobId.value}. It might be an older job or a job from another session/tab if not handled carefully.`);
        // В простом случае, если активен только один отложенный бектест, можно не игнорировать, а просто обновить.
        // Если предполагается несколько одновременных, то проверка по jobId важна.
      }
      
      logger.info(`[BacktesterView] Backtest (Job ID: ${completedJobId}) completed for ${msgSymbol} (${msgTimeframe}). Updating results.`);
      backtestStore.results = result as BacktestResult;
      backtestStore.error = null;
      backtestStore.isLoading = false;
      if (pendingJobId.value === completedJobId) {
         pendingJobId.value = null;
         backtestStore.clearCurrentAbortController();
      }

      localStorage.setItem(BACKTESTER_RESULTS_KEY, JSON.stringify(result));

      toast.add({ 
        severity: 'success', 
        summary: 'Бектест Завершен', 
        detail: `Бектест для ${msgSymbol} (${msgTimeframe}) успешно завершен.`, 
        life: 5000 
      });

    } else if (message.type === 'BACKTEST_FAILED' && message.payload) {
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

      toast.add({ 
        severity: 'error',
        summary: 'Ошибка Бектеста',
        detail: `Ошибка при выполнении бектеста для ${msgSymbol} (${msgTimeframe}) в очереди: ${errPayload.message}`,
        life: 7000
      });
    } else if (message.type === 'job_updated' && message.payload?.name === JOB_TYPES_FRONTEND.FETCH_CANDLES_AND_RUN_BACKTEST) {
        if(message.payload.jobId === pendingJobId.value && message.payload.status === 'active'){
            toast.add({ 
                severity: 'info', 
                summary: 'Обработка Задачи', 
                detail: `Задача на бектест для ${message.payload.data?.symbol} (${message.payload.data?.timeframe}) начала выполняться.`, 
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
    toast.add({ severity: 'info', summary: 'WebSocket', detail: 'Соединение для обновлений установлено.', life: 2000 });
  };

  websocket.onmessage = handleWebSocketMessage;

  websocket.onerror = (error) => {
    logger.error('[BacktesterView] WebSocket error:', error);
    toast.add({ severity: 'error', summary: 'WebSocket Ошибка', detail: 'Ошибка соединения WebSocket.', life: 4000 });
  };

  websocket.onclose = (event) => {
    logger.info('[BacktesterView] WebSocket connection closed:', event.reason, `Code: ${event.code}`);
    if (!event.wasClean) {
        toast.add({ severity: 'warn', summary: 'WebSocket', detail: 'Соединение для обновлений потеряно. Попытка переподключения через 5с...', life: 4000 });
        // Простое переподключение через 5 секунд
        setTimeout(connectWebSocket, 5000);
    }
  };
};

const closeWebSocket = () => {
  if (websocket) {
    logger.info('[BacktesterView] Closing WebSocket connection.');
    websocket.close();
    websocket = null;
  }
};

onMounted(async () => {
  await fetchAvailableTradingPairs();
  // settingsStore.loadParameters(); // Закомментировано, так как такого action нет
  // Если параметры инициализируются в самом сторе или через другой action, этот вызов может не требоваться
  // или его нужно заменить на правильный (например, settingsStore.fetchAndSetParameters() или подобное, если есть)
  if (!localStrategyParams.value) { // Если параметры не загружены (например, при первой загрузке)
      // Возможно, здесь нужно вызвать метод, который действительно загружает/инициализирует параметры в settingsStore
      // settingsStore.initDefaultParameters(); // Пример
      logger.warn('[BacktesterView] localStrategyParams are null onMounted after attempting to load. Ensure settingsStore initializes them.');
  }

  const savedParamsRaw = localStorage.getItem(BACKTESTER_PARAMS_KEY);
  if (savedParamsRaw) {
    try {
      const savedParams = JSON.parse(savedParamsRaw);
      pairSymbol.value = savedParams.pairSymbol || null;
      timeframe.value = savedParams.timeframe || '1h';
      startDate.value = savedParams.startDate ? new Date(savedParams.startDate) : null;
      endDate.value = savedParams.endDate ? new Date(savedParams.endDate) : null;
      initialCapital.value = savedParams.initialCapital || 10000;
      logger.info('[BacktesterView] Loaded launch parameters (symbol, timeframe, dates, capital) from localStorage.');
    } catch (e) {
      logger.error('[BacktesterView] Failed to parse launch parameters from localStorage:', e);
      localStorage.removeItem(BACKTESTER_PARAMS_KEY);
    }
  }

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
  connectWebSocket();
});

onUnmounted(() => {
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
    toast.add({ severity: 'error', summary: 'Ошибка', detail: 'Параметры стратегии не установлены!', life: 3000 });
    return;
  }
  if (!pairSymbol.value || !timeframe.value || !startDate.value || !endDate.value || initialCapital.value === null || initialCapital.value <= 0) {
    toast.add({ severity: 'error', summary: 'Ошибка', detail: 'Не все параметры для запуска бектеста заполнены корректно (проверьте символ, даты, капитал > 0)!', life: 4000 });
    return;
  }

  const runParams: BacktestRunParameters = {
    pairSymbol: pairSymbol.value,
    timeframe: timeframe.value,
    startDate: startDate.value.toISOString().split('T')[0], // Отправляем только дату YYYY-MM-DD
    endDate: endDate.value.toISOString().split('T')[0],     // Отправляем только дату YYYY-MM-DD
    initialCapital: initialCapital.value,
    strategyParameters: JSON.parse(JSON.stringify(localStrategyParams.value)), // Глубокая копия
  };

  // Сохраняем параметры запуска в localStorage
  const paramsToStore = {
      pairSymbol: runParams.pairSymbol,
      timeframe: runParams.timeframe,
      startDate: runParams.startDate, // уже в ISOString (date part)
      endDate: runParams.endDate, // уже в ISOString (date part)
      initialCapital: runParams.initialCapital,
      strategyParameters: runParams.strategyParameters // уже копия
  };
  localStorage.setItem(BACKTESTER_PARAMS_KEY, JSON.stringify(paramsToStore));
  logger.info('[BacktesterView] Saved launch parameters to localStorage.');

  toast.add({ severity: 'info', summary: 'Запуск Бектеста', detail: 'Инициация процесса бектестинга...', life: 3000 });
  pendingJobId.value = null;
  backtestStore.isLoading = true;
  backtestStore.error = null;
  backtestStore.results = null;

  try {
    const response = await backtestStore.runBacktest(runParams);
    logger.info('[BacktesterView] Response from backtestStore.runBacktest:', JSON.parse(JSON.stringify(response))); // Логируем весь ответ

    if (response && response.status === 202) { // Бэктест поставлен в очередь
      pendingJobId.value = response.data?.jobDetails?.jobId || response.data?.jobIds?.[0] || null;
      toast.add({
        severity: 'info',
        summary: 'Бектест в Очереди',
        detail: response.data?.message || 'Бектест поставлен в очередь и будет выполнен фоново.',
        life: 5000
      });
      logger.info(`[BacktesterView] Backtest queued. Job ID (if available from response): ${pendingJobId.value}. Response data:`, JSON.parse(JSON.stringify(response.data)));
      // isLoading остается true, пока не придет сообщение по WebSocket
    } else if (response && response.status === 200) { // Бэктест выполнен немедленно
      logger.info('[BacktesterView] Backtest completed immediately. Raw response.data:', JSON.parse(JSON.stringify(response.data)));
      backtestStore.results = response.data as BacktestResult;
      logger.info('[BacktesterView] backtestStore.results after assignment:', JSON.parse(JSON.stringify(backtestStore.results)));
      backtestStore.isLoading = false;
      localStorage.setItem(BACKTESTER_RESULTS_KEY, JSON.stringify(response.data));
      toast.add({ severity: 'success', summary: 'Завершено', detail: 'Бектест успешно выполнен немедленно!', life: 3000 });
      backtestStore.clearCurrentAbortController();
    } else {
        logger.warn('[BacktesterView] Backtest run did not return a 200 or 202 status, or response was unexpected:', response);
        backtestStore.isLoading = false;
        let detailMessage = 'Получен неожиданный ответ от сервера.';
        if (response && response.data && typeof response.data === 'string') { // Если data - это просто строка
            detailMessage = response.data;
        } else if (response && response.data?.message) {
            detailMessage = response.data.message;
        } else if (response && response.status) {
            detailMessage = `Сервер вернул статус ${response.status}.`;
        }
        
        backtestStore.error = detailMessage;
        toast.add({ severity: 'error', summary: 'Ошибка Сервера', detail: detailMessage, life: 7000 });
    }

  } catch (error: any) {
    logger.error('[BacktesterView] Error calling backtestStore.runBacktest:', error);
    backtestStore.isLoading = false;
    let errorMessage = 'Произошла ошибка при запуске бектеста.';
    let errorSummary = 'Ошибка Запуска';

    if (error.name === 'AbortError') {
        errorMessage = 'Бектест был отменен.';
        errorSummary = 'Отменено';
    } else if (error.response && error.response.data) { // Ошибка от Axios с data
      if (typeof error.response.data === 'string') {
        errorMessage = error.response.data;
      } else if (error.response.data.message) {
        errorMessage = error.response.data.message;
      }
      errorSummary = `Ошибка ${error.response.status || 'Сервера'}`;
      backtestStore.clearCurrentAbortController();
    } else if (error.message) { // Другие ошибки (сетевые, и т.д.)
        errorMessage = error.message;
        backtestStore.clearCurrentAbortController();
    }
    
    backtestStore.error = errorMessage;
    toast.add({ severity: 'error', summary: errorSummary, detail: errorMessage, life: 7000 });
  }
};

const stopBacktest = () => {
  console.log('Остановка бектеста...');
  if (backtestStore.abortRequest) {
    backtestStore.abortRequest();
    toast.add({ severity: 'warn', summary: 'Остановка', detail: 'Запрос на остановку бектеста отправлен.', life: 3000 });
  } else {
    toast.add({ severity: 'info', summary: 'Остановка', detail: 'Функция остановки не реализована в сторе.', life: 3000 });
  }
};

const resetBacktestSettings = () => {
  settingsStore.resetToDefaults();
  toast.add({ severity: 'info', summary: 'Настройки сброшены', detail: 'Параметры стратегии установлены по умолчанию.', life: 3000 });
};

const toggleSettingsPanel = (event: any) => {
  console.log('Settings Panel toggled', event);
};
const toggleResultsPanel = (event: any) => {
  console.log('Results Panel toggled', event);
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
    // Если значение уже строка с процентом, просто возвращаем
    return value;
  }

  if (typeof value === 'number') {
    // Ключи, значения которых являются процентами и должны отображаться со знаком %
    const percentageKeys = [
      'totalPnlPercentage', 
      'winRate', 
      'maxDrawdown',
      // Добавьте сюда другие ключи, если бэкенд их возвращает как числа, но они являются процентами
      // например, 'cagr', 'volatility', 'avgWinningTradePercentage', 'avgLosingTradePercentage', 'expectancyPercentage'
    ];

    // Ключи, значения которых являются денежными (или требуют 2 знака после запятой)
    const currencyLikeKeys = [
      'totalPnl',
      'initialCapital',
      'finalCapital',
      'grossProfit',
      'grossLoss',
      'averageTradePnl',
      'avgWinningTrade',
      'avgLosingTrade',
      'expectancy' // Матожидание тоже часто с 2 знаками
    ];

    if (sKey === 'winRate') { // Специальная обработка для winRate
      return `${(value * 100).toFixed(2)}%`;
    } else if (percentageKeys.includes(sKey)) {
      return `${value.toFixed(2)}%`;
    }
    if (currencyLikeKeys.includes(sKey)) {
      return value.toFixed(2);
    }
    // Для остальных чисел (например, totalTrades, durationMs, profitFactor)
    if (Number.isInteger(value)) {
        return value.toString();
    }
    return value.toFixed(2); // profitFactor, например
  }

  if (Array.isArray(value)) {
    return '[Equity Data]'; // Заглушка для массива (например, equityCurve)
  }
  
  return String(value); // Для всего остального
};

watch(startDate, (newVal) => {
  console.log('Start date changed:', newVal);
});
watch(endDate, (newVal) => {
  console.log('End date changed:', newVal);
});

watch(localStrategyParams, (newVal) => {
  console.log('Strategy parameters in BacktesterView updated (from BacktesterView watch):', newVal);
}, { deep: true });

watch(() => localStrategyParams.value.dlc?.numProfiles, (newVal) => {
    console.log('DLC numProfiles changed in BacktesterView (from BacktesterView watch):', newVal);
});

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
</style> 