<template>
  <form @submit.prevent="onSubmit">
    <!-- Группа DLC -->
    <Fieldset legend="Dynamic Levels (DLC)" :toggleable="true" v-if="editableSettings.dlc">
      <div class="p-fluid p-formgrid p-grid">
        <!-- <div class="p-field p-col-12 p-md-6">
          <label for="dlcPeriod">Период профиля (0 или пусто для авто)</label>
          <InputNumber id="dlcPeriod" v-model="editableSettings.dlc.period" :min="0" />
        </div> -->
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
    <Fieldset legend="Nadaraya-Watson Envelope (NWE)" :toggleable="true" class="p-mt-3" v-if="editableSettings.nwe">
        <div class="p-fluid p-formgrid p-grid">
        <div class="p-field p-col-12 p-md-4">
            <label for="nweLookback">Период поиска экстремумов (lookbackPeriod)</label>
            <InputNumber id="nweLookback" v-model="editableSettings.nwe.lookbackPeriod" :min="1" />
        </div>
        <div class="p-field p-col-12 p-md-4">
            <label for="nweAtrPeriod">Период ATR (atrPeriod)</label>
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
    <Fieldset legend="Cluster Analysis" :toggleable="true" class="p-mt-3" v-if="editableSettings.clusters">
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
            <label for="clusterLookback">Период для базы (lookbackPeriod)</label>
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

    <!-- Группа Risk Management (теперь risk) -->
    <Fieldset legend="Risk Management" :toggleable="true" class="p-mt-3" v-if="editableSettings.risk">
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
            <label for="riskPositionSizePercentage">Доля капитала на сделку (0.01 = 1%)</label>
            <InputNumber id="riskPositionSizePercentage" v-model="editableSettings.risk.positionSizePercentage" mode="decimal" :min="0" :max="1" :minFractionDigits="3" :maxFractionDigits="3" />
        </div>
        <div class="p-field p-col-12 p-md-6">
            <label for="riskMaxRiskPerTrade">Макс. риск на сделку (0.01 = 1%)</label>
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
    
    <!-- Общие параметры стратегии -->
    <Fieldset legend="Общие параметры индикаторов" :toggleable="true" class="p-mt-3">
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
  </form>
</template>

<script setup lang="ts">
import { ref, watch, defineProps, defineEmits, toRefs, nextTick } from 'vue'; // Убраны onMounted и getAvailableTradingPairs, TradingPair
import type { StrategyParameters } from '@/types/strategy';

import InputNumber from 'primevue/inputnumber';
import InputText from 'primevue/inputtext';
import Checkbox from 'primevue/checkbox';
import Dropdown from 'primevue/dropdown';
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
  // Перед emit, убедимся что все необходимые вложенные объекты существуют
  // так как v-if="editableSettings.risk && editableSettings.risk.useTrailingStop" 
  // может привести к тому что `risk` не будет определен если он не был в modelValue изначально
  // и ни одно поле в нем не было изменено.
  // Однако, store должен инициализировать все поля.
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

const onSubmit = () => {
  // Убедимся, что отправляем копию с инициализированными подобъектами
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
</style> 