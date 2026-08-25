<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { dateText } from '@/utils/format';
import { buildOrganizationTree, type OrganizationTreeNode } from '@/utils/organization-tree';
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
  outWarehouses: [],
  inWarehouses: [],
  users: [],
  units: [],
  stocks: [],
});

const isView = computed(() => props.mode === 'view');
const organizationTree = computed(() =>
  buildOrganizationTree(options.orgs as OrganizationTreeNode[]),
);

/** 按组织加载仓库选项（走后端），组织为空时清空 */
async function loadWarehousesByOrg(target: 'out' | 'in', orgId: unknown) {
  if (!orgId) {
    options[target === 'out' ? 'outWarehouses' : 'inWarehouses'] = [];
    return;
  }
  options[target === 'out' ? 'outWarehouses' : 'inWarehouses'] = (await api
    .get('/base-data/warehouses/options', { params: { orgId: String(orgId) } })
    .catch(() => [])) as any[];
}
/** 调入仓库：调入组织范围内，排除调出仓库本身，并按「调出仓库 + 明细商品」类型过滤同类型仓库 */
const optionWarehouseType = (item: any) =>
  Number(item?.warehouseType ?? item?.raw?.warehouseType ?? 0);
const inWarehouses = computed(() => {
  const requiredTypes = new Set(
    (form.value.details ?? [])
      .map((line: any) => Number(line.categoryWarehouseType))
      .filter((value: number) => Number.isFinite(value) && value > 0),
  );
  const source = (options.outWarehouses ?? []).find(
    (item: any) => String(item.value) === String(form.value.warehouseId),
  );
  const sourceType = optionWarehouseType(source);
  if (sourceType > 0) requiredTypes.add(sourceType);
  return (options.inWarehouses ?? []).filter((item: any) => {
    const isCurrentViewValue = isView.value && String(item.value) === String(form.value.toWarehouseId);
    const differentWarehouse = String(item.value) !== String(form.value.warehouseId);
    const matchesType =
      !requiredTypes.size || requiredTypes.has(optionWarehouseType(item));
    return isCurrentViewValue || (differentWarehouse && matchesType);
  });
});

function blankLine() {
  return {
    stockKey: '',
    goodsId: '',
    goodsCode: '',
    goodsName: '',
    skuId: '',
    skuSpec: '',
    batchNo: '',
    unitType: 0,
    unitName: '',
    inventoryQty: 0,
    quantity: 1,
    remark: '',
  };
}

function unitName(line: any) {
  const unit = (options.units ?? []).find(
    (u: any) => String(u.value ?? u.id) === String(line.unitType),
  );
  return unit?.label ?? unit?.name ?? '—';
}

function stockKeyOf(stock: any) {
  return `${stock.goodsId}-${stock.skuId}-${stock.warehouseId}-${stock.batchNo ?? ''}`;
}

function lineStocks(line: any) {
  return (options.stocks ?? []).filter(
    (s: any) =>
      (!line.goodsId || String(s.goodsId) === String(line.goodsId)) &&
      (!form.value.warehouseId || String(s.warehouseId) === String(form.value.warehouseId)),
  );
}

function stockChanged(line: any) {
  const stock = (options.stocks ?? []).find(
    (s: any) => stockKeyOf(s) === line.stockKey,
  );
  if (!stock) return;
  Object.assign(line, {
    goodsId: stock.goodsId,
    goodsCode: stock.goodsCode,
    goodsName: stock.goodsName,
    categoryWarehouseType: stock.categoryWarehouseType,
    skuId: stock.skuId,
    skuSpec: stock.skuSpec,
    batchNo: stock.batchNo ?? '',
    unitType: stock.unitType,
    unitName: stock.unitName,
    inventoryQty: Number(stock.inventoryQty ?? 0),
  });
}

async function searchGoodsOptions(keyword: string) {
  // 商品选项取自调出仓库库存（stock-options 已按 orgId+warehouseId 后端过滤），未选仓库时为空
  const kw = String(keyword ?? '').trim().toLowerCase();
  const seen = new Map<string, any>();
  for (const s of options.stocks ?? []) {
    if (
      form.value.warehouseId &&
      String(s.warehouseId) !== String(form.value.warehouseId)
    )
      continue;
    if (kw && !`${s.goodsCode ?? ''} ${s.goodsName ?? ''}`.toLowerCase().includes(kw)) continue;
    if (!seen.has(String(s.goodsId))) seen.set(String(s.goodsId), s);
  }
  return [...seen.values()].map((s: any) => ({
    value: s.goodsId,
    label: `${s.goodsCode || ''} ${s.goodsName || ''}`.trim(),
  }));
}

