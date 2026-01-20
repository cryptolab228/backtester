<template>
  <div class="p-4 md:p-6 bg-slate-50 min-h-screen">
    <Toast position="top-right" />
    <ConfirmDialog />
    <div class="mx-auto">
      <h1 class="text-3xl font-bold text-slate-800 mb-6 md:mb-8">Queue Manager</h1>

      <!-- Карточки статусов -->
      <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6 md:mb-8">
        <StatusCard
          v-for="(statusKey, index) in displayedJobCountsOrder"
          :key="statusKey"
          :title="statusDisplayConfig[statusKey as keyof typeof statusDisplayConfig]?.title || statusKey"
          :value="jobCounts[statusKey] || 0"
          :icon="statusDisplayConfig[statusKey as keyof typeof statusDisplayConfig]?.icon || 'pi pi-question-circle'"
          :colors="statusDisplayConfig[statusKey as keyof typeof statusDisplayConfig]?.colors || ['#cccccc', '#999999']"
          :delay="index * 0.07"
        />
      </div>

      <!-- Панель управления -->
      <div class="bg-white p-3 md:p-4 rounded-lg shadow-md mb-6">
        <div class="flex flex-wrap gap-3 items-center justify-between">
          <MultiSelect
            v-model="selectedJobStatuses"
            :options="availableJobStatusesForFilter"
            optionLabel="label"
            optionValue="value"
            placeholder="Filter by Status"
            display="chip"
            class="p-inputtext-sm w-full md:w-auto md:flex-grow lg:max-w-md"
            @change="handleStatusFilterChange"
          />
        </div>
      </div>

      <p v-if="isLoading && !jobs.length" class="text-center text-slate-500 py-4">Loading queue data...</p>
      <p v-if="error" class="text-center text-red-600 bg-red-100 p-3 rounded-md">Error loading data: {{ error }}</p>

      <!-- Таблица задач - Обертка для возможного скролла -->
      <div class="bg-white rounded-lg shadow-md overflow-x-auto">
        <DataTable
          v-if="!isLoading || jobs.length"
          :value="jobs"
          :paginator="true"
          :rows="15"
          :rowsPerPageOptions="[10, 15, 25, 50, 100]"
          v-model:selection="selectedJobForDialog"
          selectionMode="single"
          dataKey="id"
          @rowSelect="onRowSelect"
          responsiveLayout="stack"
          breakpoint="md"
          :scrollable="false"
          class="p-datatable-sm md:p-datatable-md w-full"
          :loading="isFetchingJobsList"
          stripedRows
          rowHover
          paginatorTemplate="FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink CurrentPageReport RowsPerPageDropdown"
          currentPageReportTemplate="Showing {first} to {last} of {totalRecords} jobs"
        >
          <template #header>
            <div class="flex justify-between items-center p-3 bg-slate-100 border-b border-slate-200">
                <h2 class="text-xl font-semibold text-slate-700">Job List</h2>
            </div>
          </template>
          <template #empty>
              <div class="p-4 text-center text-slate-500">No jobs found for selected statuses.</div>
          </template>

          <!-- Колонка ID - Сокращенная -->
          <Column field="id" header="ID" :sortable="true" style="width: 100px;">
            <template #body="slotProps">
              <span class="font-mono text-xs truncate block" v-tooltip.top="slotProps.data.id" style="max-width: 80px;">
                {{ slotProps.data.id }}
              </span>
            </template>
          </Column>

          <!-- Колонка Name -->
          <Column field="name" header="Name" :sortable="true" style="min-width: 150px;">
              <template #body="slotProps">
                 {{ getJobTypeDisplayName(slotProps.data.name) }}
              </template>
          </Column>

          <!-- Колонка Status -->
          <Column header="Status" :sortable="true" sortField="status" style="width: 120px;">
            <template #body="slotProps">
              <Tag :value="slotProps.data.status || 'unknown'" :severity="getSeverity(slotProps.data.status)" rounded />
            </template>
          </Column>

          <!-- Колонка Data Summary -->
          <Column header="Data" style="min-width: 200px;">
            <template #body="slotProps">
              <span class="text-sm truncate block" v-tooltip.bottom="JSON.stringify(slotProps.data.data)" style="max-width: 180px;">
                {{ getJobDataSummary(slotProps.data.data) }}
              </span>
            </template>
          </Column>

          <!-- Колонка Failed Reason -->
          <Column header="Failure Reason" field="failedReason" style="min-width: 200px;">
             <template #body="slotProps">
               <span v-if="slotProps.data.failedReason" class="text-sm text-red-600 truncate block" v-tooltip.bottom="slotProps.data.failedReason" style="max-width: 180px;">
                 {{ slotProps.data.failedReason }}
               </span>
               <span v-else class="text-slate-400">-</span>
             </template>
          </Column>

          <!-- Колонка Attempts -->
          <Column field="attemptsMade" header="Attempts" :sortable="true" style="width: 100px;" bodyClass="text-center"></Column>

          <!-- Колонка Created -->
          <Column field="timestamp" header="Created" :sortable="true" style="min-width: 160px;">
            <template #body="slotProps">
              <span class="text-xs">{{ formatDate(slotProps.data.timestamp) }}</span>
            </template>
          </Column>

          <!-- Колонка Processed -->
          <Column field="processedOn" header="Processed" :sortable="true" style="min-width: 160px;">
            <template #body="slotProps">
               <span class="text-xs">{{ formatDate(slotProps.data.processedOn) }}</span>
            </template>
          </Column>

          <!-- Колонка Finished -->
          <Column field="finishedOn" header="Finished" :sortable="true" style="min-width: 160px;">
            <template #body="slotProps">
               <span class="text-xs">{{ formatDate(slotProps.data.finishedOn) }}</span>
            </template>
          </Column>

          <!-- Колонка Actions - Заморожена справа -->
          <Column header="Actions" style="min-width:160px; width: 160px;" bodyClass="text-center" frozen alignFrozen="right">
            <template #body="slotProps">
              <div class="flex gap-1 justify-center">
                <Button icon="pi pi-eye" class="p-button-rounded p-button-info p-button-text p-button-sm" @click.stop="showJobDetails(slotProps.data)" v-tooltip.top="'View Details'"/>
                <Button
                  v-if="canRetry(slotProps.data)"
                  icon="pi pi-replay"
                  class="p-button-rounded p-button-success p-button-text p-button-sm"
                  @click.stop="handleRetryJob(slotProps.data.id)"
                  v-tooltip.top="'Retry Job'"/>
                <Button
                  v-if="canPause(slotProps.data)"
                  icon="pi pi-pause-circle"
                  class="p-button-rounded p-button-warning p-button-text p-button-sm"
                  @click.stop="handlePauseJob(slotProps.data.id)"
                  v-tooltip.top="'Pause Job'"/>
                <Button
                  v-if="canResume(slotProps.data)"
                  icon="pi pi-play-circle"
                  class="p-button-rounded p-button-help p-button-text p-button-sm"
                  @click.stop="handleResumeJob(slotProps.data.id)"
                  v-tooltip.top="'Resume Job'"/>
                <Button
                  v-if="canForceKill(slotProps.data)"
                  icon="pi pi-times-circle"
                  class="p-button-rounded p-button-danger p-button-outlined p-button-sm"
                  @click.stop="confirmForceKillJob(slotProps.data.id)"
                  v-tooltip.top="'Force Kill (принудительная остановка)'"
                  style="background-color: #dc3545; color: white; border-color: #dc3545;"
                  />
                <Button
                  icon="pi pi-trash"
                  class="p-button-rounded p-button-danger p-button-text p-button-sm"
                  @click.stop="confirmRemoveJob(slotProps.data.id)"
                  :disabled="!canRemove(slotProps.data)"
                  v-tooltip.top="'Remove Job'"/>
              </div>
            </template>
          </Column>
        </DataTable>
      </div>

      <!-- Диалог для деталей задачи -->
      <Dialog
        header="Job Details"
        v-model:visible="displayJobDetailsDialog"
        :modal="true"
        :style="{width: '75vw', maxWidth: '900px'}"
        :maximizable="true"
        dismissableMask
      >
          <div v-if="selectedJobForDialog" class="p-2 text-sm">
              <h3 class="text-lg font-semibold mb-3">
                Job ID: <span class="font-mono bg-slate-100 px-1 rounded">{{ selectedJobForDialog.id }}</span>
              </h3>
              <div class="text-base mb-3">
                Status: <Tag :value="selectedJobForDialog.status || 'unknown'" :severity="getSeverity(selectedJobForDialog.status)" rounded />
              </div>
              <!-- Используем компонент для рендеринга JSON -->
              <h4 class="text-md font-semibold mb-1 mt-4">Full Job Data:</h4>
              <pre class="bg-slate-800 text-slate-100 p-4 rounded-md overflow-auto max-h-[60vh] text-xs">{{ JSON.stringify(selectedJobForDialog, null, 2) }}</pre>
          </div>
          <template #footer>
              <Button label="Close" icon="pi pi-times" @click="closeJobDetailsDialog" class="p-button-outlined p-button-secondary"/>
          </template>
      </Dialog>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, onUnmounted } from 'vue';
