<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { dateText, moneyText } from '@/utils/format';
import { buildOrganizationTree, type OrganizationTreeNode } from '@/utils/organization-tree';
import { fetchScopedStockOptions } from '../use-scoped-stock-options';

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
  departments: [],
  stocks: [],
});
const dicts = reactive<Record<string, any[]>>({});

const isView = computed(() => props.mode === 'view');

const organizationTree = computed(() =>
  buildOrganizationTree(options.orgs as OrganizationTreeNode[]),
);
const totalQty = computed(() =>
  (form.value.details ?? []).reduce((sum: number, line: any) => sum + Number(line.quantity || 0), 0),
);
const totalAmount = computed(() =>
  (form.value.details ?? []).reduce((sum: number, line: any) => sum + Number(line.amount || 0), 0),
);

/** 按组织加载仓库选项（走后端），组织为空时清空 */
async function loadOrgWarehouses(orgId: unknown) {
  if (!orgId) {
    options.warehouses = [];
    return;
  }
  options.warehouses = (await api
    .get('/base-data/warehouses/options', { params: { orgId: String(orgId) } })
    .catch(() => [])) as any[];
}

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
    unitPrice: 0,
    quantity: 1,
    amount: 0,
    remark: '',
  };
}

function stockKey(stock: any) {
  return `${stock.goodsId}-${stock.skuId}-${stock.warehouseId}-${stock.batchNo ?? ''}`;
}

function stockLabel(stock: any) {
  return `${stock.goodsCode || ''} ${stock.goodsName} · ${stock.skuSpec || '默认规格'} · ${
    stock.batchNo || '无批号'
  }（库存 ${Number(stock.inventoryQty ?? 0).toLocaleString()}）`;
}

function stockIdentity(line: any) {
  return `${line.goodsCode || '—'} ${line.goodsName || '—'} · ${line.skuSpec || '默认规格'} · ${
    line.batchNo || '无批号'
  }`;
}

/** 选择库存批次：一次填充商品/SKU/批次/库存/单价 */
function selectStock(line: any, key: string) {
  const stock = (options.stocks as any[]).find((s) => stockKey(s) === key);
  if (!stock) return;
  Object.assign(line, {
    stockKey: key,
    goodsId: stock.goodsId,
    goodsCode: stock.goodsCode,
    goodsName: stock.goodsName,
    skuId: stock.skuId,
    skuSpec: stock.skuSpec,
    batchNo: stock.batchNo ?? '',
    unitType: stock.unitType,
    unitName: stock.unitName,
    inventoryQty: Number(stock.inventoryQty ?? 0),
    unitPrice: Number(line.unitPrice ?? stock.unitPrice ?? 0),
  });
  recalcLine(line);
}

function recalcLine(line: any) {
  line.amount = Number(line.quantity ?? 0) * Number(line.unitPrice ?? 0);
}

async function loadDicts() {
  const [overflowType] = await Promise.all([
    api.get('/dictionaries/inventory_overflow_type').catch(() => []),
  ]);
  dicts.inventory_overflow_type = overflowType as any[];
}

async function loadStocks() {
  if (!form.value.warehouseId || !form.value.orgId) {
    options.stocks = [];
    return;
  }
  options.stocks = await fetchScopedStockOptions(form.value.orgId, form.value.warehouseId).catch(
    () => [],
  );
}

function addLine() {
  (form.value.details ??= []).push(blankLine());
}
function removeLine(index: number) {
  form.value.details.splice(index, 1);
}

function validate() {
  if (!form.value.orgId || !form.value.warehouseId) {
    ElMessage.warning('请选择所属组织和仓库');
    return false;
  }
  if (!String(form.value.reason ?? '').trim()) {
    ElMessage.warning('请输入原因');
    return false;
  }
  const details = form.value.details ?? [];
  if (!details.length) {
    ElMessage.warning('至少需要一条明细');
    return false;
  }
  for (const line of details) {
    if (!line.goodsId || !line.skuId) {
      ElMessage.warning('请选择有效库存商品');
      return false;
    }
    if (Number(line.quantity) <= 0) {
      ElMessage.warning('明细数量必须大于 0');
      return false;
    }
  }
  return true;
}

