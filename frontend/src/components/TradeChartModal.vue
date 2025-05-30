<template>
  <Dialog 
    v-model:visible="isVisible" 
    modal 
    :header="dialogTitle"
    :style="{ width: '90vw', maxWidth: '1200px' }"
    class="trade-chart-modal"
    @hide="onClose"
  >
    <template #header>
      <div class="flex items-center">
        <i class="pi pi-chart-line mr-2 text-blue-600"></i>
        <span>{{ dialogTitle }}</span>
      </div>
    </template>

    <div v-if="trade" class="space-y-6">
      <!-- Информация о сделке -->
      <div class="bg-gray-50 rounded-lg p-4">
        <h4 class="text-lg font-semibold text-gray-900 mb-3">Информация о сделке</h4>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <div class="text-sm text-gray-600">Направление</div>
            <div class="font-semibold" :class="trade.direction === 'long' ? 'text-green-600' : 'text-red-600'">
              {{ trade.direction?.toUpperCase() }}
            </div>
          </div>
          <div>
            <div class="text-sm text-gray-600">Размер позиции</div>
            <div class="font-semibold text-gray-800">{{ trade.size?.toFixed(4) }}</div>
          </div>
          <div>
            <div class="text-sm text-gray-600">PnL</div>
            <div class="font-semibold" :class="(trade.pnl || 0) >= 0 ? 'text-green-600' : 'text-red-600'">
              ${{ (trade.pnl || 0).toFixed(2) }}
            </div>
          </div>
          <div>
            <div class="text-sm text-gray-600">Причина выхода</div>
            <div class="font-semibold text-gray-800">{{ trade.exitReason || 'Активная' }}</div>
          </div>
        </div>
        
        <div class="grid grid-cols-2 md:grid-cols-3 gap-4 mt-4">
          <div>
            <div class="text-sm text-gray-600">Цена входа</div>
            <div class="font-semibold text-blue-600">${{ trade.entryPrice?.toFixed(4) }}</div>
          </div>
          <div v-if="trade.exitPrice">
            <div class="text-sm text-gray-600">Цена выхода</div>
            <div class="font-semibold text-blue-600">${{ trade.exitPrice?.toFixed(4) }}</div>
          </div>
          <div v-if="trade.stopLoss">
            <div class="text-sm text-gray-600">Stop Loss</div>
            <div class="font-semibold text-red-600">${{ trade.stopLoss?.toFixed(4) }}</div>
          </div>
          <div v-if="trade.takeProfit">
            <div class="text-sm text-gray-600">Take Profit</div>
            <div class="font-semibold text-green-600">${{ trade.takeProfit?.toFixed(4) }}</div>
          </div>
          <div>
            <div class="text-sm text-gray-600">Время входа</div>
            <div class="font-semibold text-gray-800">{{ formatDate(trade.entryTimestamp) }}</div>
          </div>
          <div v-if="trade.exitTimestamp">
            <div class="text-sm text-gray-600">Время выхода</div>
            <div class="font-semibold text-gray-800">{{ formatDate(trade.exitTimestamp) }}</div>
          </div>
        </div>
      </div>

      <!-- TradingView График -->
      <div class="bg-white rounded-lg border border-gray-200">
        <div class="flex items-center justify-between p-4 border-b border-gray-200">
          <h4 class="text-lg font-semibold text-gray-900">График сделки (TradingView)</h4>
          <div class="flex items-center space-x-2">
            <Button 
              v-if="chartInstance" 
              icon="pi pi-download" 
              class="p-button-text p-button-sm" 
              @click="downloadChart"
              v-tooltip.bottom="'Скачать снимок'"
            />
            <Button 
              icon="pi pi-refresh" 
              class="p-button-text p-button-sm" 
              @click="refreshChart"
              v-tooltip.bottom="'Обновить график'"
            />
            <Dropdown
              v-model="selectedChartType"
              :options="chartTypeOptions"
              option-label="label"
              option-value="value"
              placeholder="Тип графика"
              class="p-button-text p-button-sm"
              @change="changeChartType"
            />
          </div>
        </div>
        
        <div class="p-4">
          <div v-if="isLoadingChart" class="flex justify-center items-center py-12">
            <ProgressSpinner animationDuration=".8s" strokeWidth="4"/>
            <span class="ml-3 text-gray-600">Загрузка TradingView графика...</span>
          </div>
          
          <div v-else-if="hasChartData" class="chart-container" ref="chartContainer" style="height: 500px; border-radius: 8px;"></div>
          
          <div v-else class="text-center py-12">
            <i class="pi pi-chart-line text-6xl text-gray-300 mb-4"></i>
            <h4 class="text-lg text-gray-500 mb-2">TradingView График сделки</h4>
            <p class="text-gray-400">Данные графика недоступны для этой сделки</p>
          </div>
        </div>
      </div>

      <!-- Улучшенная легенда для TradingView -->
      <div class="bg-gray-50 rounded-lg p-4">
        <h4 class="text-lg font-semibold text-gray-900 mb-3">Легенда TradingView</h4>
        <div class="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div class="flex items-center">
            <div class="w-4 h-4 bg-gray-400 border border-gray-600 mr-2"></div>
            <span class="text-sm text-gray-700">Свечи OHLC</span>
          </div>
          <div class="flex items-center">
            <div class="w-4 h-4 bg-green-500 rounded-full mr-2"></div>
            <span class="text-sm text-gray-700">Вход в позицию</span>
          </div>
          <div class="flex items-center">
            <div class="w-4 h-4 bg-red-500 rounded-full mr-2"></div>
            <span class="text-sm text-gray-700">Выход из позиции</span>
          </div>
          <div class="flex items-center">
            <div class="w-4 h-1 bg-red-400 mr-2"></div>
            <span class="text-sm text-gray-700">Stop Loss</span>
          </div>
          <div class="flex items-center">
            <div class="w-4 h-1 bg-green-400 mr-2"></div>
            <span class="text-sm text-gray-700">Take Profit</span>
          </div>
          <div class="flex items-center">
            <div class="w-4 h-4 bg-blue-500 mr-2" style="opacity: 0.3;"></div>
            <span class="text-sm text-gray-700">Volume Profile</span>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex justify-between items-center w-full">
        <div class="text-sm text-gray-500">
          <i class="pi pi-info-circle mr-1"></i>
          Powered by TradingView Lightweight Charts
        </div>
        <Button label="Закрыть" icon="pi pi-times" @click="onClose" class="p-button-text" />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onUnmounted } from 'vue';