import { useToast } from 'primevue/usetoast';
import { useConfirm } from 'primevue/useconfirm';
import DataTable from 'primevue/datatable';
import type { DataTableRowSelectEvent } from 'primevue/datatable'; 
import Column from 'primevue/column';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import Tag from 'primevue/tag';
import MultiSelect from 'primevue/multiselect';
import Toast from 'primevue/toast';
import ConfirmDialog from 'primevue/confirmdialog';
import StatusCard from '@/components/queue_manager/StatusCard.vue';

import { 
  getJobs, 
  retryJob as apiRetryJob, 
  removeJob as apiRemoveJob,
  pauseJob as apiPauseJob,
  resumeJob as apiResumeJob,
  forceKillJob as apiForceKillJob,
  getJobCounts 
} from '@/services/apiService';
import type { Job, JobStatus, JobCounts } from '@/types/job.types'; 

// --- WebSocket URL --- 
// TODO: Переместить в конфигурацию или переменные окружения
const WEBSOCKET_URL = 'ws://localhost:5000'; // Предполагаем, что бэкенд на порту 5000
// ---------------------

// --- Utility function moved inside setup --- 
const formatDate = (timestamp: number | string | Date | null | undefined): string => {
  if (!timestamp) return '-';
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) {
        return 'Invalid Date';
    }
    return date.toLocaleString();
  } catch (e) {
      console.error("Error formatting date:", timestamp, e);
      return 'Error Date';
  }
};
// ----------------------------------------

