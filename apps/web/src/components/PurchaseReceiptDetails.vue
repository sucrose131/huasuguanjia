<script setup lang="ts">
import { computed } from 'vue';
import { dateText, display, moneyText } from '@/utils/format';

type UnitOption = { label: string; value: string | number };

const props = defineProps<{
  details: any[];
  units?: UnitOption[];
  readonly?: boolean;
  /** 记录级金额掩码：true 时单价/金额/合计统一显示 ¥ ****（脱敏单据） */
  amountHidden?: boolean;
}>();
const totalQuantity = computed(() =>
  props.details.reduce((sum, line) => sum + Number(line.inputQuantity ?? 0), 0),
);
const totalAmount = computed(() =>
  props.details.reduce(
    (sum, line) => sum + Number(line.inputQuantity ?? 0) * Number(line.unitPrice ?? 0),
    0,
  ),
);
const orderAmount = (line: any) => Number(line.orderQuantity ?? 0) * Number(line.unitPrice ?? 0);
const lineAmountText = (line: any) =>
  props.amountHidden ? '¥ ****' : `¥ ${moneyText(orderAmount(line))}`;
const unitPriceText = (line: any) =>
  props.amountHidden ? '¥ ****' : `¥ ${moneyText(line.unitPrice)}`;
const totalAmountText = computed(() =>
  props.amountHidden ? '¥ ****' : `¥ ${moneyText(totalAmount.value)}`,
);
const currentQuantity = (line: any) => Math.max(0, Number(line.inputQuantity ?? 0));
const arrivedQuantity = (line: any) =>
  props.readonly
    ? Number(line.arrivedQuantity ?? 0)
    : Number(line.baseArrivedQuantity ?? line.arrivedQuantity ?? 0) + currentQuantity(line);
const unarrivedQuantity = (line: any) =>
  props.readonly
    ? Number(line.unarrivedQuantity ?? 0)
    : Math.max(
        0,
        Number(line.baseUnarrivedQuantity ?? line.unarrivedQuantity ?? 0) - currentQuantity(line),
      );
const inputtedQuantity = (line: any) => Number(line.inputtedQuantity ?? 0);
const uninputtedQuantity = (line: any) =>
  props.readonly
    ? Number(line.uninputtedQuantity ?? 0)
    : Math.max(
        0,
        Number(line.baseUninputtedQuantity ?? line.uninputtedQuantity ?? 0) + currentQuantity(line),
      );
const unitName = (line: any) =>
  props.units?.find((item) => String(item.value) === String(line.unitType))?.label ??
  line.unitName ??
  '—';
</script>

