<template>
  <div class="diagnostics-panel">
    <!-- Заголовок панели -->
    <div class="panel-header">
      <div class="header-content">
        <div class="title-section">
          <i class="pi pi-shield text-xl mr-2" :class="statusIconClass"></i>
          <h3 class="text-xl font-semibold">Диагностическая панель</h3>
          <Badge 
            :value="unresolvedCount" 
            :severity="badgeSeverity" 
            class="ml-2"
            v-if="unresolvedCount > 0"
          />
        </div>
        
        <div class="header-actions">
          <Button 
            label="Обновить" 
            icon="pi pi-refresh" 
            size="small" 
            @click="refreshAll"
            :loading="isRefreshing"
            outlined
          />
          <Button 
            :label="showDetailed ? 'Скрыть детали' : 'Показать детали'" 
            :icon="showDetailed ? 'pi pi-eye-slash' : 'pi pi-eye'"
            size="small" 
            @click="toggleDetailView"
            text
          />
        </div>
      </div>
    </div>

    <!-- Сводка состояния -->
    <div class="status-overview" v-if="errorSummary || systemHealth">
      <div class="status-cards">
        <!-- Системный статус -->
        <div class="status-card" :class="systemStatusClass">
          <div class="status-icon">
            <i class="pi" :class="systemIconClass"></i>
          </div>
          <div class="status-info">
            <div class="status-title">Система</div>
            <div class="status-value">{{ systemStatusText }}</div>
          </div>
        </div>

        <!-- Критические ошибки -->
        <div class="status-card error-card" v-if="(errorSummary?.critical ?? 0) > 0">
          <div class="status-icon">
            <i class="pi pi-exclamation-triangle"></i>
          </div>
          <div class="status-info">
            <div class="status-title">Критические</div>
            <div class="status-value">{{ errorSummary?.critical ?? 0 }}</div>
          </div>
        </div>

        <!-- Нерешенные ошибки -->
        <div class="status-card warning-card" v-if="(errorSummary?.unresolved ?? 0) > 0">
          <div class="status-icon">
            <i class="pi pi-exclamation-circle"></i>
          </div>
          <div class="status-info">
            <div class="status-title">Нерешенные</div>
            <div class="status-value">{{ errorSummary?.unresolved ?? 0 }}</div>
          </div>
        </div>

        <!-- Общее количество ошибок -->
        <div class="status-card info-card">
          <div class="status-icon">
            <i class="pi pi-info-circle"></i>
          </div>
          <div class="status-info">
            <div class="status-title">Всего ошибок</div>
            <div class="status-value">{{ errorSummary?.total || 0 }}</div>
          </div>
        </div>

        <!-- GPU статус -->
        <div class="status-card" :class="gpuStatusClass" v-if="systemHealth?.metrics.gpu">
          <div class="status-icon">
            <i class="pi pi-microchip-ai"></i>
          </div>
          <div class="status-info">
            <div class="status-title">GPU</div>
            <div class="status-value">{{ gpuStatusText }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Детальная информация -->
    <div class="detailed-view" v-if="showDetailed">
      
      <!-- Системная информация -->
      <Accordion :multiple="true" :activeIndex="[0]" class="mb-4">
        <AccordionPanel value="0">
          <AccordionHeader>
            <i class="pi pi-server mr-2"></i>
            Системные ресурсы
          </AccordionHeader>
          <AccordionContent>
            <SystemResourcesCard 
              :metrics="systemHealth?.metrics"
              :recommendations="systemHealth?.recommendations"
              v-if="systemHealth"
            />
          </AccordionContent>
        </AccordionPanel>
      </Accordion>

      <!-- Критические ошибки -->
      <div v-if="criticalErrors.length > 0" class="mb-4">
        <div class="section-header">
          <h4 class="text-lg font-semibold text-red-600 flex items-center">
            <i class="pi pi-exclamation-triangle mr-2"></i>
            Критические ошибки ({{ criticalErrors.length }})
          </h4>
        </div>
        <div class="errors-list">
          <ErrorCard 
            v-for="error in criticalErrors" 
            :key="error.id"
            :error="error"
            :show-details="true"
            @resolve="resolveError"
            @fix="fixError"
            class="mb-2"
          />
        </div>
      </div>

      <!-- Остальные ошибки -->
      <div v-if="nonCriticalErrors.length > 0" class="mb-4">
        <div class="section-header">
          <h4 class="text-lg font-semibold flex items-center">
            <i class="pi pi-exclamation-circle mr-2"></i>
            Остальные ошибки ({{ nonCriticalErrors.length }})
          </h4>
          <div class="header-controls">
            <Dropdown 
              v-model="severityFilter" 
              :options="severityOptions" 
              option-label="label" 
              option-value="value"
              placeholder="Фильтр по важности"
              class="w-48"
              show-clear
            />
          </div>
        </div>
        <div class="errors-list">
          <ErrorCard 
            v-for="error in filteredNonCriticalErrors" 
            :key="error.id"
            :error="error"
            :show-details="false"
            @resolve="resolveError"
            @fix="fixError"
            @toggle-details="toggleErrorDetails"
            class="mb-2"
          />
        </div>
      </div>

      <!-- Рекомендации -->
      <div v-if="systemHealth?.recommendations && systemHealth.recommendations.length > 0" class="mb-4">
        <div class="section-header">
          <h4 class="text-lg font-semibold flex items-center">
            <i class="pi pi-lightbulb mr-2"></i>
            Рекомендации системы ({{ systemHealth.recommendations.length }})
          </h4>
        </div>
        <div class="recommendations-list">
          <RecommendationCard 
            v-for="rec in prioritizedRecommendations"
            :key="rec.id"
            :recommendation="rec"
            class="mb-2"
          />
        </div>
      </div>

    </div>

    <!-- Быстрые действия -->
    <div class="quick-actions" v-if="hasQuickActions">
      <div class="actions-header">
        <h4 class="text-md font-medium">Быстрые действия</h4>
      </div>
      <div class="actions-buttons">
        <Button 
          label="Решить все незначительные"
          icon="pi pi-check-circle"
          size="small"
          @click="resolveAllMinor"
          v-if="minorErrorsCount > 0"
          outlined
        />
        <Button 
          label="Очистить логи"
          icon="pi pi-trash"
          size="small"
          @click="clearResolvedErrors"
          v-if="resolvedErrorsCount > 10"
          outlined
        />
        <Button 
          label="Экспорт отчета"
          icon="pi pi-download"
          size="small"
          @click="exportDiagnosticReport"
          outlined
        />
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useDiagnosticStore } from '../../stores/diagnosticStore';
import Button from 'primevue/button';
import Badge from 'primevue/badge';
import Dropdown from 'primevue/dropdown';
import Accordion from 'primevue/accordion';
import AccordionPanel from 'primevue/accordionpanel';
import AccordionHeader from 'primevue/accordionheader';
import AccordionContent from 'primevue/accordioncontent';
import ErrorCard from './ErrorCard.vue';
import SystemResourcesCard from './SystemResourcesCard.vue';
import RecommendationCard from './RecommendationCard.vue';

