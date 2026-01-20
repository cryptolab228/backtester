<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-content">
      <div class="modal-header">
        <h2 class="text-2xl font-bold">Создать новую сессию</h2>
        <button @click="$emit('close')" class="close-btn">&times;</button>
      </div>

      <form @submit.prevent="handleSubmit" class="modal-body">
        <!-- Название сессии -->
        <div class="form-group">
          <label for="session-name" class="form-label required">
            Название сессии
          </label>
          <input
            id="session-name"
            v-model="formData.name"
            type="text"
            class="form-input"
            placeholder="Например: Тестирование BTCUSDT"
            required
            maxlength="100"
          />
          <p class="form-hint">
            Дайте понятное название для идентификации сессии
          </p>
        </div>

        <!-- Заметки -->
        <div class="form-group">
          <label for="session-notes" class="form-label">
            Заметки (опционально)
          </label>
          <textarea
            id="session-notes"
            v-model="formData.notes"
            class="form-input"
            rows="3"
            placeholder="Описание целей, параметров или особенностей этой сессии..."
            maxlength="500"
          ></textarea>
          <p class="form-hint">
            {{ formData.notes?.length || 0 }} / 500
          </p>
        </div>

        <!-- Биржа -->
        <div class="form-group">
          <label for="session-exchange" class="form-label">
            Биржа
          </label>
          <select
            id="session-exchange"
            v-model="formData.exchange"
            class="form-input"
          >
            <option value="bybit">Bybit</option>
            <option value="binance">Binance</option>
          </select>
        </div>

        <!-- Торговые пары -->
        <div class="form-group">
          <label for="session-pairs" class="form-label">
            Торговые пары (опционально)
          </label>
          <input
            id="session-pairs"
            v-model="pairsInput"
            type="text"
            class="form-input"
            placeholder="BTCUSDT, ETHUSDT, SOLUSDT"
          />
          <p class="form-hint">
            Разделяйте пары запятыми. Оставьте пустым для всех пар из конфигурации.
          </p>
        </div>

        <!-- Таймфреймы -->
        <div class="form-group">
          <label for="session-timeframes" class="form-label">
            Таймфреймы (опционально)
          </label>
          <div class="checkbox-group">
            <label v-for="tf in availableTimeframes" :key="tf" class="checkbox-label">
              <input
                type="checkbox"
                :value="tf"
                v-model="selectedTimeframes"
                class="checkbox-input"
              />
              <span>{{ tf }}</span>
            </label>
          </div>
          <p class="form-hint">
            Оставьте пустым для использования таймфреймов из конфигурации.
          </p>
        </div>

        <!-- Ошибка -->
        <div v-if="error" class="error-message">
          {{ error }}
        </div>

        <!-- Кнопки -->
        <div class="modal-footer">
          <button
            type="button"
            @click="$emit('close')"
            class="btn btn-secondary"
            :disabled="loading"
          >
            Отмена
          </button>
          <button
            type="submit"
            class="btn btn-primary"
            :disabled="loading || !formData.name.trim()"
          >
            <span v-if="loading">Создание...</span>
            <span v-else>Создать сессию</span>
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { sessionService } from '@/services/sessionService';
import type { TradingSession, CreateSessionParams } from '@/types/session';

const emit = defineEmits<{
  close: [];
  created: [session: TradingSession];
}>();

const availableTimeframes = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];

const formData = ref<CreateSessionParams>({
  name: '',
  notes: '',
  exchange: 'bybit',
  pairs: [],
  timeframes: [],
});

const pairsInput = ref('');
const selectedTimeframes = ref<string[]>([]);
const loading = ref(false);
const error = ref('');

async function handleSubmit() {
  error.value = '';
  
  // Валидация
  if (!formData.value.name.trim()) {
    error.value = 'Название сессии обязательно';
    return;
  }

  // Обработка торговых пар
  if (pairsInput.value.trim()) {
    formData.value.pairs = pairsInput.value
      .split(',')
      .map(p => p.trim().toUpperCase())
      .filter(p => p.length > 0);
  } else {
    formData.value.pairs = [];
  }

  // Обработка таймфреймов
  formData.value.timeframes = selectedTimeframes.value.length > 0
    ? selectedTimeframes.value
    : [];

  try {
    loading.value = true;
    const newSession = await sessionService.createSession(formData.value);
    emit('created', newSession);
  } catch (err: any) {
    error.value = err.response?.data?.error || err.message || 'Ошибка при создании сессии';
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.modal-overlay {
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

.modal-content {
  background: white;
  border-radius: 12px;
  max-width: 600px;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem;
  border-bottom: 1px solid #e5e7eb;
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

.modal-body {
  padding: 1.5rem;
}

.form-group {
  margin-bottom: 1.5rem;
}

.form-label {
  display: block;
  font-weight: 600;
  margin-bottom: 0.5rem;
  color: #374151;
}

.form-label.required::after {
  content: ' *';
  color: #ef4444;
}

.form-input {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 1rem;
  transition: border-color 0.2s;
}

.form-input:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.form-hint {
  margin-top: 0.25rem;
  font-size: 0.875rem;
  color: #6b7280;
}

.checkbox-group {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  user-select: none;
}

.checkbox-input {
  width: 1.25rem;
  height: 1.25rem;
  cursor: pointer;
}

.error-message {
  padding: 0.75rem;
  background: #fee2e2;
  border: 1px solid #fca5a5;
  border-radius: 6px;
  color: #dc2626;
  margin-bottom: 1rem;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  margin-top: 1.5rem;
  padding-top: 1.5rem;
  border-top: 1px solid #e5e7eb;
}

.btn {
  padding: 0.75rem 1.5rem;
  border-radius: 6px;
  font-weight: 600;
  border: none;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 1rem;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: #3b82f6;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: #2563eb;
}

.btn-secondary {
  background: #e5e7eb;
  color: #374151;
}

.btn-secondary:hover:not(:disabled) {
  background: #d1d5db;
}
</style>





