import { createRouter, createWebHistory } from 'vue-router';
import type { RouteRecordRaw } from 'vue-router';
import HomeView from '@/views/HomeView.vue';
import DefaultLayout from '@/layouts/DefaultLayout.vue';

const routes: Array<RouteRecordRaw> = [
  {
    path: '/',
    component: DefaultLayout,
    children: [
      {
        path: '',
        name: 'Home',
        component: HomeView,
      },
      {
        path: '/backtester',
        name: 'Backtester',
        // Ленивая загрузка компонента
        component: () => import(/* webpackChunkName: "backtester" */ '@/views/BacktesterView.vue'),
      },
      {
        path: '/scanner',
        name: 'Scanner',
        component: () => import(/* webpackChunkName: "scanner" */ '@/views/ScannerView.vue'),
      },
       {
        path: '/settings',
        name: 'Settings',
        component: () => import(/* webpackChunkName: "settings" */ '@/views/SettingsView.vue'),
      },
      {
        path: '/data',
        name: 'DataManagement',
        component: () => import(/* webpackChunkName: "data" */ '@/views/DataManagementView.vue'),
      },
      {
        path: '/queue-manager',
        name: 'QueueManager',
        component: () => import('@/views/QueueManagerView.vue')
      },
      {
        path: '/sessions',
        name: 'Sessions',
        component: () => import(/* webpackChunkName: "sessions" */ '@/views/SessionsView.vue'),
      },
      {
        path: '/optimizer',
        name: 'Optimizer',
        component: () => import(/* webpackChunkName: "optimizer" */ '@/views/OptimizerView.vue'),
      }
    ],
  },
  // Можно добавить роуты для других layout или страниц без layout
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});

export default router; 