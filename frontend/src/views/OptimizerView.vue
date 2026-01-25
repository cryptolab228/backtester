<template>
  <div class="p-4 surface-ground min-h-screen">
    <div class="flex justify-between items-center mb-6">
      <h1 class="text-3xl font-bold text-gray-900">
        <i class="pi pi-sliders-h mr-2"></i>
        Оптимизатор параметров
      </h1>
      <div class="flex items-center gap-2">
        <Tag v-if="optimizerStore.isRunning" severity="warning" value="Выполняется" />
        <Tag v-else-if="optimizerStore.isCompleted" severity="success" value="Завершено" />
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <!-- Левая колонка: Настройки -->
      <div class="lg:col-span-2 space-y-4">
        
        <!-- Выбор пар и периода -->
        <Card>
          <template #title>
            <div class="flex items-center">
              <i class="pi pi-chart-line mr-2"></i>
              Данные для оптимизации
            </div>
          </template>
          <template #content>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Торговые пары</label>
                <MultiSelect
                  v-model="optimizerStore.config.pairSymbols"
                  :options="availablePairs"
                  placeholder="Выберите пары"
                  :maxSelectedLabels="3"
                  class="w-full"
                  filter
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Таймфрейм</label>
                <Dropdown
                  v-model="optimizerStore.config.timeframe"
                  :options="timeframes"
                  optionLabel="label"
                  optionValue="value"
                  placeholder="Выберите таймфрейм"
                  class="w-full"
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Дата начала</label>
                <Calendar
                  v-model="startDate"
                  dateFormat="yy-mm-dd"
                  showIcon
                  class="w-full"
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Дата окончания</label>
                <Calendar
                  v-model="endDate"
                  dateFormat="yy-mm-dd"
                  showIcon
                  class="w-full"
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Биржа</label>
                <Dropdown
                  v-model="optimizerStore.config.exchange"
                  :options="exchanges"
                  optionLabel="label"
                  optionValue="value"
                  class="w-full"
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Целевая функция</label>
                <Dropdown
                  v-model="optimizerStore.config.objectiveFunction"
                  :options="objectiveFunctions"
                  optionLabel="label"
                  optionValue="value"
                  class="w-full"
                />
              </div>
            </div>
          </template>
        </Card>

        <!-- Параметры для оптимизации -->
        <Card>
          <template #title>
            <div class="flex items-center justify-between">
              <div class="flex items-center">
                <i class="pi pi-cog mr-2"></i>
                Параметры для оптимизации
              </div>
              <Button 
                icon="pi pi-plus" 
                label="Добавить" 
                size="small" 
                outlined
                @click="showAddParameterDialog = true"
              />
            </div>
          </template>
          <template #content>
            <div class="space-y-4">
              <div 
                v-for="(param, key) in optimizerStore.config.parameterGrid" 
                :key="key"
                class="p-3 bg-gray-50 rounded-lg"
              >
                <div class="flex items-center justify-between mb-2">
                  <span class="font-medium text-gray-800">{{ formatParameterName(key) }}</span>
                  <Button 
                    icon="pi pi-trash" 
                    severity="danger" 
                    text 
                    size="small"
                    @click="optimizerStore.removeParameter(key)"
                  />
                </div>
                
                <!-- Range параметр -->
                <div v-if="isRange(param)" class="grid grid-cols-3 gap-3">
                  <div>
                    <label class="text-xs text-gray-500">Min</label>
                    <InputNumber 
                      v-model="param.min" 
                      :minFractionDigits="1"
                      :maxFractionDigits="2"
                      class="w-full"
                      size="small"
                    />
                  </div>
                  <div>
                    <label class="text-xs text-gray-500">Max</label>
                    <InputNumber 
                      v-model="param.max" 
                      :minFractionDigits="1"
                      :maxFractionDigits="2"
                      class="w-full"
                      size="small"
                    />
                  </div>
                  <div>
                    <label class="text-xs text-gray-500">Шаг</label>
                    <InputNumber 
                      v-model="param.step" 
                      :minFractionDigits="1"
                      :maxFractionDigits="2"
                      class="w-full"
                      size="small"
                    />
                  </div>
                </div>
                
                <!-- Values параметр -->
                <div v-else class="flex items-center gap-2">
                  <Chips 
                    v-model="param.values" 
                    separator="," 
                    class="w-full"
                  />
                </div>
              </div>
              
              <div v-if="Object.keys(optimizerStore.config.parameterGrid).length === 0" class="text-center text-gray-500 py-4">
                Добавьте параметры для оптимизации
              </div>
            </div>
            
            <div class="mt-4 p-3 bg-blue-50 rounded-lg">
              <div class="flex items-center justify-between">
                <span class="text-sm text-blue-800">
                  <i class="pi pi-calculator mr-1"></i>
                  Всего комбинаций: <strong>{{ optimizerStore.estimatedCombinations }}</strong>
                </span>
                <span class="text-xs text-blue-600">
                  Макс: {{ optimizerStore.config.maxCombinations }}
                </span>
              </div>
            </div>
          </template>
        </Card>

        <!-- Ограничения (Hard Constraints) -->
        <Card>
          <template #title>
            <div class="flex items-center">
              <i class="pi pi-filter mr-2"></i>
              Ограничения (Hard Constraints)
            </div>
          </template>
          <template #content>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label class="block text-xs text-gray-500 mb-1">Max Drawdown %</label>
                <InputNumber 
                  v-model="optimizerStore.config.constraints.maxDrawdownLimit" 
                  suffix="%"
                  class="w-full"
                  size="small"
                />
              </div>
              <div>
                <label class="block text-xs text-gray-500 mb-1">Min Trades</label>
                <InputNumber 
                  v-model="optimizerStore.config.constraints.minTradesCount" 
                  class="w-full"
                  size="small"
                />
              </div>
              <div>
                <label class="block text-xs text-gray-500 mb-1">Min Win Rate %</label>
                <InputNumber 
                  v-model="optimizerStore.config.constraints.minWinRate" 
                  suffix="%"
                  class="w-full"
                  size="small"
                />
              </div>
              <div>
                <label class="block text-xs text-gray-500 mb-1">Max OOS Drop %</label>
                <InputNumber 
                  v-model="optimizerStore.config.constraints.maxOosPerformanceDrop" 
                  suffix="%"
                  class="w-full"
                  size="small"
                />
              </div>
            </div>
          </template>
        </Card>

        <!-- Walk-Forward Analysis настройки (ТЗ 2.1) -->
        <Card>
          <template #title>
            <div class="flex items-center justify-between">
              <div class="flex items-center">
                <i class="pi pi-sync mr-2"></i>
                Walk-Forward Analysis
              </div>
              <ToggleSwitch v-model="optimizerStore.config.walkForward.enabled" />
            </div>
          </template>
          <template #content>
            <div v-if="optimizerStore.config.walkForward.enabled" class="space-y-4">
              <div class="grid grid-cols-3 gap-4">
                <div>
                  <label class="block text-xs text-gray-500 mb-1">Окно обучения (мес)</label>
                  <InputNumber 
                    v-model="optimizerStore.config.walkForward.trainWindowMonths" 
                    :min="3"
                    :max="24"
                    class="w-full"
                    size="small"
                  />
                </div>
                <div>
                  <label class="block text-xs text-gray-500 mb-1">Окно теста (мес)</label>
                  <InputNumber 
                    v-model="optimizerStore.config.walkForward.testWindowMonths" 
                    :min="1"
                    :max="6"
                    class="w-full"
                    size="small"
                  />
                </div>
                <div>
                  <label class="block text-xs text-gray-500 mb-1">Сдвиг окна (мес)</label>
                  <InputNumber 
                    v-model="optimizerStore.config.walkForward.stepMonths" 
                    :min="1"
                    :max="6"
                    class="w-full"
                    size="small"
                  />
                </div>
              </div>
              <div class="p-3 bg-blue-50 rounded-lg text-xs text-blue-800">
                <div class="font-medium mb-1">Алгоритм скользящего окна:</div>
                <div>1. Оптимизация на {{ optimizerStore.config.walkForward.trainWindowMonths }} мес → Тест на {{ optimizerStore.config.walkForward.testWindowMonths }} мес</div>
                <div>2. Сдвиг на {{ optimizerStore.config.walkForward.stepMonths }} мес → Повторение</div>
                <div class="mt-1 text-blue-600">Это исключает подгонку под историю (Overfitting)</div>
              </div>
            </div>
            <div v-else class="text-sm text-orange-600">
              <i class="pi pi-exclamation-triangle mr-1"></i>
              Walk-Forward отключен. Результаты могут быть переоптимизированы!
            </div>
          </template>
        </Card>
      </div>

      <!-- Правая колонка: Прогресс и результаты -->
      <div class="space-y-4">
        
        <!-- Кнопка запуска -->
        <Card>
          <template #content>
            <div class="space-y-4">
              <Button 
                v-if="!optimizerStore.isRunning"
                label="Запустить оптимизацию" 
                icon="pi pi-play" 
                class="w-full"
                size="large"
                :disabled="!canStart"
                @click="startOptimization"
              />
              <Button 
                v-else
                label="Отменить" 
                icon="pi pi-stop" 
                severity="danger"
                class="w-full"
                size="large"
                @click="optimizerStore.cancelOptimization"
              />
              
              <div v-if="optimizerStore.error" class="p-3 bg-red-50 text-red-700 rounded-lg text-sm">
                <i class="pi pi-exclamation-triangle mr-1"></i>
                {{ optimizerStore.error }}
              </div>
            </div>
          </template>
        </Card>

        <!-- Прогресс -->
        <Card v-if="optimizerStore.progress">
          <template #title>
            <div class="flex items-center">
              <i class="pi pi-spinner pi-spin mr-2" v-if="optimizerStore.isRunning"></i>
              <i class="pi pi-check-circle mr-2 text-green-500" v-else></i>
              Прогресс
            </div>
          </template>
          <template #content>
            <div class="space-y-3">
              <ProgressBar :value="optimizerStore.progressPercent" />
              
              <div class="grid grid-cols-2 gap-2 text-sm">
                <div class="text-gray-500">Комбинаций:</div>
                <div class="text-right font-medium">
                  {{ optimizerStore.progress.completedCombinations }} / {{ optimizerStore.progress.totalCombinations }}
                </div>
                
                <div class="text-gray-500">Время:</div>
                <div class="text-right font-medium">
                  {{ formatTime(optimizerStore.progress.elapsedTime) }}
                </div>
              </div>
              
              <div v-if="optimizerStore.progress.bestResultSoFar" class="p-2 bg-green-50 rounded text-sm">
                <div class="font-medium text-green-800 mb-1">Лучший результат:</div>
                <div class="text-green-700">
                  Calmar: {{ optimizerStore.progress.bestResultSoFar.calmarRatio.toFixed(2) }} |
                  Profit: {{ optimizerStore.progress.bestResultSoFar.netProfitPercent.toFixed(1) }}%
                </div>
              </div>
            </div>
          </template>
        </Card>

        <!-- Лучший результат -->
        <Card v-if="optimizerStore.bestResult">
          <template #title>
            <div class="flex items-center text-green-700">
              <i class="pi pi-trophy mr-2"></i>
              Лучший результат
            </div>
          </template>
          <template #content>
            <div class="space-y-3">
              <div class="grid grid-cols-2 gap-2 text-sm">
                <div class="text-gray-500">Net Profit:</div>
                <div class="text-right font-bold" :class="optimizerStore.bestResult.netProfitPercent >= 0 ? 'text-green-600' : 'text-red-600'">
                  {{ optimizerStore.bestResult.netProfitPercent.toFixed(2) }}%
                </div>
                
                <div class="text-gray-500">Max Drawdown:</div>
                <div class="text-right font-medium text-red-600">
                  {{ optimizerStore.bestResult.maxDrawdownPercent.toFixed(2) }}%
                </div>
                
                <div class="text-gray-500">Calmar Ratio:</div>
                <div class="text-right font-bold text-blue-600">
                  {{ optimizerStore.bestResult.calmarRatio.toFixed(2) }}
                </div>
                
                <div class="text-gray-500">Win Rate:</div>
                <div class="text-right font-medium">
                  {{ optimizerStore.bestResult.winRate.toFixed(1) }}%
                </div>
                
                <div class="text-gray-500">Trades:</div>
                <div class="text-right font-medium">
                  {{ optimizerStore.bestResult.totalTrades }}
                </div>
                
                <div class="text-gray-500">OOS Status:</div>
                <div class="text-right">
                  <Tag 
                    :severity="optimizerStore.bestResult.oosStatus === 'passed' ? 'success' : optimizerStore.bestResult.oosStatus === 'failed' ? 'danger' : 'secondary'"
                    :value="optimizerStore.bestResult.oosStatus === 'passed' ? 'Passed' : optimizerStore.bestResult.oosStatus === 'failed' ? 'Failed' : 'N/A'"
                  />
                </div>
              </div>
              
              <Divider />
              
              <div class="text-xs text-gray-600">
                <div class="font-medium mb-1">Параметры:</div>
                <div v-for="(value, key) in optimizerStore.bestResult.parameters" :key="key" class="flex justify-between">
                  <span>{{ formatParameterName(key) }}:</span>
                  <span class="font-medium">{{ value }}</span>
                </div>
              </div>
            </div>
          </template>
        </Card>

        <!-- Экспорт -->
        <Card v-if="optimizerStore.result">
          <template #content>
            <div class="space-y-2">
              <Button 
                label="Скачать CSV" 
                icon="pi pi-download" 
                outlined
                class="w-full"
                @click="optimizerStore.downloadCSV(optimizerStore.result!.jobId)"
              />
              <div class="text-xs text-gray-500 text-center">
                Валидных: {{ optimizerStore.result.validCombinations }} / {{ optimizerStore.result.totalCombinations }}
              </div>
            </div>
          </template>
        </Card>
      </div>
    </div>

    <!-- Таблица результатов -->
    <Card v-if="optimizerStore.topResults.length > 0" class="mt-6">
      <template #title>
        <div class="flex items-center">
          <i class="pi pi-list mr-2"></i>
          Топ-20 результатов
        </div>
      </template>
      <template #content>
        <DataTable 
          :value="optimizerStore.topResults" 
          :paginator="true" 
          :rows="10"
          stripedRows
          class="text-sm"
        >
          <Column field="rank" header="#" style="width: 50px">
            <template #body="{ index }">{{ index + 1 }}</template>
          </Column>
          <Column header="ADX Trend">
            <template #body="{ data }">{{ data.parameters.adx_trend_threshold || '-' }}</template>
          </Column>
          <Column header="ADX Range">
            <template #body="{ data }">{{ data.parameters.adx_range_threshold || '-' }}</template>
          </Column>
          <Column header="NWE Mult">
            <template #body="{ data }">{{ data.parameters.nwe_multiplier?.toFixed(1) || '-' }}</template>
          </Column>
          <Column header="SL ATR">
            <template #body="{ data }">{{ data.parameters.stop_loss_atr_multiplier?.toFixed(1) || '-' }}</template>
          </Column>
          <Column field="netProfitPercent" header="Profit %" sortable>
            <template #body="{ data }">
              <span :class="data.netProfitPercent >= 0 ? 'text-green-600' : 'text-red-600'">
                {{ data.netProfitPercent.toFixed(2) }}%
              </span>
            </template>
          </Column>
          <Column field="maxDrawdownPercent" header="Max DD %" sortable>
            <template #body="{ data }">
              <span class="text-red-600">{{ data.maxDrawdownPercent.toFixed(2) }}%</span>
            </template>
          </Column>
          <Column field="calmarRatio" header="Calmar" sortable>
            <template #body="{ data }">
              <span class="font-bold text-blue-600">{{ data.calmarRatio.toFixed(2) }}</span>
            </template>
          </Column>
          <Column field="winRate" header="Win %" sortable>
            <template #body="{ data }">{{ data.winRate.toFixed(1) }}%</template>
          </Column>
          <Column field="totalTrades" header="Trades" sortable />
          <Column field="oosStatus" header="OOS">
            <template #body="{ data }">
              <Tag 
                :severity="data.oosStatus === 'passed' ? 'success' : data.oosStatus === 'failed' ? 'danger' : 'secondary'"
                :value="data.oosStatus === 'passed' ? '✓' : data.oosStatus === 'failed' ? '✗' : '-'"
              />
            </template>
          </Column>
        </DataTable>
      </template>
    </Card>

    <!-- Диалог добавления параметра -->
    <Dialog v-model:visible="showAddParameterDialog" header="Добавить параметр" :style="{ width: '400px' }">
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">Параметр</label>
          <Dropdown
            v-model="newParameterKey"
            :options="availableParameters"
            optionLabel="label"
            optionValue="value"
            placeholder="Выберите параметр"
            class="w-full"
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">Тип</label>
          <div class="flex gap-4">
            <div class="flex items-center">
              <RadioButton v-model="newParameterType" inputId="range" value="range" />
              <label for="range" class="ml-2">Диапазон</label>
            </div>
            <div class="flex items-center">
              <RadioButton v-model="newParameterType" inputId="values" value="values" />
              <label for="values" class="ml-2">Значения</label>
            </div>
          </div>
        </div>
      </div>
      <template #footer>
        <Button label="Отмена" text @click="showAddParameterDialog = false" />
        <Button label="Добавить" @click="addParameter" :disabled="!newParameterKey" />
      </template>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useOptimizerStore } from '@/stores/optimizerStore';
