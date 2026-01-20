<template>
  <div class="portfolio-results-display space-y-6">
    <div v-if="portfolioResults">
      
      <!-- Уведомление о большом файле результатов -->
      <div v-if="portfolioResults._largeDataSavedToFile" class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <div class="flex items-start">
          <i class="pi pi-info-circle text-blue-600 text-xl mr-3 mt-1"></i>
          <div class="flex-1">
            <h4 class="text-lg font-medium text-blue-900 mb-2">Результаты сохранены в файл</h4>
            <p class="text-blue-700 mb-3">
              Результаты портфельного бэктеста очень объемные ({{portfolioResults._fullDataSize}}) и были сохранены в файл. 
              Ниже показан предварительный просмотр основных метрик.
            </p>
            <div class="flex items-center space-x-4 flex-wrap gap-2">
              <Button 
                @click="handleDownload"
                :loading="downloadState.isDownloading"
                :disabled="downloadState.isDownloading"
                severity="info"
                size="small"
                class="flex items-center"
              >
                <i class="pi pi-download mr-2"></i>
                {{ downloadState.isDownloading ? 'Скачивание...' : 'Скачать полные результаты' }}
              </Button>
              
              <Button 
                @click="testFileAccess"
                severity="secondary"
                size="small"
                outlined
                class="flex items-center"
                v-tooltip.top="'Проверить доступность файла'"
              >
                <i class="pi pi-search mr-2"></i>
                Тест доступности
              </Button>
              
              <span class="text-sm text-blue-600">
                Размер файла: {{portfolioResults._fullDataSize}}
              </span>
            </div>
            
            <!-- Прогресс скачивания -->
            <div v-if="downloadState.isDownloading" class="mt-4">
              <div class="flex justify-between text-sm text-blue-700 mb-1">
                <span>Скачивание...</span>
                <span v-if="downloadState.progress > 0">{{ downloadState.progress.toFixed(1) }}%</span>
              </div>
              <ProgressBar 
                :value="downloadState.progress" 
                :showValue="false"
                style="height: 6px;"
              />
              <div v-if="downloadState.downloadedMB > 0" class="text-xs text-blue-600 mt-1">
                Загружено: {{ downloadState.downloadedMB.toFixed(1) }}MB / {{ downloadState.totalMB.toFixed(1) }}MB
              </div>
            </div>
            
            <!-- Результат тестирования -->
            <div v-if="testResult" class="mt-4 p-3 rounded" :class="testResult.accessible ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'">
              <div class="flex items-center">
                <i :class="testResult.accessible ? 'pi pi-check-circle text-green-600' : 'pi pi-times-circle text-red-600'" class="mr-2"></i>
                <span :class="testResult.accessible ? 'text-green-800' : 'text-red-800'" class="font-medium">
                  {{ testResult.accessible ? 'Файл доступен для скачивания' : 'Файл недоступен' }}
                </span>
              </div>
              <div v-if="testResult.accessible" class="text-xs text-green-700 mt-1">
                Размер: {{ testResult.sizeMB }}MB | Тип: {{ testResult.contentType }}
              </div>
              <div v-else class="text-xs text-red-700 mt-1">
                Ошибка: {{ testResult.error || `HTTP ${testResult.status}` }}
              </div>
            </div>
            
            <p class="text-sm text-blue-600 mt-2">
              {{portfolioResults._previewNote}}
            </p>
          </div>
        </div>
      </div>
      
      <!-- Уведомление о сокращенных данных -->
      <div v-if="portfolioResults._dataReduced" class="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
        <div class="flex items-start">
          <i class="pi pi-exclamation-triangle text-yellow-600 text-lg mr-3 mt-1"></i>
          <div>
            <h4 class="text-sm font-medium text-yellow-800 mb-1">Данные сокращены</h4>
            <p class="text-sm text-yellow-700">
              Отображаются сокращенные результаты ({{portfolioResults._reducedTradesCount || 0}} из {{portfolioResults._originalTradesCount || 0}} сделок).
              {{portfolioResults._note}}
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
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div class="bg-blue-50 p-4 rounded-lg">
            <div class="text-sm text-blue-600">Общий PnL</div>
            <div class="text-2xl font-bold" :class="overallTotalPnl >= 0 ? 'text-green-600' : 'text-red-600'">
              ${{ overallTotalPnl.toFixed(2) }}
            </div>
          </div>
          <div class="bg-green-50 p-4 rounded-lg">
            <div class="text-sm text-green-600">Всего сделок</div>
            <div class="text-2xl font-bold text-green-700">
              {{ overallTotalTrades }}
            </div>
          </div>
          <div class="bg-purple-50 p-4 rounded-lg">
            <div class="text-sm text-purple-600">Винрейт</div>
            <div class="text-2xl font-bold text-purple-700">
              {{ overallWinRate.toFixed(1) }}%
            </div>
          </div>
          <div class="bg-orange-50 p-4 rounded-lg">
            <div class="text-sm text-orange-600">Profit Factor</div>
            <div class="text-2xl font-bold text-orange-700">
              {{ overallProfitFactor.toFixed(2) }}
            </div>
          </div>
        </div>
        
        <div class="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div class="bg-gray-50 p-4 rounded-lg">
            <div class="text-sm text-gray-600">Начальный капитал</div>
            <div class="text-lg font-semibold text-gray-800">
              ${{ (portfolioResults.overallMetrics.initialPortfolioCapital ?? inferredInitialCapital).toLocaleString() }}
            </div>
            <div v-if="shouldShowInferredInitial" class="text-xs text-gray-500 mt-1">
              * рассчитано из итоговых данных как ${{ inferredInitialCapital.toLocaleString() }}
            </div>
          </div>
          <div class="bg-gray-50 p-4 rounded-lg">
            <div class="text-sm text-gray-600">Финальный капитал</div>
            <div class="text-lg font-semibold text-gray-800">
              ${{ overallFinalCapital.toLocaleString() }}
            </div>
          </div>
          <div class="bg-gray-50 p-4 rounded-lg">
            <div class="text-sm text-gray-600">ROI</div>
            <div class="text-lg font-semibold" :class="overallROI >= 0 ? 'text-green-600' : 'text-red-600'">
              {{ overallROI.toFixed(2) }}%
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
                <ProgressBar :value="(slotProps.data.winRate || 0)" :showValue="false" style="height: 1rem; width: 100%;" />
                <div class="text-center text-xs font-medium mt-1">
                  {{ (slotProps.data.winRate || 0).toFixed(1) }}%
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
import { computed, ref, watch } from 'vue';
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';
import Badge from 'primevue/badge';
import ProgressBar from 'primevue/progressbar';
import Button from 'primevue/button';
import type { PortfolioBacktestResult } from '@/types/strategy';
import { 
  downloadPortfolioResults, 
  testFileAccess as testFile, 
  getPortfolioDownloadUrls,
  type ProgressCallback,
  type FileAccessTestResult,
  type DownloadResult
} from '@/utils/downloadHelper';
import { useToast } from 'primevue/usetoast';

