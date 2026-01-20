<template>
  <div class="equity-curve-chart">
    <div class="bg-white rounded-lg shadow p-6">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-xl font-semibold text-gray-900 flex items-center">
          <i class="pi pi-chart-line mr-2 text-blue-600"></i>
          {{ title }}
        </h3>
        <div class="flex items-center space-x-2">
          <Button 
            v-if="chartInstance" 
            icon="pi pi-download" 
            class="p-button-text p-button-sm" 
            @click="downloadChart"
            v-tooltip.bottom="'Скачать график'"
          />
          <Button 
            icon="pi pi-refresh" 
            class="p-button-text p-button-sm" 
            @click="refreshChart"
            v-tooltip.bottom="'Обновить график'"
          />
        </div>
      </div>
      
      <div v-if="isLoading" class="flex justify-center items-center py-12">
        <ProgressSpinner animationDuration=".8s" strokeWidth="4"/>
        <span class="ml-3 text-gray-600">Загрузка данных графика...</span>
      </div>
      
      <div v-else-if="hasData" class="chart-container" style="position: relative; height: 400px;">
        <canvas ref="chartCanvas"></canvas>
      </div>
      
      <div v-else class="text-center py-12">
        <i class="pi pi-chart-line text-6xl text-gray-300 mb-4"></i>
        <h4 class="text-lg text-gray-500 mb-2">Кривая баланса</h4>
        <p class="text-gray-400">{{ noDataMessage }}</p>
      </div>
      
      <!-- Статистика -->
      <div v-if="hasData && equityStats" class="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
        <div class="bg-gray-50 p-3 rounded-lg">
          <div class="text-sm text-gray-600">Максимум</div>
          <div class="text-lg font-semibold text-green-600">
            ${{ equityStats.maxEquity.toLocaleString() }}
          </div>
        </div>
        <div class="bg-gray-50 p-3 rounded-lg">
          <div class="text-sm text-gray-600">Минимум</div>
          <div class="text-lg font-semibold text-red-600">
            ${{ equityStats.minEquity.toLocaleString() }}
          </div>
        </div>
        <div class="bg-gray-50 p-3 rounded-lg">
          <div class="text-sm text-gray-600">Общий рост</div>
          <div class="text-lg font-semibold" :class="equityStats.totalGrowth >= 0 ? 'text-green-600' : 'text-red-600'">
            {{ equityStats.totalGrowth >= 0 ? '+' : '' }}{{ equityStats.totalGrowth.toFixed(2) }}%
          </div>
        </div>
        <div class="bg-gray-50 p-3 rounded-lg">
          <div class="text-sm text-gray-600">Волатильность</div>
          <div class="text-lg font-semibold text-blue-600">
            {{ equityStats.volatility.toFixed(2) }}%
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { Chart } from '@/utils/chartConfig';
import Button from 'primevue/button';
import ProgressSpinner from 'primevue/progressspinner';

interface EquityPoint {
  timestamp: number;
  capital: number;
}

interface Props {
  equityData: EquityPoint[] | null;
  title?: string;
  isLoading?: boolean;
  noDataMessage?: string;
  color?: string;
  fillColor?: string;
}

const props = withDefaults(defineProps<Props>(), {
  title: 'Кривая баланса',
  isLoading: false,
  noDataMessage: 'Запустите бектест для просмотра кривой баланса',
  color: 'rgb(59, 130, 246)',
  fillColor: 'rgba(59, 130, 246, 0.1)'
});

const chartCanvas = ref<HTMLCanvasElement | null>(null);
const chartInstance = ref<Chart | null>(null);

const hasData = computed(() => {
  return props.equityData && props.equityData.length > 0;
});

