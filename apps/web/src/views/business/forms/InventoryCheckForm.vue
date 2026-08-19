<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { dateText } from '@/utils/format';
import { buildOrganizationTree, type OrganizationTreeNode } from '@/utils/organization-tree';

const props = defineProps<{
  modelValue: Record<string, any>;
  mode: 'create' | 'edit' | 'view';
}>();
const emit = defineEmits<{ (e: 'saved'): void; (e: 'cancel'): void }>();

const auth = useAuthStore();
const form = computed(() => props.modelValue);
const saving = ref(false);
const options = reactive<Record<string, any>>({ orgs: [], warehouses: [] });
const dicts = reactive<Record<string, any[]>>({ checkTypes: [] });

const isView = computed(() => props.mode === 'view');
const isCreate = computed(() => props.mode === 'create');
const organizationTree = computed(() =>
  buildOrganizationTree(options.orgs as OrganizationTreeNode[]),
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

function recalcCheckLine(line: any) {
  line.differentQty = Number(line.checkQty ?? 0) - Number(line.inventoryQty ?? 0);
  const diff = Number(line.differentQty);
  const names: string[] = [];
  if (diff < 0) names.push('盘亏');
  else if (diff > 0) names.push('盘盈');
  if (Number(line.damagedQty) > 0) names.push('损坏');
  line.resultName = names.join(' + ') || '正常';
}

function docStatus(item: any) {
  return Number(item.approveStatus) === 1
    ? '已通过'
    : Number(item.approveStatus) === 2
      ? '已驳回'
      : '待审批';
}
function docStatusType(item: any) {
  return Number(item.approveStatus) === 1 ? 'success' : Number(item.approveStatus) === 2 ? 'danger' : 'info';
}

function validate() {
  if (isCreate.value) {
    if (!form.value.orgId || !form.value.warehouseId || !form.value.checkType) {
      ElMessage.warning('请选择盘点类型、组织和仓库');
      return false;
    }
    return true;
  }
  for (const line of form.value.details ?? []) {
    if (Number(line.checkQty) < 0 || Number(line.damagedQty) < 0) {
      ElMessage.warning(`${line.goodsName || '商品'} 实盘或损坏数量不能小于 0`);
      return false;
    }
    if (Number(line.damagedQty) > Number(line.checkQty)) {
      ElMessage.warning(`${line.goodsName || '商品'} 损坏数量不能超过实盘总数`);
      return false;
    }
  }
  return true;
}

async function save() {
  if (!validate()) return;
  saving.value = true;
  try {
    const url = '/inventory/checks';
    if (isCreate.value) {
      const result: any = await api.post(url, {
        orgId: form.value.orgId,
        warehouseId: form.value.warehouseId,
        checkType: form.value.checkType,
        checkDate: form.value.checkDate,
        remark: form.value.remark,
      });
      ElMessage.success(result?.message ?? '盘点单已创建');
    } else {
      (form.value.details ?? []).forEach(recalcCheckLine);
      const result: any = await api.patch(`${url}/${form.value.id}`, {
        details: (form.value.details ?? []).map((line: any) => ({
          id: line.id,
          checkQty: line.checkQty,
          damagedQty: line.damagedQty,
          remark: line.remark ?? '',
        })),
        submit: true,
      });
      ElMessage.success(result?.message ?? '盘点已完成并提交审批');
    }
    emit('saved');
  } catch {
    // axios 拦截器已提示
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  const [orgs, checkTypes] = await Promise.all([
    api.get('/base-data/organizations/options').catch(() => []),
    api.get('/dictionaries/inventory_check_type').catch(() => []),
  ]);
  options.orgs = orgs;
  dicts.checkTypes = checkTypes as any[];

  if (props.mode === 'create') {
    Object.assign(form.value, {
      orgId: auth.user?.orgId ?? '',
      warehouseId: '',
      checkType: dicts.checkTypes?.[0]?.value ?? '',
      checkDate: dateText(new Date()),
      remark: '',
      details: [],
    });
  } else if (form.value.id) {
    const detail: any = await api.get(`/inventory/checks/${form.value.id}`).catch(() => null);
    if (detail) Object.assign(form.value, detail);
    (form.value.details ?? []).forEach(recalcCheckLine);
  }
  await loadOrgWarehouses(form.value.orgId);
});
</script>

<template>
  <el-form label-position="top" :disabled="isView">
    <div class="form-grid">
      <el-form-item v-if="!isCreate" label="盘点单号">
        <el-input :model-value="form.checkNo || '—'" readonly />
      </el-form-item>
      <el-form-item label="盘点类型" required>
        <el-select v-model="form.checkType" :disabled="!isCreate">
          <el-option
            v-for="item in dicts.checkTypes"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="组织" required>
        <el-tree-select
          v-model="form.orgId"
          :data="organizationTree"
          filterable
          check-strictly
          node-key="value"
          :props="{ label: 'label', children: 'children' }"
          :disabled="!isCreate"
          @change="
            form.warehouseId = '';
            loadOrgWarehouses(form.orgId);
          "
        />
      </el-form-item>
      <el-form-item label="仓库" required>
        <el-select v-model="form.warehouseId" filterable :disabled="!isCreate">
          <el-option
            v-for="w in options.warehouses"
            :key="w.value"
            :label="w.label"
            :value="w.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="盘点日期" required>
        <el-date-picker
          v-model="form.checkDate"
          type="date"
          value-format="YYYY-MM-DD"
          :disabled="!isCreate"
        />
      </el-form-item>
      <el-form-item label="备注" class="span-2">
        <el-input
          v-model="form.remark"
          type="textarea"
          :rows="2"
          :disabled="!isCreate"
          placeholder="填写本次盘点范围或特殊说明"
        />
      </el-form-item>
    </div>

    <div v-if="isCreate" class="load-hint">
      选择组织、仓库、盘点类型和日期后点击「保存」，系统将按该仓库全部在库商品批次自动生成盘点明细；保存后请回到列表点击「编辑」录入实盘数量。
    </div>

    <template v-if="!isCreate">
      <div class="details-header">
        <span class="details-title">盘点明细</span>
      </div>
      <el-table :data="form.details ?? []" border size="small" max-height="360">
        <el-table-column prop="goodsName" label="商品" min-width="140" show-overflow-tooltip />
        <el-table-column label="SKU/规格" min-width="110">
          <template #default="s">{{ s.row.skuSpec || '—' }}</template>
        </el-table-column>
        <el-table-column label="批号" width="120">
          <template #default="s">{{ s.row.batchNo || '无批号' }}</template>
        </el-table-column>
        <el-table-column prop="inventoryQty" label="账面库存" width="95" align="right" />
        <el-table-column label="实盘数量" width="135">
          <template #default="s">
            <el-input-number
              v-model="s.row.checkQty"
              :min="0"
              :precision="0"
              :step="1"
              controls-position="right"
              :disabled="isView"
              @change="recalcCheckLine(s.row)"
            />
          </template>
        </el-table-column>
        <el-table-column label="损坏数量" width="130">
          <template #default="s">
            <el-input-number
              v-model="s.row.damagedQty"
              :min="0"
              :max="Number(s.row.checkQty)"
              :precision="0"
              :step="1"
              controls-position="right"
              :disabled="isView"
              @change="recalcCheckLine(s.row)"
            />
          </template>
        </el-table-column>
        <el-table-column label="盘差" width="90" align="right">
          <template #default="s">
            <span
              :class="{
                'difference-negative': Number(s.row.differentQty) < 0,
                'difference-positive': Number(s.row.differentQty) > 0,
              }"
              >{{ s.row.differentQty ?? 0 }}</span
            >
          </template>
        </el-table-column>
        <el-table-column label="结果" width="110">
          <template #default="s">{{ s.row.resultName || '正常' }}</template>
        </el-table-column>
        <el-table-column label="备注" min-width="140">
          <template #default="s">
            <el-input v-model="s.row.remark" :disabled="isView" />
          </template>
        </el-table-column>
      </el-table>
    </template>

    <template v-if="isView && form.generatedDocuments?.length">
      <div class="details-header">
        <span class="details-title">已生成单据</span>
      </div>
      <el-table :data="form.generatedDocuments" border size="small">
        <el-table-column prop="type" label="类型" min-width="130" />
        <el-table-column prop="businessNo" label="单号" min-width="150" />
        <el-table-column label="状态" width="100">
          <template #default="s">
            <el-tag :type="docStatusType(s.row)" effect="plain">{{ docStatus(s.row) }}</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </template>

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
.load-hint {
  padding: 10px 12px;
  margin: 8px 0;
  border-radius: 6px;
  background: #ecf5ff;
  color: #409eff;
  font-size: 13px;
  line-height: 1.6;
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
.difference-negative {
  color: #f56c6c;
}
.difference-positive {
  color: #67c23a;
}
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>
