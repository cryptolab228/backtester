<template>
  <div class="modern-progress-container">
    <!-- Главный прогресс-бар -->
    <div class="main-progress-card">
      <div class="progress-header">
        <div class="progress-title">
          <div class="status-indicator" :class="statusIndicatorClass">
            <div class="status-icon-container">
              <div class="status-rings">
                <div class="ring ring-1"></div>
                <div class="ring ring-2"></div>
                <div class="ring ring-3"></div>
              </div>
              <i :class="statusIcon" class="status-icon"></i>
            </div>
          </div>
          <div class="title-text">
            <h3>{{ title }}</h3>
            <p class="subtitle">{{ currentStageDescription }}</p>
            <div class="pairs-info" v-if="totalPairsCount > 0">
              <span class="pairs-count">{{ completedPairsCount }}/{{ totalPairsCount }} пар</span>
              <div class="pairs-mini-progress">
                <div 
                  class="pairs-mini-fill" 
                  :style="{ width: `${pairsProgressPercent}%` }"
                ></div>
              </div>
            </div>
          </div>
        </div>
        <div class="progress-stats">
          <div class="modern-circular-progress" :class="{ 'active': isActive }">
            <!-- Background circle -->
            <svg class="progress-ring" width="120" height="120">
              <defs>
                <linearGradient :id="`progress-gradient-${componentId}`" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" :stop-color="progressColor" stop-opacity="0.9"/>
                  <stop offset="50%" :stop-color="progressColor" stop-opacity="0.7"/>
                  <stop offset="100%" :stop-color="progressColorEnd" stop-opacity="1"/>
                </linearGradient>
                <filter :id="`progress-glow-${componentId}`">
                  <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
                  <feMerge>
                    <feMergeNode in="coloredBlur"/>
                    <feMergeNode in="SourceGraphic"/>
                  </feMerge>
                </filter>
              </defs>
              
              <!-- Background ring -->
              <circle
                class="progress-ring-bg"
                cx="60"
                cy="60"
                r="45"
                fill="none"
                stroke="#e5e7eb"
                stroke-width="8"
              />
              
              <!-- Progress ring -->
              <circle
                class="progress-ring-fill"
                cx="60"
                cy="60"
                r="45"
                fill="none"
                :stroke="`url(#progress-gradient-${componentId})`"
                stroke-width="8"
                stroke-linecap="round"
                :filter="`url(#progress-glow-${componentId})`"
                :style="circularProgressStyle"
              />
              
              <!-- Center content -->
              <text class="progress-percentage" x="60" y="55" text-anchor="middle" dominant-baseline="middle">
                {{ progressPercent }}%
              </text>
              <text class="progress-label" x="60" y="70" text-anchor="middle" dominant-baseline="middle">
                завершено
              </text>
            </svg>
            
            <!-- Animated pulse effect -->
            <div class="pulse-effect" v-if="isActive" :style="{ '--pulse-color': progressColor }"></div>
          </div>
        </div>
      </div>

      <!-- Минималистичный прогресс-бар -->
      <div class="progress-track">
        <div 
          class="progress-fill" 
          :style="{ width: `${progressPercent}%` }"
        ></div>
        <div class="progress-glow" :style="glowStyle"></div>
      </div>

      <!-- Ключевые метрики в одну строку -->
      <div class="metrics-row">
        <div class="metric">
          <i class="pi pi-clock"></i>
          <span class="value">{{ formatDuration(elapsedTime) }}</span>
          <span class="label">прошло</span>
        </div>
        <div class="metric">
          <i class="pi pi-forward"></i>
          <span class="value">{{ formatDuration(estimatedTimeRemaining) }}</span>
          <span class="label">осталось</span>
        </div>
        <div class="metric">
          <i class="pi pi-bolt"></i>
          <span class="value">{{ currentThroughput }}</span>
          <span class="label">пар/мин</span>
        </div>
        <div class="metric" v-if="gpuStats?.enabled">
          <i class="pi pi-microchip"></i>
          <span class="value">{{ gpuStats.speedup }}x</span>
          <span class="label">ускорение</span>
        </div>
      </div>
    </div>

    <!-- Интерактивный трекинг пар -->
    <div class="pairs-tracking-card" v-if="loadingQueue || currentPairs">
      <div class="tracking-header">
        <h4>Обработка пар</h4>
        <div class="queue-stats">
          <span class="stat">{{ completedCount }}/{{ totalCount }} завершено</span>
          <span class="stat" v-if="activeCount > 0">{{ activeCount }} активно</span>
        </div>
      </div>

      <!-- Активные пары с прогрессом -->
      <div class="active-pairs" v-if="activePairs.length > 0">
        <div class="pair-item" v-for="pair in activePairs" :key="pair.symbol">
          <div class="pair-info">
            <div class="pair-symbol">
              {{ pair.symbol }}
              <span class="exchange-badge" v-if="pair.exchange">{{ pair.exchange.toUpperCase() }}</span>
            </div>
            <div class="pair-details">
              <span v-if="pair.candlesLoaded && pair.candlesTotal">
                {{ formatNumber(pair.candlesLoaded) }}/{{ formatNumber(pair.candlesTotal) }} свечей
              </span>
              <span v-if="pair.speedMbps" class="speed">{{ pair.speedMbps.toFixed(1) }} MB/s</span>
            </div>
          </div>
          <div class="pair-progress">
            <div class="mini-progress">
              <div 
                class="mini-fill" 
                :style="{ width: `${pair.progress}%` }"
              ></div>
            </div>
            <span class="progress-text">{{ pair.progress }}%</span>
          </div>
        </div>
      </div>

      <!-- Очередь ожидания (показываем первые несколько) -->
      <div class="queued-pairs" v-if="queuedPairs.length > 0">
        <div class="queue-header">
          <span class="queue-title">В очереди</span>
          <span class="queue-count">{{ queuedPairs.length }} пар</span>
        </div>
        <div class="queue-items">
          <div 
            class="queued-item" 
            v-for="(symbol, index) in queuedPairs.slice(0, 6)" 
            :key="symbol"
            :style="{ '--delay': index * 0.1 + 's' }"
          >
            {{ symbol }}
          </div>
          <div class="more-indicator" v-if="queuedPairs.length > 6">
            +{{ queuedPairs.length - 6 }} ещё
          </div>
        </div>
      </div>

      <!-- Статистика загрузки -->
      <div class="loading-stats">
        <div class="stat-item">
          <i class="pi pi-database"></i>
          <span>{{ formatBytes(totalDataSize) }} загружено</span>
        </div>
        <div class="stat-item">
          <i class="pi pi-chart-bar"></i>
          <span>{{ formatNumber(totalCandlesLoaded) }} свечей</span>
        </div>
        <div class="stat-item" v-if="averageLoadTime > 0">
          <i class="pi pi-stopwatch"></i>
          <span>{{ formatDuration(averageLoadTime) }} на пару</span>
        </div>
      </div>
    </div>

    <!-- Мини-лог активности (только последние важные события) -->
    <div class="activity-mini-log" v-if="recentActivity.length > 0">
      <div 
        class="activity-item" 
        v-for="activity in recentActivity" 
        :key="activity.timestamp"
        :class="`level-${activity.level}`"
      >
        <div class="activity-content">
          <span class="activity-message">{{ activity.message }}</span>
          <span class="activity-time">{{ formatTime(activity.timestamp) }}</span>
        </div>
      </div>
    </div>

    <!-- Ошибки (если есть) -->
    <div class="errors-card" v-if="failedPairs.length > 0">
      <div class="error-header">
        <i class="pi pi-exclamation-triangle"></i>
        <span>{{ failedPairs.length }} пар с ошибками</span>
        <button @click="showErrorDetails = !showErrorDetails" class="toggle-errors">
          <i :class="showErrorDetails ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"></i>
        </button>
      </div>
      <div class="error-list" v-if="showErrorDetails">
        <div class="error-item" v-for="pair in failedPairs" :key="pair.symbol">
          <span class="error-symbol">{{ pair.symbol }}</span>
          <span class="error-message">{{ pair.errorMessage }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import type { 
  PairProgress, 
  LoadingQueueInfo, 
  GPUProgressStats,
  ActivityLogEntry,
  PortfolioProgressStats
} from '@/types/progress';

interface Props {
  title?: string;
  isActive?: boolean;
  isCompleted?: boolean;
  currentStage?: string;
  currentStageDescription?: string;
  processedItems?: number;
  totalItems?: number;
  startTime?: number;
  currentPairs?: PairProgress[];
  loadingQueue?: LoadingQueueInfo;
  gpuStats?: GPUProgressStats;
  activityLog?: ActivityLogEntry[];
  portfolioStats?: PortfolioProgressStats; // Добавляем portfolioStats для fallback
}

const props = withDefaults(defineProps<Props>(), {
  title: 'Портфельный бэктест',
  isActive: false,
  isCompleted: false,
  currentStage: 'Подготовка',
  currentStageDescription: 'Инициализация...',
  processedItems: 0,
  totalItems: 100,
  startTime: 0,
  currentPairs: () => [],
  activityLog: () => []
});

// Состояние
const showErrorDetails = ref(false);
const elapsedTime = ref(0);
const estimatedTimeRemaining = ref(0);

// Уникальный ID для SVG элементов
const componentId = Math.random().toString(36).substr(2, 9);

// Вычисляемые свойства
const progressPercent = computed(() => {
  // ДЛЯ ПОРТФЕЛЯ: используем прогресс по парам, а не по этапам!
  if (props.portfolioStats) {
    const totalPairs = props.portfolioStats.totalPairs;
    const processedPairs = props.portfolioStats.processedPairs;
    if (totalPairs === 0) return 0;
    return Math.round((processedPairs / totalPairs) * 100);
  }
  
  // Для обычного бэктеста используем общий прогресс по этапам
  if (props.totalItems === 0) return 0;
  return Math.round((props.processedItems / props.totalItems) * 100);
});

const statusIndicatorClass = computed(() => {
  if (props.isCompleted) return 'status-completed';
  if (props.isActive) return 'status-active';
  return 'status-pending';
});

const statusIcon = computed(() => {
  if (props.isCompleted) return 'pi pi-check';
  if (props.isActive) return 'pi pi-spin pi-cog';
  return 'pi pi-clock';
});

const glowStyle = computed(() => {
  if (props.isActive) {
    return {
      width: `${progressPercent.value}%`,
      opacity: 0.6
    };
  }
  return { width: '0%', opacity: 0 };
});

// Данные пар с fallback логикой
const activePairs = computed(() => {
  if (props.currentPairs && props.currentPairs.length > 0) {
    return props.currentPairs.filter(pair => pair.status === 'loading' || pair.status === 'processing');
  }
  
  // Fallback: создаем виртуальные активные пары на основе portfolioStats
  if (props.portfolioStats && props.portfolioStats.currentPair) {
    // Для активной пары показываем индивидуальный прогресс (оценочно)
    const pairProgress = props.portfolioStats.processedPairs > 0 ? 
      Math.min(100, Math.round((props.processedItems / props.totalItems) * 100)) : 0;
    
    return [{
      symbol: props.portfolioStats.currentPair,
      status: 'loading' as const,
      progress: pairProgress,
      exchange: 'bybit'
    }];
  }
  
  return [];
});

const queuedPairs = computed(() => {
  if (props.loadingQueue?.queuedPairs) {
    return props.loadingQueue.queuedPairs;
  }
  
  // Fallback: создаем очередь на основе оставшихся пар
  if (props.portfolioStats && props.portfolioStats.pairsNeedingData > 0) {
    const remaining = props.portfolioStats.pairsNeedingData;
    return Array.from({ length: Math.min(remaining, 10) }, (_, i) => `PAIR_${i + 1}USDT`);
  }
  
  return [];
});

const failedPairs = computed(() => {
  return props.currentPairs?.filter(pair => pair.status === 'error') || [];
});

// Умная логика для подсчета пар - приоритет portfolioStats над totalItems
const completedCount = computed(() => {
  // 1. Если есть loadingQueue - используем его данные
  if (props.loadingQueue?.completedPairs !== undefined) {
    return props.loadingQueue.completedPairs;
  }
  
  // 2. Если есть portfolioStats - используем их (приоритет!)
  if (props.portfolioStats?.processedPairs !== undefined) {
    return props.portfolioStats.processedPairs;
  }
  
  // 3. Fallback к общему прогрессу только если нет portfolioStats
  return 0;
});

const totalCount = computed(() => {
  // 1. Если есть loadingQueue - используем его данные  
  if (props.loadingQueue?.totalPairs) {
    return props.loadingQueue.totalPairs;
  }
  
  // 2. ПРИОРИТЕТ: portfolioStats.totalPairs (это реальное количество пар)
  if (props.portfolioStats?.totalPairs) {
    return props.portfolioStats.totalPairs;
  }
  
  // 3. Fallback к totalItems только если нет portfolioStats
  // (totalItems может быть 100 для общего прогресса, но пар может быть 660)
  return props.totalItems;
});

const activeCount = computed(() => {
  return activePairs.value.length;
});

const currentThroughput = computed(() => {
  return props.loadingQueue?.currentThroughput?.toFixed(1) || '0';
});

const totalDataSize = computed(() => {
  return props.loadingQueue?.totalDataSize || 0;
});

const totalCandlesLoaded = computed(() => {
  return props.loadingQueue?.totalCandlesLoaded || 0;
});

const averageLoadTime = computed(() => {
  return (props.loadingQueue?.averagePairLoadTime || 0) * 1000; // в мс
});

const recentActivity = computed(() => {
  return props.activityLog?.slice(-3).reverse() || [];
});

// Новые computed для улучшенного дизайна
const totalPairsCount = computed(() => totalCount.value);
const completedPairsCount = computed(() => completedCount.value);

const pairsProgressPercent = computed(() => {
  if (totalPairsCount.value === 0) return 0;
  return Math.round((completedPairsCount.value / totalPairsCount.value) * 100);
});

const progressColor = computed(() => {
  if (props.isCompleted) return '#10b981';
  if (props.isActive) return '#6366f1';
  return '#9ca3af';
});

const progressColorEnd = computed(() => {
  if (props.isCompleted) return '#059669';
  if (props.isActive) return '#4f46e5';
  return '#6b7280';
});

// ОТЛАДКА: Детальное логирование всех данных и вычислений
watch(() => [props.portfolioStats, props.loadingQueue, props.totalItems, props.processedItems], () => {
  console.log('🔍 ModernPortfolioProgress Debug Data:', {
    // Входящие данные:
    portfolioStats: props.portfolioStats,
    loadingQueue: props.loadingQueue,
    totalItems: props.totalItems,
    processedItems: props.processedItems,
    
    // Вычисленные значения:
    computed: {
      totalPairsCount: totalPairsCount.value,
      completedPairsCount: completedPairsCount.value,
      pairsProgressPercent: pairsProgressPercent.value,
      progressPercent: progressPercent.value, // ОСНОВНОЙ прогресс для гексагона
    },
    
    // Диагностика логики:
    logic: {
      hasPortfolioStats: !!props.portfolioStats,
      portfolioTotalPairs: props.portfolioStats?.totalPairs,
      portfolioProcessedPairs: props.portfolioStats?.processedPairs,
      usingPortfolioProgress: !!props.portfolioStats,
      itemsProgress: props.totalItems > 0 ? Math.round((props.processedItems / props.totalItems) * 100) : 0
    }
  });
}, { deep: true, immediate: true });

// Новая анимация кругового прогресса
const circularProgressStyle = computed(() => {
  const circumference = 2 * Math.PI * 45; // радиус 45px
  const strokeDasharray = circumference;
  const strokeDashoffset = circumference - (progressPercent.value / 100) * circumference;
  
  return {
    strokeDasharray: `${strokeDasharray}`,
    strokeDashoffset: `${strokeDashoffset}`,
    transform: 'rotate(-90deg)',
    transformOrigin: 'center',
    transition: 'stroke-dashoffset 1.5s cubic-bezier(0.25, 0.46, 0.45, 0.94)'
  };
});


// Методы форматирования
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

const formatNumber = (num: number): string => {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
};

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Обновление времени
const updateTiming = () => {
  if (props.startTime > 0) {
    const now = Date.now();
    elapsedTime.value = now - props.startTime;
    
    if (props.processedItems > 0 && elapsedTime.value > 0) {
      const itemsPerSecond = props.processedItems / (elapsedTime.value / 1000);
      if (itemsPerSecond > 0) {
        const remainingItems = props.totalItems - props.processedItems;
        estimatedTimeRemaining.value = (remainingItems / itemsPerSecond) * 1000;
      }
    }
  }
};

// Lifecycle
let updateInterval: number | null = null;

onMounted(() => {
  updateInterval = window.setInterval(updateTiming, 1000);
});

onUnmounted(() => {
  if (updateInterval) {
    clearInterval(updateInterval);
  }
});

// Watchers
watch(() => props.processedItems, updateTiming);
</script>

<style scoped>
.modern-progress-container {
  --primary-color: #6366f1;
  --primary-light: #a5b4fc;
  --success-color: #10b981;
  --warning-color: #f59e0b;
  --error-color: #ef4444;
  --text-primary: #1f2937;
  --text-secondary: #6b7280;
  --bg-primary: #ffffff;
  --bg-secondary: #f9fafb;
  --border-color: #e5e7eb;
  --shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
  --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
  
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  space-y: 16px;
}

/* Главная карточка прогресса */
.main-progress-card {
  background: var(--bg-primary);
  border-radius: 16px;
  padding: 24px;
  box-shadow: var(--shadow-lg);
  border: 1px solid var(--border-color);
  margin-bottom: 16px;
}

.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.progress-title {
  display: flex;
  align-items: center;
  gap: 16px;
}

.status-indicator {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
}

.status-active {
  background: linear-gradient(135deg, var(--primary-color), var(--primary-light));
  color: white;
}

.status-completed {
  background: linear-gradient(135deg, var(--success-color), #34d399);
  color: white;
}

.status-pending {
  background: var(--bg-secondary);
  color: var(--text-secondary);
}

.status-icon {
  font-size: 20px;
}

.title-text h3 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary);
}

