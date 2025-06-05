<template>
  <div>
    <Toast /> <!-- Компонент для отображения уведомлений -->
    <h1 class="text-2xl font-semibold mb-6">Data Management</h1>

    <!-- НОВОЕ: Глобальный выбор биржи -->
    <Card class="mb-6">
      <template #title>
        <div class="flex items-center gap-3">
          <i class="pi pi-building text-xl"></i>
          Exchange Selection
        </div>
      </template>
      <template #content>
        <div class="flex flex-col gap-3">
          <label for="exchange" class="font-medium">Select Exchange:</label>
          <div class="flex gap-4">
            <div class="flex align-items-center">
              <RadioButton v-model="selectedExchange" inputId="okx" name="exchange" value="okx" />
              <label for="okx" class="ml-2 cursor-pointer">OKX (30 req/s, 300 candles/req)</label>
            </div>
            <div class="flex align-items-center">
              <RadioButton v-model="selectedExchange" inputId="bybit" name="exchange" value="bybit" />
              <label for="bybit" class="ml-2 cursor-pointer">Bybit (120 req/s, 1000 candles/req) ⚡</label>
            </div>
          </div>
          <small class="text-gray-600">
            <strong>Performance comparison:</strong> Bybit is ~13x faster due to higher rate limits and larger batch sizes.
          </small>
        </div>
      </template>
    </Card>

    <Card class="mb-6">
      <template #title>
        <div class="flex items-center gap-3">
          <i class="pi pi-download text-xl"></i>
          Fetch Trading Pairs
        </div>
      </template>
      <template #content>
        <p class="mb-4">
          Fetch the list of available Futures and Swap pairs from <strong>{{ selectedExchange.toUpperCase() }}</strong> and store them in the database.
        </p>
        <div class="flex gap-3 items-center">
          <Button 
            :label="`Fetch ${selectedExchange.toUpperCase()} Pairs`" 
            icon="pi pi-download" 
            :loading="isFetchingPairs" 
            @click="handleFetchPairs" 
          />
          <Badge v-if="selectedExchange === 'bybit'" value="Fast" severity="success" />
        </div>
        <div v-if="lastFetchPairsJobId" class="mt-3 p-2 bg-blue-50 border border-blue-200 rounded">
          <span class="text-sm">Last job ID: {{ lastFetchPairsJobId }}. 
            <router-link :to="`/queue-manager?jobId=${lastFetchPairsJobId}`" class="text-blue-600 hover:underline">View in Queue Manager</router-link>
          </span>
        </div>
      </template>
    </Card>

    <Card>
      <template #title>
        <div class="flex items-center gap-3">
          <i class="pi pi-chart-line text-xl"></i>
          Fetch Historical Candles from {{ selectedExchange.toUpperCase() }}
        </div>
      </template>
      <template #content>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div class="flex flex-col gap-2">
            <label for="symbol">Symbol</label>
            <Select 
              id="symbol" 
              v-model="fetchParams.selectedSymbol" 
              :options="availableSymbols" 
              option-label="symbol" 
              :placeholder="`Select a Symbol from ${selectedExchange.toUpperCase()}`"
              show-clear
              filter 
              class="w-full" 
              :loading="isLoadingSymbols"
            />
            <small class="text-gray-600">
              {{ availableSymbols.length }} pairs available from {{ selectedExchange.toUpperCase() }}
            </small>
          </div>

          <div class="flex flex-col gap-2">
            <label for="timeframes">Timeframes</label>
            <MultiSelect 
              id="timeframes" 
              v-model="fetchParams.selectedTimeframes" 
              :options="availableTimeframes" 
              placeholder="Select Timeframes" 
              display="chip"
              class="w-full" 
            />
          </div>

          <div class="flex flex-col gap-2">
            <label for="startTime">Start Date (Optional)</label>
            <DatePicker id="startTime" v-model="fetchParams.startTimeDate" showTime hourFormat="24" dateFormat="yy-mm-dd" />
          </div>

          <div class="flex flex-col gap-2">
            <label for="endTime">End Date (Optional)</label>
            <DatePicker id="endTime" v-model="fetchParams.endTimeDate" showTime hourFormat="24" dateFormat="yy-mm-dd" />
          </div>

           <div class="flex flex-col gap-2">
            <label for="limit">Limit (Optional)</label>
            <InputNumber id="limit" v-model="fetchParams.limit" placeholder="Max candles to fetch" />
          </div>
        </div>
        
        <!-- НОВОЕ: Информация о производительности -->
        <div class="mt-4 p-3 bg-gray-50 border border-gray-200 rounded">
          <div class="text-sm">
            <strong>{{ selectedExchange.toUpperCase() }} Performance:</strong>
            <ul class="list-disc list-inside mt-1 text-gray-700">
              <li v-if="selectedExchange === 'okx'">30 requests/second, 300 candles per request</li>
              <li v-if="selectedExchange === 'bybit'">120 requests/second, 1000 candles per request (⚡ 13x faster overall)</li>
              <li>Estimated time for 3 years of 1h data: {{ getEstimatedTime() }}</li>
            </ul>
          </div>
        </div>

        <div class="mt-6">
           <Button 
             :label="`Fetch from ${selectedExchange.toUpperCase()}`" 
             icon="pi pi-download" 
             :loading="isFetchingCandles" 
             @click="handleFetchCandles" 
             :disabled="!fetchParams.selectedSymbol || !fetchParams.selectedTimeframes || fetchParams.selectedTimeframes.length === 0"
           />
        </div>
        <div v-if="lastFetchCandlesJobInfo.ids.length > 0" class="mt-3 p-2 bg-green-50 border border-green-200 rounded">
            <p class="text-sm font-medium mb-1">Candle fetch jobs queued ({{lastFetchCandlesJobInfo.succeeded}}/{{lastFetchCandlesJobInfo.attempted}}):</p>
            <ul class="list-disc list-inside text-sm">
                <li v-for="jobId in lastFetchCandlesJobInfo.ids" :key="jobId">
                    ID: {{ jobId }} 
                    <router-link :to="`/queue-manager?jobId=${jobId}`" class="text-blue-600 hover:underline">View</router-link>
                </li>
            </ul>
        </div>
      </template>
    </Card>

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