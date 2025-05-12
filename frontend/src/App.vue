<script setup lang="ts">
// Основной компонент приложения, рендерит текущий роут
</script>

<template>
  <router-view />
</template>

<style>
/* Глобальные стили должны быть импортированы в main.ts, 
   включая базовые стили Tailwind, тему PrimeVue и PrimeIcons. */
#app {
  /* Можно оставить/убрать базовые настройки шрифта, 
     в зависимости от того, как настроены Tailwind/PrimeVue. */
}
</style>
