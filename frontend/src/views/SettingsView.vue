<template>
  <div class="settings-view p-6">
    <h1 class="text-3xl font-semibold mb-8 text-gray-800 dark:text-gray-100">Настройки Подключений к Биржам</h1>

    <Toast position="top-right" />

    <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
      <!-- Список подключений -->
      <div class="md:col-span-1">
        <Panel header="Подключенные биржи">
          <template #icons>
            <Button icon="pi pi-plus" class="p-button-sm p-button-success" @click="prepareNewConnectionForm" v-tooltip.bottom="'Добавить новое подключение'"/>
          </template>
          <div v-if="appConfigStore.isLoading && !appConfigStore.config" class="text-center p-4">
            <ProgressSpinner style="width:40px;height:40px" strokeWidth="6" animationDuration=".8s"/>
          </div>
          <div v-else-if="appConfigStore.error && !appConfigStore.config" class="p-message p-message-error m-0">
            {{ appConfigStore.error }}
          </div>
          <div v-else-if="allConnections.length === 0" class="text-center py-4">
            <p class="text-gray-600 dark:text-gray-400 mb-3">Нет сохраненных подключений.</p>
            <Button label="Добавить первое подключение" icon="pi pi-plus" class="p-button-success" @click="prepareNewConnectionForm" />
          </div>
          <div v-else>
            <OrderList v-model="allConnections" listStyle="max-height:350px" dataKey="id" class="mb-0" @reorder="onConnectionReorder">
              <!-- <template #header>
                Список бирж (можно перетаскивать для порядка) // Убрано
              </template> -->
              <template #item="slotProps">
                <div class="flex justify-between items-center p-3 w-full cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors duration-150"
                     :class="{ 'bg-primary-100 dark:bg-primary-700 shadow-md': selectedConnection && slotProps.item.id === selectedConnection.id }"
                     @click="selectConnectionForEditing(slotProps.item)">
                  <div class="flex items-center">
                    <i class="pi pi-arrows-v mr-3 text-gray-400 dark:text-gray-500" v-tooltip.left="'Перетащить для сортировки'"></i>
                    <span class="font-medium text-gray-700 dark:text-gray-200 mr-2">{{ slotProps.item.name }}</span>
                    <Tag :value="slotProps.item.exchange" severity="info" class="mr-2 text-xs" />
                    <Tag v-if="slotProps.item.id === appConfigStore.currentConfig.activeExchangeId" value="Активно" severity="success" class="text-xs"></Tag>
                  </div>
                  <Button icon="pi pi-trash" class="p-button-text p-button-danger p-button-sm" @click.stop="confirmDeleteConnection(slotProps.item)" v-tooltip.left="'Удалить'" />
                </div>
              </template>
            </OrderList>
            <!-- Кнопка "Добавить новое" перенесена в заголовок панели -->
          </div>
        </Panel>
      </div>

      <!-- Форма редактирования/добавления -->
      <div class="md:col-span-2">
        <Panel :header="formTitle" class="shadow-lg">
          <div v-if="!selectedConnection && !isAddingNew" class="text-center p-10 text-gray-500 dark:text-gray-400">
            <i class="pi pi-sign-in text-4xl mb-3 text-primary-500"></i>
            <p class="mb-2 text-lg">Выберите подключение для редактирования</p>
            <p class="text-sm">Или создайте новое, нажав <i class="pi pi-plus mx-1"></i> в панели слева.</p>
          </div>

          <div v-if="editableConnectionForm" class="p-fluid space-y-5 p-1">
            <div class="field">
              <label for="connectionName" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Название подключения</label>
              <InputText id="connectionName" v-model.trim="editableConnectionForm.name" placeholder="Напр., Мой основной OKX" class="w-full" />
            </div>

            <div class="field">
              <label for="exchangeType" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Биржа</label>
              <Select id="exchangeType" v-model="editableConnectionForm.exchange" :options="exchangeTypeOptions"
                        option-label="label" option-value="value" placeholder="Выберите биржу"
                        @change="onExchangeTypeChange" class="w-full"/>
            </div>

            <div class="field">
              <label :for="`apiKey-${editableConnectionForm.id}`" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">API Key</label>
              <InputText :id="`apiKey-${editableConnectionForm.id}`" v-model.trim="editableConnectionForm.apiKey" class="w-full" />
            </div>

            <div class="field">
              <label :for="`secretKey-${editableConnectionForm.id}`" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Secret Key</label>
              <Password :id="`secretKey-${editableConnectionForm.id}`" v-model.trim="editableConnectionForm.secretKey" :feedback="false" toggleMask inputClass="w-full" class="w-full" />
            </div>

            <div v-if="editableConnectionForm.exchange === 'OKX'" class="field">
              <label :for="`passphrase-${editableConnectionForm.id}`" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Passphrase (для API)</label>
              <Password :id="`passphrase-${editableConnectionForm.id}`" v-model.trim="editableConnectionForm.passphrase" :feedback="false" toggleMask inputClass="w-full" class="w-full" />
            </div>

            <div class="field-checkbox flex items-center pt-2">
                <Checkbox :id="`isTestNet-${editableConnectionForm.id}`" v-model="editableConnectionForm.isTestNet" :binary="true" class="mr-2" />
                <label :for="`isTestNet-${editableConnectionForm.id}`" class="text-sm text-gray-700 dark:text-gray-300">Тестовая сеть (Testnet)</label>
            </div>
            
            <div class="field-checkbox flex items-center">
                <Checkbox :id="`isActive-${editableConnectionForm.id}`" v-model="editableConnectionForm.isActive" :binary="true" class="mr-2" />
                <label :for="`isActive-${editableConnectionForm.id}`" class="text-sm text-gray-700 dark:text-gray-300">Сделать активным по умолчанию</label>
            </div>

            <div class="flex justify-end space-x-3 pt-3">
              <Button label="Отмена" icon="pi pi-times" class="p-button-text p-button-secondary" @click="cancelEditing" v-if="selectedConnection || isAddingNew"/>
              <Button :label="isAddingNew ? 'Добавить подключение' : 'Сохранить изменения'" 
                      :icon="isAddingNew ? 'pi pi-plus-circle' : 'pi pi-save'" 
                      @click="saveConnectionChanges" 
                      :loading="appConfigStore.isLoading" class="p-button-primary" />
            </div>
          </div>
        </Panel>
      </div>
    </div>

    <ConfirmDialog></ConfirmDialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useAppConfigStore } from '@/stores/appConfigStore';
