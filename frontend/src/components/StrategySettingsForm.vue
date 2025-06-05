<template>
  <form @submit.prevent="onSubmit">
    <!-- Группа DLC -->
    <Fieldset legend="Dynamic Levels (DLC)" :toggleable="true" v-if="editableSettings.dlc">
      <div class="p-fluid p-formgrid p-grid">
        <div class="p-field p-col-12 p-md-6">
          <label for="dlcPeriod">Период профиля (dlc_period)</label>
          <InputNumber id="dlcPeriod" v-model="editableSettings.dlc.period" :min="10" :max="200" />
        </div>
        <div class="p-field p-col-12 p-md-6">
          <label for="dlcPocLookback">Период направления POC (poc_lookback)</label>
          <InputNumber id="dlcPocLookback" v-model="editableSettings.dlc.pocLookback" :min="3" :max="20" />
        </div>
        <div class="p-field p-col-12 p-md-6">
          <label for="dlcNumProfiles">Количество профилей</label>
          <InputNumber id="dlcNumProfiles" v-model="editableSettings.dlc.numProfiles" :min="1" />
        </div>
        <div class="p-field p-col-12 p-md-6">
          <label for="dlcNumBins">Количество бинов (numBins)</label>
          <InputNumber id="dlcNumBins" v-model="editableSettings.dlc.numBins" :min="1" :max="200" />
        </div>
        <div class="p-field p-col-12 p-md-6">
          <label for="dlcVaPercentage">Процент VA (value_area_percent)</label>
          <InputNumber id="dlcVaPercentage" v-model="editableSettings.dlc.vaPercentage" mode="decimal" :min="0.5" :max="0.9" :step="0.01" :minFractionDigits="2" :maxFractionDigits="2" />
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
    <Fieldset legend="Nadaraya-Watson Envelope (NWE)" :toggleable="true" class="p-mt-3" v-if="editableSettings.nwe">
        <div class="p-fluid p-formgrid p-grid">
          <div class="p-field-checkbox p-col-12 p-md-6">
            <Checkbox id="nweEnabled" v-model="editableSettings.nwe.enabled" :binary="true" />
            <label for="nweEnabled" class="p-ml-2">Использовать NWE (use_nwe)</label>
          </div>
          <div class="p-field p-col-12 p-md-6">
            <label for="nweBandwidth">Bandwidth (h)</label>
            <InputNumber id="nweBandwidth" v-model="editableSettings.nwe.bandwidth" mode="decimal" :min="0" :step="0.1" :minFractionDigits="1" :maxFractionDigits="2" />
          </div>
          <div class="p-field p-col-12 p-md-6">
            <label for="nweMultiplier">Множитель (mult)</label>
            <InputNumber id="nweMultiplier" v-model="editableSettings.nwe.multiplier" mode="decimal" :min="0" :step="0.1" :minFractionDigits="1" :maxFractionDigits="2" />
          </div>
          <div class="p-field p-col-12 p-md-6">
            <label for="nweSource">Источник (nwe_src)</label>
            <Select id="nweSource" v-model="editableSettings.nwe.source" :options="nweSourceOptions" option-label="label" option-value="value" placeholder="Выберите источник" />
          </div>
          <div class="p-field-checkbox p-col-12 p-md-6">
            <Checkbox id="nweRepaint" v-model="editableSettings.nwe.repaint" :binary="true" />
            <label for="nweRepaint" class="p-ml-2">Перерисовка (repaint)</label>
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
    <Fieldset legend="Cluster Analysis" :toggleable="true" class="p-mt-3" v-if="editableSettings.clusters">
        <div class="p-fluid p-formgrid p-grid">
          <div class="p-field p-col-12 p-md-4">
              <label for="clusterSource">Источник кластеров</label>
              <Select id="clusterSource" v-model="editableSettings.clusters.source" :options="clusterSourceOptions" option-label="label" option-value="value" placeholder="Выберите источник" />
          </div>
          <div class="p-field p-col-12 p-md-4">
              <label for="clusterMinVolumeThreshold">Множитель порога объема (min_volume_threshold)</label>
              <InputNumber id="clusterMinVolumeThreshold" v-model="editableSettings.clusters.minVolumeThresholdMultiplier" mode="decimal" :min="1.0" :max="5.0" :step="0.1" :minFractionDigits="1" :maxFractionDigits="2" />
          </div>
          <div class="p-field p-col-12 p-md-4">
            <label for="clusterDeltaThreshold">Порог дельты (delta_threshold)</label>
            <InputNumber id="clusterDeltaThreshold" v-model="editableSettings.clusters.deltaThreshold" mode="decimal" :min="0.5" :max="0.9" :step="0.05" :minFractionDigits="2" :maxFractionDigits="2" />
          </div>
          <div class="p-field p-col-12 p-md-4">
              <label for="clusterLookback">Период для базы (lookbackPeriod)</label>
              <InputNumber id="clusterLookback" v-model="editableSettings.clusters.lookbackPeriod" :min="1" />
          </div>
          <div class="p-field p-col-12 p-md-4">
              <label for="clusterConfirmationBars">Бары подтверждения</label>
              <InputNumber id="clusterConfirmationBars" v-model="editableSettings.clusters.confirmationBars" :min="0" :max="5" />
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
    <Fieldset legend="Risk Management" :toggleable="true" class="p-mt-3" v-if="editableSettings.risk">
        <div class="p-fluid p-formgrid p-grid">
          <div class="p-field p-col-12 p-md-4">
              <label for="riskAtrPeriod">Период ATR для SL/TP (atr_period)</label>
              <InputNumber id="riskAtrPeriod" v-model="editableSettings.risk.atrPeriod" :min="5" :max="50" />
          </div>
          <div class="p-field p-col-12 p-md-4">
              <label for="riskPositionSizePercentage">Риск на сделку (%) (risk_percent)</label>
              <InputNumber id="riskPositionSizePercentage" v-model="editableSettings.risk.positionSizePercentage" mode="decimal" :min="0.001" :max="0.05" :step="0.001" :minFractionDigits="3" :maxFractionDigits="3" />
          </div>
           <div class="p-field p-col-12 p-md-4">
              <label for="riskSlMultiplier">Stop Loss (ATR множитель)</label>
              <InputNumber id="riskSlMultiplier" v-model="editableSettings.risk.stopLossMultiplier" mode="decimal" :min="0.5" :max="5.0" :step="0.1" :minFractionDigits="1" :maxFractionDigits="2" />
          </div>
          <div class="p-field p-col-12 p-md-4">
              <label for="riskTpMultiplier">Take Profit (ATR множитель)</label>
              <InputNumber id="riskTpMultiplier" v-model="editableSettings.risk.takeProfitMultiplier" mode="decimal" :min="1.0" :max="10.0" :step="0.1" :minFractionDigits="1" :maxFractionDigits="2"/>
          </div>
          <div class="p-field p-col-12 p-md-4">
              <label for="riskMaxTradesPerDay">Макс. сделок в день (max_trades_per_day)</label>
              <InputNumber id="riskMaxTradesPerDay" v-model="editableSettings.risk.maxTradesPerDay" :min="1" :max="10" />
          </div>
          <div class="p-field-checkbox p-col-12 p-md-4">
              <Checkbox id="riskUseTrailingStop" v-model="editableSettings.risk.useTrailingStop" :binary="true" />
              <label for="riskUseTrailingStop" class="p-ml-2">Использовать Trailing Stop (use_trailing_stop)</label>
          </div>
          <div v-if="editableSettings.risk.useTrailingStop" class="p-field p-col-12 p-md-4">
              <label for="riskTrailingStopOffsetMult">Множитель смещения TRL ST (trail_offset_mult)</label>
              <InputNumber id="riskTrailingStopOffsetMult" v-model="editableSettings.risk.trailingStopOffsetMultiplier" mode="decimal" :min="1.0" :max="5.0" :step="0.1" :minFractionDigits="1" :maxFractionDigits="2" />
          </div>
          <div v-if="editableSettings.risk.useTrailingStop" class="p-field p-col-12 p-md-4">
            <label for="riskTrailingStopStepMult">Шаг TRL ST (ATR множ.) (trailing_step)</label>
            <InputNumber id="riskTrailingStopStepMult" v-model="editableSettings.risk.trailingStopStepMultiplier" mode="decimal" :min="0.1" :max="5.0" :step="0.1" :minFractionDigits="1" :maxFractionDigits="2" />
          </div>
          <div class="p-field p-col-12 p-md-4">
              <label for="riskMaxRiskPerTrade">Макс. риск на сделку (доп. контроль, 0.01 = 1%)</label>
              <InputNumber id="riskMaxRiskPerTrade" v-model="editableSettings.risk.maxRiskPerTradePercentage" mode="decimal" :min="0" :max="1" :minFractionDigits="3" :maxFractionDigits="3" />
          </div>
        </div>
    </Fieldset>
    
    <!-- Общие параметры стратегии - УДАЛЕНЫ -->
  </form>
