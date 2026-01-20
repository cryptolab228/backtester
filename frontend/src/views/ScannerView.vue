<template>
  <div class="min-h-screen bg-gray-50">
    <!-- Хедер со встроенной статистикой -->
    <div class="bg-white border-b border-gray-200 px-6 py-3">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-8">
          <div>
            <h1 class="text-xl font-bold text-gray-900">Scanner</h1>
            <p class="text-xs text-gray-500">{{ scannerStore.status?.executionMode || 'demo' }}</p>
            <router-link to="/sessions" class="text-xs text-blue-600 hover:underline flex items-center gap-1 mt-1">
              <i class="pi pi-history" style="font-size: 0.7rem;"></i>
              <span>Посмотреть историю сессий</span>
            </router-link>
          </div>
          
          <!-- Компактная статистика в хедере -->
          <div class="flex items-center gap-6">
            <div class="flex items-center gap-2">
              <Tag :severity="scannerStore.isRunning ? 'success' : 'secondary'" class="text-xs px-2 py-1">
                {{ scannerStore.isRunning ? 'Running' : 'Stopped' }}
              </Tag>
            </div>
            
            <div class="flex items-center gap-1">
              <i class="pi pi-clock text-xs text-gray-400"></i>
              <span class="text-sm font-semibold">{{ scannerStore.pendingSignals.length }}</span>
              <span class="text-xs text-gray-500">pending</span>
            </div>
            
            <div class="flex items-center gap-1">
              <i class="pi pi-briefcase text-xs text-gray-400"></i>
              <span class="text-sm font-semibold">{{ scannerStore.openPositions.length }}</span>
              <span class="text-xs text-gray-500">open</span>
            </div>
            
            <div class="flex items-center gap-1">
              <i class="pi pi-wallet text-xs text-gray-400"></i>
              <span class="text-sm font-semibold">{{ formatCurrencyShort(scannerStore.status?.availableCapital) }}</span>
            </div>
            
            <div v-if="totalPnLData" class="flex items-center gap-1 px-2 py-1 rounded" :class="totalPnLData.totalPnL >= 0 ? 'bg-green-50' : 'bg-red-50'">
              <i class="pi pi-chart-line text-xs" :class="totalPnLData.totalPnL >= 0 ? 'text-green-600' : 'text-red-600'"></i>
              <span class="text-sm font-bold" :class="totalPnLData.totalPnL >= 0 ? 'text-green-600' : 'text-red-600'">
                {{ formatCurrencyShort(totalPnLData.totalPnL) }}
              </span>
            </div>
          </div>
        </div>
        
        <div class="flex gap-2">
          <Button
            :icon="scannerStore.isRunning ? 'pi pi-stop' : 'pi pi-play'"
            :severity="scannerStore.isRunning ? 'danger' : 'success'"
            :loading="scannerStore.isLoading"
            size="small"
            @click="toggleScanner"
          />
          <Button
            icon="pi pi-refresh"
            outlined
            size="small"
            @click="refreshAll"
          />
          <Button
            icon="pi pi-cog"
            text
            size="small"
            @click="showSettings = true"
          />
        </div>
      </div>
    </div>

    <!-- Основной контент -->
    <div class="max-w-full mx-auto px-6 py-3">

      <!-- Табы -->
      <div class="bg-white rounded-lg border border-gray-200">
        <div class="border-b border-gray-200">
          <nav class="-mb-px flex space-x-6 px-4" aria-label="Tabs">
            <button
              v-for="tab in tabs"
              :key="tab.id"
              @click="activeTab = tab.id"
              :class="[
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
                'whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm flex items-center gap-2'
              ]"
            >
              <i :class="tab.icon" class="text-xs"></i>
              {{ tab.label }}
              <Tag v-if="tab.count !== undefined" severity="secondary" :value="tab.count" class="text-xs px-1.5 py-0.5" />
            </button>
          </nav>
        </div>

        <div class="p-4">
          <!-- Pending Signals Tab -->
          <div v-show="activeTab === 'pending'">
            <div v-if="!scannerStore.pendingSignals.length" class="flex flex-col items-center justify-center py-16">
              <i class="pi pi-clock text-6xl text-gray-300 mb-4"></i>
              <h3 class="text-lg font-medium text-gray-700 mb-2">No Pending Signals</h3>
              <p class="text-sm text-gray-500">Waiting for trading signals to appear...</p>
            </div>
            <DataTable v-else :value="scannerStore.pendingSignals" :rows="15" :paginator="scannerStore.pendingSignals.length > 15" class="text-sm" size="small">
              <Column header="Pair / TF" style="width: 200px">
                <template #body="{ data }">
                  <div class="font-semibold">{{ data.pairSymbol }}</div>
                  <div class="text-xs text-gray-500 flex items-center gap-1">
                    <span>{{ data.timeframes?.length ? data.timeframes.join(', ') : data.timeframe }}</span>
                    <Tag v-if="data.legs?.length" severity="secondary" class="text-xs" :value="data.legs.length" />
                  </div>
                </template>
              </Column>
              <Column header="Direction" style="width: 90px">
                <template #body="{ data }">
                  <Tag :severity="data.direction === 'long' ? 'success' : 'danger'" class="text-xs">
                    {{ data.direction === 'long' ? 'LONG' : 'SHORT' }}
                  </Tag>
                </template>
              </Column>
              <Column header="Entry → Target" style="width: 180px">
                <template #body="{ data }">
                  <div class="text-xs">
                    {{ formatPriceValue(data.entryPrice) }} → {{ data.confirmationTargetPrice ? formatPriceValue(data.confirmationTargetPrice) : '—' }}
                  </div>
                </template>
              </Column>
              <Column header="Current" style="width: 150px">
                <template #body="{ data }">
                  <div class="font-medium">{{ formatPriceValue(data.currentPrice ?? data.lastCandlePrice) }}</div>
                </template>
              </Column>
              <Column header="Δ (abs / %)" style="width: 160px">
                <template #body="{ data }">
                  <div :class="Number(data.priceDelta ?? 0) >= 0 ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'">
                    {{ formatDeltaValue(data.priceDelta) }}
                  </div>
                  <div v-if="data.priceDeltaPct !== null && data.priceDeltaPct !== undefined" class="text-xs text-gray-500">
                    {{ formatPercentValue(data.priceDeltaPct) }}
                  </div>
                </template>
              </Column>
              <Column header="Attempts" style="width: 90px">
                <template #body="{ data }">
                  <div class="text-xs">{{ data.confirmationAttempts || 0 }}/{{ data.maxConfirmationAttempts || 3 }}</div>
                </template>
              </Column>
              <Column header="Time Left" style="width: 120px">
                <template #body="{ data }">
                  <div class="text-xs">{{ formatTimeLeft(data.timeToConfirmMs) }}</div>
                </template>
              </Column>
              <Column header="Detected" style="width: 120px">
                <template #body="{ data }">
                  <div class="text-xs">{{ formatRelativeTime(new Date(Number(data.detectedAt))) }}</div>
                </template>
              </Column>
              <Column header="" style="width: 80px">
                <template #body="{ data }">
                  <Button
                    icon="pi pi-times"
                    size="small"
                    text
                    severity="danger"
                    @click="cancelSignal(data.id)"
                    :disabled="data.status !== 'waiting'"
                  />
                </template>
              </Column>
            </DataTable>
          </div>

          <!-- Open Positions Tab -->
          <div v-show="activeTab === 'positions'">
            <div class="flex justify-between items-center mb-3">
              <Button label="Refresh" icon="pi pi-refresh" size="small" text @click="syncExchangeData" />
            </div>
            <DataTable :value="mergedPositions" class="text-sm" size="small">
              <Column header="Pair / TF" style="width: 140px">
                <template #body="{ data }">
                  <div class="font-semibold">{{ data.pairSymbol }}</div>
                  <div class="text-xs text-gray-500">{{ data.timeframe }}</div>
                </template>
              </Column>
              <Column header="Direction" style="width: 90px">
                <template #body="{ data }">
                  <Tag :severity="data.direction === 'long' ? 'success' : 'danger'" class="text-xs">
                    {{ data.direction === 'long' ? 'LONG' : 'SHORT' }}
                  </Tag>
                </template>
              </Column>
              <Column header="Entry / Mark" style="width: 180px">
                <template #body="{ data }">
                  <div class="font-medium">{{ Number(data.avgEntry || data.entryPrice).toFixed(2) }}</div>
                  <div v-if="data.exchangeData?.markPrice" class="text-xs text-gray-600">
                    → {{ Number(data.exchangeData.markPrice).toFixed(2) }}
                  </div>
                </template>
              </Column>
              <Column header="Size" style="width: 120px">
                <template #body="{ data }">
                  <div class="font-medium">{{ Number(data.aggregatedSize || data.size).toFixed(4) }}</div>
                  <div v-if="data.primaryLeg?.size" class="text-xs text-gray-500">last: {{ Number(data.primaryLeg.size).toFixed(4) }}</div>
                </template>
              </Column>
              <Column header="TP / SL" style="width: 150px">
                <template #body="{ data }">
                  <div class="text-xs text-green-600">{{ data.takeProfit ? Number(data.takeProfit).toFixed(2) : '—' }}</div>
                  <div class="text-xs text-red-600">{{ data.stopLoss ? Number(data.stopLoss).toFixed(2) : '—' }}</div>
                </template>
              </Column>
              <Column header="Lev" style="width: 60px">
                <template #body="{ data }">{{ Number(data.external?.leverage || data.exchangeData?.leverage || 10) }}×</template>
              </Column>
              <Column header="PnL (Unrealized)" style="width: 160px">
                <template #body="{ data }">
                  <div v-if="data.exchangeData?.unrealisedPnl !== undefined && data.exchangeData?.unrealisedPnl !== null" :class="Number(data.exchangeData.unrealisedPnl) >= 0 ? 'text-green-600 font-bold' : 'text-red-600 font-bold'">
                    {{ Number(data.exchangeData.unrealisedPnl).toFixed(2) }}
                  </div>
                  <div v-else-if="data.exchangeData?.unrealizedPnl !== undefined && data.exchangeData?.unrealizedPnl !== null" :class="Number(data.exchangeData.unrealizedPnl) >= 0 ? 'text-green-600 font-bold' : 'text-red-600 font-bold'">
                    {{ Number(data.exchangeData.unrealizedPnl).toFixed(2) }}
                  </div>
                  <div v-else-if="data.exchangeData?.markPrice && data.entryPrice && data.size" :class="calculatePnL(data) >= 0 ? 'text-green-600 font-bold' : 'text-red-600 font-bold'">
                    {{ calculatePnL(data).toFixed(2) }}
                    <span class="text-xs text-gray-500 ml-1">(calc)</span>
                  </div>
                  <span v-else class="text-gray-400">—</span>
                  <div v-if="data.exchangeData?.cumRealisedPnl" class="text-xs text-gray-500">
                    Real: {{ Number(data.exchangeData.cumRealisedPnl).toFixed(2) }}
                  </div>
                </template>
              </Column>
              <Column header="Time" style="width: 120px">
                <template #body="{ data }">
                  <div class="text-xs">{{ formatRelativeTime(new Date(data.executedAt)) }}</div>
                  <div v-if="data.primaryLeg" class="text-2xs text-gray-500">leg: {{ formatRelativeTime(new Date(data.primaryLeg.confirmedAt)) }}</div>
                </template>
              </Column>
              <Column header="" style="width: 80px">
                <template #body="{ data }">
                  <Button
                    label="Close"
                    icon="pi pi-times"
                    size="small"
                    text
                    severity="danger"
                    @click="promptManualClose(data)"
                  />
                </template>
              </Column>
            </DataTable>
          </div>

          <!-- Closed Positions Tab -->
          <div v-show="activeTab === 'closed'">
            <div class="flex justify-between items-center mb-3">
              <Button label="Refresh" icon="pi pi-refresh" size="small" text @click="refreshClosedExecutions" :loading="closedExecutionsLoading" />
            </div>
            <div v-if="closedExecutionsLoading" class="text-center py-8 text-gray-500">
              <i class="pi pi-spin pi-spinner text-2xl"></i>
              <p class="mt-2">Loading closed positions...</p>
            </div>
            <div v-else-if="!closedExecutionsList.length" class="text-center py-12 text-gray-400">
              <i class="pi pi-inbox text-4xl mb-3"></i>
              <h3 class="text-lg font-medium text-gray-700 mb-2">No Closed Positions</h3>
              <p class="text-sm text-gray-500">No closed positions recorded for this session.</p>
            </div>
            <DataTable v-else :value="closedExecutionsList" :rows="15" :paginator="closedExecutionsList.length > 15" class="text-sm" size="small">
              <Column header="Pair / TF" style="width: 180px">
                <template #body="{ data }">
                  <div class="font-semibold">{{ data.pair }}</div>
                  <div class="text-xs text-gray-500">{{ data.timeframe || 'N/A' }}</div>
                </template>
              </Column>
              <Column header="Direction" style="width: 90px">
                <template #body="{ data }">
                  <Tag :severity="data.direction === 'long' ? 'success' : 'danger'" class="text-xs">
                    {{ data.direction === 'long' ? 'LONG' : 'SHORT' }}
                  </Tag>
                </template>
              </Column>
              <Column header="Entry → Exit" style="width: 180px">
                <template #body="{ data }">
                  <div class="text-xs">
                    {{ data.entryPrice ? Number(data.entryPrice).toFixed(2) : '—' }} →
                    {{ data.exitPrice ? Number(data.exitPrice).toFixed(2) : '—' }}
                  </div>
                </template>
              </Column>
              <Column header="Size" style="width: 120px">
                <template #body="{ data }">
                  <div class="text-xs font-medium">{{ data.size ? Number(data.size).toFixed(4) : '—' }}</div>
                </template>
              </Column>
              <Column header="PnL" style="width: 160px">
                <template #body="{ data }">
                  <div :class="data.pnl >= 0 ? 'text-green-600 font-bold' : 'text-red-600 font-bold'">
                    {{ data.pnl !== null && data.pnl !== undefined ? Number(data.pnl).toFixed(2) : '—' }}
                  </div>
                  <div v-if="data.pnlPct !== null && data.pnlPct !== undefined" class="text-xs text-gray-500">
                    {{ Number(data.pnlPct).toFixed(2) }}%
                  </div>
                </template>
              </Column>
              <Column header="Closed At" style="width: 160px">
                <template #body="{ data }">
                  <div class="text-xs">{{ data.exitTimestamp ? formatDateTime(data.exitTimestamp) : '—' }}</div>
                </template>
              </Column>
            </DataTable>

            <div v-if="closedExecutionsList.length > 0" class="mt-4 p-3 bg-slate-50 rounded-lg border border-slate-200">
              <div class="flex justify-between items-center">
                <span class="text-sm font-medium text-gray-700">Total Closed PnL ({{ sessionTotals.closedPositions || closedExecutionsList.length }} positions):</span>
                <span :class="['text-lg font-bold', (sessionTotals.totalClosedPnl ?? 0) >= 0 ? 'text-green-600' : 'text-red-600']">
                  {{ (sessionTotals.totalClosedPnl ?? 0).toFixed(2) }} USDT
                </span>
              </div>
            </div>
          </div>

          <!-- Exchange Data Tab -->
          <div v-show="activeTab === 'exchange'">
            <div class="space-y-6">
              <div class="flex justify-end">
                <Button label="Refresh" icon="pi pi-refresh" size="small" text @click="refreshExchangeHistory" :loading="exchangeHistoryLoading" />
              </div>

              <!-- Order & Trade History -->
              <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div>
                  <h3 class="text-lg font-medium mb-3">Order History</h3>
                  <div v-if="exchangeHistoryLoading" class="text-center py-8 text-gray-500">
                    <i class="pi pi-spin pi-spinner"></i>
                  </div>
                  <div v-else-if="!sessionOrders.length" class="text-center py-8 text-gray-400">No orders</div>
                  <DataTable v-else :value="sessionOrders" :rows="5" :paginator="true" class="text-sm" size="small">
                    <Column field="symbol" header="Symbol" style="width: 120px" />
                    <Column header="Side" style="width: 80px">
                      <template #body="{ data }">
                        <Tag :severity="data.side === 'Buy' ? 'success' : 'danger'" class="text-xs">{{ data.side }}</Tag>
                      </template>
                    </Column>
                    <Column header="Qty" style="width: 100px">
                      <template #body="{ data }">{{ Number(data.qty || data.cumExecQty || 0).toFixed(3) }}</template>
                    </Column>
                    <Column header="Price" style="width: 120px">
                      <template #body="{ data }">{{ Number(data.price || data.avgPrice || 0).toFixed(2) }}</template>
                    </Column>
                    <Column header="Status" style="width: 140px">
                      <template #body="{ data }">
                        <Tag :severity="getOrderStatusSeverity(data.orderStatus || data.status || '')" class="text-xs">{{ data.orderStatus || data.status || '—' }}</Tag>
                      </template>
                    </Column>
                  </DataTable>
                </div>

                <div>
                  <h3 class="text-lg font-medium mb-3">Trade History</h3>
                  <div v-if="exchangeHistoryLoading" class="text-center py-8 text-gray-500">
                    <i class="pi pi-spin pi-spinner"></i>
                  </div>
                  <div v-else-if="!sessionTrades.length" class="text-center py-8 text-gray-400">No trades</div>
                  <DataTable v-else :value="sessionTrades" :rows="5" :paginator="true" class="text-sm" size="small">
                    <Column field="symbol" header="Symbol" style="width: 120px" />
                    <Column header="Side" style="width: 80px">
                      <template #body="{ data }">
                        <Tag :severity="data.side === 'Buy' ? 'success' : 'danger'" class="text-xs">{{ data.side }}</Tag>
                      </template>
                    </Column>
                    <Column header="Qty" style="width: 100px">
                      <template #body="{ data }">{{ Number(data.execQty || data.qty).toFixed(3) }}</template>
                    </Column>
                    <Column header="Price" style="width: 120px">
                      <template #body="{ data }">{{ Number(data.execPrice || data.price).toFixed(2) }}</template>
                    </Column>
                    <Column header="Fee" style="width: 100px">
                      <template #body="{ data }">{{ data.execFee ? Number(data.execFee).toFixed(4) : '—' }}</template>
                    </Column>
                  </DataTable>
                </div>
              </div>

              <!-- Closed PnL -->
              <div>
                <h3 class="text-lg font-medium mb-3">Closed PnL History</h3>
                <div v-if="exchangeHistoryLoading" class="text-center py-8 text-gray-500">
                  <i class="pi pi-spin pi-spinner"></i>
                </div>
                <div v-else-if="!sessionClosedPnl.length" class="text-center py-8 text-gray-400">No closed positions</div>
                <div v-else>
                  <div class="mb-4 p-3 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200">
                    <div class="flex items-center justify-between">
                      <span class="text-sm font-medium text-gray-700">Total Closed PnL</span>
                      <span :class="['text-xl font-bold', (sessionTotals.totalClosedPnl ?? 0) >= 0 ? 'text-green-600' : 'text-red-600']">
                        {{ (sessionTotals.totalClosedPnl ?? 0).toFixed(2) }} USDT
                      </span>
                    </div>
                  </div>
                  <DataTable :value="sessionClosedPnl" :rows="5" :paginator="true" class="text-sm" size="small">
                    <Column field="symbol" header="Symbol" style="width: 120px" />
                    <Column header="Side" style="width: 80px">
                      <template #body="{ data }">
                        <Tag :severity="data.side === 'Buy' ? 'success' : 'danger'" class="text-xs">{{ data.side }}</Tag>
                      </template>
                    </Column>
                    <Column header="Qty" style="width: 100px">
                      <template #body="{ data }">{{ Number(data.qty || 0).toFixed(3) }}</template>
                    </Column>
                    <Column header="PnL" style="width: 120px">
                      <template #body="{ data }">
                        <span :class="Number(data.closedPnl || 0) >= 0 ? 'text-green-600 font-bold' : 'text-red-600 font-bold'">
                          {{ Number(data.closedPnl || 0).toFixed(2) }}
                        </span>
                      </template>
                    </Column>
                    <Column header="Entry → Exit" style="width: 180px">
                      <template #body="{ data }">
                        <div class="text-xs">{{ Number(data.avgEntryPrice || 0).toFixed(2) }} → {{ Number(data.avgExitPrice || 0).toFixed(2) }}</div>
                      </template>
                    </Column>
                    <Column header="Updated" style="width: 160px">
                      <template #body="{ data }">
                        <div class="text-xs">{{ data.updatedTime ? formatDateTime(data.updatedTime) : '—' }}</div>
                      </template>
                    </Column>
                  </DataTable>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Settings Dialog -->
    <Dialog v-model:visible="showSettings" modal header="Scanner Settings" class="w-full md:w-3/4 lg:w-2/3">
      <div class="space-y-4">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="text-sm font-medium text-gray-700">Execution Mode</label>
            <Select
              v-model="editableSettings.executionMode"
              :options="executionModes"
              optionLabel="label"
              optionValue="value"
              class="w-full mt-1"
            />
          </div>
          <div>
            <label class="text-sm font-medium text-gray-700">Risk Per Trade</label>
            <InputNumber
              v-model.number="editableSettings.riskPerTrade"
              class="w-full mt-1"
              :min="0.0001"
              :max="1"
              :step="0.001"
              mode="decimal"
            />
          </div>
          <div>
            <label class="text-sm font-medium text-gray-700">Max Concurrent Trades</label>
            <InputNumber v-model.number="editableSettings.maxConcurrentTrades" class="w-full mt-1" :min="1" />
          </div>
          <div>
            <label class="text-sm font-medium text-gray-700">Confirm Window Size</label>
            <InputNumber v-model.number="editableSettings.confirmWindowSize" class="w-full mt-1" :min="1" />
          </div>
        </div>

        <div>
          <div class="flex items-center justify-between mb-2">
            <label class="text-sm font-medium text-gray-700">Trading Pairs</label>
            <Button label="Add Pair" icon="pi pi-plus" size="small" text @click="openPairModal" />
          </div>
          <div class="space-y-2">
            <div v-for="(pair, index) in editableSettings.pairs" :key="`${pair.symbol}-${index}`" class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <div class="flex items-center gap-3">
                <span class="font-medium">{{ pair.symbol }}</span>
                <div class="flex gap-1">
                  <Tag v-for="tf in pair.timeframes" :key="tf" severity="secondary" :value="tf" />
                </div>
              </div>
              <Button icon="pi pi-trash" text severity="danger" size="small" @click="removePair(pair.symbol)" />
            </div>
          </div>
        </div>

        <div class="flex justify-end gap-3 pt-4 border-t">
          <Button label="Cancel" text @click="showSettings = false" />
          <Button label="Save" icon="pi pi-save" :loading="isSaving" @click="saveSettings" />
        </div>
      </div>
    </Dialog>

    <!-- Add Pair Dialog -->
    <Dialog v-model:visible="isPairModalVisible" modal header="Add Trading Pair" class="w-full md:w-1/2">
      <div class="space-y-4">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="text-sm font-medium text-gray-700">Exchange</label>
            <Select
              v-model="pairForm.exchange"
              :options="exchangeOptions"
              optionLabel="label"
              optionValue="value"
              class="w-full mt-1"
            />
          </div>
          <div>
            <label class="text-sm font-medium text-gray-700">Symbol</label>
            <AutoComplete
              v-model="pairForm.symbol"
              :suggestions="pairFormSuggestions"
              @complete="completePairModal"
              forceSelection
              :dropdown="true"
              dropdownMode="current"
              inputClass="w-full"
              class="mt-1"
              placeholder="e.g., BTCUSDT"
            />
          </div>
        </div>
        <div>
          <label class="text-sm font-medium text-gray-700">Timeframes</label>
          <MultiSelect
            v-model="pairForm.timeframes"
            :options="timeframeSuggestions"
            optionLabel="label"
            optionValue="value"
            display="chip"
            class="w-full mt-1"
            placeholder="Select timeframes"
          />
        </div>
        <div class="flex justify-end gap-2 pt-4 border-t">
          <Button label="Cancel" text @click="closePairModal" />
          <Button label="Add" icon="pi pi-plus" :disabled="!canSubmitPair" @click="submitPair" />
        </div>
      </div>
    </Dialog>

    <!-- Manual Close Dialog -->
    <Dialog v-model:visible="manualCloseDialog" modal header="Close Position" class="w-full sm:w-96">
      <div class="space-y-3">
        <div v-if="positionToClose" class="text-sm text-gray-600">
          {{ positionToClose.pairSymbol }} · {{ positionToClose.timeframe }} · {{ positionToClose.direction === 'long' ? 'LONG' : 'SHORT' }}
        </div>
        <div>
          <label class="text-sm font-medium text-gray-700">Close Price</label>
          <InputText
            v-model="manualClosePriceInput"
            class="w-full mt-1"
            inputmode="decimal"
            placeholder="e.g., 65432.50"
          />
        </div>
        <div v-if="errorMessage" class="text-sm text-red-500">{{ errorMessage }}</div>
        <div class="flex justify-end gap-2 pt-4 border-t">
          <Button label="Cancel" text @click="manualCloseDialog = false" />
          <Button label="Close Position" icon="pi pi-check" severity="primary" @click="submitManualClose" />
        </div>
      </div>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useScannerStore } from '@/stores/scannerStore';
