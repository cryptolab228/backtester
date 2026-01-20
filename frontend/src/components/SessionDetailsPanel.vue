<template>
  <div class="details-overlay" @click.self="$emit('close')">
    <div class="details-panel">
      <div class="panel-header">
        <div>
          <h2 class="text-2xl font-bold">{{ session.name || 'Сессия без названия' }}</h2>
          <p class="text-sm text-gray-500 mt-1">ID: {{ session.id }}</p>
        </div>
        <button @click="$emit('close')" class="close-btn">&times;</button>
      </div>

      <div class="panel-body">
        <!-- Метрики сессии -->
        <div v-if="metrics" class="metrics-section">
          <h3 class="section-title">Метрики</h3>
          <div class="metrics-grid">
            <div class="metric-card">
              <div class="metric-label">Всего сделок</div>
              <div class="metric-value">{{ metrics.totalTrades }}</div>
            </div>
            <div class="metric-card">
              <div class="metric-label">Открытых</div>
              <div class="metric-value">{{ metrics.openTrades }}</div>
            </div>
            <div class="metric-card">
              <div class="metric-label">Закрытых</div>
              <div class="metric-value">{{ metrics.closedTrades }}</div>
            </div>
            <div class="metric-card">
              <div class="metric-label">Винрейт</div>
              <div class="metric-value">{{ (metrics.winRate * 100).toFixed(2) }}%</div>
            </div>
            <div class="metric-card" :class="{ 'metric-positive': metrics.totalPnl > 0, 'metric-negative': metrics.totalPnl < 0 }">
              <div class="metric-label">Общий PnL</div>
              <div class="metric-value">${{ metrics.totalPnl.toFixed(2) }}</div>
            </div>
            <div class="metric-card" :class="{ 'metric-positive': metrics.totalPnlPct > 0, 'metric-negative': metrics.totalPnlPct < 0 }">
              <div class="metric-label">PnL %</div>
              <div class="metric-value">{{ (metrics.totalPnlPct * 100).toFixed(2) }}%</div>
            </div>
            <div v-if="metrics.profitFactor" class="metric-card">
              <div class="metric-label">Profit Factor</div>
              <div class="metric-value">{{ metrics.profitFactor.toFixed(2) }}</div>
            </div>
            <div v-if="metrics.maxDrawdownPct" class="metric-card metric-negative">
              <div class="metric-label">Max Drawdown</div>
              <div class="metric-value">{{ (metrics.maxDrawdownPct * 100).toFixed(2) }}%</div>
            </div>
          </div>
        </div>

        <!-- Информация о сессии -->
        <div class="info-section">
          <h3 class="section-title">Информация</h3>
          <div class="info-grid">
            <div class="info-item">
              <span class="info-label">Статус:</span>
              <span class="badge" :class="statusBadgeClass(session.status)">
                {{ statusLabel(session.status) }}
              </span>
            </div>
            <div class="info-item">
              <span class="info-label">Источник:</span>
              <span>{{ session.source }}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Биржа:</span>
              <span>{{ session.exchange.toUpperCase() }}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Режим портфолио:</span>
              <span>{{ session.portfolioMode ? 'Да' : 'Нет' }}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Торговые пары:</span>
              <span>{{ session.pairs.length > 0 ? session.pairs.join(', ') : 'Все' }}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Таймфреймы:</span>
              <span>{{ session.timeframes.join(', ') }}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Начало:</span>
              <span>{{ formatDate(session.startedAt) }}</span>
            </div>
            <div v-if="session.endedAt" class="info-item">
              <span class="info-label">Окончание:</span>
              <span>{{ formatDate(session.endedAt) }}</span>
            </div>
            <div v-if="session.notes" class="info-item full-width">
              <span class="info-label">Заметки:</span>
              <span>{{ session.notes }}</span>
            </div>
          </div>
        </div>

        <!-- Список сделок -->
        <div class="trades-section">
          <h3 class="section-title">Последние сделки</h3>
          <div v-if="loadingTrades" class="loading-state">Загрузка сделок...</div>
          <div v-else-if="trades.length === 0" class="empty-state">Нет сделок</div>
          <div v-else class="trades-table-wrapper">
            <table class="trades-table">
              <thead>
                <tr>
                  <th>Пара</th>
                  <th>Направление</th>
                  <th>Вход</th>
                  <th>Выход</th>
                  <th>Размер</th>
                  <th>PnL</th>
                  <th>PnL %</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="trade in trades" :key="trade.id">
                  <td class="font-semibold">{{ trade.pair }}</td>
                  <td>
                    <span class="badge" :class="trade.direction === 'long' ? 'badge-success' : 'badge-danger'">
                      {{ trade.direction?.toUpperCase() || 'N/A' }}
                    </span>
                  </td>
                  <td>${{ trade.entryPrice?.toFixed(2) || 'N/A' }}</td>
                  <td>${{ trade.exitPrice?.toFixed(2) || '—' }}</td>
                  <td>{{ trade.positionSize?.toFixed(4) || 'N/A' }}</td>
                  <td :class="{ 'text-green': trade.realizedPnl && trade.realizedPnl > 0, 'text-red': trade.realizedPnl && trade.realizedPnl < 0 }">
                    {{ trade.realizedPnl ? '$' + trade.realizedPnl.toFixed(2) : '—' }}
                  </td>
                  <td :class="{ 'text-green': trade.realizedPnlPct && trade.realizedPnlPct > 0, 'text-red': trade.realizedPnlPct && trade.realizedPnlPct < 0 }">
                    {{ trade.realizedPnlPct ? (trade.realizedPnlPct * 100).toFixed(2) + '%' : '—' }}
                  </td>
                  <td>
                    <span class="badge" :class="trade.status === 'open' ? 'badge-warning' : 'badge-info'">
                      {{ trade.status }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { sessionService } from '@/services/sessionService';
import type { TradingSession, SessionMetrics, SessionTrade } from '@/types/session';

const props = defineProps<{
  session: TradingSession;
}>();

const emit = defineEmits<{
  close: [];
}>();

const metrics = ref<SessionMetrics | null>(null);
const trades = ref<SessionTrade[]>([]);
const loadingTrades = ref(false);

function statusBadgeClass(status: string) {
  switch (status) {
    case 'running': return 'badge-success';
    case 'completed': return 'badge-info';
    case 'failed': return 'badge-danger';
    case 'interrupted': return 'badge-warning';
    default: return 'badge-secondary';
  }
}

function statusLabel(status: string) {
  switch (status) {
    case 'running': return 'Активна';
    case 'completed': return 'Завершена';
    case 'failed': return 'Ошибка';
    case 'interrupted': return 'Прервана';
    default: return status;
  }
}

function formatDate(dateStr: string) {
  const date = new Date(dateStr);
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function loadData() {
  try {
    const [metricsData, tradesData] = await Promise.all([
      sessionService.getSessionMetrics(props.session.id),
      (async () => {
        loadingTrades.value = true;
        return await sessionService.getSessionTrades(props.session.id, 50);
      })(),
    ]);

    metrics.value = metricsData;
    trades.value = tradesData;
  } catch (error: any) {
    console.error('Failed to load session details:', error);
  } finally {
    loadingTrades.value = false;
  }
}

onMounted(() => {
  loadData();
});
</script>

<style scoped>
.details-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 1rem;
}

.details-panel {
  background: white;
  border-radius: 12px;
  max-width: 1200px;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 1.5rem;
  border-bottom: 1px solid #e5e7eb;
  position: sticky;
  top: 0;
  background: white;
  z-index: 10;
}

.close-btn {
  font-size: 2rem;
  line-height: 1;
  background: none;
  border: none;
  cursor: pointer;
  color: #6b7280;
  transition: color 0.2s;
}

.close-btn:hover {
  color: #111827;
}

.panel-body {
  padding: 1.5rem;
}

.section-title {
  font-size: 1.25rem;
  font-weight: 700;
  margin-bottom: 1rem;
  color: #111827;
}

.metrics-section {
  margin-bottom: 2rem;
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 1rem;
}

.metric-card {
  background: #f9fafb;
  border-radius: 8px;
  padding: 1rem;
  text-align: center;
}

.metric-label {
  font-size: 0.875rem;
  color: #6b7280;
  margin-bottom: 0.5rem;
}

.metric-value {
  font-size: 1.5rem;
  font-weight: 700;
  color: #111827;
}

.metric-positive {
  background: #d1fae5;
}

.metric-positive .metric-value {
  color: #065f46;
}

.metric-negative {
  background: #fee2e2;
}

.metric-negative .metric-value {
  color: #991b1b;
}

.info-section {
  margin-bottom: 2rem;
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 1rem;
}

.info-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem;
  background: #f9fafb;
  border-radius: 6px;
}

