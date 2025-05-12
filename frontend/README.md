# Vue 3 + TypeScript + Vite

This template should help get you started developing with Vue 3 and TypeScript in Vite. The template uses Vue 3 `<script setup>` SFCs, check out the [script setup docs](https://v3.vuejs.org/api/sfc-script-setup.html#sfc-script-setup) to learn more.

Learn more about the recommended Project Setup and IDE Support in the [Vue Docs TypeScript Guide](https://vuejs.org/guide/typescript/overview.html#project-setup).

## Структура Приложения и Навигация

Проект использует основной макет `src/layouts/DefaultLayout.vue`, который включает:

*   Боковую панель навигации, созданную с использованием компонента `PanelMenu` из PrimeVue.
*   Верхнюю панель для отображения заголовка текущего раздела (используется `$route.name`).
*   Основную область для контента страницы (`<router-view>`).
*   Футер.

Навигационные ссылки определены в `DefaultLayout.vue` и соответствуют маршрутам, настроенным в `src/router/index.ts`.

### Основные разделы:

*   **Home (`/`)**: Главная страница приложения (компонент `src/views/HomeView.vue`).
*   **Управление данными (`/data`)**: Страница для загрузки торговых пар и исторических данных (компонент `src/views/DataManagementView.vue`).
*   **Очередь задач (`/queue-manager`)**: Страница для управления и мониторинга фоновых задач (компонент `src/views/QueueManagerView.vue`).
*   **Бектестер (`/backtester`)**: Раздел для проведения бэктестинга торговых стратегий (компонент `src/views/BacktesterView.vue`).
*   **Сканнер (`/scanner`)**: Раздел для сканирования рынка на наличие торговых сигналов (компонент `src/views/ScannerView.vue`).
*   **Настройки (`/settings`)**: Страница для конфигурации параметров приложения и стратегий (компонент `src/views/SettingsView.vue`).

### Запуск и Отладка (Общее)

1.  Убедитесь, что все зависимости установлены: `npm install` (или `yarn`).
2.  Запустите dev-сервер: `npm run dev` (или `yarn dev`).
3.  Откройте приложение в браузере по адресу, указанному в консоли (обычно `http://localhost:5173` или аналогичный).

Убедитесь, что ваш `main.ts` (или `main.js`) корректно инициализирует Vue Router, PrimeVue (с необходимой темой и иконками) и Tailwind CSS. Пример подключения PrimeVue:

```typescript
// main.ts
import { createApp } from 'vue';
import App from './App.vue';
import router from './router';
import PrimeVue from 'primevue/config';
import ToastService from 'primevue/toastservice';

// Импорт темы PrimeVue (например, Lara Light Indigo)
import 'primevue/resources/themes/lara-light-indigo/theme.css';
// Импорт базовых стилей PrimeVue
import 'primevue/resources/primevue.min.css';
// Импорт иконок PrimeIcons
import 'primeicons/primeicons.css';

// Импорт стилей Tailwind
import './assets/main.css'; // Или где у вас основные стили Tailwind (index.css, style.css)

const app = createApp(App);

app.use(router);
app.use(PrimeVue);
app.use(ToastService);

// Глобальная регистрация компонентов PrimeVue (если не используете unplugin-vue-components)
// import Button from 'primevue/button';
// app.component('Button', Button);

app.mount('#app');
```

Убедитесь, что в `tailwind.config.js` путь к файлам PrimeVue добавлен в `content`, если вы планируете стилизовать их с помощью Tailwind:

```javascript
// tailwind.config.js
export default {
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
    "./node_modules/primevue/**/*.{vue,js,ts,jsx,tsx}" // Добавьте эту строку
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
```
