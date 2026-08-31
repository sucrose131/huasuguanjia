<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { dateText } from '@/utils/format';
import {
  filterGoodsByWarehouseType,
  filterMappedGoodsByKeyword,
  warehouseTypeOf,
} from '@/utils/goods-warehouse';
import RemoteSelect from '@/components/RemoteSelect.vue';
import SignaturePad from '@/components/requisition/SignaturePad.vue';

const props = defineProps<{
  modelValue: Record<string, any>;
  mode: 'create' | 'edit' | 'view';
}>();
const emit = defineEmits<{
  (e: 'update:modelValue', value: Record<string, any>): void;
  (e: 'saved'): void;
  (e: 'cancel'): void;
}>();

const auth = useAuthStore();
const form = computed(() => props.modelValue);
const saving = ref(false);
const options = reactive<Record<string, any>>({
  orgs: [],
  requisitionWarehouses: [],
  requisitionDepts: [],
  employees: [],
  units: [],
  contextGoods: [],
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
    returnable: Number(form.value.drawType) === 2,
    remark: '',
    goodsWarehouseType: 0,
  };
}

async function loadDicts() {
  const [drawType, yesNo, status, approvalStatus] = await Promise.all([
    api.get('/dictionaries/draw_type').catch(() => []),
    api.get('/dictionaries/yes_no').catch(() => []),
    api.get('/dictionaries/requisition_status').catch(() => []),
    api.get('/dictionaries/requisition_approval_status').catch(() => []),
  ]);
  dicts.draw_type = drawType as any[];
  dicts.yes_no = yesNo as any[];
  dicts.requisition_status = status as any[];
  dicts.requisition_approval_status = approvalStatus as any[];
}

function dictLabel(code: string, value: unknown) {
  return (dicts[code] ?? []).find((item: any) => String(item.value) === String(value))?.label ?? '—';
}

async function loadRequisitionOptions(orgId: unknown) {
  if (!orgId) {
    options.requisitionWarehouses = [];
    options.requisitionDepts = [];
    options.employees = [];
    return;
  }
  const result: any = await api.get('/requisitions/application-form-options', {
    params: { orgId },
  });
  options.requisitionWarehouses = result.warehouses ?? [];
  options.requisitionDepts = result.departments ?? [];
  options.employees = result.employees ?? [];
}

/** 按所选组织（账套）解析当前登录用户的OA员工身份，自动填充领用人/部门 */
async function resolveCurrentApplicant() {
  if (!form.value.orgId) {
    form.value.applicantId = '';
    form.value.deptId = '';
    return;
  }
  const result: any = await api
    .get('/requisitions/current-applicant', { params: { orgId: form.value.orgId } })
    .catch(() => ({ found: false }));
  if (result?.found) {
    form.value.applicantId = result.staffId;
    if (result.deptId) form.value.deptId = result.deptId;
  } else {
    form.value.applicantId = '';
    form.value.deptId = '';
  }
}

async function organizationChanged() {
  form.value.warehouseId = '';
  form.value.deptId = '';
  form.value.applicantId = '';
  form.value.details = [blankLine()];
  options.contextGoods = [];
  await loadRequisitionOptions(form.value.orgId);
  await loadOrgGoods(form.value.orgId);
  await resolveCurrentApplicant();
}

/** 按单据组织加载全部可用商品（后端返回分类 warehouse_type，供仓库兼容匹配），组织为空时清空 */
async function loadOrgGoods(orgId: unknown) {
  if (!orgId) {
    options.contextGoods = [];
    return;
  }
  options.contextGoods = (await api
    .get('/requisitions/all-goods-options', { params: { orgId: String(orgId) } })
    .catch(() => [])) as any[];
}

/** 明细商品的唯一分类仓库类型：全部同类型则返回该类型（仓库只能选该类型），否则 0（不限） */
const documentWarehouseType = computed(() => {
  const types = new Set(
    (form.value.details ?? [])
      .map((line: any) => Number(line.goodsWarehouseType ?? 0))
      .filter(Boolean),
  );
  return types.size === 1 ? [...types][0] : 0;
});

/** 当前所选仓库的类型（双向联动：选仓库后商品按该类型过滤；未选仓库为 0=不限） */
const selectedWarehouseType = computed(() =>
  warehouseTypeOf(options.requisitionWarehouses ?? [], form.value.warehouseId),
);