async function loadStocks() {
  if (!form.value.orgId || !form.value.warehouseId) {
    options.stocks = [];
    return;
  }
  options.stocks = (await api
    .get('/inventory/stock-options', {
      params: { orgId: form.value.orgId, warehouseId: form.value.warehouseId },
    })
    .catch(() => [])) as any[];
}

async function lineGoodsChanged(line: any) {
  if (!line.goodsId) return;
  const g: any = await api.get(`/goods/${line.goodsId}`);
  const sku = (g.skus ?? []).find((x: any) => x.isDefault === 1) ?? g.skus?.[0];
  line.skuId = sku?.id ?? '';
  line.unitType = sku?.unitType ?? 0;
  line.goodsCode = g.queryCode ?? '';
  line.goodsName = g.goodsName ?? '';
  line.skuSpec = sku?.specModels ?? '';
  line.stockKey = '';
}

function addLine() {
  (form.value.details ??= []).push(blankLine());
}
function removeLine(index: number) {
  form.value.details.splice(index, 1);
}

function validate() {
  if (
    !form.value.orgId ||
    !form.value.warehouseId ||
    !form.value.toOrgId ||
    !form.value.toWarehouseId
  ) {
    ElMessage.warning('请选择调出/调入组织及仓库');
    return false;
  }
  if (!form.value.sendBy || !form.value.receiveBy) {
    ElMessage.warning('请选择发出人和接收人');
    return false;
  }
  const lines = form.value.details ?? [];
  if (!lines.length) {
    ElMessage.warning('请至少添加一条调拨明细');
    return false;
  }
  for (const line of lines) {
    if (!line.goodsId || !line.skuId || !line.stockKey) {
      ElMessage.warning('请选择完整的商品与库存批次');
      return false;
    }
    if (Number(line.quantity) <= 0) {
      ElMessage.warning('调拨数量必须大于 0');
      return false;
    }
    if (Number(line.quantity) > Number(line.inventoryQty ?? 0)) {
      ElMessage.warning(`${line.goodsName || '商品'} 调拨数量超过当前库存`);
      return false;
    }
  }
  return true;
}