// Пропсы
interface Props {
  autoRefresh?: boolean;
  refreshInterval?: number; // в миллисекундах
  compactMode?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  autoRefresh: true,
  refreshInterval: 30000, // 30 секунд
  compactMode: false
});

// Store
const diagnosticStore = useDiagnosticStore();

// Локальное состояние
const showDetailed = ref(!props.compactMode);
const isRefreshing = ref(false);
const severityFilter = ref<string | null>(null);
const expandedErrors = ref<Set<string>>(new Set());

// Интервал автообновления
let refreshTimer: number | null = null;

// Опции для фильтра важности
const severityOptions = [
  { label: 'Все', value: null },
  { label: 'Высокая', value: 'high' },
  { label: 'Средняя', value: 'medium' },
  { label: 'Низкая', value: 'low' }
];

// Вычисляемые свойства
const errorSummary = computed(() => diagnosticStore.errorSummary);
const systemHealth = computed(() => diagnosticStore.systemHealth);
const errors = computed(() => diagnosticStore.filteredErrors);

const criticalErrors = computed(() => 
  errors.value.filter(error => error.severity === 'critical' && !error.resolved)
);

const nonCriticalErrors = computed(() => 
  errors.value.filter(error => error.severity !== 'critical' && !error.resolved)
);

const filteredNonCriticalErrors = computed(() => {
  if (!severityFilter.value) return nonCriticalErrors.value;
  return nonCriticalErrors.value.filter(error => error.severity === severityFilter.value);
});

const unresolvedCount = computed(() => 
  errors.value.filter(error => !error.resolved).length
);

const minorErrorsCount = computed(() => 
  errors.value.filter(error => error.severity === 'low' && !error.resolved).length
);

const resolvedErrorsCount = computed(() => 
  errors.value.filter(error => error.resolved).length
);

const hasQuickActions = computed(() => 
  minorErrorsCount.value > 0 || resolvedErrorsCount.value > 10
);

const prioritizedRecommendations = computed(() => {
  if (!systemHealth.value?.recommendations) return [];
  return [...systemHealth.value.recommendations].sort((a, b) => b.priority - a.priority);
});

// Классы состояний
const statusIconClass = computed(() => {
  switch (diagnosticStore.overallSystemStatus) {
    case 'critical': return 'text-red-500';
    case 'warning': return 'text-yellow-500';
    default: return 'text-green-500';
  }
});

const badgeSeverity = computed(() => {
  if (criticalErrors.value.length > 0) return 'danger';
  if (unresolvedCount.value > 5) return 'warning';
  return 'info';
});

const systemStatusClass = computed(() => {
  switch (systemHealth.value?.status) {
    case 'critical': return 'error-card';
    case 'warning': return 'warning-card';
    default: return 'success-card';
  }
});

