<template>
  <div class="animate-fade-in">
    <!-- Индикатор загрузки -->
    <div v-if="isLoading" class="flex justify-center items-center py-12">
      <ProgressSpinner animationDuration=".8s" strokeWidth="4" style="width: 40px; height: 40px"/>
      <span class="ml-3 text-slate-600 text-sm">Загрузка...</span>
    </div>

    <!-- Сообщение об ошибке -->
    <Message v-if="error && !isLoading" severity="error" :closable="false" class="mb-4">
      {{ error }}
    </Message>

    <!-- Dashboard содержимое -->
    <div v-if="!isLoading && statistics" class="space-y-4">
      
      <!-- Состояние системы -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <div class="lg:col-span-1">
          <SystemHealthCard 
            :systemHealth="statistics.systemHealth" 
            :lastUpdated="lastUpdated"
          />
        </div>
        <div class="lg:col-span-2">
          <div class="grid grid-cols-2 gap-3">
            <StatisticCard
              title="Время работы"
              :value="statistics.resourceUsage.uptime"
              format="duration"
              icon="pi pi-clock"
              iconColor="blue"
              subtitle="с момента запуска"
            />
            <StatisticCard
              title="Память"
              :value="statistics.resourceUsage.memoryUsage.percentage"
              format="percentage"
              icon="pi pi-chart-pie"
              iconColor="purple"
              :subtitle="`${statistics.resourceUsage.memoryUsage.used} / ${statistics.resourceUsage.memoryUsage.total} MB`"
              :valueColor="getMemoryUsageColor(statistics.resourceUsage.memoryUsage.percentage)"
            />
          </div>
        </div>
      </div>

      <!-- Основная статистика -->
      <div>
        <h3 class="text-sm font-semibold text-slate-700 mb-3 uppercase tracking-wide">Основные метрики</h3>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatisticCard
            title="Всего Бэктестов"
            :value="statistics.backtestStatistics.totalBacktestsRun"
            icon="pi pi-play"
            iconColor="green"
            subtitle="одиночных тестов"
          />
          <StatisticCard
            title="Портфельных Тестов"
            :value="statistics.backtestStatistics.totalPortfolioBacktests"
            icon="pi pi-chart-line"
            iconColor="blue"
            subtitle="мульти-пара тестов"
          />
          <StatisticCard
            title="Средняя Длительность"
            :value="statistics.backtestStatistics.avgBacktestDuration ? Math.round(statistics.backtestStatistics.avgBacktestDuration / 1000) : 0"
            format="duration"
            icon="pi pi-stopwatch"
            iconColor="yellow"
            subtitle="время выполнения"
          />
          <StatisticCard
            title="Последний Тест"
            :value="formatRelativeTime(statistics.backtestStatistics.lastBacktestTimestamp)"
            icon="pi pi-calendar"
            iconColor="gray"
            subtitle="время назад"
          />
        </div>
      </div>

      <!-- Статистика очереди -->
      <div>
        <h3 class="text-sm font-semibold text-slate-700 mb-3 uppercase tracking-wide">Очередь задач</h3>
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <StatisticCard
            title="Всего задач"
            :value="statistics.queueStatistics.totalJobs"
            icon="pi pi-list"
            iconColor="gray"
          />
          <StatisticCard
            title="Активные"
            :value="statistics.queueStatistics.activeJobs"
            icon="pi pi-spin pi-sync"
            iconColor="blue"
            :valueColor="statistics.queueStatistics.activeJobs > 0 ? 'blue' : 'gray'"
          />
          <StatisticCard
            title="В очереди"
            :value="statistics.queueStatistics.waitingJobs"
            icon="pi pi-clock"
            iconColor="yellow"
            :valueColor="statistics.queueStatistics.waitingJobs > 0 ? 'yellow' : 'gray'"
          />
          <StatisticCard
            title="Завершенные"
            :value="statistics.queueStatistics.completedJobs"
            icon="pi pi-check-circle"
            iconColor="green"
          />
          <StatisticCard
            title="Ошибки"
            :value="statistics.queueStatistics.failedJobs"
            icon="pi pi-times-circle"
            iconColor="red"
            :valueColor="statistics.queueStatistics.failedJobs > 0 ? 'red' : 'gray'"
          />
        </div>
      </div>

      <!-- Статистика данных -->
      <div>
        <h3 class="text-sm font-semibold text-slate-700 mb-3 uppercase tracking-wide">Данные</h3>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatisticCard
            title="Торговые пары"
            :value="statistics.dataStatistics.totalTradingPairs"
            icon="pi pi-chart-line"
            iconColor="purple"
            subtitle="доступных символов"
          />
          <StatisticCard
            title="Свечи"
            :value="statistics.dataStatistics.totalCandles"
            format="number"
            icon="pi pi-chart-bar"
            iconColor="blue"
            subtitle="в базе данных"
          />
          <StatisticCard
            title="Самые свежие данные"
            :value="formatRelativeTime(statistics.dataStatistics.latestDataTimestamp)"
            icon="pi pi-arrow-up"
            iconColor="green"
            subtitle="время назад"
          />
          <StatisticCard
            title="Самые старые данные"
            :value="formatRelativeTime(statistics.dataStatistics.oldestDataTimestamp)"
            icon="pi pi-arrow-down"
            iconColor="gray"
            subtitle="время назад"
          />
        </div>
      </div>

      <!-- Кнопки действий -->
      <div class="flex flex-wrap gap-2 pt-4">
        <Button 
          label="Обновить" 
          icon="pi pi-refresh" 
          @click="refreshStatistics"
          :loading="isRefreshing"
          size="small"
          severity="success"
        />
        <RouterLink to="/backtester">
          <Button 
            label="Бэктестер" 
            icon="pi pi-arrow-right" 
            size="small"
          />
        </RouterLink>
        <RouterLink to="/data">
          <Button 
            label="Данные" 
            icon="pi pi-database" 
            size="small"
            severity="secondary"
          />
        </RouterLink>
        <RouterLink to="/queue-manager">
          <Button 
            label="Очередь" 
            icon="pi pi-list" 
            size="small"
            severity="secondary"
          />
        </RouterLink>
      </div>

      <!-- Время последнего обновления -->
      <div class="mt-6 text-center text-xs text-slate-400">
        Обновлено: {{ formatLastUpdated(lastUpdated) }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { RouterLink } from 'vue-router';
import ProgressSpinner from 'primevue/progressspinner';
import Message from 'primevue/message';
import Button from 'primevue/button';
import { useToast } from 'primevue/usetoast';
import { getDashboardStatistics, type BacktesterStatistics } from '@/services/statisticsService';
import StatisticCard from '@/components/dashboard/StatisticCard.vue';
import SystemHealthCard from '@/components/dashboard/SystemHealthCard.vue';

const toast = useToast();

const statistics = ref<BacktesterStatistics | null>(null);
const isLoading = ref(true);
const isRefreshing = ref(false);
const error = ref<string | null>(null);
const lastUpdated = ref(new Date());

let refreshInterval: number | undefined;

const loadStatistics = async (showLoading = true) => {
  try {
    if (showLoading) {
      isLoading.value = true;
    } else {
      isRefreshing.value = true;
    }
    error.value = null;

    console.log('[HomeView] Loading dashboard statistics...');
    const data = await getDashboardStatistics();
    statistics.value = data;
    lastUpdated.value = new Date();
    
    if (!showLoading) {
      toast.add({
        severity: 'success',
        summary: 'Обновлено',
        detail: 'Статистика успешно обновлена',
        life: 3000
      });
    }
    
    console.log('[HomeView] Dashboard statistics loaded successfully:', data);
  } catch (err: any) {
    console.error('[HomeView] Error loading dashboard statistics:', err);
    error.value = err.message || 'Ошибка загрузки статистики';
    
    if (!showLoading) {
      toast.add({
        severity: 'error',
        summary: 'Ошибка',
        detail: 'Не удалось обновить статистику',
        life: 5000
      });
    }
  } finally {
    isLoading.value = false;
    isRefreshing.value = false;
  }
};

const refreshStatistics = () => {
  loadStatistics(false);
};

const formatRelativeTime = (timestamp: string | null): string => {
  if (!timestamp) return 'Н/Д';
  
  const now = new Date();
  const time = new Date(timestamp);
  const diffMs = now.getTime() - time.getTime();
  
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffMinutes < 1) {
    return 'только что';
  } else if (diffMinutes < 60) {
    return `${diffMinutes}м`;
  } else if (diffHours < 24) {
    return `${diffHours}ч`;
  } else {
    return `${diffDays}д`;
  }
};

const getMemoryUsageColor = (percentage: number): 'green' | 'yellow' | 'red' => {
  if (percentage < 70) return 'green';
  if (percentage < 85) return 'yellow';
  return 'red';
};

const formatLastUpdated = (date: Date): string => {
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
};

onMounted(() => {
  loadStatistics();
  
  // Автообновление каждые 30 секунд
  refreshInterval = window.setInterval(() => {
    loadStatistics(false);
  }, 30000);
});

onUnmounted(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }
});
</script>

<style scoped>
/* Анимация для иконок */
.pi-spin {
  animation: spin 2s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style> 