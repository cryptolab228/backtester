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
                      <span class="font-medium text-gray-600">{{ key }}:</span>
                      <span class="text-gray-800">{{ formatMetric(value) }}</span>
                    </li>
                  </ul>
                </div>
                <p v-else class="m-0 p-4 text-gray-600 bg-gray-50 rounded-md">
                  Результаты бектестинга будут отображены здесь после его завершения.
                </p>
              </TabPanel>
              <TabPanel header="Список сделок">
                <div v-if="backtestResultsStore?.trades && backtestResultsStore.trades.length > 0" class="p-4 bg-white rounded-md shadow overflow-x-auto">
                  <h3 class="text-lg font-medium text-gray-900 mb-3">Совершенные сделки:</h3>
                  <pre class="text-xs bg-gray-100 p-3 rounded-md">{{ JSON.stringify(backtestResultsStore.trades, null, 2) }}</pre>
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
import { ref, onMounted, watch } from 'vue';
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
import type { BacktestRunParameters } from '@/types/strategy';
import { useToast } from "primevue/usetoast";
import Dropdown from 'primevue/dropdown';
import Calendar from 'primevue/calendar';
import InputNumber from 'primevue/inputnumber';
import Message from 'primevue/message';

const settingsStore = useSettingsStore();
const backtestStore = useBacktestStore();
const toast = useToast();

const { parameters: localStrategyParams } = storeToRefs(settingsStore);
const { tradingPairOptions } = storeToRefs(settingsStore);
const { fetchAvailableTradingPairs } = settingsStore;

const { isLoading: backtestIsLoading, results: backtestResultsStore, error: backtestError } = storeToRefs(backtestStore);

let debounceTimer: number | undefined = undefined;

const pairSymbol = ref<string>('BTC-USDT-SWAP');
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

onMounted(async () => {
  const today = new Date();
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(today.getMonth() - 3);
  if (!startDate.value) startDate.value = threeMonthsAgo;
  if (!endDate.value) endDate.value = today;
  
  await fetchAvailableTradingPairs();
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
  if (!pairSymbol.value || !timeframe.value || !startDate.value || !endDate.value || initialCapital.value === null) {
    toast.add({ severity: 'error', summary: 'Ошибка', detail: 'Не все параметры для запуска бектеста заполнены!', life: 3000 });
    return;
  }

  const runParams: BacktestRunParameters = {
    pairSymbol: pairSymbol.value,
    timeframe: timeframe.value,
    startDate: startDate.value.toISOString(),
    endDate: endDate.value.toISOString(),
    initialCapital: initialCapital.value,
    strategyParameters: JSON.parse(JSON.stringify(localStrategyParams.value)),
  };

  console.log('Запуск бектеста с параметрами:', runParams);
  toast.add({ severity: 'info', summary: 'Запуск', detail: 'Бектест запускается...', life: 2000 });
  
  await backtestStore.runBacktest(runParams);

  if (backtestError.value) {
     toast.add({ severity: 'error', summary: 'Ошибка бектеста', detail: backtestError.value || 'Произошла ошибка при выполнении бектеста.', life: 5000 });
  } else if (backtestResultsStore.value) {
     toast.add({ severity: 'success', summary: 'Завершено', detail: 'Бектест успешно выполнен!', life: 3000 });
     console.log('Бектест завершен, результаты:', backtestResultsStore.value);
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

const formatMetric = (value: any): string => {
  if (typeof value === 'number') {
    if ((value > -1 && value < 1 && value !== 0) || String(value).includes('.')) {
      if (String(value).length - String(value).indexOf('.') -1 > 2 ) {
         return (value * 100).toFixed(2) + '%';
      }
    }
    return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (value instanceof Date) {
    return value.toLocaleString();
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