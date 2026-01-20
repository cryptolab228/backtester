# Новая архитектура сессий — Требования

## 🎯 Цель изменений

**Старое поведение:**
- Сканер создаёт сессию автоматически при старте
- Бэктестер тоже пытается создавать сессии
- Нет контроля со стороны пользователя
- Сессии смешиваются, нет чёткого разделения

**Новое поведение:**
- ✅ Сессии работают **ТОЛЬКО** для сканера
- ✅ Бэктестер работает **БЕЗ** сессий (как сейчас, сохраняет результаты в JSON)
- ✅ Сканер **НЕ ЗАПУСКАЕТСЯ** без выбора/создания сессии
- ✅ Пользователь **полностью контролирует** сессии через UI
- ✅ При падении сервера — автоматический выбор последней сессии
- ✅ Возможность принудительно завершить активную сессию

---

## 🏗️ Архитектура

### Состояния системы

```
┌─────────────────────────────────────────────────────────┐
│              СОСТОЯНИЯ СКАНЕРА                          │
└─────────────────────────────────────────────────────────┘

1. IDLE (Сервер запущен, сканер не работает)
   ↓
   [Пользователь выбирает/создаёт сессию]
   ↓
2. STARTING (Инициализация сканера с выбранной сессией)
   ↓
3. RUNNING (Сканер работает, записывает в сессию)
   ↓
   [Пользователь останавливает / сервер падает]
   ↓
4. STOPPED (Сканер остановлен, сессия завершена)
   ↓
   Возврат в IDLE
```

### Пользовательские сценарии

#### Сценарий 1: Первый запуск
```
1. Пользователь запускает сервер
2. Открывает фронтенд
3. Видит экран выбора сессии:
   ┌──────────────────────────────────────┐
   │  🎯 Выберите сессию для сканера      │
   ├──────────────────────────────────────┤
   │  📋 Список сессий:                   │
   │     (пусто)                          │
   │                                      │
   │  [+ Создать новую сессию]            │
   └──────────────────────────────────────┘
4. Нажимает "Создать новую сессию"
5. Заполняет форму:
   - Название сессии (например, "Test BTC+ETH majors")
   - Торговые пары (выбор из списка)
   - Таймфреймы
   - Режим (demo/testnet)
   - Комментарий (опционально)
6. Нажимает "Создать и запустить"
7. Сканер запускается с выбранными настройками
```

#### Сценарий 2: Продолжение существующей сессии
```
1. Пользователь запускает сервер
2. Видит список сессий:
   ┌──────────────────────────────────────┐
   │  📋 Список сессий:                   │
   ├──────────────────────────────────────┤
   │  ✅ [Активная] Test BTC+ETH majors   │
   │     Создана: 17.10.2025 20:00        │
   │     Сделок: 12 | PnL: +5.3%          │
   │                                      │
   │  📝 [Завершена] BTCUSDT only         │
   │     17.10.2025 10:00 - 15:30         │
   │     Сделок: 8 | PnL: +2.1%           │
   │                                      │
   │  [+ Создать новую сессию]            │
   └──────────────────────────────────────┘
3. Выбирает активную сессию "Test BTC+ETH majors"
4. Сканер продолжает работу с этой сессией
```

#### Сценарий 3: Смена сессии во время работы
```
1. Сканер работает с сессией "Test BTC+ETH majors"
2. Пользователь хочет протестировать другие пары
3. Идёт во вкладку "Сессии"
4. Нажимает "Остановить и завершить текущую сессию"
5. Видит подтверждение:
   ┌──────────────────────────────────────┐
   │  ⚠️ Завершить сессию?                │
   ├──────────────────────────────────────┤
   │  Сессия: Test BTC+ETH majors         │
   │  Открытых позиций: 2                 │
   │                                      │
   │  ⚠️ Все открытые позиции будут       │
   │     закрыты по рыночной цене         │
   │                                      │
   │  [Отмена]  [Завершить сессию]        │
   └──────────────────────────────────────┘
6. Подтверждает завершение
7. Система:
   - Закрывает все открытые позиции
   - Обновляет финальные метрики
   - Помечает сессию как 'completed'
8. Создаёт новую сессию с другими настройками
9. Запускает сканер заново
```

#### Сценарий 4: Восстановление после падения
```
1. Сканер работает с сессией "Test BTC+ETH majors"
2. Сервер падает (ошибка, перезагрузка системы)
3. Пользователь перезапускает сервер
4. Система автоматически:
   - Находит последнюю активную сессию
   - Восстанавливает её
   - Показывает уведомление:
     ┌──────────────────────────────────────┐
     │  ℹ️ Сессия восстановлена             │
     ├──────────────────────────────────────┤
     │  Восстановлена сессия:               │
     │  "Test BTC+ETH majors"               │
     │                                      │
     │  Открытых позиций восстановлено: 2   │
     │  Закрыто фантомных позиций: 1        │
     │                                      │
     │  [OK]                                │
     └──────────────────────────────────────┘
5. Сканер продолжает работу с той же сессией
```

