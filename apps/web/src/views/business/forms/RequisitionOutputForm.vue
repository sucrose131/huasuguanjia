<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { dateText } from '@/utils/format';
import { createRequestId } from '@/utils/random-id';
import RemoteSelect from '@/components/RemoteSelect.vue';
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
  requisitionWarehouses: [],
  requisitionDepts: [],
  employees: [],
  applications: [],
  stocks: [],
  units: [],
});
const dicts = reactive<Record<string, any[]>>({});

const isView = computed(() => props.mode === 'view');

function blankLine() {
  return {
    goodsId: '',
    skuId: '',
    unitType: 0,
    batchNo: '',
    quantity: 1,
    applicationQty: 0,
    historicalQty: 0,
    remainingQty: null,
    applicationDetailId: '',
    outputDetailId: '',
    returnable: null,
    remark: '',
  };
}

function stockKeyOf(line: any, warehouseId: unknown) {
  return line.goodsId && line.skuId && warehouseId && line.batchNo
    ? `${line.goodsId}-${line.skuId}-${warehouseId}-${line.batchNo}`
    : '';
}
function stockChanged(line: any) {
  const s = options.stocks.find(
    (x: any) => `${x.goodsId}-${x.skuId}-${x.warehouseId}-${x.batchNo}` === line.stockKey,
  );
  if (s)
    Object.assign(line, {
      goodsId: s.goodsId,
      skuId: s.skuId,
      unitType: s.unitType,
      batchNo: s.batchNo,
      warehouseId: s.warehouseId,
    });
}
function selectedStock(line: any) {
  return options.stocks.find(
    (x: any) => `${x.goodsId}-${x.skuId}-${x.warehouseId}-${x.batchNo}` === line.stockKey,
  );
}
function maxOutputQty(line: any) {
  // 直接领用出库没有申请剩余量：未选库存批次时不设上限，选中后按批次库存量封顶
  // 所有分支保证 max >= 1，避免 el-input-number 在 min > max 时抛错导致表格渲染崩溃
  if (form.value.directOutput) {
    const stock = selectedStock(line);
    if (!stock) return undefined;
    return Math.max(1, Number(stock.inventoryQty) || 0);
  }
  const remaining = Math.max(0, Number(line.remainingQty) || 0);
  const stock = selectedStock(line);
  if (!stock) return Math.max(1, remaining);
  return Math.max(1, Math.min(remaining, Math.max(0, Number(stock.inventoryQty) || 0)));
}
function unitName(line: any) {
  const unit = options.units.find((u: any) => String(u.value ?? u.id) === String(line.unitType));
  return unit?.label ?? unit?.name ?? '—';
}

async function loadDicts() {
  const [confirm] = await Promise.all([
    api.get('/dictionaries/requisition_confirm_status').catch(() => []),
  ]);
  dicts.requisition_confirm_status = confirm as any[];
}

async function loadRequisitionOptions(orgId: unknown, deptId?: unknown, preserveWarehouses = false) {
  if (!orgId) {
    options.requisitionWarehouses = [];
    options.requisitionDepts = [];
    options.employees = [];
    return;
  }
  const params: Record<string, any> = { orgId };
  if (deptId && String(deptId).trim() !== '') params.deptId = deptId;
  const result: any = await api.get('/requisitions/application-form-options', { params });
  // 直接领用出库的仓库下拉来自跨组织仓库列表，刷新部门/人员时保留，避免把用户困在当前组织
  if (!preserveWarehouses) options.requisitionWarehouses = result.warehouses ?? [];
  options.requisitionDepts = result.departments ?? [];
  options.employees = result.employees ?? [];
}

/** 直接领用出库：加载当前账号全部授权组织的领用类仓库（携带 orgId/deptId，用于反推组织） */
async function loadDirectOutputWarehouses() {
  options.requisitionWarehouses = (await api
    .get('/requisitions/direct-output-options')
    .catch(() => [])) as any[];
  options.requisitionDepts = [];
  options.employees = [];
}

