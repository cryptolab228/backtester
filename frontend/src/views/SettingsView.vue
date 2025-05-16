<template>
  <div class="settings-view p-d-flex p-flex-column p-ai-center">
    <Card class="p-mt-4 p-mb-4" style="width: 80%; max-width: 900px;">
      <template #title>
        Настройки Стратегии
      </template>
      <template #content>
        <div v-if="settingsStore.isLoading" class="p-d-flex p-jc-center p-ai-center" style="min-height: 200px;">
          <ProgressSpinner />
        </div>
        <div v-if="settingsStore.error" class="p-message p-message-error">
          <p>Ошибка: {{ settingsStore.error }}</p>
          <p>Загружены настройки по умолчанию. Попробуйте обновить страницу или сохранить новые настройки.</p>
        </div>

        <form @submit.prevent="saveSettingsHandler" v-if="editableSettings">
          <!-- Группа DLC -->
          <Fieldset legend="Dynamic Levels (DLC)" :toggleable="true">
            <div class="p-fluid p-formgrid p-grid">
              <div class="p-field p-col-12 p-md-6">
                <label for="dlcPeriod">Период профиля (0 или пусто для авто)</label>
                <InputNumber id="dlcPeriod" v-model="editableSettings.dlc.period" :min="0" />
              </div>
              <div class="p-field p-col-12 p-md-6">
                <label for="dlcNumProfiles">Количество профилей</label>
                <InputNumber id="dlcNumProfiles" v-model="editableSettings.dlc.numProfiles" :min="1" />
              </div>
              <div class="p-field p-col-12 p-md-6">
                <label for="dlcNumBins">Количество бинов (numBins)</label>
                <InputNumber id="dlcNumBins" v-model="editableSettings.dlc.numBins" :min="1" />
              </div>
              <div class="p-field p-col-12 p-md-6">
                <label for="dlcVaPercentage">Процент VA (vaPercentage)</label>
                <InputNumber id="dlcVaPercentage" v-model="editableSettings.dlc.vaPercentage" mode="decimal" :min="0" :max="1" :minFractionDigits="2" :maxFractionDigits="2" />
              </div>
              <div class="p-field p-col-12 p-md-4">
                <label for="dlcPocColor">Цвет POC</label>
                <InputText id="dlcPocColor" v-model="editableSettings.dlc.pocColor" />
              </div>
              <div class="p-field p-col-12 p-md-4">
                <label for="dlcVahColor">Цвет VAH</label>
                <InputText id="dlcVahColor" v-model="editableSettings.dlc.vahColor" />
              </div>
              <div class="p-field p-col-12 p-md-4">
                <label for="dlcValColor">Цвет VAL</label>
                <InputText id="dlcValColor" v-model="editableSettings.dlc.valColor" />
              </div>
            </div>
          </Fieldset>

          <!-- Группа NWE -->
          <Fieldset legend="Nadaraya-Watson Envelope (NWE)" :toggleable="true" class="p-mt-3">
             <div class="p-fluid p-formgrid p-grid">
              <div class="p-field p-col-12 p-md-4">
                <label for="nweLookback">Период поиска экстремумов</label>
                <InputNumber id="nweLookback" v-model="editableSettings.nwe.lookbackPeriod" :min="1" />
              </div>
              <div class="p-field p-col-12 p-md-4">
                <label for="nweAtrPeriod">Период ATR</label>
                <InputNumber id="nweAtrPeriod" v-model="editableSettings.nwe.atrPeriod" :min="1" />
              </div>
              <div class="p-field p-col-12 p-md-4">
                <label for="nweAtrMultiplier">Множитель ATR</label>
                <InputNumber id="nweAtrMultiplier" v-model="editableSettings.nwe.atrMultiplier" mode="decimal" :min="0" :minFractionDigits="1" :maxFractionDigits="2" />
              </div>
              <div class="p-field p-col-12 p-md-6">
                <label for="nweUpColor">Цвет верхней линии NWE</label>
                <InputText id="nweUpColor" v-model="editableSettings.nwe.upColor" />
              </div>
              <div class="p-field p-col-12 p-md-6">
                <label for="nweDownColor">Цвет нижней линии NWE</label>
                <InputText id="nweDownColor" v-model="editableSettings.nwe.downColor" />
              </div>
            </div>
          </Fieldset>
          
          <!-- Группа Clusters -->
          <Fieldset legend="Cluster Analysis" :toggleable="true" class="p-mt-3">
            <div class="p-fluid p-formgrid p-grid">
              <div class="p-field p-col-12 p-md-4">
                <label for="clusterSource">Источник кластеров</label>
                <Dropdown id="clusterSource" v-model="editableSettings.clusters.source" :options="clusterSourceOptions" optionLabel="label" optionValue="value" placeholder="Выберите источник" />
              </div>
              <div class="p-field p-col-12 p-md-4">
                <label for="clusterThreshold">Множитель порога</label>
                <InputNumber id="clusterThreshold" v-model="editableSettings.clusters.thresholdMultiplier" mode="decimal" :min="0" :minFractionDigits="1" :maxFractionDigits="2" />
              </div>
              <div class="p-field p-col-12 p-md-4">
                <label for="clusterLookback">Период для базы</label>
                <InputNumber id="clusterLookback" v-model="editableSettings.clusters.lookbackPeriod" :min="1" />
              </div>
              <div class="p-field p-col-12 p-md-4">
                <label for="clusterConfirmationBars">Бары подтверждения</label>
                <InputNumber id="clusterConfirmationBars" v-model="editableSettings.clusters.confirmationBars" :min="0" />
              </div>
              <div class="p-field p-col-12 p-md-4">
                <label for="clusterBuyColor">Цвет кластера покупки</label>
                <InputText id="clusterBuyColor" v-model="editableSettings.clusters.buyColor" />
              </div>
              <div class="p-field p-col-12 p-md-4">
                <label for="clusterSellColor">Цвет кластера продажи</label>
                <InputText id="clusterSellColor" v-model="editableSettings.clusters.sellColor" />
              </div>
            </div>
          </Fieldset>

          <!-- Группа Risk Management -->
          <Fieldset legend="Risk Management" :toggleable="true" class="p-mt-3">
            <div class="p-fluid p-formgrid p-grid">
              <div class="p-field p-col-12 p-md-4">
                <label for="riskAtrPeriod">Период ATR для SL/TP</label>
                <InputNumber id="riskAtrPeriod" v-model="editableSettings.risk.atrPeriod" :min="1" />
              </div>
              <div class="p-field p-col-12 p-md-4">
                <label for="riskSlMultiplier">Множитель SL</label>
                <InputNumber id="riskSlMultiplier" v-model="editableSettings.risk.stopLossMultiplier" mode="decimal" :min="0" :minFractionDigits="1" :maxFractionDigits="2" />
              </div>
              <div class="p-field p-col-12 p-md-4">
                <label for="riskTpMultiplier">Множитель TP</label>
                <InputNumber id="riskTpMultiplier" v-model="editableSettings.risk.takeProfitMultiplier" mode="decimal" :min="0" :minFractionDigits="1" :maxFractionDigits="2"/>
              </div>
               <div class="p-field p-col-12 p-md-6">
                <label for="riskPositionSizePercentage">% капитала на сделку (если ATR метод не используется)</label>
                <InputNumber id="riskPositionSizePercentage" v-model="editableSettings.risk.positionSizePercentage" mode="decimal" :min="0" :max="1" :minFractionDigits="3" :maxFractionDigits="3" />
              </div>
              <div class="p-field p-col-12 p-md-6">
                <label for="riskMaxRiskPerTrade">Макс. риск на сделку % (ATR метод)</label>
                <InputNumber id="riskMaxRiskPerTrade" v-model="editableSettings.risk.maxRiskPerTradePercentage" mode="decimal" :min="0" :max="1" :minFractionDigits="3" :maxFractionDigits="3" />
              </div>
              <div class="p-field-checkbox p-col-12 p-md-6">
                <Checkbox id="riskUseTrailingStop" v-model="editableSettings.risk.useTrailingStop" :binary="true" />
                <label for="riskUseTrailingStop" class="p-ml-2">Использовать Trailing Stop</label>
              </div>
              <div v-if="editableSettings.risk.useTrailingStop" class="p-field p-col-12 p-md-6">
                <label for="riskTrailingStopOffset">Множитель смещения Trailing Stop (ATR)</label>
                <InputNumber id="riskTrailingStopOffset" v-model="editableSettings.risk.trailingStopOffsetMultiplier" mode="decimal" :min="0" :minFractionDigits="1" :maxFractionDigits="2" />
              </div>
              <div class="p-field p-col-12 p-md-6">
                <label for="riskMaxTradesPerDay">Макс. сделок в день (0 = без огр.)</label>
                <InputNumber id="riskMaxTradesPerDay" v-model="editableSettings.risk.maxTradesPerDay" :min="0" />
              </div>
            </div>
          </Fieldset>
          
          <!-- Общие параметры -->
          <Fieldset legend="Общие параметры стратегии" :toggleable="true" class="p-mt-3">
            <div class="p-fluid p-formgrid p-grid">
                <div class="p-field p-col-12 p-md-6">
                    <label for="globalAtrPeriod">Глобальный период ATR</label>
                    <InputNumber id="globalAtrPeriod" v-model="editableSettings.globalAtrPeriod" :min="1" />
                </div>
                <div class="p-field p-col-12 p-md-6">
                    <label for="avgVolumePeriod">Период среднего объема</label>
                    <InputNumber id="avgVolumePeriod" v-model="editableSettings.avgVolumePeriod" :min="1" />
                </div>
            </div>
          </Fieldset>

          <div class="p-d-flex p-jc-end p-mt-4">
            <Button type="submit" label="Сохранить настройки" icon="pi pi-save" :loading="settingsStore.isLoading" />
          </div>
        </form>
      </template>
    </Card>
    <Toast /> 
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { useSettingsStore } from '@/stores/settingsStore';
import type { StrategyParameters } from '@/types/strategy';

