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
  inputTypes: [],
});
const isView = computed(() => props.mode === 'view');
/** 来源方式：false=采购订单入库，true=临时采购入库（反向生成申请+订单） */
const isDirect = computed(() => Boolean(form.value.directReceipt));

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
    unitPrice: 0,
    goodsWarehouseType: 0,
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

/** 组织选项转树（raw.parentId 构建层级） */
type OrgTreeNode = { value: string; label: string; raw?: any; children: OrgTreeNode[] };
const organizationTree = computed<OrgTreeNode[]>(() => {
  const nodes = new Map<string, OrgTreeNode>();
  for (const option of options.orgs as any[])
    nodes.set(String(option.value), {
      value: String(option.value),
      label: String(option.label ?? option.name ?? ''),
      raw: option.raw,
      children: [],
    });
  const roots: OrgTreeNode[] = [];
  for (const node of nodes.values()) {
    const parentId = String(node.raw?.parentId ?? 0);
    const parent = parentId !== '0' ? nodes.get(parentId) : undefined;
    if (parent) parent.children!.push(node);
    else roots.push(node);
  }
  const sortNodes = (items: OrgTreeNode[]) => {
    items.sort(
      (left, right) =>
        Number(left.raw?.sort ?? 0) - Number(right.raw?.sort ?? 0) ||
        left.label.localeCompare(right.label, 'zh-CN'),
    );
    for (const item of items) if (item.children?.length) sortNodes(item.children);
  };
  sortNodes(roots);
  return roots;
});

const optionWarehouseType = (item: any) =>
  Number(item?.warehouseType ?? item?.raw?.warehouseType ?? 0);

/** 明细商品的唯一分类仓库类型：全部同类型则返回该类型（仓库只能选该类型），否则 0（不限） */
const documentWarehouseType = computed(() => {
  const types = new Set(
    (form.value.details ?? [])
      .map((line: any) => Number(line.goodsWarehouseType ?? 0))
      .filter(Boolean),
  );
  return types.size === 1 ? [...types][0] : 0;
});

/** 仓库选项：按明细商品分类类型过滤（先选商品后选仓库场景） */
const warehouseOptions = computed(() =>
  (options.warehouses ?? []).filter(
    (w: any) =>
      !documentWarehouseType.value ||
      optionWarehouseType(w) === documentWarehouseType.value,
  ),
);

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
  if (!isDirect.value) loadContextGoods();
  if (!(form.value.details ?? []).length) return;
  // 换仓库后清空类型不匹配的明细，避免跨仓库类型残留
  const warehouse = warehouseOptions.value.find(
    (w: any) => String(w.value) === String(form.value.warehouseId),
  );
  const type = optionWarehouseType(warehouse);
  const kept = (form.value.details as any[]).filter(
    (line) => !type || !Number(line.goodsWarehouseType) || Number(line.goodsWarehouseType) === type,
  );
  form.value.details = kept.length ? kept : isDirect.value ? [blankLine()] : [];
}

/** 采购订单入库：按单据组织+仓库匹配商品（本地过滤） */
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

