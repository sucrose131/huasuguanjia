<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { dateText } from '@/utils/format';
import { generateBatchNo } from '@/utils/batch-number';
import RemoteSelect from '@/components/RemoteSelect.vue';

const props = defineProps<{
  modelValue: Record<string, any>;
  mode: 'create' | 'edit' | 'view';
}>();
const emit = defineEmits<{ (e: 'saved'): void; (e: 'cancel'): void }>();

const auth = useAuthStore();
const form = computed(() => props.modelValue);
const saving = ref(false);
const options = reactive<Record<string, any>>({
  orgs: [],
  warehouses: [],
  depts: [],
  units: [],
  goods: [],
  orders: [],
  vendors: [],
  contextGoods: [],
});
const isView = computed(() => props.mode === 'view');

function blankLine() {
  return {
    goodsId: '',
    skuId: '',
    goodsCode: '',
    goodsName: '',
    skuSpec: '',
    unitType: 0,
    orderQuantity: 0,
    inputQuantity: 1,
    batchNo: '',
    position: '',
    remark: '',
  };
}

function goodsOf(line: any) {
  return options.goods.find((g: any) => String(g.id) === String(line.goodsId)) ?? {};
}
function unitName(line: any) {
  const unit = options.units.find((u: any) => String(u.value ?? u.id) === String(line.unitType));
  return unit?.label ?? unit?.name ?? '—';
}
function orgName(id: unknown) {
  const org = options.orgs.find((o: any) => String(o.value ?? o.id) === String(id));
  return org?.label ?? org?.name ?? '—';
}
function vendorName(id: unknown) {
  const vendor = options.vendors.find((v: any) => String(v.value ?? v.id) === String(id));
  return vendor?.label ?? vendor?.name ?? '—';
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

/** 按单据组织+仓库加载匹配商品（后端按分类仓库类型过滤），未选组织/仓库时清空 */
async function loadContextGoods() {
  if (!form.value.orgId || !form.value.warehouseId) {
    options.contextGoods = [];
    return;
  }
  options.contextGoods = (await api
    .get('/purchase/product-options', {
      params: { orgId: form.value.orgId, warehouseId: form.value.warehouseId },
    })
    .catch(() => [])) as any[];
}

function warehouseChanged() {
  loadContextGoods();
  if (!(form.value.details ?? []).length) return;
  // 换仓库后清空明细，避免跨仓库类型残留
  form.value.details = [];
}

async function searchGoodsOptions(keyword: string) {
  const kw = String(keyword ?? '').trim().toLowerCase();
  const list = options.contextGoods.filter((g: any) =>
    kw ? `${g.queryCode ?? ''} ${g.goodsName ?? ''}`.toLowerCase().includes(kw) : true,
  );
  return list.map((g: any) => ({
    value: g.id,
    label: `${g.queryCode || ''} ${g.goodsName || ''}`.trim(),
  }));
}

async function lineGoodsChanged(line: any) {
  if (!line.goodsId) return;
  const g: any = await api.get(`/goods/${line.goodsId}`).catch(() => null);
  if (!g) return;
  const sku = (g.skus ?? []).find((x: any) => x.isDefault === 1) ?? g.skus?.[0];
  line.skuId = sku?.id ?? '';
  line.unitType = sku?.unitType ?? g.unitType ?? 0;
  line.goodsCode = g.queryCode ?? '';
  line.goodsName = g.goodsName ?? '';
  line.skuSpec = sku?.specModels ?? '';
}

async function sourceOrderChanged() {
  if (!form.value.orderId) {
    form.value.details = [];
    return;
  }
  const source: any = await api
    .get(`/purchase/orders/${form.value.orderId}`)
    .catch(() => null);
  if (!source) return;
  Object.assign(form.value, {
    orgId: source.orgId ?? source.org_id ?? '',
    deptId: source.deptId ?? source.dept_id ?? '',
    warehouseId: source.warehouseId ?? source.warehouse_id ?? '',
  });
  const vendorId = source.vendorId ?? source.vendor_id;
  form.value.vendorName = vendorName(vendorId);
  form.value.details = (source.details ?? [])
    .filter((line: any) => Number(line.remainingQuantity ?? line.quantity ?? 0) > 0)
    .map((line: any) => ({
      goodsId: line.goodsId,
      skuId: line.skuId,
      goodsCode: line.goodsCode ?? '',
      goodsName: line.goodsName ?? '',
      unitType: line.unitType ?? 0,
      orderQuantity: Number(line.quantity ?? 0),
      inputQuantity: Number(line.remainingQuantity ?? line.quantity ?? 0),
      batchNo: generateBatchNo(),
      position: '',
      remark: line.remark ?? '',
    }));
  if (form.value.orgId) await loadOrgOptions(form.value.orgId);
  await loadContextGoods();
}

function addLine() {
  (form.value.details ??= []).push(blankLine());
}
function removeLine(index: number) {
  form.value.details.splice(index, 1);
}

function validate() {
  if (!form.value.orderId) {
    ElMessage.warning('请选择来源采购订单');
    return false;
  }
  if (!form.value.warehouseId) {
    ElMessage.warning('请选择入库仓库');
    return false;
  }
  if (!(form.value.details ?? []).length) {
    ElMessage.warning('至少需要一条入库明细');
    return false;
  }
  for (const line of form.value.details) {
    if (!line.goodsId || !line.skuId) {
      ElMessage.warning('请选择商品和规格');
      return false;
    }
    if (Number(line.inputQuantity) <= 0) {
      ElMessage.warning('本次入库数量必须大于 0');
      return false;
    }
    if (!String(line.batchNo ?? '').trim()) line.batchNo = generateBatchNo();
  }
  return true;
}

async function save() {
  if (!validate()) return;
  saving.value = true;
  try {
    const url = '/purchase/receipts';
    const payload: Record<string, any> = {
      orderId: form.value.orderId,
      orgId: form.value.orgId,
      warehouseId: form.value.warehouseId,
      deptId: form.value.deptId,
      receiverId: form.value.receiverId,
      inputType: form.value.inputType ?? 1,
      inputDate: form.value.inputDate,
      remark: form.value.remark ?? '',
      details: (form.value.details ?? []).map((line: any) => ({
        goodsId: line.goodsId,
        skuId: line.skuId,
        inputQuantity: Number(line.inputQuantity),
        batchNo: line.batchNo,
        position: line.position ?? '',
        unitType: line.unitType ?? 0,
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
  const [orgs, units, goodsResult, vendors, orders] = await Promise.all([
    api.get('/base-data/organizations/options').catch(() => []),
    api.get('/base-data/units/options').catch(() => []),
    api
      .get('/goods', { params: { pageSize: 100, status: 1 } })
      .catch(() => ({ items: [] as any[] })),
    api.get('/base-data/vendors/options').catch(() => []),
    api.get('/purchase/orders', { params: { pageSize: 100 } }).catch(() => ({ items: [] as any[] })),
  ]);
  options.orgs = orgs;
  options.units = units;
  options.goods = (goodsResult as any).items ?? [];
  options.vendors = vendors;
  options.orders = ((orders as any).items ?? []).map((item: any) => ({
    ...item,
    label: item.orderNo,
    value: item.id,
  }));

  if (props.mode === 'create') {
    Object.assign(form.value, {
      orgId: auth.user?.orgId ?? '',
      warehouseId: '',
      deptId: auth.user?.deptId ?? '',
      receiverId: auth.user?.id ?? '',
      inputType: 1,
      inputDate: dateText(new Date()),
      remark: '',
      details: [],
    });
    if (form.value.orderId) await sourceOrderChanged();
    if (form.value.orgId) await loadOrgOptions(form.value.orgId);
  } else if (form.value.id) {
    const detail: any = await api
      .get(`/purchase/receipts/${form.value.id}`)
      .catch(() => null);
    if (detail) {
      Object.assign(form.value, detail);
      form.value.details = (form.value.details ?? []).map((line: any) => ({
        ...blankLine(),
        ...line,
        batchNo: String(line.batchNo ?? '').trim() || generateBatchNo(),
      }));
      if (form.value.orderId) {
        const order: any = await api
          .get(`/purchase/orders/${form.value.orderId}`)
          .catch(() => null);
        if (order) {
          const vendorId = order.vendorId ?? order.vendor_id;
          form.value.vendorName = vendorName(vendorId);
        }
      }
      if (form.value.orgId) await loadOrgOptions(form.value.orgId);
    }
  }
  await loadContextGoods();
});
</script>

<template>
  <el-form label-position="top" :disabled="isView">
    <div class="form-grid">
      <el-form-item label="来源采购订单" required>
        <el-select
          v-if="mode === 'create'"
          v-model="form.orderId"
          filterable
          clearable
          placeholder="输入订单号搜索"
          @change="sourceOrderChanged"
        >
          <el-option v-for="x in options.orders" :key="x.id" :label="x.orderNo" :value="x.id" />
        </el-select>
        <el-input v-else :model-value="form.orderNo || '—'" readonly />
      </el-form-item>
      <el-form-item label="供应商">
        <el-input :model-value="form.vendorName || vendorName(form.vendorId) || '—'" readonly />
      </el-form-item>
      <el-form-item label="所属组织">
        <el-input :model-value="orgName(form.orgId)" readonly />
      </el-form-item>
      <el-form-item label="仓库" required>
        <el-select
          v-model="form.warehouseId"
          filterable
          clearable
          :disabled="isView || !form.orgId"
          placeholder="请选择入库仓库"
          @change="warehouseChanged"
        >
          <el-option
            v-for="x in options.warehouses"
            :key="x.value"
            :label="x.label"
            :value="x.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="部门">
        <el-select
          v-model="form.deptId"
          filterable
          clearable
          :disabled="isView || !form.orgId"
        >
          <el-option
            v-for="x in options.depts"
            :key="x.value"
            :label="x.label"
            :value="x.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="收货人">
        <el-input :model-value="auth.user?.username || '—'" readonly />
      </el-form-item>
      <el-form-item label="入库日期">
        <el-date-picker
          v-model="form.inputDate"
          type="date"
          value-format="YYYY-MM-DD"
          :disabled="isView"
        />
      </el-form-item>
      <el-form-item label="备注" class="span-2">
        <el-input v-model="form.remark" type="textarea" :rows="2" :disabled="isView" />
      </el-form-item>
    </div>

    <div class="details-header">
      <span class="details-title">入库明细</span>
      <el-button v-if="!isView" link type="primary" @click="addLine">+ 添加明细</el-button>
    </div>
    <el-table :data="form.details ?? []" border size="small">
      <el-table-column label="商品" min-width="220">
        <template #default="s">
          <RemoteSelect
            v-if="!isView"
            v-model="s.row.goodsId"
            :fetch="searchGoodsOptions"
            :current-label="s.row.goodsName || goodsOf(s.row).goodsName"
            :disabled="isView || !form.warehouseId"
            placeholder="请先选择仓库，再搜索商品"
            @change="lineGoodsChanged(s.row)"
          />
          <span v-else>{{ s.row.goodsName || goodsOf(s.row).goodsName || s.row.goodsId || '—' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="SKU/规格" min-width="125">
        <template #default="s">{{
          s.row.skuSpec || s.row.goodsSpec || (s.row.skuId ? '规格 ' + s.row.skuId : '—')
        }}</template>
      </el-table-column>
      <el-table-column label="单位" width="90">
        <template #default="s">{{ unitName(s.row) }}</template>
      </el-table-column>
      <el-table-column label="订单数量" width="110">
        <template #default="s">{{ s.row.orderQuantity ?? 0 }}</template>
      </el-table-column>
      <el-table-column label="本次入库数量" width="140">
        <template #default="s">
          <el-input-number
            v-model="s.row.inputQuantity"
            :min="1"
            :precision="0"
            :step="1"
            :disabled="isView"
          />
        </template>
      </el-table-column>
      <el-table-column label="批号" width="130">
        <template #default="s">
          <el-input
            v-if="!isView"
            v-model="s.row.batchNo"
            placeholder="留空自动生成"
          />
          <span v-else>{{ s.row.batchNo || '—' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="库位" width="120">
        <template #default="s">
          <el-input v-if="!isView" v-model="s.row.position" />
          <span v-else>{{ s.row.position || '—' }}</span>
        </template>
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
.details-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0;
}
.details-title {
  font-weight: 600;
}
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>