import { useSettingsStore } from '@/stores/settingsStore';

import Button from 'primevue/button';
import Tag from 'primevue/tag';
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';
import Select from 'primevue/select';
import InputNumber from 'primevue/inputnumber';
import InputText from 'primevue/inputtext';
import AutoComplete from 'primevue/autocomplete';
import MultiSelect from 'primevue/multiselect';
import Dialog from 'primevue/dialog';

import { updateScannerSettings } from '@/services/scannerService';

const scannerStore = useScannerStore();
const settingsStore = useSettingsStore();

const activeTab = ref('pending');
const showSettings = ref(false);

const tabs = computed(() => [
  { id: 'pending', label: 'Pending Signals', icon: 'pi pi-clock', count: scannerStore.pendingSignals.length },
  { id: 'positions', label: 'Open Positions', icon: 'pi pi-briefcase', count: scannerStore.openPositions.length },
  { id: 'closed', label: 'Closed Positions', icon: 'pi pi-check-circle', count: closedExecutionsList.value.length },
  { id: 'exchange', label: 'Exchange Data', icon: 'pi pi-server' },
]);

const executionModes = [
  { label: 'Dry Run', value: 'dry-run' },
  { label: 'Paper', value: 'paper' },
  { label: 'Shadow', value: 'shadow' },
  { label: 'Bybit Testnet', value: 'testnet' },
  { label: 'Bybit Demo', value: 'demo' },
  { label: 'Live', value: 'live' },
];

