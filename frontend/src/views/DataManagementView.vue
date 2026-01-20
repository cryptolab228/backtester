<template>
  <div class="animate-fade-in space-y-4">
    <Toast />

    <!-- Выбор биржи -->
    <div class="bg-white rounded-md border border-slate-200 p-3">
      <div class="flex items-center gap-2 mb-3">
        <i class="pi pi-building text-base text-slate-600"></i>
        <h3 class="text-sm font-semibold text-slate-800">Выбор биржи</h3>
      </div>
      <div class="space-y-2">
        <div class="flex flex-wrap gap-3">
          <div class="flex items-center gap-2">
            <RadioButton v-model="selectedExchange" inputId="okx" name="exchange" value="okx" />
            <label for="okx" class="text-sm cursor-pointer">OKX (30 req/s)</label>
          </div>
          <div class="flex items-center gap-2">
            <RadioButton v-model="selectedExchange" inputId="bybit" name="exchange" value="bybit" />
            <label for="bybit" class="text-sm cursor-pointer">Bybit (120 req/s) ⚡</label>
          </div>
        </div>
        <p class="text-xs text-slate-500 mt-2">
          Bybit ~13x быстрее благодаря высоким лимитам и большим размерам батчей
        </p>
      </div>
    </div>

    <!-- Загрузка торговых пар -->
    <div class="bg-white rounded-md border border-slate-200 p-3">
      <div class="flex items-center gap-2 mb-3">
        <i class="pi pi-download text-base text-slate-600"></i>
        <h3 class="text-sm font-semibold text-slate-800">Загрузка торговых пар</h3>
      </div>
      <div>
        <p class="text-sm text-slate-600 mb-3">
          Загрузить список доступных пар Futures и Swap с <strong>{{ selectedExchange.toUpperCase() }}</strong>
        </p>
        <div class="flex gap-2 items-center flex-wrap">
          <Button 
            :label="`Загрузить ${selectedExchange.toUpperCase()}`" 
            icon="pi pi-download" 
            :loading="isFetchingPairs" 
            @click="handleFetchPairs"
            size="small"
          />
          <Badge v-if="selectedExchange === 'bybit'" value="Быстро" severity="success" class="text-xs" />
        </div>
        <div v-if="lastFetchPairsJobId" class="mt-2 p-2 bg-blue-50 border border-blue-200 rounded text-xs">
          Job ID: {{ lastFetchPairsJobId }}
          <router-link :to="`/queue-manager?jobId=${lastFetchPairsJobId}`" class="text-blue-600 hover:underline ml-1">Просмотр</router-link>
        </div>
      </div>
    </div>

    <!-- Загрузка исторических свечей -->
    <div class="bg-white rounded-md border border-slate-200 p-3">
      <div class="flex items-center gap-2 mb-3">
        <i class="pi pi-chart-line text-base text-slate-600"></i>
        <h3 class="text-sm font-semibold text-slate-800">Исторические свечи с {{ selectedExchange.toUpperCase() }}</h3>
      </div>
      <div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div class="flex flex-col gap-1.5">
            <label for="symbol" class="text-xs font-medium text-slate-600">Символ</label>
            <Select 
              id="symbol" 
              v-model="fetchParams.selectedSymbol" 
              :options="availableSymbols" 
              option-label="symbol" 
              :placeholder="`Выбрать символ`"
              show-clear
              filter 
              class="w-full text-sm" 
              :loading="isLoadingSymbols"
            />
            <small class="text-xs text-slate-500">
              Доступно {{ availableSymbols.length }} пар
            </small>
          </div>

          <div class="flex flex-col gap-1.5">
            <label for="timeframes" class="text-xs font-medium text-slate-600">Таймфреймы</label>
            <MultiSelect 
              id="timeframes" 
              v-model="fetchParams.selectedTimeframes" 
              :options="availableTimeframes" 
              placeholder="Выбрать таймфреймы" 
              display="chip"
              class="w-full text-sm" 
            />
          </div>

          <div class="flex flex-col gap-1.5">
            <label for="startTime" class="text-xs font-medium text-slate-600">Начало (опционально)</label>
            <DatePicker id="startTime" v-model="fetchParams.startTimeDate" showTime hourFormat="24" dateFormat="yy-mm-dd" class="text-sm" />
          </div>

          <div class="flex flex-col gap-1.5">
            <label for="endTime" class="text-xs font-medium text-slate-600">Конец (опционально)</label>
            <DatePicker id="endTime" v-model="fetchParams.endTimeDate" showTime hourFormat="24" dateFormat="yy-mm-dd" class="text-sm" />
          </div>

           <div class="flex flex-col gap-1.5">
            <label for="limit" class="text-xs font-medium text-slate-600">Лимит (опционально)</label>
            <InputNumber id="limit" v-model="fetchParams.limit" placeholder="Макс. свечей" class="text-sm" />
          </div>
        </div>
        
        <!-- Информация о производительности -->
        <div class="mt-3 p-2 bg-slate-50 border border-slate-200 rounded">
          <div class="text-xs text-slate-600">
            <strong>{{ selectedExchange.toUpperCase() }}:</strong>
            <span v-if="selectedExchange === 'okx'"> 30 req/s, 300 свечей/req</span>
            <span v-if="selectedExchange === 'bybit'"> 120 req/s, 1000 свечей/req ⚡</span>
            <span class="ml-2">• Время для 3 лет 1h: {{ getEstimatedTime() }}</span>
          </div>
        </div>

        <div class="mt-3 flex gap-2">
           <Button 
             :label="`Загрузить с ${selectedExchange.toUpperCase()}`" 
             icon="pi pi-download" 
             :loading="isFetchingCandles" 
             @click="handleFetchCandles" 
             :disabled="!fetchParams.selectedSymbol || !fetchParams.selectedTimeframes || fetchParams.selectedTimeframes.length === 0"
             size="small"
           />
        </div>
        <div v-if="lastFetchCandlesJobInfo.ids.length > 0" class="mt-2 p-2 bg-green-50 border border-green-200 rounded text-xs">
            <p class="font-medium mb-1">В очереди: {{lastFetchCandlesJobInfo.succeeded}}/{{lastFetchCandlesJobInfo.attempted}}</p>
            <div class="space-y-0.5">
                <div v-for="jobId in lastFetchCandlesJobInfo.ids" :key="jobId">
                    ID: {{ jobId }} 
                    <router-link :to="`/queue-manager?jobId=${jobId}`" class="text-blue-600 hover:underline ml-1">Просмотр</router-link>
                </div>
            </div>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, watch } from 'vue';