<template>
  <section class="receipt-lines">
    <header class="receipt-title">
      <strong>入库明细</strong><span>{{ details.length }} 条</span>
    </header>
    <div class="receipt-head receipt-columns">
      <span>商品编码</span><span>商品名称</span><span>分类</span><span>规格型号</span
      ><span>单位</span><span>订单数量</span><span>单价</span><span>金额</span>
    </div>
    <div v-if="!details.length" class="receipt-empty">
      暂无可入库商品明细，请选择或更换来源采购订单
    </div>
    <article
      v-for="(line, index) in details"
      :key="String(line.id ?? `${line.goodsId}-${line.skuId}-${index}`)"
      class="receipt-line"
    >
      <div class="receipt-columns receipt-main">
        <div class="value-box">{{ display(line.goodsCode) }}</div>
        <div class="value-box product-name">{{ display(line.goodsName) }}</div>
        <div class="value-box">{{ display(line.categoryName) }}</div>
        <div class="value-box">{{ display(line.skuLabel ?? line.skuName) }}</div>
        <div class="value-box">{{ unitName(line) }}</div>
        <div class="value-box number">{{ line.orderQuantity }}</div>
        <div class="value-box number">{{ unitPriceText(line) }}</div>
        <div class="value-box number amount">{{ lineAmountText(line) }}</div>
      </div>
      <div class="receipt-business">
        <section class="progress-panel">
          <strong>到货进度 <small>（随实收自动计算）</small></strong>
          <div class="field-grid progress-fields">
            <label
              ><span>已到货</span><el-input :model-value="arrivedQuantity(line)" disabled
            /></label>
            <label
              ><span>未到货</span><el-input :model-value="unarrivedQuantity(line)" disabled
            /></label>
            <label
              ><span>已入库</span><el-input :model-value="inputtedQuantity(line)" disabled
            /></label>
            <label
              ><span>未入库</span><el-input :model-value="uninputtedQuantity(line)" disabled
            /></label>
            <label
              ><span>最近到货日期</span
              ><el-input :model-value="dateText(line.latestArrivalDate)" disabled
            /></label>
          </div>
        </section>
        <section class="accept-panel">
          <strong>本次验收</strong>
          <div class="field-grid accept-fields">
            <label
              ><span>实收数量</span
              ><el-input
                v-if="readonly"
                :model-value="line.inputQuantity"
                disabled /><el-input-number
                v-else
                v-model="line.inputQuantity"
                :min="1"
                :max="Math.max(1, Number(line.remainingQuantity))"
                :precision="0"
                :step="1"
                :controls="false"
            /></label>
            <label
              ><span>入库库位</span><el-input v-model="line.position" :disabled="readonly"
            /></label>
          </div>
        </section>
        <section class="trace-panel">
          <strong>批次追溯</strong>
          <div class="field-grid trace-fields">
            <label><span>批号</span><el-input v-model="line.batchNo" :disabled="readonly" /></label>
            <label
              ><span>生产日期</span
              ><el-input
                v-if="readonly"
                :model-value="dateText(line.productionDate)"
                disabled /><el-date-picker
                v-else
                v-model="line.productionDate"
                value-format="YYYY-MM-DD"
                placeholder="年 / 月 / 日"
            /></label>
            <label
              ><span>有效期</span
              ><el-input
                v-if="readonly"
                :model-value="dateText(line.validityPeriod)"
                disabled /><el-date-picker
                v-else
                v-model="line.validityPeriod"
                value-format="YYYY-MM-DD"
                placeholder="年 / 月 / 日"
            /></label>
          </div>
        </section>
      </div>
      <details class="material-extra">
        <summary>补充物料属性</summary>
        <div class="extra-content">
          <label
            ><span>生产厂家</span
            ><el-input :model-value="line.manufacturer ?? '—'" disabled /></label
          ><label><span>经销商</span><el-input :model-value="line.dealer ?? '—'" disabled /></label
          ><label
            ><span>物料类型</span
            ><el-input :model-value="line.materialType ?? '—'" disabled /></label
          ><label
            ><span>物料属性</span
            ><el-input :model-value="line.materialProp ?? '—'" disabled /></label
          ><label
            ><span>到货日期</span
            ><el-input
              v-if="readonly"
              :model-value="dateText(line.arrivalDate)"
              disabled /><el-date-picker
              v-else
              v-model="line.arrivalDate"
              value-format="YYYY-MM-DD"
              placeholder="年 / 月 / 日" /></label
          ><label
            ><span>明细备注</span><el-input v-model="line.remark" :disabled="readonly"
          /></label>
        </div>
      </details>
    </article>
    <footer v-if="details.length" class="receipt-total">
      <span>合计实收数</span><strong>{{ totalQuantity }}</strong
      ><span>合计金额</span><strong>{{ totalAmountText }}</strong>
    </footer>
  </section>
</template>

