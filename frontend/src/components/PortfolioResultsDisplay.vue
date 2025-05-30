<template>
  <div class="portfolio-results-display">
    <div v-if="portfolioResults" class="space-y-6">
      <!-- Предупреждение о парах без данных -->
      <div v-if="pairsWithoutData.length > 0" class="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <div class="flex items-start">
          <i class="pi pi-exclamation-triangle text-yellow-600 mt-1 mr-2"></i>
          <div>
            <h4 class="text-sm font-medium text-yellow-800 mb-1">Внимание: Недостающие данные</h4>
            <p class="text-sm text-yellow-700">
              Для следующих пар отсутствуют данные в портфельном тесте: 
              <strong>{{ pairsWithoutData.join(', ') }}</strong>
            </p>
            <p class="text-xs text-yellow-600 mt-1">
              Это может повлиять на точность результатов портфеля. Рекомендуется загрузить недостающие данные.
            </p>
          </div>
        </div>
      </div>

      <!-- Общие метрики портфеля -->
      <div class="bg-white rounded-lg shadow p-6">
        <h3 class="text-xl font-semibold text-gray-900 mb-4 flex items-center">
          <i class="pi pi-chart-pie mr-2 text-blue-600"></i>
          Общие результаты портфеля
        </h3>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div class="bg-gradient-to-r from-green-50 to-green-100 p-4 rounded-lg">
            <div class="text-sm text-green-600 font-medium">Общий PnL</div>
            <div class="text-2xl font-bold" :class="portfolioResults.overallMetrics.totalPortfolioPnl >= 0 ? 'text-green-700' : 'text-red-700'">
              ${{ portfolioResults.overallMetrics.totalPortfolioPnl.toFixed(2) }}
            </div>
          </div>
          <div class="bg-gradient-to-r from-blue-50 to-blue-100 p-4 rounded-lg">
            <div class="text-sm text-blue-600 font-medium">Всего сделок</div>
            <div class="text-2xl font-bold text-blue-700">
              {{ portfolioResults.overallMetrics.totalPortfolioTrades }}
            </div>
          </div>
          <div class="bg-gradient-to-r from-purple-50 to-purple-100 p-4 rounded-lg">
            <div class="text-sm text-purple-600 font-medium">Винрейт</div>
            <div class="text-2xl font-bold text-purple-700">
              {{ (portfolioResults.overallMetrics.portfolioWinRate * 100).toFixed(1) }}%
            </div>
          </div>
          <div class="bg-gradient-to-r from-orange-50 to-orange-100 p-4 rounded-lg">
            <div class="text-sm text-orange-600 font-medium">Sharpe Ratio</div>
            <div class="text-2xl font-bold text-orange-700">
              {{ portfolioResults.overallMetrics.sharpeRatioPortfolio.toFixed(2) }}
            </div>
          </div>
        </div>
        
        <div class="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div class="bg-gray-50 p-4 rounded-lg">
            <div class="text-sm text-gray-600">Начальный капитал</div>
            <div class="text-lg font-semibold text-gray-800">
              ${{ portfolioResults.overallMetrics.initialPortfolioCapital.toLocaleString() }}
            </div>
          </div>
          <div class="bg-gray-50 p-4 rounded-lg">
            <div class="text-sm text-gray-600">Финальный капитал</div>
            <div class="text-lg font-semibold text-gray-800">
              ${{ portfolioResults.overallMetrics.finalPortfolioCapital.toLocaleString() }}
            </div>
          </div>
          <div class="bg-gray-50 p-4 rounded-lg">
            <div class="text-sm text-gray-600">ROI</div>
            <div class="text-lg font-semibold" :class="calculateROI() >= 0 ? 'text-green-600' : 'text-red-600'">
              {{ calculateROI().toFixed(2) }}%
            </div>
          </div>
        </div>

        <div class="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="bg-indigo-50 p-4 rounded-lg">
            <div class="text-sm text-indigo-600">Среднее количество одновременных сделок</div>
            <div class="text-lg font-semibold text-indigo-700">
              {{ portfolioResults.overallMetrics.avgConcurrentTrades.toFixed(1) }}
            </div>
          </div>
          <div class="bg-indigo-50 p-4 rounded-lg">
            <div class="text-sm text-indigo-600">Пиковое количество одновременных сделок</div>
            <div class="text-lg font-semibold text-indigo-700">
              {{ portfolioResults.overallMetrics.peakConcurrentTrades }}
            </div>
          </div>
        </div>
      </div>

      <!-- Результаты по парам -->
      <div class="bg-white rounded-lg shadow p-6">
        <h3 class="text-xl font-semibold text-gray-900 mb-4 flex items-center">
          <i class="pi pi-list mr-2 text-green-600"></i>
          Результаты по торговым парам
        </h3>
        <DataTable 
          :value="pairSummaryData" 
          responsiveLayout="scroll" 
          :paginator="false"
          stripedRows
          sortMode="single"
          :emptyMessage="'Нет данных для отображения'"
          :scrollable="false"
          class="compact-table"
        >
          <Column field="pair" header="Торговая пара" :sortable="true" style="width: 110px; max-width: 110px;">
            <template #body="slotProps">
              <Badge :value="slotProps.data.pair" severity="info" />
            </template>
          </Column>
          <Column field="trades" header="Сделок" :sortable="true" style="width: 70px; max-width: 70px;">
            <template #body="slotProps">
              <span class="font-medium">{{ slotProps.data.trades || 0 }}</span>
            </template>
          </Column>
          <Column field="pnl" header="PnL ($)" :sortable="true" style="width: 90px; max-width: 90px;">
            <template #body="slotProps">
              <span :class="(slotProps.data.pnl || 0) >= 0 ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'">
                ${{ (slotProps.data.pnl || 0).toFixed(2) }}
              </span>
            </template>
          </Column>
          <Column field="winRate" header="Винрейт (%)" :sortable="true" style="width: 100px; max-width: 100px;">
            <template #body="slotProps">
              <div class="win-rate-container">
                <ProgressBar :value="(slotProps.data.winRate || 0) * 100" :showValue="false" style="height: 1rem; width: 100%;" />
                <div class="text-center text-xs font-medium mt-1">
                  {{ ((slotProps.data.winRate || 0) * 100).toFixed(1) }}%
                </div>
              </div>
            </template>
          </Column>
          <Column field="avgTrade" header="Сред. сделка ($)" :sortable="true" style="width: 100px; max-width: 100px;">
            <template #body="slotProps">
              <span :class="(slotProps.data.avgTrade || 0) >= 0 ? 'text-green-600' : 'text-red-600'">
                ${{ (slotProps.data.avgTrade || 0).toFixed(2) }}
              </span>
            </template>
          </Column>
          <Column field="profitFactor" header="Profit Factor" :sortable="true" style="width: 90px; max-width: 90px;">
            <template #body="slotProps">
              <span class="font-medium" :class="(slotProps.data.profitFactor || 0) >= 1 ? 'text-green-600' : 'text-red-600'">
                {{ (slotProps.data.profitFactor || 0).toFixed(2) }}
              </span>
            </template>
          </Column>
        </DataTable>
      </div>
    </div>

    <div v-else class="text-center py-12">
      <i class="pi pi-chart-line text-6xl text-gray-300 mb-4"></i>
      <h3 class="text-xl text-gray-500 mb-2">Результаты портфельного бектеста</h3>
      <p class="text-gray-400">Запустите портфельный бектест для просмотра результатов</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';