import Button from 'primevue/button';
import Select from 'primevue/select';
import MultiSelect from 'primevue/multiselect';
import DatePicker from 'primevue/datepicker';
import InputNumber from 'primevue/inputnumber';
import Card from 'primevue/card';
import Toast from 'primevue/toast';
import RadioButton from 'primevue/radiobutton';
import Badge from 'primevue/badge';
import { useToast } from 'primevue/usetoast';
import { RouterLink } from 'vue-router'; // Импорт RouterLink
import { 
    triggerFetchPairsJob, 
    triggerFetchCandlesJob, 
    getAvailableTradingPairs 
} from '@/services/apiService';
import type { FetchCandlesParams, TradingPair } from '@/services/apiService';

const toast = useToast();

// НОВОЕ: Состояние выбранной биржи
const selectedExchange = ref<'okx' | 'bybit'>('bybit'); // По умолчанию Bybit как более быстрый

const isFetchingPairs = ref(false);
const isFetchingCandles = ref(false);
const isLoadingSymbols = ref(false);

const availableSymbols = ref<TradingPair[]>([]);
const lastFetchPairsJobId = ref<string | null>(null);
const lastFetchCandlesJobInfo = reactive<{ ids: string[], attempted: number, succeeded: number }>({ ids: [], attempted: 0, succeeded: 0 });

const fetchParams = reactive<{
    selectedSymbol: TradingPair | null; // Изменено на объект TradingPair или null
    selectedTimeframes: string[]; 
    startTimeDate: Date | null;
    endTimeDate: Date | null;
    limit: number | null;
}> ({
    selectedSymbol: null,
    selectedTimeframes: ['15m'], // Значение по умолчанию
    startTimeDate: null,
    endTimeDate: null,
    limit: null,
});

const availableTimeframes = ref([
    '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d', '1w', '1M' // OKX/Bybit формат
]);

// НОВОЕ: Функция для времени загрузки
const getEstimatedTime = (): string => {
  if (selectedExchange.value === 'bybit') {
    return '~8 minutes (Bybit: fast)';
  } else {
    return '~100 minutes (OKX: slower)';
  }
};

const loadAvailableSymbols = async () => {
  isLoadingSymbols.value = true;
  try {
    // НОВОЕ: Передаем биржу в параметрах
    availableSymbols.value = await getAvailableTradingPairs(selectedExchange.value);
    if (availableSymbols.value.length > 0) {
        // Очищаем выбранный символ при смене биржи
        fetchParams.selectedSymbol = null;
    }
  } catch (error: any) {
    toast.add({ severity: 'error', summary: 'Error Loading Symbols', detail: error.message || 'Failed to load trading symbols', life: 3000 });
  } finally {
    isLoadingSymbols.value = false;
  }
};