import Card from 'primevue/card';
import Button from 'primevue/button';
import InputNumber from 'primevue/inputnumber';
import InputText from 'primevue/inputtext';
import Checkbox from 'primevue/checkbox';
import Dropdown from 'primevue/dropdown';
import Fieldset from 'primevue/fieldset';
import ProgressSpinner from 'primevue/progressspinner';
import Toast from 'primevue/toast';
import { useToast } from 'primevue/usetoast';

const settingsStore = useSettingsStore();
const toast = useToast();

// Локальная копия настроек для редактирования в форме
// Инициализируем с дефолтными значениями, чтобы избежать ошибок undefined при первом рендере
const editableSettings = ref<StrategyParameters>(JSON.parse(JSON.stringify(settingsStore.currentSettings)));

const clusterSourceOptions = ref([
  { label: 'Объем', value: 'volume' },
  { label: 'Дельта (аппроксимированная)', value: 'delta' },
]);

onMounted(async () => {
  if (!settingsStore.parameters) { // Загружаем только если в сторе еще нет параметров
      await settingsStore.fetchSettings();
  }
  // После загрузки или если параметры уже были, обновляем локальную копию
  // Используем JSON.parse(JSON.stringify(...)) для глубокого копирования, чтобы избежать мутаций состояния Pinia напрямую
  editableSettings.value = JSON.parse(JSON.stringify(settingsStore.currentSettings));
});

// Следим за изменениями в store (например, после fetchSettings) и обновляем локальную копию
watch(() => settingsStore.parameters, (newParams) => {
  if (newParams) {
    editableSettings.value = JSON.parse(JSON.stringify(newParams));
  }
}, { deep: true });

const saveSettingsHandler = async () => {
  if (editableSettings.value) {
    await settingsStore.updateSettings(editableSettings.value);
    if (!settingsStore.error) {
      toast.add({ severity: 'success', summary: 'Сохранено', detail: 'Настройки успешно обновлены', life: 3000 });
    } else {
      toast.add({ severity: 'error', summary: 'Ошибка сохранения', detail: settingsStore.error, life: 5000 });
    }
  }
};

// Если editableSettings.value.dlc и т.д. могут быть undefined, то для v-model это вызовет ошибку.
// Поэтому при инициализации и после загрузки мы используем JSON.parse(JSON.stringify(settingsStore.currentSettings))
// settingsStore.currentSettings всегда возвращает полный объект StrategyParameters (либо из state, либо initialDefaultParameters)

</script>

<style scoped>
.settings-view {
  padding: 1rem;
}
</style> 