import { useSettingsStore } from '@/stores/settingsStore';
import Card from 'primevue/card';
import Button from 'primevue/button';
import MultiSelect from 'primevue/multiselect';
import Dropdown from 'primevue/dropdown';
import Calendar from 'primevue/calendar';
import InputNumber from 'primevue/inputnumber';
import ToggleSwitch from 'primevue/toggleswitch';
import Slider from 'primevue/slider';
import ProgressBar from 'primevue/progressbar';
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';
import Tag from 'primevue/tag';
import Divider from 'primevue/divider';
import Dialog from 'primevue/dialog';
import RadioButton from 'primevue/radiobutton';
import Chips from 'primevue/chips';

const optimizerStore = useOptimizerStore();
const settingsStore = useSettingsStore();

// Local state
const startDate = ref<Date | null>(null);
const endDate = ref<Date | null>(null);
const showAddParameterDialog = ref(false);
const newParameterKey = ref('');
const newParameterType = ref<'range' | 'values'>('range');

// Options
const timeframes = [
  { label: '1 минута', value: '1m' },
  { label: '5 минут', value: '5m' },
  { label: '15 минут', value: '15m' },
  { label: '1 час', value: '1h' },
  { label: '4 часа', value: '4h' },
  { label: '1 день', value: '1d' }
];