const systemIconClass = computed(() => {
  switch (systemHealth.value?.status) {
    case 'critical': return 'pi-times-circle';
    case 'warning': return 'pi-exclamation-triangle';
    default: return 'pi-check-circle';
  }
});

const systemStatusText = computed(() => {
  switch (systemHealth.value?.status) {
    case 'critical': return 'Критичное';
    case 'warning': return 'Предупреждение';
    default: return 'Здоровая';
  }
});

const gpuStatusClass = computed(() => {
  const gpu = systemHealth.value?.metrics.gpu;
  if (!gpu?.available) return 'error-card';
  if (!gpu?.healthy) return 'warning-card';
  return 'success-card';
});

const gpuStatusText = computed(() => {
  const gpu = systemHealth.value?.metrics.gpu;
  if (!gpu?.available) return 'Недоступен';
  if (!gpu?.healthy) return 'Проблемы';
  return 'Работает';
});

// Методы
const refreshAll = async () => {
  isRefreshing.value = true;
  try {
    await Promise.all([
      diagnosticStore.fetchErrors(),
      diagnosticStore.fetchSystemHealth(),
      diagnosticStore.fetchSummary()
    ]);
  } catch (error) {
    console.error('Error refreshing diagnostic data:', error);
  } finally {
    isRefreshing.value = false;
  }
};

const toggleDetailView = () => {
  showDetailed.value = !showDetailed.value;
};

const toggleErrorDetails = (errorId: string) => {
  if (expandedErrors.value.has(errorId)) {
    expandedErrors.value.delete(errorId);
  } else {
    expandedErrors.value.add(errorId);
  }
};

const resolveError = async (errorId: string) => {
  try {
    await diagnosticStore.resolveError(errorId);
  } catch (error) {
    console.error('Error resolving error:', error);
  }
};

const fixError = async (errorId: string) => {
  try {
    await diagnosticStore.fixError(errorId);
  } catch (error) {
    console.error('Error fixing error:', error);
  }
};

const resolveAllMinor = async () => {
  const minorErrors = errors.value.filter(e => e.severity === 'low' && !e.resolved);
  for (const error of minorErrors) {
    try {
      await diagnosticStore.resolveError(error.id);
    } catch (error) {
      console.error('Error resolving minor error:', error);
    }
  }
};

const clearResolvedErrors = () => {
  // Логика очистки решенных ошибок
  console.log('Clear resolved errors');
};

const exportDiagnosticReport = () => {
  // Логика экспорта отчета
  console.log('Export diagnostic report');
};

// Lifecycle
onMounted(async () => {
  await refreshAll();
  
  if (props.autoRefresh) {
    refreshTimer = window.setInterval(refreshAll, props.refreshInterval);
  }
});

onUnmounted(() => {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }
});
</script>

<style scoped>
.diagnostics-panel {
  @apply bg-white rounded-lg shadow-sm border border-gray-200;
  min-height: 200px;
}

.panel-header {
  @apply border-b border-gray-200 p-4;
}

.header-content {
  @apply flex justify-between items-center;
}

.title-section {
  @apply flex items-center;
}

.header-actions {
  @apply flex space-x-2;
}

.status-overview {
  @apply p-4 border-b border-gray-100 bg-gray-50;
}

.status-cards {
  @apply grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4;
}

.status-card {
  @apply bg-white rounded-lg p-3 shadow-sm border flex items-center space-x-3 transition-colors;
}

.status-card.success-card {
  @apply border-green-200 bg-green-50;
}

.status-card.warning-card {
  @apply border-yellow-200 bg-yellow-50;
}

.status-card.error-card {
  @apply border-red-200 bg-red-50;
}

.status-card.info-card {
  @apply border-blue-200 bg-blue-50;
}

.status-icon {
  @apply w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold;
}

.success-card .status-icon {
  @apply bg-green-100 text-green-600;
}

.warning-card .status-icon {
  @apply bg-yellow-100 text-yellow-600;
}

.error-card .status-icon {
  @apply bg-red-100 text-red-600;
}

.info-card .status-icon {
  @apply bg-blue-100 text-blue-600;
}

.status-info {
  @apply flex-1 min-w-0;
}

.status-title {
  @apply text-xs font-medium text-gray-600 uppercase tracking-wide;
}

.status-value {
  @apply text-sm font-semibold text-gray-900 truncate;
}

.detailed-view {
  @apply p-4;
}

.section-header {
  @apply flex justify-between items-center mb-3;
}

.header-controls {
  @apply flex space-x-2;
}

.errors-list {
  @apply space-y-2;
}

.recommendations-list {
  @apply space-y-2;
}

.quick-actions {
  @apply border-t border-gray-200 p-4 bg-gray-50;
}

.actions-header {
  @apply mb-3;
}

.actions-buttons {
  @apply flex flex-wrap gap-2;
}
</style>
