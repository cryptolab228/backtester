<template>
  <div class="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
    <div class="flex items-center justify-between mb-4">
      <h3 class="text-lg font-semibold text-gray-900">Состояние Системы</h3>
      <div class="flex items-center">
        <div :class="overallHealthClass" class="w-3 h-3 rounded-full mr-2"></div>
        <span class="text-sm font-medium" :class="overallHealthTextClass">
          {{ overallHealthText }}
        </span>
      </div>
    </div>
    
    <div class="space-y-4">
      <div v-for="(status, component) in systemHealth" :key="component" class="flex items-center justify-between">
        <div class="flex items-center">
          <i :class="getComponentIcon(component)" class="text-lg mr-3"></i>
          <span class="text-sm font-medium text-gray-700 capitalize">{{ getComponentName(component) }}</span>
        </div>
        <div class="flex items-center">
          <div :class="getStatusClass(status)" class="w-2 h-2 rounded-full mr-2"></div>
          <span :class="getStatusTextClass(status)" class="text-sm font-medium">
            {{ getStatusText(status) }}
          </span>
        </div>
      </div>
    </div>
    
    <div class="mt-4 pt-4 border-t border-gray-100">
      <div class="text-xs text-gray-500">
        Последняя проверка: {{ lastChecked }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { SystemHealth } from '@/services/statisticsService';

interface Props {
  systemHealth: SystemHealth;
  lastUpdated?: Date;
}

const props = withDefaults(defineProps<Props>(), {
  lastUpdated: () => new Date()
});

const lastChecked = computed(() => {
  return props.lastUpdated.toLocaleString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
});

const overallHealthStatus = computed(() => {
  const statuses = Object.values(props.systemHealth);
  if (statuses.every(status => status === 'healthy')) {
    return 'healthy';
  } else if (statuses.some(status => status === 'healthy')) {
    return 'warning';
  } else {
    return 'error';
  }
});

const overallHealthClass = computed(() => {
  const classMap = {
    healthy: 'bg-green-400',
    warning: 'bg-yellow-400',
    error: 'bg-red-400'
  };
  return classMap[overallHealthStatus.value];
});

const overallHealthTextClass = computed(() => {
  const classMap = {
    healthy: 'text-green-600',
    warning: 'text-yellow-600',
    error: 'text-red-600'
  };
  return classMap[overallHealthStatus.value];
});

const overallHealthText = computed(() => {
  const textMap = {
    healthy: 'Все системы работают',
    warning: 'Частичные проблемы',
    error: 'Критические ошибки'
  };
  return textMap[overallHealthStatus.value];
});

const getComponentIcon = (component: string) => {
  const iconMap: Record<string, string> = {
    database: 'pi pi-database text-blue-500',
    redis: 'pi pi-server text-red-500',
    queue: 'pi pi-clock text-purple-500'
  };
  return iconMap[component] || 'pi pi-cog text-gray-500';
};

const getComponentName = (component: string) => {
  const nameMap: Record<string, string> = {
    database: 'База данных',
    redis: 'Redis',
    queue: 'Очередь задач'
  };
  return nameMap[component] || component;
};

const getStatusClass = (status: string) => {
  const classMap: Record<string, string> = {
    healthy: 'bg-green-400',
    error: 'bg-red-400'
  };
  return classMap[status] || 'bg-gray-400';
};

const getStatusTextClass = (status: string) => {
  const classMap: Record<string, string> = {
    healthy: 'text-green-600',
    error: 'text-red-600'
  };
  return classMap[status] || 'text-gray-600';
};

const getStatusText = (status: string) => {
  const textMap: Record<string, string> = {
    healthy: 'Работает',
    error: 'Ошибка'
  };
  return textMap[status] || status;
};
</script>

<style scoped>
.shadow-sm {
  box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
}
</style> 