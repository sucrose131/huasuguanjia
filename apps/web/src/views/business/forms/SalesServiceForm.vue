<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '@/api';
import { recordAmountMasked, useAuthStore } from '@/stores/auth';
import { dateText, moneyText } from '@/utils/format';
import RemoteSelect from '@/components/RemoteSelect.vue';
import OverflowTooltipCell from '@/components/business/OverflowTooltipCell.vue';

const props = defineProps<{
  modelValue: Record<string, any>;
  mode: 'create' | 'edit' | 'view';
}>();
const emit = defineEmits<{ (e: 'saved'): void; (e: 'cancel'): void }>();

const auth = useAuthStore();
const form = computed(() => props.modelValue);
/** 记录级金额掩码：无查看权或（范围 own 且单据非本人创建）→ 金额显示 ¥ **** */
const amountHidden = computed(() => recordAmountMasked(form.value));
const saving = ref(false);
const options = reactive<Record<string, any>>({
  orgs: [],
  units: [],
  orders: [],
  serviceOutputs: [],
});
const dicts = reactive<Record<string, any[]>>({});

const isView = computed(() => props.mode === 'view');
const serviceNeedsBatch = computed(() => [4, 5].includes(Number(form.value.eventType)));

const serviceProgresses = ref<Record<string, any>[]>([]);
const progressSaving = ref(false);
const progressForm = reactive<Record<string, any>>({
  id: '',
  content: '',
  status: 1,
  occurredAt: new Date(),
});

function blankLine() {
  return {
    goodsId: '',
    skuId: '',
    unitType: 0,
    batchNo: '',
    quantity: 0,
    sourceOutputId: '',
    sourceOutputNo: '',
    sourceQuantity: 0,
    remainingQty: null,
    remark: '',
  };
}

function unitName(line: any) {
  const unit = (options.units as any[]).find(
    (u: any) => String(u.value ?? u.id) === String(line.unitType),
  );
  return unit?.label ?? unit?.name ?? '—';
}

function eventTypeName() {
  const item = (dicts.after_sale_event_type ?? []).find(
    (d: any) => String(d.value) === String(form.value.eventType),
  );
  return item?.label ?? '—';
}

async function loadDicts() {
  const codes = ['after_sale_event_type', 'after_sale_event_status'];
  const values = await Promise.all(
    codes.map((code) => api.get(`/dictionaries/${code}`).catch(() => [])),
  );
  codes.forEach((code, index) => (dicts[code] = values[index] as any[]));
}

async function searchSalesOrderOptions(keyword: string) {
  const kw = String(keyword ?? '').trim();
  if (!kw) {
    return ((options.orders as any[]) ?? []).map((x: any) => ({
      value: x.id,
      label: `${x.orderNo ?? ''} · ${x.customerName ?? ''}`.trim(),
    }));
  }
  const r: any = await api.get('/sales/money-order-options', {
    params: { keyword: kw, pageSize: 50 },
  });
  const items = (Array.isArray(r) ? r : r.items ?? []) as any[];
  return items.map((x: any) => ({
    value: x.id,
    label: `${x.orderNo ?? ''} · ${x.customerName ?? ''}`.trim(),
  }));
}

async function searchServiceGoodsOptions(keyword: string) {
  const ids = (form.value.orderGoodsIds ?? []) as (string | number)[];
  const inOrder = (g: any) =>
    !ids.length || ids.some((id: string | number) => String(id) === String(g.id));
  const toOptions = (list: any[]) =>
    list.map((g: any) => ({ value: g.id, label: g.goodsName ?? g.queryCode ?? '' }));
  // 售后商品始终走远程搜索，不再依赖 onMounted 全量商品列表
  const r: any = await api.get('/goods', { params: { keyword, pageSize: 50, status: 1 } });
  const items = ((r.items ?? []) as any[]).filter(inOrder);
  return toOptions(items);
}