.info-item.full-width {
  grid-column: 1 / -1;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.5rem;
}

.info-label {
  font-weight: 600;
  color: #6b7280;
}

.trades-section {
  margin-bottom: 1rem;
}

.trades-table-wrapper {
  overflow-x: auto;
}

.trades-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.trades-table th {
  background: #f9fafb;
  padding: 0.75rem;
  text-align: left;
  font-weight: 600;
  color: #374151;
  border-bottom: 2px solid #e5e7eb;
}

.trades-table td {
  padding: 0.75rem;
  border-bottom: 1px solid #e5e7eb;
}

.trades-table tbody tr:hover {
  background: #f9fafb;
}

.text-green {
  color: #059669;
  font-weight: 600;
}

.text-red {
  color: #dc2626;
  font-weight: 600;
}

.badge {
  display: inline-block;
  padding: 0.25rem 0.5rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 600;
}

.badge-success { background: #d1fae5; color: #065f46; }
.badge-info { background: #dbeafe; color: #1e40af; }
.badge-danger { background: #fee2e2; color: #991b1b; }
.badge-warning { background: #fef3c7; color: #92400e; }
.badge-secondary { background: #f3f4f6; color: #374151; }

.loading-state,
.empty-state {
  text-align: center;
  padding: 2rem;
  color: #6b7280;
}
</style>