const toast = useToast();
const confirm = useConfirm();

const jobs = ref<Job[]>([]);
const jobCounts = ref<JobCounts>({});
const isLoading = ref(false);
const isFetchingJobsList = ref(false);
const error = ref<string | null>(null);

const defaultStatusesForFilter: JobStatus[] = ['active', 'waiting', 'failed', 'delayed', 'paused'];
const selectedJobStatuses = ref<JobStatus[]>(defaultStatusesForFilter);

const allAvailableJobStatuses: JobStatus[] = ['active', 'waiting', 'completed', 'failed', 'delayed', 'paused', 'wait', 'prioritized'];
const availableJobStatusesForFilter = computed(() => {
    // Combine 'wait' and 'waiting' for filter display
    const uniqueStatuses = [...new Set(allAvailableJobStatuses.map(s => s === 'wait' ? 'waiting' : s))];
    return uniqueStatuses.map(status => ({
        label: status.charAt(0).toUpperCase() + status.slice(1),
        value: status
    }));
});

// Order for status cards
const displayedJobCountsOrder: JobStatus[] = ['active', 'waiting', 'delayed', 'failed', 'paused', 'completed'];

// Тип для элементов конфигурации отображения статусов
type StatusDisplayDetail = {
  title: string;
  icon: string;
  colors: string[];
  severity: PrimeVueSeverity; // Используем существующий PrimeVueSeverity
};

