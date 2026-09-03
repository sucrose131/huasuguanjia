<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '@/api';
import { recordAmountMasked, useAuthStore } from '@/stores/auth';
import { dateText, moneyText } from '@/utils/format';
import { buildOrganizationTree, type OrganizationTreeNode } from '@/utils/organization-tree';
import BusinessStatusTag from '@/components/business/BusinessStatusTag.vue';
import InventoryProductBatchLayout from '@/components/inventory/InventoryProductBatchLayout.vue';

const props = defineProps<{
  modelValue: Record<string, any>;
  mode: 'create' | 'edit' | 'view';
}>();
const emit = defineEmits<{ (e: 'saved'): void; (e: 'cancel'): void }>();

const auth = useAuthStore();
const form = computed(() => props.modelValue);
/** 记录级金额掩码：无查看权或（范围 own 且单据非本人创建）→ 单价/差异金额显示 ¥ ****；新建/无归属不掩码 */
const amountHidden = computed(() => recordAmountMasked(form.value));
const saving = ref(false);
const options = reactive<Record<string, any>>({ orgs: [], warehouses: [] });
const dicts = reactive<Record<string, any[]>>({
  checkTypes: [],
  checkResult: [],
  damageStatus: [],
});

const isView = computed(() => props.mode === 'view');
/** 新增成功后仍停留在同一弹框，取得 id 即进入实盘录入阶段。 */
const isCreate = computed(() => props.mode === 'create' && !form.value.id);
const organizationTree = computed(() =>
  buildOrganizationTree(options.orgs as OrganizationTreeNode[]),
);

const dictLabel = (code: string, value: unknown) =>
  (dicts[code] ?? []).find((item) => String(item.value) === String(value))?.label ?? '—';
const quantity = (value: unknown) =>
  Number(value ?? 0).toLocaleString('zh-CN', { maximumFractionDigits: 4 });

// ---------- 盘点结果汇总 ----------
const checkDetailSummary = computed(() => {
  const details = Array.isArray(form.value.details) ? form.value.details : [];
  const goodsKeys = new Set(
    details.map((line: any) => `${line.goodsId ?? ''}:${line.skuId ?? ''}`),
  );
  return {
    goods: goodsKeys.size,
    batches: details.length,
    inventoryQty: details.reduce(
      (sum: number, line: any) => sum + Number(line.inventoryQty ?? 0),
      0,
    ),
    checkQty: details.reduce((sum: number, line: any) => sum + Number(line.checkQty ?? 0), 0),
    shortageQty: details.reduce(
      (sum: number, line: any) => sum + Math.abs(Math.min(Number(line.differentQty ?? 0), 0)),
      0,
    ),
    overflowQty: details.reduce(
      (sum: number, line: any) => sum + Math.max(Number(line.differentQty ?? 0), 0),
      0,
    ),
    damagedQty: details.reduce(
      (sum: number, line: any) => sum + Number(line.damagedQty ?? 0),
      0,
    ),
  };
});

// ---------- 分商品分组 ----------
const checkProductGroups = computed<any[]>(() => {
  const groups = new Map<string, any>();
  for (const line of Array.isArray(form.value.details) ? form.value.details : []) {
    const key = `${line.goodsId ?? ''}:${line.skuId ?? ''}`;
    if (!groups.has(key))
      groups.set(key, {
        key,
        goodsId: line.goodsId,
        skuId: line.skuId,
        goodsCode: line.goodsCode,
        goodsName: line.goodsName,
        skuSpec: line.skuSpec,
        unitName: line.unitName,
        batches: [],
      });
    groups.get(key)!.batches.push(line);
  }
  return [...groups.values()]
    .map((group: any): any => ({
      ...group,
      batches: [...group.batches].sort((left: any, right: any) =>
        String(left.batchNo ?? '').localeCompare(String(right.batchNo ?? ''), 'zh-CN', {
          numeric: true,
        }),
      ),
    }))
    .sort((left: any, right: any) =>
      `${left.goodsCode ?? ''}${left.goodsName ?? ''}${left.skuSpec ?? ''}`.localeCompare(
        `${right.goodsCode ?? ''}${right.goodsName ?? ''}${right.skuSpec ?? ''}`,
        'zh-CN',
        { numeric: true },
      ),
    );
});
const checkQuantityStatus = (line: any) =>
  Number(line.differentQty) < 0
    ? { text: dictLabel('checkResult', 1), semantic: 'danger' as const }
    : Number(line.differentQty) > 0
      ? { text: dictLabel('checkResult', 2), semantic: 'success' as const }
      : { text: dictLabel('checkResult', 3), semantic: 'neutral' as const };
