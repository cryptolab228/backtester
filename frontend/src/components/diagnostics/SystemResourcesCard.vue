<template>
  <div class="system-resources-card">
    <!-- Основные метрики -->
    <div class="metrics-grid">
      <!-- CPU -->
      <div class="metric-card cpu-card">
        <div class="metric-header">
          <div class="metric-icon">
            <i class="pi pi-microchip"></i>
          </div>
          <div class="metric-info">
            <div class="metric-title">CPU</div>
            <div class="metric-subtitle">{{ metrics?.cpu.cores || 0 }} ядер</div>
          </div>
          <div class="metric-value">
            <span class="value-number">{{ Math.round(metrics?.cpu.usage || 0) }}%</span>
          </div>
        </div>
        
        <div class="metric-progress">
          <ProgressBar 
            :value="metrics?.cpu.usage || 0" 
            :show-value="false"
            :pt="{ 
              root: { class: 'h-2' },
              value: { class: getProgressClass(metrics?.cpu.usage || 0) }
            }"
          />
        </div>
        
        <div class="metric-details" v-if="metrics?.cpu.load">
          <div class="load-averages">
            <span class="load-item">1m: {{ metrics.cpu.load[0]?.toFixed(2) || 0 }}</span>
            <span class="load-item">5m: {{ metrics.cpu.load[1]?.toFixed(2) || 0 }}</span>
            <span class="load-item">15m: {{ metrics.cpu.load[2]?.toFixed(2) || 0 }}</span>
          </div>
        </div>
      </div>

      <!-- Memory -->
      <div class="metric-card memory-card">
        <div class="metric-header">
          <div class="metric-icon">
            <i class="pi pi-server"></i>
          </div>
          <div class="metric-info">
            <div class="metric-title">Память</div>
            <div class="metric-subtitle">{{ formatBytes(metrics?.memory.used || 0) }} / {{ formatBytes(metrics?.memory.total || 0) }}</div>
          </div>
          <div class="metric-value">
            <span class="value-number">{{ metrics?.memory.percentage || 0 }}%</span>
          </div>
        </div>
        
        <div class="metric-progress">
          <ProgressBar 
            :value="metrics?.memory.percentage || 0" 
            :show-value="false"
            :pt="{ 
              root: { class: 'h-2' },
              value: { class: getProgressClass(metrics?.memory.percentage || 0) }
            }"
          />
        </div>
        
        <div class="metric-warning" v-if="(metrics?.memory.percentage || 0) > 80">
          <i class="pi pi-exclamation-triangle text-orange-500 text-xs"></i>
          <span class="warning-text">Высокое использование памяти</span>
        </div>
      </div>

      <!-- Disk -->
      <div class="metric-card disk-card" v-if="metrics?.disk && metrics.disk.total > 0">
        <div class="metric-header">
          <div class="metric-icon">
            <i class="pi pi-database"></i>
          </div>
          <div class="metric-info">
            <div class="metric-title">Диск</div>
            <div class="metric-subtitle">{{ formatBytes(metrics.disk.used) }} / {{ formatBytes(metrics.disk.total) }}</div>
          </div>
          <div class="metric-value">
            <span class="value-number">{{ metrics.disk.percentage }}%</span>
          </div>
        </div>
        
        <div class="metric-progress">
          <ProgressBar 
            :value="metrics.disk.percentage" 
            :show-value="false"
            :pt="{ 
              root: { class: 'h-2' },
              value: { class: getProgressClass(metrics.disk.percentage) }
            }"
          />
        </div>
      </div>

      <!-- GPU -->
      <div class="metric-card gpu-card" v-if="metrics?.gpu">
        <div class="metric-header">
          <div class="metric-icon" :class="gpuIconClass">
            <i class="pi pi-microchip-ai"></i>
          </div>
          <div class="metric-info">
            <div class="metric-title">GPU</div>
            <div class="metric-subtitle" v-if="metrics.gpu.available">
              {{ formatBytes(metrics.gpu.memoryUsed) }} / {{ formatBytes(metrics.gpu.memoryTotal) }}
            </div>
            <div class="metric-subtitle" v-else>
              Недоступен
            </div>
          </div>
          <div class="metric-value" v-if="metrics.gpu.available">
            <span class="value-number">{{ metrics.gpu.utilization }}%</span>
          </div>
          <div class="metric-status" v-else>
            <Badge value="OFFLINE" severity="danger" size="small" />
          </div>
        </div>
        
        <div class="metric-progress" v-if="metrics.gpu.available">
          <ProgressBar 
            :value="metrics.gpu.utilization" 
            :show-value="false"
            :pt="{ 
              root: { class: 'h-2' },
              value: { class: getProgressClass(metrics.gpu.utilization) }
            }"
          />
        </div>
        
        <div class="metric-warning" v-if="!metrics.gpu.healthy">
          <i class="pi pi-exclamation-triangle text-orange-500 text-xs"></i>
          <span class="warning-text">Проблемы с GPU сервисом</span>
        </div>
      </div>
    </div>

    <!-- Рекомендации -->
    <div class="recommendations-section" v-if="recommendations && recommendations.length > 0">
      <div class="section-header">
        <h4 class="section-title">
          <i class="pi pi-lightbulb mr-2"></i>
          Рекомендации по ресурсам
        </h4>
      </div>
      
      <div class="recommendations-list">
        <div 
          v-for="rec in prioritizedRecommendations" 
          :key="rec.id"
          class="recommendation-item"
          :class="recommendationClass(rec.type)"
        >
          <div class="recommendation-icon">
            <i class="pi" :class="recommendationIcon(rec.type)"></i>
          </div>
          <div class="recommendation-content">
            <div class="recommendation-title">{{ rec.title }}</div>
            <div class="recommendation-description">{{ rec.description }}</div>
          </div>
          <div class="recommendation-priority">
            <Badge 
              :value="rec.priority" 
              :severity="prioritySeverity(rec.priority)"
              size="small"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Детальная статистика -->
    <div class="detailed-stats" v-if="showDetailedStats">
      <Divider />
      
      <div class="stats-header">
        <h4 class="stats-title">Детальная статистика</h4>
        <Button 
          :label="expandStats ? 'Скрыть' : 'Показать'"
          :icon="expandStats ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"
          @click="expandStats = !expandStats"
          text
          size="small"
        />
      </div>
      
      <div class="stats-content" v-if="expandStats">
        <div class="stats-grid">
          <!-- Процессы -->
          <div class="stat-section">
            <h5 class="stat-title">Процессы</h5>
            <div class="stat-items">
              <div class="stat-item">
                <span class="stat-label">Node.js PID:</span>
                <span class="stat-value">{{ process?.pid || 'N/A' }}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">Uptime:</span>
                <span class="stat-value">{{ formatUptime(process?.uptime || 0) }}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">Версия Node:</span>
                <span class="stat-value">{{ process?.version || 'N/A' }}</span>
              </div>
            </div>
          </div>
          
          <!-- Память -->
          <div class="stat-section" v-if="memoryDetails">
            <h5 class="stat-title">Память детально</h5>
            <div class="stat-items">
              <div class="stat-item" v-for="(value, key) in memoryDetails" :key="key">
                <span class="stat-label">{{ key }}:</span>
                <span class="stat-value">{{ formatBytes(value) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import ProgressBar from 'primevue/progressbar';
import Button from 'primevue/button';
import Badge from 'primevue/badge';
import Divider from 'primevue/divider';
import type { DiagnosticRecommendation } from '../../stores/diagnosticStore';

interface SystemMetrics {
  cpu: {
    usage: number;
    cores: number;
    load: number[];
  };
  memory: {
    used: number;
    total: number;
    percentage: number;
  };
  disk: {
    used: number;
    total: number;
    percentage: number;
  };
  gpu?: {
    available: boolean;
    healthy: boolean;
    memoryUsed: number;
    memoryTotal: number;
    utilization: number;
  };
}

interface Props {
  metrics?: SystemMetrics;
  recommendations?: DiagnosticRecommendation[];
  showDetailedStats?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  showDetailedStats: true
});

// Локальное состояние
const expandStats = ref(false);

// Заглушки для процесса (в реальности будут приходить с сервера)
const process = ref({
  pid: 12345,
  uptime: 3600,
  version: 'v18.17.0'
});

const memoryDetails = ref({
  heapUsed: 45 * 1024 * 1024,
  heapTotal: 67 * 1024 * 1024,
  external: 2 * 1024 * 1024,
  arrayBuffers: 1024 * 1024
});

// Вычисляемые свойства
const prioritizedRecommendations = computed(() => {
  if (!props.recommendations) return [];
  return [...props.recommendations].sort((a, b) => b.priority - a.priority);
});

const gpuIconClass = computed(() => ({
  'gpu-available': props.metrics?.gpu?.available && props.metrics?.gpu?.healthy,
  'gpu-warning': props.metrics?.gpu?.available && !props.metrics?.gpu?.healthy,
  'gpu-offline': !props.metrics?.gpu?.available
}));

// Методы
const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
};

