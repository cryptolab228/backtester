<template>
  <div class="flex h-screen bg-gray-100 dark:bg-gray-900">
    <!-- Sidebar -->
    <div class="w-64 bg-white dark:bg-gray-800 shadow-md">
      <div class="p-4">
        <router-link to="/" class="text-xl font-semibold text-gray-700 dark:text-gray-200 hover:text-blue-500">
          Backtester V2
        </router-link>
      </div>
      <PanelMenu :model="menuItems" class="w-full" />
    </div>

    <!-- Main content -->
    <div class="flex-1 flex flex-col overflow-hidden">
      <header class="bg-white dark:bg-gray-800 shadow-sm">
        <div class="container mx-auto px-6 py-4">
          <!-- Заголовок текущей страницы или хлебные крошки можно будет получать из $route.meta.title -->
          <h2 class="text-lg font-semibold text-gray-700 dark:text-gray-200">{{ $route.name }}</h2>
          <!-- ТЕСТОВАЯ ССЫЛКА -->
          <router-link to="/settings" class="text-blue-500 hover:underline ml-4">Тест на Настройки</router-link>
        </div>
      </header>
      <main class="flex-1 overflow-x-hidden overflow-y-auto bg-gray-200 dark:bg-gray-700 p-6">
        <router-view />
      </main>
       <!-- Опциональный футер из вашего оригинального layout -->
      <footer class="text-center p-4 text-gray-600 dark:text-gray-400 text-sm bg-white dark:bg-gray-800">
         © {{ new Date().getFullYear() }} Backtester V2
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import PanelMenu from 'primevue/panelmenu';
import type { MenuItem } from 'primevue/menuitem';
import { useRouter } from 'vue-router';

const router = useRouter();

const menuItems = ref<MenuItem[]>([
  {
    label: 'Home',
    icon: 'pi pi-home',
    command: () => router.push('/')
  },
  {
    label: 'Управление данными',
    icon: 'pi pi-database',
    command: () => router.push('/data')
  },
  {
    label: 'Очередь задач',
    icon: 'pi pi-list',
    command: () => router.push('/queue-manager')
  },
  {
    label: 'Бектестер',
    icon: 'pi pi-chart-line',
    command: () => router.push('/backtester')
  },
  {
    label: 'Сканнер',
    icon: 'pi pi-search',
    command: () => router.push('/scanner')
  },
  {
    label: 'Настройки',
    icon: 'pi pi-cog',
    command: () => router.push('/settings')
  }
]);
</script>

<style scoped>
/* Стили Tailwind применяются напрямую */
/* PrimeVue PanelMenu может потребовать глобальных стилей темы,
   убедитесь, что тема PrimeVue (например, lara-light-indigo)
   и PrimeIcons подключены в main.ts */
.w-full { /* Для PanelMenu, чтобы занимал всю ширину сайдбара, если нет других ограничений */
  width: 100%;
}
</style> 