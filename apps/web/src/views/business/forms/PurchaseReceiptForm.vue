<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { dateText, display, moneyText } from '@/utils/format';
import { generateBatchNo } from '@/utils/batch-number';
import { buildCategoryTree } from '@/utils/category-tree';
import RemoteSelect from '@/components/RemoteSelect.vue';
import PurchaseReceiptDetails from '@/components/PurchaseReceiptDetails.vue';

const props = defineProps<{
  modelValue: Record<string, any>;
  mode: 'create' | 'edit' | 'view';
}>();
const emit = defineEmits<{ (e: 'saved'): void; (e: 'cancel'): void }>();

const auth = useAuthStore();
const form = computed(() => props.modelValue);
const saving = ref(false);
const options = reactive<Record<string, any>>({
  organizations: [],
  departments: [],
  warehouses: [],
  vendors: [],
  goods: [],
  categories: [],
  units: [],
  orders: [],
  inputTypes: [],
});
const dicts = reactive<Record<string, any[]>>({});
const isView = computed(() => props.mode === 'view');
/** 来源方式：false=采购订单入库，true=临时采购入库（反向生成申请+订单） */
const isDirect = computed(() => Boolean(form.value.directReceipt));

const canEditAmount = computed(() => auth.amountAccess.canEditAmount);
const organizationOptions = reactive<{ orgId: string; departments: any[]; warehouses: any[] }>({
  orgId: '',
  departments: [],
  warehouses: [],
});