const exchanges = [
  { label: 'Bybit', value: 'bybit' },
  { label: 'OKX', value: 'okx' }
];

const objectiveFunctions = [
  { label: 'Calmar Ratio (Profit/DD)', value: 'calmar_ratio' },
  { label: 'Recovery Factor', value: 'recovery_factor' },
  { label: 'Profit Factor', value: 'profit_factor' },
  { label: 'Sharpe Ratio', value: 'sharpe_ratio' }
];

const availableParameters = [
  { label: 'ADX Trend Threshold', value: 'adx_trend_threshold' },
  { label: 'ADX Range Threshold', value: 'adx_range_threshold' },
  { label: 'ADX Period', value: 'adx_period' },
  { label: 'NWE Multiplier', value: 'nwe_multiplier' },
  { label: 'NWE Period', value: 'nwe_period' },
  { label: 'Stop Loss ATR Multiplier', value: 'stop_loss_atr_multiplier' },
  { label: 'Take Profit ATR Multiplier', value: 'take_profit_atr_multiplier' },
  { label: 'Risk Per Trade %', value: 'risk_per_trade' },
  { label: 'Min Reward:Risk Ratio', value: 'min_reward_risk_ratio' },
  { label: 'DLC Period', value: 'dlc_period' },
  { label: 'Cluster Volume Threshold', value: 'cluster_volume_threshold' },
  { label: 'Cluster Delta Threshold', value: 'cluster_delta_threshold' }
];

