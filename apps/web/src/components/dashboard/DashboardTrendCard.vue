<script setup lang="ts">
import { computed } from 'vue';
import type { DashboardTrendItem, DashboardModuleAccess } from './dashboard.types';

const props = defineProps<{
  trend: DashboardTrendItem[];
  modules: DashboardModuleAccess;
  money: (value: unknown) => string;
}>();
const maxTrend = computed(() =>
  Math.max(
    1,
    ...props.trend.flatMap((item) => [Number(item.sales) || 0, Number(item.purchase) || 0]),
  ),
);
</script>

<template>
  <article class="dashboard-card trend-card">
    <header>
      <div>
        <h3>采购 / 销售趋势</h3>
        <small>近 14 日 · 按授权组织汇总</small>
      </div>
      <span class="legend"
        ><i v-if="modules.sales" />{{ modules.sales ? '销售' : '' }} <i v-if="modules.purchase" />{{
          modules.purchase ? '采购' : ''
        }}</span
      >
    </header>
    <div class="trend-chart">
      <div v-for="item in trend" :key="item.date" class="trend-day">
        <div class="bars">
          <i
            v-if="modules.sales"
            :style="{ height: `${Math.max(4, ((Number(item.sales) || 0) / maxTrend) * 150)}px` }"
            :title="`销售 ${money(item.sales)}`"
          /><i
            v-if="modules.purchase"
            :style="{ height: `${Math.max(4, ((Number(item.purchase) || 0) / maxTrend) * 150)}px` }"
            :title="`采购 ${money(item.purchase)}`"
          />
        </div>
        <small>{{ item.date.slice(5).replace('-', '/') }}</small>
      </div>
    </div>
  </article>
</template>
