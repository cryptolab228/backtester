<template>
  <transition
    name="status-card-fade"
    appear
    @before-enter="beforeEnter"
    @enter="enter"
  >
    <div
      class="relative overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 h-full bg-white dark:bg-gray-800 shadow-lg"
      :style="{ transitionDelay: initialDelay + 's' }"
    >
      <!-- Animated Gradient Background -->
      <div ref="gradientContainer" class="absolute inset-0 overflow-hidden">
        <div :class="['absolute inset-0', blurClass]">
          <svg
            v-for="(color, index) in gradientCircles"
            :key="index"
            class="absolute animate-background-gradient"
            :style="color.style"
            :width="gradientCircleSize"
            :height="gradientCircleSize"
            viewBox="0 0 100 100"
            preserveAspectRatio="xMidYMid slice"
          >
            <circle
              cx="50"
              cy="50"
              r="50"
              :fill="color.fill"
              class="opacity-30 dark:opacity-20"
            />
          </svg>
        </div>
      </div>

      <!-- Content -->
      <div class="relative z-10 p-4 text-gray-700 dark:text-gray-300 backdrop-blur-sm h-full flex flex-col">
        <div class="flex justify-between items-center mb-2">
          <h3 class="text-sm font-medium text-gray-600 dark:text-gray-400">
            {{ title }}
          </h3>
          <i :class="[icon, 'text-xl']"></i>
        </div>
        <p class="text-3xl font-bold mb-1 text-gray-800 dark:text-gray-100">
          {{ value }}
        </p>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, type PropType } from 'vue';

const props = defineProps({
  title: {
    type: String,
    required: true,
  },
  value: {
    type: Number,
    required: true,
  },
  icon: {
    type: String, // PrimeIcon class, e.g., 'pi pi-check-circle'
    required: true,
  },
  colors: {
    type: Array as PropType<string[]>, // Array of CSS color strings
    required: true,
  },
  delay: { // For staggered animation entrance
    type: Number,
    default: 0,
  },
  gradientSpeed: {
    type: Number,
    default: 15, // Slower speed, higher number is slower
  },
  gradientBlur: {
    type: String as PropType<'light' | 'medium' | 'heavy'>,
    default: 'medium',
  },
});

const initialDelay = ref(props.delay); // Store prop in ref for transition

const gradientContainer = ref<HTMLDivElement | null>(null);
const gradientCircleSize = ref(300); // Default size, can be made dynamic

interface GradientCircle {
  fill: string;
  style: Record<string, any>;
}
const gradientCircles = ref<GradientCircle[]>([]);

const blurClass = computed(() => {
  switch (props.gradientBlur) {
    case 'light':
      return 'blur-2xl';
    case 'medium':
      return 'blur-3xl';
    case 'heavy':
      return 'blur-[80px]'; // Adjusted from 100px for potentially smaller cards
    default:
      return 'blur-3xl';
  }
});

const randomInt = (min: number, max: number) => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

const setupGradientCircles = () => {
  // Determine circle size based on container, or use a fixed large size
  // For simplicity here, we'll keep gradientCircleSize fixed or make it a large percentage
  // if (gradientContainer.value) {
  //   gradientCircleSize.value = Math.max(gradientContainer.value.offsetWidth, gradientContainer.value.offsetHeight) * 1.5;
  // }

  gradientCircles.value = props.colors.map((color: string) => ({
    fill: color,
    style: {
      top: `${randomInt(-25, 75)}%`, // Allow circles to start partially outside
      left: `${randomInt(-25, 75)}%`,
      '--background-gradient-speed': `${props.gradientSpeed}s`,
      '--tx-1': Math.random() * 2 - 1, // Random -1 to 1
      '--ty-1': Math.random() * 2 - 1,
      '--tx-2': Math.random() * 2 - 1,
      '--ty-2': Math.random() * 2 - 1,
      '--tx-3': Math.random() * 2 - 1,
      '--ty-3': Math.random() * 2 - 1,
      '--tx-4': Math.random() * 2 - 1,
      '--ty-4': Math.random() * 2 - 1,
      animationDelay: `${Math.random() * -props.gradientSpeed}s`, // Randomize start of animation
    } as Record<string, any>,
  }));
};

onMounted(() => {
  setupGradientCircles();
});

// Transition hooks for staggered fade-in
const beforeEnter = (el: Element) => {
  (el as HTMLElement).style.opacity = '0';
  (el as HTMLElement).style.transform = 'translateY(20px)';
};

const enter = (el: Element, done: () => void) => {
  const delaySeconds = parseFloat((el as HTMLElement).style.transitionDelay || '0');
  (el as HTMLElement).style.transition = `opacity 0.5s ease-in-out ${delaySeconds}s, transform 0.5s ease-in-out ${delaySeconds}s`;
  requestAnimationFrame(() => {
    (el as HTMLElement).style.opacity = '1';
    (el as HTMLElement).style.transform = 'translateY(0)';
  });
  // Listen for transitionend event to call done()
  // This is important if you have multiple transitions
  let transitionsEnded = 0;
  const onTransitionEnd = () => {
    transitionsEnded++;
    if (transitionsEnded >= 2) { // Expecting 2 transitions: opacity and transform
      el.removeEventListener('transitionend', onTransitionEnd);
      done();
    }
  };
  el.addEventListener('transitionend', onTransitionEnd);
};

</script>

<style scoped>
/* Gradient Animation */
@keyframes backgroundGradient {
  0% {
    transform: translate(calc(var(--tx-1) * 30%), calc(var(--ty-1) * 30%));
  }
  25% {
    transform: translate(calc(var(--tx-2) * 30%), calc(var(--ty-2) * 30%));
  }
  50% {
    transform: translate(calc(var(--tx-3) * 30%), calc(var(--ty-3) * 30%));
  }
  75% {
    transform: translate(calc(var(--tx-4) * 30%), calc(var(--ty-4) * 30%));
  }
  100% {
    transform: translate(calc(var(--tx-1) * 30%), calc(var(--ty-1) * 30%));
  }
}

.animate-background-gradient {
  animation: backgroundGradient var(--background-gradient-speed) linear infinite;
}

/* Card Fade-in Transition (if not using JS hooks exclusively) */
.status-card-fade-enter-active,
.status-card-fade-leave-active {
  /* transition: opacity 0.5s ease-in-out, transform 0.5s ease-in-out; */
  /* Managed by JS hooks for delay handling */
}

.status-card-fade-enter-from,
.status-card-fade-leave-to {
  /* opacity: 0; */
  /* transform: translateY(20px); */
   /* Managed by JS hooks for delay handling */
}
</style> 