const checkDamageStatus = (line: any) =>
  Number(line.damagedQty) > 0
    ? { text: dictLabel('damageStatus', 1), semantic: 'warning' as const }
    : { text: dictLabel('damageStatus', 0), semantic: 'neutral' as const };
const checkBatchRowKey = (line: any) =>
  `${line.id ?? 'new'}:${line.goodsId ?? ''}:${line.skuId ?? ''}:${line.batchNo ?? ''}`;
const checkBatchRowClassName = ({ row }: { row: any }) => {
  const classes: string[] = [];
  if (Number(row.damagedQty) > 0) classes.push('check-row-damaged');
  else if (Number(row.differentQty) < 0) classes.push('check-row-shortage');
  else if (Number(row.differentQty) > 0) classes.push('check-row-overflow');
  return classes.join(' ');
};
function getCheckSummaries({ columns, data }: { columns: any[]; data: any[] }) {
  const totals: Record<string, number> = {
    inventoryQty: data.reduce((sum, line) => sum + Number(line.inventoryQty ?? 0), 0),
    checkQty: data.reduce((sum, line) => sum + Number(line.checkQty ?? 0), 0),
    differentQty: data.reduce((sum, line) => sum + Number(line.differentQty ?? 0), 0),
    damagedQty: data.reduce((sum, line) => sum + Number(line.damagedQty ?? 0), 0),
    differentAmount: data.reduce((sum, line) => sum + Number(line.differentAmount ?? 0), 0),
  };
  return columns.map((column, index) => {
    if (index === 0) return '合计';
    if (!(column.property in totals)) return '';
    return column.property === 'differentAmount'
      ? `¥ ${moneyText(amountHidden.value ? null : totals[column.property])}`
      : quantity(totals[column.property]);
  });
}

async function loadOrgWarehouses(orgId: unknown) {
  if (!orgId) {
    options.warehouses = [];
    return;
  }
  options.warehouses = (await api
    .get('/base-data/warehouses/options', { params: { orgId: String(orgId) } })
    .catch(() => [])) as any[];
}

function recalcCheckLine(line: any) {
  line.differentQty = Number(line.checkQty ?? 0) - Number(line.inventoryQty ?? 0);
  line.differentAmount = Number(line.differentQty ?? 0) * Number(line.unitPrice ?? 0);
}

function validate() {
  if (isCreate.value) {
    if (!form.value.orgId || !form.value.warehouseId || !form.value.checkType) {
      ElMessage.warning('请选择盘点类型、组织和仓库');
      return false;
    }
    return true;
  }
  for (const line of form.value.details ?? []) {
    if (Number(line.checkQty) < 0 || Number(line.damagedQty) < 0) {
      ElMessage.warning(`${line.goodsName || '商品'} 实盘或损坏数量不能小于 0`);
      return false;
    }
    if (Number(line.damagedQty) > Number(line.checkQty)) {
      ElMessage.warning(`${line.goodsName || '商品'} 损坏数量不能超过实盘总数`);
      return false;
    }
  }
  return true;
}

async function doSave(submit: boolean) {
  if (!validate()) return;
  saving.value = true;
  try {
    const url = '/inventory/checks';
    if (isCreate.value) {
      const result: any = await api.post(url, {
        orgId: form.value.orgId,
        warehouseId: form.value.warehouseId,
        checkType: form.value.checkType,
        checkDate: form.value.checkDate,
        remark: form.value.remark,
      });
      const detail: any = await api.get(`${url}/${result.id}`);
      Object.assign(form.value, detail);
      (form.value.details ?? []).forEach(recalcCheckLine);
      ElMessage.success('库存已载入，请继续录入实盘数量');
      return;
    } else {
      (form.value.details ?? []).forEach(recalcCheckLine);
      const result: any = await api.patch(`${url}/${form.value.id}`, {
        details: (form.value.details ?? []).map((line: any) => ({
          id: line.id,
          checkQty: line.checkQty,
          damagedQty: line.damagedQty,
          remark: line.remark ?? '',
        })),
        submit,
      });
      ElMessage.success(submit ? '盘点已完成并提交审批' : '盘点数据已保存');
    }
    emit('saved');
  } catch {
    // axios 拦截器已提示
  } finally {
    saving.value = false;
  }
}
async function save() {
  // 新增时载入库存；编辑时保存草稿
  await doSave(false);
}
async function finishCheck() {
  await doSave(true);
}

