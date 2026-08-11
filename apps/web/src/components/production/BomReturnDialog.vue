<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '@/api';
import { dateText } from '@/utils/format';
import DocumentAttachments from '@/components/DocumentAttachments.vue';
import { createRequestId } from '@/utils/random-id';

type B = Record<string, any>;

const props = defineProps<{ modelValue: boolean; outRow: B }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void; (e: 'done'): void }>();
const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const source = ref<B>({});
const rows = ref<B[]>([]);
const histories = ref<B[]>([]);
const historyDetails = reactive<Record<string, B[]>>({});
const historyLoading = reactive<Record<string, boolean>>({});
const savedId = ref('');
const attachmentDocumentId = ref('');
const attachmentDocumentNo = ref('');
const form = reactive({
  requestKey: '',
  returnDate: '',
  returnReason: '',
  remark: '',
});

function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
}

async function load() {
  if (!props.outRow?.id) return;
  loading.value = true;
  error.value = '';
  savedId.value = '';
  attachmentDocumentId.value = '';
  attachmentDocumentNo.value = '';
  Object.assign(form, {
    requestKey: createRequestId(),
    returnDate: localDate(),
    returnReason: '',
    remark: '',
  });
  try {
    const data: any = await api.get(
      `/production/material-returns/source/${props.outRow.id}/available`,
    );
    source.value = data;
    histories.value = data.histories ?? [];
    rows.value = (data.details ?? []).map((line: B) => ({
      ...line,
      returnQty: Number(line.remainingQty ?? 0),
      storageLocation: '',
      remark: '',
    }));
  } catch (reason: any) {
    error.value = reason.response?.data?.message ?? 'BOM可退物料加载失败';
  } finally {
    loading.value = false;
  }
}

const selectedQty = computed(() =>
  rows.value.reduce((sum, line) => sum + Math.max(0, Number(line.returnQty ?? 0)), 0),
);

function payload() {
  if (!form.returnReason.trim()) throw new Error('请填写退库原因');
  const details = rows.value
    .filter((line) => Number(line.returnQty) > 0)
    .map((line) => ({
      sourceOutDetailId: line.sourceOutDetailId,
      returnQty: Number(line.returnQty),
      storageLocation: String(line.storageLocation ?? '').trim(),
      remark: String(line.remark ?? ''),
    }));
  if (!details.length) throw new Error('至少保留一条退库数量');
  for (const line of rows.value) {
    const quantity = Number(line.returnQty ?? 0);
    if (!Number.isInteger(quantity) || quantity < 0)
      throw new Error(`${line.goodsName || '物料'}：退库数量必须为非负整数`);
    if (quantity > Number(line.remainingQty ?? 0))
      throw new Error(`${line.goodsName || '物料'}：退库数量不能超过当前可退数量`);
  }
  return {
    requestKey: form.requestKey,
    sourceOutId: source.value.id,
    returnDate: form.returnDate,
    returnReason: form.returnReason.trim(),
    remark: form.remark,
    details,
  };
}

async function save(complete: boolean) {
  saving.value = true;
  error.value = '';
  try {
    const body = payload();
    const result: any = savedId.value
      ? await api.patch(`/production/material-returns/${savedId.value}`, body)
      : await api.post('/production/material-returns', body);
    savedId.value = String(result.id);
    if (complete) {
      await ElMessageBox.confirm(
        `确认退回 ${selectedQty.value} 件物料至原仓库「${source.value.warehouseName}」？完成后立即增加库存。`,
        '确认BOM退库',
        { type: 'warning' },
      );
      const completed: any = await api.post(
        `/production/material-returns/${savedId.value}/confirm`,
      );
      ElMessage.success(completed.message ?? 'BOM退库已完成');
      visible.value = false;
      emit('done');
      return;
    }
    ElMessage.success(result.message ?? 'BOM退库草稿已保存');
    await loadHistoriesOnly();
  } catch (reason: any) {
    if (reason === 'cancel' || reason === 'close') return;
    error.value = reason.response?.data?.message ?? reason.message ?? '保存失败';
  } finally {
    saving.value = false;
  }
}

async function loadHistoriesOnly() {
  const data: any = await api.get('/production/material-returns', {
    params: { sourceOutId: source.value.id, pageSize: 100 },
  });
  histories.value = data.items ?? [];
}