interface Props {
  portfolioResults: PortfolioBacktestResult | null;
}

const props = defineProps<Props>();
const toast = useToast();

// Состояние скачивания и тестирования
const downloadState = ref({
  isDownloading: false,
  progress: 0,
  downloadedMB: 0,
  totalMB: 0,
});

const testResult = ref<{ 
  accessible: boolean; 
  sizeMB?: number; 
  contentType?: string; 
  error?: string; 
  status?: number;
  testedUrl?: string;
} | null>(null);

// ДИАГНОСТИКА: Логируем данные при изменении portfolioResults
watch(() => props.portfolioResults, (newResults) => {
  if (newResults) {
          console.log('[PortfolioResultsDisplay] Portfolio results received:', {
        overallMetrics: {
          totalPortfolioTrades: newResults.overallMetrics?.totalPortfolioTrades,
          totalPortfolioPnl: newResults.overallMetrics?.totalPortfolioPnl,
          portfolioWinRate: newResults.overallMetrics?.portfolioWinRate,
          portfolioWinningTrades: newResults.overallMetrics?.portfolioWinningTrades,
          portfolioLosingTrades: newResults.overallMetrics?.portfolioLosingTrades
        },
      tradesByPair: Object.fromEntries(
        Object.entries(newResults.tradesByPair || {}).map(([pair, trades]) => [
          pair, 
          { 
            count: trades?.length || 0, 
            pnl: trades?.reduce((sum, trade) => sum + (trade?.pnl || 0), 0) || 0 
          }
        ])
      ),
      metricsByPair: Object.fromEntries(
        Object.entries(newResults.metricsByPair || {}).map(([pair, metrics]) => [
          pair,
          { 
            totalTrades: metrics?.totalTrades || 0, 
            totalPnl: metrics?.totalPnl || 0 
          }
        ])
      ),
      flags: {
        dataReduced: newResults._dataReduced,
        originalTradesCount: newResults._originalTradesCount,
        reducedTradesCount: newResults._reducedTradesCount,
        largeDataSavedToFile: newResults._largeDataSavedToFile,
        fullDataSize: newResults._fullDataSize,
        note: newResults._note
      }
    });
  }
}, { immediate: true });