// ---------- 组织树 ----------
type OrgTreeNode = { value: string; label: string; raw?: any; children: OrgTreeNode[] };
const organizationTree = computed<OrgTreeNode[]>(() => {
  const nodes = new Map<string, OrgTreeNode>();
  for (const option of options.organizations as any[])
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

// ---------- 仓库/商品类型匹配 ----------
const optionOrgId = (item: any) => item.orgId ?? item.raw?.orgId ?? item.raw?.organization?.id;
const optionWarehouseType = (item: any) =>
  Number(item?.warehouseType ?? item?.raw?.warehouseType ?? 0);
const lineWarehouseType = (line: any) => Number(line?.categoryWarehouseType ?? 0);
const documentWarehouseTypes = computed(() => [
  ...new Set((form.value.details ?? []).map(lineWarehouseType).filter(Boolean)),
]);
const documentWarehouseType = computed(() =>
  documentWarehouseTypes.value.length === 1 ? documentWarehouseTypes.value[0] : 0,
);
const filteredDepartments = computed(() => {
  if (!form.value.orgId) return [];
  if (organizationOptions.orgId === String(form.value.orgId))
    return organizationOptions.departments;
  return (options.departments ?? []).filter(
    (item: any) => String(optionOrgId(item)) === String(form.value.orgId),
  );
});
const filteredWarehouses = computed(() => {
  if (!form.value.orgId) return [];
  if (organizationOptions.orgId === String(form.value.orgId))
    return organizationOptions.warehouses;
  return (options.warehouses ?? []).filter(
    (item: any) => String(optionOrgId(item)) === String(form.value.orgId),
  );
});
const compatibleWarehouses = computed(() =>
  filteredWarehouses.value.filter(
    (item: any) =>
      !documentWarehouseType.value || optionWarehouseType(item) === documentWarehouseType.value,
  ),
);
function requiredGoodsWarehouseType(line: any) {
  const otherType = [
    ...new Set(
      (form.value.details ?? [])
        .filter((item: any) => item !== line)
        .map(lineWarehouseType)
        .filter(Boolean),
    ),
  ][0];
  const selectedWarehouse = filteredWarehouses.value.find(
    (item: any) => String(item.value) === String(form.value.warehouseId),
  );
  return Number(otherType || optionWarehouseType(selectedWarehouse));
}
function compatibleGoods(line: any, items: any[]) {
  const requiredType = requiredGoodsWarehouseType(line);
  return items.filter(
    (item: any) => !requiredType || Number(item.categoryWarehouseType) === requiredType,
  );
}
function availableGoods(line: any) {
  return compatibleGoods(line, options.goods ?? []);
}

// ---------- 商品远程搜索（临时入库明细行） ----------
function mergeGoodsOptions(items: any[]) {
  const merged = new Map((options.goods ?? []).map((item: any) => [String(item.id), item]));
  items.forEach((item: any) => merged.set(String(item.id), item));
  options.goods = [...merged.values()];
}
const goodsSearchTimers = new WeakMap<object, ReturnType<typeof setTimeout>>();
const goodsSearchVersions = new WeakMap<object, number>();
function remoteSearchGoods(line: any, keyword: string) {
  line.goodsSearchKeyword = keyword;
  line.goodsSearchFailed = false;
  line.remoteGoods = [];
  const previousTimer = goodsSearchTimers.get(line);
  if (previousTimer) clearTimeout(previousTimer);
  const normalized = String(keyword ?? '').trim();
  const version = (goodsSearchVersions.get(line) ?? 0) + 1;
  goodsSearchVersions.set(line, version);
  if (!normalized) {
    line.goodsLoading = false;
    return;
  }
  line.goodsLoading = true;
  const timer = setTimeout(async () => {
    try {
      const result = (await api.get('/goods', {
        params: { keyword: normalized, pageSize: 50, status: 1 },
      })) as any;
      if (goodsSearchVersions.get(line) !== version) return;
      const items = compatibleGoods(line, result.items ?? []);
      line.remoteGoods = items;
      mergeGoodsOptions(items);
    } catch {
      if (goodsSearchVersions.get(line) !== version) return;
      line.goodsSearchFailed = true;
      line.remoteGoods = [];
    } finally {
      if (goodsSearchVersions.get(line) === version) line.goodsLoading = false;
    }
  }, 250);
  goodsSearchTimers.set(line, timer);
}
function searchedGoods(line: any) {
  const keyword = String(line.goodsSearchKeyword ?? '').trim();
  const items = keyword ? compatibleGoods(line, line.remoteGoods ?? []) : availableGoods(line);
  const selected = options.goods.find((g: any) => String(g.id) === String(line.goodsId));
  if (!keyword && selected && !items.some((item: any) => String(item.id) === String(selected.id)))
    return [selected, ...items];
  return items;
}
const quickGoodsName = (line: any) => String(line.goodsSearchKeyword ?? '').trim();

// ---------- 快捷新增商品/SKU ----------
const quickCatalogVisible = ref(false);
const quickCatalogChecking = ref(false);
const quickCatalogMode = ref<'goods' | 'sku'>('goods');
const quickCatalogLine = ref<any>(null);
const quickCatalogForm = reactive<Record<string, any>>({});
const quickCategoryTreeProps = {
  value: 'id',
  label: 'name',
  children: 'children',
  disabled: 'disabled',
};
const markQuickCategories = (nodes: any[]): any[] =>
  nodes.map((item: any) => ({
    ...item,
    disabled: Number(item.status) !== 1 || Number(item.warehouseType) <= 0,
    children: markQuickCategories(item.children ?? []),
  }));
const quickCategoryTree = computed(() =>
  markQuickCategories(buildCategoryTree(options.categories ?? [])),
);
async function globalGoodsAvailability(goodsName: string) {
  return (await api.get('/goods/name-availability', {
    params: { name: goodsName },
  })) as any;
}
function warehouseTypeText(value: unknown) {
  const label = (dicts.warehouse_type ?? []).find(
    (item: any) => String(item.value) === String(value),
  )?.label;
  return label || `仓库类型 ${value}`;
}
async function explainUnavailableGlobalGoods(result: any, goodsName: string) {
  const categoryText = result.categoryName ? `，所属分类为“${result.categoryName}”` : '';
  const messages: Record<string, string> = {
    warehouse_type_unavailable: `全局商品主档中已经存在“${goodsName}”${categoryText}，要求使用“${warehouseTypeText(result.warehouseType)}”。当前组织没有启用该类型仓库，因此不能使用，也不能重复新增。请先配置对应类型仓库，或联系管理员调整商品分类。`,
    goods_disabled: `全局商品主档中已经存在“${goodsName}”，但商品当前已停用，不能使用，也不能重复新增。请联系商品管理员恢复。`,
    goods_deleted: `全局商品主档中已经存在“${goodsName}”的历史档案，不能重复新增。请联系商品管理员恢复或处理原档案。`,
    category_disabled: `全局商品主档中已经存在“${goodsName}”${categoryText}，但该分类当前已停用，不能使用，也不能重复新增。`,
    category_deleted: `全局商品主档中已经存在“${goodsName}”，但其分类当前不可用，不能使用，也不能重复新增。`,
  };
  await ElMessageBox.alert(
    messages[result.reason] ??
      `全局商品主档中已经存在“${goodsName}”，当前不可使用，也不能重复新增。`,
    '商品已存在但当前不可用',
    { confirmButtonText: '我知道了', type: 'warning' },
  ).catch(() => undefined);
}
async function useExistingGlobalGoods(line: any, result: any) {
  const goods = result.goods;
  if (!goods?.id) return;
  mergeGoodsOptions([goods]);
  line.goodsId = goods.id;
  line.goodsSearchKeyword = '';
  await goodsChanged(line);
  quickCatalogVisible.value = false;
  ElMessage.success(`商品“${goods.goodsName}”已存在，已为你选择现有商品`);
}
async function requestQuickCatalog(line: any, goodsName: string) {
  const normalizedName = goodsName.trim();
  if (!normalizedName || quickCatalogChecking.value) return;
  quickCatalogChecking.value = true;
  try {
    const result = await globalGoodsAvailability(normalizedName);
    if (!result.exists) {
      openQuickCatalog(line, 'goods', normalizedName);
      return;
    }
    if (result.usable) await useExistingGlobalGoods(line, result);
    else await explainUnavailableGlobalGoods(result, normalizedName);
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message ?? '全局商品名称检查失败，请稍后重试');
  } finally {
    quickCatalogChecking.value = false;
  }
}
function openQuickCatalog(line: any, kind: 'goods' | 'sku', goodsName = '') {
  quickCatalogMode.value = kind;
  quickCatalogLine.value = line;
  Object.keys(quickCatalogForm).forEach((key) => delete quickCatalogForm[key]);
  const goods = options.goods.find((g: any) => String(g.id) === String(line.goodsId));
  Object.assign(quickCatalogForm, {
    goodsName,
    queryCode: '',
    categoryId: '',
    unitType: Number(line.unitType || goods?.unitType || 0) || '',
    specModels: '',
    costPrice: Number(line.unitPrice ?? 0),
    salePrice: 0,
    pcsQty: 1,
  });
  quickCatalogVisible.value = true;
}
async function stageQuickCatalog() {
  const line = quickCatalogLine.value;
  if (!line) return;
  if (quickCatalogMode.value === 'goods') {
    const goodsName = String(quickCatalogForm.goodsName ?? '').trim();
    if (!goodsName || !quickCatalogForm.categoryId || !quickCatalogForm.unitType) {
      ElMessage.warning('请填写商品名称、分类和基础单位');
      return;
    }
    quickCatalogChecking.value = true;
    let availability: any;
    try {
      availability = await globalGoodsAvailability(goodsName);
    } catch (e: any) {
      ElMessage.error(e.response?.data?.message ?? '全局商品名称检查失败，请稍后重试');
      quickCatalogChecking.value = false;
      return;
    }
    quickCatalogChecking.value = false;
    if (availability.exists) {
      if (availability.usable) await useExistingGlobalGoods(line, availability);
      else await explainUnavailableGlobalGoods(availability, goodsName);
      return;
    }
    const category = (options.categories ?? []).find(
      (item: any) => String(item.id) === String(quickCatalogForm.categoryId),
    );
    const token = `quick-goods-${Date.now()}-${Math.random()}`;
    line.newGoods = {
      goodsName,
      categoryId: quickCatalogForm.categoryId,
      unitType: Number(quickCatalogForm.unitType),
    };
    line.newSku = {
      specModels: '默认规格',
      unitType: Number(quickCatalogForm.unitType),
      pcsQty: 1,
      costPrice: 0,
      salePrice: 0,
    };
    line.goodsId = token;
    line.skuId = `${token}-sku`;
    line.categoryName = category?.name ?? '';
    line.categoryWarehouseType = Number(category?.warehouseType ?? 0);
    line.unitType = Number(quickCatalogForm.unitType);
    line.goodsSearchKeyword = '';
    line.skuOptions = [{ label: line.newSku.specModels, value: line.skuId }];
  } else {
    const specModels = String(quickCatalogForm.specModels ?? '').trim();
    if (!specModels || !quickCatalogForm.unitType) {
      ElMessage.warning('请填写 SKU 规格和单位');
      return;
    }
    const duplicate = (line.skuOptions ?? []).some(
      (item: any) =>
        String(item.label ?? '')
          .trim()
          .toLocaleLowerCase() === specModels.toLocaleLowerCase(),
    );
    if (duplicate) {
      ElMessage.warning('该 SKU 规格已存在，请直接选择已有 SKU');
      return;
    }
    line.newSku = { ...quickCatalogForm, specModels };
    line.skuId = `quick-sku-${Date.now()}-${Math.random()}`;
    line.unitType = Number(quickCatalogForm.unitType);
    line.skuOptions = [
      ...(line.skuOptions ?? []).filter(
        (item: any) => !String(item.value).startsWith('quick-sku-'),
      ),
      { label: specModels, value: line.skuId },
    ];
  }
  quickCatalogVisible.value = false;
}

// ---------- 明细行工具 ----------
function blankLine() {
  return {
    goodsId: '',
    skuId: '',
    skuOptions: [],
    categoryWarehouseType: 0,
    categoryName: '',
    goodsSearchKeyword: '',
    remoteGoods: [],
    goodsLoading: false,
    goodsSearchFailed: false,
    unitType: 0,
    unitPrice: 0,
    orderQuantity: 0,
    arrivedQuantity: 0,
    unarrivedQuantity: 0,
    inputtedQuantity: 0,
    uninputtedQuantity: 0,
    baseArrivedQuantity: 0,
    baseUnarrivedQuantity: 0,
    baseUninputtedQuantity: 0,
    remainingQuantity: 0,
    latestArrivalDate: '',
    inputQuantity: 1,
    batchNo: generateBatchNo(),
    position: '',
    productionDate: '',
    validityPeriod: '',
    arrivalDate: '',
    remark: '',
  };
}
function addLine() {
  (form.value.details ??= []).push(blankLine());
}
function removeLine(index: number) {
  form.value.details.splice(index, 1);
}
function goodsName(id: unknown) {
  return options.goods.find((g: any) => String(g.id) === String(id))?.goodsName ?? '—';
}
function skuText(line: any) {
  return (
    line.skuLabel ??
    line.skuName ??
    line.skuSpec ??
    (line.skuId ? `规格 ${line.skuId}` : '—')
  );
}
function unitName(line: any) {
  const unit = options.units.find((u: any) => String(u.value ?? u.id) === String(line.unitType));
  return unit?.label ?? unit?.name ?? '—';
}
function orgName(id: unknown) {
  const org = options.organizations.find((o: any) => String(o.value ?? o.id) === String(id));
  return org?.label ?? org?.name ?? '—';
}
function vendorName(id: unknown) {
  const vendor = options.vendors.find((v: any) => String(v.value ?? v.id) === String(id));
  return vendor?.label ?? vendor?.name ?? '—';
}
function vendorOfOrder(orderId: unknown) {
  const order = options.orders.find((o: any) => String(o.value ?? o.id) === String(orderId));
  return order?.vendorName ?? '';
}

async function enrichLine(line: any) {
  if (!line.goodsId || String(line.goodsId).startsWith('quick-')) return;
  const product = (await api.get(`/goods/${line.goodsId}`)) as any;
  mergeGoodsOptions([product]);
  line.categoryWarehouseType = Number(product.categoryWarehouseType ?? 0);
  line.categoryName = product.categoryName ?? line.categoryName;
  line.skuOptions = (product.skus ?? []).map((sku: any) => ({
    label: sku.specModels || sku.skuName || sku.skuNo || `规格 ${sku.id}`,
    value: sku.id,
    unitType: sku.unitType,
    costPrice: Number(sku.costPrice ?? product.costPrice ?? 0),
  }));
  if (!line.skuId && line.skuOptions.length) line.skuId = line.skuOptions[0].value;
  const selected = line.skuOptions.find((item: any) => String(item.value) === String(line.skuId));
  line.skuLabel = selected?.label;
  if (selected?.unitType) line.unitType = selected.unitType;
  else if (!Number(line.unitType) && product.unitType) line.unitType = product.unitType;
  if (isDirect.value && !Number(line.unitPrice))
    line.unitPrice = Number(selected?.costPrice ?? product.costPrice ?? 0);
}
async function goodsChanged(line: any) {
  delete line.newGoods;
  delete line.newSku;
  line.skuId = '';
  await enrichLine(line);
  const warehouse = filteredWarehouses.value.find(
    (item: any) => String(item.value) === String(form.value.warehouseId),
  );
  if (
    warehouse &&
    lineWarehouseType(line) &&
    optionWarehouseType(warehouse) !== lineWarehouseType(line)
  ) {
    form.value.warehouseId = '';
    ElMessage.warning('所选商品要求的仓库类型已变化，请重新选择同类型仓库');
  }
}

// ---------- 组织/仓库联动 ----------
async function loadOrganizationOptions(orgId: unknown) {
  const requestedOrgId = String(orgId ?? '');
  organizationOptions.orgId = '';
  organizationOptions.departments = [];
  organizationOptions.warehouses = [];
  if (!requestedOrgId) return;
  const [departments, warehouses] = (await Promise.all([
    api.get('/base-data/departments/options', { params: { orgId: requestedOrgId } }),
    api.get('/base-data/warehouses/options', { params: { orgId: requestedOrgId } }),
  ])) as any[];
  if (String(form.value.orgId ?? '') !== requestedOrgId) return;
  organizationOptions.orgId = requestedOrgId;
  organizationOptions.departments = departments ?? [];
  organizationOptions.warehouses = warehouses ?? [];
}
async function organizationChanged() {
  form.value.deptId = '';
  form.value.warehouseId = '';
  form.value.details = isDirect.value ? [blankLine()] : [];
  await loadOrganizationOptions(form.value.orgId);
}
function warehouseChanged() {
  const warehouse = filteredWarehouses.value.find(
    (item: any) => String(item.value) === String(form.value.warehouseId),
  );
  const type = optionWarehouseType(warehouse);
  const kept = (form.value.details ?? []).filter(
    (line: any) => !type || !lineWarehouseType(line) || lineWarehouseType(line) === type,
  );
  form.value.details = kept.length
    ? kept
    : isDirect.value
      ? [blankLine()]
      : [];
}

/** 切换来源方式：清空来源订单与单据级字段 */
function receiptSourceChanged() {
  form.value.orderId = '';
  form.value.details = isDirect.value ? [blankLine()] : [];
  form.value.orgId = '';
  form.value.deptId = '';
  form.value.warehouseId = '';
  form.value.vendorId = '';
  if (isDirect.value) loadOrganizationOptions('');
}

// ---------- 来源采购订单 ----------
async function sourceOrderChanged() {
  if (!form.value.orderId) {
    form.value.details = [];
    return;
  }
  const source: any = await api.get(`/purchase/orders/${form.value.orderId}`).catch(() => null);
  if (!source) return;
  const plannedWarehouseId = source.warehouseId ?? source.warehouse_id;
  Object.assign(form.value, {
    orgId: source.orgId ?? source.org_id ?? '',
    deptId: source.deptId ?? source.dept_id ?? '',
    warehouseId: '',
    vendorId: source.vendorId ?? source.vendor_id ?? '',
  });
  form.value.vendorName = vendorName(form.value.vendorId);
  form.value.details = (source.details ?? [])
    .filter((line: any) => Number(line.remainingQuantity ?? 0) > 0)
    .map((line: any) => ({
      ...blankLine(),
      ...line,
      orderQuantity: Number(line.quantity ?? 0),
      arrivedQuantity: Number(line.arrivedQuantity ?? 0),
      unarrivedQuantity: Number(line.unarrivedQuantity ?? line.remainingQuantity ?? 0),
      inputtedQuantity: Number(line.inputtedQuantity ?? 0),
      uninputtedQuantity: Number(line.uninputtedQuantity ?? 0),
      baseArrivedQuantity: Number(line.arrivedQuantity ?? 0),
      baseUnarrivedQuantity: Number(line.unarrivedQuantity ?? line.remainingQuantity ?? 0),
      baseUninputtedQuantity: Number(line.uninputtedQuantity ?? 0),
      remainingQuantity: Number(line.remainingQuantity ?? 0),
      inputQuantity: Number(line.remainingQuantity ?? 0),
      batchNo: generateBatchNo(),
    }));
  if (!form.value.details.length) ElMessage.warning('该订单没有剩余可入库商品');
  await Promise.all(form.value.details.map(enrichLine));
  if (form.value.orgId) await loadOrganizationOptions(form.value.orgId);
  const plannedWarehouse = filteredWarehouses.value.find(
    (item: any) => String(item.value) === String(plannedWarehouseId),
  );
  if (
    plannedWarehouse &&
    (!documentWarehouseType.value ||
      optionWarehouseType(plannedWarehouse) === documentWarehouseType.value)
  )
    form.value.warehouseId = plannedWarehouseId;
  else
    ElMessage.warning(
      '原采购订单的计划仓库与商品分类不匹配，请选择同组织、同仓库类型的实际入库仓库',
    );
}

// ---------- 供应商/采购订单远程搜索 ----------
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

// ---------- 校验与保存 ----------
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
    if (Number(line.inputQuantity) > Number(line.remainingQuantity ?? Infinity) && !isDirect.value) {
      ElMessage.warning('本次入库数量不能超过订单剩余可入数量');
      return false;
    }
    if (!String(line.batchNo ?? '').trim()) line.batchNo = generateBatchNo();
  }
  return true;
}
function detailPayload() {
  return (form.value.details ?? []).map((line: any) => ({
    goodsId: line.goodsId,
    skuId: line.skuId,
    inputQuantity: Number(line.inputQuantity),
    unitPrice: isDirect.value ? Number(line.unitPrice ?? 0) : undefined,
    unitType: line.unitType ?? 0,
    batchNo: line.batchNo,
    position: line.position ?? '',
    productionDate: line.productionDate || null,
    validityPeriod: line.validityPeriod || null,
    arrivalDate: line.arrivalDate || null,
    remark: line.remark ?? '',
    newGoods: line.newGoods,
    newSku: line.newSku,
  }));
}
async function doSave(): Promise<any | null> {
  if (!validate()) return null;
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
      details: detailPayload(),
    };
    const result: any =
      props.mode === 'edit'
        ? await api.patch(`${url}/${form.value.id}`, payload)
        : await api.post(url, payload);
    return result;
  } catch {
    // axios 拦截器已提示
    return null;
  } finally {
    saving.value = false;
  }
}
async function save() {
  const result = await doSave();
  if (!result) return;
  ElMessage.success(result?.message ?? '保存成功');
  emit('saved');
}
async function execute() {
  const result = await doSave();
  if (!result) return;
  try {
    await api.post(`/purchase/receipts/${result.id}/confirm`, {
      confirmed: true,
      comment: '办理采购入库',
    });
    ElMessage.success('采购入库办理完成，库存已增加');
    emit('saved');
  } catch {
    // confirm 失败时保持表单打开（单据已保存，可重试或另存草稿）
    ElMessage.warning('入库单已保存，但确认入库失败，请稍后重试');
  }
}

