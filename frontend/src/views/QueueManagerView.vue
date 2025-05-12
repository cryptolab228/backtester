<template>
  <div class="p-4 md:p-6 bg-slate-50 min-h-screen">
    <Toast position="top-right" />
    <div class="max-w-7xl mx-auto">
      <h1 class="text-3xl font-bold text-slate-800 mb-8">Queue Manager</h1>

      <!-- Новая секция со счетчиками задач с использованием StatusCard -->
      <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        <StatusCard
          v-for="(status, index) in statusDisplayConfig"
          :key="status.key"
          :title="status.title"
          :value="status.value"
          :icon="status.icon"
          :colors="status.colors"
          :delay="index * 0.07" 
        />
      </div>

      <!-- Панель управления -->
      <div class="bg-white p-4 rounded-lg shadow-md mb-6">
        <div class="flex flex-wrap gap-3 items-center justify-between">
          <Button 
            label="Refresh All" 
            icon="pi pi-refresh" 
            @click="fetchAllQueueData" 
            :loading="isLoading"
            class="p-button-raised p-button-primary p-button-sm"
          />
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
          <Column field="name" header="Name" :sortable="true" style="min-width: 12rem;"></Column>
          <Column header="Status" :sortable="true" sortField="status" style="min-width: 10rem;">
            <template #body="slotProps">
              <Tag :value="getJobStatusInternal(slotProps.data)" :severity="getSeverity(getJobStatusInternal(slotProps.data))" rounded />
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
          <Column header="Actions" style="min-width:10rem" bodyClass="text-center">
            <template #body="slotProps">
              <Button icon="pi pi-eye" class="p-button-rounded p-button-info p-button-text p-button-sm mr-1" @click="showJobDetails(slotProps.data)" v-tooltip.top="'View Details'"/>
              <Button icon="pi pi-refresh" class="p-button-rounded p-button-success p-button-text p-button-sm mr-1" @click="handleRetryJob(slotProps.data.id)" :disabled="!canRetry(slotProps.data)" v-tooltip.top="'Retry Job'"/>
              <Button icon="pi pi-trash" class="p-button-rounded p-button-danger p-button-text p-button-sm" @click="handleRemoveJob(slotProps.data.id)" v-tooltip.top="'Remove Job'"/>
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
              <Button label="Close" icon="pi pi-times" @click="displayJobDetailsDialog = false" class="p-button-outlined p-button-secondary"/>
          </template>
      </Dialog>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'; // computed понадобится для displayedJobCounts
import Button from 'primevue/button';
import Toast from 'primevue/toast';
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';
import Tag from 'primevue/tag';
import Dialog from 'primevue/dialog';
import MultiSelect from 'primevue/multiselect';
import { useToast } from 'primevue/usetoast';

import StatusCard from '@/components/queue_manager/StatusCard.vue'; // Импорт нового компонента

import {
  getQueueJobCounts,
  getJobs,
  removeJob,
  retryJob,
} from '@/services/apiService';
import type { JobCounts, Job, JobStatus, GetJobsParams } from '@/services/apiService';

const toast = useToast();

const jobCounts = ref<JobCounts>({});
const jobs = ref<Job[]>([]);
const isLoading = ref(false);
const isFetchingJobsList = ref(false);
const error = ref<string | null>(null);

const defaultStatusesForFilter: JobStatus[] = ['active', 'waiting', 'failed', 'delayed', 'paused'];
const selectedJobStatuses = ref<JobStatus[]>(defaultStatusesForFilter);

const allAvailableJobStatuses: JobStatus[] = ['active', 'waiting', 'completed', 'failed', 'delayed', 'paused', 'wait', 'prioritized'];
const availableJobStatusesForFilter = computed(() => {
    const uniqueStatuses = [...new Set(allAvailableJobStatuses.map(s => s === 'wait' ? 'waiting' : s))];
    return uniqueStatuses.map(status => ({ label: status.charAt(0).toUpperCase() + status.slice(1), value: status }));
});

const displayedJobCountsOrder: JobStatus[] = ['active', 'waiting', 'delayed', 'failed', 'paused', 'completed'];
const displayedJobCounts = computed(() => {
  const counts: JobCounts = {};
  for (const status of displayedJobCountsOrder) {
    const currentStatusCount = jobCounts.value[status] ?? (status === 'waiting' ? jobCounts.value.wait : undefined) ?? 0;
    counts[status] = currentStatusCount;
  }
  return counts;
});

const statusDisplayConfig = computed(() => [
  {
    key: 'active',
    title: 'Active',
    icon: 'pi pi-spin pi-spinner',
    colors: ['#3b82f6', '#60a5fa', '#93c5fd'], // Синие
    value: displayedJobCounts.value.active ?? 0,
  },
  {
    key: 'waiting',
    title: 'Waiting',
    icon: 'pi pi-clock',
    colors: ['#eab308', '#facc15', '#fef08a'], // Желтые
    value: displayedJobCounts.value.waiting ?? 0,
  },
  {
    key: 'delayed',
    title: 'Delayed',
    icon: 'pi pi-hourglass',
    colors: ['#a855f7', '#c084fc', '#d8b4fe'], // Фиолетовые
    value: displayedJobCounts.value.delayed ?? 0,
  },
  {
    key: 'failed',
    title: 'Failed',
    icon: 'pi pi-times-circle',
    colors: ['#ef4444', '#f87171', '#fca5a5'], // Красные
    value: displayedJobCounts.value.failed ?? 0,
  },
  {
    key: 'paused',
    title: 'Paused',
    icon: 'pi pi-pause',
    colors: ['#6b7280', '#9ca3af', '#d1d5db'], // Серые
    value: displayedJobCounts.value.paused ?? 0,
  },
  {
    key: 'completed',
    title: 'Completed',
    icon: 'pi pi-check-circle',
    colors: ['#22c55e', '#4ade80', '#86efac'], // Зеленые
    value: displayedJobCounts.value.completed ?? 0,
  },
]);