<style scoped>
.receipt-lines {
  container-name: receipt-details;
  container-type: inline-size;
  margin-top: 16px;
  border: 1px solid #dce2eb;
  border-radius: 4px;
  background: #fff;
  overflow: hidden;
  color: #172033;
  font-size: var(--hs-font-body);
  line-height: var(--hs-line-body);
}
.receipt-title {
  display: flex;
  gap: 8px;
  align-items: center;
  min-height: 40px;
  padding: 0 12px;
  border-bottom: 1px solid #dce2eb;
  background: #f7f9fc;
}
.receipt-title strong {
  font-size: var(--hs-font-section);
  line-height: var(--hs-line-section);
  font-weight: 600;
}
.receipt-title span {
  color: #8791a5;
  font-size: var(--hs-font-helper);
}
.receipt-columns {
  display: grid;
  grid-template-columns: 128px minmax(176px, 1.7fr) 112px 136px 72px 96px 112px 120px;
  gap: 8px;
  min-width: 960px;
  align-items: center;
}
.receipt-head {
  height: var(--hs-detail-header-height);
  padding: 0 12px;
  color: #667085;
  font-size: var(--hs-font-label);
  font-weight: 600;
}
.receipt-main {
  min-height: var(--hs-detail-row-height);
  padding: 5px 12px;
  border-top: 1px solid #dce2eb;
}
.value-box {
  min-height: var(--hs-detail-control-height);
  padding: 5px 8px;
  border: 1px solid #d8e0eb;
  border-radius: 4px;
  background: #f8fafc;
  color: #475467;
  font-size: var(--hs-font-body);
  line-height: 20px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.value-box.number {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.value-box.amount {
  font-weight: 600;
  color: #172033;
}
.receipt-line {
  border-bottom: 1px solid #dce2eb;
  overflow-x: auto;
}
.receipt-business {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(216px, 0.72fr) minmax(320px, 1.1fr);
  border-top: 1px solid #e4e8ef;
  background: #fbfcfe;
}
.receipt-business > section {
  min-width: 0;
  padding: 10px 12px;
  border-right: 1px solid #e4e8ef;
}
.receipt-business > section:last-child {
  border-right: 0;
}
.receipt-business strong {
  display: block;
  margin-bottom: 8px;
  color: #344054;
  font-size: var(--hs-font-section);
  line-height: var(--hs-line-section);
  font-weight: 600;
}
.receipt-business small {
  color: #7c8799;
  font-size: var(--hs-font-helper);
  font-weight: 400;
}
.field-grid {
  display: grid;
  gap: 8px;
}
.progress-fields {
  grid-template-columns: repeat(5, minmax(0, 1fr));
}
.accept-fields {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.trace-fields {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.field-grid label,
.extra-content label {
  min-width: 0;
}
.field-grid label > span,
.extra-content label > span {
  display: block;
  margin-bottom: 4px;
  color: #667085;
  font-size: var(--hs-font-label);
  line-height: var(--hs-line-label);
}
.field-grid :deep(.el-input-number),
.field-grid :deep(.el-date-editor),
.extra-content :deep(.el-date-editor) {
  width: 100%;
}
.field-grid :deep(.el-input__wrapper),
.field-grid :deep(.el-input-number .el-input__wrapper),
.extra-content :deep(.el-input__wrapper) {
  min-height: var(--hs-detail-control-height);
  font-size: var(--hs-font-body);
}
.field-grid :deep(.is-disabled),
.extra-content :deep(.is-disabled) {
  opacity: 1;
}
.field-grid :deep(.is-disabled .el-input__inner),
.extra-content :deep(.is-disabled .el-input__inner) {
  color: #475467;
  -webkit-text-fill-color: #475467;
}
.material-extra {
  padding: 8px 12px;
  color: #52627a;
  background: #fff;
}
.material-extra summary {
  cursor: pointer;
  font-size: var(--hs-font-body);
  font-weight: 600;
}
.extra-content {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px 12px;
  padding: 10px 0 2px;
  color: #667085;
}
.receipt-empty {
  padding: 32px 16px;
  text-align: center;
  color: #98a2b3;
  font-size: var(--hs-font-body);
}
.receipt-total {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  align-items: center;
  padding: 10px 12px;
  background: #fff;
  font-size: var(--hs-font-body);
}
.receipt-total span {
  color: #667085;
}
.receipt-total strong {
  margin-right: 12px;
  font-size: 14px;
}
@container receipt-details (max-width:919px) {
  .receipt-business {
    grid-template-columns: 1fr;
  }
  .receipt-business > section {
    border-right: 0;
    border-bottom: 1px solid #e4e8ef;
  }
  .receipt-business > section:last-child {
    border-bottom: 0;
  }
  .extra-content {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@container receipt-details (max-width:519px) {
  .progress-fields,
  .accept-fields,
  .trace-fields,
  .extra-content {
    grid-template-columns: 1fr;
  }
  .receipt-total {
    flex-wrap: wrap;
    justify-content: flex-start;
  }
}
</style>
