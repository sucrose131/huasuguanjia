<script setup lang="ts">
import { Bell } from '@element-plus/icons-vue';
import type { DashboardMessageItem } from './dashboard.types';

defineProps<{
  rows: DashboardMessageItem[];
  unreadCount: number;
  dateText: (value: unknown) => string;
}>();
const emit = defineEmits<{ open: [] }>();
</script>

<template>
  <article class="dashboard-card message-summary" @click="emit('open')">
    <header>
      <div>
        <h3>消息中心</h3>
        <small>{{ unreadCount }} 条未读</small>
      </div>
      <el-icon><Bell /></el-icon>
    </header>
    <p v-for="item in rows" :key="item.id">
      <i :class="{ read: item.isRead }" /><span>{{ item.title }}</span
      ><time>{{ dateText(item.createdAt).slice(5) }}</time>
    </p>
    <div v-if="!rows.length" class="dashboard-empty">暂无消息</div>
  </article>
</template>