// ---------- 初始化 ----------
const dictCodes = ['purchase_input_type', 'warehouse_type'];
onMounted(async () => {
  const [orgs, depts, warehouses, vendors, goodsResult, categories, units, orders, ...dictionaries] =
    (await Promise.all([
      api.get('/base-data/organizations/options').catch(() => []),
      api.get('/base-data/departments/options').catch(() => []),
      api.get('/base-data/warehouses/options').catch(() => []),
      api.get('/base-data/vendors/options').catch(() => []),
      api.get('/goods', { params: { pageSize: 100, status: 1 } }).catch(() => ({ items: [] })),
      api.get('/goods/categories').catch(() => ({ items: [] })),
      api.get('/base-data/units/options').catch(() => []),
      api.get('/purchase/orders', { params: { pageSize: 100 } }).catch(() => ({ items: [] })),
      ...dictCodes.map((code) => api.get(`/dictionaries/${code}`).catch(() => [])),
    ])) as any[];
  options.organizations = orgs;
  options.departments = depts;
  options.warehouses = warehouses;
  options.vendors = vendors;
  options.goods = goodsResult.items ?? [];
  options.categories = categories.items ?? [];
  options.units = units;
  options.orders = (orders.items ?? []).map((item: any) => ({
    ...item,
    label: item.orderNo,
    value: item.id,
    vendorName: vendorName(item.vendorId ?? item.vendor_id),
  }));
  dictCodes.forEach((code, index) => {
    dicts[code] = dictionaries[index] ?? [];
  });

  if (props.mode === 'create') {
    Object.assign(form.value, {
      directReceipt: false,
      orgId: auth.user?.orgId ?? '',
      deptId: auth.user?.deptId ?? '',
      warehouseId: '',
      vendorId: '',
      receiverId: auth.user?.id ?? '',
      inputType: 1,
      inputDate: dateText(new Date()),
      remark: '',
      details: [],
    });
    if (form.value.orgId) await loadOrganizationOptions(form.value.orgId);
  } else if (form.value.id) {
    const detail: any = await api.get(`/purchase/receipts/${form.value.id}`).catch(() => null);
    if (detail) {
      Object.assign(form.value, detail);
      form.value.details = (form.value.details ?? []).map((line: any) => ({
        ...blankLine(),
        ...line,
        batchNo: String(line.batchNo ?? '').trim() || generateBatchNo(),
      }));
      await Promise.all(form.value.details.map((line: any) => enrichLine(line)));
      if (form.value.orgId) await loadOrganizationOptions(form.value.orgId);
    }
  }
});
</script>

