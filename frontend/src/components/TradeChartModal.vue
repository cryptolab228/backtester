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
          <h4 class="text-lg font-semibold text-gray-900">
            График торговой пары
            <span v-if="isBacktestTimeframe" class="text-sm text-green-600 font-normal ml-2">(Таймфрейм бектеста)</span>
            <span v-else class="text-sm text-orange-600 font-normal ml-2">(Альтернативный таймфрейм)</span>
            <!-- НОВОЕ: Индикатор режима производительности -->
            <span v-if="isPerformanceMode" class="text-xs text-blue-600 font-normal ml-2 bg-blue-100 px-2 py-1 rounded">
              ⚡ Режим производительности
            </span>
          </h4>
          <div class="flex items-center space-x-2">
            <!-- Выбор таймфрейма -->
            <Select
              v-model="selectedTimeframe"
              :options="availableTimeframes"
              option-label="label"
              option-value="value"
              placeholder="Таймфрейм"
              class="timeframe-dropdown"
              @change="onTimeframeChange"
            />
            
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
            <Button 
              icon="pi pi-cloud-download" 
              class="p-button-text p-button-sm p-button-info" 
              @click="fetchCurrentTimeframeData"
              v-tooltip.bottom="'Загрузить данные для текущего таймфрейма'"
              :loading="isLoadingData"
            />
            <Select
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
            <p class="text-gray-400 mb-4">
              Данные для таймфрейма {{ selectedTimeframe }} недоступны
              <span v-if="!isBacktestTimeframe" class="block text-sm mt-1">
                (Таймфрейм бектеста: {{ backtestTimeframe }})
              </span>
            </p>
            
            <!-- Блок с действиями при отсутствии данных -->
            <div class="flex flex-col items-center space-y-3">
              <div class="flex space-x-2">
                <Button 
                  :label="`Загрузить данные ${selectedTimeframe}`" 
                  icon="pi pi-cloud-download" 
                  class="p-button-sm p-button-outlined" 
                  @click="fetchCurrentTimeframeData"
                  :loading="isLoadingData"
                />
                <Button 
                  v-if="!isBacktestTimeframe"
                  :label="`Переключиться на ${backtestTimeframe}`" 
                  icon="pi pi-sync" 
                  class="p-button-sm p-button-info" 
                  @click="switchToBacktestTimeframe"
                />
              </div>
              
              <!-- Быстрые кнопки для популярных таймфреймов -->
              <div class="flex space-x-2 mt-3 quick-timeframe-buttons">
                <span class="text-xs text-gray-500 self-center">Быстрый доступ:</span>
                <Button 
                  v-for="tf in ['5m', '15m', '1h', '4h']" 
                  :key="tf"
                  :label="tf" 
                  class="p-button-sm p-button-text" 
                  @click="switchToTimeframe(tf)"
                  :class="{ 'p-button-secondary': tf === selectedTimeframe }"
                />
              </div>
            </div>
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
import { ref, computed, watch, onUnmounted } from 'vue';
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
import Select from 'primevue/select';
import type { Trade } from '@/types/strategy';
import { useToast } from 'primevue/usetoast';
import { useSettingsStore } from '@/stores/settingsStore';  // НОВОЕ: импорт для доступа к выбранной бирже

interface CandleData {
  timestamp?: number;
  openTime?: number; // Alternative timestamp field from API
  time?: number; // Another alternative timestamp field
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  vol?: number; // Alternative volume field from API
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
  'retry-load': [];
}>();

const toast = useToast();
const settingsStore = useSettingsStore();  // НОВОЕ: доступ к настройкам биржи

// TradingView Chart refs
const chartContainer = ref<HTMLElement | null>(null);
const chartInstance = ref<IChartApi | null>(null);
const candlestickSeries = ref<ISeriesApi<'Candlestick'> | null>(null);
const volumeSeries = ref<ISeriesApi<'Histogram'> | null>(null);
const stopLossLineSeries = ref<ISeriesApi<'Line'> | null>(null);
const takeProfitLineSeries = ref<ISeriesApi<'Line'> | null>(null);
const seriesMarkersInstance = ref<any | null>(null);
const isLoadingChart = ref(false);
const isLoadingData = ref(false);
const lightweightChartsVersion = ref('5.x');

// Chart type selection
const selectedChartType = ref<'candlestick' | 'line' | 'area'>('candlestick');
const chartTypeOptions = [
  { label: 'Свечи', value: 'candlestick' },
  { label: 'Линия', value: 'line' },
  { label: 'Область', value: 'area' }
];

// Выбор таймфрейма
const selectedTimeframe = ref<string>('1h');
const availableTimeframes = [
  { label: '1 минута', value: '1m' },
  { label: '3 минуты', value: '3m' },
  { label: '5 минут', value: '5m' },
  { label: '15 минут', value: '15m' },
  { label: '30 минут', value: '30m' },
  { label: '1 час', value: '1h' },
  { label: '2 часа', value: '2h' },
  { label: '4 часа', value: '4h' },
  { label: '6 часов', value: '6h' },
  { label: '12 часов', value: '12h' },
  { label: '1 день', value: '1d' }
];

// Внутренние данные свечей для текущего таймфрейма
const currentCandleData = ref<CandleData[] | null>(null);
const currentTimeframe = ref<string>('1h');

// НОВОЕ: Производительность и оптимизация
const maxCandlesForRender = ref<number>(5000); // Максимум свечей для рендеринга
const isPerformanceMode = ref<boolean>(false); // Режим производительности
const updateDebounceTimer = ref<number | null>(null); // Дебаунсинг обновлений

const isVisible = computed({
  get: () => props.visible,
  set: (value) => emit('update:visible', value)
});

const dialogTitle = computed(() => {
  if (!props.trade) return 'График сделки';
  const backtestTf = props.trade.backtestTimeframe || 'Unknown';
  const currentTf = currentTimeframe.value;
  const timeframeInfo = currentTf === backtestTf ? `${currentTf} (Бектест)` : `${currentTf}`;
  return `График: ${props.trade.pair || 'Unknown'} - ${props.trade.direction?.toUpperCase()} - ${timeframeInfo}`;
});

const hasChartData = computed(() => {
  return currentCandleData.value && currentCandleData.value.length > 0;
});

const backtestTimeframe = computed(() => {
  return props.trade?.backtestTimeframe || '1h';
});

