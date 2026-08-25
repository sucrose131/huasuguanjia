<script setup lang="ts">
import { ref } from 'vue';
import { api } from '@/api';
import { dateText } from '@/utils/format';

const visible = ref(false);
const rows = ref<any[]>([]);
const context = ref({ title: '', subtitle: '' });

const quantity = (value: unknown) =>
  Number(value ?? 0).toLocaleString('zh-CN', { maximumFractionDigits: 4 });

async function showLedger(row: any) {
  const result: any = await api
    .get('/inventory/ledger', {
      params: {
        goodsId: row.goodsId,
        skuId: row.skuId,
        warehouseId: row.warehouseId,
        ...(row.batchNo !== undefined ? { batchNo: row.batchNo } : {}),
        pageSize: 100,
      },
    })
    .catch(() => ({ items: [] as any[] }));
  rows.value = result.items ?? [];
  context.value = {
    title: row.goodsName || '库存流水',
    subtitle: `${row.goodsCode || ''} · ${row.warehouseName || ''}`,
  };
  visible.value = true;
}

defineExpose({ showLedger });
</script>

<template>
  <el-dialog v-model="visible" :title="context.title" width="900px" top="5vh">
    <p class="muted" style="margin: 0 0 12px">{{ context.subtitle }}</p>
    <el-table :data="rows" border size="small" max-height="460">
      <el-table-column label="时间" width="155">
        <template #default="s">{{ dateText(s.row.createdAt, true) }}</template>
      </el-table-column>
      <el-table-column label="操作类型" min-width="110">
        <template #default="s">{{ s.row.operationTypeName || s.row.operationType || '—' }}</template>
      </el-table-column>
      <el-table-column label="入库" width="90" align="right">
        <template #default="s">{{ quantity(s.row.inputQty) }}</template>
      </el-table-column>
      <el-table-column label="出库" width="90" align="right">
        <template #default="s">{{ quantity(s.row.outputQty) }}</template>
      </el-table-column>
      <el-table-column label="结存" width="95" align="right">
        <template #default="s">{{ quantity(s.row.afterQty) }}</template>
      </el-table-column>
      <el-table-column prop="sourceNo" label="来源单号" min-width="140" />
      <el-table-column prop="operatorName" label="操作人" width="90" />
    </el-table>
  </el-dialog>
</template>
