import { createApp } from 'vue'
import App from './App.vue'
import router from './router' // Импортируем роутер
import { createPinia } from 'pinia' // Импортируем Pinia
import PrimeVue from 'primevue/config';
import ToastService from 'primevue/toastservice';
import ConfirmationService from 'primevue/confirmationservice'; // <--- Добавлен импорт
import Tooltip from 'primevue/tooltip'; // <--- Импортировать Tooltip
import Aura from '@primevue/themes/aura'; // Импортируем тему Aura

// CSS импорты
import 'primevue/resources/themes/lara-light-blue/theme.css'; // PrimeVue тема
import 'primevue/resources/primevue.min.css';               // PrimeVue основные стили
import 'primeicons/primeicons.css';                         // Иконки
import './style.css'; // Основные стили (с Tailwind)

// Импортируем Chart.js конфигурацию для регистрации компонентов
import '@/utils/chartConfig';

const app = createApp(App);

app.use(createPinia()); // Подключаем Pinia
app.use(router); // Подключаем роутер
app.use(PrimeVue, { 
  theme: {
    preset: Aura,
    options: {
      prefix: 'p',
      darkModeSelector: 'system',
      cssLayer: false
    }
  },
  ripple: true 
}); // Используем PrimeVue с темой Aura
app.use(ToastService); // Подключаем ToastService
app.use(ConfirmationService); // <--- Добавлена регистрация сервиса
app.directive('tooltip', Tooltip); // <--- Зарегистрировать директиву Tooltip

app.mount('#app');