/** 仓库选项：领用仓库范围内，按明细商品分类类型过滤（先选商品后选仓库场景） */
const warehouseOptions = computed(() =>
  (options.requisitionWarehouses ?? []).filter(
    (w: any) =>
      !documentWarehouseType.value ||
      Number(w.raw?.warehouseType ?? w.warehouseType ?? 0) === documentWarehouseType.value,
  ),
);

function warehouseChanged() {
  // 先选商品后选仓库：换仓库只校验兼容性，不清空明细
  const current = warehouseOptions.value.find(
    (w: any) => String(w.value) === String(form.value.warehouseId),
  );
  if (documentWarehouseType.value && !current) {
    form.value.warehouseId = '';
    ElMessage.warning('所选仓库类型与明细商品不匹配，请重新选择仓库');
  }
}

function drawTypeChanged(value: unknown) {
  const returnable = Number(value) === 2;
  for (const line of form.value.details ?? []) line.returnable = returnable;
}

function addLine() {
  (form.value.details ??= []).push(blankLine());
}
function removeLine(index: number) {
  form.value.details.splice(index, 1);
}

async function searchGoodsOptions(keyword: string) {
  const list = filterMappedGoodsByKeyword(
    filterGoodsByWarehouseType(options.contextGoods, selectedWarehouseType.value),
    keyword,
  );
  return list.map((g: any) => ({
    value: g.id,
    label: `${g.queryCode || ''} ${g.goodsName || ''}`.trim(),
  }));
}

async function lineGoodsChanged(line: any) {
  if (!line.goodsId) return;
  const matched = (options.contextGoods ?? []).find(
    (g: any) => String(g.id) === String(line.goodsId),
  );
  line.goodsWarehouseType = Number(matched?.categoryWarehouseType ?? 0);
  const otherTypes = new Set(
    (form.value.details ?? [])
      .filter((item: any) => item !== line)
      .map((item: any) => Number(item.goodsWarehouseType ?? 0))
      .filter(Boolean),
  );
  if (
    line.goodsWarehouseType > 0 &&
    otherTypes.size > 0 &&
    !otherTypes.has(line.goodsWarehouseType)
  ) {
    Object.assign(line, blankLine());
    ElMessage.warning('同一领用申请只能选择相同仓库类型的商品，请拆分申请单');
    return;
  }
  const g: any = await api.get(`/goods/${line.goodsId}`);
  const sku = (g.skus ?? []).find((x: any) => x.isDefault === 1) ?? g.skus?.[0];
  line.skuId = sku?.id ?? '';
  line.unitType = sku?.unitType ?? 0;
  line.goodsCode = g.queryCode ?? '';
  line.goodsName = g.goodsName ?? '';
  line.skuSpec = sku?.specModels ?? '';
  // 商品分类类型变化后，若已选仓库类型不匹配则清空仓库
  if (form.value.warehouseId && documentWarehouseType.value) {
    const current = (options.requisitionWarehouses ?? []).find(
      (w: any) => String(w.value) === String(form.value.warehouseId),
    );
    if (
      !current ||
      Number(current.raw?.warehouseType ?? current.warehouseType ?? 0) !==
        documentWarehouseType.value
    ) {
      form.value.warehouseId = '';
      ElMessage.warning('明细商品类型已变化，请重新选择匹配的仓库');
    }
  }
}

function lineUnitName(line: any) {
  const unit = options.units.find((u: any) => String(u.value ?? u.id) === String(line.unitType));
  return unit?.label ?? unit?.name ?? '—';
}

function signatureChanged(value: string) {
  form.value.signatureContent = value;
  form.value.signatureAttachment = '';
  form.value.signedBy = value ? form.value.applicantId : '';
  form.value.signedAt = value ? new Date().toISOString() : null;
}