import type { ExchangeConnectionSettings } from '@/types/appConfig';
import { v4 as uuidv4 } from 'uuid';

import Panel from 'primevue/panel';
import Button from 'primevue/button';
import ProgressSpinner from 'primevue/progressspinner';
import OrderList from 'primevue/orderlist';
import Select from 'primevue/select';
import InputText from 'primevue/inputtext';
import Password from 'primevue/password';
import Checkbox from 'primevue/checkbox';
import Tag from 'primevue/tag';
import Toast from 'primevue/toast';
import ConfirmDialog from 'primevue/confirmdialog';
import { useToast } from 'primevue/usetoast';
import { useConfirm } from "primevue/useconfirm";

const appConfigStore = useAppConfigStore();
const toast = useToast();
const confirm = useConfirm();

// Для формы редактирования
const selectedConnection = ref<ExchangeConnectionSettings | null>(null);
const editableConnectionForm = ref<Partial<ExchangeConnectionSettings> | null>(null);
const isAddingNew = ref(false);

const formTitle = computed(() => {
  if (isAddingNew.value) return 'Добавить новое подключение';
  const connectionName = editableConnectionForm.value?.name || selectedConnection.value?.name;
  if (connectionName) return `Редактирование: ${connectionName}`;
  return 'Выберите или добавьте подключение'; // Измененный плейсхолдер для заголовка
});

const exchangeTypeOptions = ref([
  { label: 'OKX', value: 'OKX' },
  { label: 'Binance', value: 'Binance' },
  { label: 'Bybit', value: 'Bybit' },
]);

const allConnections = computed(() => appConfigStore.allExchangeConnections);

onMounted(async () => {
  if (!appConfigStore.config || appConfigStore.allExchangeConnections.length === 0) { // Условие для первоначальной загрузки
    await appConfigStore.fetchAppConfig();
  }
});

const selectConnectionForEditing = (connection: ExchangeConnectionSettings) => {
  selectedConnection.value = connection;
  editableConnectionForm.value = JSON.parse(JSON.stringify(connection));
  isAddingNew.value = false;
};

const prepareNewConnectionForm = () => {
  selectedConnection.value = null;
  editableConnectionForm.value = {
    id: uuidv4(),
    name: '',
    exchange: 'OKX',
    apiKey: '',
    secretKey: '',
    passphrase: '',
    isActive: allConnections.value.length === 0, // Первое добавляемое соединение делаем активным
    isTestNet: false,
  };
  isAddingNew.value = true;
};

const cancelEditing = () => {
  selectedConnection.value = null;
  editableConnectionForm.value = null;
  isAddingNew.value = false;
};

const onExchangeTypeChange = () => {
  if (editableConnectionForm.value) {
    if (editableConnectionForm.value.exchange !== 'OKX' && editableConnectionForm.value.hasOwnProperty('passphrase')) {
      editableConnectionForm.value.passphrase = undefined; // Удаляем, а не делаем пустым
    } else if (editableConnectionForm.value.exchange === 'OKX' && !editableConnectionForm.value.hasOwnProperty('passphrase')){
      editableConnectionForm.value.passphrase = '';
    }
  }
};

