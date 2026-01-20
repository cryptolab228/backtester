<template>
  <div class="p-4">
    <div class="mb-6">
      <h1 class="text-4xl font-bold text-gray-900">Торговые сессии</h1>
      <p class="text-gray-600 mt-2">
        Управление торговыми сессиями и анализ результатов
      </p>
    </div>

    <ConfirmDialog />

    <!-- Селектор сессий и управление -->
    <SessionSelector />

    <!-- Фильтры -->
    <div class="bg-white rounded-lg shadow p-4 mb-4">
      <h3 class="text-sm font-semibold text-slate-700 mb-3 uppercase tracking-wide">Фильтры</h3>
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Статус</label>
          <Dropdown
            v-model="filters.status"
            :options="statusOptions"
            optionLabel="label"
            optionValue="value"
            placeholder="Все"
            @change="loadSessions"
            class="w-full"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Источник</label>
          <Dropdown
            v-model="filters.source"
            :options="sourceOptions"
            optionLabel="label"
            optionValue="value"
            placeholder="Все"
            @change="loadSessions"
            class="w-full"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">От даты</label>
          <Calendar
            v-model="filters.fromDate"
            @date-select="loadSessions"
            dateFormat="dd.mm.yy"
            showIcon
            class="w-full"
          />
    </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">До даты</label>
          <Calendar
            v-model="filters.toDate"
            @date-select="loadSessions"
            dateFormat="dd.mm.yy"
            showIcon
            class="w-full"
          />
        </div>
      </div>
    </div>

    <!-- Список сессий -->
    <div v-if="loading" class="flex justify-center items-center py-12">
      <ProgressSpinner animationDuration=".8s" strokeWidth="4" style="width: 40px; height: 40px"/>
      <span class="ml-3 text-slate-600 text-sm">Загрузка сессий...</span>
    </div>

    <Message v-else-if="sessions.length === 0" severity="info" :closable="false">
      Нет сессий по выбранным фильтрам
    </Message>

    <div v-else class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div
        v-for="session in sessions"
        :key="session.id"
        class="bg-white rounded-lg shadow p-4 cursor-pointer hover:shadow-md transition-shadow"
        :class="{ 'border-2 border-blue-500': selectedSession?.id === session.id }"
        @click="selectSession(session)"
      >
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-lg font-bold text-gray-800">
            {{ session.name || 'Без названия' }}
          </h3>
          <span class="px-2 py-1 text-xs rounded-full font-medium" :class="statusBadgeClass(session.status)">
            {{ statusLabel(session.status) }}
            </span>
        </div>
        
        <div class="text-sm text-gray-500 mb-3">
          ID: {{ session.id ? session.id.slice(0, 8) + '...' : 'N/A' }}
        </div>

        <div class="space-y-2 mb-4">
          <div class="flex justify-between text-sm">
            <span class="text-gray-600">Биржа:</span>
            <span class="font-semibold text-gray-800">{{ session.exchange.toUpperCase() }}</span>
          </div>

          <div class="flex justify-between text-sm">
            <span class="text-gray-600">Пары:</span>
            <span class="font-medium text-gray-700 text-right">
              {{ session.pairs.length > 0 ? session.pairs.join(', ') : 'Все' }}
            </span>
          </div>

          <div class="flex justify-between text-sm">
            <span class="text-gray-600">Таймфреймы:</span>
            <span class="font-medium text-gray-700">{{ session.timeframes.join(', ') }}</span>
          </div>

          <div class="flex justify-between text-sm">
            <span class="text-gray-600">Начало:</span>
            <span class="font-medium text-gray-700">{{ formatDate(session.startedAt) }}</span>
          </div>

          <div v-if="session.endedAt" class="flex justify-between text-sm">
            <span class="text-gray-600">Окончание:</span>
            <span class="font-medium text-gray-700">{{ formatDate(session.endedAt) }}</span>
          </div>

          <div v-if="session.notes" class="flex justify-between text-sm">
            <span class="text-gray-600">Заметки:</span>
            <span class="font-medium text-gray-700 text-right">{{ session.notes }}</span>
          </div>
            </div>

        <div class="flex gap-2 pt-3 border-t border-gray-200">
          <Button
            v-if="session.status === 'running'"
            @click.stop="endSession(session.id)"
            severity="danger"
            icon="pi pi-stop"
            label="Завершить"
            size="small"
            class="flex-1"
          />
          <Button 
            @click.stop="viewDetails(session)"
            severity="info"
            icon="pi pi-eye"
            label="Детали"
            size="small" 
            class="flex-1"
          />
          <Button 
            v-if="session.status !== 'running'"
            @click.stop="confirmDelete(session)"
            severity="danger"
            icon="pi pi-trash"
            label="Удалить"
            size="small" 
            class="flex-1"
          />
        </div>
      </div>
    </div>

    <!-- Детальная панель выбранной сессии -->
    <SessionDetailsPanel
      v-if="selectedSession"
      :session="selectedSession"
      @close="selectedSession = null"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import Button from 'primevue/button';
