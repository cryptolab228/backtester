<template>
  <div class="p-4 md:p-6 bg-slate-50 min-h-screen">
    <Toast position="top-right" />
    <ConfirmDialog />
    <div class="max-w-7xl mx-auto">
      <h1 class="text-3xl font-bold text-slate-800 mb-8">Queue Manager</h1>

      <!-- Updated StatusCard section -->
      <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
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
      <div class="bg-white p-4 rounded-lg shadow-md mb-6">
        <div class="flex flex-wrap gap-3 items-center justify-between">
          <!-- Removed Refresh Button -->
          <MultiSelect 
            v-model="selectedJobStatuses"
            :options="availableJobStatusesForFilter"
            optionLabel="label"
            optionValue="value"
            placeholder="Filter by Status"
            display="chip"
            class="p-inputtext-sm w-full md:w-72 lg:w-96"
            @change="handleStatusFilterChange"
          />
          <small v-if="autoRefreshActive" class="text-sm text-gray-500 ml-auto">Обновление через: {{ countdown }} сек.</small>
        </div>
      </div>
      
      <p v-if="isLoading && !jobs.length" class="text-center text-slate-500 py-4">Loading queue data...</p>
      <p v-if="error" class="text-center text-red-600 bg-red-100 p-3 rounded-md">Error loading data: {{ error }}</p>

      <!-- Таблица задач -->
      <div class="bg-white rounded-lg shadow-md overflow-hidden">
        <DataTable 
          v-if="!isLoading || jobs.length" 
          :value="jobs"
          :paginator="true" 
          :rows="10" 
          :rowsPerPageOptions="[5,10,20,50]"
          v-model:selection="selectedJobForDialog" 
          selectionMode="single"
          dataKey="id"
          @rowSelect="onRowSelect"
          responsiveLayout="scroll"
          class="p-datatable-sm md:p-datatable-md" 
          :loading="isFetchingJobsList"
          stripedRows
          rowHover
          currentPageReportTemplate="Showing {first} to {last} of {totalRecords} jobs"
        >
          <template #header>
            <div class="flex justify-between items-center p-3 bg-slate-100 border-b border-slate-200">
                <h2 class="text-xl font-semibold text-slate-700">Job List</h2>
                <!-- Moved countdown here if preferred -->
                <!-- <small v-if="autoRefreshActive" class="text-sm text-gray-500">Обновление через: {{ countdown }} сек.</small> -->
            </div>
          </template>
          <template #empty>
              <div class="p-4 text-center text-slate-500">No jobs found for selected statuses.</div>
          </template>
          
          <Column field="id" header="ID" :sortable="true" style="min-width: 8rem;">
            <template #body="slotProps">
              <span class="font-mono text-xs">{{ slotProps.data.id }}</span>
            </template>
          </Column>
          <Column field="name" header="Name" :sortable="true" style="min-width: 12rem;">
              <template #body="slotProps">
                 {{ getJobTypeDisplayName(slotProps.data.name) }} <!-- Display friendly name -->
              </template>
          </Column>
          <Column header="Status" :sortable="true" sortField="status" style="min-width: 10rem;">
            <template #body="slotProps">
              <!-- Use getSeverity and status directly from job data -->
              <Tag :value="slotProps.data.status || 'unknown'" :severity="getSeverity(slotProps.data.status)" rounded />
            </template>
          </Column>
          <Column field="attemptsMade" header="Attempts" :sortable="true" style="width: 8rem;" class="text-center"></Column>
          <Column field="timestamp" header="Created" :sortable="true" style="min-width: 12rem;">
            <template #body="slotProps">
              {{ formatDate(slotProps.data.timestamp) }}
            </template>
          </Column>
          <Column field="processedOn" header="Processed" :sortable="true" style="min-width: 12rem;">
            <template #body="slotProps">
              {{ formatDate(slotProps.data.processedOn) }}
            </template>
          </Column>
          <Column field="finishedOn" header="Finished" :sortable="true" style="min-width: 12rem;">
            <template #body="slotProps">
              {{ formatDate(slotProps.data.finishedOn) }}
            </template>
          </Column>
          <Column header="Actions" style="min-width:15rem" bodyClass="text-center">
            <template #body="slotProps">
              <Button icon="pi pi-eye" class="p-button-rounded p-button-info p-button-text p-button-sm mr-1" @click="showJobDetails(slotProps.data)" v-tooltip.top="'View Details'"/>
              <Button 
                v-if="canRetry(slotProps.data)" 
                icon="pi pi-replay" 
                class="p-button-rounded p-button-success p-button-text p-button-sm mr-1" 
                @click="handleRetryJob(slotProps.data.id)" 
                v-tooltip.top="'Retry Job'"/>
              <Button 
                v-if="canPause(slotProps.data)" 
                icon="pi pi-pause-circle" 
                class="p-button-rounded p-button-warning p-button-text p-button-sm mr-1" 
                @click="handlePauseJob(slotProps.data.id)" 
                v-tooltip.top="'Pause Job'"/>
              <Button 
                v-if="canResume(slotProps.data)" 
                icon="pi pi-play-circle" 
                class="p-button-rounded p-button-help p-button-text p-button-sm mr-1" 
                @click="handleResumeJob(slotProps.data.id)" 
                v-tooltip.top="'Resume Job'"/>
              <Button 
                icon="pi pi-trash" 
                class="p-button-rounded p-button-danger p-button-text p-button-sm" 
                @click="confirmRemoveJob(slotProps.data.id)"
                :disabled="!canRemove(slotProps.data)"
                 v-tooltip.top="'Remove Job'"/>
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
              <h3 class="text-lg font-semibold mb-2">Job ID: <span class="font-mono">{{ selectedJobForDialog.id }}</span></h3>
              <pre class="bg-slate-800 text-slate-100 p-4 rounded-md overflow-auto max-h-[60vh]">{{ JSON.stringify(selectedJobForDialog, null, 2) }}</pre>
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
  getJobCounts 
} from '@/services/apiService';
import type { Job, JobStatus, JobCounts } from '@/types/job.types'; 

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