async function expandHistory(row: B, expanded: B[]) {
  const key = String(row.id);
  if (!expanded.some((item) => String(item.id) === key) || historyDetails[key]) return;
  historyLoading[key] = true;
  try {
    const detail: any = await api.get(`/production/material-returns/${row.id}`);
    historyDetails[key] = detail.details ?? [];
  } finally {
    historyLoading[key] = false;
  }
}

async function confirmDraft(row: B) {
  await ElMessageBox.confirm('确认后立即增加原出库仓库库存，是否继续？', '确认BOM退库', {
    type: 'warning',
  });
  const result: any = await api.post(`/production/material-returns/${row.id}/confirm`);
  ElMessage.success(result.message ?? 'BOM退库已完成');
  await load();
  emit('done');
}

async function voidDraft(row: B) {
  await ElMessageBox.confirm('作废后将释放该草稿占用的可退数量，是否继续？', '作废BOM退库草稿', {
    type: 'warning',
  });
  const result: any = await api.post(`/production/material-returns/${row.id}/void`);
  ElMessage.success(result.message ?? 'BOM退库草稿已作废');
  await load();
  emit('done');
}

async function reverseCompleted(row: B) {
  const result = await ElMessageBox.prompt(
    '冲正会从原退回仓库按原商品、SKU和批号扣减库存；库存不足时不会执行。',
    '冲正已完成BOM退库',
    {
      confirmButtonText: '确认冲正',
      cancelButtonText: '取消',
      inputPlaceholder: '请输入冲正原因',
      inputValidator: (value) => Boolean(String(value ?? '').trim()) || '冲正原因必填',
      type: 'warning',
    },
  );
  const response: any = await api.post(`/production/material-returns/${row.id}/reverse`, {
    reversalReason: String(result.value).trim(),
  });
  ElMessage.success(response.message ?? 'BOM退库已冲正');
  await load();
  emit('done');
}

function showHistoryAttachments(row: B) {
  attachmentDocumentId.value = String(row.id);
  attachmentDocumentNo.value = String(row.returnNo ?? row.id);
}

watch(visible, (value) => {
  if (value) load();
});
</script>