async function loadServiceOutputOptions() {
  options.serviceOutputs = [];
  if (!serviceNeedsBatch.value || !form.value.orderId || !form.value.goodsId || !form.value.skuId)
    return;
  options.serviceOutputs = (await api.get('/sales/services/source-options', {
    params: {
      orderId: form.value.orderId,
      goodsId: form.value.goodsId,
      skuId: form.value.skuId,
      excludeServiceId: form.value.id || undefined,
    },
  })) as any[];
}

async function orderChanged() {
  if (!form.value.orderId) {
    form.value.sourceOutputId = '';
    form.value.details = [];
    return;
  }
  const o: any = await api.get(`/sales/orders/${form.value.orderId}`);
  Object.assign(form.value, {
    orderNo: o.orderNo,
    customerName: o.customerName,
    orderDate: o.orderDate,
    orderAmount: Number(o.fact_amount ?? 0),
    orderSummary: o,
    orderGoodsIds: o.details?.map((x: any) => x.goodsId) || [],
  });
  form.value.goodsId = o.details?.[0]?.goodsId ?? '';
  form.value.skuId = o.details?.[0]?.skuId ?? '';
  form.value.sourceOutputId = '';
  form.value.details = [];
  await loadServiceOutputOptions();
}

async function serviceGoodsChanged() {
  form.value.sourceOutputId = '';
  form.value.details = [];
  const orderLine = (form.value.orderSummary?.details ?? []).find(
    (line: any) => String(line.goodsId) === String(form.value.goodsId),
  );
  form.value.skuId = orderLine?.skuId ?? '';
  await loadServiceOutputOptions();
}

async function serviceEventTypeChanged() {
  form.value.sourceOutputId = '';
  form.value.details = [];
  if (serviceNeedsBatch.value) await loadServiceOutputOptions();
}

function serviceSourceOutputChanged() {
  const source = (options.serviceOutputs as any[]).find(
    (item: any) => String(item.id) === String(form.value.sourceOutputId),
  );
  if (!source) {
    form.value.details = [];
    return;
  }
  form.value.details = (source.details ?? []).map((line: any) => ({
    ...blankLine(),
    ...line,
    sourceOutputId: source.id,
    sourceOutputNo: source.outputNo,
    remainingQty: Number(line.remainingQuantity),
    sourceQuantity: Number(line.sourceQuantity),
    quantity: 0,
  }));
}

function validate() {
  if (!form.value.orderId) {
    ElMessage.warning('请选择销售订单');
    return false;
  }
  if (!form.value.goodsId) {
    ElMessage.warning('请选择售后商品');
    return false;
  }
  if (!String(form.value.eventContent ?? '').trim()) {
    ElMessage.warning('请填写事件内容');
    return false;
  }
  if (serviceNeedsBatch.value) {
    const selected = (form.value.details ?? []).filter((line: any) => Number(line.quantity) > 0);
    if (!form.value.sourceOutputId || !selected.length) {
      ElMessage.warning('退货或换货售后必须选择来源销售出库单，并填写至少一个批次的本次处理数量');
      return false;
    }
    form.value.details = selected;
  }
  return true;
}

async function save() {
  if (!validate()) return;
  saving.value = true;
  try {
    const payload: Record<string, any> = { ...form.value };
    const url = '/sales/services';
    const result: any =
      props.mode === 'edit'
        ? await api.patch(`${url}/${form.value.id}`, payload)
        : await api.post(url, payload);
    ElMessage.success(result?.message ?? '保存成功');
    emit('saved');
  } catch {
    // axios 拦截器已提示
  } finally {
    saving.value = false;
  }
}

function resetProgressForm() {
  Object.assign(progressForm, {
    id: '',
    content: '',
    status: Number(form.value.eventStatus) || 1,
    occurredAt: new Date(),
  });
}

function editServiceProgress(row: Record<string, any>) {
  Object.assign(progressForm, {
    id: row.id,
    content: row.content,
    status: Number(row.status),
    occurredAt: new Date(row.occurredAt),
  });
}

async function reloadServiceProgresses() {
  serviceProgresses.value = (await api.get(
    `/sales/services/${form.value.id}/progress`,
  )) as Record<string, any>[];
}

