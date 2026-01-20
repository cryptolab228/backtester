<template>
  <div class="bg-white rounded-md border border-slate-200 p-3 hover:shadow-sm transition-shadow">
    <div class="flex items-start justify-between gap-2">
      <div class="flex-1 min-w-0">
        <h3 class="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">{{ title }}</h3>
        <p class="text-xl font-bold truncate" :class="valueClass">{{ formattedValue }}</p>
        <p v-if="subtitle" class="text-xs text-slate-400 mt-0.5 truncate">{{ subtitle }}</p>
      </div>
      <div v-if="icon" class="flex-shrink-0">
        <i :class="iconClass" class="text-lg"></i>
      </div>
    </div>
    <div v-if="trend" class="mt-2 flex items-center">
      <i :class="trendIcon" class="text-xs mr-1"></i>
      <span :class="trendClass" class="text-xs font-medium">{{ trend }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

interface Props {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: string;
  iconColor?: 'blue' | 'green' | 'red' | 'yellow' | 'purple' | 'gray';
  valueColor?: 'blue' | 'green' | 'red' | 'yellow' | 'purple' | 'gray' | 'default';
  trend?: string;
  trendType?: 'up' | 'down' | 'neutral';
  format?: 'number' | 'currency' | 'percentage' | 'duration' | 'memory';
}

const props = withDefaults(defineProps<Props>(), {
  iconColor: 'blue',
  valueColor: 'default',
  trendType: 'neutral',
  format: 'number'
});

const iconClass = computed(() => {
  const baseClass = props.icon || 'pi pi-chart-line';
  const colorMap = {
    blue: 'text-blue-500',
    green: 'text-green-500',
    red: 'text-red-500',
    yellow: 'text-yellow-500',
    purple: 'text-purple-500',
    gray: 'text-gray-500'
  };
  return `${baseClass} ${colorMap[props.iconColor]}`;
});

const valueClass = computed(() => {
  const colorMap = {
    blue: 'text-blue-600',
    green: 'text-green-600',
    red: 'text-red-600',
    yellow: 'text-yellow-600',
    purple: 'text-purple-600',
    gray: 'text-gray-600',
    default: 'text-gray-900'
  };
  return colorMap[props.valueColor];
});

const trendIcon = computed(() => {
  const iconMap = {
    up: 'pi pi-arrow-up text-green-500',
    down: 'pi pi-arrow-down text-red-500',
    neutral: 'pi pi-minus text-gray-500'
  };
  return iconMap[props.trendType];
});

const trendClass = computed(() => {
  const classMap = {
    up: 'text-green-600',
    down: 'text-red-600',
    neutral: 'text-gray-600'
  };
  return classMap[props.trendType];
});

const formattedValue = computed(() => {
  if (props.value === null || props.value === undefined) {
    return 'N/A';
  }

  const numValue = typeof props.value === 'string' ? parseFloat(props.value) : props.value;

  switch (props.format) {
    case 'currency':
      return new Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
      }).format(numValue);
    
    case 'percentage':
      return `${numValue.toFixed(1)}%`;
    
    case 'duration':
      if (numValue < 60) {
        return `${Math.round(numValue)}с`;
      } else if (numValue < 3600) {
        return `${Math.round(numValue / 60)}м`;
      } else if (numValue < 86400) {
        return `${Math.round(numValue / 3600)}ч`;
      } else {
        return `${Math.round(numValue / 86400)}д`;
      }
    
    case 'memory':
      return `${numValue} MB`;
    
    case 'number':
    default:
      if (numValue >= 1000000) {
        return `${(numValue / 1000000).toFixed(1)}M`;
      } else if (numValue >= 1000) {
        return `${(numValue / 1000).toFixed(1)}K`;
      } else {
        return numValue.toLocaleString('ru-RU');
      }
  }
});
</script>

<style scoped>
.shadow-sm {
  box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
}
</style> 