<template>
  <el-dialog
    v-model="visible"
    title="BOM物料退库"
    width="min(1280px, calc(100vw - 32px))"
    top="3vh"
    :close-on-click-modal="false"
  >
    <div v-if="loading" class="bom-return-loading">加载中…</div>
    <template v-else>
      <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" />
      <div class="bom-return-master">
        <div>
          <span>原BOM出库单</span><strong>{{ source.outNo || outRow.outNo || '—' }}</strong>
        </div>
        <div>
          <span>退回仓库</span><strong>{{ source.warehouseName || '—' }}</strong>
        </div>
        <div>
          <span>当前可退总量</span><strong>{{ source.returnableQty ?? 0 }}</strong>
        </div>
        <div>
          <span>退库日期</span>
          <el-date-picker v-model="form.returnDate" type="date" value-format="YYYY-MM-DD" />
        </div>
        <div class="bom-return-wide">
          <span>退库原因</span>
          <el-input v-model="form.returnReason" maxlength="255" show-word-limit />
        </div>
        <div class="bom-return-wide">
          <span>备注</span><el-input v-model="form.remark" maxlength="255" />
        </div>
      </div>

      <div class="bom-return-title">本次退库物料（默认带出全部剩余量，可改小或填0）</div>
      <el-table :data="rows" border max-height="330">
        <el-table-column prop="goodsCode" label="商品编码" width="120" />
        <el-table-column prop="goodsName" label="商品名称" min-width="150" />
        <el-table-column prop="skuSpec" label="SKU规格" min-width="140" />
        <el-table-column prop="batchNo" label="批号" width="140" />
        <el-table-column prop="unitName" label="单位" width="75" />
        <el-table-column prop="sourceOutputQty" label="原出库" width="82" align="right" />
        <el-table-column prop="returnedQty" label="已退" width="72" align="right" />
        <el-table-column prop="occupiedQty" label="草稿占用" width="90" align="right" />
        <el-table-column prop="remainingQty" label="当前可退" width="92" align="right" />
        <el-table-column label="本次退库" width="145">
          <template #default="scope">
            <el-input-number
              v-model="scope.row.returnQty"
              :min="0"
              :max="Number(scope.row.remainingQty)"
              :step="1"
              step-strictly
              controls-position="right"
            />
          </template>
        </el-table-column>
        <el-table-column label="退回库位" min-width="150">
          <template #default="scope">
            <el-input
              v-model="scope.row.storageLocation"
              maxlength="255"
              placeholder="可选，自由文本"
            />
          </template>
        </el-table-column>
      </el-table>

      <DocumentAttachments
        v-if="savedId"
        document-type="production_material_return"
        :document-id="savedId"
      />

      <div class="bom-return-title">历次退库记录</div>
      <el-table
        :data="histories"
        border
        max-height="280"
        row-key="id"
        @expand-change="expandHistory"
      >
        <el-table-column type="expand">
          <template #default="scope">
            <div v-loading="historyLoading[String(scope.row.id)]" class="history-lines">
              <el-table :data="historyDetails[String(scope.row.id)] ?? []" border size="small">
                <el-table-column prop="goodsName" label="商品" min-width="150" />
                <el-table-column prop="skuSpec" label="SKU规格" min-width="140" />
                <el-table-column prop="batchNo" label="批号" width="140" />
                <el-table-column prop="returnQty" label="退库数量" width="100" align="right" />
                <el-table-column prop="storageLocation" label="退回库位" min-width="140" />
              </el-table>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="id" label="ID" width="90" />
        <el-table-column prop="returnNo" label="退库单号" width="170" />
        <el-table-column label="退库日期" width="120"
          ><template #default="scope">{{
            dateText(scope.row.returnDate)
          }}</template></el-table-column
        >
        <el-table-column prop="totalQty" label="数量" width="80" align="right" />
        <el-table-column
          prop="returnReason"
          label="退库原因"
          min-width="180"
          show-overflow-tooltip
        />
        <el-table-column
          prop="reversalReason"
          label="冲正原因"
          min-width="160"
          show-overflow-tooltip
        />
        <el-table-column prop="statusName" label="状态" width="90" />
        <el-table-column label="操作" width="235">
          <template #default="scope">
            <el-button link type="primary" @click="showHistoryAttachments(scope.row)"
              >附件</el-button
            >
            <el-button
              v-if="Number(scope.row.status) === 0"
              link
              type="success"
              @click="confirmDraft(scope.row)"
              >完成</el-button
            >
            <el-button
              v-if="Number(scope.row.status) === 0"
              link
              type="danger"
              @click="voidDraft(scope.row)"
              >作废</el-button
            >
            <el-button
              v-if="Number(scope.row.status) === 1"
              link
              type="warning"
              @click="reverseCompleted(scope.row)"
              >冲正</el-button
            >
          </template>
        </el-table-column>
      </el-table>
      <div v-if="attachmentDocumentId">
        <div class="bom-return-title">退库单 {{ attachmentDocumentNo }} 的附件</div>
        <DocumentAttachments
          document-type="production_material_return"
          :document-id="attachmentDocumentId"
        />
      </div>
    </template>
    <template #footer>
      <span class="bom-return-summary">本次合计 {{ selectedQty }} 件</span>
      <el-button @click="visible = false">关闭</el-button>
      <el-button
        type="primary"
        plain
        :loading="saving"
        :disabled="!source.returnableQty"
        @click="save(false)"
        >保存草稿</el-button
      >
      <el-button
        type="success"
        :loading="saving"
        :disabled="!source.returnableQty"
        @click="save(true)"
        >确认退库</el-button
      >
    </template>
  </el-dialog>
</template>

<style scoped>
.bom-return-loading {
  padding: 48px;
  text-align: center;
}
.bom-return-master {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px 20px;
  margin: 14px 0 18px;
}
.bom-return-master > div {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.bom-return-master span {
  flex: 0 0 86px;
  color: var(--el-text-color-secondary);
}
.bom-return-master strong {
  overflow: hidden;
  text-overflow: ellipsis;
}
.bom-return-master .bom-return-wide {
  grid-column: span 2;
}
.bom-return-title {
  margin: 18px 0 10px;
  font-weight: 600;
}
.history-lines {
  padding: 10px 18px;
  min-height: 70px;
}
.bom-return-summary {
  margin-right: 18px;
  font-weight: 600;
}
@media (max-width: 900px) {
  .bom-return-master {
    grid-template-columns: 1fr;
  }
  .bom-return-master .bom-return-wide {
    grid-column: auto;
  }
}
</style>