const exchangeOptions = [
  { label: 'Bybit', value: 'bybit' },
  { label: 'OKX', value: 'okx' },
];

const DEFAULT_TIMEFRAMES = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d', '1w'];

const editableSettings = reactive({
  executionMode: 'dry-run',
  refreshIntervalMs: 1000,
  confirmWindowSize: 2,
  riskScoreThreshold: 0.5,
  maxConcurrentTrades: 1,
  riskPerTrade: 0.02,
  stopLossMultiplier: 3,
  takeProfitMultiplier: 5,
  pairs: [] as Array<{ symbol: string; timeframes: string[]; exchange?: string }>,
});

const timeframeSuggestions = computed(() => {
  const dynamicSet = new Set<string>(DEFAULT_TIMEFRAMES);
  editableSettings.pairs.forEach((pair) => pair.timeframes.forEach((tf) => dynamicSet.add(tf)));
  return Array.from(dynamicSet).map((tf) => ({ label: tf, value: tf }));
});

const isPairModalVisible = ref(false);
const isSaving = ref(false);

const pairForm = reactive({
  symbol: '',
  exchange: 'bybit' as 'bybit' | 'okx',
  timeframes: [] as string[],
});

const pairFormSuggestions = ref<string[]>([]);

const manualCloseDialog = ref(false);
const manualClosePriceInput = ref<string>('');
const positionToClose = ref<any | null>(null);
const errorMessage = ref<string | null>(null);