// Computed
const availablePairs = computed(() => {
  return settingsStore.availableTradingPairs.map(p => p.symbol || p);
});

const canStart = computed(() => {
  return optimizerStore.config.pairSymbols.length > 0 &&
         optimizerStore.config.startDate &&
         optimizerStore.config.endDate &&
         Object.keys(optimizerStore.config.parameterGrid).length > 0;
});

// Watchers
watch(startDate, (val) => {
  if (val) {
    optimizerStore.config.startDate = formatDateForAPI(val);
  }
});

watch(endDate, (val) => {
  if (val) {
    optimizerStore.config.endDate = formatDateForAPI(val);
  }
});

// Methods
function formatDateForAPI(date: Date): string {
  return date.toISOString().split('T')[0];
}

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}ч ${minutes % 60}м`;
  }
  if (minutes > 0) {
    return `${minutes}м ${seconds % 60}с`;
  }
  return `${seconds}с`;
}

function formatParameterName(key: string): string {
  const names: Record<string, string> = {
    adx_threshold: 'ADX Threshold',
    adx_trend_threshold: 'ADX Trend',
    adx_range_threshold: 'ADX Range',
    adx_period: 'ADX Period',
    nwe_multiplier: 'NWE Mult',
    nwe_period: 'NWE Period',
    stop_loss_atr: 'SL ATR',
    stop_loss_atr_multiplier: 'SL ATR',
    take_profit_atr: 'TP ATR',
    take_profit_atr_multiplier: 'TP ATR',
    take_profit_type: 'TP Type',
    risk_per_trade: 'Risk %',
    min_reward_risk_ratio: 'Min R:R',
    dlc_period: 'DLC Period',
    cluster_volume_threshold: 'Vol Threshold',
    cluster_delta_threshold: 'Delta Threshold'
  };
  return names[key] || key;
}

function isRange(param: any): boolean {
  return param && 'min' in param && 'max' in param && 'step' in param;
}

function addParameter() {
  if (newParameterKey.value) {
    optimizerStore.addParameter(newParameterKey.value, newParameterType.value);
    showAddParameterDialog.value = false;
    newParameterKey.value = '';
  }
}

async function startOptimization() {
  try {
    await optimizerStore.startOptimization();
  } catch (err) {
    console.error('Failed to start optimization:', err);
  }
}

// WebSocket setup
let ws: WebSocket | null = null;

function setupWebSocket() {
  const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:5000';
  ws = new WebSocket(wsUrl);
  
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      
      if (data.type === 'OPTIMIZATION_PROGRESS') {
        optimizerStore.handleProgressUpdate(data.payload);
      } else if (data.type === 'OPTIMIZATION_COMPLETED') {
        optimizerStore.handleCompleted(data.payload);
      } else if (data.type === 'OPTIMIZATION_FAILED') {
        optimizerStore.handleFailed(data.payload);
      } else if (data.type === 'OPTIMIZATION_CANCELLED') {
        optimizerStore.handleCancelled(data.payload);
      }
    } catch (err) {
      console.error('WebSocket message parse error:', err);
    }
  };
  
  ws.onerror = (err) => {
    console.error('WebSocket error:', err);
  };
  
  ws.onclose = () => {
    setTimeout(setupWebSocket, 3000);
  };
}

onMounted(() => {
  settingsStore.fetchTradingPairs();
  setupWebSocket();
  
  // Set default dates
  const now = new Date();
  const oneYearAgo = new Date(now);
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  
  startDate.value = oneYearAgo;
  endDate.value = now;
});

onUnmounted(() => {
  if (ws) {
    ws.close();
  }
});
</script>

<style scoped>
:deep(.p-card) {
  border-radius: 0.75rem;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

:deep(.p-card .p-card-title) {
  font-size: 1rem;
  font-weight: 600;
}

:deep(.p-progressbar) {
  height: 0.5rem;
  border-radius: 0.25rem;
}

:deep(.p-datatable .p-datatable-thead > tr > th) {
  background: #f8fafc;
  font-weight: 600;
  font-size: 0.75rem;
  text-transform: uppercase;
}
</style>