// --- Auto Refresh Logic --- 
const REFRESH_INTERVAL = 10000; // 10 seconds
let refreshTimer: number | undefined = undefined;
const autoRefreshActive = ref(true);
const countdown = ref(REFRESH_INTERVAL / 1000);
let countdownTimer: number | undefined = undefined;

const startCountdown = () => {
  if (countdownTimer) clearInterval(countdownTimer);
  countdown.value = REFRESH_INTERVAL / 1000;
  countdownTimer = setInterval(() => {
    countdown.value -= 1;
    if (countdown.value <= 0) {
      clearInterval(countdownTimer);
    }
  }, 1000);
};

const scheduleNextRefresh = () => {
  if (refreshTimer) clearTimeout(refreshTimer);
  if (autoRefreshActive.value && !displayJobDetailsDialog.value) {
    startCountdown();
    refreshTimer = setTimeout(async () => {
      console.info('[QueueManagerView] Auto-refresh triggered.');
      await fetchAllQueueData(); // fetchAllQueueData includes counts and list
    }, REFRESH_INTERVAL);
    console.info(`[QueueManagerView] Next auto-refresh scheduled in ${REFRESH_INTERVAL / 1000} seconds.`);
  } else {
    if (countdownTimer) clearInterval(countdownTimer);
    countdown.value = REFRESH_INTERVAL / 1000; // Reset countdown for display
    console.info('[QueueManagerView] Auto-refresh is paused (dialog open or manually stopped). Next refresh not scheduled.');
  }
};

