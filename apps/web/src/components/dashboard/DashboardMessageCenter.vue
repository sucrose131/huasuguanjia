<script setup lang="ts">
import { Bell, CircleCheck, Warning } from '@element-plus/icons-vue';
import { computed, ref } from 'vue';
import type { DashboardMessageItem } from './dashboard.types';

const props = defineProps<{
  rows: DashboardMessageItem[];
  messageText: (item: DashboardMessageItem) => string;
  dateText: (value: unknown) => string;
}>();
const emit = defineEmits<{ read: [item: DashboardMessageItem] }>();
const category = ref('全部消息');
const categories = ['全部消息', '审批消息', '预警消息', '业务消息'];
const filtered = computed(() =>
  category.value === '全部消息'
    ? props.rows
    : props.rows.filter((item) => item.category === category.value),
);
const count = (value: string) =>
  value === '全部消息'
    ? props.rows.length
    : props.rows.filter((item) => item.category === value).length;
</script>

<template>
  <div class="panel message-center">
    <aside class="message-categories">
      <button
        v-for="item in categories"
        :key="item"
        :class="{ active: category === item }"
        @click="category = item"
      >
        <el-icon><Bell /></el-icon><span>{{ item }}</span
        ><b>{{ count(item) }}</b>
      </button>
    </aside>
    <div class="message-list">
      <button
        v-for="item in filtered"
        :key="item.id"
        class="message-row"
        :class="{ unread: !item.isRead }"
        @click="emit('read', item)"
      >
        <span class="message-icon"
          ><el-icon
            ><Warning v-if="item.category === '预警消息'" /><CircleCheck
              v-else-if="item.category === '审批消息'" /><Bell v-else /></el-icon></span
        ><span class="message-copy"
          ><strong>{{ item.title }}<i v-if="!item.isRead" /></strong
          ><small>{{ messageText(item) }}</small
          ><time>{{ dateText(item.createdAt) }}</time></span
        ><b>›</b>
      </button>
      <div v-if="!filtered.length" class="dashboard-empty">
        {{ category === '全部消息' ? '暂无消息' : `暂无${category}` }}
      </div>
    </div>
  </div>
</template>