const exchangeHistoryLoading = ref(false);
const closedExecutionsLoading = ref(false);

const sessionOrders = computed(() => scannerStore.exchangeHistory.orders ?? []);
const sessionTrades = computed(() => scannerStore.exchangeHistory.trades ?? []);
const sessionClosedPnl = computed(() => scannerStore.exchangeHistory.closedPnl ?? []);
const sessionTotals = computed(() => scannerStore.exchangeHistory.totals ?? { totalClosedPnl: 0, closedPositions: 0 });
const closedExecutionsList = computed(() => scannerStore.closedExecutions);

const totalPnLData = ref<any | null>(null);
const totalPnLLoading = ref(false);

// Объединение внутренних позиций с данными биржи
const mergedPositions = computed(() => {
  return scannerStore.openPositions.map(position => {
    const legs = Array.isArray(position.legs) ? position.legs : [];
    const avgEntry = Number(position.avgEntry || position.entryPrice || 0);
    const size = Number(position.aggregatedSize || position.size || 0);

    return {
      ...position,
      legs,
      avgEntry,
      aggregatedSize: size,
      // ✅ Используем external как exchangeData для совместимости с UI
      exchangeData: position.external || position.exchangeData || null,
    };
  });
});

const syncExchangeData = async () => {
  await scannerStore.loadExecutions();
  await scannerStore.loadExchangeHistory();
};

