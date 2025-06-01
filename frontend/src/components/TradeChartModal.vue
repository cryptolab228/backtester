<template>
  <Dialog 
    v-model:visible="isVisible" 
    modal 
    :header="dialogTitle"
    :style="{ width: '95vw', maxWidth: '1400px' }"
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
          <div v-if="riskRewardRatio !== 'N/A'">
            <div class="text-sm text-gray-600">Risk/Reward</div>
            <div class="font-semibold text-purple-600">{{ riskRewardRatio }}</div>
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
          <h4 class="text-lg font-semibold text-gray-900">График сделки (Полный диапазон)</h4>
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
            <span class="ml-3 text-gray-600">Загрузка графика сделки...</span>
          </div>
          
          <div v-else-if="hasChartData" class="chart-container" ref="chartContainer" style="height: 600px; border-radius: 8px;"></div>
          
          <div v-else class="text-center py-12">
            <i class="pi pi-chart-line text-6xl text-gray-300 mb-4"></i>
            <h4 class="text-lg text-gray-500 mb-2">График сделки</h4>
            <p class="text-gray-400">Данные графика недоступны для этой сделки</p>
          </div>
        </div>
      </div>

      <!-- Улучшенная легенда -->
      <div class="bg-gray-50 rounded-lg p-4">
        <h4 class="text-lg font-semibold text-gray-900 mb-3">Легенда графика</h4>
        <div class="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div class="flex items-center">
            <div class="w-4 h-4 bg-gray-400 border border-gray-600 mr-2"></div>
            <span class="text-sm text-gray-700">Свечи OHLC</span>
          </div>
          <div class="flex items-center">
            <div class="w-4 h-4 bg-green-500 rounded-full mr-2"></div>
            <span class="text-sm text-gray-700">Точка входа (Entry)</span>
          </div>
          <div class="flex items-center">
            <div class="w-4 h-4 bg-red-500 rounded-full mr-2"></div>
            <span class="text-sm text-gray-700">Точка выхода (Exit)</span>
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
          Powered by TradingView Lightweight Charts v{{ lightweightChartsVersion }}
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
  HistogramSeries,
  createSeriesMarkers
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
const stopLossLineSeries = ref<ISeriesApi<'Line'> | null>(null);
const takeProfitLineSeries = ref<ISeriesApi<'Line'> | null>(null);
const seriesMarkersInstance = ref<any | null>(null);
const isLoadingChart = ref(false);
const lightweightChartsVersion = ref('5.x');

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
  if (!props.trade) return 'График сделки';
  return `График: ${props.trade.pair || 'Unknown'} - ${props.trade.direction?.toUpperCase()} - ${formatDate(props.trade.entryTimestamp)}`;
});

const hasChartData = computed(() => {
  return props.candleData && props.candleData.length > 0;
});