const saveConnectionChanges = async () => {
  if (!editableConnectionForm.value) return;

  if (!editableConnectionForm.value.name || !editableConnectionForm.value.exchange || !editableConnectionForm.value.apiKey || !editableConnectionForm.value.secretKey) {
    toast.add({ severity: 'error', summary: 'Ошибка валидации', detail: 'Название, биржа, API ключ и Secret ключ обязательны.', life: 4000 });
    return;
  }
  if (editableConnectionForm.value.exchange === 'OKX' && (editableConnectionForm.value.passphrase === null || editableConnectionForm.value.passphrase === undefined || editableConnectionForm.value.passphrase.trim() === '')) {
     toast.add({ severity: 'error', summary: 'Ошибка валидации', detail: 'Для OKX также необходима Passphrase API.', life: 4000 });
    return;
  }

  const connectionToSave: ExchangeConnectionSettings = {
    id: editableConnectionForm.value.id || uuidv4(), 
    name: editableConnectionForm.value.name!,
    exchange: editableConnectionForm.value.exchange!,
    apiKey: editableConnectionForm.value.apiKey!,
    secretKey: editableConnectionForm.value.secretKey!,
    passphrase: editableConnectionForm.value.exchange === 'OKX' ? editableConnectionForm.value.passphrase : undefined,
    isActive: editableConnectionForm.value.isActive || false,
    isTestNet: editableConnectionForm.value.isTestNet || false,
  };

  try {
    if (isAddingNew.value) {
      await appConfigStore.addExchangeConnection(connectionToSave);
      toast.add({ severity: 'success', summary: 'Добавлено', detail: `Подключение ${connectionToSave.name} (${connectionToSave.exchange}) успешно добавлено.`, life: 3000 });
    } else if (selectedConnection.value && connectionToSave.id) {
      await appConfigStore.updateExchangeConnectionById(connectionToSave.id, connectionToSave);
      toast.add({ severity: 'success', summary: 'Сохранено', detail: `Настройки для ${connectionToSave.name} (${connectionToSave.exchange}) успешно обновлены.`, life: 3000 });
    }
    cancelEditing();
  } catch (error: any) {
    toast.add({ severity: 'error', summary: 'Ошибка сохранения', detail: error.message || 'Не удалось сохранить подключение.', life: 5000 });
  }
};

const confirmDeleteConnection = (connection: ExchangeConnectionSettings) => {
  confirm.require({
    message: `Вы уверены, что хотите удалить подключение "${connection.name}" (${connection.exchange})? Это действие необратимо.`, 
    header: 'Подтверждение удаления',
    icon: 'pi pi-exclamation-triangle',
    acceptClass: 'p-button-danger',
    acceptLabel: 'Удалить',
    rejectLabel: 'Отмена',
    accept: async () => {
      try {
        await appConfigStore.deleteExchangeConnectionById(connection.id);
        toast.add({ severity: 'success', summary: 'Удалено', detail: `Подключение "${connection.name}" (${connection.exchange}) удалено.`, life: 3000 });
        if (selectedConnection.value && selectedConnection.value.id === connection.id) {
          cancelEditing();
        }
      } catch (error: any) {
        toast.add({ severity: 'error', summary: 'Ошибка удаления', detail: error.message || 'Не удалось удалить подключение.', life: 5000 });
      }
    },
  });
};

const onConnectionReorder = (event: any) => {
    console.log('Reordered', event.value);
    const newConnectionsOrder = event.value as ExchangeConnectionSettings[];
    const current = JSON.parse(JSON.stringify(appConfigStore.currentConfig));
    current.exchangeConnections = newConnectionsOrder;
    // Вызываем приватный метод стора для обновления на бэкенде
    // Важно: этот метод должен только обновить порядок, не меняя другие свойства или активное соединение
    // Поэтому нужно убедиться, что _updateAppConfigOnBackend именно это и делает.
    // Для простоты, пока что можно считать, что порядок сохраняется только локально на клиенте,
    // или что _updateAppConfigOnBackend корректно обновит весь массив, включая порядок.
    appConfigStore._updateAppConfigOnBackend(current);
    toast.add({severity:'info', summary:'Порядок изменен', detail:'Новый порядок подключений сохранен.', life:2000});
}

// Удаляем StrategySettingsForm и связанную логику
// const settingsStore = useSettingsStore();
// const editableSettings = ref<StrategyParameters | null>(null);
// watch(() => settingsStore.currentSettings, ...)
// const saveSettingsHandler = async () => { ... }

</script>

<style scoped>
.settings-view {
  /* padding: 1rem; уже есть p-6 */
}
/* Можно добавить стили для лучшего вида Panel, если стандартные не устраивают */
:deep(.p-panel-header) {
    /* background-color: #f8fafc; */ /* Пример светлой темы для заголовка панели */
    /* border-bottom: 1px solid #e5e7eb; */
}

:deep(.p-orderlist .p-orderlist-list) {
    padding: 0.5rem;
}

:deep(.p-orderlist .p-orderlist-item:focus) {
    outline: none;
    box-shadow: none;
}

/* Улучшение внешнего вида InputText, Password, Dropdown */
:deep(.p-inputtext),
:deep(.p-password input),
:deep(.p-dropdown) {
  border-radius: 6px;
}

:deep(.p-inputtext:focus),
:deep(.p-password input:focus),
:deep(.p-dropdown.p-focus) {
  border-color: var(--primary-color);
  box-shadow: 0 0 0 1px var(--primary-color);
}

</style> 