const toggleScanner = async () => {
  if (scannerStore.isRunning) {
    await scannerStore.stop();
  } else {
    await scannerStore.start();
  }
  await refreshData();
};

const refreshAll = async () => {
  await Promise.all([
    refreshData(),
    scannerStore.loadExchangeHistory(),
    loadTotalPnL(),
  ]);
};

const refreshData = async () => {
  await Promise.all([
    scannerStore.loadStatus(),
    scannerStore.loadSignals(),
    scannerStore.loadExecutions(),
    scannerStore.loadExchangeHistory(),
  ]);
  if (scannerStore.status) {
    const normalized = JSON.parse(JSON.stringify(scannerStore.status));
    normalized.refreshIntervalMs = Number(normalized.refreshIntervalMs) || 1000;
    normalized.confirmWindowSize = Number(normalized.confirmWindowSize) || 1;
    normalized.riskScoreThreshold = Number(normalized.riskScoreThreshold) || 0.5;
    normalized.maxConcurrentTrades = Number(normalized.maxConcurrentTrades) || 1;
    normalized.riskPerTrade = Number(normalized.riskPerTrade) || 0.02;
    normalized.stopLossMultiplier = Number(normalized.stopLossMultiplier) || 3;
    normalized.takeProfitMultiplier = Number(normalized.takeProfitMultiplier) || 5;
    Object.assign(editableSettings, normalized);
  }
};