/** 临时采购入库：远程搜索全量商品，并按已选仓库分类类型过滤 */
async function searchDirectGoods(keyword: string) {
  const kw = String(keyword ?? '').trim();
  if (!form.value.orgId) return [];
  const warehouse = warehouseOptions.value.find(
    (w: any) => String(w.value) === String(form.value.warehouseId),
  );
  const type = optionWarehouseType(warehouse);
  const params: Record<string, any> = { pageSize: 50, status: 1 };
  if (kw) params.keyword = kw;
  const r: any = await api.get('/goods', { params }).catch(() => ({ items: [] as any[] }));
  return (r.items ?? [])
    .filter((g: any) => !type || Number(g.categoryWarehouseType ?? 0) === type)
    .map((g: any) => ({
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
  line.goodsWarehouseType = Number(g.categoryWarehouseType ?? 0);
  // 临时采购入库：默认回填成本价作为采购单价
  if (isDirect.value && !Number(line.unitPrice))
    line.unitPrice = Number(sku?.costPrice ?? g.costPrice ?? 0);
  // 商品分类类型变化后，若已选仓库类型不匹配则清空仓库
  if (form.value.warehouseId && line.goodsWarehouseType && documentWarehouseType.value) {
    const current = warehouseOptions.value.find(
      (w: any) => String(w.value) === String(form.value.warehouseId),
    );
    if (!current) {
      form.value.warehouseId = '';
      ElMessage.warning('明细商品类型与仓库不匹配，请重新选择仓库');
    }
  }
}

/** 切换来源方式：清空来源订单与单据级字段 */
function receiptSourceChanged() {
  form.value.orderId = '';
  form.value.details = isDirect.value ? [blankLine()] : [];
  form.value.orgId = '';
  form.value.deptId = '';
  form.value.warehouseId = '';
  form.value.vendorId = '';
  if (isDirect.value) loadOrgOptions('');
}

async function organizationChanged() {
  form.value.deptId = '';
  form.value.warehouseId = '';
  form.value.details = [blankLine()];
  options.contextGoods = [];
  await loadOrgOptions(form.value.orgId);
  loadContextGoods();
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

async function searchVendorOptions(keyword: string) {
  const kw = String(keyword ?? '').trim();
  const vendors = options.vendors ?? [];
  if (!kw) return vendors.map((item: any) => ({ value: item.value, label: item.label }));
  const items = (await api.get('/base-data/vendors/options', {
    params: { keyword: kw },
  })) as any[];
  for (const item of items)
    if (!vendors.some((v: any) => String(v.value) === String(item.value))) vendors.push(item);
  return items.map((item: any) => ({ value: item.value, label: item.label }));
}

async function searchPurchaseOrderOptions(keyword: string) {
  const kw = String(keyword ?? '').trim();
  const orders = options.orders ?? [];
  if (!kw) return orders.map((item: any) => ({ value: item.value, label: item.label }));
  const r: any = await api.get('/purchase/orders', { params: { keyword: kw, pageSize: 50 } });
  const items = (r.items ?? []).map((item: any) => ({
    ...item,
    label: item.orderNo,
    value: item.id,
  }));
  for (const item of items)
    if (!orders.some((v: any) => String(v.value) === String(item.value))) orders.push(item);
  return items.map((item: any) => ({ value: item.value, label: item.label }));
}

function addLine() {
  (form.value.details ??= []).push(blankLine());
}
function removeLine(index: number) {
  form.value.details.splice(index, 1);
}

function validate() {
  if (isDirect.value) {
    if (!form.value.orgId) {
      ElMessage.warning('请选择所属组织');
      return false;
    }
    if (!form.value.vendorId) {
      ElMessage.warning('请选择供应商');
      return false;
    }
  } else if (!form.value.orderId) {
    ElMessage.warning('请选择来源采购订单');
    return false;
  }
  if (!form.value.deptId) {
    ElMessage.warning('请选择接收部门');
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
      ...(isDirect.value ? {} : { orderId: form.value.orderId }),
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
        unitPrice: isDirect.value ? Number(line.unitPrice ?? 0) : undefined,
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
  const [orgs, units, goodsResult, vendors, orders, inputTypes] = await Promise.all([
    api.get('/base-data/organizations/options').catch(() => []),
    api.get('/base-data/units/options').catch(() => []),
    api
      .get('/goods', { params: { pageSize: 100, status: 1 } })
      .catch(() => ({ items: [] as any[] })),
    api.get('/base-data/vendors/options').catch(() => []),
    api.get('/purchase/orders', { params: { pageSize: 100 } }).catch(() => ({ items: [] as any[] })),
    api.get('/dictionaries/purchase_input_type').catch(() => []),
  ]);
  options.orgs = orgs;
  options.units = units;
  options.goods = (goodsResult as any).items ?? [];
  options.vendors = vendors;
  options.inputTypes = inputTypes ?? [];
  options.orders = ((orders as any).items ?? []).map((item: any) => ({
    ...item,
    label: item.orderNo,
    value: item.id,
  }));

  if (props.mode === 'create') {
    Object.assign(form.value, {
      directReceipt: false,
      orgId: auth.user?.orgId ?? '',
      warehouseId: '',
      deptId: auth.user?.deptId ?? '',
      receiverId: auth.user?.id ?? '',
      vendorId: '',
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
      if (!form.value.directReceipt && form.value.orderId) {
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
      <el-form-item v-if="mode !== 'edit'" label="来源方式" class="span-2">
        <el-radio-group v-model="form.directReceipt" @change="receiptSourceChanged">
          <el-radio-button :value="false">采购订单入库</el-radio-button>
          <el-radio-button :value="true">临时采购入库</el-radio-button>
        </el-radio-group>
      </el-form-item>

      <el-form-item v-if="!isDirect" label="来源采购订单" required>
        <RemoteSelect
          v-model="form.orderId"
          :fetch="searchPurchaseOrderOptions"
          :current-label="form.orderNo || '—'"
          :disabled="isView"
          placeholder="输入采购订单号搜索"
          @change="sourceOrderChanged"
        />
      </el-form-item>

      <el-form-item v-if="isDirect" label="所属组织" required>
        <el-tree-select
          v-model="form.orgId"
          :data="organizationTree"
          filterable
          check-strictly
          node-key="value"
          :props="{ label: 'label', children: 'children' }"
          placeholder="请选择所属组织"
          @change="organizationChanged"
        />
      </el-form-item>
      <el-form-item v-else label="所属组织">
        <el-input :model-value="orgName(form.orgId)" readonly />
      </el-form-item>

      <el-form-item v-if="isDirect" label="供应商" required>
        <RemoteSelect
          v-model="form.vendorId"
          :fetch="searchVendorOptions"
          :current-label="vendorName(form.vendorId)"
          clearable
          placeholder="输入供应商名称搜索"
        />
      </el-form-item>
      <el-form-item v-else label="供应商">
        <el-input :model-value="form.vendorName || vendorName(form.vendorId) || '—'" readonly />
      </el-form-item>

      <el-form-item v-if="isDirect" label="入库类型">
        <el-select v-model="form.inputType" :disabled="isView">
          <el-option
            v-for="item in options.inputTypes"
            :key="item.value"
            :label="item.label"
            :value="Number(item.value)"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="仓库" required>
        <el-select
          v-model="form.warehouseId"
          filterable
          :disabled="isView || !form.orgId"
          placeholder="请选择入库仓库"
          @change="warehouseChanged"
        >
          <el-option
            v-for="x in warehouseOptions"
            :key="x.value"
            :label="x.label"
            :value="x.value"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="接收部门" required>
        <el-select
          v-model="form.deptId"
          filterable
          :disabled="isView || !form.orgId"
          placeholder="请选择接收部门"
        >
          <el-option v-for="x in options.depts" :key="x.value" :label="x.label" :value="x.value" />
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
      <el-alert
        v-if="isDirect"
        class="span-2"
        type="warning"
        :closable="false"
        title="确认临时采购入库时，系统会反向生成已审批采购申请和采购订单。"
      />
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
            :fetch="isDirect ? searchDirectGoods : searchGoodsOptions"
            :current-label="s.row.goodsName || goodsOf(s.row).goodsName"
            :disabled="isView || !form.warehouseId"
            :placeholder="isDirect ? '输入商品名称搜索' : '请先选择仓库，再搜索商品'"
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
      <el-table-column v-if="!isDirect" label="订单数量" width="110">
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
      <el-table-column v-if="isDirect" label="采购单价" width="120" align="right">
        <template #default="s">
          <el-input-number
            v-model="s.row.unitPrice"
            :min="0"
            :precision="2"
            :step="0.01"
            :disabled="isView"
          />
        </template>
      </el-table-column>
      <el-table-column label="批号" width="130">
        <template #default="s">
          <el-input v-if="!isView" v-model="s.row.batchNo" placeholder="留空自动生成" />
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