// Configuration for Status Cards (matching StatusCard props)
const statusDisplayConfig = computed<Record<string, StatusDisplayDetail>>(() => ({
  active: {
    title: 'Active',
    icon: 'pi pi-spin pi-cog', // Changed icon for active
    colors: ['#3b82f6', '#60a5fa', '#93c5fd'], // Blue shades
    severity: 'info' // Used for Tag severity
  },
  waiting: {
    title: 'Waiting',
    icon: 'pi pi-clock',
    colors: ['#eab308', '#facc15', '#fef08a'], // Yellow shades
    severity: 'warning'
  },
  wait: { // Keep 'wait' separate internally if needed, but maps to 'waiting' visually
    title: 'Waiting (Wait)',
    icon: 'pi pi-clock',
    colors: ['#eab308', '#facc15', '#fef08a'], // Yellow shades
    severity: 'warning'
  },
  delayed: {
    title: 'Delayed',
    icon: 'pi pi-hourglass',
    colors: ['#a855f7', '#c084fc', '#d8b4fe'], // Purple shades
    severity: 'contrast' // PrimeVue severity
  },
  failed: {
    title: 'Failed',
    icon: 'pi pi-times-circle',
    colors: ['#ef4444', '#f87171', '#fca5a5'], // Red shades
    severity: 'danger'
  },
  paused: {
    title: 'Paused',
    icon: 'pi pi-pause',
    colors: ['#6b7280', '#9ca3af', '#d1d5db'], // Gray shades
    severity: 'secondary'
  },
  completed: {
    title: 'Completed',
    icon: 'pi pi-check-circle',
    colors: ['#22c55e', '#4ade80', '#86efac'], // Green shades
    severity: 'success'
  },
  prioritized: { // Added config for prioritized
    title: 'Prioritized',
    icon: 'pi pi-star',
    colors: ['#f97316', '#fb923c', '#fdba74'], // Orange shades
    severity: 'info'
  },
}));

// Helper to get severity for Tags in the table
const getSeverity = (status: JobStatus | string | undefined): PrimeVueSeverity => {
  if (!status) return undefined;
  // Теперь TypeScript должен корректно выводить тип severity
  return statusDisplayConfig.value[status as keyof typeof statusDisplayConfig.value]?.severity || 'secondary';
};

type PrimeVueSeverity = 'success' | 'info' | 'warning' | 'danger' | 'secondary' | 'contrast' | undefined;

// Optional: Friendly names for job types shown in table
const jobTypeDisplayNames: Record<string, string> = {
  'fetch-candles': 'Fetch Candles',
  'fetch-trading-pairs': 'Fetch Pairs',
  // Add other job names as needed
};

const getJobTypeDisplayName = (jobName: string) => jobTypeDisplayNames[jobName] || jobName;


const displayJobDetailsDialog = ref(false);
const selectedJobForDialog = ref<Job | null>(null);

// --- WebSocket State --- 
const ws = ref<WebSocket | null>(null);
const isWsConnected = ref(false);
// -----------------------

// --- УДАЛЕНА ЛОГИКА АВТООБНОВЛЕНИЯ (REFRESH_INTERVAL, refreshTimer, autoRefreshActive, countdown, countdownTimer, scheduleNextRefresh, startCountdown) --- 

// --- Data Fetching --- 
const fetchJobCounts = async () => {
  console.debug('[QueueManagerView] Fetching job counts...');
  try {
    const counts = await getJobCounts();
    // Combine 'wait' into 'waiting' for display consistency
    if (counts.wait !== undefined) {
        counts.waiting = (counts.waiting || 0) + counts.wait;
        // delete counts.wait; // Опционально
    }
    jobCounts.value = counts;
    console.info('[QueueManagerView] Job counts fetched and combined:', jobCounts.value);
  } catch (error: any) {
    console.error('[QueueManagerView] Error fetching job counts:', error);
    toast.add({ severity: 'error', summary: 'Ошибка', detail: 'Не удалось загрузить счетчики задач.', life: 3000 });
    jobCounts.value = {}; // Reset counts on error
  }
};

const fetchJobsList = async () => { // Uses selectedJobStatuses ref internally
  const statusesToFetch = selectedJobStatuses.value.length > 0 ? selectedJobStatuses.value : undefined;
  let apiStatuses: JobStatus[] | undefined = statusesToFetch;
  // If 'waiting' is selected by user, also fetch 'wait' from API
  if (statusesToFetch && statusesToFetch.includes('waiting') && !statusesToFetch.includes('wait')) {
      apiStatuses = [...statusesToFetch, 'wait'];
  }
  const queryParams: GetJobsParams = { status: apiStatuses }; // Use GetJobsParams type

  console.debug(`[QueueManagerView] Fetching jobs list with queryParams:`, queryParams);
  isFetchingJobsList.value = true;
  try {
    const fetchedJobs = await getJobs(queryParams);
    jobs.value = fetchedJobs;
    console.info(`[QueueManagerView] Jobs list fetched successfully. Count: ${fetchedJobs.length}`);
  } catch (error: any) {
    console.error('[QueueManagerView] Error fetching jobs list:', error.message, error);
    toast.add({ severity: 'error', summary: 'Ошибка', detail: 'Не удалось загрузить список задач: ' + error.message, life: 3000 });
    jobs.value = []; // Clear jobs on error
  } finally {
    isFetchingJobsList.value = false;
  }
};