const saveSettings = async () => {
  try {
    isSaving.value = true;
    const payload = JSON.parse(JSON.stringify(editableSettings));
    payload.refreshIntervalMs = Number(String(payload.refreshIntervalMs).replace(/\s/g, ''));
    payload.confirmWindowSize = Number(payload.confirmWindowSize);
    payload.riskScoreThreshold = parseFloat(String(payload.riskScoreThreshold).replace(',', '.'));
    payload.maxConcurrentTrades = Number(payload.maxConcurrentTrades);
    payload.riskPerTrade = Number(String(payload.riskPerTrade).replace(/\s/g, '').replace(',', '.'));
    payload.stopLossMultiplier = Number(String(payload.stopLossMultiplier).replace(/\s/g, '').replace(',', '.'));
    payload.takeProfitMultiplier = Number(String(payload.takeProfitMultiplier).replace(/\s/g, '').replace(',', '.'));
    payload.pairs = payload.pairs
      .filter((pair: any) => pair.symbol)
      .map((pair: any) => ({
        symbol: String(pair.symbol).toUpperCase(),
        exchange: (pair.exchange as 'bybit' | 'okx' | undefined) ?? 'bybit',
        timeframes: Array.isArray(pair.timeframes)
          ? Array.from(new Set(pair.timeframes.map((tf: any) => String(tf).trim()).filter(Boolean)))
          : [],
      }));
    const updated = await updateScannerSettings(payload);
    Object.assign(editableSettings, JSON.parse(JSON.stringify(updated)));
    await scannerStore.loadStatus();
    showSettings.value = false;
  } finally {
    isSaving.value = false;
  }
};