<template>
  <el-form label-position="top" :disabled="isView">
    <div class="form-grid master-grid">
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

      <el-form-item label="所属组织" :required="isDirect">
        <el-tree-select
          v-if="isDirect"
          v-model="form.orgId"
          :data="organizationTree"
          filterable
          check-strictly
          node-key="value"
          :props="{ label: 'label', children: 'children' }"
          placeholder="请选择所属组织"
          @change="organizationChanged"
        />
        <el-input v-else :model-value="orgName(form.orgId)" readonly />
      </el-form-item>

      <el-form-item label="实际入库仓库" required>
        <el-select
          v-model="form.warehouseId"
          filterable
          :disabled="!form.orgId || isView"
          placeholder="请选择同类型仓库"
          @change="warehouseChanged"
        >
          <el-option
            v-for="item in compatibleWarehouses"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="供应商" :required="isDirect">
        <RemoteSelect
          v-if="isDirect"
          v-model="form.vendorId"
          :fetch="searchVendorOptions"
          :current-label="vendorName(form.vendorId)"
          clearable
          placeholder="输入供应商名称搜索"
        />
        <el-input
          v-else
          :model-value="form.vendorId ? vendorName(form.vendorId) : vendorOfOrder(form.orderId)"
          readonly
        />
      </el-form-item>

      <el-form-item label="接收部门" required>
        <el-select v-model="form.deptId" :disabled="!form.orgId || isView">
          <el-option
            v-for="item in filteredDepartments"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="收货经办人">
        <el-input :model-value="auth.user?.username || '—'" readonly />
      </el-form-item>

      <el-form-item label="入库类型">
        <el-select v-model="form.inputType" :disabled="isView">
          <el-option
            v-for="item in dicts.purchase_input_type"
            :key="item.value"
            :label="item.label"
            :value="Number(item.value)"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="入库日期">
        <el-input
          :model-value="
            isView ? dateText(form.inputDate ?? form.createdAt) : dateText(new Date())
          "
          readonly
        />
      </el-form-item>

      <el-alert
        v-if="isDirect"
        class="span-2"
        type="warning"
        :closable="false"
        title="确认临时采购入库时，系统会反向生成已审批采购申请和采购订单。"
      />
    </div>

    <!-- 订单入库：卡片式明细 -->
    <PurchaseReceiptDetails
      v-if="!isDirect"
      :details="form.details ?? []"
      :units="options.units"
      :readonly="isView"
    />

    <!-- 临时入库：内联明细表格 -->
    <template v-else>
      <div class="section-title">
        <div>
          <strong>临时采购入库明细</strong
          ><span class="muted">共 {{ form.details?.length ?? 0 }} 项</span>
        </div>
      </div>
      <el-table :data="form.details" border class="detail-table direct-receipt-table">
        <el-table-column label="商品名称" min-width="220">
          <template #default="s">
            <div v-if="!isView" class="quick-catalog-cell">
              <el-select
                v-model="s.row.goodsId"
                filterable
                remote
                :remote-method="(keyword: string) => remoteSearchGoods(s.row, keyword)"
                :loading="s.row.goodsLoading"
                placeholder="输入商品名称搜索"
                @change="goodsChanged(s.row)"
              >
                <el-option
                  v-if="s.row.newGoods"
                  :label="s.row.newGoods.goodsName"
                  :value="s.row.goodsId"
                />
                <el-option
                  v-for="item in searchedGoods(s.row)"
                  :key="item.id"
                  :label="`${item.queryCode || ''} ${item.goodsName}`"
                  :value="item.id"
                />
                <template #empty>
                  <div class="goods-select-empty">
                    <span v-if="s.row.goodsSearchFailed">商品搜索失败，请重新输入</span>
                    <span v-else-if="!quickGoodsName(s.row)">请输入商品名称进行搜索</span>
                    <el-button
                      v-else
                      link
                      type="primary"
                      :loading="quickCatalogChecking"
                      @click.stop="requestQuickCatalog(s.row, quickGoodsName(s.row))"
                    >
                      新增“{{ quickGoodsName(s.row) }}”
                    </el-button>
                  </div>
                </template>
              </el-select>
              <el-tag v-if="s.row.newGoods" type="warning" size="small">待创建</el-tag>
            </div>
            <span v-else class="readonly-cell">{{ goodsName(s.row.goodsId) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="规格" min-width="140">
          <template #default="s">
            <el-select
              v-if="!isView"
              v-model="s.row.skuId"
              filterable
              @change="enrichLine(s.row)"
            >
              <el-option
                v-for="item in s.row.skuOptions"
                :key="item.value"
                :label="item.label"
                :value="item.value"
              />
            </el-select>
            <span v-else class="readonly-cell">{{ skuText(s.row) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="实收数量" width="120" align="right">
          <template #default="s">
            <el-input-number
              v-if="!isView"
              v-model="s.row.inputQuantity"
              :min="1"
              :precision="0"
              :step="1"
              controls-position="right"
            />
            <span v-else class="readonly-cell number-cell">{{ s.row.inputQuantity }}</span>
          </template>
        </el-table-column>
        <el-table-column label="采购单价" width="120" align="right">
          <template #default="s">
            <el-input-number
              v-if="!isView && canEditAmount"
              v-model="s.row.unitPrice"
              :min="0"
              :precision="2"
              controls-position="right"
            />
            <span v-else class="readonly-cell number-cell">¥ {{ moneyText(s.row.unitPrice) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="批号" width="140">
          <template #default="s">
            <el-input
              v-if="!isView"
              v-model="s.row.batchNo"
              placeholder="系统自动生成"
            />
            <span v-else class="readonly-cell">{{ display(s.row.batchNo) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="库位" width="110">
          <template #default="s">
            <el-input v-if="!isView" v-model="s.row.position" />
            <span v-else class="readonly-cell">{{ display(s.row.position) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="生产日期" width="140">
          <template #default="s">
            <el-date-picker
              v-if="!isView"
              v-model="s.row.productionDate"
              value-format="YYYY-MM-DD"
            />
            <span v-else class="readonly-cell">{{ dateText(s.row.productionDate) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="有效期" width="140">
          <template #default="s">
            <el-date-picker
              v-if="!isView"
              v-model="s.row.validityPeriod"
              value-format="YYYY-MM-DD"
            />
            <span v-else class="readonly-cell">{{ dateText(s.row.validityPeriod) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="备注" min-width="120">
          <template #default="s">
            <el-input v-if="!isView" v-model="s.row.remark" />
            <span v-else class="readonly-cell">{{ display(s.row.remark) }}</span>
          </template>
        </el-table-column>
        <el-table-column v-if="!isView" label="操作" width="90" fixed="right" align="center">
          <template #default="s">
            <el-button
              link
              type="danger"
              :disabled="(form.details ?? []).length === 1"
              @click="removeLine(s.$index)"
              >删除</el-button
            >
          </template>
        </el-table-column>
      </el-table>
      <el-button v-if="!isView" class="add-line" @click="addLine">添加明细行</el-button>
    </template>

    <div v-if="!isView" class="form-actions">
      <el-button @click="emit('cancel')">取消</el-button>
      <el-button :loading="saving" @click="save">保存</el-button>
      <el-button type="primary" :loading="saving" @click="execute">执行入库</el-button>
    </div>
  </el-form>

  <!-- 快捷新增商品/SKU 弹窗 -->
  <el-dialog
    v-model="quickCatalogVisible"
    :title="quickCatalogMode === 'goods' ? '快捷新增商品' : '单据内补充 SKU'"
    width="620"
    append-to-body
  >
    <el-alert
      title="当前内容仅暂存在单据行中；保存或提交单据成功时才会创建正式商品/SKU档案。"
      type="info"
      :closable="false"
      style="margin-bottom: 14px"
    />
    <el-form label-position="top">
      <div class="master-grid">
        <el-form-item v-if="quickCatalogMode === 'goods'" label="商品名称" required>
          <el-input v-model="quickCatalogForm.goodsName" />
        </el-form-item>
        <el-form-item v-if="quickCatalogMode === 'goods'" label="商品分类" required>
          <el-tree-select
            v-model="quickCatalogForm.categoryId"
            :data="quickCategoryTree"
            :props="quickCategoryTreeProps"
            filterable
            check-strictly
            default-expand-all
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="基础单位" required>
          <el-select v-model="quickCatalogForm.unitType" filterable style="width: 100%">
            <el-option
              v-for="item in options.units"
              :key="item.value"
              :label="item.label"
              :value="Number(item.value)"
            />
          </el-select>
        </el-form-item>
        <el-form-item v-if="quickCatalogMode === 'sku'" label="SKU规格">
          <el-input v-model="quickCatalogForm.specModels" placeholder="留空则使用“默认规格”" />
        </el-form-item>
        <el-form-item v-if="quickCatalogMode === 'sku'" label="每业务单位基础件数" required>
          <el-input-number
            v-model="quickCatalogForm.pcsQty"
            :min="1"
            :precision="0"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item v-if="quickCatalogMode === 'sku'" label="基础件成本">
          <el-input-number
            v-model="quickCatalogForm.costPrice"
            :disabled="!canEditAmount"
            :min="0"
            :precision="2"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item v-if="quickCatalogMode === 'sku'" label="销售价">
          <el-input-number
            v-model="quickCatalogForm.salePrice"
            :disabled="!canEditAmount"
            :min="0"
            :precision="2"
            style="width: 100%"
          />
        </el-form-item>
      </div>
    </el-form>
    <template #footer>
      <el-button @click="quickCatalogVisible = false">取消</el-button>
      <el-button type="primary" :loading="quickCatalogChecking" @click="stageQuickCatalog"
        >暂存到单据行</el-button
      >
    </template>
  </el-dialog>
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
  line-height: var(--hs-line-section);
}
.section-title strong {
  font-size: var(--hs-font-section);
  font-weight: 600;
}
.muted {
  color: #8791a5;
  font-size: var(--hs-font-helper);
  font-weight: 400;
}
.detail-table {
  width: 100%;
  font-size: var(--hs-font-body);
  line-height: var(--hs-line-body);
}
.detail-table :deep(th.el-table__cell) {
  height: var(--hs-detail-header-height);
  padding: 0;
  background: #f7f9fc;
  color: #667085;
  font-size: var(--hs-font-label);
  font-weight: 600;
}
.detail-table :deep(td.el-table__cell) {
  height: var(--hs-detail-row-height);
  padding: 4px 0;
  color: #344054;
  font-size: var(--hs-font-body);
}
.detail-table :deep(.el-select),
.detail-table :deep(.el-input-number),
.detail-table :deep(.el-date-editor) {
  width: 100%;
  margin: 0;
}
.readonly-cell {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.number-cell {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.quick-catalog-cell {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}
.quick-catalog-cell .el-select {
  width: 100%;
}
.goods-select-empty {
  padding: 8px 12px;
  color: #8791a5;
  font-size: var(--hs-font-helper);
  text-align: center;
}
.add-line {
  height: var(--hs-control-height);
  margin-top: 10px;
  font-size: var(--hs-font-body);
}
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>