const isBacktestTimeframe = computed(() => {
  return currentTimeframe.value === backtestTimeframe.value;
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

// НОВОЕ: Автоматическая настройка производительности
const optimizePerformance = (dataLength: number) => {
  if (dataLength > 3000) {
    isPerformanceMode.value = true;
    maxCandlesForRender.value = 3000;
    console.log(`[TradeChart] Performance mode enabled: ${dataLength} candles, limiting to ${maxCandlesForRender.value}`);
    
    toast.add({
      severity: 'info',
      summary: 'Режим производительности',
      detail: `Включен режим производительности: отображение ${maxCandlesForRender.value} из ${dataLength} свечей для лучшей скорости рендеринга.`,
      life: 5000
    });
  } else {
    isPerformanceMode.value = false;
    maxCandlesForRender.value = 5000;
  }
};
  
// Дебаунсинг обновлений графика
const debouncedChartUpdate = (callback: () => void, delay: number = 300) => {
  if (updateDebounceTimer.value) {
    clearTimeout(updateDebounceTimer.value);
  }
  
  updateDebounceTimer.value = window.setTimeout(() => {
    callback();
    updateDebounceTimer.value = null;
  }, delay);
};

const createTradingViewChart = () => {
  if (!chartContainer.value || !currentCandleData.value) {
    console.warn('[TradeChart] Missing container or data for chart creation');
    return;
  }
  
  try {
    console.log(`[TradeChart] Starting chart creation with ${currentCandleData.value!.length} original candles for timeframe ${currentTimeframe.value}`);

    const rawCandles = currentCandleData.value;
    console.log(`[TradeChart] Processing ${rawCandles.length} raw candles. Sample data:`, rawCandles[0]);

    // НОВОЕ: Оптимизация производительности
    optimizePerformance(rawCandles.length);

    // УМНАЯ ОБРЕЗКА ДАННЫХ для производительности
    let processedCandles = rawCandles;
    if (isPerformanceMode.value && rawCandles.length > maxCandlesForRender.value) {
      // Функция для получения timestamp из разных форматов
      const getTimestamp = (candle: any): number => {
        if (Array.isArray(candle) && candle.length >= 1) {
          return typeof candle[0] === 'string' ? parseInt(candle[0], 10) : Number(candle[0]);
        }
        if (candle.timestamp) return typeof candle.timestamp === 'string' ? parseInt(candle.timestamp, 10) : candle.timestamp;
        if (candle.openTime) return typeof candle.openTime === 'string' ? parseInt(candle.openTime, 10) : candle.openTime;
        if (candle.time) return typeof candle.time === 'string' ? parseInt(candle.time, 10) : candle.time;
        return 0;
      };
      
      // Берем контекст вокруг сделки
      const entryTime = props.trade?.entryTimestamp || 0;
      
      if (entryTime > 0) {
        // Находим индекс свечи близкой к времени входа
        let entryIndex = rawCandles.findIndex(candle => {
          const timestamp = getTimestamp(candle);
          const adjustedTimestamp = timestamp < 10000000000 ? timestamp * 1000 : timestamp;
          return adjustedTimestamp >= entryTime;
        });
        
        if (entryIndex === -1) entryIndex = Math.floor(rawCandles.length / 2);
        
        // Берем контекст вокруг сделки: 40% до входа, 60% после
        const beforeCount = Math.floor(maxCandlesForRender.value * 0.4);
        const afterCount = maxCandlesForRender.value - beforeCount;
        
        const startIndex = Math.max(0, entryIndex - beforeCount);
        const endIndex = Math.min(rawCandles.length, entryIndex + afterCount);
        
        processedCandles = rawCandles.slice(startIndex, endIndex);
        
        console.log(`[TradeChart] Smart data slicing: ${rawCandles.length} -> ${processedCandles.length} candles around trade (entry at index ${entryIndex})`);
      } else {
        // Fallback: берем последние N свечей
        processedCandles = rawCandles.slice(-maxCandlesForRender.value);
        console.log(`[TradeChart] Performance mode: using last ${processedCandles.length} candles`);
      }
    }

    const normalizedCandles: any[] = [];
    const cleanedCandles: any[] = [];
    const usedTimestamps = new Set<number>();

    // ОПТИМИЗАЦИЯ: Счетчики ошибок для группировки логов
    let invalidTimestampCount = 0;
    let outOfRangeCount = 0;
    let invalidOHLCCount = 0;
    let nonPositiveOHLCCount = 0;
    let invalidOHLCLogicCount = 0;
    const MAX_WARNING_LOGS = 5; // Максимум 5 warning'ов каждого типа

    // Нормализация данных свечей с оптимизированным логированием
    processedCandles.forEach((candle, index) => {
      let timestamp: number = 0;
      
      // ДЕТАЛЬНАЯ ДИАГНОСТИКА: Логируем структуру первых свечей
      if (index < 5) {
        console.log(`[TradeChart] Candle ${index} FULL STRUCTURE:`, candle);
        console.log(`[TradeChart] Candle ${index} keys:`, Object.keys(candle));
        console.log(`[TradeChart] Candle ${index} values:`, Object.values(candle));
      }

      // ИСПРАВЛЕННАЯ ЛОГИКА: Данные приходят как массив [timestamp, open, high, low, close, volume, quoteVolume]
      if (Array.isArray(candle) && candle.length >= 5) {
        // Формат массива от Bybit API: [timestamp, open, high, low, close, volume, quoteVolume]
        timestamp = typeof candle[0] === 'string' ? parseInt(candle[0], 10) : Number(candle[0]);
        
        if (index < 5) {
          console.log(`[TradeChart] Array format detected for candle ${index}:`, {
            timestamp: candle[0],
            open: candle[1],
            high: candle[2], 
            low: candle[3],
            close: candle[4],
            volume: candle[5],
            quoteVolume: candle[6]
          });
        }
      }
      // Fallback для объектного формата
      else if (typeof candle === 'object' && !Array.isArray(candle)) {
      if (candle.timestamp) {
        timestamp = typeof candle.timestamp === 'string' ? parseInt(candle.timestamp, 10) : candle.timestamp;
      }
      else if (candle.openTime) {
        timestamp = typeof candle.openTime === 'string' ? parseInt(candle.openTime, 10) : candle.openTime;
      }
      else if (candle.time) {
        timestamp = typeof candle.time === 'string' ? parseInt(candle.time, 10) : candle.time;
      }
      else if ((candle as any).open_time) {
        timestamp = typeof (candle as any).open_time === 'string' ? parseInt((candle as any).open_time, 10) : (candle as any).open_time;
      }
      else if ((candle as any).t) {
        timestamp = typeof (candle as any).t === 'string' ? parseInt((candle as any).t, 10) : (candle as any).t;
      }
      else if ((candle as any).ts) {
        timestamp = typeof (candle as any).ts === 'string' ? parseInt((candle as any).ts, 10) : (candle as any).ts;
      }
      }
      
      // ДИАГНОСТИКА: Логируем первые 5 свечей для понимания формата
      if (index < 5) {
        console.log(`[TradeChart] Candle ${index} diagnostic:`, {
          originalCandle: candle,
          extractedTimestamp: timestamp,
          isArray: Array.isArray(candle),
          arrayLength: Array.isArray(candle) ? candle.length : 'not array',
          timestampFields: Array.isArray(candle) ? 'array format' : {
            timestamp: candle?.timestamp,
            openTime: candle?.openTime, 
            time: candle?.time,
            open_time: (candle as any)?.open_time,
            t: (candle as any)?.t,
            ts: (candle as any)?.ts
          }
        });
      }
      
      if (typeof timestamp !== 'number' || timestamp <= 0) {
        invalidTimestampCount++;
        if (invalidTimestampCount <= MAX_WARNING_LOGS) {
          console.warn(`[TradeChart] Invalid or missing timestamp for candle ${index}:`, {
            candle: candle,
            extractedTimestamp: timestamp,
            availableFields: Array.isArray(candle) ? `Array[${candle.length}]` : Object.keys(candle || {}),
            isArray: Array.isArray(candle),
            candleType: typeof candle
          });
        }
        return;
      }

      // ИСПРАВЛЕННАЯ ЛОГИКА: Более гибкая проверка формата timestamp
      // Если timestamp меньше чем Unix timestamp в секундах начиная с 2020 года
      const MIN_UNIX_SECONDS_2020 = 1577836800; // 2020-01-01 в секундах
      
      if (timestamp < MIN_UNIX_SECONDS_2020) {
        // Возможно это какой-то другой формат, пропускаем с предупреждением
        invalidTimestampCount++;
        if (invalidTimestampCount <= MAX_WARNING_LOGS) {
          console.warn(`[TradeChart] Timestamp too old (before 2020) for candle ${index}:`, {
            timestamp,
            candle
          });
        }
        return;
      }
      
      // Конвертируем в миллисекунды если нужно (если timestamp в секундах)
      if (timestamp < 10000000000) { // Если меньше 10^10, то это секунды
        timestamp = timestamp * 1000;
      }
      
      // СМЯГЧЕННАЯ ПРОВЕРКА: Проверяем что timestamp в разумных пределах 
      const now = Date.now();
      const earliestDate = new Date('2015-01-01').getTime(); // Смягчили с 2020 до 2015
      const latestDate = now + 5 * 365 * 24 * 60 * 60 * 1000; // Плюс 5 лет в будущем (было 1 год)
      
      if (timestamp < earliestDate || timestamp > latestDate) {
        outOfRangeCount++;
        if (outOfRangeCount <= MAX_WARNING_LOGS) {
        console.warn(`[TradeChart] Timestamp out of reasonable range for candle ${index}:`, {
          timestamp,
          date: timestamp && timestamp > 0 ? new Date(timestamp).toISOString() : 'Invalid',
            candle,
            range: {
              earliest: new Date(earliestDate).toISOString(),
              latest: new Date(latestDate).toISOString()
            }
        });
        }
        return;
      }

      // ИСПРАВЛЕННАЯ ЛОГИКА: Извлечение OHLC данных из массива или объекта
      const getNumericValue = (value: any): number => {
        if (typeof value === 'number') return value;
        if (typeof value === 'string') {
          const parsed = parseFloat(value);
          return isNaN(parsed) ? 0 : parsed;
        }
        return 0;
      };

      let open: number, high: number, low: number, close: number, volume: number;

      if (Array.isArray(candle) && candle.length >= 5) {
        // Формат массива: [timestamp, open, high, low, close, volume, quoteVolume]
        open = getNumericValue(candle[1]);
        high = getNumericValue(candle[2]);  
        low = getNumericValue(candle[3]);
        close = getNumericValue(candle[4]);
        volume = getNumericValue(candle[5] || 0);
      } else {
        // Объектный формат
        open = getNumericValue(candle.open);
        high = getNumericValue(candle.high);  
        low = getNumericValue(candle.low);
        close = getNumericValue(candle.close);
        volume = getNumericValue(candle.volume || candle.vol || 0);
      }

      // ДИАГНОСТИКА: Логируем первые 5 свечей после извлечения OHLC
      if (index < 5) {
        console.log(`[TradeChart] Candle ${index} OHLC:`, {
          original: Array.isArray(candle) ? 
            { timestamp: candle[0], open: candle[1], high: candle[2], low: candle[3], close: candle[4] } :
            { open: candle?.open, high: candle?.high, low: candle?.low, close: candle?.close },
          extracted: { open, high, low, close, volume }
        });
      }

      // Базовая валидация OHLC
      if (isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close)) {
        invalidOHLCCount++;
        if (invalidOHLCCount <= MAX_WARNING_LOGS) {
          console.warn(`[TradeChart] Invalid OHLC values for candle ${index}:`, { 
            open, high, low, close, 
            originalValues: { open: candle.open, high: candle.high, low: candle.low, close: candle.close },
            candle 
          });
        }
        return;
      }

      if (open <= 0 || high <= 0 || low <= 0 || close <= 0) {
        nonPositiveOHLCCount++;
        if (nonPositiveOHLCCount <= MAX_WARNING_LOGS) {
        console.warn(`[TradeChart] Non-positive OHLC values for candle ${index}:`, { open, high, low, close });
        }
        return;
      }

      // СМЯГЧЕННАЯ ЛОГИКА: Более гибкая проверка OHLC логики
      if (high < low) {
        invalidOHLCLogicCount++;
        if (invalidOHLCLogicCount <= MAX_WARNING_LOGS) {
          console.warn(`[TradeChart] High < Low for candle ${index}:`, { open, high, low, close });
        }
        return;
      }

      // Более мягкая проверка - позволяем небольшие расхождения из-за округления
      const tolerance = Math.max(close * 0.0001, 0.0001); // 0.01% или минимум 0.0001
      if (high < Math.max(open, close) - tolerance || low > Math.min(open, close) + tolerance) {
        invalidOHLCLogicCount++;
        if (invalidOHLCLogicCount <= MAX_WARNING_LOGS) {
          console.warn(`[TradeChart] OHLC logic issue for candle ${index}:`, { 
            open, high, low, close, 
            tolerance,
            highVsMax: high - Math.max(open, close),
            lowVsMin: low - Math.min(open, close)
          });
      }
        return;
      }

      normalizedCandles.push({
        timestamp,
        open,
        high, 
        low,
        close,
        volume,
        originalIndex: index
      });
    });

    // СВОДКА ПО ОШИБКАМ: Логируем общую статистику вместо многих warning'ов
    if (invalidTimestampCount > MAX_WARNING_LOGS || outOfRangeCount > MAX_WARNING_LOGS || 
        invalidOHLCCount > MAX_WARNING_LOGS || nonPositiveOHLCCount > MAX_WARNING_LOGS || 
        invalidOHLCLogicCount > MAX_WARNING_LOGS) {
      console.warn(`[TradeChart] Data quality summary:`, {
        totalCandles: rawCandles.length,
        validCandles: normalizedCandles.length,
        errors: {
          invalidTimestamp: invalidTimestampCount,
          outOfRange: outOfRangeCount,
          invalidOHLC: invalidOHLCCount,
          nonPositiveOHLC: nonPositiveOHLCCount,
          invalidOHLCLogic: invalidOHLCLogicCount
        }
      });
    }

    console.log(`[TradeChart] Normalized ${normalizedCandles.length}/${rawCandles.length} candles`);

    if (normalizedCandles.length === 0) {
      throw new Error('No valid candles after normalization');
    }

    // Сортируем по времени
    normalizedCandles.sort((a, b) => a.timestamp - b.timestamp);

    // ОПРЕДЕЛЯЕМ ВРЕМЕННОЙ ИНТЕРВАЛ более умно
    let timeInterval = 60; // Дефолт 1 минута (в секундах)
    
    if (normalizedCandles.length > 1) {
      // Вычисляем интервалы между несколькими свечами для более точного определения
      const intervals: number[] = [];
      for (let i = 1; i < Math.min(normalizedCandles.length, 10); i++) {
        const interval = (normalizedCandles[i].timestamp - normalizedCandles[i-1].timestamp) / 1000; // В секундах
        if (interval > 0 && interval < 24 * 60 * 60) { // Разумный интервал (меньше суток)
          intervals.push(interval);
        }
      }
      
      if (intervals.length > 0) {
        // Используем медианный интервал для защиты от выбросов
        intervals.sort((a, b) => a - b);
        const medianInterval = intervals[Math.floor(intervals.length / 2)];
        timeInterval = Math.round(medianInterval);
        
        console.log(`[TradeChart] Detected time intervals:`, intervals);
        console.log(`[TradeChart] Using median interval: ${timeInterval} seconds`);
      }
    }

    // НОРМАЛИЗАЦИЯ ВРЕМЕННЫХ МЕТОК и удаление дубликатов
    let duplicateCount = 0;
    normalizedCandles.forEach((candle, index) => {
      const rawTimestamp = Math.floor(candle.timestamp / 1000); // Конвертируем в секунды
      const normalizedTimestamp = Math.floor(rawTimestamp / timeInterval) * timeInterval;
      
      if (!usedTimestamps.has(normalizedTimestamp)) {
        usedTimestamps.add(normalizedTimestamp);
        
        cleanedCandles.push({
          time: normalizedTimestamp as Time,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
          originalTimestamp: candle.timestamp,
          originalIndex: candle.originalIndex
        });
      } else {
        duplicateCount++;
        // ОПТИМИЗАЦИЯ: Логируем только первые 5 дубликатов
        if (duplicateCount <= 5) {
        console.debug(`[TradeChart] Skipping duplicate timestamp: ${normalizedTimestamp} (${normalizedTimestamp > 0 ? new Date(normalizedTimestamp * 1000).toISOString() : 'Invalid'}) at index ${index}`);
        }
      }
    });

    // Логируем сводку по дубликатам
    if (duplicateCount > 5) {
      console.debug(`[TradeChart] Skipped ${duplicateCount} duplicate timestamps (showing first 5)`);
    }

    // Сортируем по времени
    cleanedCandles.sort((a, b) => Number(a.time) - Number(b.time));

    // ДОПОЛНИТЕЛЬНАЯ ПРОВЕРКА - заполняем пропуски в данных
    const finalCandles: any[] = [];
    let expectedTime = 0;

    cleanedCandles.forEach((candle, index) => {
      const currentTime = Number(candle.time);
      
      if (index === 0) {
        finalCandles.push(candle);
        expectedTime = currentTime + timeInterval;
      } else {
        // Если есть пропуск во времени больше одного интервала
        const timeDiff = currentTime - expectedTime + timeInterval;
        const missedIntervals = Math.floor(timeDiff / timeInterval);
        
        if (missedIntervals > 1 && missedIntervals <= 10) {
          // Заполняем небольшие пропуски копированием последней свечи
          const lastCandle = finalCandles[finalCandles.length - 1];
          for (let i = 1; i < missedIntervals; i++) {
            const fillTime = expectedTime + (i - 1) * timeInterval;
            finalCandles.push({
              time: fillTime as Time,
              open: lastCandle.close,
              high: lastCandle.close,
              low: lastCandle.close,
              close: lastCandle.close,
              volume: 0,
              filled: true
            });
          }
        }
        
        finalCandles.push(candle);
        expectedTime = currentTime + timeInterval;
      }
    });

    console.log(`[TradeChart] Data processed: ${rawCandles.length} -> ${cleanedCandles.length} -> ${finalCandles.length} candles`);
    console.log(`[TradeChart] Time range: ${finalCandles[0]?.time && finalCandles[0].time > 0 ? new Date(finalCandles[0].time * 1000).toISOString() : 'Invalid'} to ${finalCandles[finalCandles.length - 1]?.time && finalCandles[finalCandles.length - 1].time > 0 ? new Date(finalCandles[finalCandles.length - 1].time * 1000).toISOString() : 'Invalid'}`);

    if (finalCandles.length === 0) {
      throw new Error('No valid candle data after processing');
    }

    // Определяем точность цен на основе данных
    const allPrices = finalCandles.flatMap(c => [c.open, c.high, c.low, c.close]);
    const maxPrice = Math.max(...allPrices);
    const minPrice = Math.min(...allPrices);
    const priceRange = maxPrice - minPrice;
    
    // УЛУЧШЕННАЯ система определения точности цен
    let pricePrecision = 4;
    let minMove = 0.0001;
    
    if (maxPrice >= 1000) {
      // Для больших цен (>$1000) - меньше знаков после запятой
      pricePrecision = 2;
      minMove = 0.01;
    } else if (maxPrice >= 100) {
      // Для средних цен ($100-$1000)
      pricePrecision = 3;
      minMove = 0.001;
    } else if (maxPrice >= 10) {
      // Для цен $10-$100
      pricePrecision = 4;
      minMove = 0.0001;
    } else if (maxPrice >= 1) {
      // Для цен $1-$10
      pricePrecision = 5;
      minMove = 0.00001;
    } else {
      // Для мелких цен (<$1) - максимум знаков
      pricePrecision = 6;
      minMove = 0.000001;
    }
    
    // Дополнительная проверка по размаху цен
    if (priceRange < 0.01) {
      pricePrecision = Math.max(pricePrecision, 6);
      minMove = 0.000001;
    } else if (priceRange < 0.1) {
      pricePrecision = Math.max(pricePrecision, 5);
      minMove = 0.00001;
    }

    // Подготавливаем данные для TradingView с правильной точностью
    const candleDataFormatted = finalCandles.map(candle => ({
      time: candle.time,
      open: Number(candle.open.toFixed(pricePrecision)),
      high: Number(candle.high.toFixed(pricePrecision)),
      low: Number(candle.low.toFixed(pricePrecision)),
      close: Number(candle.close.toFixed(pricePrecision)),
    }));

    // Создаем TradingView chart с улучшенными настройками
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
        // Устанавливаем точность цен
        visible: true,
      },
      timeScale: {
        borderColor: '#cccccc',
        timeVisible: true,
        secondsVisible: timeInterval < 60,
        rightOffset: 10,
        barSpacing: Math.max(6, Math.min(20, Math.floor(600 / finalCandles.length))),
        minBarSpacing: 3,
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

    // Создаем основную серию свечей с правильными настройками цен
    let mainSeries: ISeriesApi<any>;
    
    if (selectedChartType.value === 'candlestick') {
      mainSeries = chartInstance.value.addSeries(CandlestickSeries, {
        upColor: '#00C851',
        downColor: '#ff4444',
        borderDownColor: '#ff4444',
        borderUpColor: '#00C851',
        wickDownColor: '#ff4444',
        wickUpColor: '#00C851',
        priceFormat: {
          type: 'price',
          precision: pricePrecision,
          minMove: minMove,
        },
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
        priceFormat: {
          type: 'price',
          precision: pricePrecision,
          minMove: minMove,
        },
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
        priceFormat: {
          type: 'price',
          precision: pricePrecision,
          minMove: minMove,
        },
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

    // Добавляем линии Stop Loss и Take Profit с правильной точностью
    addTradeLevelsWithRiskReward(finalCandles, pricePrecision, minMove);

    // Добавляем маркеры входа/выхода с правильной точностью
    addTradeArrowsWithLines(finalCandles, pricePrecision, minMove);

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
const addTradeArrowsWithLines = (cleanedCandles: any[], pricePrecision: number, minMove: number) => {
  if (!chartInstance.value || !props.trade || cleanedCandles.length === 0 || !candlestickSeries.value) return;

  try {
    console.log('[TradeChart] Adding trade arrows with createSeriesMarkers method');
    console.log('[TradeChart] Trade details:', {
      entryTimestamp: props.trade.entryTimestamp,
      entryPrice: props.trade.entryPrice,
      exitTimestamp: props.trade.exitTimestamp,
      exitPrice: props.trade.exitPrice,
      entryTime: props.trade.entryTimestamp && props.trade.entryTimestamp > 0 ? new Date(props.trade.entryTimestamp).toISOString() : 'Invalid',
      exitTime: props.trade.exitTimestamp && props.trade.exitTimestamp > 0 ? new Date(props.trade.exitTimestamp).toISOString() : 'ongoing'
    });

    const markers: any[] = [];

    // ИСПРАВЛЕННАЯ ЛОГИКА: Ищем ближайшие свечи к времени входа/выхода
    const findNearestCandleTime = (targetTimestamp: number): Time | null => {
      if (!targetTimestamp || cleanedCandles.length === 0) return null;
      
      let nearestCandle = cleanedCandles[0];
      let minDifference = Math.abs(targetTimestamp - (nearestCandle.time * 1000));
      
      for (const candle of cleanedCandles) {
        const candleTimestamp = candle.time * 1000; // Конвертируем обратно в миллисекунды для сравнения
        const difference = Math.abs(targetTimestamp - candleTimestamp);
        
        if (difference < minDifference) {
          minDifference = difference;
          nearestCandle = candle;
        }
      }
      
      console.log(`[TradeChart] Nearest candle for timestamp ${targetTimestamp && targetTimestamp > 0 ? new Date(targetTimestamp).toISOString() : 'Invalid'}:`, {
        targetTime: targetTimestamp && targetTimestamp > 0 ? new Date(targetTimestamp).toISOString() : 'Invalid',
        nearestCandleTime: nearestCandle?.time && nearestCandle.time > 0 ? new Date(nearestCandle.time * 1000).toISOString() : 'Invalid',
        timeDifference: minDifference / 1000 / 60, // в минутах
        nearestCandle
      });
      
      return nearestCandle.time;
    };

    // Стрелочка входа
    if (props.trade.entryTimestamp && props.trade.entryPrice) {
      const entryTime = findNearestCandleTime(props.trade.entryTimestamp);
      
      if (entryTime) {
        console.log(`[TradeChart] Adding entry marker at time ${entryTime}, price ${props.trade.entryPrice}`);

        markers.push({
          time: entryTime,
          position: 'belowBar',
          color: props.trade.direction === 'long' ? '#00C851' : '#ff4444',
          shape: 'arrowUp',
          text: `ENTRY: $${props.trade.entryPrice.toFixed(pricePrecision)}`,
          size: 2,
        });
      } else {
        console.warn('[TradeChart] Could not find nearest candle for entry time');
      }
    }

    // Стрелочка выхода
    if (props.trade.exitTimestamp && props.trade.exitPrice) {
      const exitTime = findNearestCandleTime(props.trade.exitTimestamp);
      const pnlText = (props.trade.pnl || 0) >= 0 ? `+$${(props.trade.pnl || 0).toFixed(2)}` : `-$${Math.abs(props.trade.pnl || 0).toFixed(2)}`;
      
      if (exitTime) {
        console.log(`[TradeChart] Adding exit marker at time ${exitTime}, price ${props.trade.exitPrice}`);

        markers.push({
          time: exitTime,
          position: 'aboveBar',
          color: (props.trade.pnl || 0) >= 0 ? '#00C851' : '#ff4444',
          shape: 'arrowDown',
          text: `EXIT: $${props.trade.exitPrice.toFixed(pricePrecision)} | ${pnlText}`,
          size: 2,
        });
      } else {
        console.warn('[TradeChart] Could not find nearest candle for exit time');
      }
    }

    // Используем правильный API для v5
    if (markers.length > 0) {
      try {
        console.log(`[TradeChart] Creating series markers with ${markers.length} markers:`, markers);
        seriesMarkersInstance.value = createSeriesMarkers(candlestickSeries.value, markers);
        console.log('[TradeChart] Series markers created successfully');
      } catch (markerError) {
        console.error('[TradeChart] Error creating series markers:', markerError);
        // Fallback к горизонтальным линиям если маркеры не работают
        addTradeArrowsAsFallback(cleanedCandles, pricePrecision, minMove);
      }
    } else {
      console.warn('[TradeChart] No markers to add');
      // Используем fallback метод
      addTradeArrowsAsFallback(cleanedCandles, pricePrecision, minMove);
    }

    console.log('[TradeChart] Trade arrows added successfully');
  } catch (error) {
    console.error('[TradeChart] Error adding trade arrows:', error);
    // Fallback к горизонтальным линиям
    addTradeArrowsAsFallback(cleanedCandles, pricePrecision, minMove);
  }
};

// Fallback метод с горизонтальными линиями
const addTradeArrowsAsFallback = (cleanedCandles: any[], pricePrecision: number, minMove: number) => {
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
        title: `Entry: $${props.trade.entryPrice.toFixed(pricePrecision)}`,
        priceFormat: {
          type: 'price',
          precision: pricePrecision,
          minMove: minMove,
        },
      });

      const firstTime = cleanedCandles[0].time;
      const lastTime = cleanedCandles[cleanedCandles.length - 1].time;
      
      entryPriceLine.setData([
        { time: firstTime, value: Number(props.trade.entryPrice.toFixed(pricePrecision)) },
        { time: lastTime, value: Number(props.trade.entryPrice.toFixed(pricePrecision)) },
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
        title: `Exit: $${props.trade.exitPrice.toFixed(pricePrecision)}`,
        priceFormat: {
          type: 'price',
          precision: pricePrecision,
          minMove: minMove,
        },
      });

      const firstTime = cleanedCandles[0].time;
      const lastTime = cleanedCandles[cleanedCandles.length - 1].time;
      
      exitPriceLine.setData([
        { time: firstTime, value: Number(props.trade.exitPrice.toFixed(pricePrecision)) },
        { time: lastTime, value: Number(props.trade.exitPrice.toFixed(pricePrecision)) },
      ]);
    }

    console.log('[TradeChart] Fallback arrows added successfully');
  } catch (fallbackError) {
    console.error('[TradeChart] Error in fallback method:', fallbackError);
  }
};

// Обновленная функция для TP/SL с Risk/Reward
const addTradeLevelsWithRiskReward = (cleanedCandles: any[], pricePrecision: number, minMove: number) => {
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
          title: `Stop Loss: $${props.trade.stopLoss.toFixed(pricePrecision)}`,
          priceLineVisible: true,
          lastValueVisible: true,
          priceFormat: {
            type: 'price',
            precision: pricePrecision,
            minMove: minMove,
          },
        });

        stopLossLineSeries.value.setData([
          { time: startTime, value: Number(props.trade.stopLoss.toFixed(pricePrecision)) },
          { time: endTime, value: Number(props.trade.stopLoss.toFixed(pricePrecision)) },
        ]);
        
        console.log(`[TradeChart] Stop Loss line added at ${props.trade.stopLoss.toFixed(pricePrecision)}`);
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
          title: `Take Profit: $${props.trade.takeProfit.toFixed(pricePrecision)} | R:R ${riskRewardRatio}`,
          priceLineVisible: true,
          lastValueVisible: true,
          priceFormat: {
            type: 'price',
            precision: pricePrecision,
            minMove: minMove,
          },
        });

        takeProfitLineSeries.value.setData([
          { time: startTime, value: Number(props.trade.takeProfit.toFixed(pricePrecision)) },
          { time: endTime, value: Number(props.trade.takeProfit.toFixed(pricePrecision)) },
        ]);
        
        console.log(`[TradeChart] Take Profit line added at ${props.trade.takeProfit.toFixed(pricePrecision)} with R:R ${riskRewardRatio}`);
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
        const timestamp = props.trade?.entryTimestamp && props.trade.entryTimestamp > 0 ? 
          new Date(props.trade.entryTimestamp).toISOString().slice(0, 19).replace(/[:-]/g, '') : 
          Date.now().toString();
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

