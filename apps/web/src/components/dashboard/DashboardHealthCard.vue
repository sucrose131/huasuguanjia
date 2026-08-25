<script setup lang="ts">
import { Warning } from '@element-plus/icons-vue';
import type { DashboardOverviewData } from './dashboard.types';

defineProps<{ data: DashboardOverviewData }>();
const emit = defineEmits<{ navigate: [path: string, create?: boolean] }>();
</script>

<template>
  <article class="dashboard-card health-card">
    <header>
      <div>
        <h3>库存健康度</h3>
        <small>按授权组织即时结存测算</small>
      </div>
      <button @click="emit('navigate', '/inventory/stocks')">查看明细 ›</button>
    </header>
    <div class="health-content">
      <div
        class="health-ring"
        :style="{
          background: `conic-gradient(#078c68 0 ${data.healthScore}%,#e9edf2 ${data.healthScore}% 100%)`,
        }"
      >
        <span
          ><strong>{{ data.healthScore }}</strong
          ><small>健康分</small></span
        >
      </div>
      <div class="health-counts">
        <p>
          <i class="good" />库存充足
          <strong>{{ Math.max(data.inventoryCount - data.lowStockCount, 0) }}</strong>
        </p>
        <p>
          <i class="low" />低库存 <strong>{{ data.lowStockCount }}</strong>
        </p>
      </div>
    </div>
    <div v-if="data.lowStockItem" class="stock-warning">
      <el-icon><Warning /></el-icon
      ><span
        ><strong>{{ data.lowStockItem.name }}</strong
        ><small
          >当前库存 {{ data.lowStockItem.stock }} · 安全库存
          {{ data.lowStockItem.safetyStock }}</small
        ></span
      ><button @click="emit('navigate', '/purchase/applications', true)">去补货</button>
    </div>
    <div v-else class="stock-clear">暂无库存预警</div>
  </article>
</template>