function validate(submit: boolean) {
  if (!form.value.orgId) {
    ElMessage.warning('请选择所属组织');
    return false;
  }
  // 找不到该组织下OA员工身份时可保存草稿（领用人/部门为空），提交必须完整
  if (submit && (!form.value.deptId || !form.value.applicantId)) {
    ElMessage.warning('当前账号未关联该组织的OA员工，无法提交审批，可先保存草稿');
    return false;
  }
  const hasGoods = (form.value.details ?? []).some((line: any) => line.goodsId);
  if (!form.value.warehouseId) {
    ElMessage.warning(
      hasGoods ? '请选择与商品匹配的领用仓库' : '请选择所属组织、领用部门、领用仓库和领用人',
    );
    return false;
  }
  if (hasGoods && documentWarehouseType.value) {
    const current = (options.requisitionWarehouses ?? []).find(
      (w: any) => String(w.value) === String(form.value.warehouseId),
    );
    if (
      !current ||
      Number(current.raw?.warehouseType ?? current.warehouseType ?? 0) !==
        documentWarehouseType.value
    ) {
      ElMessage.warning('所选仓库类型与明细商品不匹配，请重新选择仓库');
      return false;
    }
  }
  if (submit && !String(form.value.reason ?? '').trim()) {
    ElMessage.warning('提交申请前必须填写申请原因');
    return false;
  }
  if ((form.value.details ?? []).some((line: any) => typeof line.returnable !== 'boolean')) {
    ElMessage.warning('请为每条领用明细选择“可归还”或“无需归还”');
    return false;
  }
  if (
    submit &&
    !String(form.value.signatureContent ?? '').trim() &&
    !String(form.value.signatureAttachment ?? '').trim()
  ) {
    ElMessage.warning('提交申请前必须由领用人完成签字确认');
    return false;
  }
  if (form.value.signatureContent || form.value.signatureAttachment) {
    form.value.signedBy = form.value.applicantId;
    form.value.signedAt = form.value.signedAt || new Date().toISOString();
  }
  return true;
}

async function save(submit = false) {
  if (!validate(submit)) return;
  saving.value = true;
  try {
    const payload: Record<string, any> = { ...form.value, submit };
    const url = '/requisitions/applications';
    const result: any =
      props.mode === 'edit' ? await api.patch(`${url}/${form.value.id}`, payload) : await api.post(url, payload);
    const message =
      result?.message ?? (submit ? '领用申请已提交' : '草稿已保存');
    if (result?.oaStatus === 'PUSH_FAILED') ElMessage.warning(message);
    else ElMessage.success(message);
    emit('saved');
  } catch {
    // axios 拦截器已提示
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  const units = await api.get('/base-data/units/options').catch(() => []);
  // 申请发起组织只能是登录人的 OA 固定所属组织；额外授权组织仅用于查看和执行业务。
  options.orgs = auth.user?.orgId
    ? [{ value: auth.user.orgId, label: auth.user.orgName || auth.user.currentOrgName || '所属组织' }]
    : [];
  options.units = units;
  await loadDicts();
  if (props.mode === 'create') {
    Object.assign(form.value, {
      orgId: auth.user?.orgId ?? '',
      deptId: '',
      warehouseId: '',
      applicantId: '',
      drawType: 1,
      date: dateText(new Date()),
      reason: '',
      details: [blankLine()],
      signatureContent: '',
      signatureAttachment: '',
      signedBy: '',
      signedAt: null,
    });
  } else if (form.value.id) {
    // 编辑/查看：拉取完整详情（列表行只有摘要字段）
    const detail: any = await api
      .get(`/requisitions/applications/${form.value.id}`)
      .catch(() => null);
    if (detail) Object.assign(form.value, detail);
  }
  await loadRequisitionOptions(form.value.orgId);
  await loadOrgGoods(form.value.orgId);
  if (props.mode === 'create') await resolveCurrentApplicant();
  // 编辑回显：为已有明细行补商品分类类型，确保仓库下拉按类型过滤
  for (const line of form.value.details ?? []) {
    if (line.goodsId && !Number(line.goodsWarehouseType)) {
      const matched = (options.contextGoods ?? []).find(
        (g: any) => String(g.id) === String(line.goodsId),
      );
      line.goodsWarehouseType = Number(matched?.categoryWarehouseType ?? 0);
    }
  }
});
</script>