const removePair = (symbol: string) => {
  const index = editableSettings.pairs.findIndex((pair) => pair.symbol === symbol);
  if (index >= 0) {
    editableSettings.pairs.splice(index, 1);
  }
};

const openPairModal = async () => {
  pairForm.symbol = '';
  pairForm.exchange = 'bybit';
  pairForm.timeframes = ['15m', '1h'];
  pairFormSuggestions.value = [];
  await settingsStore.fetchAvailableTradingPairs();
  isPairModalVisible.value = true;
};

const closePairModal = () => {
  isPairModalVisible.value = false;
};

const completePairModal = (event: { query: string }) => {
  settingsStore.filterTradingPairs(event.query);
  pairFormSuggestions.value = settingsStore.tradingPairOptions.map((option) => option.label);
};

watch(
  () => pairForm.symbol,
  (value) => {
    if (!value) return;
    const match = settingsStore.tradingPairOptions.find((item) => item.label.toLowerCase() === value.toLowerCase());
    if (match) {
      pairForm.symbol = match.value;
    }
  }
);

const canSubmitPair = computed(() => {
  return Boolean(pairForm.symbol && pairForm.exchange && pairForm.timeframes.length);
});

const submitPair = () => {
  if (!canSubmitPair.value) {
    return;
  }
  const existingIndex = editableSettings.pairs.findIndex((pair) => pair.symbol === pairForm.symbol);
  const payload = {
    symbol: pairForm.symbol.toUpperCase(),
    exchange: pairForm.exchange,
    timeframes: Array.from(new Set(pairForm.timeframes)),
  };

  if (existingIndex >= 0) {
    editableSettings.pairs[existingIndex] = payload;
  } else {
    editableSettings.pairs.push(payload);
  }
  isPairModalVisible.value = false;
};

const cancelSignal = async (signalId: string) => {
  await scannerStore.cancelPendingSignal(signalId);
};

const promptManualClose = (position: any) => {
  const base = typeof position.entryPrice === 'number' ? position.entryPrice : 0;
  manualClosePriceInput.value = base ? base.toFixed(4).replace('.', ',') : '';
  positionToClose.value = position;
  manualCloseDialog.value = true;
};