const formatUptime = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours}ч ${minutes}м`;
  } else if (minutes > 0) {
    return `${minutes}м ${secs}с`;
  } else {
    return `${secs}с`;
  }
};

const getProgressClass = (value: number): string => {
  if (value >= 90) return 'bg-red-500';
  if (value >= 80) return 'bg-orange-500';
  if (value >= 70) return 'bg-yellow-500';
  return 'bg-green-500';
};

const recommendationClass = (type: string) => ({
  'recommendation-error': type === 'error',
  'recommendation-warning': type === 'warning',
  'recommendation-info': type === 'info'
});

const recommendationIcon = (type: string): string => {
  switch (type) {
    case 'error': return 'pi-times-circle';
    case 'warning': return 'pi-exclamation-triangle';
    case 'info': return 'pi-info-circle';
    default: return 'pi-lightbulb';
  }
};

const prioritySeverity = (priority: number) => {
  if (priority >= 9) return 'danger';
  if (priority >= 7) return 'warning';
  if (priority >= 5) return 'info';
  return 'secondary';
};
</script>

<style scoped>
.system-resources-card {
  @apply space-y-6;
}

.metrics-grid {
  @apply grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4;
}

.metric-card {
  @apply bg-white rounded-lg p-4 border border-gray-200 shadow-sm hover:shadow-md transition-shadow;
}

.metric-header {
  @apply flex items-center justify-between mb-3;
}

.metric-icon {
  @apply w-10 h-10 rounded-lg flex items-center justify-center text-lg;
}

.cpu-card .metric-icon {
  @apply bg-blue-100 text-blue-600;
}

.memory-card .metric-icon {
  @apply bg-purple-100 text-purple-600;
}

.disk-card .metric-icon {
  @apply bg-green-100 text-green-600;
}

.gpu-card .metric-icon {
  @apply bg-orange-100 text-orange-600;
}

.gpu-available {
  @apply bg-green-100 text-green-600;
}

.gpu-warning {
  @apply bg-yellow-100 text-yellow-600;
}

.gpu-offline {
  @apply bg-red-100 text-red-600;
}

.metric-info {
  @apply flex-1 mx-3 min-w-0;
}

.metric-title {
  @apply font-semibold text-gray-900;
}

.metric-subtitle {
  @apply text-xs text-gray-600 truncate;
}

.metric-value {
  @apply text-right;
}

.value-number {
  @apply text-lg font-bold text-gray-900;
}

.metric-status {
  @apply flex justify-center;
}

.metric-progress {
  @apply mb-2;
}

.metric-details {
  @apply text-xs text-gray-600;
}

.load-averages {
  @apply flex justify-between;
}

.load-item {
  @apply font-mono;
}

.metric-warning {
  @apply flex items-center space-x-1 text-xs text-orange-600 mt-2;
}

.warning-text {
  @apply font-medium;
}

.recommendations-section {
  @apply bg-gray-50 rounded-lg p-4;
}

.section-header {
  @apply mb-4;
}

.section-title {
  @apply text-lg font-semibold text-gray-900 flex items-center;
}

.recommendations-list {
  @apply space-y-3;
}

.recommendation-item {
  @apply flex items-start space-x-3 p-3 rounded-lg border-l-4;
}

.recommendation-error {
  @apply border-red-400 bg-red-50;
}

.recommendation-warning {
  @apply border-yellow-400 bg-yellow-50;
}

.recommendation-info {
  @apply border-blue-400 bg-blue-50;
}

.recommendation-icon {
  @apply w-6 h-6 rounded-full flex items-center justify-center text-sm flex-shrink-0;
}

.recommendation-error .recommendation-icon {
  @apply bg-red-100 text-red-600;
}

.recommendation-warning .recommendation-icon {
  @apply bg-yellow-100 text-yellow-600;
}

.recommendation-info .recommendation-icon {
  @apply bg-blue-100 text-blue-600;
}

.recommendation-content {
  @apply flex-1 min-w-0;
}

.recommendation-title {
  @apply font-semibold text-gray-900 text-sm mb-1;
}

.recommendation-description {
  @apply text-sm text-gray-700;
}

.recommendation-priority {
  @apply flex-shrink-0;
}

.detailed-stats {
  @apply mt-6;
}

.stats-header {
  @apply flex justify-between items-center mb-4;
}

.stats-title {
  @apply text-lg font-semibold text-gray-900;
}

.stats-content {
  @apply mt-4;
}

.stats-grid {
  @apply grid grid-cols-1 md:grid-cols-2 gap-6;
}

.stat-section {
  @apply bg-gray-50 rounded-lg p-4;
}

.stat-title {
  @apply font-semibold text-gray-900 mb-3;
}

.stat-items {
  @apply space-y-2;
}

.stat-item {
  @apply flex justify-between items-center text-sm;
}

.stat-label {
  @apply text-gray-600;
}

.stat-value {
  @apply font-mono text-gray-900;
}
</style>