// Combined fetch with loading state management (БЕЗ АВТООБНОВЛЕНИЯ)
const fetchAllQueueData = async () => {
  console.info('[QueueManagerView] Fetching all queue data (counts and list). Selected statuses:', selectedJobStatuses.value);
  isLoading.value = true;
  error.value = null;
  try {
    await fetchJobCounts();
    await fetchJobsList(); 
  } catch (err) { 
    console.error('[QueueManagerView] Error during fetchAllQueueData:', err);
    error.value = err instanceof Error ? err.message : 'Failed to update queue data';
  } finally {
    isLoading.value = false;
    // Убран вызов scheduleNextRefresh()
  }
};

// --- WebSocket Logic --- 
const connectWebSocket = () => {
  if (ws.value && ws.value.readyState === WebSocket.OPEN) {
    console.warn('[WebSocket] Already connected.');
    return;
  }
  console.info(`[WebSocket] Attempting to connect to ${WEBSOCKET_URL}...`);
  ws.value = new WebSocket(WEBSOCKET_URL);

  ws.value.onopen = () => {
    isWsConnected.value = true;
    console.info('[WebSocket] Connection established.');
    // ---> УДАЛЕН принудительный перезапрос данных <--- 
    // console.debug('[WebSocket] Connection opened, forcing data refresh.');
    // fetchAllQueueData(); 
    // -----------------------------------------------------------------------
  };

  ws.value.onclose = (event) => {
    isWsConnected.value = false;
    console.info(`[WebSocket] Connection closed. Code: ${event.code}, Reason: ${event.reason}`);
    ws.value = null;
    // Попытка переподключения через некоторое время
    setTimeout(connectWebSocket, 5000); // Повтор через 5 секунд
  };

  ws.value.onerror = (error) => {
    isWsConnected.value = false;
    console.error('[WebSocket] Connection error:', error);
    ws.value?.close(); // Закрываем при ошибке перед переподключением
  };

  ws.value.onmessage = (event) => {
    // ---> Добавлено логирование ПЕРЕД парсингом <--- 
    console.debug('[WebSocket] Raw message received:', event.data);
    try {
      const message = JSON.parse(event.data);
      // ---> Добавлено логирование ПОСЛЕ парсинга <--- 
      console.debug('[WebSocket] Parsed message:', message);

      switch (message.type) {
        case 'job_updated': { 
          const wsData = message as any;
          // --->>> ИЗМЕНЕНИЕ: Получаем ID из поля 'id' или 'jobId' <<<---
          const jobIdFromWs = wsData.id || wsData.jobId;
          // ----------------------------------------------------------

          // Проверяем, что ID получен
          if (!jobIdFromWs) {
            console.error('[WebSocket] Received job_updated message without a valid id or jobId:', message);
            break; // Прерываем обработку, если ID нет
          }

          const jobDataToApply = { ...wsData };
          delete jobDataToApply.type;    
          delete jobDataToApply.jobId; // Удаляем jobId, если он был
          delete jobDataToApply.id;    // Удаляем id, если он был

          const index = jobs.value.findIndex(j => j.id === jobIdFromWs);
          if (index !== -1) {
            // Обновляем существующую задачу, явно устанавливая id
            // Создаем новый объект для реактивности Vue
            jobs.value[index] = {
              ...jobs.value[index], // Сохраняем старые значения (если есть поля, не пришедшие по WS)
              ...jobDataToApply,    // Применяем новые данные из сообщения
              id: jobIdFromWs,      // Устанавливаем/перезаписываем id
              status: wsData.status as JobStatus // Явно приводим статус, если он есть в wsData
            };
            // Используем полученный ID в логе
            console.debug(`[WebSocket] Updated job ${jobIdFromWs}`);
          } else {
            // Если задачи нет, добавляем ее
            // Убедимся, что все обязательные поля Job присутствуют
            const newJob: Job = {
              name: jobDataToApply.name || 'Unknown Job', // Пример значения по умолчанию
              status: wsData.status as JobStatus || 'unknown', // Пример значения по умолчанию
              timestamp: jobDataToApply.timestamp || Date.now(), // Пример значения по умолчанию
              attemptsMade: jobDataToApply.attemptsMade || 0,
              // ... другие обязательные поля Job со значениями по умолчанию, если они не пришли
              ...(jobDataToApply as Partial<Omit<Job, 'id'>>), // Применяем пришедшие поля
              id: jobIdFromWs                          
            };
            jobs.value.push(newJob);
            // Используем полученный ID в логе
            console.debug(`[WebSocket] Added new job ${jobIdFromWs}`);
          }
          break;
        }
        case 'job_removed': {
          const { jobId } = message;
          jobs.value = jobs.value.filter(j => j.id !== jobId);
          console.debug(`[WebSocket] Removed job ${jobId}`);
          break;
        }
        case 'job_progress': {
          const { jobId, progress } = message;
          const index = jobs.value.findIndex(j => j.id === jobId);
          if (index !== -1) {
            jobs.value[index].progress = progress; // Предполагаем, что у Job есть поле progress
            console.debug(`[WebSocket] Updated progress for job ${jobId}`);
          }
          break;
        }
        case 'job_counts_updated': {
          const { counts } = message;
          jobCounts.value = counts;
          console.debug('[WebSocket] Updated job counts');
          break;
        }
        case 'jobs_cleaned': {
            const { jobIds } = message;
            if (Array.isArray(jobIds)) {
                jobs.value = jobs.value.filter(j => !jobIds.includes(j.id));
                console.debug(`[WebSocket] Cleaned ${jobIds.length} jobs`);
            }
            break;
        }
        // Добавить обработку других типов сообщений при необходимости (e.g., queue_status_updated)
        default:
          console.warn(`[WebSocket] Received unknown message type: ${message.type}`);
      }
    } catch (error) {
      // ---> Добавлено логирование ОШИБКИ <--- 
      console.error('[WebSocket] Error processing message:', error, 'Raw data:', event.data);
    }
  };
};