const riskRewardRatio = computed(() => {
  if (!props.trade || !props.trade.entryPrice || !props.trade.stopLoss || !props.trade.takeProfit) {
    return 'N/A';
  }
  
  const risk = Math.abs(props.trade.entryPrice - props.trade.stopLoss);
  const reward = Math.abs(props.trade.takeProfit - props.trade.entryPrice);
  
  if (risk === 0) return 'N/A';
  
  const ratio = reward / risk;
  return `1:${ratio.toFixed(2)}`;
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
    console.log(`[TradeChart] Starting chart creation with ${props.candleData!.length} original candles`);

    // КАРДИНАЛЬНАЯ ОЧИСТКА ДАННЫХ ОТ ДУБЛИКАТОВ
    const rawCandles = props.candleData!;
    const cleanedCandles: any[] = [];
    const usedTimestamps = new Set<number>();

    // Проходим по данным и удаляем дубликаты
    rawCandles.forEach((candle, index) => {
      const timestamp = Math.floor(candle.timestamp / 1000);
      
      if (!usedTimestamps.has(timestamp)) {
        usedTimestamps.add(timestamp);
        cleanedCandles.push({
          time: timestamp as Time,
          open: Number(candle.open),
          high: Number(candle.high),
          low: Number(candle.low),
          close: Number(candle.close),
          volume: Number(candle.volume || 0),
          originalTimestamp: candle.timestamp
        });
      } else {
        console.warn(`[TradeChart] Skipping duplicate timestamp: ${timestamp} at index ${index}`);
      }
    });

    // Сортируем по времени
    cleanedCandles.sort((a, b) => Number(a.time) - Number(b.time));

    // ДОПОЛНИТЕЛЬНАЯ ПРОВЕРКА - удаляем любые нарушения последовательности
    const finalCandles: any[] = [];
    let lastTime = 0;

    cleanedCandles.forEach((candle, index) => {
      const currentTime = Number(candle.time);
      if (currentTime > lastTime) {
        finalCandles.push(candle);
        lastTime = currentTime;
      } else {
        console.warn(`[TradeChart] Removing candle with invalid time sequence: ${currentTime} <= ${lastTime} at index ${index}`);
      }
    });

    console.log(`[TradeChart] Data cleaned: ${rawCandles.length} -> ${cleanedCandles.length} -> ${finalCandles.length} candles`);

    if (finalCandles.length === 0) {
      throw new Error('No valid candle data after cleaning');
    }

    // Подготавливаем данные для TradingView
    const candleDataFormatted = finalCandles.map(candle => ({
      time: candle.time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }));

    // Создаем TradingView chart
    chartInstance.value = createChart(chartContainer.value, {
      width: chartContainer.value.clientWidth,
      height: 600,
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
          top: 0.05,
          bottom: 0.15,
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

    // Создаем основную серию свечей
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
      
      // БЕЗОПАСНАЯ УСТАНОВКА ДАННЫХ
      try {
        mainSeries.setData(candleDataFormatted);
        console.log(`[TradeChart] Successfully set ${candleDataFormatted.length} candles to main series`);
      } catch (dataError) {
        console.error('[TradeChart] Error setting candle data:', dataError);
        throw dataError;
      }
    } else if (selectedChartType.value === 'line') {
      mainSeries = chartInstance.value.addSeries(LineSeries, {
        color: '#2962FF',
        lineWidth: 2,
      });
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
      const areaData = candleDataFormatted.map(candle => ({
        time: candle.time,
        value: candle.close,
      }));
      mainSeries.setData(areaData);
    }

    candlestickSeries.value = mainSeries;

    // Добавляем Volume серию если есть данные
    const validVolumeCandles = finalCandles.filter(candle => candle.volume && candle.volume > 0);
    if (validVolumeCandles.length > 0) {
      try {
        volumeSeries.value = chartInstance.value.addSeries(HistogramSeries, {
          color: '#26a69a',
          priceFormat: {
            type: 'volume',
          },
          priceScaleId: '',
        });

        const volumeData = validVolumeCandles.map(candle => ({
          time: candle.time,
          value: candle.volume,
          color: candle.close >= candle.open ? '#26a69a40' : '#ef534040',
        }));

        volumeSeries.value?.setData(volumeData);
        console.log(`[TradeChart] Volume series added with ${volumeData.length} data points`);
      } catch (volumeError) {
        console.warn('[TradeChart] Error adding volume series:', volumeError);
      }
    }

    // Добавляем линии Stop Loss и Take Profit
    addTradeLevelsWithRiskReward(finalCandles);

    // ПРАВИЛЬНЫЙ МЕТОД - стрелочки через createSeriesMarkers API v5
    addTradeArrowsWithLines(finalCandles);

    // Подгоняем масштаб для отображения полного диапазона
    chartInstance.value.timeScale().fitContent();

    console.log('[TradeChart] Chart creation completed successfully');
    isLoadingChart.value = false;
  } catch (error) {
    console.error('Error creating TradingView chart:', error);
    isLoadingChart.value = false;
    
    // Показываем пользователю конкретную ошибку
    if (error instanceof Error) {
      console.error(`[TradeChart] Specific error: ${error.message}`);
    }
  }
};

// ПРАВИЛЬНЫЙ МЕТОД - стрелочки через createSeriesMarkers API v5
const addTradeArrowsWithLines = (cleanedCandles: any[]) => {
  if (!chartInstance.value || !props.trade || cleanedCandles.length === 0 || !candlestickSeries.value) return;

  try {
    console.log('[TradeChart] Adding trade arrows with createSeriesMarkers method');

    const markers: any[] = [];

    // Стрелочка входа
    if (props.trade.entryTimestamp && props.trade.entryPrice) {
      const entryTime = Math.floor(props.trade.entryTimestamp / 1000) as Time;
      
      console.log(`[TradeChart] Adding entry marker at time ${entryTime}, price ${props.trade.entryPrice}`);

      markers.push({
        time: entryTime,
        position: 'belowBar',
        color: props.trade.direction === 'long' ? '#00C851' : '#ff4444',
        shape: 'arrowUp',
        text: `ENTRY: $${props.trade.entryPrice.toFixed(4)}`,
        size: 2,
      });
    }

    // Стрелочка выхода
    if (props.trade.exitTimestamp && props.trade.exitPrice) {
      const exitTime = Math.floor(props.trade.exitTimestamp / 1000) as Time;
      const pnlText = (props.trade.pnl || 0) >= 0 ? `+$${(props.trade.pnl || 0).toFixed(2)}` : `-$${Math.abs(props.trade.pnl || 0).toFixed(2)}`;
      
      console.log(`[TradeChart] Adding exit marker at time ${exitTime}, price ${props.trade.exitPrice}`);

      markers.push({
        time: exitTime,
        position: 'aboveBar',
        color: (props.trade.pnl || 0) >= 0 ? '#00C851' : '#ff4444',
        shape: 'arrowDown',
        text: `EXIT: $${props.trade.exitPrice.toFixed(4)} | ${pnlText}`,
        size: 2,
      });
    }

    // Используем правильный API для v5
    if (markers.length > 0) {
      try {
        console.log(`[TradeChart] Creating series markers with ${markers.length} markers`);
        seriesMarkersInstance.value = createSeriesMarkers(candlestickSeries.value, markers);
        console.log('[TradeChart] Series markers created successfully');
      } catch (markerError) {
        console.error('[TradeChart] Error creating series markers:', markerError);
        // Fallback к горизонтальным линиям если маркеры не работают
        addTradeArrowsAsFallback(cleanedCandles);
      }
    }

    console.log('[TradeChart] Trade arrows added successfully');
  } catch (error) {
    console.error('[TradeChart] Error adding trade arrows:', error);
    // Fallback к горизонтальным линиям
    addTradeArrowsAsFallback(cleanedCandles);
  }
};

// Fallback метод с горизонтальными линиями
const addTradeArrowsAsFallback = (cleanedCandles: any[]) => {
  if (!chartInstance.value || !props.trade || cleanedCandles.length === 0) return;

  try {
    console.log('[TradeChart] Using fallback method with horizontal lines');

    // Добавляем горизонтальную линию входа
    if (props.trade.entryTimestamp && props.trade.entryPrice) {
      const entryPriceLine = chartInstance.value.addSeries(LineSeries, {
        color: props.trade.direction === 'long' ? '#00C851' : '#ff4444',
        lineWidth: 2,
        lineStyle: LineStyle.Dotted,
        priceLineVisible: false,
        lastValueVisible: false,
        title: `Entry: $${props.trade.entryPrice.toFixed(4)}`,
      });

      const firstTime = cleanedCandles[0].time;
      const lastTime = cleanedCandles[cleanedCandles.length - 1].time;
      
      entryPriceLine.setData([
        { time: firstTime, value: props.trade.entryPrice },
        { time: lastTime, value: props.trade.entryPrice },
      ]);
    }

    // Добавляем горизонтальную линию выхода
    if (props.trade.exitTimestamp && props.trade.exitPrice) {
      const exitPriceLine = chartInstance.value.addSeries(LineSeries, {
        color: (props.trade.pnl || 0) >= 0 ? '#00C851' : '#ff4444',
        lineWidth: 2,
        lineStyle: LineStyle.Dotted,
        priceLineVisible: false,
        lastValueVisible: false,
        title: `Exit: $${props.trade.exitPrice.toFixed(4)}`,
      });

      const firstTime = cleanedCandles[0].time;
      const lastTime = cleanedCandles[cleanedCandles.length - 1].time;
      
      exitPriceLine.setData([
        { time: firstTime, value: props.trade.exitPrice },
        { time: lastTime, value: props.trade.exitPrice },
      ]);
    }

    console.log('[TradeChart] Fallback arrows added successfully');
  } catch (fallbackError) {
    console.error('[TradeChart] Error in fallback method:', fallbackError);
  }
};

// Обновленная функция для TP/SL с Risk/Reward
const addTradeLevelsWithRiskReward = (cleanedCandles: any[]) => {
  if (!chartInstance.value || !props.trade || cleanedCandles.length === 0) return;

  try {
    const startTime = cleanedCandles[0].time;
    const endTime = cleanedCandles[cleanedCandles.length - 1].time;

    console.log('[TradeChart] Adding trade levels (TP/SL)');

    // Вычисляем Risk/Reward ratio
    let riskRewardRatio = 'N/A';
    if (props.trade.entryPrice && props.trade.stopLoss && props.trade.takeProfit) {
      const risk = Math.abs(props.trade.entryPrice - props.trade.stopLoss);
      const reward = Math.abs(props.trade.takeProfit - props.trade.entryPrice);
      if (risk > 0) {
        const ratio = reward / risk;
        riskRewardRatio = `1:${ratio.toFixed(2)}`;
      }
    }

    // Stop Loss линия
    if (props.trade.stopLoss) {
      try {
        stopLossLineSeries.value = chartInstance.value.addSeries(LineSeries, {
          color: '#ff4444',
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          title: `Stop Loss: $${props.trade.stopLoss.toFixed(4)}`,
          priceLineVisible: true,
          lastValueVisible: true,
        });

        stopLossLineSeries.value.setData([
          { time: startTime, value: props.trade.stopLoss },
          { time: endTime, value: props.trade.stopLoss },
        ]);
        
        console.log(`[TradeChart] Stop Loss line added at ${props.trade.stopLoss}`);
      } catch (slError) {
        console.warn('[TradeChart] Error adding Stop Loss line:', slError);
      }
    }

    // Take Profit линия
    if (props.trade.takeProfit) {
      try {
        takeProfitLineSeries.value = chartInstance.value.addSeries(LineSeries, {
          color: '#00C851',
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          title: `Take Profit: $${props.trade.takeProfit.toFixed(4)} | R:R ${riskRewardRatio}`,
          priceLineVisible: true,
          lastValueVisible: true,
        });

        takeProfitLineSeries.value.setData([
          { time: startTime, value: props.trade.takeProfit },
          { time: endTime, value: props.trade.takeProfit },
        ]);
        
        console.log(`[TradeChart] Take Profit line added at ${props.trade.takeProfit} with R:R ${riskRewardRatio}`);
      } catch (tpError) {
        console.warn('[TradeChart] Error adding Take Profit line:', tpError);
      }
    }

    console.log(`[TradeChart] Trade levels completed with Risk/Reward ratio: ${riskRewardRatio}`);
  } catch (error) {
    console.error('[TradeChart] Error adding trade levels:', error);
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
    try {
      const canvas = chartContainer.value?.querySelector('canvas');
      if (canvas) {
        const url = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        const tradeName = props.trade ? `${props.trade.pair}-${props.trade.direction}` : 'trade';
        const timestamp = props.trade?.entryTimestamp ? new Date(props.trade.entryTimestamp).toISOString().slice(0, 19).replace(/[:-]/g, '') : Date.now();
        link.download = `chart-${tradeName}-${timestamp}.png`;
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
      height: 600,
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
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

/* TradingView специфичные стили */
:deep(.tv-lightweight-charts) {
  border-radius: 8px !important;
}

/* Стили для dropdown */
:deep(.p-dropdown) {
  min-width: 120px;
}

/* Улучшенные стили для модального окна */
.trade-chart-modal :deep(.p-dialog) {
  max-height: 95vh;
  overflow-y: auto;
}

.trade-chart-modal :deep(.p-dialog-header) {
  border-bottom: 1px solid #e5e7eb;
  background: #f9fafb;
}

.trade-chart-modal :deep(.p-dialog-footer) {
  border-top: 1px solid #e5e7eb;
  background: #f9fafb;
}
</style> 