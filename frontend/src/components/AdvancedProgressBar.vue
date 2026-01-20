<template>
  <div class="advanced-progress-container">
    <!-- Основной прогресс-бар -->
    <div class="bg-white rounded-lg shadow-lg p-6 mb-4">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-lg font-semibold text-gray-900 flex items-center">
          <i class="pi pi-cog pi-spin mr-2 text-blue-600" v-if="isActive"></i>
          <i class="pi pi-check-circle mr-2 text-green-600" v-else-if="isCompleted"></i>
          <i class="pi pi-clock mr-2 text-gray-600" v-else></i>
          {{ title }}
        </h3>
        <div class="flex items-center space-x-2">
          <Badge :value="currentStage" :severity="stageSeverity" />
          <span class="text-sm text-gray-500">{{ progressPercent }}%</span>
        </div>
      </div>

      <!-- Основной прогресс -->
      <div class="mb-4">
        <div class="flex justify-between text-sm text-gray-600 mb-2">
          <span>{{ currentStageDescription }}</span>
          <span>{{ processedItems }}/{{ totalItems }}</span>
        </div>
        <ProgressBar 
          :value="progressPercent" 
          :showValue="false"
          class="h-3 rounded-full"
          :class="progressBarClass"
        />
      </div>

      <!-- Детальные метрики -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <!-- Время выполнения -->
        <div class="bg-blue-50 p-3 rounded-lg">
          <div class="text-xs text-blue-600 font-medium">Время выполнения</div>
          <div class="text-lg font-bold text-blue-700">{{ formatDuration(elapsedTime) }}</div>
        </div>

        <!-- Оставшееся время -->
        <div class="bg-orange-50 p-3 rounded-lg">
          <div class="text-xs text-orange-600 font-medium">Осталось</div>
          <div class="text-lg font-bold text-orange-700">{{ formatDuration(estimatedTimeRemaining) }}</div>
        </div>

        <!-- Производительность -->
        <div class="bg-green-50 p-3 rounded-lg">
          <div class="text-xs text-green-600 font-medium">Скорость</div>
          <div class="text-lg font-bold text-green-700">{{ performanceRate }}</div>
        </div>

        <!-- Память -->
        <div class="bg-purple-50 p-3 rounded-lg">
          <div class="text-xs text-purple-600 font-medium">Память</div>
          <div class="text-lg font-bold text-purple-700">{{ memoryUsage }}</div>
        </div>
      </div>

      <!-- Детальная разбивка по этапам -->
      <div v-if="stageBreakdown && stageBreakdown.length > 0" class="border-t pt-4">
        <h4 class="text-sm font-medium text-gray-700 mb-3">Прогресс по этапам</h4>
        <div class="space-y-2">
          <div v-for="stage in stageBreakdown" :key="stage.name" class="flex items-center justify-between">
            <div class="flex items-center">
              <i :class="getStageIcon(stage.status)" class="mr-2"></i>
              <span class="text-sm text-gray-700">{{ stage.name }}</span>
            </div>
            <div class="flex items-center space-x-2">
              <div class="w-20 bg-gray-200 rounded-full h-2">
                <div 
                  class="h-2 rounded-full transition-all duration-300"
                  :class="getStageProgressClass(stage.status)"
                  :style="{ width: stage.progress + '%' }"
                ></div>
              </div>
              <span class="text-xs text-gray-500 w-12">{{ stage.progress }}%</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Статистика портфельного бэктеста -->
      <div v-if="portfolioStats" class="border-t pt-4 mt-4">
        <h4 class="text-sm font-medium text-gray-700 mb-3">Статистика портфеля</h4>
        <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div class="bg-gray-50 p-2 rounded">
            <div class="text-xs text-gray-600">Пары обработано</div>
            <div class="text-sm font-semibold">{{ portfolioStats.processedPairs }}/{{ portfolioStats.totalPairs }}</div>
          </div>
          <div class="bg-gray-50 p-2 rounded">
            <div class="text-xs text-gray-600">Сделок найдено</div>
            <div class="text-sm font-semibold">{{ portfolioStats.totalTrades }}</div>
          </div>
          <div class="bg-gray-50 p-2 rounded">
            <div class="text-xs text-gray-600">Данных загружено</div>
            <div class="text-sm font-semibold">{{ portfolioStats.dataLoaded }}</div>
          </div>
        </div>
      </div>

      <!-- GPU статистика (если включено) -->
      <div v-if="gpuStats && gpuStats.enabled" class="border-t pt-4 mt-4">
        <h4 class="text-sm font-medium text-gray-700 mb-3 flex items-center">
          <i class="pi pi-microchip mr-2 text-green-600"></i>
          GPU Ускорение
        </h4>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div class="bg-green-50 p-2 rounded">
            <div class="text-xs text-green-600">Статус</div>
            <div class="text-sm font-semibold text-green-700">{{ gpuStats.status }}</div>
          </div>
          <div class="bg-green-50 p-2 rounded">
            <div class="text-xs text-green-600">Использование</div>
            <div class="text-sm font-semibold text-green-700">{{ gpuStats.utilization }}%</div>
          </div>
          <div class="bg-green-50 p-2 rounded">
            <div class="text-xs text-green-600">Память GPU</div>
            <div class="text-sm font-semibold text-green-700">{{ gpuStats.memoryUsage }}</div>
          </div>
          <div class="bg-green-50 p-2 rounded">
            <div class="text-xs text-green-600">Ускорение</div>
            <div class="text-sm font-semibold text-green-700">{{ gpuStats.speedup }}x</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Лог активности (опционально) -->
    <div v-if="showActivityLog && activityLog.length > 0" class="bg-white rounded-lg shadow p-4">
      <h4 class="text-sm font-medium text-gray-700 mb-3">Лог активности</h4>
      <div class="max-h-32 overflow-y-auto space-y-1">
        <div v-for="(log, index) in activityLog.slice(-10)" :key="index" class="text-xs text-gray-600 flex items-center">
          <span class="text-gray-400 mr-2">{{ formatTime(log.timestamp) }}</span>
          <span>{{ log.message }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import ProgressBar from 'primevue/progressbar';
import Badge from 'primevue/badge';

interface StageInfo {
  name: string;
  status: 'pending' | 'active' | 'completed' | 'error';
  progress: number;
}

interface PortfolioStats {
  processedPairs: number;
  totalPairs: number;
  totalTrades: number;
  dataLoaded: string;
}

interface GPUStats {
  enabled: boolean;
  status: string;
  utilization: number;
  memoryUsage: string;
  speedup: number;
}

interface ActivityLogEntry {
  timestamp: number;
  message: string;
}

interface Props {
  title?: string;
  isActive?: boolean;
  isCompleted?: boolean;
  currentStage?: string;
  currentStageDescription?: string;
  processedItems?: number;
  totalItems?: number;
  startTime?: number;
  stageBreakdown?: StageInfo[];
  portfolioStats?: PortfolioStats;
  gpuStats?: GPUStats;
  showActivityLog?: boolean;
  activityLog?: ActivityLogEntry[];
}

const props = withDefaults(defineProps<Props>(), {
  title: 'Выполнение бэктеста',
  isActive: false,
  isCompleted: false,
  currentStage: 'Ожидание',
  currentStageDescription: 'Подготовка к запуску',
  processedItems: 0,
  totalItems: 100,
  startTime: 0,
  showActivityLog: false,
  stageBreakdown: () => [],
  activityLog: () => []
});

// Вычисляемые свойства
const progressPercent = computed(() => {
  if (props.totalItems === 0) return 0;
  return Math.round((props.processedItems / props.totalItems) * 100);
});

const stageSeverity = computed(() => {
  if (props.isCompleted) return 'success';
  if (props.isActive) return 'info';
  return 'secondary';
});

const progressBarClass = computed(() => {
  if (props.isCompleted) return 'progress-completed';
  if (props.isActive) return 'progress-active';
  return 'progress-pending';
});

// Время и производительность
const elapsedTime = ref(0);
const estimatedTimeRemaining = ref(0);
const performanceRate = ref('0 пар/мин');
const memoryUsage = ref('0 MB');

let performanceInterval: number | null = null;

// Обновление метрик производительности
const updatePerformanceMetrics = () => {
  if (props.startTime > 0) {
    const now = Date.now();
    elapsedTime.value = now - props.startTime;
    
    if (props.processedItems > 0 && elapsedTime.value > 0) {
      const itemsPerSecond = props.processedItems / (elapsedTime.value / 1000);
      const itemsPerMinute = Math.round(itemsPerSecond * 60);
      performanceRate.value = `${itemsPerMinute} пар/мин`;
      
      if (itemsPerSecond > 0) {
        const remainingItems = props.totalItems - props.processedItems;
        estimatedTimeRemaining.value = (remainingItems / itemsPerSecond) * 1000;
      }
    }
  }
};

// Форматирование времени
const formatDuration = (ms: number): string => {
  if (ms < 1000) return '< 1с';
  
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}ч ${minutes % 60}м`;
  } else if (minutes > 0) {
    return `${minutes}м ${seconds % 60}с`;
  } else {
    return `${seconds}с`;
  }
};

const formatTime = (timestamp: number): string => {
  return new Date(timestamp).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
};

// Иконки для этапов
const getStageIcon = (status: string): string => {
  switch (status) {
    case 'completed': return 'pi pi-check-circle text-green-500';
    case 'active': return 'pi pi-spin pi-cog text-blue-500';
    case 'error': return 'pi pi-times-circle text-red-500';
    default: return 'pi pi-clock text-gray-400';
  }
};

const getStageProgressClass = (status: string): string => {
  switch (status) {
    case 'completed': return 'bg-green-500';
    case 'active': return 'bg-blue-500';
    case 'error': return 'bg-red-500';
    default: return 'bg-gray-300';
  }
};

// Мониторинг памяти (примерная реализация)
const updateMemoryUsage = () => {
  // В реальном приложении это будет приходить от бэкенда
  if (performance && (performance as any).memory) {
    const memory = (performance as any).memory;
    const usedMB = Math.round(memory.usedJSHeapSize / 1024 / 1024);
    memoryUsage.value = `${usedMB} MB`;
  }
};

// Lifecycle
onMounted(() => {
  performanceInterval = window.setInterval(() => {
    updatePerformanceMetrics();
    updateMemoryUsage();
  }, 1000);
});

onUnmounted(() => {
  if (performanceInterval) {
    clearInterval(performanceInterval);
  }
});

// Watchers
watch(() => props.processedItems, () => {
  updatePerformanceMetrics();
});
</script>

<style scoped>
.advanced-progress-container {
  font-family: 'Inter', sans-serif;
}

:deep(.progress-active .p-progressbar-value) {
  background: linear-gradient(90deg, #3b82f6, #1d4ed8);
  animation: progress-shimmer 2s infinite;
}

:deep(.progress-completed .p-progressbar-value) {
  background: linear-gradient(90deg, #10b981, #059669);
}

:deep(.progress-pending .p-progressbar-value) {
  background: #d1d5db;
}

@keyframes progress-shimmer {
  0% { background-position: -200px 0; }
  100% { background-position: 200px 0; }
}

.pi-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style> 