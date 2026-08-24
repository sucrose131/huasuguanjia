<script setup lang="ts">
import { Clock } from '@element-plus/icons-vue';
import type { DashboardTodoItem } from './dashboard.types';

defineProps<{ rows: DashboardTodoItem[]; money: (value: unknown) => string }>();
const emit = defineEmits<{ open: [item: DashboardTodoItem]; all: [] }>();
</script>

<template>
  <article class="dashboard-card todo-card">
    <header>
      <div>
        <h3>待办事项</h3>
        <small>仅显示当前账号有权处理的业务</small>
      </div>
      <button @click="emit('all')">全部待办 ›</button>
    </header>
    <button v-for="item in rows" :key="item.id" class="todo-row" @click="emit('open', item)">
      <el-icon><Clock /></el-icon
      ><span
        ><strong>{{ item.docType }} · {{ item.docNo }}</strong
        ><small>{{ item.businessModule }} · {{ item.counterparty || item.creator }}</small></span
      ><span
        ><b>{{ item.amount == null ? '—' : money(item.amount) }}</b
        ><small>{{ item.date }}</small></span
      ><b>›</b>
    </button>
    <div v-if="!rows.length" class="dashboard-empty">暂无待办，今天也很顺利。</div>
  </article>
</template>
