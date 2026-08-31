<script setup lang="ts">
import { computed } from 'vue';
import type { DashboardShortcut } from './dashboard.types';

const props = defineProps<{ shortcuts: DashboardShortcut[]; compact?: boolean }>();
const emit = defineEmits<{ navigate: [path: string, create?: boolean] }>();
const compactShortcuts = computed(() => props.shortcuts.filter((item) => item.create).slice(0, 4));
</script>

<template>
  <article v-if="compact" class="dashboard-card quick-card">
    <header>
      <div>
        <h3>快捷功能</h3>
        <small>仅显示当前账号可用入口</small>
      </div>
    </header>
    <div>
      <button
        v-for="item in compactShortcuts"
        :key="item.key"
        @click="emit('navigate', item.path, item.create)"
      >
        <el-icon><component :is="item.icon" /></el-icon>{{ item.title }}
      </button>
    </div>
  </article>
  <div v-else class="shortcut-grid">
    <button
      v-for="item in shortcuts"
      :key="item.key"
      @click="emit('navigate', item.path, item.create)"
    >
      <el-icon><component :is="item.icon" /></el-icon
      ><span
        ><strong>{{ item.title }}</strong
        ><small>{{ item.description }}</small></span
      ><b>›</b>
    </button>
    <div v-if="!shortcuts.length" class="dashboard-empty">当前账号暂无可用快捷功能</div>
  </div>
</template>
