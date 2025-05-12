import { createApp } from 'vue'
import App from './App.vue'
import router from './router' // Импортируем роутер
import { createPinia } from 'pinia' // Импортируем Pinia
import PrimeVue from 'primevue/config';
import ToastService from 'primevue/toastservice';
import ConfirmationService from 'primevue/confirmationservice'; // <--- Добавлен импорт
import Tooltip from 'primevue/tooltip'; // <--- Импортировать Tooltip
// import Aura from 'primevue/themes/aura';      // Временно закомментировано
import 'primeicons/primeicons.css';         // Иконки
import './style.css'; // Основные стили (с Tailwind)

// --- Начало изменений ---
// 1. Импортируем тему PrimeVue (например, Lara Light Indigo)
import 'primevue/resources/themes/lara-light-indigo/theme.css';
// 2. Импортируем базовые стили PrimeVue
import 'primevue/resources/primevue.min.css';
// --- Конец изменений ---

const app = createApp(App);

app.use(createPinia()); // Подключаем Pinia
app.use(router); // Подключаем роутер
app.use(PrimeVue, { ripple: true, router: router }); // Используем PrimeVue. Добавлен router в конфигурацию
app.use(ToastService); // Подключаем ToastService
app.use(ConfirmationService); // <--- Добавлена регистрация сервиса
app.directive('tooltip', Tooltip); // <--- Зарегистрировать директиву Tooltip

app.mount('#app');
