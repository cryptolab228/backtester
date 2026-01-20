<template>
  <Card class="recommendation-card" :class="cardClass">
    <template #content>
      <div class="recommendation-content">
        <!-- Заголовок -->
        <div class="recommendation-header">
          <div class="header-left">
            <div class="recommendation-icon" :class="iconClass">
              <i class="pi" :class="iconName"></i>
            </div>
            <div class="recommendation-info">
              <div class="recommendation-title">{{ recommendation.title }}</div>
              <div class="recommendation-priority">
                <Badge 
                  :value="`Приоритет ${recommendation.priority}`" 
                  :severity="prioritySeverity"
                  size="small"
                />
              </div>
            </div>
          </div>
          
          <div class="header-actions" v-if="!hideActions">
            <Button 
              :icon="showDetails ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"
              size="small"
              text
              rounded
              @click="toggleDetails"
              v-tooltip.left="showDetails ? 'Скрыть детали' : 'Показать детали'"
            />
            <Button 
              icon="pi pi-times"
              size="small"
              text
              rounded
              @click="dismissRecommendation"
              v-tooltip.left="'Скрыть рекомендацию'"
            />
          </div>
        </div>

        <!-- Описание -->
        <div class="recommendation-description">
          {{ recommendation.description }}
        </div>

        <!-- Действия -->
        <div class="recommendation-actions" v-if="hasActions && showDetails">
          <div class="actions-header">
            <h5 class="actions-title">
              <i class="pi pi-cog mr-1"></i>
              Возможные действия
            </h5>
          </div>
          
          <div class="actions-list">
            <div 
              v-for="action in recommendation.actions" 
              :key="action.id"
              class="action-item"
              :class="{ 'action-loading': executingAction === action.id }"
            >
              <div class="action-info">
                <div class="action-label">{{ action.label }}</div>
                <div class="action-details" v-if="showActionDetails">
                  <span class="action-type">{{ action.action }}</span>
                  <span class="action-params" v-if="hasActionParams(action)">
                    {{ formatActionParams(action.params) }}
                  </span>
                </div>
              </div>
              
              <div class="action-controls">
                <Button 
                  :label="getActionButtonLabel(action)"
                  :icon="getActionButtonIcon(action)"
                  size="small"
                  :loading="executingAction === action.id"
                  :disabled="!canExecuteAction(action)"
                  @click="executeAction(action)"
                  :severity="getActionButtonSeverity(action)"
                  outlined
                />
              </div>
            </div>
          </div>
        </div>

        <!-- Прогресс выполнения -->
        <div class="execution-progress" v-if="showProgress">
          <div class="progress-header">
            <span class="progress-label">{{ progressMessage }}</span>
            <span class="progress-percentage">{{ progressPercentage }}%</span>
          </div>
          <ProgressBar 
            :value="progressPercentage" 
            :show-value="false"
            :pt="{ root: { class: 'h-2 mt-2' } }"
          />
        </div>

        <!-- Результат выполнения -->
        <div class="execution-result" v-if="executionResult">
          <Message 
            :severity="executionResult.success ? 'success' : 'error'"
            :closable="false"
            class="text-sm"
          >
            <div class="result-content">
              <div class="result-message">{{ executionResult.message }}</div>
              <div class="result-details" v-if="executionResult.details">
                <pre class="result-details-text">{{ executionResult.details }}</pre>
              </div>
            </div>
          </Message>
        </div>

        <!-- Дополнительная информация -->
        <div class="additional-info" v-if="showDetails && hasAdditionalInfo">
          <Divider />
          
          <div class="info-section">
            <h6 class="info-title">Дополнительная информация</h6>
            <div class="info-grid">
              <div class="info-item" v-if="recommendation.id">
                <span class="info-label">ID рекомендации:</span>
                <span class="info-value font-mono">{{ recommendation.id }}</span>
              </div>
              <div class="info-item" v-if="estimatedTime">
                <span class="info-label">Ожидаемое время:</span>
                <span class="info-value">{{ estimatedTime }}</span>
              </div>
              <div class="info-item" v-if="difficulty">
                <span class="info-label">Сложность:</span>
                <Badge :value="difficulty" :severity="difficultySeverity" size="small" />
              </div>
              <div class="info-item" v-if="category">
                <span class="info-label">Категория:</span>
                <span class="info-value">{{ category }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </Card>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import Card from 'primevue/card';
import Button from 'primevue/button';
import Badge from 'primevue/badge';
import Message from 'primevue/message';
import ProgressBar from 'primevue/progressbar';
import Divider from 'primevue/divider';
import type { DiagnosticRecommendation } from '../../stores/diagnosticStore';

interface Props {
  recommendation: DiagnosticRecommendation;
  showDetails?: boolean;
  hideActions?: boolean;
  showActionDetails?: boolean;
  autoExecute?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  showDetails: false,
  hideActions: false,
  showActionDetails: false,
  autoExecute: false
});