const submitManualClose = async () => {
  if (!positionToClose.value) return;
  try {
    const normalized = manualClosePriceInput.value.replace(/\s/g, '').replace(',', '.');
    const price = Number(normalized);
    if (!Number.isFinite(price) || price <= 0) {
      errorMessage.value = 'Введите корректную цену';
      return;
    }
    await scannerStore.closePosition(positionToClose.value.id, price);
    manualCloseDialog.value = false;
    positionToClose.value = null;
    manualClosePriceInput.value = '';
    errorMessage.value = null;
  } catch (error: any) {
    errorMessage.value = error?.message || 'Failed to close position';
  }
};

const calculatePnL = (position: any): number => {
  const markPrice = Number(position.exchangeData?.markPrice || 0);
  const entryPrice = Number(position.entryPrice || position.avgEntry || 0);
  const size = Number(position.size || position.aggregatedSize || 0);
  const direction = position.direction;

  if (!markPrice || !entryPrice || !size) return 0;

  if (direction === 'long') {
    return (markPrice - entryPrice) * size;
  } else {
    return (entryPrice - markPrice) * size;
  }
};

const formatCurrencyShort = (value: number | undefined) => {
  if (value === undefined) return '—';
  const absValue = Math.abs(value);
  if (absValue >= 1000000) {
    return `${(value / 1000000).toFixed(2)}M`;
  } else if (absValue >= 1000) {
    return `${(value / 1000).toFixed(1)}K`;
  }
  return value.toFixed(2);
};

const formatDateTime = (timestamp: number | string) => {
  const date = new Date(Number(timestamp));
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('ru-RU', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatPriceValue = (value: any) => {
  const num = Number(value);
  return Number.isFinite(num) ? num.toFixed(2) : '—';
};

const formatDeltaValue = (value: any) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  const prefix = num > 0 ? '+' : '';
  return `${prefix}${num.toFixed(2)}`;
};

const formatPercentValue = (value: any) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  const prefix = num > 0 ? '+' : '';
  return `${prefix}${num.toFixed(2)}%`;
};

const formatTimeLeft = (value: any) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  const totalSeconds = Math.max(0, Math.floor(num / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const formatRelativeTime = (date: Date): string => {
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.round(diffMs / 1000);
  if (Number.isNaN(diffSec)) return '—';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
};

const getOrderStatusSeverity = (status: string): 'success' | 'info' | 'warning' | 'danger' | 'secondary' => {
  const statusLower = status?.toLowerCase() || '';
  if (statusLower.includes('filled')) return 'success';
  if (statusLower.includes('cancelled')) return 'danger';
  if (statusLower.includes('new')) return 'info';
  if (statusLower.includes('partialfilled')) return 'warning';
  return 'secondary';
};

const refreshExchangeHistory = async () => {
  exchangeHistoryLoading.value = true;
  try {
    await scannerStore.loadExchangeHistory();
  } finally {
    exchangeHistoryLoading.value = false;
  }
};

const refreshClosedExecutions = async () => {
  closedExecutionsLoading.value = true;
  try {
    await scannerStore.loadExecutions();
  } finally {
    closedExecutionsLoading.value = false;
  }
};

const loadTotalPnL = async () => {
  totalPnLLoading.value = true;
  try {
    const response = await fetch('http://localhost:5000/api/scanner/total-pnl');
    const data = await response.json();
    if (data.success) {
      totalPnLData.value = {
        mode: data.mode,
        realizedPnL: data.realizedPnL || 0,
        unrealizedPnL: data.unrealizedPnL || 0,
        totalPnL: data.totalPnL || 0,
        positionCount: data.positionCount || 0,
      };
    }
  } catch (error) {
    console.error('Failed to load total PnL:', error);
  } finally {
    totalPnLLoading.value = false;
  }
};

// Автоматическая загрузка данных при переключении на вкладки
watch(activeTab, async (newTab) => {
  if (newTab === 'exchange') {
    await refreshExchangeHistory();
  } else if (newTab === 'closed') {
    await refreshClosedExecutions();
  } else if (newTab === 'positions') {
    await syncExchangeData();
  }
});

// Периодическое обновление данных
let refreshInterval: ReturnType<typeof setInterval> | null = null;

const startAutoRefresh = () => {
  // Обновляем каждые 5 секунд для лучшей отзывчивости
  refreshInterval = setInterval(async () => {
    await Promise.all([
      scannerStore.loadStatus(),
      scannerStore.loadSignals(),
      scannerStore.loadExecutions(),
      scannerStore.loadExchangeHistory(),
      loadTotalPnL(),
    ]);
  }, 5000);
};

const stopAutoRefresh = () => {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
};

onMounted(async () => {
  await settingsStore.fetchAvailableTradingPairs();
  await refreshData();
  await loadTotalPnL();
  
  // Запускаем автообновление
  startAutoRefresh();
});

onUnmounted(() => {
  stopAutoRefresh();
});
</script>