// Функция для переключения на таймфрейм бектеста
const switchToBacktestTimeframe = () => {
  if (backtestTimeframe.value !== selectedTimeframe.value) {
    selectedTimeframe.value = backtestTimeframe.value;
    onTimeframeChange();
  }
};

// Функция для переключения на конкретный таймфрейм
const switchToTimeframe = (timeframe: string) => {
  if (timeframe !== selectedTimeframe.value) {
    selectedTimeframe.value = timeframe;
    onTimeframeChange();
  }
};

// Обработчик изменения таймфрейма
const onTimeframeChange = async () => {
  if (!props.trade) return;
  
  console.log(`[TradeChartModal] Timeframe changed to: ${selectedTimeframe.value}`);
  currentTimeframe.value = selectedTimeframe.value;
  
  // НОВОЕ: Дебаунсинг для предотвращения частых обновлений
  debouncedChartUpdate(async () => {
  // Сбрасываем текущие данные
  currentCandleData.value = null;
  
  // Если это изначальные данные из пропсов и таймфрейм совпадает с бектестом
  if (props.candleData && selectedTimeframe.value === backtestTimeframe.value) {
    console.log('[TradeChartModal] Using original data from props');
    currentCandleData.value = props.candleData;
    createTradingViewChart();
    return;
  }
  
  // Пытаемся загрузить данные для нового таймфрейма
  await loadTimeframeData(selectedTimeframe.value);
  }, 500); // 500мс дебаунс для смены таймфрейма
};

