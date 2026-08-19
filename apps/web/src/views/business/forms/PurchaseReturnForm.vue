<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '@/api';
import { dateText } from '@/utils/format';

const props = defineProps<{
  modelValue: Record<string, any>;
  mode: 'create' | 'edit' | 'view';
}>();
const emit = defineEmits<{ (e: 'saved'): void; (e: 'cancel'): void }>();

const form = computed(() => props.modelValue);
const saving = ref(false);
const options = reactive<Record<string, any>>({
  orgs: [],
  warehouses: [],
  depts: [],
  units: [],
  goods: [],
});
const dicts = reactive<Record<string, any[]>>({});
const isView = computed(() => props.mode === 'view');

function unitName(line: any) {
  const unit = options.units.find((u: any) => String(u.value ?? u.id) === String(line.unitType));
  return unit?.label ?? unit?.name ?? '—';
}
function orgName(id: unknown) {
  const org = options.orgs.find((o: any) => String(o.value ?? o.id) === String(id));
  return org?.label ?? org?.name ?? '—';
}
function warehouseName(id: unknown) {
  const w = options.warehouses.find((x: any) => String(x.value ?? x.id) === String(id));
  return w?.label ?? w?.name ?? '—';
}
function deptName(id: unknown) {
  const d = options.depts.find((x: any) => String(x.value ?? x.id) === String(id));
  return d?.label ?? d?.name ?? '—';
}
function goodsNameOf(id: unknown) {
  return options.goods.find((g: any) => String(g.id) === String(id))?.goodsName ?? '';
}
function goodsCodeOf(id: unknown) {
  return options.goods.find((g: any) => String(g.id) === String(id))?.queryCode ?? '';
}
function toDateString(value: unknown) {
  if (!value) return '';
  const text = dateText(value);
  return text === '—' ? '' : text;
}

async function loadOrgOptions(orgId: unknown) {
  if (!orgId) {
    options.warehouses = [];
    options.depts = [];
    return;
  }
  const [depts, warehouses] = await Promise.all([
    api.get('/base-data/departments/options', { params: { orgId: String(orgId) } }).catch(() => []),
    api
      .get('/base-data/warehouses/options', { params: { orgId: String(orgId) } })
      .catch(() => []),
  ]);
  options.depts = depts ?? [];
  options.warehouses = warehouses ?? [];
}

async function sourceReceiptChanged() {
  if (!form.value.receiptId) return;
  const source: any = await api
    .get(`/purchase/receipts/${form.value.receiptId}`)
    .catch(() => null);
  if (!source) return;
  Object.assign(form.value, {
    orderId: source.orderId ?? source.po_id ?? '',
    orderNo: source.orderNo ?? '',
    receiptNo: source.receiptNo ?? '',
    orgId: source.orgId ?? source.org_id ?? '',
    warehouseId: source.warehouseId ?? source.warehouse_id ?? '',
    deptId: source.deptId ?? source.dept_id ?? '',
    sourceType: 'receipt',
    sourceTypeLabel: '已入库退货',
  });
  form.value.details = (source.details ?? []).map((line: any) => ({
    goodsId: line.goodsId,
    skuId: line.skuId,
    goodsCode: line.goodsCode ?? '',
    goodsName: line.goodsName ?? '',
    unitType: line.unitType ?? 0,
    orderQuantity: Number(line.orderQuantity ?? 0),
    inputQuantity: Number(line.inputQuantity ?? 0),
    returnQuantity: 1,
    batchNo: line.batchNo ?? '',
    remark: line.remark ?? '',
  }));
  if (form.value.orgId) await loadOrgOptions(form.value.orgId);
}

function removeLine(index: number) {
  form.value.details.splice(index, 1);
}

function validate() {
  if (!form.value.receiptId) {
    ElMessage.warning('请选择来源入库单');
    return false;
  }
  if (!(form.value.details ?? []).length) {
    ElMessage.warning('至少需要一条退货明细');
    return false;
  }
  for (const line of form.value.details) {
    if (!line.goodsId || !line.skuId) {
      ElMessage.warning('退货明细商品或规格缺失');
      return false;
    }
    if (Number(line.returnQuantity) <= 0) {
      ElMessage.warning('本次退货数量必须大于 0');
      return false;
    }
  }
  return true;
}