/** 直接领用出库：选仓库后反推组织、带出部门并加载该组织部门/人员 */
async function directWarehouseChanged() {
  if (!form.value.directOutput) return;
  if (!form.value.warehouseId) {
    form.value.orgId = '';
    form.value.deptId = '';
    form.value.receiverId = '';
    options.requisitionDepts = [];
    options.employees = [];
    return;
  }
  const current = (options.requisitionWarehouses ?? []).find(
    (w: any) => String(w.value) === String(form.value.warehouseId),
  );
  const raw = current?.raw ?? {};
  form.value.orgId = String(raw.orgId ?? '');
  form.value.deptId = '';
  form.value.receiverId = '';
  form.value.details = [{ ...blankLine(), returnable: true }];
  await loadRequisitionOptions(form.value.orgId, '', true);
  // 部门自动带出：仓库挂部门则直接选中；组织只有一个启用部门则自动选中；否则留空手选
  const depts = options.requisitionDepts ?? [];
  if (raw.deptId && String(raw.deptId) !== '0') {
    const matched = depts.find((d: any) => String(d.value) === String(raw.deptId));
    if (matched) form.value.deptId = String(matched.value);
  } else if (depts.length === 1) {
    form.value.deptId = String(depts[0].value);
  }
  if (form.value.deptId) await loadRequisitionOptions(form.value.orgId, form.value.deptId, true);
  await loadStocks();
}

/** 直接领用出库：切换部门后按部门刷新人员（保留跨组织仓库列表） */
async function deptChanged() {
  if (!form.value.directOutput || !form.value.orgId) return;
  await loadRequisitionOptions(form.value.orgId, form.value.deptId, true);
}

async function applicationChanged() {
  if (!form.value.applicationId) {
    form.value.details = [];
    return;
  }
  const a: any = await api.get(`/requisitions/applications/${form.value.applicationId}`);
  Object.assign(form.value, {
    orgId: a.orgId,
    warehouseId: a.warehouseId,
    deptId: a.deptId,
    applicantId: a.applicantId,
    receiverId: a.applicantId,
  });
  form.value.details = (a.details ?? [])
    .filter((x: any) => Number(x.remainingQty) > 0)
    .map((x: any) => ({
      ...blankLine(),
      ...x,
      applicationDetailId: x.id,
      applicationQty: Number(x.quantity ?? 0),
      historicalQty: Number(x.historicalQty ?? 0),
      remainingQty: Number(x.remainingQty ?? 0),
      quantity: Number(x.remainingQty ?? 0),
      returnable: Boolean(x.returnable),
      stockKey: stockKeyOf(x, a.warehouseId),
    }));
  await loadRequisitionOptions(form.value.orgId);
  await loadStocks();
}