const displayJobDetailsDialog = ref(false);
const selectedJobForDialog = ref<Job | null>(null);

const fetchJobCounts = async () => {
  try {
    jobCounts.value = await getQueueJobCounts();
    // --- Отладочный лог --- 
    console.log('Raw jobCounts from backend:', JSON.parse(JSON.stringify(jobCounts.value)));
    // ---------------------
  } catch (err: any) {
    const message = err.response?.data?.message || err.message || 'Failed to fetch job counts';
    toast.add({ severity: 'error', summary: 'Error Fetching Counts', detail: message, life: 4000 });
    error.value = message;
    jobCounts.value = {};
  }
};

const fetchJobsList = async (params?: GetJobsParams) => {
  isFetchingJobsList.value = true;
  try {
    const statusesToFetch = selectedJobStatuses.value.length > 0 ? selectedJobStatuses.value : undefined;
    let apiStatuses: JobStatus[] | undefined = statusesToFetch;
    if (statusesToFetch && statusesToFetch.includes('waiting') && !statusesToFetch.includes('wait')) {
        apiStatuses = [...statusesToFetch, 'wait'];
    }
    const queryParams: GetJobsParams = params || { status: apiStatuses };
    
    console.log('[QueueManagerView][fetchJobsList] About to call getJobs with queryParams:', JSON.parse(JSON.stringify(queryParams)));

    // --- Добавляем try...catch вокруг вызова getJobs --- 
    try {
      jobs.value = await getJobs(queryParams);
      console.log('[QueueManagerView][fetchJobsList] getJobs call completed. Jobs count:', jobs.value.length);
    } catch (apiError: any) {
      console.error('[QueueManagerView][fetchJobsList] Error calling getJobs from apiService:', apiError);
      toast.add({ severity: 'error', summary: 'API Error', detail: apiError.message || 'Failed to fetch jobs list via API', life: 5000 });
      jobs.value = []; // Очищаем задачи в случае ошибки
    }
    // -------------------------------------------------

  } catch (err: any) { // Этот catch остается для общих ошибок в функции fetchJobsList, если есть
    const message = err.response?.data?.message || err.message || 'Failed to fetch jobs list (outer catch)';
    toast.add({ severity: 'error', summary: 'Error Fetching Jobs', detail: message, life: 4000 });
    error.value = message; // Предполагается, что error - это ref для отображения ошибки в UI
    jobs.value = [];
  } finally {
    isFetchingJobsList.value = false;
  }
};

const fetchAllQueueData = async () => {
  isLoading.value = true;
  error.value = null;
  await Promise.all([
    fetchJobCounts(),
    fetchJobsList() 
  ]);
  isLoading.value = false;
};

onMounted(() => {
  fetchAllQueueData();
});

const handleStatusFilterChange = () => {
    fetchJobsList();
};

const showJobDetails = (jobData: Job) => {
  selectedJobForDialog.value = jobData; 
  displayJobDetailsDialog.value = true;
};

const onRowSelect = (_event: any) => {
};

const handleRemoveJob = async (jobId: string) => {
  isLoading.value = true;
  try {
    const response = await removeJob(jobId);
    toast.add({ severity: 'success', summary: 'Job Removed', detail: response.message, life: 3000 });
    await fetchAllQueueData();
  } catch (err: any) {
    const message = err.response?.data?.message || err.message || 'Failed to remove job';
    toast.add({ severity: 'error', summary: 'Error Removing Job', detail: message, life: 4000 });
  } finally {
    isLoading.value = false;
  }
};

const handleRetryJob = async (jobId: string) => {
  isLoading.value = true;
  try {
    const response = await retryJob(jobId);
    toast.add({ severity: 'success', summary: 'Job Retry', detail: response.message, life: 3000 });
    await fetchAllQueueData();
  } catch (err: any) {
    const message = err.response?.data?.message || err.message || 'Failed to retry job';
    toast.add({ severity: 'error', summary: 'Error Retrying Job', detail: message, life: 4000 });
  } finally {
    isLoading.value = false;
  }
};

const getJobStatusInternal = (job: Job): JobStatus => {
    if (job.finishedOn && !job.failedReason) return 'completed';
    if (job.failedReason) return 'failed';
    if (job.processedOn && !job.finishedOn) return 'active'; 
    if (job.opts?.delay != null && job.timestamp + job.opts.delay > Date.now() && !job.processedOn) return 'delayed';
    if (job.name && jobCounts.value.paused && selectedJobStatuses.value.includes('paused')){
    }
    return 'waiting'; 
};

const getSeverity = (status: JobStatus | string): PrimeVueSeverity => {
  switch (status) {
    case 'completed': return 'success';
    case 'failed': return 'danger';
    case 'active': return 'info';
    case 'waiting': case 'wait': return 'warning';
    case 'delayed': return 'contrast';
    case 'paused': return 'secondary';
    default: return undefined;
  }
};

type PrimeVueSeverity = 'success' | 'info' | 'warning' | 'danger' | 'secondary' | 'contrast' | undefined;

const canRetry = (job: Job): boolean => {
    return getJobStatusInternal(job) === 'failed';
};

const formatDate = (timestamp: number | null | undefined): string => {
    if (!timestamp) return 'N/A';
    return new Date(timestamp).toLocaleString();
};
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

.p-card .p-card-title {
    font-size: 1rem;
}
</style> 