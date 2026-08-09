<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { api } from '@/api';
import DocumentAttachments from '@/components/DocumentAttachments.vue';
import { useAuthStore } from '@/stores/auth';
import { dateText, moneyText } from '@/utils/format';
import { generateBatchNo } from '@/utils/batch-number';

type Row = Record<string, any>;
type Option = { value: string | number; label: string; raw?: Row };

const route = useRoute();
const auth = useAuthStore();
const resource = computed(() => String(route.params.resource));
const isInput = computed(() => resource.value === 'general-inputs');
const title = computed(() => (isInput.value ? '通用入库单' : '通用出库单'));
const rows = ref<Row[]>([]);
const total = ref(0);
const loading = ref(false);
const saving = ref(false);
const dialog = ref(false);
const viewing = ref(false);
const initialInputEnabled = ref(false);
const canManageInitialInput = computed(
  () => auth.user?.permissions.includes('*') || auth.user?.permissions.includes('system:update'),
);
const organizations = ref<Option[]>([]);
const warehouses = ref<Option[]>([]);
const departments = ref<Option[]>([]);
const users = ref<Option[]>([]);
const products = ref<Row[]>([]);
const stocks = ref<Row[]>([]);
const query = reactive<Row>({ page: 1, pageSize: 20, keyword: '', orgId: '', warehouseId: '' });
const form = reactive<Row>({});

const filteredWarehouses = computed(() =>
  warehouses.value.filter((item) => !form.orgId || String(item.raw?.orgId) === String(form.orgId)),
);
const filteredDepartments = computed(() =>
  departments.value.filter(
    (item) => !form.orgId || !item.raw?.orgId || String(item.raw.orgId) === String(form.orgId),
  ),
);
const lineTotalPieces = (line: Row) => Number(line.quantity || 0) * Number(line.piecesPerUnit || 0);
const totalPieces = computed(() =>
  (form.lines ?? []).reduce((sum: number, line: Row) => sum + lineTotalPieces(line), 0),
);
const totalAmount = computed(() =>
  isInput.value
    ? (form.lines ?? []).reduce(
        (sum: number, line: Row) => sum + lineTotalPieces(line) * Number(line.baseCost || 0),
        0,
      )
    : 0,
);

const businessTypeName = (value: string) =>
  ({ initial: '初期入库', entrusted_purchase: '委托采购入库', direct_output: '直接出库' })[value] ??
  value;

async function loadOptions() {
  const [orgs, warehouseRows, departmentRows, userRows, config] = (await Promise.all([
    api.get('/base-data/organizations/options'),
    api.get('/base-data/warehouses/options'),
    api.get('/base-data/departments/options'),
    api.get('/inventory/users/options'),
    api.get('/inventory/general-orders/config'),
  ])) as any[];
  organizations.value = orgs;
  warehouses.value = warehouseRows;
  departments.value = departmentRows;
  users.value = userRows;
  initialInputEnabled.value = Boolean(config.initialInputEnabled);
}

async function load() {
  loading.value = true;
  try {
    const data = (await api.get(`/inventory/${resource.value}`, { params: query })) as Row;
    rows.value = data.items;
    total.value = data.total;
  } finally {
    loading.value = false;
  }
}

function resetForm() {
  Object.assign(form, {
    businessType: isInput.value
      ? initialInputEnabled.value
        ? 'initial'
        : 'entrusted_purchase'
      : 'direct_output',
    requestKey: crypto.randomUUID(),
    businessDate: dateText(new Date()),
    orgId: auth.user?.orgId ?? '',
    warehouseId: '',
    departmentId: auth.user?.deptId ?? '',
    handlerId: auth.user?.id ?? '',
    remark: '',
    lines: [],
  });
  products.value = [];
  stocks.value = [];
}

async function loadSelectableRows() {
  form.lines = [];
  if (!form.orgId || !form.warehouseId) return;
  products.value = (await api.get('/inventory/general-orders/product-options', {
    params: { orgId: form.orgId, warehouseId: form.warehouseId },
  })) as Row[];
  stocks.value = isInput.value
    ? []
    : ((await api.get('/inventory/stock-options', {
        params: { orgId: form.orgId, warehouseId: form.warehouseId },
      })) as Row[]);
}

