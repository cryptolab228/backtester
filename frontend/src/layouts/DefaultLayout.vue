<template>
  <div class="flex h-screen bg-slate-50">
    <!-- Компактный сайдбар -->
    <div class="w-56 bg-white border-r border-slate-200 flex flex-col">
      <!-- Логотип -->
      <div class="p-3 border-b border-slate-100">
        <router-link to="/" class="flex items-center gap-2 text-slate-800 hover:text-primary transition-colors">
          <i class="pi pi-chart-line text-xl"></i>
          <span class="font-semibold text-base">Backtester V2</span>
        </router-link>
      </div>
      
      <!-- Меню -->
      <nav class="flex-1 overflow-y-auto hide-scrollbar p-2">
        <div v-for="item in menuItems" :key="item.label" class="mb-1">
          <router-link
            :to="item.to"
            class="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-all"
            active-class="bg-blue-50 text-blue-600 font-medium"
          >
            <i :class="item.icon" class="text-base"></i>
            <span>{{ item.label }}</span>
          </router-link>
        </div>
      </nav>
      
      <!-- Футер сайдбара -->
      <div class="p-3 border-t border-slate-100 text-xs text-slate-400 text-center">
        © {{ currentYear }} BT V2
      </div>
    </div>

    <!-- Основной контент -->
    <div class="flex-1 flex flex-col overflow-hidden">
      <!-- Компактная шапка -->
      <header class="bg-white border-b border-slate-200 px-6 py-3">
        <div class="flex items-center justify-between">
          <h1 class="text-lg font-semibold text-slate-800">{{ pageTitle }}</h1>
          <div class="flex items-center gap-2 text-xs text-slate-500">
            <i class="pi pi-clock"></i>
            <span>{{ currentTime }}</span>
          </div>
        </div>
      </header>
      
      <!-- Контент страницы -->
      <main class="flex-1 overflow-x-hidden overflow-y-auto bg-slate-50 p-4">
        <router-view v-slot="{ Component }">
          <transition name="fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();

const currentYear = new Date().getFullYear();
const currentTime = ref('');

// Обновление времени
const updateTime = () => {
  const now = new Date();
  currentTime.value = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
};

let timeInterval: number;

onMounted(() => {
  updateTime();
  timeInterval = window.setInterval(updateTime, 60000); // Обновляем каждую минуту
});

onUnmounted(() => {
  if (timeInterval) clearInterval(timeInterval);
});

// Заголовок страницы
const pageTitle = computed(() => {
  const titles: Record<string, string> = {
    'Home': 'Панель управления',
    'DataManagement': 'Управление данными',
    'QueueManager': 'Менеджер очереди',
    'Backtester': 'Бэктестер',
    'Scanner': 'Торговый сканнер',
    'Sessions': 'Торговые сессии',
    'Settings': 'Настройки'
  };
  return titles[route.name as string] || route.name || 'Backtester V2';
});

// Компактное меню
const menuItems = ref([
  {
    label: 'Главная',
    icon: 'pi pi-home',
    to: '/'
  },
  {
    label: 'Данные',
    icon: 'pi pi-database',
    to: '/data'
  },
  {
    label: 'Очередь',
    icon: 'pi pi-list',
    to: '/queue-manager'
  },
  {
    label: 'Бэктестер',
    icon: 'pi pi-chart-line',
    to: '/backtester'
  },
  {
    label: 'Сканнер',
    icon: 'pi pi-search',
    to: '/scanner'
  },
  {
    label: 'Сессии',
    icon: 'pi pi-history',
    to: '/sessions'
  },
  {
    label: 'Настройки',
    icon: 'pi pi-cog',
    to: '/settings'
  }
]);
</script>

<style scoped>
/* Переход между страницами */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* Скрытие скроллбара в навигации */
.hide-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}

.hide-scrollbar::-webkit-scrollbar {
  display: none;
}

/* Активная ссылка */
.router-link-active {
  background-color: #eff6ff;
  color: #2563eb;
  font-weight: 500;
}
</style> 