async function saveServiceProgress() {
  if (!String(progressForm.content ?? '').trim()) {
    ElMessage.warning('请填写本次处理进展');
    return;
  }
  progressSaving.value = true;
  try {
    const payload = {
      content: String(progressForm.content).trim(),
      status: Number(progressForm.status),
      occurredAt: progressForm.occurredAt,
    };
    const result: any = progressForm.id
      ? await api.patch(`/sales/services/${form.value.id}/progress/${progressForm.id}`, payload)
      : await api.post(`/sales/services/${form.value.id}/progress`, payload);
    form.value.eventStatus = payload.status;
    ElMessage.success(result?.message ?? (progressForm.id ? '进展已更新' : '进展已添加'));
    await reloadServiceProgresses();
    resetProgressForm();
  } finally {
    progressSaving.value = false;
  }
}

async function deleteServiceProgress(row: Record<string, any>) {
  await ElMessageBox.confirm('确认删除这条售后进展？删除后仍保留审计记录。', '删除进展', {
    type: 'warning',
  });
  const result: any = await api.delete(`/sales/services/${form.value.id}/progress/${row.id}`);
  ElMessage.success(result?.message ?? '进展已删除');
  await reloadServiceProgresses();
  if (String(progressForm.id) === String(row.id)) resetProgressForm();
}

function serviceProgressStatusType(item: Record<string, any>): 'success' | 'warning' | 'danger' | 'info' {
  const label = String(item.statusName ?? item.status ?? '');
  if (label.includes('完成')) return 'success';
  if (label.includes('取消') || label.includes('关闭')) return 'info';
  if (label.includes('失败') || label.includes('驳回')) return 'danger';
  return 'warning';
}

onMounted(async () => {
  const [orgs, units, orders] = await Promise.all([
    api.get('/base-data/organizations/options').catch(() => []),
    api.get('/base-data/units/options').catch(() => []),
    api.get('/sales/money-order-options', { params: { pageSize: 100 } }).catch(() => []),
  ]);
  options.orgs = orgs;
  options.units = units;
  options.orders = orders;
  await loadDicts();

  if (props.mode === 'create') {
    Object.assign(form.value, {
      eventType: 1,
      eventStatus: 1,
      eventContent: '',
      eventDate: dateText(new Date()),
      handlerId: auth.user?.id ?? '',
      remark: '',
      sourceOutputId: '',
      details: [],
    });
    if (form.value.orderId) await orderChanged();
  } else if (form.value.id) {
    const detail: any = await api
      .get(`/sales/services/${form.value.id}`)
      .catch(() => null);
    if (detail) Object.assign(form.value, detail);
    form.value.orderSummary = detail?.order ?? form.value.orderSummary ?? null;
    serviceProgresses.value = detail?.progresses ?? [];
    resetProgressForm();
    await loadServiceOutputOptions();
    if (
      form.value.sourceOutputId &&
      !(options.serviceOutputs as any[]).some(
        (x: any) => String(x.id) === String(form.value.sourceOutputId),
      )
    ) {
      (options.serviceOutputs as any[]).unshift({
        id: form.value.sourceOutputId,
        outputNo: form.value.details?.[0]?.sourceOutputNo ?? String(form.value.sourceOutputId),
        details: [],
      });
    }
  }
});
</script>