// --- Event Handlers & Actions --- 
onMounted(() => {
  console.info('[QueueManagerView] Component mounted. Initializing...');
  fetchAllQueueData(); // Initial fetch
  connectWebSocket(); // Устанавливаем WebSocket соединение
});

onUnmounted(() => {
  console.info('[QueueManagerView] Component unmounted. Closing WebSocket connection.');
  ws.value?.close();
  ws.value = null;
  // Очищаем таймер переподключения, если он есть (хотя он должен сработать в onclose)
  // clearTimeout(reconnectTimer); 
});

const handleStatusFilterChange = () => {
    console.debug('[QueueManagerView] Status filter changed. Fetching new job list...');
    // УБРАНЫ clearTimeout/clearInterval
    fetchAllQueueData(); // Просто перезапрашиваем список с новым фильтром
};

const showJobDetails = (jobData: Job) => {
  selectedJobForDialog.value = { ...jobData }; // Копируем объект
  displayJobDetailsDialog.value = true;
  console.debug(`[QueueManagerView] Showing details for job: ${jobData.id}.`);
};

const closeJobDetailsDialog = () => {
  displayJobDetailsDialog.value = false;
  selectedJobForDialog.value = null;
  // УБРАНО возобновление автообновления
  console.debug('[QueueManagerView] Job details dialog closed.');
};

const onRowSelect = (event: DataTableRowSelectEvent) => {
  if (event.data) {
    // Используем копию данных для диалога, чтобы изменения в диалоге (если будут)
    // не влияли на таблицу до явного сохранения
    showJobDetails({ ...event.data } as Job);
  }
};

const confirmRemoveJob = (jobId: string) => {
  console.debug(`[QueueManagerView] Confirming removal for job: ${jobId}`);
  confirm.require({
    message: `Вы уверены, что хотите удалить задачу ${jobId}? Это действие необратимо.`,
    header: 'Подтверждение удаления',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Удалить',
    rejectLabel: 'Отмена',
    acceptClass: 'p-button-danger',
    accept: async () => {
      await handleRemoveJob(jobId);
    },
    reject: () => {
      toast.add({ severity: 'info', summary: 'Отменено', detail: 'Удаление задачи отменено.', life: 3000 });
    }
  });
};