import { 
  createChart, 
  ColorType, 
  LineStyle, 
  CrosshairMode,
  CandlestickSeries,
  LineSeries,
  AreaSeries,
  HistogramSeries
} from 'lightweight-charts';
import type { IChartApi, ISeriesApi, Time } from 'lightweight-charts';
import Dialog from 'primevue/dialog';
import Button from 'primevue/button';
import ProgressSpinner from 'primevue/progressspinner';
import Dropdown from 'primevue/dropdown';
import type { Trade } from '@/types/strategy';

interface CandleData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface Props {
  visible: boolean;
  trade: Trade | null;
  candleData?: CandleData[] | null;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:visible': [value: boolean];
  'close': [];
}>();

// TradingView Chart refs
const chartContainer = ref<HTMLElement | null>(null);
const chartInstance = ref<IChartApi | null>(null);
const candlestickSeries = ref<ISeriesApi<'Candlestick'> | null>(null);
const volumeSeries = ref<ISeriesApi<'Histogram'> | null>(null);
const isLoadingChart = ref(false);

// Chart type selection
const selectedChartType = ref<'candlestick' | 'line' | 'area'>('candlestick');
const chartTypeOptions = [
  { label: 'Свечи', value: 'candlestick' },
  { label: 'Линия', value: 'line' },
  { label: 'Область', value: 'area' }
];

const isVisible = computed({
  get: () => props.visible,
  set: (value) => emit('update:visible', value)
});

const dialogTitle = computed(() => {
  if (!props.trade) return 'TradingView График сделки';
  return `TradingView График: ${props.trade.pair || 'Unknown'} - ${props.trade.direction?.toUpperCase()}`;
});

const hasChartData = computed(() => {
  return props.candleData && props.candleData.length > 0;
});