// Извлекаем имя файла из downloadUrl
const getFilenameFromDownloadUrl = (downloadUrl: string): string => {
  try {
    const url = new URL(downloadUrl, window.location.origin);
    const pathParts = url.pathname.split('/');
    return pathParts[pathParts.length - 1];
  } catch (error) {
    console.warn('Failed to extract filename from URL:', downloadUrl);
    // Fallback - используем timestamp
    return `portfolio-backtest-${Date.now()}.json`;
  }
};

// Реализация функции скачивания файла
const handleDownload = async (): Promise<void> => {
  if (!props.portfolioResults?._downloadUrl) {
    toast.add({
      severity: 'error',
      summary: 'Ошибка скачивания',
      detail: 'URL для скачивания не найден',
      life: 5000
    });
    return;
  }

  try {
    downloadState.value = {
      isDownloading: true,
      progress: 0,
      downloadedMB: 0,
      totalMB: 0,
    };

    const filename = getFilenameFromDownloadUrl(props.portfolioResults._downloadUrl);
    console.log(`🎯 Starting portfolio results download: ${filename}`);

    const progressCallback: ProgressCallback = (progress: number, downloaded: number, total: number) => {
      downloadState.value.progress = progress;
      downloadState.value.downloadedMB = downloaded / (1024 * 1024);
      downloadState.value.totalMB = total / (1024 * 1024);
    };

    const result: DownloadResult = await downloadPortfolioResults(filename, progressCallback);

    console.log(`✅ Download completed:`, result);
    
    toast.add({
      severity: 'success',
      summary: 'Скачивание завершено',
      detail: `Файл "${result.filename}" успешно скачан (${(result.size / 1024 / 1024).toFixed(2)}MB)`,
      life: 5000
    });

  } catch (error: any) {
    console.error('❌ Download failed:', error);
    
    toast.add({
      severity: 'error',
      summary: 'Ошибка скачивания',
      detail: error.message || 'Произошла ошибка при скачивании файла',
      life: 8000
    });
  } finally {
    downloadState.value.isDownloading = false;
  }
};

// Реализация функции тестирования доступности файла
const testFileAccess = async (): Promise<void> => {
  if (!props.portfolioResults?._downloadUrl) {
    toast.add({
      severity: 'error',
      summary: 'Ошибка тестирования',
      detail: 'URL для тестирования не найден',
      life: 5000
    });
    return;
  }

  try {
    const filename = getFilenameFromDownloadUrl(props.portfolioResults._downloadUrl);
    const urls = getPortfolioDownloadUrls(filename);
    
    console.log(`🧪 Testing file access for: ${filename}`);
    console.log(`📍 Testing URLs:`, urls);

    // Тестируем API endpoint первым
    const testApiResult: FileAccessTestResult = await testFile(urls.api);
    
    if (testApiResult.accessible) {
      testResult.value = {
        accessible: true,
        sizeMB: testApiResult.headers.contentLength ? 
          parseFloat((parseInt(testApiResult.headers.contentLength) / 1024 / 1024).toFixed(2)) : 
          undefined,
        contentType: testApiResult.headers.contentType || undefined,
        status: testApiResult.status,
        testedUrl: urls.api
      };
      
      toast.add({
        severity: 'success',
        summary: 'Файл доступен',
        detail: `Файл доступен через API endpoint (${testResult.value.sizeMB}MB)`,
        life: 5000
      });
    } else {
      // Если API не работает, пробуем статический endpoint
      const testStaticResult: FileAccessTestResult = await testFile(urls.static);
      
      if (testStaticResult.accessible) {
        testResult.value = {
          accessible: true,
          sizeMB: testStaticResult.headers.contentLength ? 
            parseFloat((parseInt(testStaticResult.headers.contentLength) / 1024 / 1024).toFixed(2)) : 
            undefined,
          contentType: testStaticResult.headers.contentType || undefined,
          status: testStaticResult.status,
          testedUrl: urls.static
        };
        
        toast.add({
          severity: 'success',
          summary: 'Файл доступен',
          detail: `Файл доступен через статический endpoint (${testResult.value.sizeMB}MB)`,
          life: 5000
        });
      } else {
        testResult.value = {
          accessible: false,
          error: testApiResult.error || `HTTP ${testApiResult.status}`,
          status: testApiResult.status,
          testedUrl: urls.api
        };
        
        toast.add({
          severity: 'error',
          summary: 'Файл недоступен',
          detail: `Не удалось получить доступ к файлу: ${testResult.value.error}`,
          life: 8000
        });
      }
    }

  } catch (error: any) {
    console.error('❌ File access test failed:', error);
    
    testResult.value = {
      accessible: false,
      error: error.message || 'Неизвестная ошибка'
    };
    
    toast.add({
      severity: 'error',
      summary: 'Ошибка тестирования',
      detail: error.message || 'Произошла ошибка при тестировании доступности файла',
      life: 8000
    });
  }
};