const equityStats = computed(() => {
  if (!hasData.value) return null;
  
  const data = props.equityData!;
  const capitalValues = data.map(point => point.capital);
  
  const maxEquity = Math.max(...capitalValues);
  const minEquity = Math.min(...capitalValues);
  const initialCapital = data[0]?.capital || 0;
  const finalCapital = data[data.length - 1]?.capital || 0;
  
  const totalGrowth = initialCapital > 0 ? ((finalCapital - initialCapital) / initialCapital) * 100 : 0;
  
  // Расчет волатильности (стандартное отклонение доходностей)
  const returns = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i - 1].capital > 0) {
      const ret = (data[i].capital - data[i - 1].capital) / data[i - 1].capital;
      returns.push(ret);
    }
  }
  
  const avgReturn = returns.length > 0 ? returns.reduce((sum, ret) => sum + ret, 0) / returns.length : 0;
  const variance = returns.length > 0 ? returns.reduce((sum, ret) => sum + Math.pow(ret - avgReturn, 2), 0) / returns.length : 0;
  const volatility = Math.sqrt(variance) * Math.sqrt(252) * 100; // Annualized volatility
  
  return {
    maxEquity,
    minEquity,
    totalGrowth,
    volatility: isNaN(volatility) ? 0 : volatility
  };
});

const createChart = async () => {
  await nextTick();
  
  if (!chartCanvas.value || !hasData.value) return;
  
  // Уничтожаем существующий график
  if (chartInstance.value) {
    chartInstance.value.destroy();
  }
  
  const ctx = chartCanvas.value.getContext('2d');
  if (!ctx) return;
  
  const data = props.equityData!.map(point => ({
    x: point.timestamp,
    y: point.capital
  }));
  
  chartInstance.value = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [{
        label: 'Баланс ($)',
        data: data,
        borderColor: props.color,
        backgroundColor: props.fillColor,
        borderWidth: 2,
        fill: true,
        tension: 0.1,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointBackgroundColor: props.color,
        pointBorderColor: '#ffffff',
        pointBorderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        intersect: false,
        mode: 'index'
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          titleColor: '#fff',
          bodyColor: '#fff',
          borderColor: props.color,
          borderWidth: 1,
          callbacks: {
            title: (context: any) => {
              return new Date(context[0].parsed.x).toLocaleDateString('ru-RU', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              });
            },
            label: (context: any) => {
              return `Баланс: $${context.parsed.y.toLocaleString()}`;
            }
          }
        }
      },
      scales: {
        x: {
          type: 'time',
          time: {
            displayFormats: {
              hour: 'HH:mm',
              day: 'dd MMM',
              month: 'MMM yyyy'
            }
          },
          title: {
            display: true,
            text: 'Время'
          },
          grid: {
            color: 'rgba(0, 0, 0, 0.1)'
          }
        },
        y: {
          title: {
            display: true,
            text: 'Баланс ($)'
          },
          grid: {
            color: 'rgba(0, 0, 0, 0.1)'
          },
          ticks: {
            callback: function(value: any) {
              return '$' + value.toLocaleString();
            }
          }
        }
      }
    }
  });
};

const refreshChart = () => {
  createChart();
};

const downloadChart = () => {
  if (chartInstance.value) {
    const url = chartInstance.value.toBase64Image('image/png', 1);
    const link = document.createElement('a');
    link.download = `equity-curve-${Date.now()}.png`;
    link.href = url;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
};

watch(() => props.equityData, () => {
  if (hasData.value) {
    createChart();
  }
}, { deep: true });

watch(() => props.isLoading, (newVal) => {
  if (!newVal && hasData.value) {
    setTimeout(createChart, 100);
  }
});

onMounted(() => {
  if (hasData.value) {
    createChart();
  }
});

onUnmounted(() => {
  if (chartInstance.value) {
    chartInstance.value.destroy();
  }
});
</script>

<style scoped>
.equity-curve-chart {
  /* Дополнительные стили при необходимости */
}

.chart-container {
  position: relative;
}

:deep(.chart-container canvas) {
  border-radius: 8px;
}
</style> 