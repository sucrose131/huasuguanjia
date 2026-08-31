<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '@/api';
import { dateText } from '@/utils/format';

const props = defineProps<{
  modelValue: Record<string, any>;
  mode: 'create' | 'edit' | 'view';
  /** stocks 页面「账面调整」弹窗：商品下拉锁定为预填批次 */
  lockStock?: boolean;
  /** stocks 页面「账面调整」弹窗：预填的库存行 */
  presetRow?: Record<string, any> | null;
}>();
const emit = defineEmits<{ (e: 'saved'): void; (e: 'cancel'): void }>();

const form = computed(() => props.modelValue);
const saving = ref(false);
const options = reactive<Record<string, any>>({
  units: [],
  stocks: [],
});
const dicts = reactive<Record<string, any[]>>({ adjustTypes: [] });

const isView = computed(() => props.mode === 'view');

function blankLine() {
  return {
    stockKey: '',
    goodsId: '',
    goodsCode: '',
    goodsName: '',
    skuId: '',
    skuSpec: '',
    warehouseId: '',
    warehouseName: '',
    batchNo: '',
    unitType: 0,
    unitName: '',
    inventoryQty: 0,
    beforeQty: 0,
    afterQty: 0,
    adjustType: dicts.adjustTypes?.[0]?.value ?? 1,
    quantity: 1,
    remark: '',
  };
}

function qty(value: unknown) {
  return Number(value ?? 0).toLocaleString('zh-CN', { maximumFractionDigits: 4 });
}

function stockKeyOf(stock: any) {
  return `${stock.goodsId}-${stock.skuId}-${stock.warehouseId}-${stock.batchNo ?? ''}`;
}

function stockLabel(stock: any) {
  return `${stock.goodsCode || ''} ${stock.goodsName} · ${stock.skuSpec || '默认规格'} · ${
    stock.batchNo || '无批号'
  }（库存 ${qty(stock.inventoryQty)}）`;
}

function stockIdentity(line: any) {
  return `${line.goodsCode || '—'} ${line.goodsName || '—'} · ${line.skuSpec || '默认规格'} · ${
    line.batchNo || '无批号'
  }`;
}

/** 选择库存批次：一次填充商品/SKU/批次/库存，并实时计算调整后数量 */
function selectStock(line: any, key: string) {
  const stock = (options.stocks ?? []).find((s: any) => stockKeyOf(s) === key);
  if (!stock) return;
  Object.assign(line, {
    stockKey: key,
    goodsId: stock.goodsId,
    goodsCode: stock.goodsCode,
    goodsName: stock.goodsName,
    skuId: stock.skuId,
    skuSpec: stock.skuSpec,
    warehouseId: stock.warehouseId,
    warehouseName: stock.warehouseName,
    batchNo: stock.batchNo ?? '',
    unitType: stock.unitType,
    unitName: stock.unitName,
    inventoryQty: Number(stock.inventoryQty ?? 0),
  });
  recalcLine(line);
}

function recalcLine(line: any) {
  line.beforeQty = Number(line.inventoryQty ?? line.beforeQty ?? 0);
  line.afterQty =
    Number(line.beforeQty) +
    (Number(line.adjustType) === 1 ? Number(line.quantity ?? 0) : -Number(line.quantity ?? 0));
  return line;
}

function addLine() {
  (form.value.details ??= []).push(blankLine());
}
function removeLine(index: number) {
  form.value.details.splice(index, 1);
}

function validate() {
  if (!form.value.reason) {
    ElMessage.warning('请输入调整原因');
    return false;
  }
  const lines = form.value.details ?? [];
  if (!lines.length) {
    ElMessage.warning('请至少添加一条调整明细');
    return false;
  }
  for (const line of lines) {
    if (!line.goodsId || !line.skuId || !line.warehouseId || !line.stockKey) {
      ElMessage.warning('请选择完整的商品、仓库与库存批次');
      return false;
    }
    if (Number(line.quantity) <= 0) {
      ElMessage.warning('调整数量必须大于 0');
      return false;
    }
    const afterQty =
      Number(line.inventoryQty ?? 0) +
      (Number(line.adjustType) === 1 ? Number(line.quantity) : -Number(line.quantity));
    if (afterQty < 0) {
      ElMessage.warning(`${line.goodsName || '商品'} 调整后库存不能小于 0`);
      return false;
    }
  }
  return true;
}