// НОВОЕ: Следим за изменением биржи
watch(selectedExchange, () => {
  loadAvailableSymbols();
  // Очищаем состояние при смене биржи
  lastFetchPairsJobId.value = null;
  lastFetchCandlesJobInfo.ids = [];
  lastFetchCandlesJobInfo.attempted = 0;
  lastFetchCandlesJobInfo.succeeded = 0;
});

onMounted(() => {
  loadAvailableSymbols();
});

const handleFetchPairs = async () => {
  isFetchingPairs.value = true;
  lastFetchPairsJobId.value = null;
  try {
    // НОВОЕ: Передаем биржу в запросе
    const response = await triggerFetchPairsJob(selectedExchange.value);
    if (response.jobId) {
        lastFetchPairsJobId.value = response.jobId;
        toast.add({ 
          severity: 'success', 
          summary: 'Job Queued', 
          detail: `${response.message} (Job ID: ${response.jobId}) for ${selectedExchange.value.toUpperCase()}`, 
          life: 5000 
        });
    } else {
        toast.add({ severity: 'warn', summary: 'Job Status Unknown', detail: response.message || 'Fetch pairs job may have been queued, but no ID was returned.', life: 5000 });
    }
    loadAvailableSymbols(); // Обновляем список символов после запроса на их загрузку
  } catch (error: any) {
    toast.add({ severity: 'error', summary: 'Error', detail: error.message || 'Failed to queue fetch pairs job', life: 5000 });
  } finally {
    isFetchingPairs.value = false;
  }
};

const handleFetchCandles = async () => {
  if (!fetchParams.selectedSymbol || !fetchParams.selectedTimeframes || fetchParams.selectedTimeframes.length === 0) {
    toast.add({ severity: 'warn', summary: 'Missing Info', detail: 'Please select a Symbol and at least one Timeframe.', life: 3000 });
    return;
  }

  isFetchingCandles.value = true;
  lastFetchCandlesJobInfo.ids = [];
  lastFetchCandlesJobInfo.attempted = 0;
  lastFetchCandlesJobInfo.succeeded = 0;

  const params: FetchCandlesParams = {
    symbol: fetchParams.selectedSymbol.symbol, // Используем .symbol, так как selectedSymbol теперь объект
    timeframes: fetchParams.selectedTimeframes,
    startTime: fetchParams.startTimeDate ? fetchParams.startTimeDate.getTime() : undefined,
    endTime: fetchParams.endTimeDate ? fetchParams.endTimeDate.getTime() : undefined,
    limit: fetchParams.limit ?? undefined,
    exchange: selectedExchange.value, // НОВОЕ: Передаем выбранную биржу
  };

  try {
    const response = await triggerFetchCandlesJob(params);
    lastFetchCandlesJobInfo.attempted = response.totalAttempted ?? 0;
    lastFetchCandlesJobInfo.succeeded = response.totalSuccessfullyQueued ?? 0;

    if (response.jobIds && response.jobIds.length > 0) {
      lastFetchCandlesJobInfo.ids = response.jobIds;
      toast.add({ 
        severity: 'success', 
        summary: 'Jobs Queued', 
        detail: `${response.message} Queued ${response.totalSuccessfullyQueued}/${response.totalAttempted} jobs for ${selectedExchange.value.toUpperCase()}.`, 
        life: 7000 
      });
    } else if (response.jobId) { // Обработка случая, если бэкенд вернул одиночный jobId (для совместимости)
      lastFetchCandlesJobInfo.ids = [response.jobId];
      lastFetchCandlesJobInfo.succeeded = 1; 
      lastFetchCandlesJobInfo.attempted = 1; // Предполагаем 1, если вернулся одиночный ID
      toast.add({ severity: 'success', summary: 'Job Queued', detail: `${response.message} (Job ID: ${response.jobId})`, life: 5000 });
    } else {
       toast.add({ severity: 'warn', summary: 'Job Status Unknown', detail: response.message || 'Candle fetch job(s) may have been queued, but no IDs were returned.', life: 5000 });
    }
  } catch (error: any) {
    toast.add({ severity: 'error', summary: 'Error', detail: error.message || 'Failed to queue fetch candles job(s)', life: 5000 });
  } finally {
    isFetchingCandles.value = false;
  }
};

</script>

<style scoped>
/* Локальные стили при необходимости */
</style> 