async function save() {
  if (!validate()) return;
  saving.value = true;
  try {
    const url = '/inventory/overflows';
    const payload: Record<string, any> = { ...form.value };
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
  const [orgs, departments] = await Promise.all([
    api.get('/base-data/organizations/options').catch(() => []),
    api.get('/base-data/departments/options').catch(() => []),
  ]);
  options.orgs = orgs;
  options.departments = departments;
  await loadDicts();

  if (props.mode === 'create') {
    Object.assign(form.value, {
      orgId: auth.user?.orgId ?? '',
      warehouseId: '',
      deptId: auth.user?.deptId ?? '',
      documentType: dicts.inventory_overflow_type?.[0]?.value ?? '',
      date: dateText(new Date()),
      reason: '',
      remark: '',
    });
    if (!(form.value.details ?? []).length) form.value.details = [blankLine()];
  } else if (form.value.id) {
    const detail: any = await api.get(`/inventory/overflows/${form.value.id}`).catch(() => null);
    if (detail) {
      Object.assign(form.value, detail);
      form.value.documentType =
        form.value.documentType == null || form.value.documentType === ''
          ? ''
          : String(form.value.documentType);
    }
    form.value.details = (form.value.details ?? []).map((line: any) => {
      const mapped = { ...blankLine(), ...line };
      mapped.stockKey = stockKey({
        goodsId: line.goodsId,
        skuId: line.skuId,
        warehouseId: form.value.warehouseId,
        batchNo: line.batchNo ?? '',
      });
      recalcLine(mapped);
      return mapped;
    });
  }
  await loadOrgWarehouses(form.value.orgId);
  await loadStocks();
});
</script>

<template>
  <el-form label-position="top" :disabled="isView">
    <div class="form-grid">
      <el-form-item v-if="form.sourceCheckNo" label="来源盘点单" class="span-2">
        <el-input :model-value="form.sourceCheckNo" disabled />
      </el-form-item>
      <el-form-item label="报盈类型">
        <el-select v-model="form.documentType" :disabled="isView">
          <el-option
            v-for="item in dicts.inventory_overflow_type || []"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="组织" prop="orgId">
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
            form.details = [blankLine()];
            loadOrgWarehouses(form.orgId);
            loadStocks();
          "
        />
      </el-form-item>
      <el-form-item label="仓库" prop="warehouseId">
        <el-select
          v-model="form.warehouseId"
          filterable
          :disabled="isView || !form.orgId"
          @change="
            form.details = [blankLine()];
            loadStocks();
          "
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
        <el-select v-model="form.deptId" filterable :disabled="isView">
          <el-option
            v-for="x in options.departments"
            :key="x.value"
            :label="x.label"
            :value="x.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="日期">
        <el-date-picker
          v-model="form.date"
          type="date"
          value-format="YYYY-MM-DD"
          :disabled="isView"
        />
      </el-form-item>
      <el-form-item label="经办人">
        <el-input :model-value="form.operatorName" disabled />
      </el-form-item>
      <el-form-item label="原因" required class="span-2">
        <el-input v-model="form.reason" :disabled="isView" />
      </el-form-item>
      <el-form-item label="备注" class="span-2">
        <el-input v-model="form.remark" :disabled="isView" />
      </el-form-item>
    </div>

    <div class="details-header">
      <span class="details-title">明细</span>
      <el-button v-if="!isView" link type="primary" @click="addLine">+ 添加明细</el-button>
    </div>
    <el-table :data="form.details ?? []" border size="small">
      <el-table-column label="商品 / SKU / 批次" min-width="300">
        <template #default="s">
          <span v-if="isView" class="readonly-cell">{{ stockIdentity(s.row) }}</span>
          <el-select
            v-else
            v-model="s.row.stockKey"
            filterable
            :disabled="!form.warehouseId"
            placeholder="请先选择仓库，再选择库存批次"
            @change="selectStock(s.row, $event)"
          >
            <el-option
              v-for="stock in options.stocks ?? []"
              :key="stockKey(stock)"
              :label="stockLabel(stock)"
              :value="stockKey(stock)"
            />
          </el-select>
        </template>
      </el-table-column>
      <el-table-column label="单位" width="70">
        <template #default="s">{{ s.row.unitName || '—' }}</template>
      </el-table-column>
      <el-table-column label="当前库存" width="95" align="right">
        <template #default="s">{{ Number(s.row.inventoryQty ?? 0).toLocaleString() }}</template>
      </el-table-column>
      <el-table-column label="报盈数量" width="145">
        <template #default="s">
          <el-input-number
            v-model="s.row.quantity"
            :min="1"
            :precision="0"
            :step="1"
            :disabled="isView"
            @change="recalcLine(s.row)"
          />
        </template>
      </el-table-column>
      <el-table-column label="单价" width="130">
        <template #default="s">
          <el-input-number
            v-model="s.row.unitPrice"
            :min="0"
            :precision="2"
            :disabled="isView"
            @change="recalcLine(s.row)"
          />
        </template>
      </el-table-column>
      <el-table-column label="金额" width="100" align="right">
        <template #default="s">¥ {{ moneyText(s.row.amount) }}</template>
      </el-table-column>
      <el-table-column prop="batchNo" label="批号" width="125">
        <template #default="s">{{ s.row.batchNo || '无批号' }}</template>
      </el-table-column>
      <el-table-column v-if="!isView" label="" width="70">
        <template #default="s">
          <el-button link type="danger" @click="removeLine(s.$index)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div v-if="(form.details ?? []).length" class="modal-totals">
      <span
        >合计数量
        <strong>{{
          totalQty.toLocaleString('zh-CN', { maximumFractionDigits: 4 })
        }}</strong></span
      ><span>合计金额 <strong>¥ {{ moneyText(totalAmount) }}</strong></span>
    </div>

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