// Функция загрузки данных для текущего таймфрейма
const fetchCurrentTimeframeData = async () => {
  await fetchMissingData(props.trade?.pair || '', selectedTimeframe.value);
};

// Обновленная функция для загрузки данных конкретного таймфрейма
const loadTimeframeData = async (timeframe: string) => {
  if (!props.trade?.pair) return;
  
  isLoadingChart.value = true;
  
  try {
    console.log(`[TradeChartModal] Loading data for timeframe: ${timeframe}`);
    console.log(`[TradeChartModal] Trade info:`, {
      pair: props.trade.pair,
      entryTimestamp: props.trade.entryTimestamp,
      entryDate: props.trade.entryTimestamp && props.trade.entryTimestamp > 0 ? new Date(props.trade.entryTimestamp).toISOString() : 'Invalid',
      exitTimestamp: props.trade.exitTimestamp,
      exitDate: props.trade.exitTimestamp && props.trade.exitTimestamp > 0 ? new Date(props.trade.exitTimestamp).toISOString() : 'ongoing',
      backtestTimeRange: props.trade.backtestTimeRange
    });
    
    // ИСПРАВЛЕННАЯ ЛОГИКА: Используем диапазон бэктеста без расширения назад
    let startTime: number;
    let endTime: number;
    
    // Используем диапазон бектеста если доступен
    if (props.trade.backtestTimeRange) {
      // ИСПРАВЛЕНИЕ: Диапазон загрузки РАВЕН диапазону бэктеста (не расширяется назад)
      startTime = props.trade.backtestTimeRange.startTime;
      endTime = props.trade.backtestTimeRange.endTime;
      
      console.log(`[TradeChartModal] Using exact backtest time range:`, {
        from: props.trade.backtestTimeRange.startTime && props.trade.backtestTimeRange.startTime > 0 ? new Date(props.trade.backtestTimeRange.startTime).toISOString() : 'Invalid',
        to: props.trade.backtestTimeRange.endTime && props.trade.backtestTimeRange.endTime > 0 ? new Date(props.trade.backtestTimeRange.endTime).toISOString() : 'Invalid',
        note: 'Данные загружаются строго в диапазоне бэктеста'
      });
    } else {
      // КОНСЕРВАТИВНЫЙ FALLBACK: Минимальный контекст вокруг сделки (принцип "не раньше времени сделки")
      const tradeEntryTime = props.trade.entryTimestamp;
      const tradeExitTime = props.trade.exitTimestamp || Date.now();
      
      // Уменьшаем контекстный буфер - максимум 7 дней до сделки
      const contextBufferBefore = 7 * 24 * 60 * 60 * 1000; // Уменьшено с 30 до 7 дней
      const contextBufferAfter = Math.max(7 * 24 * 60 * 60 * 1000, (tradeExitTime - tradeEntryTime)); // 7 дней или длительность сделки после
      
      startTime = tradeEntryTime - contextBufferBefore;
      endTime = tradeExitTime + contextBufferAfter;
      
      // Валидация: не раньше 2020 года и не позже чем через год
      const earliestDate = new Date('2020-01-01').getTime();
      const latestDate = Date.now() + 365 * 24 * 60 * 60 * 1000;
      
      startTime = Math.max(startTime, earliestDate);
      endTime = Math.min(endTime, latestDate);
      
      console.log(`[TradeChartModal] Using conservative fallback time range:`, {
        from: startTime && startTime > 0 ? new Date(startTime).toISOString() : 'Invalid',
        to: endTime && endTime > 0 ? new Date(endTime).toISOString() : 'Invalid',
        contextDays: (endTime - startTime) / (24 * 60 * 60 * 1000),
        note: 'Fallback режим - минимальный контекст (7 дней до сделки максимум)'
      });
    }
    
    // Определяем лимит для таймфрейма (увеличиваем лимиты)
    let limit = 10000; // Увеличенный базовый лимит
    if (timeframe === '1m') limit = 20000;
    else if (timeframe === '5m') limit = 15000;
    else if (timeframe === '15m') limit = 12000;
    else if (timeframe === '1h') limit = 15000;
    else if (timeframe === '4h') limit = 20000;
    else if (timeframe === '1d') limit = 25000;
    
    console.log(`[TradeChartModal] Request parameters:`, {
      symbol: props.trade.pair,
      timeframe,
      startTime,
      endTime,
      limit,
      periodDays: (endTime - startTime) / (24 * 60 * 60 * 1000)
    });
    
    const response = await fetch('/api/data/candles', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        symbol: props.trade.pair,
        timeframe: timeframe,
        startTime,
        endTime,
        limit: limit,
        exchange: settingsStore.selectedExchange || 'bybit'  // НОВОЕ: передаем выбранную биржу
      })
    });
    
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }
    
    const apiData = await response.json();
    
    console.log(`[TradeChartModal] API Response:`, {
      success: apiData.success,
      dataLength: apiData.data?.length || 0,
      hasData: !!apiData.data,
      meta: apiData.meta
    });
    
    if (apiData.success && apiData.data && Array.isArray(apiData.data) && apiData.data.length > 0) {
      console.log(`[TradeChartModal] Successfully loaded ${apiData.data.length} candles for ${timeframe}`);
      
      // ДЕТАЛЬНЫЙ АНАЛИЗ ПОЛУЧЕННЫХ ДАННЫХ
      const firstCandle = apiData.data[0];
      const lastCandle = apiData.data[apiData.data.length - 1];
      
      // Получаем timestamp из разных возможных полей
      const getTimestamp = (candle: any): number => {
        // Сначала пробуем timestamp
        if (candle.timestamp && typeof candle.timestamp === 'number' && candle.timestamp > 0) {
          return candle.timestamp;
        }
        
        // Затем пробуем openTime (основной формат от бэкенда)
        if (candle.openTime) {
          const openTime = typeof candle.openTime === 'string' ? parseInt(candle.openTime, 10) : candle.openTime;
          if (typeof openTime === 'number' && openTime > 0) {
            return openTime;
          }
        }
        
        // Затем пробуем time (альтернативный формат)
        if (candle.time) {
          const time = typeof candle.time === 'string' ? parseInt(candle.time, 10) : candle.time;
          if (typeof time === 'number' && time > 0) {
            return time;
          }
        }
        
        console.warn('[TradeChartModal] No valid timestamp found in candle:', candle);
        return 0; // Возвращаем 0 как fallback
      };
      
      const dataStartTime = getTimestamp(firstCandle);
      const dataEndTime = getTimestamp(lastCandle);
      
      console.log(`[TradeChartModal] Data range analysis:`, {
        firstCandle: {
          raw: firstCandle,
          timestamp: dataStartTime,
          date: dataStartTime && dataStartTime > 0 ? new Date(dataStartTime).toISOString() : 'Invalid'
        },
        lastCandle: {
          raw: lastCandle,
          timestamp: dataEndTime,
          date: dataEndTime && dataEndTime > 0 ? new Date(dataEndTime).toISOString() : 'Invalid'
        },
        tradeEntry: {
          timestamp: props.trade.entryTimestamp,
          date: props.trade.entryTimestamp && props.trade.entryTimestamp > 0 ? new Date(props.trade.entryTimestamp).toISOString() : 'Invalid',
          entryPrice: props.trade?.entryPrice || 0,
          exitDate: props.trade?.exitTimestamp && props.trade.exitTimestamp > 0 ? new Date(props.trade.exitTimestamp).toISOString() : 'ongoing',
          coverage: {
            coversTradeEntry: dataStartTime && dataEndTime && 
                             dataStartTime <= props.trade.entryTimestamp && 
                             dataEndTime >= props.trade.entryTimestamp,
            daysBefore: dataStartTime ? (props.trade.entryTimestamp - dataStartTime) / (24 * 60 * 60 * 1000) : 0,
            daysAfter: dataEndTime ? (dataEndTime - props.trade.entryTimestamp) / (24 * 60 * 60 * 1000) : 0
          }
        },
        tradeExit: {
          timestamp: props.trade.exitTimestamp,
          date: props.trade.exitTimestamp && props.trade.exitTimestamp > 0 ? new Date(props.trade.exitTimestamp).toISOString() : 'ongoing',
          exitPrice: props.trade?.exitPrice || 0
        },
        coverage: {
          coversTradeEntry: dataStartTime && dataEndTime && 
                           dataStartTime <= props.trade.entryTimestamp && 
                           dataEndTime >= props.trade.entryTimestamp,
          daysBefore: dataStartTime ? (props.trade.entryTimestamp - dataStartTime) / (24 * 60 * 60 * 1000) : 0,
          daysAfter: dataEndTime ? (dataEndTime - props.trade.entryTimestamp) / (24 * 60 * 60 * 1000) : 0
        }
      });
      
      const coversTradeEntry = dataStartTime && dataEndTime && 
                              dataStartTime <= props.trade.entryTimestamp && 
                              dataEndTime >= props.trade.entryTimestamp;
      
      if (coversTradeEntry) {
        const daysBefore = Math.floor((props.trade.entryTimestamp - dataStartTime) / (24 * 60 * 60 * 1000));
        toast.add({
          severity: 'success',
          summary: 'Данные загружены',
          detail: `График ${timeframe} загружен успешно. ${apiData.data.length} свечей. Контекст: ${daysBefore} дней до сделки.`,
          life: 4000
        });
      } else {
        // БЕЗОПАСНЫЕ ПРОВЕРКИ ДЛЯ Date ОБЪЕКТОВ
        let startDateStr = 'Invalid';
        let endDateStr = 'Invalid';
        
        try {
          if (dataStartTime && dataStartTime > 0) {
            startDateStr = new Date(dataStartTime).toLocaleDateString();
          }
        } catch (e) {
          console.warn('[TradeChartModal] Invalid start date:', dataStartTime);
        }
        
        try {
          if (dataEndTime && dataEndTime > 0) {
            endDateStr = new Date(dataEndTime).toLocaleDateString();
          }
        } catch (e) {
          console.warn('[TradeChartModal] Invalid end date:', dataEndTime);
        }
        
        toast.add({
          severity: 'warn',
          summary: 'Ограниченные данные',
          detail: `Данные ${timeframe} не покрывают время сделки полностью. Диапазон: ${startDateStr} - ${endDateStr}`,
          life: 6000
        });
      }
      
      currentCandleData.value = apiData.data;
      createTradingViewChart();
    } else {
      console.warn(`[TradeChartModal] No data found for timeframe ${timeframe}`);
      console.warn(`[TradeChartModal] API response details:`, apiData);
      currentCandleData.value = null;
      
      // Показываем детальную информацию о проблеме
      let errorDetail = `Данные для таймфрейма ${timeframe} отсутствуют.`;
      if (apiData.message) {
        errorDetail += ` Сообщение сервера: ${apiData.message}`;
      }
      
      toast.add({
        severity: 'warn',
        summary: 'Нет данных',
        detail: errorDetail,
        life: 6000
      });
    }
    
  } catch (error: any) {
    console.error(`[TradeChartModal] Error loading data for timeframe ${timeframe}:`, error);
    currentCandleData.value = null;
    
    toast.add({
      severity: 'error',
      summary: 'Ошибка загрузки',
      detail: `Не удалось загрузить данные для ${timeframe}: ${error.message}`,
      life: 5000
    });
  } finally {
    isLoadingChart.value = false;
  }
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
  if (newVal) {
    // Инициализируем модальное окно
    initializeModal();
    
    setTimeout(() => {
      if (hasChartData.value) {
        createTradingViewChart();
      }
      window.addEventListener('resize', handleResize);
    }, 300); // Небольшая задержка для анимации модального окна
  } else {
    window.removeEventListener('resize', handleResize);
  }
});