async function save(submit = false) {
  if (!validate()) return;
  saving.value = true;
  try {
    const url = '/inventory/adjustments';
    const payload: Record<string, any> = {
      reason: form.value.reason,
      applicantDate: form.value.applicantDate,
      remark: form.value.remark,
      submit,
      details: (form.value.details ?? []).map((line: any) => ({
        goodsId: line.goodsId,
        skuId: line.skuId,
        warehouseId: line.warehouseId,
        batchNo: line.batchNo ?? '',
        adjustType: line.adjustType,
        quantity: line.quantity,
        remark: line.remark ?? '',
      })),
    };
    const result: any =
      props.mode === 'edit'
        ? await api.patch(`${url}/${form.value.id}`, payload)
        : await api.post(url, payload);
    ElMessage.success(result?.message ?? (submit ? '已保存并提交审核' : '草稿已保存'));
    emit('saved');
  } catch {
    // axios 拦截器已提示
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  const [units, stocks, adjustTypes] = await Promise.all([
    api.get('/base-data/units/options').catch(() => []),
    api.get('/inventory/stock-options').catch(() => []),
    api.get('/dictionaries/inventory_adjust_type').catch(() => []),
  ]);
  options.units = units;
  options.stocks = stocks;
  dicts.adjustTypes = adjustTypes as any[];

  if (props.mode === 'create') {
    Object.assign(form.value, {
      applicantDate: dateText(new Date()),
      reason: '',
      remark: '',
      details: [] as any[],
    });
    if (props.presetRow) {
      const row = props.presetRow;
      const line = {
        ...blankLine(),
        stockKey: stockKeyOf(row),
        goodsId: row.goodsId,
        goodsCode: row.goodsCode,
        goodsName: row.goodsName,
        skuId: row.skuId,
        skuSpec: row.skuSpec,
        warehouseId: row.warehouseId,
        warehouseName: row.warehouseName,
        batchNo: row.batchNo ?? '',
        unitType: row.unitType,
        unitName: row.unitName,
        inventoryQty: Number(row.inventoryQty ?? 0),
        adjustType: 1,
        quantity: 1,
      };
      form.value.details = [recalcLine(line)];
    } else {
      form.value.details = [blankLine()];
    }
  } else if (form.value.id) {
    const detail: any = await api.get(`/inventory/adjustments/${form.value.id}`).catch(() => null);
    if (detail) Object.assign(form.value, detail);
    form.value.details = (form.value.details ?? []).map((line: any) => ({
      ...line,
      quantity: Number(line.quantity ?? 0),
      inventoryQty: Number(line.beforeQty ?? 0),
      stockKey: `${line.goodsId}-${line.skuId}-${line.warehouseId}-${line.batchNo ?? ''}`,
    }));
    form.value.details.forEach(recalcLine);
  }
});
</script>

<template>
  <el-form label-position="top" :disabled="isView">
    <div class="form-grid">
      <el-form-item label="调整原因" required class="span-2">
        <el-input v-model="form.reason" :disabled="isView" />
      </el-form-item>
      <el-form-item label="申请日期" required>
        <el-date-picker
          v-model="form.applicantDate"
          type="date"
          value-format="YYYY-MM-DD"
          :disabled="isView"
        />
      </el-form-item>
      <el-form-item label="经办人">
        <el-input :model-value="form.operatorName" disabled />
      </el-form-item>
      <el-form-item label="备注" class="span-all">
        <el-input v-model="form.remark" type="textarea" :rows="2" :disabled="isView" />
      </el-form-item>
    </div>

    <div class="details-header">
      <span class="details-title">调整明细</span>
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
            :disabled="lockStock"
            placeholder="请选择库存批次"
            @change="selectStock(s.row, $event)"
          >
            <el-option
              v-for="stock in options.stocks ?? []"
              :key="stockKeyOf(stock)"
              :label="stockLabel(stock)"
              :value="stockKeyOf(stock)"
            />
          </el-select>
        </template>
      </el-table-column>
      <el-table-column prop="warehouseName" label="仓库" width="110" />
      <el-table-column prop="unitName" label="单位" width="70" />
      <el-table-column label="调整前数量" width="105" align="right">
        <template #default="s">{{ qty(s.row.beforeQty ?? s.row.inventoryQty) }}</template>
      </el-table-column>
      <el-table-column label="调整类型" width="125">
        <template #default="s">
          <span v-if="isView" class="readonly-cell">{{ s.row.adjustTypeName || s.row.adjustType }}</span>
          <el-select v-else v-model="s.row.adjustType" @change="recalcLine(s.row)">
            <el-option
              v-for="item in dicts.adjustTypes"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </template>
      </el-table-column>
      <el-table-column label="调整数量" width="140">
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
      <el-table-column label="调整后数量" width="105" align="right">
        <template #default="s">{{ qty(s.row.afterQty) }}</template>
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
      <el-button :loading="saving" @click="save(false)">保存草稿</el-button>
      <el-button type="primary" :loading="saving" @click="save(true)">保存并提交审核</el-button>
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
.span-all {
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