<template>
  <el-form label-position="top" :disabled="isView">
    <div class="form-grid">
      <el-form-item label="所属组织" required>
        <el-select v-model="form.orgId" disabled>
          <el-option v-for="x in options.orgs" :key="x.value" :label="x.label" :value="x.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="领用部门" required>
        <el-select v-model="form.deptId" filterable :disabled="isView">
          <el-option v-for="x in options.requisitionDepts" :key="x.value" :label="x.label" :value="x.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="领用类型" required>
        <el-select v-model="form.drawType" :disabled="isView" @change="drawTypeChanged">
          <el-option v-for="item in dicts.draw_type || []" :key="item.value" :label="item.label" :value="Number(item.value)" />
        </el-select>
      </el-form-item>
      <el-form-item label="仓库" required>
        <el-select v-model="form.warehouseId" filterable :disabled="isView || !form.orgId" @change="warehouseChanged">
          <el-option v-for="x in warehouseOptions" :key="x.value" :label="x.label" :value="x.value" />
        </el-select>
        <div v-if="documentWarehouseType && form.details?.some((l: any) => l.goodsId)" class="warehouse-hint">
          已按明细商品类型匹配仓库
        </div>
      </el-form-item>
      <el-form-item label="领用人" required>
        <el-select v-model="form.applicantId" filterable disabled>
          <el-option v-for="item in options.employees" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="申请日期" required>
        <el-date-picker v-model="form.date" type="date" value-format="YYYY-MM-DD" :disabled="isView" />
      </el-form-item>
      <el-form-item label="申请原因" required class="span-2">
        <el-input v-model="form.reason" :disabled="isView" />
      </el-form-item>
      <template v-if="isView">
        <el-form-item label="单据状态">
          <el-input :model-value="form.statusName || dictLabel('requisition_status', form.status)" readonly />
        </el-form-item>
        <el-form-item label="审批状态">
          <el-input :model-value="form.approveStatusName || dictLabel('requisition_approval_status', form.approveStatus)" readonly />
        </el-form-item>
        <el-form-item label="审批人">
          <el-input :model-value="form.approveByName || '—'" readonly />
        </el-form-item>
        <el-form-item label="审批时间">
          <el-input :model-value="form.approveDate ? dateText(form.approveDate, true) : '—'" readonly />
        </el-form-item>
        <el-form-item label="审批意见" class="span-2">
          <el-input :model-value="form.approveComment || '—'" readonly />
        </el-form-item>
      </template>
    </div>

    <div class="details-header">
      <span class="details-title">领用明细</span>
      <el-button v-if="!isView" link type="primary" @click="addLine">+ 添加明细</el-button>
    </div>
    <el-table :data="form.details ?? []" border size="small">
      <el-table-column label="商品" min-width="220">
        <template #default="s">
          <RemoteSelect
            v-model="s.row.goodsId"
            :fetch="searchGoodsOptions"
            :current-label="s.row.goodsName || s.row.goodsId"
            :disabled="isView || !form.orgId"
            placeholder="输入商品名称或编码搜索"
            @change="lineGoodsChanged(s.row)"
          />
        </template>
      </el-table-column>
      <el-table-column label="SKU/规格" min-width="120">
        <template #default="s">{{ s.row.skuSpec || s.row.skuId || '—' }}</template>
      </el-table-column>
      <el-table-column label="申请数量" width="120">
        <template #default="s">
          <el-input-number v-model="s.row.quantity" :min="1" :precision="0" :step="1" :disabled="isView" />
        </template>
      </el-table-column>
      <el-table-column label="单位" width="90">
        <template #default="s">{{ lineUnitName(s.row) }}</template>
      </el-table-column>
      <el-table-column label="是否可归还" width="130">
        <template #default="s">
          <el-select
            v-model="s.row.returnable"
            placeholder="请选择"
            :disabled="isView"
          >
            <el-option
              v-for="item in dicts.yes_no || []"
              :key="item.value"
              :label="item.label"
              :value="Number(item.value) === 1"
            />
          </el-select>
        </template>
      </el-table-column>
      <el-table-column label="意向批号" width="180">
        <template #default="s">
          <el-select v-model="s.row.batchNo" filterable allow-create default-first-option :disabled="isView" placeholder="可选">
            <el-option v-for="b in (s.row.batchOptions ?? [])" :key="b" :label="b" :value="b" />
          </el-select>
        </template>
      </el-table-column>
      <el-table-column v-if="!isView" label="" width="60">
        <template #default="s">
          <el-button link type="danger" @click="removeLine(s.$index)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-form-item label="领用人签字" required class="full-field">
      <SignaturePad
        :model-value="form.signatureContent"
        :has-stored-signature="Boolean(form.signatureAttachment)"
        :disabled="mode === 'view' || !form.applicantId"
        @update:model-value="signatureChanged"
      />
      <div v-if="!form.applicantId && !isView" class="warehouse-hint">
        所选组织未匹配到当前账号的OA员工身份，无法签字，可先保存草稿
      </div>
    </el-form-item>

    <div v-if="!isView" class="form-actions">
      <el-button @click="emit('cancel')">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save(false)">保存草稿</el-button>
      <el-button type="success" :loading="saving" @click="save(true)">保存并提交</el-button>
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
.full-field {
  grid-column: 1 / -1;
}
.warehouse-hint {
  font-size: 12px;
  color: var(--hs-muted, #909399);
  margin-top: 2px;
}
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>