const handleRemoveJob = async (jobId: string) => {
  console.info(`[QueueManagerView] Removing job: ${jobId}`);
  isLoading.value = true; // Indicate loading during action
  try {
    const result = await apiRemoveJob(jobId);
    toast.add({ severity: 'success', summary: 'Успех', detail: result.message || `Задача ${jobId} удалена.`, life: 3000 });
    await fetchAllQueueData(); // Refresh data after action
  } catch (error: any) {
    console.error('[QueueManagerView] Error removing job:', error);
    toast.add({ severity: 'error', summary: 'Ошибка', detail: `Не удалось удалить задачу ${jobId}: ${error.message}`, life: 3000 });
  } finally {
    isLoading.value = false;
  }
};

const handleRetryJob = async (jobId: string) => {
  console.info(`[QueueManagerView] Retrying job: ${jobId}`);
  isLoading.value = true;
  try {
    const response = await apiRetryJob(jobId);
    toast.add({ severity: 'success', summary: 'Job Retry', detail: response.message, life: 3000 });
    await fetchAllQueueData();
  } catch (error: any) {
    console.error('[QueueManagerView] Error retrying job:', error);
    toast.add({ severity: 'error', summary: 'Error Retrying Job', detail: `Failed to retry job ${jobId}: ${error.message}`, life: 4000 });
  } finally {
    isLoading.value = false;
  }
};

const handlePauseJob = async (jobId: string) => {
  console.info(`[QueueManagerView] Pausing job: ${jobId}`);
  isLoading.value = true;
  try {
    const result = await apiPauseJob(jobId);
    toast.add({ severity: 'success', summary: 'Успех', detail: result.message || `Задача ${jobId} поставлена на паузу.`, life: 3000 });
    // ---> Немедленное обновление статуса для улучшения UX <--- 
    const jobIndex = jobs.value.findIndex(j => j.id === jobId);
    if (jobIndex !== -1) {
      jobs.value[jobIndex].status = 'delayed'; // Устанавливаем статус "delayed" (ожидаем, что воркер переместит)
      console.debug(`[QueueManagerView] Immediately updated job ${jobId} status to 'delayed' in local state.`);
    }
    // -----------------------------------------------------
    await fetchAllQueueData(); // Оставляем пока для подстраховки и обновления счетчиков
  } catch (error: any) {
    console.error('[QueueManagerView] Error pausing job:', error);
    toast.add({ severity: 'error', summary: 'Ошибка', detail: `Не удалось поставить задачу ${jobId} на паузу: ${error.message}`, life: 3000 });
  } finally {
    isLoading.value = false;
  }
};

const handleResumeJob = async (jobId: string) => {
  console.info(`[QueueManagerView] Resuming job: ${jobId}`);
  isLoading.value = true;
  try {
    const result = await apiResumeJob(jobId);
    toast.add({ severity: 'success', summary: 'Успех', detail: result.message || `Задача ${jobId} возобновлена.`, life: 3000 });
    // ---> Немедленное обновление статуса для улучшения UX <--- 
    const jobIndex = jobs.value.findIndex(j => j.id === jobId);
    if (jobIndex !== -1) {
      jobs.value[jobIndex].status = 'waiting'; // Устанавливаем статус "ожидания"
      console.debug(`[QueueManagerView] Immediately updated job ${jobId} status to 'waiting' in local state.`);
    }
    // -----------------------------------------------------
    await fetchAllQueueData(); // Оставляем пока для подстраховки и обновления счетчиков
  } catch (error: any) {
    console.error('[QueueManagerView] Error resuming job:', error);
    toast.add({ severity: 'error', summary: 'Ошибка', detail: `Не удалось возобновить задачу ${jobId}: ${error.message}`, life: 3000 });
  } finally {
    isLoading.value = false;
  }
};

const confirmForceKillJob = (jobId: string) => {
  console.debug(`[QueueManagerView] Confirming force kill for job: ${jobId}`);
  confirm.require({
    message: `Вы уверены, что хотите принудительно остановить задачу ${jobId}? Это действие немедленно прервет выполнение задачи.`,
    header: 'Принудительная остановка',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Force Kill',
    rejectLabel: 'Отмена',
    acceptClass: 'p-button-danger',
    accept: async () => {
      await handleForceKillJob(jobId);
    },
    reject: () => {
      toast.add({ severity: 'info', summary: 'Отменено', detail: 'Принудительная остановка задачи отменена.', life: 3000 });
    }
  });
};

