<template>
  <Card class="error-card" :class="cardClass">
    <template #header v-if="showHeader">
      <div class="error-header">
        <div class="error-type">
          <Badge :value="errorTypeLabel" :severity="badgeSeverity" />
          <span class="error-id">#{error.id.slice(0, 8)}</span>
        </div>
        <div class="error-timestamp">
          <i class="pi pi-clock text-xs"></i>
          <span>{{ formatTimestamp(error.timestamp) }}</span>
        </div>
      </div>
    </template>

    <template #content>
      <div class="error-content">
        <!-- Основная информация -->
        <div class="error-main">
          <div class="error-icon-section">
            <div class="error-icon" :class="iconClass">
              <i class="pi" :class="iconName"></i>
            </div>
            <div class="error-severity-indicator" :class="severityIndicatorClass"></div>
          </div>

          <div class="error-details">
            <div class="error-description">{{ error.description }}</div>
            
            <div class="error-meta" v-if="showMeta">
              <div class="meta-item" v-if="error.context?.pairSymbol">
                <i class="pi pi-chart-line text-xs"></i>
                <span>{{ error.context.pairSymbol }}</span>
              </div>
              <div class="meta-item" v-if="error.context?.exchange">
                <i class="pi pi-building text-xs"></i>
                <span>{{ error.context.exchange?.toUpperCase() }}</span>
              </div>
              <div class="meta-item" v-if="error.testType">
                <i class="pi pi-cog text-xs"></i>
                <span>{{ testTypeLabel }}</span>
              </div>
              <div class="meta-item" v-if="impactPercentage">
                <i class="pi pi-exclamation-triangle text-xs"></i>
                <span>Влияние: {{ impactPercentage }}%</span>
              </div>
            </div>
          </div>

          <div class="error-actions" v-if="!error.resolved">
            <Button 
              v-if="error.autoFixable"
              icon="pi pi-wrench"
              size="small"
              :loading="isFixing"
              @click="handleFix"
              text
              rounded
              :pt="{ root: { class: 'w-8 h-8' } }"
              v-tooltip.top="'Автоисправление'"
            />
            <Button 
              icon="pi pi-check"
              size="small"
              :loading="isResolving"
              @click="handleResolve"
              text
              rounded
              :pt="{ root: { class: 'w-8 h-8' } }"
              v-tooltip.top="'Отметить как решенную'"
            />
            <Button 
              :icon="showDetails ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"
              size="small"
              @click="toggleDetails"
              text
              rounded
              :pt="{ root: { class: 'w-8 h-8' } }"
              v-tooltip.top="showDetails ? 'Скрыть детали' : 'Показать детали'"
            />
          </div>
        </div>

        <!-- Детальная информация -->
        <div class="error-expanded" v-if="showDetails">
          <Divider />
          
          <!-- Контекст -->
          <div class="detail-section" v-if="hasContext">
            <h5 class="detail-title">
              <i class="pi pi-info-circle mr-1"></i>
              Контекст
            </h5>
            <div class="context-grid">
              <div 
                v-for="(value, key) in filteredContext" 
                :key="key"
                class="context-item"
              >
                <span class="context-key">{{ formatContextKey(key) }}:</span>
                <span class="context-value">{{ formatContextValue(value) }}</span>
              </div>
            </div>
          </div>

          <!-- Предложения по исправлению -->
          <div class="detail-section" v-if="error.suggestions && error.suggestions.length > 0">
            <h5 class="detail-title">
              <i class="pi pi-lightbulb mr-1"></i>
              Предложения по исправлению
            </h5>
            <div class="suggestions-list">
              <div 
                v-for="suggestion in error.suggestions" 
                :key="suggestion.type"
                class="suggestion-item"
                :class="suggestionClass(suggestion.priority)"
              >
                <div class="suggestion-header">
                  <Badge :value="suggestion.priority" :severity="suggestionBadgeSeverity(suggestion.priority)" size="small" />
                  <span class="suggestion-description">{{ suggestion.description }}</span>
                  <span class="suggestion-time" v-if="suggestion.estimatedTime">
                    ({{ suggestion.estimatedTime }})
                  </span>
                </div>
              </div>
            </div>
          </div>

          <!-- Техническая информация -->
          <div class="detail-section" v-if="error.stackTrace && showTechnicalInfo">
            <h5 class="detail-title">
              <i class="pi pi-code mr-1"></i>
              Стек вызовов
            </h5>
            <pre class="stack-trace">{{ formatStackTrace(error.stackTrace) }}</pre>
          </div>

          <!-- Метаданные -->
          <div class="detail-section" v-if="hasMetadata">
            <h5 class="detail-title">
              <i class="pi pi-tags mr-1"></i>
              Дополнительная информация
            </h5>
            <div class="metadata-grid">
              <div 
                v-for="(value, key) in error.metadata" 
                :key="key"
                class="metadata-item"
              >
                <span class="metadata-key">{{ key }}:</span>
                <span class="metadata-value">{{ JSON.stringify(value) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Решенная ошибка -->
        <div class="resolved-info" v-if="error.resolved">
          <div class="resolved-indicator">
            <i class="pi pi-check-circle text-green-500"></i>
            <span class="resolved-text">
              Решена {{ formatTimestamp(error.resolvedAt!) }}
            </span>
          </div>
        </div>
      </div>
    </template>
  </Card>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';
import Card from 'primevue/card';
import Button from 'primevue/button';
import Badge from 'primevue/badge';
import Divider from 'primevue/divider';
import type { DiagnosticError, ErrorType } from '../../stores/diagnosticStore';

interface Props {
  error: DiagnosticError;
  showDetails?: boolean;
  showHeader?: boolean;
  showMeta?: boolean;
  showTechnicalInfo?: boolean;
  compactMode?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  showDetails: false,
  showHeader: true,
  showMeta: true,
  showTechnicalInfo: false,
  compactMode: false
});

interface Emits {
  (e: 'resolve', errorId: string): void;
  (e: 'fix', errorId: string): void;
  (e: 'toggleDetails', errorId: string): void;
}

const emit = defineEmits<Emits>();

// Локальное состояние
const showDetails = ref(props.showDetails);
const isResolving = ref(false);
const isFixing = ref(false);

// Вычисляемые свойства
const cardClass = computed(() => ({
  'error-card-critical': props.error.severity === 'critical',
  'error-card-high': props.error.severity === 'high',
  'error-card-medium': props.error.severity === 'medium',
  'error-card-low': props.error.severity === 'low',
  'error-card-resolved': props.error.resolved,
  'error-card-compact': props.compactMode
}));

const badgeSeverity = computed(() => {
  switch (props.error.severity) {
    case 'critical': return 'danger';
    case 'high': return 'warning';
    case 'medium': return 'info';
    case 'low': return 'secondary';
    default: return 'info';
  }
});

const errorTypeLabel = computed(() => {
  return getErrorTypeLabel(props.error.type);
});

const testTypeLabel = computed(() => {
  switch (props.error.testType) {
    case 'single': return 'Одиночный тест';
    case 'portfolio': return 'Портфель';
    case 'gpu': return 'GPU тест';
    case 'system': return 'Система';
    default: return props.error.testType;
  }
});

const iconClass = computed(() => ({
  'error-icon-critical': props.error.severity === 'critical',
  'error-icon-high': props.error.severity === 'high',
  'error-icon-medium': props.error.severity === 'medium',
  'error-icon-low': props.error.severity === 'low'
}));

const iconName = computed(() => {
  switch (props.error.type) {
    case 'DATA_MISSING': return 'pi-exclamation-triangle';
    case 'DATA_INCOMPLETE': return 'pi-info-circle';
    case 'MEMORY_OVERFLOW': return 'pi-server';
    case 'GPU_SERVICE_DOWN': return 'pi-microchip-ai';
    case 'VALIDATION_FAILED': return 'pi-times-circle';
    case 'CALCULATION_ERROR': return 'pi-calculator';
    case 'NETWORK_ERROR': return 'pi-wifi';
    case 'API_RATE_LIMIT': return 'pi-clock';
    default: return 'pi-exclamation-circle';
  }
});

const severityIndicatorClass = computed(() => ({
  'severity-critical': props.error.severity === 'critical',
  'severity-high': props.error.severity === 'high',  
  'severity-medium': props.error.severity === 'medium',
  'severity-low': props.error.severity === 'low'
}));

const impactPercentage = computed(() => {
  return Math.round(props.error.impact * 100);
});

const hasContext = computed(() => {
  return props.error.context && Object.keys(props.error.context).length > 0;
});

const hasMetadata = computed(() => {
  return props.error.metadata && Object.keys(props.error.metadata).length > 0;
});

const filteredContext = computed(() => {
  if (!props.error.context) return {};
  
  // Исключаем внутренние поля
  const filtered: Record<string, any> = {};
  for (const [key, value] of Object.entries(props.error.context)) {
    if (!key.startsWith('_') && value !== undefined && value !== null) {
      filtered[key] = value;
    }
  }
  return filtered;
});

// Методы
const handleResolve = async () => {
  isResolving.value = true;
  try {
    emit('resolve', props.error.id);
  } finally {
    isResolving.value = false;
  }
};

const handleFix = async () => {
  isFixing.value = true;
  try {
    emit('fix', props.error.id);
  } finally {
    isFixing.value = false;
  }
};

const toggleDetails = () => {
  showDetails.value = !showDetails.value;
  emit('toggleDetails', props.error.id);
};

const formatTimestamp = (timestamp: string) => {
  const date = new Date(timestamp);
  const distance = formatDistanceToNow(date, { locale: ru });
  return `${distance} назад`;
};

const formatContextKey = (key: string) => {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
};

const formatContextValue = (value: any) => {
  if (typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
};

const formatStackTrace = (stackTrace: string) => {
  return stackTrace.split('\n').slice(0, 5).join('\n');
};

const suggestionClass = (priority: string) => ({
  'suggestion-high': priority === 'high',
  'suggestion-medium': priority === 'medium',
  'suggestion-low': priority === 'low'
});

const suggestionBadgeSeverity = (priority: string) => {
  switch (priority) {
    case 'high': return 'danger';
    case 'medium': return 'warning';
    case 'low': return 'info';
    default: return 'secondary';
  }
};

function getErrorTypeLabel(type: ErrorType): string {
  switch (type) {
    case 'DATA_MISSING': return 'Данные отсутствуют';
    case 'DATA_INCOMPLETE': return 'Неполные данные';
    case 'MEMORY_OVERFLOW': return 'Переполнение памяти';
    case 'GPU_SERVICE_DOWN': return 'GPU недоступен';
    case 'GPU_PERFORMANCE_ISSUE': return 'Проблемы GPU';
    case 'VALIDATION_FAILED': return 'Ошибка валидации';
    case 'CALCULATION_ERROR': return 'Ошибка расчетов';
    case 'STATE_CORRUPTION': return 'Повреждение состояния';
    case 'API_RATE_LIMIT': return 'Лимит API';
    case 'NETWORK_ERROR': return 'Сетевая ошибка';
    case 'PORTFOLIO_INCOMPLETE': return 'Неполный портфель';
    case 'CONFIGURATION_ERROR': return 'Ошибка конфигурации';
    default: return type;
  }
}
</script>

<style scoped>
.error-card {
  @apply transition-all duration-200 hover:shadow-md;
}

.error-card-critical {
  @apply border-l-4 border-red-500 bg-red-50;
}

.error-card-high {
  @apply border-l-4 border-orange-500 bg-orange-50;
}

.error-card-medium {
  @apply border-l-4 border-yellow-500 bg-yellow-50;
}

.error-card-low {
  @apply border-l-4 border-blue-500 bg-blue-50;
}

.error-card-resolved {
  @apply opacity-60 border-l-4 border-green-500 bg-green-50;
}

.error-card-compact {
  @apply text-sm;
}

.error-header {
  @apply flex justify-between items-center p-3 pb-0;
}

.error-type {
  @apply flex items-center space-x-2;
}

.error-id {
  @apply text-xs text-gray-500 font-mono;
}

.error-timestamp {
  @apply flex items-center space-x-1 text-xs text-gray-500;
}

.error-content {
  @apply p-0;
}

.error-main {
  @apply flex items-start space-x-3;
}

.error-icon-section {
  @apply relative flex-shrink-0;
}

.error-icon {
  @apply w-10 h-10 rounded-full flex items-center justify-center text-lg;
}

.error-icon-critical {
  @apply bg-red-100 text-red-600;
}

.error-icon-high {
  @apply bg-orange-100 text-orange-600;
}

.error-icon-medium {
  @apply bg-yellow-100 text-yellow-600;
}

.error-icon-low {
  @apply bg-blue-100 text-blue-600;
}

.error-severity-indicator {
  @apply absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-white;
}

.severity-critical {
  @apply bg-red-500;
}

.severity-high {
  @apply bg-orange-500;
}

.severity-medium {
  @apply bg-yellow-500;
}

.severity-low {
  @apply bg-blue-500;
}

.error-details {
  @apply flex-1 min-w-0;
}

.error-description {
  @apply text-sm text-gray-900 font-medium mb-2 leading-relaxed;
}

.error-meta {
  @apply flex flex-wrap gap-3 text-xs text-gray-600;
}

.meta-item {
  @apply flex items-center space-x-1;
}

.error-actions {
  @apply flex space-x-1 flex-shrink-0;
}

.error-expanded {
  @apply mt-4;
}

.detail-section {
  @apply mb-4;
}

.detail-title {
  @apply flex items-center text-sm font-semibold text-gray-700 mb-2;
}

.context-grid {
  @apply grid grid-cols-1 md:grid-cols-2 gap-2;
}

.context-item {
  @apply text-xs bg-gray-100 rounded p-2;
}

.context-key {
  @apply font-medium text-gray-700;
}

.context-value {
  @apply text-gray-600 ml-1;
}

.suggestions-list {
  @apply space-y-2;
}

.suggestion-item {
  @apply p-2 rounded border-l-4;
}

.suggestion-high {
  @apply border-red-400 bg-red-50;
}

.suggestion-medium {
  @apply border-yellow-400 bg-yellow-50;
}

.suggestion-low {
  @apply border-blue-400 bg-blue-50;
}

.suggestion-header {
  @apply flex items-center space-x-2 text-xs;
}

.suggestion-description {
  @apply flex-1 text-gray-800;
}

.suggestion-time {
  @apply text-gray-500;
}

.stack-trace {
  @apply text-xs bg-gray-800 text-gray-100 p-3 rounded font-mono overflow-x-auto;
}

.metadata-grid {
  @apply grid grid-cols-1 gap-1;
}

.metadata-item {
  @apply text-xs bg-gray-100 rounded p-2 font-mono;
}

.metadata-key {
  @apply font-medium text-gray-700;
}

.metadata-value {
  @apply text-gray-600 ml-1;
}

.resolved-info {
  @apply mt-3 pt-3 border-t border-gray-200;
}

.resolved-indicator {
  @apply flex items-center space-x-2;
}

.resolved-text {
  @apply text-sm text-gray-600;
}
</style>
