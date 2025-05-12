<template>
  <div>
    <Toast /> <!-- Компонент для отображения уведомлений -->
    <h1 class="text-2xl font-semibold mb-6">Data Management</h1>

    <Card class="mb-6">
      <template #title>Fetch Trading Pairs</template>
      <template #content>
        <p class="mb-4">Fetch the list of available Futures and Swap pairs from OKX and store them in the database.</p>
        <Button label="Fetch Pairs" icon="pi pi-download" :loading="isFetchingPairs" @click="handleFetchPairs" />
        <div v-if="lastFetchPairsJobId" class="mt-3 p-2 bg-blue-50 border border-blue-200 rounded">
          <span class="text-sm">Last job ID: {{ lastFetchPairsJobId }}. 
            <router-link :to="`/queue-manager?jobId=${lastFetchPairsJobId}`" class="text-blue-600 hover:underline">View in Queue Manager</router-link>
          </span>
        </div>
      </template>
    </Card>

    <Card>
      <template #title>Fetch Historical Candles</template>
      <template #content>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div class="flex flex-col gap-2">
            <label for="symbol">Symbol</label>
            <Dropdown 
              id="symbol" 
              v-model="fetchParams.selectedSymbol" 
              :options="availableSymbols" 
              optionLabel="symbol" 
              placeholder="Select a Symbol"
              showClear
              filter 
              class="w-full" 
              :loading="isLoadingSymbols"
            />
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
            <Calendar id="startTime" v-model="fetchParams.startTimeDate" showTime hourFormat="24" dateFormat="yy-mm-dd" />
          </div>

          <div class="flex flex-col gap-2">
            <label for="endTime">End Date (Optional)</label>
            <Calendar id="endTime" v-model="fetchParams.endTimeDate" showTime hourFormat="24" dateFormat="yy-mm-dd" />
          </div>

           <div class="flex flex-col gap-2">
            <label for="limit">Limit (Optional)</label>
            <InputNumber id="limit" v-model="fetchParams.limit" placeholder="Max candles to fetch" />
          </div>
        </div>
        <div class="mt-6">
           <Button label="Fetch Candles" icon="pi pi-download" :loading="isFetchingCandles" @click="handleFetchCandles" :disabled="!fetchParams.selectedSymbol || !fetchParams.selectedTimeframes || fetchParams.selectedTimeframes.length === 0"/>
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

     <!-- TODO: Добавить секцию для отображения статуса задач -->

  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import Button from 'primevue/button';
import Dropdown from 'primevue/dropdown';
import MultiSelect from 'primevue/multiselect';
import Calendar from 'primevue/calendar';
import InputNumber from 'primevue/inputnumber';
import Card from 'primevue/card';
import Toast from 'primevue/toast';
import { useToast } from 'primevue/usetoast';
import { RouterLink } from 'vue-router'; // Импорт RouterLink
import { 
    triggerFetchPairsJob, 
    triggerFetchCandlesJob, 
    getAvailableTradingPairs 
} from '@/services/apiService';
import type { FetchCandlesParams, TradingPair } from '@/services/apiService';

const toast = useToast();

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
    '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d', '1w', '1M' // OKX формат
]);

const loadAvailableSymbols = async () => {
  isLoadingSymbols.value = true;
  try {
    availableSymbols.value = await getAvailableTradingPairs();
    if (availableSymbols.value.length > 0) {
        // Можно установить значение по умолчанию, если это необходимо
        // fetchParams.selectedSymbol = availableSymbols.value[0]; 
    }
  } catch (error: any) {
    toast.add({ severity: 'error', summary: 'Error Loading Symbols', detail: error.message || 'Failed to load trading symbols', life: 3000 });
  } finally {
    isLoadingSymbols.value = false;
  }
};

onMounted(() => {
  loadAvailableSymbols();
});

const handleFetchPairs = async () => {
  isFetchingPairs.value = true;
  lastFetchPairsJobId.value = null;
  try {
    const response = await triggerFetchPairsJob();
    if (response.jobId) {
        lastFetchPairsJobId.value = response.jobId;
        toast.add({ severity: 'success', summary: 'Job Queued', detail: `${response.message} (Job ID: ${response.jobId})`, life: 5000 });
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
        detail: `${response.message} Queued ${response.totalSuccessfullyQueued}/${response.totalAttempted} jobs.`, 
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