</template>

<script setup lang="ts">
import { ref, watch, defineProps, defineEmits, toRefs, nextTick } from 'vue';
import type { StrategyParameters } from '@/types/strategy';

import InputNumber from 'primevue/inputnumber';
import InputText from 'primevue/inputtext';
import Checkbox from 'primevue/checkbox';
import Select from 'primevue/select';
import Fieldset from 'primevue/fieldset';

const props = defineProps<{
  modelValue: StrategyParameters;
}>();

const emit = defineEmits(['update:modelValue', 'submit']);

const { modelValue } = toRefs(props);
const editableSettings = ref<StrategyParameters>(JSON.parse(JSON.stringify(modelValue.value)));
const isUpdatingFromProp = ref(false);

watch(modelValue, async (newValue) => {
  if (JSON.stringify(editableSettings.value) !== JSON.stringify(newValue)) {
    isUpdatingFromProp.value = true;
    editableSettings.value = JSON.parse(JSON.stringify(newValue));
    await nextTick(); 
    isUpdatingFromProp.value = false; 
  }
}, { deep: true });

watch(editableSettings, (newSettings) => {
  if (isUpdatingFromProp.value) {
    return;
  }
  const newSettingsCopy = JSON.parse(JSON.stringify(newSettings));
  if (!newSettingsCopy.dlc) newSettingsCopy.dlc = {};
  if (!newSettingsCopy.nwe) newSettingsCopy.nwe = {};
  if (!newSettingsCopy.clusters) newSettingsCopy.clusters = {};
  if (!newSettingsCopy.risk) newSettingsCopy.risk = {};

  emit('update:modelValue', newSettingsCopy);
}, { deep: true });

const clusterSourceOptions = ref([
  { label: 'Объем', value: 'volume' },
  { label: 'Дельта (аппроксимированная)', value: 'delta' },
]);

const nweSourceOptions = ref([
  { label: 'Close', value: 'close' },
  { label: 'Open', value: 'open' },
  { label: 'High', value: 'high' },
  { label: 'Low', value: 'low' },
]);

const onSubmit = () => {
  const settingsToSubmit = JSON.parse(JSON.stringify(editableSettings.value));
  if (!settingsToSubmit.dlc) settingsToSubmit.dlc = {};
  if (!settingsToSubmit.nwe) settingsToSubmit.nwe = {};
  if (!settingsToSubmit.clusters) settingsToSubmit.clusters = {};
  if (!settingsToSubmit.risk) settingsToSubmit.risk = {};
  emit('submit', settingsToSubmit);
};

</script>

<style scoped>
.p-field {
  margin-bottom: 1rem;
}
.p-field-checkbox label {
  margin-left: 0.5rem;
}
.p-field-checkbox {
 display: flex;
 align-items: center; /* Вертикальное выравнивание чекбокса и метки */
 margin-bottom: 1rem; /* Отступ снизу, как у обычных полей */
}

</style> 