async function searchGoodsOptions(keyword: string) {
  // 商品选项取自按 orgId+warehouseId 加载的库存（后端已过滤仓库类型），未选仓库时为空
  const kw = String(keyword ?? '')
    .trim()
    .toLowerCase();
  const seen = new Map<string, any>();
  for (const s of options.stocks ?? []) {
    if (form.value.warehouseId && String(s.warehouseId) !== String(form.value.warehouseId))
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
  options.stocks = await fetchScopedStockOptions(form.value.orgId, form.value.warehouseId).catch(
    () => [],
  );
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
}

function addLine() {
  (form.value.details ??= []).push(blankLine());
}
function removeLine(index: number) {
  form.value.details.splice(index, 1);
}

function validate() {
  if (form.value.directOutput) {
    if (
      !form.value.orgId ||
      !form.value.warehouseId ||
      !form.value.deptId ||
      !form.value.receiverId
    ) {
      ElMessage.warning('请选择所属组织、领用部门、领用仓库和接收人');
      return false;
    }
    if (
      !(form.value.details ?? []).some(
        (line: any) => line.goodsId && line.skuId && line.batchNo && Number(line.quantity) > 0,
      )
    ) {
      ElMessage.warning('请至少选择一条完整的库存批次并填写出库数量');
      return false;
    }
  } else if (!form.value.applicationId) {
    ElMessage.warning('请选择来源领用申请');
    return false;
  } else if (
    !(form.value.details ?? []).every(
      (line: any) => String(line.batchNo ?? '').trim() && Number(line.quantity) > 0,
    )
  ) {
    ElMessage.warning('请为全部出库明细选择库存批次并填写出库数量');
    return false;
  }
  return true;
}

async function save() {
  if (!validate()) return;
  saving.value = true;
  try {
    if (form.value.directOutput) {
      await ElMessageBox.confirm(
        '保存后将立即扣减库存，并自动生成一张已通过的领用申请单。是否继续？',
        '确认直接领用出库',
        { type: 'warning' },
      );
    }
    form.value.requestKey = form.value.requestKey || createRequestId();
    const url = '/requisitions/outputs';
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
  const [orgs, units, applications] = await Promise.all([
    api.get('/base-data/organizations/options').catch(() => []),
    api.get('/base-data/units/options').catch(() => []),
    api.get('/requisitions/application-options').catch(() => []),
  ]);
  options.orgs = orgs;
  options.units = units;
  options.applications = applications;
  await loadDicts();

  if (props.mode === 'create') {
    Object.assign(form.value, {
      orgId: auth.user?.orgId ?? '',
      warehouseId: '',
      deptId: auth.user?.deptId ?? '',
      receiverId: auth.user?.staffId ?? auth.user?.id ?? '',
      applicantId: auth.user?.staffId ?? '',
      outDate: dateText(new Date()),
      remark: '',
    });
    if (form.value.directOutput) {
      form.value.requestKey = form.value.requestKey || createRequestId();
      form.value.drawType = 2;
      form.value.deptId = '';
      form.value.receiverId = '';
      if (!(form.value.details ?? []).length)
        form.value.details = [{ ...blankLine(), returnable: true }];
      await loadDirectOutputWarehouses();
    } else {
      form.value.details = [];
      if (form.value.applicationId) await applicationChanged();
      await loadRequisitionOptions(form.value.orgId);
    }
    await loadStocks();
  } else if (form.value.id) {
    const detail: any = await api.get(`/requisitions/outputs/${form.value.id}`).catch(() => null);
    if (detail) Object.assign(form.value, detail);
    form.value.details = (form.value.details ?? []).map((line: any) => ({
      ...line,
      stockKey: stockKeyOf(line, form.value.warehouseId),
    }));
    await loadRequisitionOptions(form.value.orgId);
    await loadStocks();
  }
});
</script>

<template>
  <el-form label-position="top" :disabled="isView">
    <div class="form-grid">
      <el-form-item v-if="!form.directOutput" label="领用申请" required>
        <el-select
          v-model="form.applicationId"
          filterable
          :disabled="mode !== 'create' || Boolean(form.autoCreated)"
          @change="applicationChanged"
        >
          <el-option
            v-for="x in options.applications"
            :key="x.id"
            :label="x.applicationNo"
            :value="x.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="仓库" required>
        <el-select
          v-model="form.warehouseId"
          filterable
          :disabled="isView || !form.directOutput"
          @change="directWarehouseChanged"
        >
          <el-option
            v-for="x in options.requisitionWarehouses"
            :key="x.value"
            :label="x.label"
            :value="x.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="出库日期" required>
        <el-date-picker
          v-model="form.outDate"
          type="date"
          value-format="YYYY-MM-DD"
          :disabled="isView"
        />
      </el-form-item>
      <el-form-item label="领用部门" required>
        <el-select
          v-model="form.deptId"
          filterable
          :disabled="isView || !form.directOutput || !form.warehouseId"
          @change="deptChanged"
        >
          <el-option
            v-for="x in options.requisitionDepts"
            :key="x.value"
            :label="x.label"
            :value="x.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="领用接收人" required>
        <el-select
          v-model="form.receiverId"
          filterable
          :disabled="isView || !form.directOutput || !form.warehouseId"
        >
          <el-option
            v-for="x in options.employees"
            :key="x.value"
            :label="x.label"
            :value="x.value"
          />
        </el-select>
      </el-form-item>
    </div>

    <div class="details-header">
      <span class="details-title">出库明细</span>
      <el-button v-if="!isView && form.directOutput" link type="primary" @click="addLine"
        >+ 添加明细</el-button
      >
    </div>
    <el-table :data="form.details ?? []" border size="small">
      <el-table-column label="商品" min-width="220">
        <template #default="s">
          <RemoteSelect
            v-if="form.directOutput && !isView"
            v-model="s.row.goodsId"
            :fetch="searchGoodsOptions"
            :current-label="s.row.goodsName || '—'"
            :disabled="isView || !form.warehouseId"
            placeholder="请先选择仓库，再搜索库存商品"
            @change="lineGoodsChanged(s.row)"
          />
          <span v-else>{{ s.row.goodsName || s.row.goodsId || '—' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="商品编码" width="125">
        <template #default="s">{{ s.row.goodsCode || '—' }}</template>
      </el-table-column>
      <el-table-column label="SKU/规格" min-width="125">
        <template #default="s">{{
          s.row.skuSpec || s.row.goodsSpec || s.row.skuId || '—'
        }}</template>
      </el-table-column>
      <el-table-column label="单位" width="90">
        <template #default="s">{{ unitName(s.row) }}</template>
      </el-table-column>
      <el-table-column label="是否可归还" width="120">
        <template #default="s">
          <el-tag :type="s.row.returnable ? 'success' : 'info'" effect="plain">{{
            s.row.returnable ? '可归还' : '无需归还'
          }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="applicationQty" label="申请数量" width="110" />
      <el-table-column prop="historicalQty" label="历史已出" width="110" />
      <el-table-column prop="remainingQty" label="剩余可出" width="110" />
      <el-table-column label="库存批次" min-width="190">
        <template #default="s">
          <el-select
            v-if="!isView"
            v-model="s.row.stockKey"
            filterable
            @change="stockChanged(s.row)"
          >
            <el-option
              v-for="x in options.stocks.filter(
                (v: any) =>
                  (!s.row.goodsId || String(v.goodsId) === String(s.row.goodsId)) &&
                  (!form.warehouseId || String(v.warehouseId) === String(form.warehouseId)),
              )"
              :key="`${x.goodsId}-${x.skuId}-${x.warehouseId}-${x.batchNo}`"
              :label="`${x.goodsName} · ${x.batchNo} · ${x.inventoryQty}`"
              :value="`${x.goodsId}-${x.skuId}-${x.warehouseId}-${x.batchNo}`"
            />
          </el-select>
          <span v-else>{{ s.row.batchNo || '无批号' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="出库数量" width="130">
        <template #default="s">
          <el-input-number
            v-model="s.row.quantity"
            :min="1"
            :max="maxOutputQty(s.row)"
            :precision="0"
            :step="1"
            :disabled="
              isView ||
              (form.directOutput ? !selectedStock(s.row) : !(Number(s.row.remainingQty) > 0))
            "
          />
        </template>
      </el-table-column>
      <el-table-column label="备注" min-width="140">
        <template #default="s"><el-input v-model="s.row.remark" :disabled="isView" /></template>
      </el-table-column>
      <el-table-column v-if="!isView && form.directOutput" label="" width="60">
        <template #default="s">
          <el-button link type="danger" @click="removeLine(s.$index)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="form-grid" style="margin-top: 12px">
      <el-form-item label="备注" class="span-2">
        <el-input v-model="form.remark" type="textarea" :rows="2" :disabled="isView" />
      </el-form-item>
      <template v-if="isView">
        <el-form-item label="确认状态">
          <el-input :model-value="form.confirmStatusName || '—'" readonly />
        </el-form-item>
        <el-form-item label="确认人">
          <el-input :model-value="form.confirmByName || '—'" readonly />
        </el-form-item>
        <el-form-item label="确认时间">
          <el-input
            :model-value="form.confirmDate ? dateText(form.confirmDate, true) : '—'"
            readonly
          />
        </el-form-item>
        <el-form-item label="确认意见" class="span-2">
          <el-input :model-value="form.confirmComment || '—'" readonly />
        </el-form-item>
      </template>
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
