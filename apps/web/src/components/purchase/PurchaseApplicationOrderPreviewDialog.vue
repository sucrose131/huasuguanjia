<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import type { TableInstance } from 'element-plus';
import { useRouter } from 'vue-router';
import { api } from '@/api';
import StatusTag from '@/components/StatusTag.vue';
import OverflowTooltipCell from '@/components/business/OverflowTooltipCell.vue';
import { dateText, moneyText } from '@/utils/format';

type PreviewMode = 'all' | 'partial' | 'related';
type Option = { label: string; value: string | number };

const props = defineProps<{
  modelValue: boolean;
  applicationId: string;
  mode: PreviewMode;
  canViewAmount: boolean;
  canEditAmount: boolean;
}>();
const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  generated: [];
}>();
const router = useRouter();

const loading = ref(false);
const submitting = ref(false);
const application = ref<any>({ details: [], generatedOrders: [] });
const tableRef = ref<TableInstance>();
const selectedRows = ref<any[]>([]);
const form = reactive({
  vendorId: '' as string | number,
  receiverId: '' as string | number,
});
const options = reactive<Record<string, Option[]>>({
  organizations: [],
  departments: [],
  warehouses: [],
  vendors: [],
  units: [],
  receivers: [],
});
const orderStatuses = ref<Option[]>([]);

const title = computed(() =>
  props.mode === 'all'
    ? '整单生成采购订单'
    : props.mode === 'partial'
      ? '选择商品生成采购订单'
      : '关联采购订单',
);
const isGeneration = computed(() => props.mode !== 'related');
const remainingRows = computed(() =>
  (application.value.details ?? []).filter((item: any) => item.generationStatus !== 'generated'),
);
const displayRows = computed(() =>
  props.mode === 'all' ? remainingRows.value : (application.value.details ?? []),
);
const effectiveRows = computed(() =>
  props.mode === 'all' ? remainingRows.value : selectedRows.value,
);
const selectedQuantity = computed(() =>
  effectiveRows.value.reduce((sum: number, item: any) => sum + Number(item.quantity ?? 0), 0),
);
const selectedAmount = computed(() =>
  effectiveRows.value.reduce((sum: number, item: any) => sum + Number(item.totalAmount ?? 0), 0),
);
const generatedCount = computed(
  () =>
    (application.value.details ?? []).filter((item: any) => item.generationStatus === 'generated')
      .length,
);

const lookup = (name: string, value: unknown) =>
  options[name]?.find((item) => String(item.value) === String(value))?.label ?? '—';
const orderStatus = (value: unknown) =>
  orderStatuses.value.find((item) => String(item.value) === String(value))?.label ?? '—';
const protectedMoneyText = (value: unknown) =>
  props.canViewAmount ? `¥ ${moneyText(value)}` : '****';
const canSelect = (row: any) => row.generationStatus !== 'generated';
const rowUnitPrice = (row: any) => {
  const quantity = Number(row.quantity ?? 0);
  return quantity > 0 ? Number(row.totalAmount ?? 0) / quantity : 0;
};