import Badge from 'primevue/badge';
import ProgressBar from 'primevue/progressbar';
import type { PortfolioBacktestResult } from '@/types/strategy';

interface Props {
  portfolioResults: PortfolioBacktestResult | null;
}

const props = defineProps<Props>();

// Вычисляем ROI
const calculateROI = () => {
  if (!props.portfolioResults) return 0;
  const initial = props.portfolioResults.overallMetrics.initialPortfolioCapital;
  const final = props.portfolioResults.overallMetrics.finalPortfolioCapital;
  return ((final - initial) / initial) * 100;
};

// Определяем пары без данных
const pairsWithoutData = computed(() => {
  if (!props.portfolioResults) return [];
  
  const configuredPairs = props.portfolioResults.configUsed?.pairSymbols || [];
  const pairsWithTrades = Object.keys(props.portfolioResults.tradesByPair);
  
  return configuredPairs.filter(pair => 
    !pairsWithTrades.includes(pair) || 
    props.portfolioResults!.tradesByPair[pair].length === 0
  );
});

// Подготавливаем данные для таблицы по парам
const pairSummaryData = computed(() => {
  if (!props.portfolioResults || !props.portfolioResults.tradesByPair) return [];
  
  try {
    return Object.entries(props.portfolioResults.tradesByPair).map(([pair, trades]) => {
      if (!trades || !Array.isArray(trades)) {
        return {
          pair: pair || 'Unknown',
          trades: 0,
          pnl: 0,
          winRate: 0,
          avgTrade: 0,
          profitFactor: 0,
        };
      }

      const metrics = props.portfolioResults?.metricsByPair?.[pair];
      const pnl = trades.reduce((sum, trade) => sum + (trade?.pnl || 0), 0);
      const winningTrades = trades.filter(trade => (trade?.pnl || 0) > 0).length;
      const winRate = trades.length > 0 ? winningTrades / trades.length : 0;
      const avgTrade = trades.length > 0 ? pnl / trades.length : 0;
      
      return {
        pair: pair || 'Unknown',
        trades: trades.length || 0,
        pnl: pnl || 0,
        winRate: winRate || 0,
        avgTrade: avgTrade || 0,
        profitFactor: metrics?.profitFactor || 0,
      };
    });
  } catch (error) {
    console.error('Error processing pair summary data:', error);
    return [];
  }
});
</script>

<style scoped>
.portfolio-results-display {
  /* Дополнительные стили при необходимости */
}

/* Стили для компактных таблиц */
:deep(.compact-table) {
  font-size: 0.875rem;
}

:deep(.compact-table .p-datatable-wrapper) {
  overflow-x: auto;
  max-width: 100%;
}

:deep(.compact-table .p-datatable-table) {
  table-layout: fixed;
  width: 100%;
}

:deep(.compact-table .p-column-header-content) {
  padding: 0.5rem 0.25rem;
  font-size: 0.75rem;
  font-weight: 600;
}

:deep(.compact-table .p-datatable-tbody > tr > td) {
  padding: 0.4rem 0.25rem;
  word-wrap: break-word;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Исправление для скроллбара */
:deep(.compact-table .p-datatable-scrollable-wrapper) {
  overflow: visible;
}

:deep(.compact-table .p-datatable-scrollable-body) {
  overflow: visible;
}

/* Стили для контейнера винрейта */
.win-rate-container {
  width: 100%;
  max-width: 100px;
}

:deep(.win-rate-container .p-progressbar) {
  height: 1rem !important;
  border-radius: 4px;
}

:deep(.win-rate-container .p-progressbar .p-progressbar-value) {
  border-radius: 4px;
}
</style> 