async function save() {
  if (!validate()) return;
  saving.value = true;
  try {
    const url = '/purchase/returns';
    const payload: Record<string, any> = {
      receiptId: form.value.receiptId,
      reason: form.value.reason ?? '',
      returnDate: form.value.returnDate,
      returnType: form.value.returnType ?? 1,
      remark: form.value.remark ?? '',
      details: (form.value.details ?? []).map((line: any) => ({
        goodsId: line.goodsId,
        skuId: line.skuId,
        returnQuantity: Number(line.returnQuantity),
        batchNo: line.batchNo ?? '',
        unitType: line.unitType ?? 0,
        orderQuantity: Number(line.orderQuantity ?? 0),
        inputQuantity: Number(line.inputQuantity ?? 0),
        remark: line.remark ?? '',
      })),
    };
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

onMounted(async () => {
  const [orgs, units, goodsResult, returnTypeDict] = await Promise.all([
    api.get('/base-data/organizations/options').catch(() => []),
    api.get('/base-data/units/options').catch(() => []),
    api
      .get('/goods', { params: { pageSize: 100, status: 1 } })
      .catch(() => ({ items: [] as any[] })),
    api.get('/dictionaries/purchase_return_type').catch(() => []),
  ]);
  options.orgs = orgs;
  options.units = units;
  options.goods = (goodsResult as any).items ?? [];
  dicts.purchase_return_type = returnTypeDict as any[];

  if (props.mode === 'create') {
    Object.assign(form.value, {
      returnDate: dateText(new Date()),
      returnType: 1,
      reason: '',
      remark: '',
      details: [],
    });
    if (form.value.receiptId) await sourceReceiptChanged();
  } else if (form.value.id) {
    const detail: any = await api
      .get(`/purchase/returns/${form.value.id}`)
      .catch(() => null);
    if (detail) {
      Object.assign(form.value, {
        ...detail,
        receiptId: detail.receiptId ?? detail.po_input_id ?? '',
        orderId: detail.orderId ?? detail.po_id ?? '',
        reason: detail.reason ?? detail.exit_reson ?? '',
        returnDate: toDateString(detail.returnDate ?? detail.exit_date),
        returnType: detail.returnType ?? detail.exit_type ?? 1,
        approveStatus: detail.approveStatus ?? detail.approve_status ?? 0,
      });
      form.value.details = (form.value.details ?? []).map((line: any) => ({
        ...line,
        goodsName: line.goodsName ?? goodsNameOf(line.goodsId),
        goodsCode: line.goodsCode ?? goodsCodeOf(line.goodsId),
      }));
      if (form.value.receiptId) {
        const receipt: any = await api
          .get(`/purchase/receipts/${form.value.receiptId}`)
          .catch(() => null);
        if (receipt) {
          form.value.orderId = receipt.orderId ?? receipt.po_id ?? form.value.orderId;
          form.value.orderNo = receipt.orderNo ?? form.value.orderNo;
          form.value.receiptNo = receipt.receiptNo ?? form.value.receiptNo;
          form.value.orgId = receipt.orgId ?? receipt.org_id ?? form.value.orgId;
          form.value.warehouseId =
            receipt.warehouseId ?? receipt.warehouse_id ?? form.value.warehouseId;
          form.value.deptId = receipt.deptId ?? receipt.dept_id ?? form.value.deptId;
        }
      }
      if (form.value.orgId) await loadOrgOptions(form.value.orgId);
    }
  }
});
</script>

<template>
  <el-form label-position="top" :disabled="isView">
    <div class="form-grid">
      <el-form-item label="退货来源">
        <el-input :model-value="form.sourceTypeLabel || '—'" readonly />
      </el-form-item>
      <el-form-item label="来源入库单/订单号">
        <el-input :model-value="form.receiptNo || form.orderNo || '—'" readonly />
      </el-form-item>
      <el-form-item label="所属组织">
        <el-input :model-value="orgName(form.orgId)" readonly />
      </el-form-item>
      <el-form-item label="仓库">
        <el-input :model-value="warehouseName(form.warehouseId)" readonly />
      </el-form-item>
      <el-form-item label="部门">
        <el-input :model-value="deptName(form.deptId)" readonly />
      </el-form-item>
      <el-form-item label="退货日期">
        <el-date-picker
          v-model="form.returnDate"
          type="date"
          value-format="YYYY-MM-DD"
          :disabled="isView"
        />
      </el-form-item>
      <el-form-item label="退货类型">
        <el-select v-model="form.returnType" :disabled="isView">
          <el-option
            v-for="item in dicts.purchase_return_type"
            :key="item.value"
            :label="item.label"
            :value="Number(item.value)"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="原因" class="span-2">
        <el-input v-model="form.reason" type="textarea" :rows="2" :disabled="isView" />
      </el-form-item>
      <el-form-item label="备注" class="span-2">
        <el-input v-model="form.remark" type="textarea" :rows="2" :disabled="isView" />
      </el-form-item>
    </div>

    <div class="details-title">退货明细</div>
    <el-table :data="form.details ?? []" border size="small">
      <el-table-column label="商品" min-width="200">
        <template #default="s">{{ s.row.goodsName || s.row.goodsId || '—' }}</template>
      </el-table-column>
      <el-table-column label="SKU/规格" min-width="125">
        <template #default="s">{{
          s.row.skuSpec || s.row.goodsSpec || (s.row.skuId ? '规格 ' + s.row.skuId : '—')
        }}</template>
      </el-table-column>
      <el-table-column label="单位" width="90">
        <template #default="s">{{ unitName(s.row) }}</template>
      </el-table-column>
      <el-table-column label="已入库数量" width="110">
        <template #default="s">{{ s.row.inputQuantity ?? 0 }}</template>
      </el-table-column>
      <el-table-column label="本次退货数量" width="140">
        <template #default="s">
          <el-input-number
            v-model="s.row.returnQuantity"
            :min="1"
            :max="Number(s.row.inputQuantity ?? 0)"
            :precision="0"
            :step="1"
            :disabled="isView"
          />
        </template>
      </el-table-column>
      <el-table-column label="批号" min-width="120">
        <template #default="s">{{ s.row.batchNo || '无批号' }}</template>
      </el-table-column>
      <el-table-column label="备注" min-width="140">
        <template #default="s">
          <el-input v-if="!isView" v-model="s.row.remark" />
          <span v-else>{{ s.row.remark || '—' }}</span>
        </template>
      </el-table-column>
      <el-table-column v-if="!isView" label="" width="60">
        <template #default="s">
          <el-button link type="danger" @click="removeLine(s.$index)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

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
.details-title {
  font-weight: 600;
  margin: 8px 0;
}
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>