async function load() {
  if (!props.applicationId) return;
  loading.value = true;
  selectedRows.value = [];
  form.vendorId = '';
  form.receiverId = '';
  try {
    const [data, organizations, departments, warehouses, vendors, units, statuses] =
      (await Promise.all([
        api.get(`/purchase/applications/${props.applicationId}`),
        api.get('/base-data/organizations/options'),
        api.get('/base-data/departments/options'),
        api.get('/base-data/warehouses/options'),
        api.get('/base-data/vendors/options'),
        api.get('/base-data/units/options'),
        api.get('/dictionaries/purchase_order_status'),
      ])) as any[];
    options.organizations = organizations ?? [];
    options.departments = departments ?? [];
    options.warehouses = warehouses ?? [];
    options.vendors = vendors ?? [];
    options.units = units ?? [];
    orderStatuses.value = statuses ?? [];

    const products = new Map<string, any>();
    const goodsIds = [
      ...new Set<string>((data.details ?? []).map((item: any) => String(item.goodsId))),
    ];
    await Promise.all(
      goodsIds.map(async (goodsId) => products.set(goodsId, await api.get(`/goods/${goodsId}`))),
    );
    data.details = (data.details ?? []).map((line: any) => {
      const product = products.get(String(line.goodsId));
      const sku = (product?.skus ?? []).find((item: any) => String(item.id) === String(line.skuId));
      const referencePrice = props.canViewAmount
        ? Number(line.referencePrice ?? sku?.costPrice ?? product?.costPrice ?? 0)
        : null;
      return {
        ...line,
        goodsCode: product?.queryCode ?? '',
        goodsName: product?.goodsName ?? '—',
        skuName: sku?.specModels || sku?.skuName || sku?.skuNo || `规格 ${line.skuId}`,
        unitType: line.unitType || sku?.unitType || product?.unitType,
        referencePrice,
        totalAmount:
          referencePrice == null
            ? null
            : Number((referencePrice * Number(line.quantity ?? 0)).toFixed(2)),
      };
    });
    application.value = data;
    form.receiverId = data.receiverId ?? '';
    options.receivers = data.receiverId
      ? [{ value: data.receiverId, label: data.receiverName || String(data.receiverId) }]
      : [];
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message ?? '采购申请生成界面加载失败');
  } finally {
    loading.value = false;
  }
}

function selectionChanged(rows: any[]) {
  selectedRows.value = rows;
}

function close() {
  emit('update:modelValue', false);
}

async function submitOrder() {
  if (!props.canEditAmount) {
    ElMessage.warning('当前账号没有金额编辑权限，不能生成采购订单');
    return;
  }
  if (!form.vendorId) {
    ElMessage.warning('请选择本次采购订单的供应商');
    return;
  }
  if (!form.receiverId) {
    ElMessage.warning('采购申请未指定有效收货人，请先检查申请单');
    return;
  }
  if (!effectiveRows.value.length) {
    ElMessage.warning('请至少选择一条采购明细');
    return;
  }
  const missingAmount = effectiveRows.value.find((item: any) => Number(item.totalAmount ?? 0) <= 0);
  if (missingAmount) {
    ElMessage.warning(`请填写“${missingAmount.goodsName}”的采购总金额`);
    return;
  }
  submitting.value = true;
  try {
    const result = (await api.post(`/purchase/applications/${props.applicationId}/generate-order`, {
      generationMode: props.mode,
      vendorId: form.vendorId,
      details: effectiveRows.value.map((item: any) => ({
        applicationDetailId: String(item.applicationDetailId),
        totalAmount: Number(item.totalAmount),
      })),
    })) as any;
    ElMessage.success(result.message ?? '采购订单已生成');
    emit('update:modelValue', false);
    emit('generated');
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message ?? error.message ?? '采购订单生成失败');
  } finally {
    submitting.value = false;
  }
}

function previewOrder(row: any) {
  emit('update:modelValue', false);
  router.push({ path: '/purchase/orders', query: { viewId: String(row.id) } });
}