// Вычисляем ROI
const calculateROI = (): number => {
  if (!props.portfolioResults) return 0;
  const initial = props.portfolioResults.overallMetrics.initialPortfolioCapital ?? 0;
  const final = props.portfolioResults.overallMetrics.finalPortfolioCapital ?? 0;

  if (initial > 0) {
    return ((final - initial) / initial) * 100;
  }

  const inferredInitial = totalTrades.value > 0 ? final - totalPnl.value : final;
  return inferredInitial > 0 ? ((final - inferredInitial) / inferredInitial) * 100 : 0;
};

// Подготавливаем данные для таблицы по парам - используем metricsByPair как источник истины
const pairSummaryData = computed(() => {
  if (!props.portfolioResults || !props.portfolioResults.metricsByPair) return [];
  
  try {
    // Используем metricsByPair как источник правильных данных
    return Object.entries(props.portfolioResults.metricsByPair).map(([pair, metrics]) => {
      if (!metrics) {
        return {
          pair: pair || 'Unknown',
          trades: 0,
          pnl: 0,
          winRate: 0,
          avgTrade: 0,
          profitFactor: 0,
        };
      }

      // Используем данные из metricsByPair (они НЕ сжаты)
      const tradesCount = metrics.totalTrades || 0;
      const pnl = metrics.totalPnl || 0;
      let winRate = metrics.winRate || 0;
      // Нормализация единиц: если винрейт пришёл как доля (0..1), конвертируем в проценты (0..100)
      if (winRate <= 1 && tradesCount > 0) {
        winRate = winRate * 100;
      }
      const avgTrade = tradesCount > 0 ? pnl / tradesCount : 0;
      const profitFactor = metrics.profitFactor || 0;
      
      return {
        pair: pair,
        trades: tradesCount,
        pnl: pnl,
        winRate: winRate,
        avgTrade: avgTrade,
        profitFactor: profitFactor,
      };
    });
  } catch (error) {
    console.error('Error processing pair summary data:', error);
    return [];
  }
});

const overallTotalTrades = computed(() => props.portfolioResults?.overallMetrics.totalPortfolioTrades ?? totalTrades.value);
const overallTotalPnl = computed(() => props.portfolioResults?.overallMetrics.totalPortfolioPnl ?? totalPnl.value);
const overallWinRate = computed(() => {
  if (props.portfolioResults?.overallMetrics.portfolioWinRate !== undefined) {
    const value = props.portfolioResults.overallMetrics.portfolioWinRate;
    return value <= 1 ? value * 100 : value;
  }
  return winRate.value;
});
const overallProfitFactor = computed(() => props.portfolioResults?.overallMetrics.portfolioProfitFactor ?? profitFactor.value);
const overallFinalCapital = computed(() => props.portfolioResults?.overallMetrics.finalPortfolioCapital ?? (inferredInitialCapital.value + overallTotalPnl.value));

const totalPnl = computed(() => {
  if (!props.portfolioResults || !props.portfolioResults.metricsByPair) return 0;
  return Object.values(props.portfolioResults.metricsByPair).reduce((sum, metrics) => sum + (metrics?.totalPnl || 0), 0);
});

const inferredInitialCapital = computed(() => {
  const overall = props.portfolioResults?.overallMetrics;
  if (!overall) return 0;
  if (overall.initialPortfolioCapital && overall.initialPortfolioCapital > 0) return overall.initialPortfolioCapital;
  return totalTrades.value > 0 ? overall.finalPortfolioCapital - overallTotalPnl.value : overall.finalPortfolioCapital;
});

const shouldShowInferredInitial = computed(() => {
  const overall = props.portfolioResults?.overallMetrics;
  if (!overall) return false;
  return !overall.initialPortfolioCapital || overall.initialPortfolioCapital !== inferredInitialCapital.value;
});

const overallROI = computed(() => {
  const overall = props.portfolioResults?.overallMetrics;
  if (!overall) return calculateROI();
  const initial = overall.initialPortfolioCapital ?? inferredInitialCapital.value;
  const final = overall.finalPortfolioCapital ?? (initial + overall.totalPortfolioPnl);
  return initial > 0 ? ((final - initial) / initial) * 100 : calculateROI();
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