interface Emits {
  (e: 'execute', action: any): void;
  (e: 'dismiss'): void;
  (e: 'toggle-details'): void;
}

const emit = defineEmits<Emits>();

// Локальное состояние
const showDetails = ref(props.showDetails);
const executingAction = ref<string | null>(null);
const showProgress = ref(false);
const progressPercentage = ref(0);
const progressMessage = ref('');
const executionResult = ref<{
  success: boolean;
  message: string;
  details?: string;
} | null>(null);

// Вычисляемые свойства
const cardClass = computed(() => ({
  'recommendation-error': props.recommendation.type === 'error',
  'recommendation-warning': props.recommendation.type === 'warning',
  'recommendation-info': props.recommendation.type === 'info'
}));

const iconClass = computed(() => ({
  'icon-error': props.recommendation.type === 'error',
  'icon-warning': props.recommendation.type === 'warning',
  'icon-info': props.recommendation.type === 'info'
}));

const iconName = computed(() => {
  switch (props.recommendation.type) {
    case 'error': return 'pi-times-circle';
    case 'warning': return 'pi-exclamation-triangle';
    case 'info': return 'pi-info-circle';
    default: return 'pi-lightbulb';
  }
});

const prioritySeverity = computed(() => {
  if (props.recommendation.priority >= 9) return 'danger';
  if (props.recommendation.priority >= 7) return 'warning';
  if (props.recommendation.priority >= 5) return 'info';
  return 'secondary';
});

const hasActions = computed(() => {
  return props.recommendation.actions && props.recommendation.actions.length > 0;
});

const hasAdditionalInfo = computed(() => {
  return props.recommendation.id || estimatedTime.value || difficulty.value || category.value;
});

// Дополнительные свойства для демонстрации
const estimatedTime = computed(() => {
  if (props.recommendation.priority >= 9) return '2-5 минут';
  if (props.recommendation.priority >= 7) return '30-60 секунд';
  return 'менее 30 секунд';
});

const difficulty = computed(() => {
  if (props.recommendation.priority >= 9) return 'Высокая';
  if (props.recommendation.priority >= 7) return 'Средняя';
  return 'Низкая';
});

const difficultySeverity = computed(() => {
  switch (difficulty.value) {
    case 'Высокая': return 'danger';
    case 'Средняя': return 'warning';
    case 'Низкая': return 'success';
    default: return 'info';
  }
});

const category = computed(() => {
  if (props.recommendation.title.includes('память')) return 'Ресурсы';
  if (props.recommendation.title.includes('CPU')) return 'Производительность';
  if (props.recommendation.title.includes('GPU')) return 'Вычисления';
  if (props.recommendation.title.includes('данные')) return 'Данные';
  return 'Система';
});

// Методы
const toggleDetails = () => {
  showDetails.value = !showDetails.value;
  emit('toggle-details');
};

const dismissRecommendation = () => {
  emit('dismiss');
};

const hasActionParams = (action: any): boolean => {
  return action.params && Object.keys(action.params).length > 0;
};

const formatActionParams = (params: any): string => {
  const keys = Object.keys(params);
  if (keys.length === 0) return '';
  
  const formatted = keys.slice(0, 2).map(key => `${key}: ${params[key]}`).join(', ');
  return keys.length > 2 ? `${formatted}...` : formatted;
};

const canExecuteAction = (action: any): boolean => {
  // Логика проверки возможности выполнения действия
  if (executingAction.value) return false;
  
  // Проверяем специфические условия
  switch (action.action) {
    case 'RESTART_GPU_SERVICE':
      return true; // Можно выполнять если есть права
    case 'REDUCE_DATA_SIZE':
      return true; // Всегда можно уменьшить данные
    case 'FETCH_DATA':
      return true; // Можно загружать данные
    default:
      return true;
  }
};

const getActionButtonLabel = (action: any): string => {
  if (executingAction.value === action.id) return 'Выполняется...';
  return 'Выполнить';
};

const getActionButtonIcon = (action: any): string => {
  if (executingAction.value === action.id) return 'pi pi-spin pi-spinner';
  
  switch (action.action) {
    case 'RESTART_GPU_SERVICE': return 'pi pi-refresh';
    case 'REDUCE_DATA_SIZE': return 'pi pi-compress';
    case 'FETCH_DATA': return 'pi pi-download';
    case 'EXCLUDE_PAIRS': return 'pi pi-times';
    case 'SPLIT_REQUEST': return 'pi pi-clone';
    default: return 'pi pi-play';
  }
};