watch(
  () => [props.modelValue, props.applicationId, props.mode],
  async ([visible]) => {
    if (visible) await load();
  },
);
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    class="purchase-generation-dialog"
    :title="title"
    :width="mode === 'related' ? '920' : '1180'"
    top="4vh"
    :close-on-click-modal="false"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div v-loading="loading" class="generation-dialog-content">
      <template v-if="mode === 'related'">
        <div class="section-title section-title--master">
          <div>
            <strong>采购申请</strong>
            <span class="muted">{{ application.applicationNo || '—' }}</span>
          </div>
        </div>
        <el-table
          :data="application.generatedOrders ?? []"
          row-key="id"
          stripe
          border
          max-height="440"
          class="generation-table"
        >
          <el-table-column prop="orderNo" label="采购订单号" min-width="166" />
          <el-table-column label="供应商" min-width="180">
            <template #default="scope">
              <OverflowTooltipCell :content="lookup('vendors', scope.row.vendorId)">{{
                lookup('vendors', scope.row.vendorId)
              }}</OverflowTooltipCell>
            </template>
          </el-table-column>
          <el-table-column prop="itemCount" label="商品种类" width="96" align="right" />
          <el-table-column prop="quantity" label="采购数量" width="104" align="right" />
          <el-table-column label="订单金额" width="128" align="right">
            <template #default="scope">{{ protectedMoneyText(scope.row.totalAmount) }}</template>
          </el-table-column>
          <el-table-column label="订单状态" width="104">
            <template #default="scope">
              <StatusTag
                :value="scope.row.orderStatus"
                :label="orderStatus(scope.row.orderStatus)"
              />
            </template>
          </el-table-column>
          <el-table-column label="生成时间" width="112">
            <template #default="scope">{{ dateText(scope.row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="80" fixed="right" align="center">
            <template #default="scope">
              <el-button link type="primary" @click="previewOrder(scope.row)">查看</el-button>
            </template>
          </el-table-column>
          <template #empty>
            <div class="empty-text">暂无通过新明细映射生成的采购订单</div>
          </template>
        </el-table>
      </template>

      <template v-else>
        <div class="section-title section-title--master">
          <div>
            <strong>采购申请</strong>
            <span class="muted">审核通过后按供应商生成采购订单</span>
          </div>
        </div>
        <div class="generation-master-grid">
          <div class="info-item">
            <span>申请单号</span><strong>{{ application.applicationNo || '—' }}</strong>
          </div>
          <div class="info-item">
            <span>所属组织</span><strong>{{ lookup('organizations', application.orgId) }}</strong>
          </div>
          <div class="info-item">
            <span>申请部门</span><strong>{{ lookup('departments', application.deptId) }}</strong>
          </div>
          <div class="info-item">
            <span>目标仓库</span
            ><strong>{{ lookup('warehouses', application.warehouseId) }}</strong>
          </div>
        </div>

        <div class="section-title">
          <div>
            <strong>本次采购</strong>
            <span class="muted"
              >共 {{ application.details?.length ?? 0 }} 项，已生成 {{ generatedCount }} 项，待生成
              {{ remainingRows.length }} 项</span
            >
          </div>
        </div>
        <el-form label-position="top" class="generation-form-grid">
          <el-form-item label="本次采购供应商" required>
            <el-select
              v-model="form.vendorId"
              clearable
              filterable
              placeholder="请选择本张采购订单的供应商"
            >
              <el-option
                v-for="item in options.vendors"
                :key="item.value"
                :label="item.label"
                :value="item.value"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="收货人">
            <el-input :model-value="lookup('receivers', form.receiverId)" disabled />
          </el-form-item>
        </el-form>

        <el-table
          ref="tableRef"
          :data="displayRows"
          row-key="applicationDetailId"
          border
          max-height="430"
          class="generation-table"
          @selection-change="selectionChanged"
        >
          <el-table-column
            v-if="mode === 'partial'"
            type="selection"
            width="48"
            fixed="left"
            :selectable="canSelect"
          />
          <el-table-column prop="goodsCode" label="商品编码" width="126" fixed="left" />
          <el-table-column prop="goodsName" label="商品名称" min-width="168">
            <template #default="scope">
              <OverflowTooltipCell :content="scope.row.goodsName">{{
                scope.row.goodsName
              }}</OverflowTooltipCell>
            </template>
          </el-table-column>
          <el-table-column prop="skuName" label="SKU/规格" min-width="136">
            <template #default="scope">
              <OverflowTooltipCell :content="scope.row.skuName">{{
                scope.row.skuName
              }}</OverflowTooltipCell>
            </template>
          </el-table-column>
          <el-table-column label="单位" width="72">
            <template #default="scope">{{ lookup('units', scope.row.unitType) }}</template>
          </el-table-column>
          <el-table-column prop="quantity" label="申请数量" width="96" align="right" />
          <el-table-column label="生成状态" width="104">
            <template #default="scope">
              <el-tag
                :type="scope.row.generationStatus === 'generated' ? 'success' : 'info'"
                size="small"
              >
                {{ scope.row.generationStatus === 'generated' ? '已生成' : '未生成' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="对应订单" min-width="150">
            <template #default="scope">
              <OverflowTooltipCell :content="scope.row.generatedOrderNo || '—'">{{
                scope.row.generatedOrderNo || '—'
              }}</OverflowTooltipCell>
            </template>
          </el-table-column>
          <el-table-column label="参考价格" width="112" align="right">
            <template #default="scope">{{ protectedMoneyText(scope.row.referencePrice) }}</template>
          </el-table-column>
          <el-table-column label="采购总金额" width="154" align="right">
            <template #default="scope">
              <el-input-number
                v-if="canEditAmount"
                v-model="scope.row.totalAmount"
                :min="0"
                :precision="2"
                controls-position="right"
                :disabled="scope.row.generationStatus === 'generated'"
              />
              <span v-else>{{ protectedMoneyText(scope.row.totalAmount) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="采购单价" width="120" align="right">
            <template #default="scope">{{ protectedMoneyText(rowUnitPrice(scope.row)) }}</template>
          </el-table-column>
        </el-table>
        <div class="generation-summary">
          <span>已选 {{ effectiveRows.length }} 项</span>
          <span>采购数量 {{ selectedQuantity }}</span>
          <strong>订单金额 {{ protectedMoneyText(selectedAmount) }}</strong>
        </div>
      </template>
    </div>

    <template #footer>
      <el-button @click="close">关闭</el-button>
      <el-button
        v-if="isGeneration"
        type="primary"
        :loading="submitting"
        :disabled="!canEditAmount"
        @click="submitOrder"
      >
        提交生成采购订单
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.generation-dialog-content {
  min-height: 220px;
  font-size: var(--hs-font-body);
  line-height: var(--hs-line-body);
}
.section-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 40px;
  margin: 16px 0 8px;
  padding: 0 12px;
  border: 1px solid #e4e8ef;
  border-radius: 4px;
  background: #f7f9fc;
  color: #344054;
  font-size: var(--hs-font-section);
}
.section-title--master {
  margin-top: 0;
}
.section-title > div {
  display: flex;
  align-items: center;
  gap: 8px;
}
.section-title strong {
  font-weight: 600;
}
.muted {
  color: #8791a5;
  font-size: var(--hs-font-helper);
  font-weight: 400;
}
.generation-master-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px 16px;
}
.info-item {
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid #e4e8ef;
  border-radius: 4px;
  background: #fff;
}
.info-item span {
  display: block;
  margin-bottom: 4px;
  color: #667085;
  font-size: var(--hs-font-label);
}
.info-item strong {
  display: block;
  overflow: hidden;
  color: #344054;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.generation-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 360px));
  gap: 16px;
  margin-bottom: 12px;
}
.generation-form-grid :deep(.el-select) {
  width: 100%;
}
.generation-table {
  width: 100%;
  font-size: var(--hs-font-body);
}
.generation-table :deep(th.el-table__cell) {
  height: var(--hs-detail-header-height);
  padding: 0;
  color: #667085;
  background: #f7f9fc;
  font-size: var(--hs-font-label);
  font-weight: 600;
}
.generation-table :deep(td.el-table__cell) {
  height: var(--hs-detail-row-height);
  padding: 4px 0;
  color: #344054;
}
.generation-table :deep(.el-input-number) {
  width: 100%;
}
.generation-table :deep(.el-input-number .el-input__wrapper) {
  min-height: var(--hs-detail-control-height);
}
.generation-summary {
  display: flex;
  justify-content: flex-end;
  gap: 24px;
  padding: 12px 4px 0;
  color: #667085;
  font-variant-numeric: tabular-nums;
}
.generation-summary strong {
  color: #172033;
}
.empty-text {
  padding: 24px 0;
  color: #8791a5;
}
:global(.purchase-generation-dialog) {
  max-width: calc(100vw - 32px);
}
:global(.purchase-generation-dialog .el-dialog__header) {
  padding: 16px 20px 12px;
  border-bottom: 1px solid #e4e8ef;
}
:global(.purchase-generation-dialog .el-dialog__title) {
  color: #172033;
  font-size: var(--hs-font-dialog-title);
  line-height: var(--hs-line-dialog-title);
  font-weight: 600;
}
:global(.purchase-generation-dialog .el-dialog__body) {
  max-height: calc(92vh - 132px);
  padding: 16px 20px;
  overflow: auto;
}
:global(.purchase-generation-dialog .el-dialog__footer) {
  padding: 12px 20px 16px;
  border-top: 1px solid #e4e8ef;
}
@media (max-width: 900px) {
  .generation-master-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 600px) {
  .generation-master-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .generation-form-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