onMounted(async () => {
  const [orgs, checkTypes, checkResult, damageStatus] = await Promise.all([
    api.get('/base-data/organizations/options').catch(() => []),
    api.get('/dictionaries/inventory_check_type').catch(() => []),
    api.get('/dictionaries/inventory_check_result').catch(() => []),
    api.get('/dictionaries/inventory_damage_status').catch(() => []),
  ]);
  options.orgs = orgs;
  dicts.checkTypes = checkTypes as any[];
  dicts.checkResult = checkResult as any[];
  dicts.damageStatus = damageStatus as any[];

  if (props.mode === 'create') {
    Object.assign(form.value, {
      orgId: auth.user?.orgId ?? '',
      warehouseId: '',
      checkType: dicts.checkTypes?.[0]?.value ?? '',
      checkDate: dateText(new Date()),
      operatorName: auth.user?.username ?? '',
      remark: '',
      details: [],
    });
  } else if (form.value.id) {
    const detail: any = await api.get(`/inventory/checks/${form.value.id}`).catch(() => null);
    if (detail) Object.assign(form.value, detail);
    (form.value.details ?? []).forEach(recalcCheckLine);
  }
  await loadOrgWarehouses(form.value.orgId);
});
</script>

<template>
  <el-form label-position="top" :disabled="isView">
    <div class="check-dialog-section">
      <div class="check-dialog-section__heading">
        <div>
          <strong>基本信息</strong>
          <span>新增、继续盘点和查看统一使用本布局；库存明细按商品规格和批次载入</span>
        </div>
        <BusinessStatusTag
          v-if="!isCreate"
          :semantic="isView ? 'neutral' : 'processing'"
          :text="isView ? '只读查看' : '盘点录入中'"
        />
      </div>
      <div class="check-master-grid">
        <el-form-item v-if="!isCreate" label="盘点单号">
          <el-input :model-value="form.checkNo || '保存后自动生成'" disabled />
        </el-form-item>
        <el-form-item label="盘点类型" required>
          <el-select v-model="form.checkType" :disabled="!isCreate">
            <el-option
              v-for="item in dicts.checkTypes"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="组织" required>
          <el-tree-select
            v-model="form.orgId"
            :data="organizationTree"
            filterable
            check-strictly
            node-key="value"
            :props="{ label: 'label', children: 'children' }"
            :disabled="!isCreate"
            @change="
              form.warehouseId = '';
              loadOrgWarehouses(form.orgId);
            "
          />
        </el-form-item>
        <el-form-item label="仓库" required>
          <el-select v-model="form.warehouseId" filterable :disabled="!isCreate">
            <el-option
              v-for="w in options.warehouses"
              :key="w.value"
              :label="w.label"
              :value="w.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="盘点日期" required>
          <el-date-picker
            v-model="form.checkDate"
            type="date"
            value-format="YYYY-MM-DD"
            :disabled="!isCreate"
          />
        </el-form-item>
        <el-form-item label="盘点人">
          <el-input :model-value="form.operatorName || auth.user?.username || '—'" disabled />
        </el-form-item>
        <el-form-item label="备注" class="span-2">
          <el-input
            v-model="form.remark"
            type="textarea"
            :rows="2"
            :disabled="!isCreate"
            placeholder="填写本次盘点范围或特殊说明"
          />
        </el-form-item>
      </div>
    </div>

    <div v-if="isCreate" class="load-hint">
      选择组织、仓库、盘点类型和日期后点击「载入盘点明细」，系统将在当前弹框载入该仓库全部在库商品批次，可直接继续录入实盘数量。
    </div>

    <template v-if="!isCreate">
      <div class="check-result-summary">
        <div>
          <span>商品规格</span><strong>{{ checkDetailSummary.goods }}</strong
          ><small>去重后的商品 / SKU</small>
        </div>
        <div>
          <span>库存批次</span><strong>{{ checkDetailSummary.batches }}</strong
          ><small>本次逐批盘点行数</small>
        </div>
        <div>
          <span>账面总量</span><strong>{{ quantity(checkDetailSummary.inventoryQty) }}</strong
          ><small>载入时库存快照</small>
        </div>
        <div>
          <span>实盘总量</span><strong>{{ quantity(checkDetailSummary.checkQty) }}</strong
          ><small>包含损坏数量</small>
        </div>
        <div class="is-danger">
          <span>盘亏数量</span><strong>{{ quantity(checkDetailSummary.shortageQty) }}</strong
          ><small>按批次累计</small>
        </div>
        <div class="is-success">
          <span>盘盈数量</span><strong>{{ quantity(checkDetailSummary.overflowQty) }}</strong
          ><small>按批次累计</small>
        </div>
        <div class="is-warning">
          <span>损坏数量</span><strong>{{ quantity(checkDetailSummary.damagedQty) }}</strong
          ><small>独立损坏维度</small>
        </div>
      </div>

      <div v-if="form.generatedDocuments?.length" class="generated-documents">
        <span>已生成后继单据：</span>
        <el-tag
          v-for="item in form.generatedDocuments"
          :key="`${item.type}-${item.id}`"
          :type="
            Number(item.approveStatus) === 1
              ? 'success'
              : Number(item.status) === 0
                ? 'info'
                : 'warning'
          "
        >
          {{ item.type }} {{ item.businessNo
          }}<template v-if="item.successorNo"> → {{ item.successorNo }}</template>
        </el-tag>
      </div>

      <div class="form-section-title">批次盘点明细</div>
      <InventoryProductBatchLayout
        :groups="checkProductGroups"
        product-title="盘点商品"
        product-empty-text="载入库存后显示商品"
      >
        <template #batches="{ batches }">
          <el-table
            :data="batches"
            border
            table-layout="fixed"
            max-height="360"
            :row-key="checkBatchRowKey"
            :row-class-name="checkBatchRowClassName"
            :show-summary="batches.length > 1"
            :summary-method="getCheckSummaries"
            empty-text="请选择左侧商品查看对应批次"
            class="check-batch-table"
          >
            <el-table-column prop="batchNo" label="批号" width="128" show-overflow-tooltip>
              <template #default="b">{{ b.row.batchNo || '无批号' }}</template>
            </el-table-column>
            <el-table-column prop="inventoryQty" label="账面数量" width="96" align="right">
              <template #default="b">{{ quantity(b.row.inventoryQty) }}</template>
            </el-table-column>
            <el-table-column prop="checkQty" label="实盘总数" width="144" align="right">
              <template #default="b">
                <el-input-number
                  v-model="b.row.checkQty"
                  :min="0"
                  :precision="0"
                  :step="1"
                  controls-position="right"
                  :disabled="isView"
                  @change="recalcCheckLine(b.row)"
                />
              </template>
            </el-table-column>
            <el-table-column prop="differentQty" label="差异数量" width="96" align="right">
              <template #default="b">
                <span
                  :class="{
                    'difference-negative': Number(b.row.differentQty) < 0,
                    'difference-positive': Number(b.row.differentQty) > 0,
                  }"
                  >{{ quantity(b.row.differentQty) }}</span
                >
              </template>
            </el-table-column>
            <el-table-column prop="damagedQty" label="损坏数量" width="136" align="right">
              <template #default="b">
                <el-input-number
                  v-model="b.row.damagedQty"
                  :min="0"
                  :max="Number(b.row.checkQty)"
                  :precision="0"
                  :step="1"
                  controls-position="right"
                  :disabled="isView"
                  @change="recalcCheckLine(b.row)"
                />
              </template>
            </el-table-column>
            <el-table-column label="盘点结果" width="168" align="center">
              <template #default="b">
                <div class="check-result-tags">
                  <BusinessStatusTag
                    :semantic="checkQuantityStatus(b.row).semantic"
                    :text="checkQuantityStatus(b.row).text"
                    :dot="false"
                  />
                  <BusinessStatusTag
                    v-if="Number(b.row.damagedQty) > 0"
                    :semantic="checkDamageStatus(b.row).semantic"
                    :text="checkDamageStatus(b.row).text"
                    :dot="false"
                  />
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="unitPrice" label="单价" width="88" align="right">
              <template #default="b">¥ {{ moneyText(amountHidden ? null : b.row.unitPrice) }}</template>
            </el-table-column>
            <el-table-column prop="differentAmount" label="差异金额" width="104" align="right">
              <template #default="b">¥ {{ moneyText(amountHidden ? null : b.row.differentAmount) }}</template>
            </el-table-column>
            <el-table-column prop="remark" label="备注" min-width="160" show-overflow-tooltip>
              <template #default="b">
                <el-input v-model="b.row.remark" :disabled="isView" />
              </template>
            </el-table-column>
          </el-table>
        </template>
      </InventoryProductBatchLayout>
    </template>

    <div v-if="!isView" class="form-actions">
      <el-button @click="emit('cancel')">取消</el-button>
      <el-button v-if="!isCreate" :loading="saving" @click="save">保存盘点</el-button>
      <el-button type="primary" :loading="saving" @click="isCreate ? save() : finishCheck()">
        {{ isCreate ? '载入盘点明细' : '完成盘点' }}
      </el-button>
    </div>
  </el-form>