const getActionButtonSeverity = (action: any): string => {
  switch (action.action) {
    case 'RESTART_GPU_SERVICE': return 'warning';
    case 'EXCLUDE_PAIRS': return 'danger';
    default: return 'primary';
  }
};

const executeAction = async (action: any) => {
  if (!canExecuteAction(action)) return;
  
  executingAction.value = action.id;
  showProgress.value = true;
  progressPercentage.value = 0;
  executionResult.value = null;
  
  try {
    // Симуляция выполнения
    progressMessage.value = `Выполнение: ${action.label}`;
    
    // Эмитируем событие для родительского компонента
    emit('execute', action);
    
    // Симуляция прогресса
    await simulateProgress();
    
    // Симуляция результата
    const success = Math.random() > 0.2; // 80% успех
    
    executionResult.value = {
      success,
      message: success 
        ? `Действие "${action.label}" выполнено успешно` 
        : `Ошибка при выполнении "${action.label}"`,
      details: success ? undefined : 'Проверьте логи для дополнительной информации'
    };
    
  } catch (error: any) {
    executionResult.value = {
      success: false,
      message: `Ошибка: ${error.message}`,
      details: error.stack
    };
  } finally {
    executingAction.value = null;
    showProgress.value = false;
    progressPercentage.value = 0;
  }
};

const simulateProgress = async () => {
  return new Promise<void>((resolve) => {
    const interval = setInterval(() => {
      progressPercentage.value += 10;
      if (progressPercentage.value >= 100) {
        clearInterval(interval);
        resolve();
      }
    }, 200);
  });
};
</script>

<style scoped>
.recommendation-card {
  @apply transition-all duration-200 hover:shadow-md;
}

.recommendation-error {
  @apply border-l-4 border-red-500;
}

.recommendation-warning {
  @apply border-l-4 border-yellow-500;
}

.recommendation-info {
  @apply border-l-4 border-blue-500;
}

.recommendation-content {
  @apply p-0;
}

.recommendation-header {
  @apply flex items-start justify-between mb-3;
}

.header-left {
  @apply flex items-start space-x-3 flex-1;
}

.recommendation-icon {
  @apply w-8 h-8 rounded-lg flex items-center justify-center text-sm flex-shrink-0;
}

.icon-error {
  @apply bg-red-100 text-red-600;
}

.icon-warning {
  @apply bg-yellow-100 text-yellow-600;
}

.icon-info {
  @apply bg-blue-100 text-blue-600;
}

.recommendation-info {
  @apply flex-1 min-w-0;
}

.recommendation-title {
  @apply font-semibold text-gray-900 mb-1;
}

.recommendation-priority {
  @apply mb-0;
}

.header-actions {
  @apply flex space-x-1;
}

.recommendation-description {
  @apply text-sm text-gray-700 mb-4 leading-relaxed;
}

.recommendation-actions {
  @apply mb-4;
}

.actions-header {
  @apply mb-3;
}

.actions-title {
  @apply text-sm font-semibold text-gray-900 flex items-center;
}

.actions-list {
  @apply space-y-2;
}

.action-item {
  @apply flex items-center justify-between p-2 bg-gray-50 rounded border transition-colors;
}

.action-loading {
  @apply bg-blue-50 border-blue-200;
}

.action-info {
  @apply flex-1 min-w-0;
}

.action-label {
  @apply font-medium text-gray-900 text-sm;
}

.action-details {
  @apply text-xs text-gray-600 mt-1 space-x-2;
}

.action-type {
  @apply font-mono bg-gray-200 px-1 py-0.5 rounded;
}

.action-params {
  @apply text-gray-500;
}

.action-controls {
  @apply flex-shrink-0 ml-3;
}

.execution-progress {
  @apply mb-4;
}

.progress-header {
  @apply flex justify-between items-center text-sm;
}

.progress-label {
  @apply text-gray-700;
}

.progress-percentage {
  @apply font-semibold text-blue-600;
}

.execution-result {
  @apply mb-4;
}

.result-content {
  @apply text-sm;
}

.result-message {
  @apply font-medium;
}

.result-details {
  @apply mt-2;
}

.result-details-text {
  @apply text-xs bg-gray-100 p-2 rounded font-mono max-h-20 overflow-y-auto;
}

.additional-info {
  @apply mt-4;
}

.info-section {
  @apply mt-3;
}

.info-title {
  @apply text-sm font-semibold text-gray-900 mb-2;
}

.info-grid {
  @apply grid grid-cols-1 md:grid-cols-2 gap-2;
}

.info-item {
  @apply flex justify-between items-center text-xs bg-gray-100 p-2 rounded;
}

.info-label {
  @apply font-medium text-gray-700;
}

.info-value {
  @apply text-gray-900;
}
</style>