watch(() => props.candleData, (newData) => {
  // Обновляем данные только если это таймфрейм бектеста
  if (props.visible && newData && selectedTimeframe.value === backtestTimeframe.value) {
    console.log('[TradeChartModal] Props candleData changed, updating current data');
    currentCandleData.value = newData;
    createTradingViewChart();
  }
}, { deep: true });

watch(() => props.trade, (newTrade) => {
  if (props.visible && newTrade) {
    console.log('[TradeChartModal] Trade changed, reinitializing');
    initializeModal();
  }
});

onUnmounted(() => {
  // Очищаем график
  if (chartInstance.value) {
    chartInstance.value.remove();
    chartInstance.value = null;
  }
  
  // НОВОЕ: Очищаем таймеры для предотвращения утечек памяти
  if (updateDebounceTimer.value) {
    clearTimeout(updateDebounceTimer.value);
    updateDebounceTimer.value = null;
  }
  
  console.log('[TradeChartModal] Cleaned up on unmount');
});

// Универсальная функция для загрузки недостающих данных (использует Bull Queue)
const fetchMissingData = async (symbol: string, timeframe: string) => {
  if (!symbol || !timeframe) return;
  
  isLoadingData.value = true;
  
  try {
    toast.add({
      severity: 'info',
      summary: 'Загрузка данных',
      detail: `Запуск загрузки данных для ${symbol} (${timeframe})...`,
      life: 3000
    });

    // ИСПРАВЛЕННАЯ ЛОГИКА: Используем диапазон бэктеста как минимальную дату
    let startTime: number;
    let endTime: number;
    
    if (props.trade?.backtestTimeRange) {
      // ИСПРАВЛЕНИЕ: Начальный диапазон РАВЕН диапазону бэктеста, НЕ расширяется назад от него
      startTime = props.trade.backtestTimeRange.startTime;
      endTime = props.trade.backtestTimeRange.endTime;
      
      // Валидация входных данных
      if (!startTime || !endTime || startTime >= endTime) {
        console.error('[TradeChartModal] Invalid backtest time range:', props.trade.backtestTimeRange);
        throw new Error('Некорректный временной диапазон бектеста');
      }
      
      // ИСПРАВЛЕНИЕ: Расширяем ТОЛЬКО ВПЕРЕД для получения дополнительного контекста после бэктеста
      const periodDuration = endTime - startTime;
      const contextExtension = Math.max(periodDuration * 0.5, 30 * 24 * 60 * 60 * 1000); // Минимум 30 дней расширения
      
      // startTime остается НЕИЗМЕННЫМ (равным началу бэктеста)
      // endTime расширяется вперед для контекста
      endTime = endTime + contextExtension;
      
      console.log(`[TradeChartModal] Using backtest-aligned range for data fetching:`, {
        backtestRange: {
          from: props.trade.backtestTimeRange.startTime && props.trade.backtestTimeRange.startTime > 0 ? new Date(props.trade.backtestTimeRange.startTime).toISOString() : 'Invalid',
          to: props.trade.backtestTimeRange.endTime && props.trade.backtestTimeRange.endTime > 0 ? new Date(props.trade.backtestTimeRange.endTime).toISOString() : 'Invalid'
        },
        fetchRange: {
          from: startTime && startTime > 0 ? new Date(startTime).toISOString() : 'Invalid',
          to: endTime && endTime > 0 ? new Date(endTime).toISOString() : 'Invalid'
        },
        note: 'StartTime = начало бэктеста (НЕ расширяется назад), EndTime расширен для контекста'
      });
    } else {
      // Fallback: Используем широкий исторический диапазон вокруг сделки
      const tradeEntryTime = props.trade?.entryTimestamp;
      const tradeExitTime = props.trade?.exitTimestamp;
      
      if (!tradeEntryTime) {
        console.error('[TradeChartModal] No trade entry timestamp available');
        throw new Error('Нет информации о времени входа в сделку');
      }
      
      // Валидация времени сделки
      if (typeof tradeEntryTime !== 'number' || tradeEntryTime <= 0) {
        console.error('[TradeChartModal] Invalid trade entry timestamp:', tradeEntryTime);
        throw new Error('Некорректное время входа в сделку');
      }
      
      // ИСПРАВЛЕНИЕ: Логика fallback тоже учитывает принцип "не раньше времени сделки"
      // Берем время сделки как минимум, и добавляем контекст назад ТОЛЬКО если нужно
      const contextBefore = 7 * 24 * 60 * 60 * 1000; // Уменьшено до 7 дней (было 6 месяцев)
      const contextAfter = 30 * 24 * 60 * 60 * 1000; // 1 месяц после
      
      startTime = tradeEntryTime - contextBefore;
      endTime = Math.max(tradeExitTime || tradeEntryTime, tradeEntryTime) + contextAfter;
      
      console.log(`[TradeChartModal] Using conservative fallback range for data fetching:`, {
        tradeEntry: tradeEntryTime && tradeEntryTime > 0 ? new Date(tradeEntryTime).toISOString() : 'Invalid',
        tradeExit: tradeExitTime && tradeExitTime > 0 ? new Date(tradeExitTime).toISOString() : 'ongoing',
        fetchRange: {
          from: startTime && startTime > 0 ? new Date(startTime).toISOString() : 'Invalid',
          to: endTime && endTime > 0 ? new Date(endTime).toISOString() : 'Invalid'
        },
        note: 'Fallback режим - минимальный контекст вокруг сделки'
      });
    }
    
    // УЛУЧШЕННАЯ ВАЛИДАЦИЯ временного диапазона
    const earliestReasonableDate = new Date('2020-01-01').getTime();
    const latestReasonableDate = Date.now() + 30 * 24 * 60 * 60 * 1000; // Максимум месяц в будущем
    
    if (startTime < earliestReasonableDate) {
      console.warn(`[TradeChartModal] Start time too early, adjusting:`, startTime && startTime > 0 ? new Date(startTime).toISOString() : 'Invalid');
      startTime = earliestReasonableDate;
    }
    
    if (endTime > latestReasonableDate) {
      console.warn(`[TradeChartModal] End time too late, adjusting:`, endTime && endTime > 0 ? new Date(endTime).toISOString() : 'Invalid');
      endTime = latestReasonableDate;
    }
    
    if (startTime >= endTime) {
      console.error(`[TradeChartModal] Invalid time range after validation:`, {
        startTime: startTime && startTime > 0 ? new Date(startTime).toISOString() : 'Invalid',
        endTime: endTime && endTime > 0 ? new Date(endTime).toISOString() : 'Invalid'
      });
      throw new Error('Некорректный временной диапазон после валидации');
    }
    
    // Проверяем, что timestamps валидны для создания Date объектов
    try {
      if (startTime && startTime > 0) new Date(startTime).toISOString();
      if (endTime && endTime > 0) new Date(endTime).toISOString();
    } catch (error) {
      console.error(`[TradeChartModal] Invalid timestamp values:`, { startTime, endTime, error });
      throw new Error('Некорректные значения времени');
    }
    
    console.log(`[TradeChartModal] Final fetch parameters:`, {
      symbol,
      timeframe,
      startTime,
      endTime,
      period: `${Math.floor((endTime - startTime) / (24 * 60 * 60 * 1000))} дней`,
      range: {
        from: startTime && startTime > 0 ? new Date(startTime).toISOString() : 'Invalid',
        to: endTime && endTime > 0 ? new Date(endTime).toISOString() : 'Invalid'
      }
    });

    const response = await fetch('/api/data/fetch-candles', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        symbol: symbol,
        timeframes: [timeframe], // API ожидает массив timeframes
        startTime: startTime,
        endTime: endTime,
        limit: 15000, // Увеличенный лимит для массовой загрузки
        exchange: settingsStore.selectedExchange || 'bybit'  // НОВОЕ: передаем выбранную биржу
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[TradeChartModal] API request failed:`, {
        status: response.status,
        statusText: response.statusText,
        errorText
      });
      throw new Error(`API request failed: ${response.status} ${response.statusText}. ${errorText}`);
    }

    const result = await response.json();
    
    console.log(`[TradeChartModal] Data fetch job response:`, result);

    // ИСПРАВЛЕННАЯ ЛОГИКА: Определяем успех по содержанию сообщения, а не только по флагу success
    const isActuallySuccessful = result.success || 
                                (result.message && result.message.includes('Successfully added')) ||
                                (result.jobIds && result.jobIds.length > 0) ||
                                (result.totalSuccessfullyQueued && result.totalSuccessfullyQueued > 0);

    if (isActuallySuccessful) {
      if (result.jobIds && result.jobIds.length > 0) {
        const jobId = result.jobIds[0]; // Берем первый jobId из массива
        toast.add({
          severity: 'success',
          summary: 'Задача создана',
          detail: `Загрузка данных ${symbol} (${timeframe}) запущена в фоновом режиме. ID: ${jobId}`,
          life: 8000
        });
      } else if (result.totalSuccessfullyQueued && result.totalSuccessfullyQueued > 0) {
        toast.add({
          severity: 'success',
          summary: 'Данные обрабатываются',
          detail: `Загрузка данных ${symbol} (${timeframe}) запущена. ${result.message || ''}`,
          life: 5000
        });
      } else if (result.message && result.message.includes('Successfully added')) {
        // Обрабатываем успешные сообщения от API
        toast.add({
          severity: 'success',
          summary: 'Задача создана',
          detail: result.message,
          life: 8000
        });
      } else {
        toast.add({
          severity: 'info',
          summary: 'Данные загружены',
          detail: result.message || `Данные для ${symbol} (${timeframe}) обновлены.`,
          life: 5000
        });
      }
      
      // Ждем некоторое время и перезагружаем данные
      setTimeout(() => {
        console.log(`[TradeChartModal] Reloading timeframe data after fetch job...`);
        loadTimeframeData(timeframe);
      }, 3000);
      
    } else {
      throw new Error(result.message || 'Неизвестная ошибка при запуске загрузки данных');
    }

  } catch (error: any) {
    console.error(`[TradeChartModal] Error fetching missing data:`, error);
    
    toast.add({
      severity: 'error',
      summary: 'Ошибка загрузки',
      detail: `Не удалось запустить загрузку данных: ${error.message}`,
      life: 7000
    });
  } finally {
    isLoadingData.value = false;
  }
};

// Инициализация при открытии модального окна
const initializeModal = () => {
  if (!props.trade) return;
  
  // Устанавливаем таймфрейм бектеста как начальный
  const btTimeframe = props.trade.backtestTimeframe || '1h';
  selectedTimeframe.value = btTimeframe;
  currentTimeframe.value = btTimeframe;
  
  console.log(`[TradeChartModal] Initialized with backtest timeframe: ${btTimeframe}`);
  
  // Если есть данные из пропсов, используем их
  if (props.candleData && props.candleData.length > 0) {
    console.log('[TradeChartModal] Using initial data from props');
    currentCandleData.value = props.candleData;
  } else {
    console.log('[TradeChartModal] No initial data, will need to load');
    currentCandleData.value = null;
  }
};
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

/* Стили для dropdown таймфрейма */
:deep(.timeframe-dropdown) {
  min-width: 100px;
}

:deep(.timeframe-dropdown .p-dropdown-label) {
  font-size: 0.875rem;
  font-weight: 500;
}

/* Улучшенные кнопки быстрого доступа */
.quick-timeframe-buttons {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.quick-timeframe-buttons .p-button {
  font-size: 0.75rem;
  padding: 0.25rem 0.5rem;
  min-width: 2.5rem;
}

/* Индикатор текущего таймфрейма */
.current-timeframe-indicator {
  background: rgba(59, 130, 246, 0.1);
  border: 1px solid rgba(59, 130, 246, 0.3);
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 0.75rem;
  font-weight: 500;
  color: #2563eb;
}
</style> 