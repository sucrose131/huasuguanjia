<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { dateText } from '@/utils/format';
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
  };
}

async function loadDicts() {
  const [drawType, yesNo] = await Promise.all([
    api.get('/dictionaries/draw_type').catch(() => []),
    api.get('/dictionaries/yes_no').catch(() => []),
  ]);
  dicts.draw_type = drawType as any[];
  dicts.yes_no = yesNo as any[];
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
  if (!form.value.applicantId && props.mode === 'create')
    form.value.applicantId = auth.user?.staffId ?? '';
}

async function organizationChanged() {
  form.value.warehouseId = '';
  form.value.deptId = '';
  form.value.applicantId = '';
  form.value.details = [blankLine()];
  await loadRequisitionOptions(form.value.orgId);
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
  const r: any = await api.get('/goods', { params: { keyword, pageSize: 50, status: 1 } });
  return (r.items ?? []).map((g: any) => ({
    value: g.id,
    label: `${g.queryCode || ''} ${g.goodsName || ''}`.trim(),
  }));
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
  if (!form.value.orgId || !form.value.deptId || !form.value.warehouseId || !form.value.applicantId) {
    ElMessage.warning('请选择所属组织、领用部门、行政/健服类仓库和领用人');
    return false;
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
  const [orgs, units] = await Promise.all([
    api.get('/base-data/organizations/options').catch(() => []),
    api.get('/base-data/units/options').catch(() => []),
  ]);
  options.orgs = orgs;
  options.units = units;
  await loadDicts();
  if (props.mode === 'create') {
    Object.assign(form.value, {
      orgId: auth.user?.orgId ?? '',
      deptId: '',
      warehouseId: '',
      applicantId: auth.user?.staffId ?? '',
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
});
</script>

<template>
  <el-form label-position="top" :disabled="isView">
    <div class="form-grid">
      <el-form-item label="所属组织" required>
        <el-select v-model="form.orgId" :disabled="isView" @change="organizationChanged">
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
        <el-select v-model="form.warehouseId" filterable :disabled="isView || !form.orgId">
          <el-option v-for="x in options.requisitionWarehouses" :key="x.value" :label="x.label" :value="x.value" />
        </el-select>
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
            :disabled="isView"
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
        :disabled="mode === 'view'"
        @update:model-value="signatureChanged"
      />
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
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>