.subtitle {
  margin: 4px 0 0 0;
  font-size: 14px;
  color: var(--text-secondary);
}

/* Улучшенный индикатор статуса с кольцами */
.status-icon-container {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.status-rings {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}

.ring {
  position: absolute;
  border-radius: 50%;
  border: 2px solid currentColor;
  opacity: 0.3;
}

.status-active .ring {
  animation: pulse-ring 2s infinite;
}

.ring-1 {
  width: 40px;
  height: 40px;
  top: -20px;
  left: -20px;
  animation-delay: 0s;
}

.ring-2 {
  width: 50px;
  height: 50px;
  top: -25px;
  left: -25px;
  animation-delay: 0.3s;
}

.ring-3 {
  width: 60px;
  height: 60px;
  top: -30px;
  left: -30px;
  animation-delay: 0.6s;
}

@keyframes pulse-ring {
  0% {
    transform: scale(0.8);
    opacity: 0.8;
  }
  50% {
    transform: scale(1.1);
    opacity: 0.2;
  }
  100% {
    transform: scale(1.3);
    opacity: 0;
  }
}

.status-icon {
  position: relative;
  z-index: 10;
  font-size: 20px;
}

/* Информация о парах под заголовком */
.pairs-info {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}

.pairs-count {
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 500;
}

.pairs-mini-progress {
  width: 60px;
  height: 3px;
  background: var(--bg-secondary);
  border-radius: 2px;
  overflow: hidden;
}

.pairs-mini-fill {
  height: 100%;
  background: var(--primary-color);
  border-radius: 2px;
  transition: width 0.5s ease;
}

/* Современный круговой прогресс-индикатор */
.modern-circular-progress {
  position: relative;
  width: 120px;
  height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.progress-ring {
  transform: rotate(0deg);
  transition: all 0.3s ease;
}

.modern-circular-progress.active .progress-ring {
  animation: ring-pulse 4s infinite;
}

.progress-ring-bg {
  opacity: 0.3;
  transition: all 0.3s ease;
}

.progress-ring-fill {
  transition: stroke-dashoffset 1.5s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.progress-percentage {
  font-size: 16px;
  font-weight: 700;
  fill: var(--text-primary);
  font-family: 'Inter', sans-serif;
}

.progress-label {
  font-size: 9px;
  fill: var(--text-secondary);
  font-family: 'Inter', sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

@keyframes ring-pulse {
  0%, 100% {
    transform: rotate(0deg) scale(1);
    opacity: 1;
  }
  50% {
    transform: rotate(0deg) scale(1.05);
    opacity: 0.9;
  }
}

/* Эффект пульсации */
.pulse-effect {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 120px;
  height: 120px;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  background: radial-gradient(circle, var(--pulse-color, #6366f1) 0%, transparent 70%);
  opacity: 0.3;
  animation: pulse-expand 3s infinite;
  pointer-events: none;
}

@keyframes pulse-expand {
  0%, 100% {
    transform: translate(-50%, -50%) scale(1);
    opacity: 0.3;
  }
  50% {
    transform: translate(-50%, -50%) scale(1.2);
    opacity: 0.1;
  }
}


.percentage {
  display: block;
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
}

.label {
  font-size: 11px;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* Минималистичный прогресс-бар */
.progress-track {
  position: relative;
  height: 8px;
  background: var(--bg-secondary);
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 20px;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--primary-color), var(--primary-light));
  border-radius: 4px;
  transition: width 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.progress-glow {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(99, 102, 241, 0.4), transparent);
  border-radius: 4px;
  animation: shimmer 2s infinite;
  transition: all 0.3s ease;
}

@keyframes shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(400%); }
}

@keyframes rotate {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* Метрики в одну строку */
.metrics-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 16px;
}

.metric {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background: var(--bg-secondary);
  border-radius: 8px;
  transition: all 0.2s ease;
}

.metric:hover {
  background: #f3f4f6;
  transform: translateY(-1px);
}

.metric i {
  font-size: 16px;
  color: var(--primary-color);
}

.metric .value {
  font-weight: 600;
  color: var(--text-primary);
  font-size: 14px;
}

.metric .label {
  font-size: 12px;
  color: var(--text-secondary);
}

/* Трекинг пар */
.pairs-tracking-card {
  background: var(--bg-primary);
  border-radius: 16px;
  padding: 20px;
  box-shadow: var(--shadow);
  border: 1px solid var(--border-color);
  margin-bottom: 16px;
}

.tracking-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.tracking-header h4 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.queue-stats {
  display: flex;
  gap: 16px;
}

.stat {
  font-size: 13px;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  padding: 4px 8px;
  border-radius: 6px;
}

/* Активные пары */
.active-pairs {
  margin-bottom: 16px;
}

.pair-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid #f3f4f6;
}

.pair-item:last-child {
  border-bottom: none;
}

.pair-info {
  flex: 1;
}

.pair-symbol {
  font-weight: 600;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 8px;
}

.exchange-badge {
  font-size: 10px;
  background: var(--primary-color);
  color: white;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 500;
}

.pair-details {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
  display: flex;
  gap: 8px;
}

.speed {
  color: var(--success-color);
  font-weight: 500;
}

.pair-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 80px;
}

.mini-progress {
  width: 50px;
  height: 4px;
  background: var(--bg-secondary);
  border-radius: 2px;
  overflow: hidden;
}

.mini-fill {
  height: 100%;
  background: var(--primary-color);
  border-radius: 2px;
  transition: width 0.3s ease;
}

.progress-text {
  font-size: 11px;
  color: var(--text-secondary);
  min-width: 35px;
  text-align: right;
}

/* Очередь */
.queued-pairs {
  margin-bottom: 16px;
  padding: 12px;
  background: var(--bg-secondary);
  border-radius: 8px;
}

.queue-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
}

