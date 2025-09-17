import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

// Конфигурация Vite для локальной разработки
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5000', // Локальный backend вместо Docker
        changeOrigin: true,
        secure: false,
        ws: true, // Поддержка WebSocket
      },
      '/socket.io': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        ws: true,
      }
    },
    // Настройки для лучшей производительности в локальной разработке
    hmr: {
      overlay: true,
    },
    open: false, // Не открывать браузер автоматически
  },
  // Оптимизация для локальной разработки
  optimizeDeps: {
    include: ['vue', 'vue-router', 'pinia', 'axios'],
  },
  build: {
    sourcemap: true, // Включить source maps для отладки
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['vue', 'vue-router', 'pinia'],
          charts: ['chart.js', 'vue-chartjs', 'apexcharts'],
          ui: ['primevue', '@primevue/themes'],
        }
      }
    }
  }
})