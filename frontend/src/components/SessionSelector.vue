<template>
  <div class="mb-6">
    <!-- Статус сканера -->
    <div class="bg-white rounded-lg shadow p-4 mb-4">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="status-indicator" :class="statusClass"></div>
          <div>
            <div class="text-base font-semibold text-gray-800">
              {{ statusText }}
            </div>
            <div v-if="activeSession" class="text-sm text-gray-600 mt-1">
              Сессия: {{ activeSession.name || (activeSession.id ? activeSession.id.slice(0, 8) : 'N/A') }}
            </div>
          </div>
        </div>
        
        <!-- Кнопки управления -->
        <div class="flex gap-2">
          <!-- Кнопка создания всегда доступна -->
          <Button
            @click="showCreateModal = true"
            :disabled="loading || isRunning"
            :title="isRunning ? 'Остановите сканнер чтобы создать новую сессию' : 'Создать новую сессию'"
            icon="pi pi-plus"
            label="Новая сессия"
            size="small"
          />
          
          <Button
            v-if="isRunning"
            @click="handleStop"
            :disabled="loading"
            severity="danger"
            icon="pi pi-stop"
            label="Остановить"
            size="small"
          />
        </div>
      </div>
    </div>

    <!-- Выбор существующей сессии (если сканнер не запущен) -->
    <div v-if="!isRunning && sessions.length > 0" class="bg-white rounded-lg shadow p-4">
      <h3 class="text-sm font-semibold text-slate-700 mb-3 uppercase tracking-wide">Выберите сессию для продолжения:</h3>
      <div class="grid gap-3">
        <div
          v-for="session in recentSessions"
          :key="session.id"
          class="border border-gray-200 rounded-lg p-4 hover:border-blue-300 hover:bg-blue-50/50 transition-colors cursor-pointer"
          @click="handleSelectSession(session)"
        >
          <div class="flex items-start justify-between">
            <div class="flex-1">
              <div class="flex items-center gap-2 mb-2">
                <span class="font-semibold text-gray-800">{{ session.name || 'Без названия' }}</span>
                <span v-if="session.autoStarted" class="px-2 py-0.5 bg-yellow-100 text-yellow-700 text-xs rounded-full font-medium">
                  Авто
                </span>
                <span class="px-2 py-0.5 text-xs rounded-full font-medium" :class="statusBadgeClass(session.status)">
                  {{ statusLabel(session.status) }}
                </span>
              </div>
              <div class="text-sm text-gray-600 mb-1">
                <i class="pi pi-calendar mr-1"></i>{{ formatDate(session.createdAt) }}
              </div>
              <div v-if="session.notes" class="text-sm text-gray-500 mb-1">
                {{ session.notes }}
              </div>
              <div class="text-sm text-gray-600">
                <i class="pi pi-chart-line mr-1"></i>{{ session.pairs.join(', ') || 'Все' }}
              </div>
            </div>
            <Button
              :disabled="loading"
              severity="success"
              icon="pi pi-play"
              label="Запустить"
              size="small"
              @click.stop="handleStart(session.id)"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Модальное окно создания сессии -->
    <CreateSessionModal
      v-if="showCreateModal"
      @close="showCreateModal = false"
      @created="handleSessionCreated"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import Button from 'primevue/button';
import { sessionService } from '@/services/sessionService';
import type { TradingSession, ScannerStatus } from '@/types/session';
import CreateSessionModal from './CreateSessionModal.vue';
import { useScannerStore } from '@/stores/scannerStore';

const sessions = ref<TradingSession[]>([]);
const activeSession = ref<TradingSession | null>(null);
const scannerStatus = ref<ScannerStatus>({ isRunning: false });
const loading = ref(false);
const showCreateModal = ref(false);
const scannerStore = useScannerStore();

const isRunning = computed(() => scannerStatus.value.isRunning);

const statusClass = computed(() => {
  if (isRunning.value) return 'status-running';
  return 'status-idle';
});

const statusText = computed(() => {
  if (isRunning.value) return 'Сканер работает';
  return 'Сканер остановлен';
});

const recentSessions = computed(() => {
  return sessions.value
    .filter(s => s.source === 'scanner')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);
});

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

async function loadData() {
  try {
    loading.value = true;
    const [sessionsData, statusData, activeData] = await Promise.all([
      sessionService.getSessions({ source: 'scanner', limit: 10 }),
      sessionService.getScannerStatus(),
      sessionService.getActiveSession(),
    ]);

    sessions.value = sessionsData;
    scannerStatus.value = statusData;
    activeSession.value = activeData;

    if (activeData?.id) {
      scannerStore.currentSessionId = activeData.id;
      await Promise.all([
        scannerStore.loadExecutions(),
        scannerStore.loadExchangeHistory(),
      ]);
    }
  } catch (error: any) {
    console.error('Failed to load session data:', error);
  } finally {
    loading.value = false;
  }
}

async function handleStart(sessionId: string) {
  try {
    loading.value = true;
    await sessionService.startScanner(sessionId);
    scannerStore.currentSessionId = sessionId;
    await Promise.all([
      scannerStore.loadStatus(),
      scannerStore.loadExecutions(),
      scannerStore.loadExchangeHistory(),
    ]);
    await loadData();
  } catch (error: any) {
    alert(`Ошибка при запуске: ${error.response?.data?.error || error.message}`);
  } finally {
    loading.value = false;
  }
}

async function handleStop() {
  if (!confirm('Остановить сканер и завершить текущую сессию?')) return;
  
  try {
    loading.value = true;
    await sessionService.stopScanner();
    scannerStore.currentSessionId = null;
    scannerStore.clearSignals();
    await loadData();
  } catch (error: any) {
    alert(`Ошибка при остановке: ${error.response?.data?.error || error.message}`);
  } finally {
    loading.value = false;
  }
}

async function handleSelectSession(session: TradingSession) {
  // Просто показываем информацию, не запускаем автоматически
  scannerStore.currentSessionId = session.id;
  await Promise.all([
    scannerStore.loadExecutions(),
    scannerStore.loadExchangeHistory(),
  ]);
}

async function handleSessionCreated(newSession: TradingSession) {
  showCreateModal.value = false;
  await loadData();
  
  // Предлагаем сразу запустить новую сессию
  if (confirm(`Сессия "${newSession.name}" создана. Запустить сканер?`)) {
    await handleStart(newSession.id);
  }
}

onMounted(() => {
  loadData();
  
  // Обновляем статус каждые 5 секунд
  setInterval(loadData, 5000);
});
</script>

<style scoped>
.status-indicator {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  animation: pulse 2s infinite;
}

.status-running .status-indicator {
  background: #10b981;
  box-shadow: 0 0 10px #10b981;
}

.status-idle .status-indicator {
  background: #6b7280;
  animation: none;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
</style>