.queue-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
}

.queue-count {
  font-size: 12px;
  color: var(--text-secondary);
}

.queue-items {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.queued-item {
  font-size: 11px;
  background: white;
  border: 1px solid var(--border-color);
  padding: 3px 6px;
  border-radius: 4px;
  color: var(--text-secondary);
  animation: fadeInQueue 0.5s ease-out var(--delay, 0s) both;
}

.more-indicator {
  font-size: 11px;
  color: var(--text-secondary);
  font-style: italic;
}

@keyframes fadeInQueue {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Статистика загрузки */
.loading-stats {
  display: flex;
  justify-content: space-between;
  padding-top: 12px;
  border-top: 1px solid var(--border-color);
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
}

.stat-item i {
  color: var(--primary-color);
}

/* Мини-лог */
.activity-mini-log {
  background: var(--bg-primary);
  border-radius: 12px;
  padding: 16px;
  box-shadow: var(--shadow);
  border: 1px solid var(--border-color);
  margin-bottom: 16px;
}

.activity-item {
  padding: 8px 0;
  border-bottom: 1px solid #f9fafb;
}

.activity-item:last-child {
  border-bottom: none;
}

.activity-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.activity-message {
  font-size: 13px;
  color: var(--text-primary);
}

.activity-time {
  font-size: 11px;
  color: var(--text-secondary);
}

.level-success .activity-message {
  color: var(--success-color);
}

.level-error .activity-message {
  color: var(--error-color);
}

.level-warning .activity-message {
  color: var(--warning-color);
}

/* Ошибки */
.errors-card {
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 12px;
  padding: 16px;
}

.error-header {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--error-color);
  font-size: 14px;
  font-weight: 500;
}

.toggle-errors {
  margin-left: auto;
  background: none;
  border: none;
  color: var(--error-color);
  cursor: pointer;
  padding: 4px;
}

.error-list {
  margin-top: 12px;
  space-y: 8px;
}

.error-item {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  padding: 6px 0;
  border-bottom: 1px solid #fecaca;
}

.error-item:last-child {
  border-bottom: none;
}

.error-symbol {
  font-weight: 500;
  color: var(--error-color);
}

.error-message {
  color: #991b1b;
  max-width: 60%;
  text-align: right;
}

/* Responsive */
@media (max-width: 768px) {
  .progress-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 16px;
  }
  
  .metrics-row {
    grid-template-columns: repeat(2, 1fr);
  }
  
  .loading-stats {
    flex-direction: column;
    gap: 8px;
  }
}
</style>
