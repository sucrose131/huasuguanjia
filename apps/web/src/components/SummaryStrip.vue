<script setup lang="ts">
import { CircleCheck, Clock, DataAnalysis } from '@element-plus/icons-vue';
defineProps<{ items: { label: string; value: number | string }[] }>();
const icons = [DataAnalysis, Clock, CircleCheck];
</script>
<template>
  <div class="summary-strip">
    <div v-for="(item, index) in items" :key="item.label" class="summary-item">
      <el-icon class="summary-icon"><component :is="icons[index % icons.length]" /></el-icon
      ><span class="summary-label">{{ item.label }}</span
      ><strong class="summary-value">{{ item.value }}</strong>
    </div>
  </div>
</template>