const handleForceKillJob = async (jobId: string) => {
  console.info(`[QueueManagerView] Force killing job: ${jobId}`);
  isLoading.value = true;
  try {
    const result = await apiForceKillJob(jobId);
    toast.add({ 
      severity: 'warn', 
      summary: 'Force Kill', 
      detail: `Задача ${jobId} принудительно остановлена (был в статусе: ${result.previousState})`, 
      life: 4000 
    });
    
    // Немедленное обновление статуса в UI
    const jobIndex = jobs.value.findIndex(j => j.id === jobId);
    if (jobIndex !== -1) {
      jobs.value[jobIndex].status = 'failed'; // Force-killed задачи помечаются как failed
      console.debug(`[QueueManagerView] Updated job ${jobId} status to 'failed' after force kill`);
    }
    
    await fetchAllQueueData(); // Обновляем данные
  } catch (error: any) {
    console.error('[QueueManagerView] Error force killing job:', error);
    toast.add({ 
      severity: 'error', 
      summary: 'Force Kill Failed', 
      detail: `Не удалось принудительно остановить задачу ${jobId}: ${error.message}`, 
      life: 5000 
    });
  } finally {
    isLoading.value = false;
  }
};

// --- Button Visibility Logic --- 
const canRetry = (job: Job): boolean => {
  // Allow retry for failed jobs
  const status = job.status as JobStatus;
  return status === 'failed';
};

const canPause = (job: Job): boolean => {
  const status = job.status as JobStatus;
  // Разрешаем паузу только для 'waiting' and 'wait'
  return status === 'waiting' || status === 'wait';
};

const canResume = (job: Job): boolean => {
  const status = job.status as JobStatus;
  // Разрешаем возобновление для 'delayed' (так как воркер переводит в delayed при паузе)
  return status === 'delayed';
};

const canRemove = (_job: Job): boolean => {
  // Allow removing any job for now
  return true; 
};

const canForceKill = (job: Job): boolean => {
  const status = job.status as JobStatus;
  // Force kill доступен для активных, ожидающих и задач на паузе
  return ['active', 'waiting', 'wait', 'delayed', 'paused'].includes(status);
};

// Simplified type for GetJobsParams used in fetchJobsList
interface GetJobsParams {
  status?: JobStatus[];
  start?: number;
  end?: number;
}

// НОВАЯ ФУНКЦИЯ для получения краткого описания данных задачи
const getJobDataSummary = (data: any): string => {
  if (!data) return '-';
  if (typeof data !== 'object') return String(data);

  // Пример для задачи fetch-candles
  if (data.symbol && data.timeframe) {
    return `${data.symbol} (${data.timeframe})${data.limit ? ', L:' + data.limit : ''}`;
  }
  // Добавить другие типы задач по аналогии
  // if (data.someOtherKey) { ... }

  // Общий случай - первые несколько ключей
  const keys = Object.keys(data);
  if (keys.length === 0) return '{}';
  return keys.slice(0, 2).map(key => `${key}: ${String(data[key]).substring(0,15)}${String(data[key]).length > 15 ? '...' : ''}`).join(', ') + (keys.length > 2 ? ', ...' : '');
};

</script>

<style scoped>
/* Стили для обрезки текста */
.truncate {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* Добавляем немного больше padding ячейкам */
:deep(.p-datatable .p-datatable-tbody > tr > td) {
  @apply text-slate-700 text-sm py-3 px-2 md:px-3; /* Увеличиваем вертикальный padding */
}

/* Уменьшаем padding для кнопок действий, чтобы они помещались */
:deep(.p-datatable .p-datatable-tbody > tr > td.p-frozen-column) {
   padding-top: 0.4rem !important;
   padding-bottom: 0.4rem !important;
}

/* Стили для pre в диалоге (уже были, но проверим) */
.p-dialog pre {
    max-height: 60vh;
    font-size: 0.8rem; /* Сделаем чуть меньше для большего обзора */
    background-color: rgb(30 41 59 / 1);
    color: rgb(241 245 249 / 1);
    padding: 1rem;
    border-radius: 6px;
}

/* Улучшение внешнего вида чипов MultiSelect */
:deep(.p-multiselect-chip) {
    @apply bg-sky-100 text-sky-800 text-xs font-medium;
}
:deep(.p-multiselect:not(.p-disabled).p-focus) {
    @apply ring-2 ring-sky-500/50; /* Более заметный фокус */
}
</style> 