// --- Data Fetching --- 
const fetchJobCounts = async () => {
  console.debug('[QueueManagerView] Fetching job counts...');
  try {
    const counts = await getJobCounts();
    // Combine 'wait' into 'waiting' for display consistency
    if (counts.wait !== undefined) {
        counts.waiting = (counts.waiting || 0) + counts.wait;
        delete counts.wait; // Remove 'wait' after combining
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


// Combined fetch with loading state management
const fetchAllQueueData = async () => {
  if (!autoRefreshActive.value && refreshTimer) { 
      console.info('[QueueManagerView] Auto-refresh is paused. Skipping fetch.');
      return;
  }
  if (isLoading.value && refreshTimer) { 
    console.info('[QueueManagerView] A fetch is already in progress. Skipping auto-refresh cycle.');
    return;
  }

  console.info('[QueueManagerView] Fetching all queue data (counts and list). Selected statuses:', selectedJobStatuses.value);
  isLoading.value = true;
  error.value = null;
  try {
    // Fetch counts first, then list using the current filter
    await fetchJobCounts();
    await fetchJobsList(); 
    // Optional success toast removed for less noise during auto-refresh
    // toast.add({ severity: 'success', summary: 'Данные обновлены', detail: 'Списки задач и счетчики обновлены.', life: 2000 });
  } catch (err) { // Catch errors from either fetch
    console.error('[QueueManagerView] Error during fetchAllQueueData:', err);
    // Error toast is shown within individual fetch functions
    error.value = err instanceof Error ? err.message : 'Failed to update queue data';
  } finally {
    isLoading.value = false;
    scheduleNextRefresh(); // Schedule next refresh regardless of success/failure
  }
};


// --- Event Handlers & Actions --- 
onMounted(() => {
  console.info('[QueueManagerView] Component mounted. Initializing...');
  fetchAllQueueData(); // Initial fetch
});

onUnmounted(() => {
  console.info('[QueueManagerView] Component unmounted. Clearing refresh timers.');
  if (refreshTimer) clearTimeout(refreshTimer);
  if (countdownTimer) clearInterval(countdownTimer);
});

const handleStatusFilterChange = () => {
    console.debug('[QueueManagerView] Status filter changed. Fetching new job list...');
    clearTimeout(refreshTimer); // Stop scheduled auto-refresh
    if (countdownTimer) clearInterval(countdownTimer);
    fetchAllQueueData(); // Fetch immediately with new filters and restart timer
};

const showJobDetails = (jobData: Job) => {
  selectedJobForDialog.value = jobData; 
  displayJobDetailsDialog.value = true;
  // Stop auto-refresh when dialog is open
  autoRefreshActive.value = false; 
  if (refreshTimer) clearTimeout(refreshTimer);
  if (countdownTimer) clearInterval(countdownTimer);
  console.debug(`[QueueManagerView] Showing details for job: ${jobData.id}. Auto-refresh paused.`);
};

const closeJobDetailsDialog = () => {
  displayJobDetailsDialog.value = false;
  selectedJobForDialog.value = null;
  // Resume auto-refresh
  autoRefreshActive.value = true;
  scheduleNextRefresh();
  console.debug('[QueueManagerView] Job details dialog closed. Auto-refresh resumed.');
};

const onRowSelect = (event: DataTableRowSelectEvent) => {
  if (event.data) {
    showJobDetails(event.data as Job);
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

// Watch for dialog visibility to pause/resume auto-refresh (redundant with logic in show/close handlers)
// watch(displayJobDetailsDialog, (isDialogVisible) => {
//   autoRefreshActive.value = !isDialogVisible;
//   if (!isDialogVisible) {
//     scheduleNextRefresh();
//   }
// });

// Simplified type for GetJobsParams used in fetchJobsList
interface GetJobsParams {
  status?: JobStatus[];
  start?: number;
  end?: number;
}

</script>

<style scoped>
:deep(.p-tag) {
    @apply text-xs;
}

:deep(.p-datatable .p-datatable-thead > tr > th) {
  @apply bg-slate-50 text-slate-600 font-semibold text-sm;
}

:deep(.p-datatable .p-datatable-tbody > tr > td) {
  @apply text-slate-700 text-sm;
}

:deep(.p-button-sm) {
    @apply text-sm;
}

:deep(.p-multiselect-chip) {
    @apply bg-slate-200 text-slate-700 text-xs;
}
:deep(.p-multiselect:not(.p-disabled).p-focus) {
    @apply ring-1 ring-sky-500;
}

pre {
  white-space: pre-wrap;
  word-wrap: break-word;
  max-height: 100px; /* Limit height in table cell */
  overflow-y: auto;
  font-size: 0.75rem; /* Smaller font in table */
  background-color: #f8f9fa; /* Light background for pre in table */
  padding: 0.25rem;
  border-radius: 3px;
}

/* Override pre style specifically for the dialog */
.p-dialog pre {
    max-height: 60vh; /* Restore max height */
    font-size: 0.875rem; /* Restore default font size or adjust */
    background-color: rgb(30 41 59 / 1); /* Dialog specific background */
    color: rgb(241 245 249 / 1); /* Dialog specific text color */
    padding: 1rem; /* Dialog specific padding */
}

</style> 