async function save() {
  if (!validate()) return;
  saving.value = true;
  try {
    const url = '/inventory/transfers';
    const payload: Record<string, any> = {
      orgId: form.value.orgId,
      warehouseId: form.value.warehouseId,
      toOrgId: form.value.toOrgId,
      toWarehouseId: form.value.toWarehouseId,
      sendBy: form.value.sendBy,
      receiveBy: form.value.receiveBy,
      reason: form.value.reason,
      transferDate: form.value.transferDate,
      remark: form.value.remark,
      details: (form.value.details ?? []).map((line: any) => ({
        goodsId: line.goodsId,
        skuId: line.skuId,
        batchNo: line.batchNo ?? '',
        unitType: line.unitType,
        quantity: line.quantity,
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
  const [orgs, users, units, stocks] = await Promise.all([
    api.get('/base-data/organizations/options').catch(() => []),
    api.get('/base-data/employees/options').catch(() => []),
    api.get('/base-data/units/options').catch(() => []),
    api.get('/inventory/stock-options').catch(() => []),
  ]);
  options.orgs = orgs;
  options.users = users;
  options.units = units;
  options.stocks = stocks;

  if (props.mode === 'create') {
    Object.assign(form.value, {
      orgId: auth.user?.orgId ?? '',
      warehouseId: '',
      toOrgId: auth.user?.orgId ?? '',
      toWarehouseId: '',
      sendBy: '',
      receiveBy: '',
      transferDate: dateText(new Date()),
      reason: '',
      remark: '',
      details: [blankLine()],
    });
  } else if (form.value.id) {
    const detail: any = await api
      .get(`/inventory/transfers/${form.value.id}`)
      .catch(() => null);
    if (detail) Object.assign(form.value, detail);
    form.value.details = (form.value.details ?? []).map((line: any) => ({
      ...line,
      quantity: Number(line.quantity ?? 0),
      stockKey: `${line.goodsId}-${line.skuId}-${form.value.warehouseId}-${line.batchNo ?? ''}`,
    }));
  }
  await Promise.all([
    loadWarehousesByOrg('out', form.value.orgId),
    loadWarehousesByOrg('in', form.value.toOrgId),
  ]);
  await loadStocks();
});
</script>

<template>
  <el-form label-position="top" :disabled="isView">
    <div class="form-grid">
      <el-form-item label="调出组织" required>
        <el-tree-select
          v-model="form.orgId"
          :data="organizationTree"
          filterable
          check-strictly
          node-key="value"
          :props="{ label: 'label', children: 'children' }"
          :disabled="isView"
          @change="
            form.warehouseId = '';
            form.toWarehouseId = '';
            form.details = [blankLine()];
            loadWarehousesByOrg('out', form.orgId);
            loadStocks();
          "
        />
      </el-form-item>
      <el-form-item label="调出仓库" required>
        <el-select
          v-model="form.warehouseId"
          filterable
          :disabled="isView || !form.orgId"
          @change="
            form.toWarehouseId = '';
            form.details = [blankLine()];
            loadStocks();
          "
        >
          <el-option
            v-for="x in options.outWarehouses"
            :key="x.value"
            :label="x.label"
            :value="x.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="调入组织" required>
        <el-tree-select
          v-model="form.toOrgId"
          :data="organizationTree"
          filterable
          check-strictly
          node-key="value"
          :props="{ label: 'label', children: 'children' }"
          :disabled="isView"
          @change="
            form.toWarehouseId = '';
            loadWarehousesByOrg('in', form.toOrgId);
          "
        />
      </el-form-item>
      <el-form-item label="调入仓库" required>
        <el-select
          v-model="form.toWarehouseId"
          filterable
          :disabled="isView || !form.warehouseId"
        >
          <el-option
            v-for="x in inWarehouses"
            :key="x.value"
            :label="x.label"
            :value="x.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="发出人" required>
        <el-select v-model="form.sendBy" filterable :disabled="isView">
          <el-option
            v-for="x in options.users"
            :key="x.value"
            :label="x.label"
            :value="x.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="接收人" required>
        <el-select v-model="form.receiveBy" filterable :disabled="isView">
          <el-option
            v-for="x in options.users"
            :key="x.value"
            :label="x.label"
            :value="x.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="调拨理由" required>
        <el-input v-model="form.reason" :disabled="isView" />
      </el-form-item>
      <el-form-item label="调拨日期" required>
        <el-date-picker
          v-model="form.transferDate"
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
      <span class="details-title">调拨明细</span>
      <el-button v-if="!isView" link type="primary" @click="addLine">+ 添加明细</el-button>
    </div>
    <el-table :data="form.details ?? []" border size="small">
      <el-table-column label="商品" min-width="220">
        <template #default="s">
          <RemoteSelect
            v-if="!isView"
            v-model="s.row.goodsId"
            :fetch="searchGoodsOptions"
            :current-label="s.row.goodsName"
            :disabled="!form.warehouseId"
            placeholder="请先选择调出仓库，再搜索库存商品"
            @change="lineGoodsChanged(s.row)"
          />
          <span v-else>{{ s.row.goodsName || s.row.goodsId || '—' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="SKU/规格" min-width="120">
        <template #default="s">{{ s.row.skuSpec || s.row.skuId || '—' }}</template>
      </el-table-column>
      <el-table-column label="单位" width="80">
        <template #default="s">{{ s.row.unitName || unitName(s.row) }}</template>
      </el-table-column>
      <el-table-column label="库存批次" min-width="200">
        <template #default="s">
          <el-select
            v-if="!isView"
            v-model="s.row.stockKey"
            filterable
            placeholder="选择批次"
            @change="stockChanged(s.row)"
          >
            <el-option
              v-for="x in lineStocks(s.row)"
              :key="stockKeyOf(x)"
              :label="`${x.goodsName || ''} · ${x.batchNo || '无批号'} · 库存 ${x.inventoryQty ?? 0}`"
              :value="stockKeyOf(x)"
            />
          </el-select>
          <span v-else>{{ s.row.batchNo || '无批号' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="当前库存" width="100">
        <template #default="s">{{ s.row.inventoryQty ?? 0 }}</template>
      </el-table-column>
      <el-table-column label="调拨数量" width="130">
        <template #default="s">
          <el-input-number
            v-model="s.row.quantity"
            :min="1"
            :precision="0"
            :step="1"
            :disabled="isView"
          />
        </template>
      </el-table-column>
      <el-table-column label="备注" min-width="130">
        <template #default="s"><el-input v-model="s.row.remark" :disabled="isView" /></template>
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