const createTradingViewChart = async () => {
  await nextTick();
  
  if (!chartContainer.value || !hasChartData.value || !props.trade) return;
  
  // Уничтожаем существующий график
  if (chartInstance.value) {
    chartInstance.value.remove();
  }
  
  isLoadingChart.value = true;
  
  try {
    // Создаем TradingView chart
    chartInstance.value = createChart(chartContainer.value, {
      width: chartContainer.value.clientWidth,
      height: 500,
      layout: {
        background: { type: ColorType.Solid, color: '#ffffff' },
        textColor: '#333',
      },
      grid: {
        vertLines: { color: '#e1e5e9' },
        horzLines: { color: '#e1e5e9' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          width: 1,
          color: '#9598A1',
          style: LineStyle.Dashed,
        },
        horzLine: {
          width: 1,
          color: '#9598A1',
          style: LineStyle.Dashed,
        },
      },
      rightPriceScale: {
        borderColor: '#cccccc',
        scaleMargins: {
          top: 0.1,
          bottom: 0.2,
        },
      },
      timeScale: {
        borderColor: '#cccccc',
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
    });

    // Подготавливаем данные свечей для TradingView
    const candleDataFormatted = props.candleData!.map(candle => ({
      time: Math.floor(candle.timestamp / 1000) as Time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }));

    // Создаем основную серию (свечи, линия или область)
    let mainSeries: ISeriesApi<any>;
    
    if (selectedChartType.value === 'candlestick') {
      mainSeries = chartInstance.value.addSeries(CandlestickSeries, {
        upColor: '#00C851',
        downColor: '#ff4444',
        borderDownColor: '#ff4444',
        borderUpColor: '#00C851',
        wickDownColor: '#ff4444',
        wickUpColor: '#00C851',
      });
    } else if (selectedChartType.value === 'line') {
      mainSeries = chartInstance.value.addSeries(LineSeries, {
        color: '#2962FF',
        lineWidth: 2,
      });
      // Для линейного графика используем только цены закрытия
      const lineData = candleDataFormatted.map(candle => ({
        time: candle.time,
        value: candle.close,
      }));
      mainSeries.setData(lineData);
    } else {
      mainSeries = chartInstance.value.addSeries(AreaSeries, {
        topColor: 'rgba(41, 98, 255, 0.4)',
        bottomColor: 'rgba(41, 98, 255, 0.0)',
        lineColor: '#2962FF',
        lineWidth: 2,
      });
      // Для области используем только цены закрытия
      const areaData = candleDataFormatted.map(candle => ({
        time: candle.time,
        value: candle.close,
      }));
      mainSeries.setData(areaData);
    }

    if (selectedChartType.value === 'candlestick') {
      mainSeries.setData(candleDataFormatted);
    }

    candlestickSeries.value = mainSeries;

    // Добавляем Volume серию если есть данные
    if (props.candleData!.some(candle => candle.volume && candle.volume > 0)) {
      volumeSeries.value = chartInstance.value.addSeries(HistogramSeries, {
        color: '#26a69a',
        priceFormat: {
          type: 'volume',
        },
        priceScaleId: '',
      });

      const volumeData = props.candleData!
        .filter(candle => candle.volume && candle.volume > 0)
        .map(candle => ({
          time: Math.floor(candle.timestamp / 1000) as Time,
          value: candle.volume!,
          color: candle.close >= candle.open ? '#26a69a40' : '#ef534040',
        }));

      volumeSeries.value?.setData(volumeData);
    }

    // Добавляем маркеры сделки
    addTradeMarkers(mainSeries);

    // Добавляем линии Stop Loss и Take Profit
    addTradeLevels();

    // Подгоняем масштаб
    chartInstance.value.timeScale().fitContent();

    isLoadingChart.value = false;
  } catch (error) {
    console.error('Error creating TradingView chart:', error);
    isLoadingChart.value = false;
  }
};

const addTradeMarkers = (series: ISeriesApi<any>) => {
  if (!props.trade) return;

  const markers: any[] = [];

  // Маркер входа
  if (props.trade.entryTimestamp && props.trade.entryPrice) {
    markers.push({
      time: Math.floor(props.trade.entryTimestamp / 1000) as Time,
      position: 'belowBar',
      color: props.trade.direction === 'long' ? '#00C851' : '#ff4444',
      shape: 'arrowUp',
      text: `${props.trade.direction?.toUpperCase()} @ $${props.trade.entryPrice.toFixed(4)}`,
      size: 2,
    });
  }

  // Маркер выхода
  if (props.trade.exitTimestamp && props.trade.exitPrice) {
    markers.push({
      time: Math.floor(props.trade.exitTimestamp / 1000) as Time,
      position: 'aboveBar',
      color: (props.trade.pnl || 0) >= 0 ? '#00C851' : '#ff4444',
      shape: 'arrowDown',
      text: `EXIT @ $${props.trade.exitPrice.toFixed(4)} | PnL: $${(props.trade.pnl || 0).toFixed(2)}`,
      size: 2,
    });
  }

  // В API v5.0.7 используется setMarkers
  if (markers.length > 0) {
    try {
      (series as any).setMarkers(markers);
    } catch (error) {
      console.warn('Markers not supported in this version:', error);
    }
  }
};

const addTradeLevels = () => {
  if (!chartInstance.value || !props.trade) return;

  // Stop Loss линия
  if (props.trade.stopLoss) {
    const stopLossLine = chartInstance.value.addSeries(LineSeries, {
      color: '#ff4444',
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      title: `SL: $${props.trade.stopLoss.toFixed(4)}`,
    });

    const timeRange = props.candleData!;
    const startTime = Math.floor(timeRange[0].timestamp / 1000) as Time;
    const endTime = Math.floor(timeRange[timeRange.length - 1].timestamp / 1000) as Time;

    stopLossLine.setData([
      { time: startTime, value: props.trade.stopLoss },
      { time: endTime, value: props.trade.stopLoss },
    ]);
  }

  // Take Profit линия
  if (props.trade.takeProfit) {
    const takeProfitLine = chartInstance.value.addSeries(LineSeries, {
      color: '#00C851',
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      title: `TP: $${props.trade.takeProfit.toFixed(4)}`,
    });

    const timeRange = props.candleData!;
    const startTime = Math.floor(timeRange[0].timestamp / 1000) as Time;
    const endTime = Math.floor(timeRange[timeRange.length - 1].timestamp / 1000) as Time;

    takeProfitLine.setData([
      { time: startTime, value: props.trade.takeProfit },
      { time: endTime, value: props.trade.takeProfit },
    ]);
  }
};

const changeChartType = () => {
  if (hasChartData.value) {
    createTradingViewChart();
  }
};

const refreshChart = () => {
  createTradingViewChart();
};

const downloadChart = () => {
  if (chartInstance.value) {
    // TradingView не поддерживает прямой экспорт, но можно использовать html2canvas
    try {
      const canvas = chartContainer.value?.querySelector('canvas');
      if (canvas) {
        const url = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        const tradeName = props.trade ? `${props.trade.pair}-${props.trade.direction}` : 'trade';
        link.download = `tradingview-chart-${tradeName}-${Date.now()}.png`;
        link.href = url;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch (error) {
      console.error('Error downloading chart:', error);
    }
  }
};

const formatDate = (timestamp: number | undefined) => {
  if (!timestamp) return 'Неизвестно';
  return new Date(timestamp).toLocaleString('ru-RU', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const onClose = () => {
  emit('close');
  emit('update:visible', false);
};

// Обработка изменения размера окна
const handleResize = () => {
  if (chartInstance.value && chartContainer.value) {
    chartInstance.value.applyOptions({
      width: chartContainer.value.clientWidth,
      height: 500,
    });
  }
};

watch(() => props.visible, (newVal) => {
  if (newVal && hasChartData.value) {
    setTimeout(() => {
      createTradingViewChart();
      window.addEventListener('resize', handleResize);
    }, 300); // Небольшая задержка для анимации модального окна
  } else {
    window.removeEventListener('resize', handleResize);
  }
});

watch(() => props.candleData, () => {
  if (props.visible && hasChartData.value) {
    createTradingViewChart();
  }
}, { deep: true });

onUnmounted(() => {
  if (chartInstance.value) {
    chartInstance.value.remove();
  }
  window.removeEventListener('resize', handleResize);
});
</script>

<style scoped>
.trade-chart-modal :deep(.p-dialog-content) {
  padding: 1.5rem;
}

.chart-container {
  position: relative;
  border-radius: 8px;
  overflow: hidden;
}

/* TradingView специфичные стили */
:deep(.tv-lightweight-charts) {
  border-radius: 8px !important;
}

/* Стили для dropdown */
:deep(.p-dropdown) {
  min-width: 120px;
}
</style> 