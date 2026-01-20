<template>
  <div class="portfolio-settings-form space-y-6">
    <!-- Выбор торговых пар -->
    <div>
      <label class="block text-sm font-medium text-gray-700 mb-2">
        Торговые пары для портфеля
        <span class="text-red-500">*</span>
      </label>
      <MultiSelect
        v-model="selectedPairs"
        :options="tradingPairOptions"
        option-label="label"
        option-value="value"
        placeholder="Выберите торговые пары"
        :filter="true"
        filterPlaceholder="Поиск пар"
        class="w-full"
        :maxSelectedLabels="3"
        :virtualScrollerOptions="{ itemSize: 38 }"
        :loading="isLoadingPairs"
        @filter="onFilterPairs"
      >
        <template #value="slotProps">
          <div v-if="slotProps.value && slotProps.value.length > 0" class="flex flex-wrap gap-1">
            <Chip
              v-for="pair in slotProps.value.slice(0, 3)"
              :key="pair"
              :label="pair"
              class="mr-1 mb-1"
              removable
              @remove="removePair(pair)"
            />
            <span v-if="slotProps.value.length > 3" class="text-sm text-gray-500">
              +{{ slotProps.value.length - 3 }} еще
            </span>
          </div>
          <span v-else class="text-gray-400">Выберите торговые пары</span>
        </template>
        <template #option="slotProps">
          <div class="flex items-center">
            <span>{{ slotProps.option.label }}</span>
          </div>
        </template>
      </MultiSelect>
      
      <!-- Кнопки быстрого выбора -->
      <div class="flex items-center gap-2 mt-2">
        <Button
          label="Выбрать все"
          icon="pi pi-check-circle"
          size="small"
          severity="secondary"
          outlined
          @click="selectAllPairs"
          :disabled="selectedPairs.length === tradingPairOptions.length"
          v-tooltip.bottom="'Выбрать все доступные торговые пары'"
        />
        <Button
          label="Очистить"
          icon="pi pi-times-circle"
          size="small"
          severity="secondary"
          outlined
          @click="clearAllPairs"
          :disabled="selectedPairs.length === 0"
          v-tooltip.bottom="'Очистить выбор всех пар'"
        />
        <span class="text-sm text-gray-500 ml-2">
          Выбрано: {{ selectedPairs.length }} из {{ tradingPairOptions.length }}
        </span>
      </div>
      
      <small class="text-gray-500 mt-1 block">
        Выберите 2 или более торговых пар для портфельного бектестинга
      </small>
    </div>

    <!-- Начальный капитал портфеля -->
    <div>
      <label class="block text-sm font-medium text-gray-700 mb-2">
        Начальный капитал портфеля ($)
        <span class="text-red-500">*</span>
      </label>
      <InputNumber
        v-model="portfolioCapital"
        mode="currency"
        currency="USD"
        locale="en-US"
        :minFractionDigits="0"
        :maxFractionDigits="2"
        :min="100"
        placeholder="Введите начальный капитал"
        class="w-full"
      />
      <small class="text-gray-500 mt-1 block">
        Общий капитал, который будет распределен между всеми парами
      </small>
    </div>

    <!-- Настройки портфеля -->
    <div>
      <h3 class="text-lg font-medium text-gray-900 mb-4">Настройки портфеля</h3>
      
      <div class="space-y-4">
        <!-- Максимальное количество одновременных сделок -->
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">
            Максимальное количество одновременных сделок
          </label>
          <InputNumber
            v-model="maxConcurrentTrades"
            :min="1"
            :max="50"
            placeholder="Например: 5"
            class="w-full"
          />
          <small class="text-gray-500 mt-1 block">
            Ограничение на количество открытых позиций одновременно. Пустое поле = без ограничений.
          </small>
        </div>
      </div>
    </div>

    <!-- Статистика выбранных пар -->
    <div v-if="selectedPairs && selectedPairs.length > 0" class="bg-blue-50 p-4 rounded-lg">
      <h4 class="text-sm font-medium text-blue-900 mb-2">Выбрано пар для портфеля:</h4>
      <div class="flex flex-wrap gap-2">
        <Badge
          v-for="pair in selectedPairs"
          :key="pair"
          :value="pair"
          severity="info"
          class="mr-1 mb-1"
        />
      </div>
      <p class="text-sm text-blue-700 mt-2">
        Общее количество: {{ selectedPairs.length }} пар
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import MultiSelect from 'primevue/multiselect';
import InputNumber from 'primevue/inputnumber';
import Chip from 'primevue/chip';
import Badge from 'primevue/badge';
import Button from 'primevue/button';

interface Props {
  tradingPairOptions: Array<{ label: string; value: string }>;
  modelValue: {
    pairSymbols: string[];
    initialPortfolioCapital: number;
    portfolioSettings?: {
      maxConcurrentTradesPortfolio?: number;
    };
  };
  isLoadingPairs?: boolean;
}

interface Emits {
  (e: 'update:modelValue', value: Props['modelValue']): void;
}

const props = withDefaults(defineProps<Props>(), {
  isLoadingPairs: false
});
const emit = defineEmits<Emits>();

// Computed properties для двустороннего связывания
const selectedPairs = computed({
  get: () => props.modelValue.pairSymbols || [],
  set: (value: string[]) => {
    emit('update:modelValue', {
      ...props.modelValue,
      pairSymbols: value
    });
  }
});

const portfolioCapital = computed({
  get: () => props.modelValue.initialPortfolioCapital || 10000,
  set: (value: number) => {
    emit('update:modelValue', {
      ...props.modelValue,
      initialPortfolioCapital: value
    });
  }
});

const maxConcurrentTrades = computed({
  get: () => props.modelValue.portfolioSettings?.maxConcurrentTradesPortfolio,
  set: (value: number | undefined) => {
    emit('update:modelValue', {
      ...props.modelValue,
      portfolioSettings: {
        ...props.modelValue.portfolioSettings,
        maxConcurrentTradesPortfolio: value
      }
    });
  }
});

// Метод для удаления пары
const removePair = (pairToRemove: string) => {
  const updatedPairs = selectedPairs.value.filter(pair => pair !== pairToRemove);
  selectedPairs.value = updatedPairs;
};

// Метод для выбора всех пар
const selectAllPairs = () => {
  selectedPairs.value = props.tradingPairOptions.map(option => option.value);
};

// Метод для очистки всех пар
const clearAllPairs = () => {
  selectedPairs.value = [];
};

// Валидация
watch(
  () => props.modelValue,
  (newValue) => {
    // Дополнительная валидация может быть добавлена здесь
    if (newValue.pairSymbols && newValue.pairSymbols.length < 2) {
      console.warn('Portfolio backtest requires at least 2 trading pairs');
    }
  },
  { deep: true }
);

// Оптимизированный поиск пар с дебаунсом
let filterTimeout: number | null = null;
const onFilterPairs = (event: any) => {
  // Очищаем предыдущий таймаут
  if (filterTimeout) {
    clearTimeout(filterTimeout);
  }

  // Устанавливаем новый таймаут для дебаунса
  filterTimeout = window.setTimeout(() => {
    // Используем store для оптимизированной фильтрации
    // Поскольку компонент не имеет доступа к store напрямую,
    // мы полагаемся на то, что родительский компонент обрабатывает фильтрацию
    console.log('Portfolio filter applied:', event.value);
  }, 300); // 300ms дебаунс
};
</script>

<style scoped>
.portfolio-settings-form {
  /* Дополнительные стили при необходимости */
}
</style> 