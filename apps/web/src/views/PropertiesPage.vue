<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api } from '@/api';
import StatusTag from '@/components/StatusTag.vue';
import DataState from '@/components/DataState.vue';
import { dateText, display } from '@/utils/format';
const rows = ref<any[]>([]),
  total = ref(0),
  loading = ref(false),
  error = ref(''),
  dialog = ref(false),
  detail = ref<any>({}),
  statuses = ref<any[]>([]);
const query = reactive<any>({ page: 1, pageSize: 20, keyword: '', status: '' });
async function load() {
  loading.value = true;
  error.value = '';
  try {
    const data = (await api.get('/goods/properties', {
      params: Object.fromEntries(Object.entries(query).filter(([, v]) => v !== '')),
    })) as any;
    rows.value = data.items;
    total.value = data.total;
  } catch (e: any) {
    error.value = e?.response?.data?.message ?? '属性定义加载失败';
  } finally {
    loading.value = false;
  }
}
function view(row: any) {
  detail.value = row;
  dialog.value = true;
}
function search() {
  query.page = 1;
  load();
}
function reset() {
  Object.assign(query, { page: 1, pageSize: 20, keyword: '', status: '' });
  load();
}
onMounted(async () => {
  statuses.value = (await api.get('/dictionaries/enabled_status')) as any[];
  load();
});
</script>
<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>属性定义</h2>
        <p class="page-subtitle">系统预设商品属性，仅支持查询和查看</p>
      </div>
    </header>
    <div class="panel">
      <div class="query-bar">
        <el-input
          v-model="query.keyword"
          class="query-field keyword"
          clearable
          placeholder="属性名称或描述"
          @keyup.enter="search"
        /><el-select v-model="query.status" class="query-field" clearable placeholder="状态"
          ><el-option
            v-for="item in statuses"
            :key="item.value"
            :label="item.label"
            :value="item.value"
        /></el-select>
        <div class="query-actions">
          <el-button type="primary" @click="search">查询</el-button
          ><el-button @click="reset">重置</el-button>
        </div>
      </div>
      <DataState
        v-if="error || (!rows.length && !loading)"
        :error="error"
        :empty="!rows.length"
        :loading="loading"
        title="属性定义数据"
        @retry="load"
      />
      <div v-else class="table-wrap">
        <el-table :data="rows" v-loading="loading"
          ><el-table-column type="index" label="序号" width="65" /><el-table-column
            prop="id"
            label="ID"
            width="100"
          /><el-table-column
            prop="name"
            label="属性名称"
            min-width="140"
          /><el-table-column
            prop="description"
            label="属性描述"
            min-width="190"
            show-overflow-tooltip
          /><el-table-column
            prop="logic"
            label="逻辑定义"
            min-width="220"
            show-overflow-tooltip
          /><el-table-column prop="categoryCount" label="关联分类数" width="105" /><el-table-column
            label="关联分类"
            min-width="190"
            show-overflow-tooltip
            ><template #default="s">{{
              s.row.categoryNames?.join('、') || '—'
            }}</template></el-table-column
          ><el-table-column prop="sort" label="排序" width="75" /><el-table-column
            label="状态"
            width="90"
            ><template #default="s"><StatusTag :value="s.row.status" /></template></el-table-column
          ><el-table-column label="操作时间" width="168"
            ><template #default="s">{{
              dateText(s.row.updatedAt || s.row.createdAt, true)
            }}</template></el-table-column
          ><el-table-column label="操作" width="90" fixed="right"
            ><template #default="s"
              ><el-button link type="primary" @click="view(s.row)">查看</el-button></template
            ></el-table-column
          ></el-table
        >
      </div>
      <footer v-if="rows.length" class="table-footer">
        <span class="result-total">共 {{ total }} 条属性定义</span
        ><el-pagination
          v-model:current-page="query.page"
          :total="total"
          layout="prev,pager,next"
          @change="load"
        />
      </footer>
    </div>
    <el-dialog v-model="dialog" title="查看属性定义" width="520"
      ><div class="detail-grid">
        <div class="detail-item">
          <span class="detail-label">属性名称</span>{{ display(detail.name) }}
        </div>
        <div class="detail-item">
          <span class="detail-label">状态</span><StatusTag :value="detail.status" />
        </div>
        <div class="detail-item full">
          <span class="detail-label">属性描述</span>{{ display(detail.description) }}
        </div>
        <div class="detail-item full">
          <span class="detail-label">逻辑定义</span>{{ display(detail.logic) }}
        </div>
        <div class="detail-item full">
          <span class="detail-label">关联分类</span>{{ detail.categoryNames?.join('、') || '—' }}
        </div>
        <div class="detail-item"><span class="detail-label">排序</span>{{ detail.sort ?? 0 }}</div>
        <div class="detail-item">
          <span class="detail-label">操作时间</span
          >{{ dateText(detail.updatedAt || detail.createdAt, true) }}
        </div>
      </div>
      <template #footer><el-button @click="dialog = false">关闭</el-button></template></el-dialog
    >
  </section>
</template>