function addLine() {
  form.lines.push({
    selectKey: '',
    goodsId: '',
    skuId: '',
    batchNo: isInput.value ? generateBatchNo() : '',
    quantity: 1,
    piecesPerUnit: 1,
    documentUnitName: '',
    piecesUnitName: '',
    baseCost: 0,
    custodianId: '',
    storageLocation: '',
  });
}

function selectableKey(item: Row) {
  return isInput.value
    ? `${item.goodsId}:${item.skuId}`
    : `${item.goodsId}:${item.skuId}:${item.batchNo ?? ''}`;
}

function selectableLabel(item: Row) {
  const stockText = isInput.value
    ? ''
    : ` · 批次 ${item.batchNo || '无'} · 可用 ${item.inventoryQty}`;
  return `${item.goodsCode || ''} ${item.goodsName} · ${item.skuSpec || '默认规格'}${stockText}`;
}

function selectProduct(line: Row) {
  const source = (isInput.value ? products.value : stocks.value).find(
    (item) => selectableKey(item) === line.selectKey,
  );
  if (!source) return;
  const product = products.value.find(
    (item) =>
      String(item.goodsId) === String(source.goodsId) &&
      String(item.skuId) === String(source.skuId),
  );
  Object.assign(line, {
    goodsId: source.goodsId,
    skuId: source.skuId,
    goodsName: source.goodsName,
    skuSpec: source.skuSpec,
    batchNo: isInput.value ? line.batchNo : source.batchNo,
    piecesPerUnit: Number(product?.piecesPerUnit ?? 0),
    documentUnitName: product?.documentUnitName ?? '',
    piecesUnitName: product?.piecesUnitName ?? source.unitName ?? '',
    baseCost: Number(product?.baseCost ?? source.unitPrice ?? 0),
    inventoryQty: source.inventoryQty,
    maxDocumentQuantity: isInput.value
      ? undefined
      : Math.floor(Number(source.inventoryQty ?? 0) / Number(product?.piecesPerUnit ?? 1)),
  });
}

async function openCreate() {
  resetForm();
  dialog.value = true;
  viewing.value = false;
}

async function openView(row: Row) {
  const data = (await api.get(`/inventory/${resource.value}/${row.id}`)) as Row;
  Object.assign(form, data);
  viewing.value = true;
  dialog.value = true;
}

async function save() {
  if (!form.orgId || !form.warehouseId) return ElMessage.warning('请选择组织和仓库');
  if (!form.lines?.length) return ElMessage.warning('至少添加一条明细');
  if (
    form.lines.some(
      (line: Row) =>
        !line.goodsId || !Number.isInteger(Number(line.quantity)) || Number(line.quantity) <= 0,
    )
  )
    return ElMessage.warning('请选择商品，并填写正整数数量');
  saving.value = true;
  try {
    const result = (await api.post(`/inventory/${resource.value}`, form)) as Row;
    ElMessage.success(`${result.message}：${result.businessNo}`);
    dialog.value = false;
    await load();
  } finally {
    saving.value = false;
  }
}

async function toggleInitialInput(value: boolean) {
  const result = (await api.patch('/inventory/general-orders/config/initial-input', {
    enabled: value,
  })) as Row;
  initialInputEnabled.value = Boolean(result.initialInputEnabled);
  ElMessage.success(result.message);
}

watch(resource, async () => {
  query.page = 1;
  await load();
});
onMounted(async () => {
  await Promise.all([loadOptions(), load()]);
});
</script>

