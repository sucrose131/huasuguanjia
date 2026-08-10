<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import DocumentAttachments from '@/components/DocumentAttachments.vue';

type B = Record<string, any>;
const auth = useAuthStore();

const props = defineProps<{ modelValue: boolean; editRow?: B; viewRow?: B }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void; (e: 'done'): void }>();

const loading = ref(false);
const saving = ref(false);
const error = ref('');
const plans = ref<B[]>([]);
const warehouses = ref<B[]>([]);
const f = reactive({
  planId: '',
  warehouseId: '',
  quantity: 1,
  batchNo: '',
  productDate: new Date().toISOString().slice(0, 10),
  validityPeriod: '',
  inputDate: new Date().toISOString().slice(0, 10),
  goodsCode: '',
  goodsName: '',
  planQty: 0,
  deliveredQty: 0,
  operatorName: '',
});

const remaining = computed(() => Math.max(0, (f.planQty || 0) - (f.deliveredQty || 0)));
const sourceRow = computed(() => props.viewRow ?? props.editRow);
const readonly = computed(() => !!props.viewRow);
function close() {
  emit('update:modelValue', false);
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const [pRes, wRes] = (await Promise.all([
      api.get('/production/plans', { params: { pageSize: 100 } }),
      api.get('/base-data/warehouses/options'),
    ])) as any[];
    plans.value = (pRes.items ?? []).filter(
      (p: B) => Number(p.planStatus) === 3 && Number(p.deliveredQty) < Number(p.planQty),
    );
    warehouses.value = wRes ?? [];
    if (sourceRow.value) {
      const r = sourceRow.value;
      if (!plans.value.some((item: B) => String(item.id) === String(r.planId))) {
        plans.value.unshift({
          id: r.planId,
          planNo: r.planNo ?? '关联生产计划',
          goodsName: r.goodsName ?? '',
        });
      }
      Object.assign(f, {
        planId: r.planId,
        warehouseId: r.warehouseId,
        quantity: Number(r.quantity),
        batchNo: r.batchNo ?? '',
        productDate: (r.productDate ?? '').slice(0, 10) || f.productDate,
        validityPeriod: (r.validityPeriod ?? '').slice(0, 10) || '',
        inputDate: (r.inputDate ?? '').slice(0, 10) || f.inputDate,
        goodsCode: r.goodsCode ?? '',
        goodsName: r.goodsName ?? '',
        planQty: Number(r.planQty || 0),
        deliveredQty: Number(r.cumulativeQty || 0) - Number(r.quantity || 0),
        operatorName: r.operatorName ?? r.createdByName ?? auth.user?.username ?? '',
      });
    }
  } catch (e: any) {
    error.value = e.response?.data?.message ?? '加载失败';
  } finally {
    loading.value = false;
  }
}

async function planChanged() {
  if (!f.planId) return;
  try {
    const p: any = await api.get(`/production/plans/${f.planId}`);
    Object.assign(f, {
      goodsCode: p.goodsCode ?? '',
      goodsName: p.goodsName ?? '',
      planQty: Number(p.planQty || 0),
      deliveredQty: Number(p.deliveredQty || 0),
      warehouseId: f.warehouseId || p.productWarehouseId || '',
      quantity: Math.max(1, Number(p.planQty || 0) - Number(p.deliveredQty || 0)),
    });
  } catch (e: any) {
    /* ignore */
  }
}

async function submit() {
  if (!f.planId) {
    ElMessage.warning('请选择生产计划');
    return;
  }
  if (!f.warehouseId) {
    ElMessage.warning('请选择成品仓库');
    return;
  }
  const qty = Number(f.quantity);
  if (qty <= 0 || qty > remaining.value) {
    ElMessage.warning(`入库数量须在 1 ~ ${remaining.value} 之间`);
    return;
  }
  saving.value = true;
  error.value = '';
  try {
    const payload = {
      planId: f.planId,
      warehouseId: f.warehouseId,
      quantity: qty,
      batchNo: f.batchNo,
      productDate: f.productDate,
      validityPeriod: f.validityPeriod,
      inputDate: f.inputDate,
    };
    if (props.editRow) {
      await api.patch(`/production/inputs/${props.editRow.id}`, payload);
    } else {
      await api.post('/production/inputs', payload);
    }
    ElMessage.success(props.editRow ? '已更新' : '成品入库成功');
    close();
    emit('done');
  } catch (e: any) {
    error.value = e.response?.data?.message ?? '保存失败';
  } finally {
    saving.value = false;
  }
}