---

## 🔧 Технические изменения

### Backend

#### 1. Новый контроллер сессий
```typescript
// backend/src/modules/scanner/scanner.session.controller.ts

class ScannerSessionController {
  // Список всех сессий (для выбора)
  async listSessions(req, res)
  
  // Создание новой сессии (БЕЗ запуска сканера)
  async createSession(req, res)
  
  // Старт сканера с выбранной сессией
  async startScanner(req, res)
  
  // Остановка сканера и завершение сессии
  async stopScanner(req, res)
  
  // Получение текущей активной сессии
  async getActiveSession(req, res)
  
  // Принудительное завершение сессии
  async forceEndSession(req, res)
}
```

#### 2. Изменения в bootstrap
```typescript
// backend/src/modules/scanner/scanner.bootstrap.ts

// ❌ СТАРОЕ:
export const bootstrapScanner = async () => {
  // Создаёт сессию автоматически
  const session = await sessionManager.createSession({...});
  await scanner.start();
}

// ✅ НОВОЕ:
export const bootstrapScanner = async () => {
  // НЕ создаёт сессию, НЕ запускает сканер
  // Только инициализирует зависимости
  await scannerConfigService.init();
  await RedisSignalStore.init();
  await clearExecutionCaches();
  
  // Проверяет, была ли активная сессия (восстановление после падения)
  const restoredSession = await sessionManager.restoreLastActiveSession();
  if (restoredSession) {
    // Автоматический запуск только если была активная сессия
    await startScannerWithSession(restoredSession.id);
  }
  
  // Иначе ждёт команды от пользователя
}

export const startScannerWithSession = async (sessionId: string) => {
  const session = await sessionManager.getSession(sessionId);
  if (!session) throw new Error('Session not found');
  
  // Настроить сканер под параметры сессии
  const config = {
    pairs: session.pairs,
    timeframes: session.timeframes,
    executionMode: session.mode,
  };
  
  // Запустить сканер
  scannerInstance = new ScannerService(config);
  await scannerInstance.start();
  
  // Привязать сессию
  sessionManager.setCurrentSessionId(sessionId);
}

export const stopScannerAndEndSession = async () => {
  if (!scannerInstance) return;
  
  // Остановить сканер
  await scannerInstance.stop();
  
  // Закрыть все открытые позиции
  const openPositions = await executionManager.getOpenPositions();
  for (const pos of openPositions) {
    await executionManager.closePosition(pos.id, {
      exitReason: 'session_ended',
      exitPrice: pos.currentPrice,
      exitAt: Date.now(),
    });
  }
  
  // Завершить сессию
  const sessionId = sessionManager.getCurrentSessionId();
  if (sessionId) {
    await sessionManager.endSession(sessionId, 'completed', 'Stopped by user');
  }
  
  scannerInstance = null;
}
```

#### 3. Убрать сессии из бэктестера
```typescript
// backend/src/modules/backtester/services/backtestSessionService.ts

// ❌ УДАЛИТЬ ВСЁ:
// - saveAsSession()
// - recordTradeFromBacktest()
// - любые вызовы sessionManager

// ✅ Бэктестер сохраняет результаты только в JSON
// (как сейчас работает через BacktesterController)
```

#### 4. API Endpoints

```typescript
// Новые эндпоинты для управления сессиями

GET    /api/scanner/sessions              // Список всех сессий
POST   /api/scanner/sessions              // Создать новую сессию
GET    /api/scanner/sessions/active       // Получить активную сессию
POST   /api/scanner/start/:sessionId      // Запустить сканер с сессией
POST   /api/scanner/stop                  // Остановить сканер и завершить сессию
POST   /api/scanner/sessions/:id/end      // Принудительно завершить сессию
GET    /api/scanner/status                // Статус сканера (idle/running/stopped)
```

---

### Frontend

#### 1. Новый компонент: SessionSelector.vue
```vue
<template>
  <div class="session-selector">
    <!-- Если сканер не запущен -->
    <div v-if="scannerStatus === 'idle'">
      <h2>Выберите сессию для запуска сканера</h2>
      
      <!-- Список существующих сессий -->
      <div class="sessions-list">
        <SessionCard 
          v-for="session in sessions" 
          :key="session.id"
          :session="session"
          @select="selectSession"
        />
      </div>
      
      <!-- Кнопка создания новой -->
      <button @click="showCreateModal = true">
        + Создать новую сессию
      </button>
    </div>
    
    <!-- Если сканер работает -->
    <div v-else-if="scannerStatus === 'running'">
      <h2>Активная сессия: {{ activeSession.name }}</h2>
      <SessionMetrics :session="activeSession" />
      
      <button @click="stopScanner" class="danger">
        Остановить и завершить сессию
      </button>
    </div>
  </div>
  
  <!-- Модальное окно создания сессии -->
  <CreateSessionModal 
    v-if="showCreateModal"
    @created="onSessionCreated"
    @close="showCreateModal = false"
  />
</template>
```