</template>

<style scoped>
.span-2 {
  grid-column: 1 / -1;
}
.check-dialog-section {
  margin-bottom: var(--hs-space-5);
  padding: var(--hs-space-5);
  border: 1px solid var(--hs-color-border);
  border-radius: var(--hs-radius-md);
  background: var(--hs-color-surface-muted);
}
.check-dialog-section__heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--hs-space-4);
  margin-bottom: var(--hs-space-4);
}
.check-dialog-section__heading strong,
.check-dialog-section__heading span {
  display: block;
}
.check-dialog-section__heading strong {
  margin-bottom: var(--hs-space-1);
  color: var(--hs-color-text-primary);
  font-size: 14px;
}
.check-dialog-section__heading span {
  color: var(--hs-color-text-secondary);
  font-size: 11px;
}
.check-master-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0 var(--hs-space-3);
}
.load-hint {
  padding: 24px;
  border: 1px dashed #c9d2e3;
  background: #f8faff;
  color: #667085;
  text-align: center;
}
.generated-documents {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
  padding: 12px 14px;
  border: 1px solid #dbe5f4;
  border-radius: 6px;
  background: #f7faff;
  color: #526079;
}
.form-section-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 40px;
  margin: 16px 0 8px;
  padding: 0 12px;
  border: 1px solid var(--hs-color-border);
  border-radius: var(--hs-radius-md);
  background: var(--hs-color-surface-muted);
  color: var(--hs-color-text-primary);
  font-size: var(--hs-font-section);
  line-height: var(--hs-line-section);
  font-weight: 600;
}
.check-result-summary {
  display: grid;
  grid-template-columns: repeat(7, minmax(112px, 1fr));
  margin-bottom: var(--hs-space-5);
  border: 1px solid var(--hs-color-border);
  border-radius: var(--hs-radius-md);
  background: var(--hs-color-surface);
}
.check-result-summary > div {
  min-height: 78px;
  padding: 13px 16px;
  border-right: 1px solid var(--hs-color-border);
}
.check-result-summary > div:last-child {
  border-right: 0;
}
.check-result-summary span,
.check-result-summary small {
  display: block;
  color: var(--hs-color-text-secondary);
  font-size: 10px;
}
.check-result-summary strong {
  display: block;
  margin: 3px 0;
  color: var(--hs-color-text-primary);
  font-size: 20px;
  font-variant-numeric: tabular-nums;
}
.check-result-summary .is-danger strong {
  color: var(--hs-color-danger);
}
.check-result-summary .is-success strong {
  color: var(--hs-color-success);
}
.check-result-summary .is-warning strong {
  color: var(--hs-color-warning);
}
.difference-negative {
  color: var(--hs-color-danger);
  font-weight: 650;
}
.difference-positive {
  color: var(--hs-color-success);
  font-weight: 650;
}
.check-result-tags {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--hs-space-1);
}
:deep(.check-batch-table .el-table__header-wrapper th) {
  background: var(--hs-color-surface);
}
:deep(.check-batch-table .el-table__cell) {
  height: var(--hs-detail-row-height);
}
:deep(.check-batch-table .check-row-shortage) {
  --el-table-tr-bg-color: var(--el-color-danger-light-9);
}
:deep(.check-batch-table .check-row-overflow) {
  --el-table-tr-bg-color: var(--el-color-success-light-9);
}
:deep(.check-batch-table .check-row-damaged) {
  --el-table-tr-bg-color: var(--el-color-warning-light-9);
}
:deep(.check-batch-table .el-table__footer-wrapper td) {
  background: var(--hs-color-surface-muted);
  color: var(--hs-color-text-primary);
  font-weight: 650;
}
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>
