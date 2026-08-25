<script setup lang="ts">
import { Box, Clock, DataAnalysis, ShoppingCart } from '@element-plus/icons-vue';
import type { DashboardWidgetAccess } from './dashboard.types';

defineProps<{
  salesAmount: number | null;
  purchaseAmount: number | null;
  inventoryValue: number | null;
  pendingCount: number;
  widgets: DashboardWidgetAccess;
  money: (value: unknown) => string;
}>();
</script>

<template>
  <div
    v-if="
      widgets.salesAmount ||
      widgets.purchaseAmount ||
      widgets.inventoryValue ||
      widgets.pendingCount
    "
    class="metric-grid"
  >
    <article v-if="widgets.salesAmount">
      <el-icon><DataAnalysis /></el-icon><span>本月销售额</span
      ><strong>{{ money(salesAmount) }}</strong
      ><small>按授权组织实时统计</small>
    </article>
    <article v-if="widgets.purchaseAmount">
      <el-icon><ShoppingCart /></el-icon><span>本月采购额</span
      ><strong>{{ money(purchaseAmount) }}</strong
      ><small>按授权组织实时统计</small>
    </article>
    <article v-if="widgets.inventoryValue">
      <el-icon><Box /></el-icon><span>库存总值</span><strong>{{ money(inventoryValue) }}</strong
      ><small>按授权组织即时结存</small>
    </article>
    <article v-if="widgets.pendingCount">
      <el-icon><Clock /></el-icon><span>待处理单据</span><strong>{{ pendingCount }} 笔</strong
      ><small>仅显示有权处理的业务</small>
    </article>
  </div>
</template>