#### 2. Новый компонент: CreateSessionModal.vue
```vue
<template>
  <Modal title="Создать новую сессию">
    <form @submit.prevent="createSession">
      <!-- Название сессии -->
      <input 
        v-model="form.name" 
        placeholder="Название сессии (например, BTC+ETH majors)"
        required
      />
      
      <!-- Выбор торговых пар -->
      <MultiSelect 
        v-model="form.pairs"
        :options="availablePairs"
        label="Торговые пары"
      />
      
      <!-- Выбор таймфреймов -->
      <MultiSelect 
        v-model="form.timeframes"
        :options="['15m', '1h', '4h', '1d']"
        label="Таймфреймы"
      />
      
      <!-- Режим -->
      <select v-model="form.mode">
        <option value="demo">Demo (виртуальные сделки)</option>
        <option value="testnet">Testnet (реальные API, тестовые деньги)</option>
        <option value="live">Live (ОСТОРОЖНО: реальные деньги!)</option>
      </select>
      
      <!-- Комментарий -->
      <textarea 
        v-model="form.notes" 
        placeholder="Комментарий (опционально)"
      />
      
      <button type="submit">Создать и запустить</button>
    </form>
  </Modal>
</template>

<script setup lang="ts">
const emit = defineEmits(['created', 'close']);

const form = ref({
  name: '',
  pairs: ['BTCUSDT', 'ETHUSDT'],
  timeframes: ['1h', '4h'],
  mode: 'demo',
  notes: '',
});

async function createSession() {
  const response = await api.post('/api/scanner/sessions', form.value);
  const session = response.data;
  
  // Запустить сканер с новой сессией
  await api.post(`/api/scanner/start/${session.id}`);
  
  emit('created', session);
}
</script>
```

#### 3. Изменения в главной навигации

```vue
<!-- frontend/src/layouts/MainLayout.vue -->

<nav>
  <RouterLink to="/scanner">Сканер</RouterLink>
  <RouterLink to="/sessions">Сессии</RouterLink>  <!-- НОВАЯ ВКЛАДКА -->
  <RouterLink to="/backtester">Бэктестер</RouterLink>
  <RouterLink to="/settings">Настройки</RouterLink>
</nav>
```

#### 4. Новый View: SessionsView.vue
```vue
<template>
  <div class="sessions-view">
    <h1>Торговые сессии сканера</h1>
    
    <!-- Текущая активная сессия (если есть) -->
    <section v-if="activeSession" class="active-session">
      <h2>🟢 Активная сессия</h2>
      <SessionDetailCard 
        :session="activeSession" 
        :is-active="true"
        @end="confirmEndSession"
      />
    </section>
    
    <!-- История завершённых сессий -->
    <section class="completed-sessions">
      <h2>📋 История сессий</h2>
      
      <div class="filters">
        <input v-model="search" placeholder="Поиск по названию..." />
        <select v-model="filterMode">
          <option value="">Все режимы</option>
          <option value="demo">Demo</option>
          <option value="testnet">Testnet</option>
          <option value="live">Live</option>
        </select>
      </div>
      
      <div class="sessions-grid">
        <SessionCard 
          v-for="session in filteredSessions" 
          :key="session.id"
          :session="session"
          @view="viewSessionDetails"
        />
      </div>
    </section>
    
    <!-- Кнопка создания новой -->
    <FloatingButton 
      @click="showCreateModal = true"
      icon="+"
      label="Создать сессию"
    />
  </div>
</template>
```

---

## 🗄️ Изменения в БД

### Новые поля в `trading_sessions`

```sql
ALTER TABLE trading_sessions ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE trading_sessions ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE trading_sessions ADD COLUMN IF NOT EXISTS auto_started BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN trading_sessions.name IS 'User-friendly session name';
COMMENT ON COLUMN trading_sessions.notes IS 'User notes about session purpose/strategy';
COMMENT ON COLUMN trading_sessions.auto_started IS 'TRUE if session was auto-restored after server crash';
```

### Индексы для быстрого поиска

```sql
CREATE INDEX IF NOT EXISTS idx_sessions_status ON trading_sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_source ON trading_sessions(source);
CREATE INDEX IF NOT EXISTS idx_sessions_mode ON trading_sessions(mode);
CREATE INDEX IF NOT EXISTS idx_sessions_created ON trading_sessions(created_at DESC);
```