<template>
  <section class="page-shell">
    <header class="page-header">
      <div>
        <h2>{{ title }}</h2>
        <p>单据保存后立即完成库存过账，不进入审批流程。</p>
      </div>
      <div class="header-actions">
        <template v-if="isInput">
          <span>初期入库</span>
          <el-switch
            :model-value="initialInputEnabled"
            :disabled="!canManageInitialInput"
            @change="toggleInitialInput"
          />
        </template>
        <el-button type="primary" @click="openCreate">新增{{ title }}</el-button>
      </div>
    </header>
    <el-card shadow="never">
      <div class="filters">
        <el-input v-model="query.keyword" clearable placeholder="业务单号" @keyup.enter="load" />
        <el-select v-model="query.orgId" clearable placeholder="组织">
          <el-option
            v-for="item in organizations"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
        <el-select v-model="query.warehouseId" clearable placeholder="仓库">
          <el-option
            v-for="item in warehouses"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
        <el-button type="primary" @click="load">查询</el-button>
      </div>
      <el-table :data="rows" v-loading="loading">
        <el-table-column type="index" label="序号" width="65" />
        <el-table-column prop="id" label="ID" width="100" />
        <el-table-column prop="businessNo" label="单号" min-width="180" />
        <el-table-column label="类型" width="130"
          ><template #default="s">{{
            businessTypeName(s.row.businessType)
          }}</template></el-table-column
        >
        <el-table-column prop="businessDate" label="业务日期" width="120"
          ><template #default="s">{{ dateText(s.row.businessDate) }}</template></el-table-column
        >
        <el-table-column prop="orgName" label="组织" min-width="130" />
        <el-table-column prop="warehouseName" label="仓库" min-width="130" />
        <el-table-column prop="totalPieces" label="基础件数" width="110" align="right" />
        <el-table-column label="金额" width="120" align="right"
          ><template #default="s">{{ moneyText(s.row.totalAmount) }}</template></el-table-column
        >
        <el-table-column prop="handlerName" label="经办人" width="100" />
        <el-table-column label="操作" width="90"
          ><template #default="s"
            ><el-button link type="primary" @click="openView(s.row)">查看</el-button></template
          ></el-table-column
        >
      </el-table>
      <el-pagination
        v-model:current-page="query.page"
        v-model:page-size="query.pageSize"
        :total="total"
        layout="total, prev, pager, next"
        @change="load"
      />
    </el-card>

    <el-dialog
      v-model="dialog"
      :title="viewing ? `查看${title}` : `新增${title}`"
      width="90%"
      top="5vh"
    >
      <el-form label-position="top" :disabled="viewing">
        <div class="master-grid">
          <el-form-item label="业务类型" required>
            <el-select v-model="form.businessType">
              <template v-if="isInput">
                <el-option label="初期入库" value="initial" :disabled="!initialInputEnabled" />
                <el-option label="委托采购入库" value="entrusted_purchase" />
              </template>
              <el-option v-else label="直接出库" value="direct_output" />
            </el-select>
          </el-form-item>
          <el-form-item label="业务日期" required
            ><el-date-picker v-model="form.businessDate" type="date" value-format="YYYY-MM-DD"
          /></el-form-item>
          <el-form-item label="组织" required
            ><el-select v-model="form.orgId" filterable @change="loadSelectableRows"
              ><el-option
                v-for="item in organizations"
                :key="item.value"
                :label="item.label"
                :value="item.value" /></el-select
          ></el-form-item>
          <el-form-item label="仓库" required
            ><el-select v-model="form.warehouseId" filterable @change="loadSelectableRows"
              ><el-option
                v-for="item in filteredWarehouses"
                :key="item.value"
                :label="item.label"
                :value="item.value" /></el-select
          ></el-form-item>
          <el-form-item label="使用部门"
            ><el-select v-model="form.departmentId" clearable filterable
              ><el-option
                v-for="item in filteredDepartments"
                :key="item.value"
                :label="item.label"
                :value="item.value" /></el-select
          ></el-form-item>
          <el-form-item label="经办人"
            ><el-select v-model="form.handlerId" filterable
              ><el-option
                v-for="item in users"
                :key="item.value"
                :label="item.label"
                :value="item.value" /></el-select
          ></el-form-item>
        </div>
        <div class="line-title">
          <strong>明细</strong
          ><el-button v-if="!viewing" type="primary" plain @click="addLine">添加明细</el-button>
        </div>
        <el-table :data="form.lines" border>
          <el-table-column type="index" width="55" />
          <el-table-column label="商品 / SKU / 批次" min-width="300">
            <template #default="s">
              <span v-if="viewing"
                >{{ s.row.goodsCode }} {{ s.row.goodsName }} · {{ s.row.skuSpec || '默认规格' }} ·
                {{ s.row.batchNo || '无批次' }}</span
              >
              <el-select v-else v-model="s.row.selectKey" filterable @change="selectProduct(s.row)">
                <el-option
                  v-for="item in isInput ? products : stocks"
                  :key="selectableKey(item)"
                  :label="selectableLabel(item)"
                  :value="selectableKey(item)"
                />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column v-if="isInput" label="批次" width="130"
            ><template #default="s"><el-input v-model="s.row.batchNo" /></template
          ></el-table-column>
          <el-table-column label="单据数量" width="130"
            ><template #default="s"
              ><el-input-number
                v-model="s.row.quantity"
                :min="1"
                :max="s.row.maxDocumentQuantity"
                :precision="0" /></template
          ></el-table-column>
          <el-table-column label="换算" width="180"
            ><template #default="s"
              >1 {{ s.row.documentUnitName }} = {{ s.row.piecesPerUnit }}
              {{ s.row.piecesUnitName }}</template
            ></el-table-column
          >
          <el-table-column label="基础件数" width="110" align="right"
            ><template #default="s">{{
              viewing ? s.row.piecesQuantity : lineTotalPieces(s.row)
            }}</template></el-table-column
          >
          <el-table-column label="基础件成本" width="140"
            ><template #default="s"
              ><el-input-number
                v-if="isInput && !viewing"
                v-model="s.row.baseCost"
                :min="0"
                :precision="4"
              /><span v-else>{{ moneyText(s.row.baseCost) }}</span></template
            ></el-table-column
          >
          <el-table-column label="金额" width="120" align="right"
            ><template #default="s">{{
              moneyText(
                viewing ? s.row.amount : isInput ? lineTotalPieces(s.row) * s.row.baseCost : 0,
              )
            }}</template></el-table-column
          >
          <el-table-column label="使用人" width="150"
            ><template #default="s"
              ><el-select v-model="s.row.custodianId" clearable filterable
                ><el-option
                  v-for="item in users"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value" /></el-select></template
          ></el-table-column>
          <el-table-column label="库位 / 所在位置" min-width="170"
            ><template #default="s"><el-input v-model="s.row.storageLocation" /></template
          ></el-table-column>
          <el-table-column v-if="!viewing" label="操作" width="80"
            ><template #default="s"
              ><el-button link type="danger" @click="form.lines.splice(s.$index, 1)"
                >删除</el-button
              ></template
            ></el-table-column
          >
        </el-table>
        <div class="totals">
          基础件数合计：{{ viewing ? form.totalPieces : totalPieces
          }}<template v-if="isInput"
            >　金额合计：{{ moneyText(viewing ? form.totalAmount : totalAmount) }}</template
          >
        </div>
        <el-form-item label="备注"><el-input v-model="form.remark" type="textarea" /></el-form-item>
      </el-form>
      <DocumentAttachments
        v-if="viewing && form.id"
        document-type="inventory_general_order"
        :document-id="form.id"
      />
      <template #footer
        ><el-button @click="dialog = false">关闭</el-button
        ><el-button v-if="!viewing" type="primary" :loading="saving" @click="save"
          >保存并过账</el-button
        ></template
      >
    </el-dialog>
  </section>
</template>

<style scoped>
.page-shell {
  padding: 20px;
}
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.page-header h2 {
  margin: 0 0 6px;
}
.page-header p {
  margin: 0;
  color: #909399;
}
.header-actions,
.filters,
.line-title {
  display: flex;
  align-items: center;
  gap: 12px;
}
.filters {
  margin-bottom: 16px;
}
.filters > * {
  width: 200px;
}
.master-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0 16px;
}
.line-title {
  justify-content: space-between;
  margin: 12px 0;
}
.totals {
  text-align: right;
  font-weight: 600;
  margin: 14px 0;
}
.el-pagination {
  margin-top: 16px;
  justify-content: flex-end;
}
@media (max-width: 900px) {
  .master-grid {
    grid-template-columns: 1fr;
  }
  .page-header {
    align-items: flex-start;
    gap: 12px;
    flex-direction: column;
  }
}
</style>