<template>
  <el-form label-position="top" :disabled="isView">
    <div class="form-grid">
      <template v-if="form.sourceSystem">
        <el-form-item label="售后来源">
          <el-input :model-value="form.sourceSystemName || form.sourceSystem" readonly />
        </el-form-item>
        <el-form-item label="外部申请号">
          <el-input :model-value="form.externalRequestNo || form.externalRequestId" readonly />
        </el-form-item>
        <el-form-item label="接收时间">
          <el-input :model-value="dateText(form.receivedAt, true)" readonly />
        </el-form-item>
        <el-form-item label="外部原始申请（只读）" class="span-2">
          <el-input
            :model-value="JSON.stringify(form.externalPayload || {}, null, 2)"
            type="textarea"
            :rows="8"
            readonly
          />
        </el-form-item>
      </template>

      <el-form-item v-if="mode === 'create' && !form.orderId" label="销售订单" required>
        <RemoteSelect
          v-model="form.orderId"
          :fetch="searchSalesOrderOptions"
          :current-label="form.orderNo"
          placeholder="输入销售订单号或客户搜索"
          @change="orderChanged"
        />
      </el-form-item>
      <el-form-item v-else-if="form.orderId" label="订单号">
        <el-input :model-value="form.orderNo || form.orderSummary?.orderNo || form.orderId" readonly />
      </el-form-item>

      <el-form-item v-if="form.orderId" label="客户">
        <el-input :model-value="form.customerName" readonly />
      </el-form-item>
      <el-form-item v-if="form.orderId" label="订单日期">
        <el-input :model-value="form.orderDate" readonly />
      </el-form-item>
      <el-form-item v-if="form.orderId" label="订单金额">
        <el-input :model-value="moneyText(amountHidden ? null : form.orderAmount ?? 0)" readonly />
      </el-form-item>

      <el-form-item label="售后商品" required>
        <RemoteSelect
          v-model="form.goodsId"
          :fetch="searchServiceGoodsOptions"
          :current-label="form.goodsName"
          :disabled="isView"
          placeholder="输入商品名称或编码搜索"
          @change="serviceGoodsChanged"
        />
      </el-form-item>

      <el-form-item v-if="serviceNeedsBatch" label="来源已确认销售出库单" required>
        <el-select
          v-model="form.sourceOutputId"
          filterable
          :disabled="isView"
          @change="serviceSourceOutputChanged"
        >
          <el-option
            v-for="x in options.serviceOutputs"
            :key="x.id"
            :label="x.outputNo"
            :value="x.id"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="事件类型" required>
        <el-select v-model="form.eventType" :disabled="isView" @change="serviceEventTypeChanged">
          <el-option
            v-for="item in dicts.after_sale_event_type || []"
            :key="item.value"
            :label="item.label"
            :value="Number(item.value)"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="事件内容" class="span-2" required>
        <el-input v-model="form.eventContent" type="textarea" :rows="3" :disabled="isView" />
      </el-form-item>

      <el-form-item label="事件状态">
        <el-select v-model="form.eventStatus" disabled>
          <el-option
            v-for="item in dicts.after_sale_event_status || []"
            :key="item.value"
            :label="item.label"
            :value="Number(item.value)"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="处理人">
        <el-input v-model="form.handlerId" :disabled="isView" />
      </el-form-item>
      <el-form-item label="事件日期">
        <el-date-picker
          v-model="form.eventDate"
          type="date"
          value-format="YYYY-MM-DD"
          :disabled="isView"
        />
      </el-form-item>
      <el-form-item label="备注" class="span-2">
        <el-input v-model="form.remark" type="textarea" :rows="2" :disabled="isView" />
      </el-form-item>
    </div>

    <div v-if="serviceNeedsBatch" class="details-header">
      <span class="details-title">退换货明细</span>
    </div>
    <el-table v-if="serviceNeedsBatch" :data="form.details ?? []" border size="small">
      <el-table-column label="商品" min-width="180">
        <template #default="s">{{ s.row.goodsName || s.row.goodsId || '—' }}</template>
      </el-table-column>
      <el-table-column label="商品编码" width="125">
        <template #default="s">{{ s.row.goodsCode || '—' }}</template>
      </el-table-column>
      <el-table-column label="SKU/规格" min-width="120">
        <template #default="s">{{ s.row.skuSpec || s.row.goodsSpec || s.row.skuId || '—' }}</template>
      </el-table-column>
      <el-table-column label="单位" width="80">
        <template #default="s">{{ unitName(s.row) }}</template>
      </el-table-column>
      <el-table-column prop="sourceOutputNo" label="来源出库单" width="160" />
      <el-table-column prop="sourceQuantity" label="来源出库数量" width="120" />
      <el-table-column prop="remainingQty" label="剩余可退换" width="115" />
      <el-table-column label="批号" min-width="140">
        <template #default="s">{{ s.row.batchNo || '无批号' }}</template>
      </el-table-column>
      <el-table-column label="本次处理数量" width="150">
        <template #default="s">
          <el-input-number
            v-model="s.row.quantity"
            :min="0"
            :max="s.row.remainingQty == null ? undefined : Number(s.row.remainingQty)"
            :precision="0"
            :step="1"
            :disabled="isView"
          />
        </template>
      </el-table-column>
      <el-table-column label="处理方式" width="100">
        <template #default="s">{{ eventTypeName() }}</template>
      </el-table-column>
    </el-table>

    <section v-if="mode !== 'create' && form.id" class="service-progress-panel">
      <div class="service-progress-title">
        <div><strong>售后处理进展</strong><span>多次记录，原始售后申请不会被覆盖</span></div>
        <el-button v-if="!isView && progressForm.id" link type="primary" @click="resetProgressForm">
          取消编辑
        </el-button>
      </div>
      <div v-if="!isView" class="service-progress-editor">
        <el-input
          v-model="progressForm.content"
          type="textarea"
          :rows="3"
          maxlength="10000"
          show-word-limit
          placeholder="记录本次沟通、处理动作和下一步安排"
        />
        <div class="service-progress-editor-row">
          <el-select v-model="progressForm.status" placeholder="处理后状态">
            <el-option
              v-for="item in dicts.after_sale_event_status || []"
              :key="item.value"
              :label="item.label"
              :value="Number(item.value)"
            />
          </el-select>
          <el-date-picker
            v-model="progressForm.occurredAt"
            type="datetime"
            placeholder="实际处理时间"
            style="width: 100%"
          />
          <el-button type="primary" :loading="progressSaving" @click="saveServiceProgress">
            {{ progressForm.id ? '保存进展修改' : '添加进展' }}
          </el-button>
        </div>
      </div>
      <el-table
        class="service-progress-table"
        :data="serviceProgresses"
        row-key="id"
        border
        stripe
        table-layout="fixed"
        max-height="320"
        empty-text="暂无处理进展"
      >
        <el-table-column label="处理时间" width="168">
          <template #default="{ row }">{{ dateText(row.occurredAt, true) }}</template>
        </el-table-column>
        <el-table-column prop="content" label="处理内容" min-width="300">
          <template #default="{ row }">
            <OverflowTooltipCell :content="row.content">{{ row.content }}</OverflowTooltipCell>
          </template>
        </el-table-column>
        <el-table-column label="处理状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag size="small" effect="plain" :type="serviceProgressStatusType(row)">
              {{ row.statusName || row.status || '—' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="记录来源" width="100" align="center">
          <template #default="{ row }">
            <el-tag size="small" effect="plain" type="info">
              {{ row.sourceTypeName || '人工记录' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="处理人" width="120">
          <template #default="{ row }">
            <OverflowTooltipCell :content="row.handlerIdName || row.createdByName || '未知操作人'">{{
              row.handlerIdName || row.createdByName || '未知操作人'
            }}</OverflowTooltipCell>
          </template>
        </el-table-column>
        <el-table-column v-if="!isView" fixed="right" label="操作" width="110" align="center">
          <template #default="{ row }">
            <template v-if="Number(row.sourceType) === 1">
              <el-button link type="primary" @click="editServiceProgress(row)">编辑</el-button>
              <el-button link type="danger" @click="deleteServiceProgress(row)">删除</el-button>
            </template>
            <span v-else>—</span>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <div v-if="!isView" class="form-actions">
      <el-button @click="emit('cancel')">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </div>
  </el-form>
</template>

<style scoped>
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0 16px;
}
.span-2 {
  grid-column: 1 / -1;
}
.details-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0;
}
.details-title {
  font-weight: 600;
}
.service-progress-panel {
  margin-top: 16px;
  border-top: 1px solid #ebeef5;
  padding-top: 12px;
}
.service-progress-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.service-progress-title span {
  margin-left: 8px;
  color: #909399;
  font-size: 12px;
}
.service-progress-editor {
  margin-bottom: 10px;
}
.service-progress-editor-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.service-progress-table {
  width: 100%;
}
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>