---

## 🎨 UI/UX детали

### Карточка сессии
```
┌─────────────────────────────────────────────────┐
│ 🟢 Test BTC+ETH majors             [Активная]   │
├─────────────────────────────────────────────────┤
│ Режим: Demo                                     │
│ Пары: BTCUSDT, ETHUSDT, XRPUSDT, SOLUSDT        │
│ Таймфреймы: 1h, 4h                              │
│                                                 │
│ 📊 Метрики:                                     │
│   • Сделок: 12 (8 ✅ / 4 ❌)                    │
│   • PnL: +5.3% (+$530)                          │
│   • Винрейт: 66.7%                              │
│   • Открытых: 2                                 │
│                                                 │
│ 🕐 Создана: 17.10.2025 20:00                    │
│ ⏱ Длительность: 4ч 23мин                        │
│                                                 │
│ [Остановить]  [Подробнее]                       │
└─────────────────────────────────────────────────┘
```

### Завершённая сессия
```
┌─────────────────────────────────────────────────┐
│ ✅ BTCUSDT only testing                         │
├─────────────────────────────────────────────────┤
│ Режим: Demo                                     │
│ 17.10.2025 10:00 - 15:30 (5ч 30мин)            │
│                                                 │
│ 📊 Итоги:                                       │
│   • Сделок: 8 (6 ✅ / 2 ❌)                     │
│   • PnL: +2.1% (+$210)                          │
│   • Винрейт: 75%                                │
│   • Max DD: -1.2%                               │
│                                                 │
│ 💬 "Testing single pair performance"            │
│                                                 │
│ [Подробнее]  [Сравнить]                         │
└─────────────────────────────────────────────────┘
```

---

## 🔄 Миграционный план

### Этап 1: Backend foundation (2-3 часа)
- [ ] Создать `scanner.session.controller.ts`
- [ ] Добавить новые API endpoints
- [ ] Обновить `scanner.bootstrap.ts` (убрать автосоздание сессии)
- [ ] Добавить методы `startScannerWithSession()`, `stopScannerAndEndSession()`
- [ ] Удалить сессии из `backtestSessionService.ts`

### Этап 2: Database migrations (30 минут)
- [ ] Добавить поля `name`, `notes`, `auto_started`
- [ ] Создать индексы
- [ ] Протестировать миграции

### Этап 3: Frontend components (3-4 часа)
- [ ] Создать `SessionSelector.vue`
- [ ] Создать `CreateSessionModal.vue`
- [ ] Создать `SessionsView.vue`
- [ ] Создать `SessionCard.vue` и `SessionDetailCard.vue`
- [ ] Обновить навигацию

### Этап 4: Integration (1-2 часа)
- [ ] Интегрировать SessionSelector в ScannerView
- [ ] Добавить WebSocket уведомления о статусе сканера
- [ ] Добавить уведомления о восстановлении сессии

### Этап 5: Testing (1-2 часа)
- [ ] Тест: создание сессии → запуск → остановка
- [ ] Тест: смена сессии
- [ ] Тест: восстановление после падения
- [ ] Тест: принудительное завершение с открытыми позициями

**Общее время: 8-12 часов**

---

## 📋 Чеклист готовности

### Backend
- [ ] Сканер НЕ запускается автоматически
- [ ] Создание сессии НЕ запускает сканер
- [ ] API для старта/стопа сканера работает
- [ ] Восстановление сессии работает после падения
- [ ] Бэктестер НЕ создаёт сессии

### Frontend
- [ ] Экран выбора сессии показывается при входе в раздел "Сканер"
- [ ] Можно создать новую сессию через форму
- [ ] Можно выбрать существующую сессию
- [ ] Можно остановить активную сессию
- [ ] Вкладка "Сессии" показывает всю историю
- [ ] Уведомление о восстановлении сессии после падения

### UX
- [ ] Интуитивно понятный интерфейс
- [ ] Подтверждение перед остановкой с открытыми позициями
- [ ] Быстрый доступ к метрикам активной сессии
- [ ] Возможность сравнить сессии

---

## 🎯 Ожидаемый результат

После реализации пользователь сможет:
1. ✅ Создавать именованные сессии с разными настройками
2. ✅ Тестировать разные комбинации пар и таймфреймов
3. ✅ Сравнивать результаты между сессиями
4. ✅ Полностью контролировать старт/стоп сканера
5. ✅ Не беспокоиться о потере данных при падении сервера
6. ✅ Видеть историю всех торговых экспериментов

Это превратит систему из "автоматического робота" в **гибкий инструмент для тестирования стратегий**.