watch(
  () => props.modelValue,
  (v) => {
    if (v) {
      Object.assign(f, {
        planId: '',
        warehouseId: '',
        quantity: 1,
        batchNo: '',
        productDate: new Date().toISOString().slice(0, 10),
        validityPeriod: '',
        inputDate: new Date().toISOString().slice(0, 10),
        goodsCode: '',
        goodsName: '',
        planQty: 0,
        deliveredQty: 0,
        operatorName: '',
      });
      load();
    }
  },
);
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    @update:model-value="close"
    :title="viewRow ? '查看生产成品入库单' : editRow ? '编辑生产成品入库单' : '新增生产成品入库单'"
    width="900px"
    top="5vh"
    :close-on-click-modal="false"
  >
    <div v-if="loading" style="text-align: center; padding: 40px">加载中…</div>
    <template v-else>
      <div class="in-grid">
        <div class="in-fld">
          <span class="in-lb">关联生产计划 *</span
          ><el-select
            v-model="f.planId"
            :disabled="readonly || !!editRow"
            filterable
            size="small"
            @change="planChanged"
            ><el-option
              v-for="p in plans"
              :key="p.id"
              :label="`${p.planNo} · ${p.goodsName}`"
              :value="p.id"
          /></el-select>
        </div>
        <div class="in-fld">
          <span class="in-lb">入库日期 *</span
          ><el-date-picker
            v-model="f.inputDate"
            :disabled="readonly"
            type="date"
            value-format="YYYY-MM-DD"
            size="small"
            style="width: 100%"
          />
        </div>
        <div class="in-fld">
          <span class="in-lb">商品编码</span
          ><el-input :model-value="f.goodsCode || '—'" disabled size="small" />
        </div>
        <div class="in-fld">
          <span class="in-lb">商品名称</span
          ><el-input :model-value="f.goodsName || '—'" disabled size="small" />
        </div>
        <div class="in-fld">
          <span class="in-lb">计划数量</span
          ><el-input :model-value="f.planQty" disabled size="small" />
        </div>
        <div class="in-fld">
          <span class="in-lb">已入库</span
          ><el-input :model-value="f.deliveredQty" disabled size="small" />
        </div>
        <div class="in-fld">
          <span class="in-lb">本次入库数量 *</span
          ><el-input-number
            v-model="f.quantity"
            :disabled="readonly"
            :min="1"
            :max="remaining || 9999"
            :precision="0"
            :step="1"
            size="small"
            style="width: 100%"
          />
        </div>
        <div class="in-fld">
          <span class="in-lb">剩余可入库</span
          ><el-input :model-value="remaining" disabled size="small" />
        </div>
        <div class="in-fld">
          <span class="in-lb">成品仓库 *</span
          ><el-select v-model="f.warehouseId" :disabled="readonly" filterable size="small"
            ><el-option v-for="w in warehouses" :key="w.value" :label="w.label" :value="w.value"
          /></el-select>
        </div>
        <div class="in-fld">
          <span class="in-lb">入库来源 *</span
          ><el-input model-value="生产完工入库" disabled size="small" />
        </div>
        <div class="in-fld">
          <span class="in-lb">批号</span
          ><el-input v-model="f.batchNo" :disabled="readonly" size="small" />
        </div>
        <div class="in-fld">
          <span class="in-lb">生产日期</span
          ><el-date-picker
            v-model="f.productDate"
            :disabled="readonly"
            type="date"
            value-format="YYYY-MM-DD"
            size="small"
            style="width: 100%"
          />
        </div>
        <div class="in-fld">
          <span class="in-lb">有效日期</span
          ><el-date-picker
            v-model="f.validityPeriod"
            :disabled="readonly"
            type="date"
            value-format="YYYY-MM-DD"
            size="small"
            style="width: 100%"
          />
        </div>
        <div class="in-fld">
          <span class="in-lb">操作人</span
          ><el-input
            :model-value="f.operatorName || auth.user?.username || '—'"
            disabled
            size="small"
          />
        </div>
      </div>
      <div v-if="error" class="in-error">{{ error }}</div>
    </template>
    <DocumentAttachments
      v-if="sourceRow?.id"
      document-type="production_input"
      :document-id="sourceRow.id"
    />
    <template #footer>
      <el-button @click="close" :disabled="saving">{{ readonly ? '关闭' : '取消' }}</el-button>
      <el-button v-if="!readonly" type="primary" :loading="saving" @click="submit">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.in-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 16px;
}
.in-fld {
  display: flex;
  flex-direction: column;
}
.in-lb {
  font-size: 11px;
  color: #7b8798;
  margin-bottom: 2px;
}
.in-error {
  background: #fef0f0;
  color: #e53e3e;
  padding: 10px 14px;
  border-radius: 4px;
  margin-top: 10px;
  font-size: 13px;
}
</style>
