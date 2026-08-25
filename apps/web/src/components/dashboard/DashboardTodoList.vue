<script setup lang="ts">
import type { DashboardTodoItem } from './dashboard.types';

defineProps<{
  rows: DashboardTodoItem[];
  total: number;
  query: { page: number; pageSize: number; keyword: string; sourceType: string };
  money: (value: unknown) => string;
}>();
const emit = defineEmits<{ search: []; open: [item: DashboardTodoItem]; page: [] }>();
</script>

<template>
  <div class="panel">
    <div class="todo-filter">
      <el-input
        v-model="query.keyword"
        clearable
        placeholder="搜索单据编号、类型或往来信息"
        @keyup.enter="emit('search')"
      /><el-select v-model="query.sourceType" clearable placeholder="来源类型"
        ><el-option label="采购管理" value="采购管理" /><el-option
          label="生产管理"
          value="生产管理" /><el-option label="销售管理" value="销售管理" /><el-option
          label="领用管理"
          value="领用管理" /><el-option label="库存管理" value="库存管理" /></el-select
      ><el-button type="primary" @click="emit('search')">查询</el-button>
    </div>
    <div class="table-wrap">
      <el-table :data="rows"
        ><el-table-column type="index" label="序号" width="65" /><el-table-column
          prop="docNo"
          label="单据编号"
          min-width="150"
          ><template #default="{ row }"
            ><strong class="business-no">{{ row.docNo }}</strong></template
          ></el-table-column
        ><el-table-column prop="docType" label="单据类型" min-width="130" /><el-table-column
          prop="businessModule"
          label="来源模块"
          width="110"
        /><el-table-column prop="counterparty" label="往来单位/信息" min-width="150"
          ><template #default="{ row }">{{ row.counterparty || '—' }}</template></el-table-column
        ><el-table-column prop="date" label="日期" width="110" /><el-table-column
          label="金额"
          width="120"
          align="right"
          ><template #default="{ row }">{{
            row.amount == null ? '—' : money(row.amount)
          }}</template></el-table-column
        ><el-table-column prop="creator" label="创建人" width="100" /><el-table-column
          prop="status"
          label="状态"
          width="100"
          ><template #default="{ row }"
            ><el-tag type="warning">{{ row.status }}</el-tag></template
          ></el-table-column
        ><el-table-column label="操作" width="100" fixed="right"
          ><template #default="{ row }"
            ><el-button link type="primary" @click="emit('open', row)">去处理</el-button></template
          ></el-table-column
        ></el-table
      >
    </div>
    <div v-if="!rows.length" class="dashboard-empty">暂无待办，今天也很顺利。</div>
    <footer class="table-footer">
      <span>共 {{ total }} 条记录</span
      ><el-pagination
        v-model:current-page="query.page"
        v-model:page-size="query.pageSize"
        :total="total"
        layout="prev,pager,next"
        @change="emit('page')"
      />
    </footer>
  </div>
</template>