import Dropdown from 'primevue/dropdown';
import Calendar from 'primevue/calendar';
import ProgressSpinner from 'primevue/progressspinner';
import Message from 'primevue/message';
import ConfirmDialog from 'primevue/confirmdialog';
import { useConfirm } from 'primevue/useconfirm';
import { sessionService } from '@/services/sessionService';
import type { TradingSession, SessionFilters } from '@/types/session';
import SessionSelector from '@/components/SessionSelector.vue';
import SessionDetailsPanel from '@/components/SessionDetailsPanel.vue';

const sessions = ref<TradingSession[]>([]);
const selectedSession = ref<TradingSession | null>(null);
const loading = ref(false);
const confirmService = useConfirm();

const filters = ref<SessionFilters & { fromDate?: Date | string; toDate?: Date | string }>({
  source: undefined,
  status: undefined,
  fromDate: undefined,
  toDate: undefined,
  limit: 50,
});

const statusOptions = [
  { label: 'Все', value: '' },
  { label: 'Активные', value: 'running' },
  { label: 'Завершенные', value: 'completed' },
  { label: 'С ошибками', value: 'failed' },
  { label: 'Прерванные', value: 'interrupted' },
];

const sourceOptions = [
  { label: 'Все', value: '' },
  { label: 'Сканнер', value: 'scanner' },
  { label: 'Бэктестер', value: 'backtester' },
];

function statusBadgeClass(status: string) {
  switch (status) {
    case 'running': return 'bg-green-100 text-green-700';
    case 'completed': return 'bg-blue-100 text-blue-700';
    case 'failed': return 'bg-red-100 text-red-700';
    case 'interrupted': return 'bg-yellow-100 text-yellow-700';
    default: return 'bg-gray-100 text-gray-700';
  }
}

function statusLabel(status: string) {
  switch (status) {
    case 'running': return 'Активна';
    case 'completed': return 'Завершена';
    case 'failed': return 'Ошибка';
    case 'interrupted': return 'Прервана';
    default: return status;
  }
}

function formatDate(dateStr: string) {
  const date = new Date(dateStr);
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function loadSessions() {
  try {
    loading.value = true;
    // Конвертируем даты из Date в ISO строку
    const filtersToSend = {
      ...filters.value,
      fromDate: filters.value.fromDate instanceof Date ? filters.value.fromDate.toISOString().split('T')[0] : filters.value.fromDate,
      toDate: filters.value.toDate instanceof Date ? filters.value.toDate.toISOString().split('T')[0] : filters.value.toDate,
    };
    sessions.value = await sessionService.getSessions(filtersToSend);
  } catch (error: any) {
    console.error('Failed to load sessions:', error);
    alert(`Ошибка загрузки: ${error.message}`);
  } finally {
    loading.value = false;
  }
}

function selectSession(session: TradingSession) {
  selectedSession.value = session;
}

function viewDetails(session: TradingSession) {
  selectedSession.value = session;
}

async function endSession(sessionId: string) {
  confirmService.require({
    header: 'Завершить сессию?',
    message: 'Все открытые позиции будут закрыты. Продолжить?',
    icon: 'pi pi-exclamation-triangle',
    rejectLabel: 'Отмена',
    acceptLabel: 'Завершить',
    acceptClass: 'p-button-danger',
    accept: async () => {
      try {
        await sessionService.endSession(sessionId);
        await loadSessions();
      } catch (error: any) {
        alert(`Ошибка: ${error.response?.data?.error || error.message}`);
      }
    },
  });
}

function confirmDelete(session: TradingSession) {
  confirmService.require({
    header: 'Удалить сессию?',
    message: `Сессия "${session.name || session.id.slice(0, 8)}" и связанные сделки будут удалены без возможности восстановления. Продолжить?`,
    icon: 'pi pi-exclamation-triangle',
    rejectLabel: 'Отмена',
    acceptLabel: 'Удалить',
    acceptClass: 'p-button-danger',
    accept: async () => {
      await deleteSession(session.id);
    },
  });
}

async function deleteSession(sessionId: string) {
  try {
    await sessionService.deleteSession(sessionId);
    if (selectedSession.value?.id === sessionId) {
      selectedSession.value = null;
    }
    await loadSessions();
  } catch (error: any) {
    alert(`Ошибка удаления: ${error.response?.data?.error || error.message}`);
  }
}

onMounted(() => {
  loadSessions();
});
</script>
