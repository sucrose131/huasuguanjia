<script setup lang="ts">
import { computed } from 'vue';
import { ElMessage } from 'element-plus';

type B = Record<string, any>;
const props = defineProps<{
  rows: B[];
  stocks: B[];
  editable: boolean;
  mode: 'execute' | 'supplement' | 'lab';
  goodsSelect?: B[];
  goodsEditable?: boolean;
}>();

const emit = defineEmits<{ (e: 'update:rows', v: B[]): void; (e: 'goodsChanged', row: B): void }>();

function stockFor(row: B) {
  return props.stocks.filter(
    (s: B) => String(s.goodsId) === String(row.goodsId) && String(s.skuId) === String(row.skuId),
  );
}

function batchChanged(row: B, br: B) {
  const s = props.stocks.find(
    (x: B) =>
      x.batchNo === br.batchNo &&
      String(x.goodsId) === String(row.goodsId) &&
      String(x.skuId) === String(row.skuId),
  );
  (br as B).avail = s ? Number(s.inventoryQty) : 0;
  (br as B).qty = 0;
}

function batchQuantityChanged(row: B, br: B, value: number | undefined) {
  if (props.mode !== 'execute') return;
  const planQty = Number(row.planQty ?? 0);
  const otherQty = (row.batchRows ?? [])
    .filter((item: B) => item !== br)
    .reduce((sum: number, item: B) => sum + Number(item.qty ?? 0), 0);
  const currentQty = Number(value ?? 0);
  if (otherQty + currentQty <= planQty + 0.000001) return;
  br.qty = Math.max(0, Math.min(Number(br.avail ?? 0), planQty - otherQty));
  ElMessage.warning(
    `${row.goodsName || '当前原料'}：各批号出库数量合计不能超过计划出库量 ${planQty}`,
  );
}

function addBatchRow(row: B) {
  if (!row.batchRows) row.batchRows = [];
  row.batchRows.push({ batchNo: '', avail: 0, qty: 0 });
}

function removeBatchRow(row: B, idx: number) {
  if (row.batchRows && row.batchRows.length > 1) row.batchRows.splice(idx, 1);
}

function addGoodsRow() {
  const nr = {
    goodsId: '',
    skuId: '',
    goodsCode: '',
    goodsName: '',
    skuSpec: '',
    unitName: '',
    stockQty: 0,
    batchRows: [{ batchNo: '', avail: 0, qty: 0 }],
  };
  emit('update:rows', [...props.rows, nr]);
}

function removeGoodsRow(idx: number) {
  if (props.rows.length <= 1) return;
  const nr = [...props.rows];
  nr.splice(idx, 1);
  emit('update:rows', nr);
}

const allBatchRows = computed(() => {
  const result: B[] = [];
  for (let rowIndex = 0; rowIndex < props.rows.length; rowIndex++) {
    const row = props.rows[rowIndex]!;
    const brs = row.batchRows || [{ batchNo: '', avail: 0, qty: 0 }];
    for (let i = 0; i < brs.length; i++) {
      result.push({ ...row, _source: row, _ri: rowIndex, _bi: i, _br: brs[i], _len: brs.length });
    }
  }
  return result;
});

const totalQty = computed(() =>
  props.rows.reduce(
    (s, r) => s + (r.batchRows || []).reduce((ss: number, g: B) => ss + Number(g.qty), 0),
    0,
  ),
);

const labHeads = ['商品编码', '商品名称', '规格', '单位', '当前库存', '批号', '出库数量', '操作'];
const execHeads = [
  '原料编码',
  '原料名称',
  '规格',
  '单位',
  'BOM单件用量',
  '总需求数量',
  '当前库存',
  '计划出库量',
  '批号',
  '出库数量',
  '操作',
];
const supplHeads = [
  '原料编码',
  '原料名称',
  '规格',
  '单位',
  '当前库存',
  '计划出库量',
  '已补',
  '批号',
  '补料数量',
  '操作',
];

const heads = computed(() => {
  const source =
    props.mode === 'execute' ? execHeads : props.mode === 'supplement' ? supplHeads : labHeads;
  return props.editable ? source : source.filter((head) => head !== '操作');
});

interface HeadWidth {
  [key: string]: string;
}
const w: HeadWidth = {
  原料编码: '120px',
  原料名称: '184px',
  规格: '144px',
  单位: '72px',
  BOM单件用量: '104px',
  总需求数量: '104px',
  当前库存: '96px',
  计划出库量: '112px',
  已补: '88px',
  批号: '216px',
  出库数量: '120px',
  补料数量: '120px',
  操作: '128px',
  商品编码: '120px',
  商品名称: '200px',
};
function wd(h: string) {
  return w[h] || '80px';
}
const tableWidth = computed(() =>
  heads.value.reduce((sum, head) => sum + Number.parseInt(wd(head), 10), 0),
);
</script>

<template>
  <div class="bmt-scroll">
    <div class="bmt-wrap" :style="{ width: `${tableWidth}px`, minWidth: '100%' }">
      <div class="bmt-thead">
        <div
          v-for="h in heads"
          :key="h"
          :class="['bmt-th', { 'bmt-th-actions': h === '操作' }]"
          :style="{ width: wd(h) }"
        >
          {{ h }}
        </div>
      </div>

      <div
        v-for="(r, ri) in allBatchRows"
        :key="`${ri}`"
        :class="['bmt-row', { 'bmt-row-end': r._bi === (r._len as number) - 1 }]"
      >
        <template v-if="mode === 'execute'">
          <template v-if="r._bi === 0">
            <div class="bmt-c muted" :style="{ width: wd('原料编码') }">{{ r.goodsCode }}</div>
            <div class="bmt-c bmt-bold" :style="{ width: wd('原料名称') }">{{ r.goodsName }}</div>
            <div class="bmt-c muted" :style="{ width: wd('规格') }">{{ r.skuSpec || '—' }}</div>
            <div class="bmt-c muted" :style="{ width: wd('单位') }">{{ r.unitName || '—' }}</div>
            <div class="bmt-c muted" :style="{ width: wd('BOM单件用量') }">{{ r.bomUnitQty }}</div>
            <div class="bmt-c muted" :style="{ width: wd('总需求数量') }">{{ r.totalDemand }}</div>
            <div class="bmt-c muted" :style="{ width: wd('当前库存') }">{{ r.stockQty }}</div>
            <div class="bmt-c" :style="{ width: wd('计划出库量') }">
              <strong>{{ r.planQty }}</strong
              ><br v-if="r._len > 1" /><small v-if="r._len > 1"
                >已分配
                {{
                  (r.batchRows || []).reduce((s: number, g: B) => s + Number(g.qty), 0).toFixed(4)
                }}</small
              >
            </div>
          </template>
          <template v-else>
            <div class="bmt-c muted bmt-sub" :style="{ width: wd('原料编码') }"></div>
            <div class="bmt-c muted bmt-sub" :style="{ width: wd('原料名称') }">批号子行</div>
            <div class="bmt-c muted bmt-sub" :style="{ width: wd('规格') }"></div>
            <div class="bmt-c muted bmt-sub" :style="{ width: wd('单位') }"></div>
            <div class="bmt-c muted bmt-sub" :style="{ width: wd('BOM单件用量') }"></div>
            <div class="bmt-c muted bmt-sub" :style="{ width: wd('总需求数量') }"></div>
            <div class="bmt-c muted bmt-sub" :style="{ width: wd('当前库存') }"></div>
            <div class="bmt-c bmt-sub" :style="{ width: wd('计划出库量') }"></div>
          </template>
        </template>

        <template v-else-if="mode === 'supplement'">
          <template v-if="r._bi === 0">
            <div class="bmt-c muted" :style="{ width: wd('原料编码') }">{{ r.goodsCode }}</div>
            <div class="bmt-c bmt-bold" :style="{ width: wd('原料名称') }">{{ r.goodsName }}</div>
            <div class="bmt-c muted" :style="{ width: wd('规格') }">{{ r.skuSpec || '—' }}</div>
            <div class="bmt-c muted" :style="{ width: wd('单位') }">{{ r.unitName || '—' }}</div>
            <div class="bmt-c muted" :style="{ width: wd('当前库存') }">{{ r.stockQty }}</div>
            <div class="bmt-c muted" :style="{ width: wd('计划出库量') }">{{ r.planQty }}</div>
            <div class="bmt-c muted" :style="{ width: wd('已补') }">{{ r.alreadySupplied }}</div>
          </template>
          <template v-else>
            <div class="bmt-c muted bmt-sub" :style="{ width: wd('原料编码') }"></div>
            <div class="bmt-c muted bmt-sub" :style="{ width: wd('原料名称') }">批号子行</div>
            <div class="bmt-c muted bmt-sub" :style="{ width: wd('规格') }"></div>
            <div class="bmt-c muted bmt-sub" :style="{ width: wd('单位') }"></div>
            <div class="bmt-c muted bmt-sub" :style="{ width: wd('当前库存') }"></div>
            <div class="bmt-c muted bmt-sub" :style="{ width: wd('计划出库量') }"></div>
            <div class="bmt-c muted bmt-sub" :style="{ width: wd('已补') }"></div>
          </template>
        </template>

        <template v-else>
          <template v-if="r._bi === 0">
            <div class="bmt-c muted" :style="{ width: wd('商品编码') }">{{ r.goodsCode }}</div>
            <div class="bmt-c bmt-bold" :style="{ width: wd('商品名称') }">
              <template v-if="editable && goodsEditable">
                <el-select
                  v-model="r._source.goodsId"
                  size="small"
                  filterable
                  style="width: 100%"
                  clearable
                  @change="$emit('goodsChanged', r._source)"
                >
                  <el-option
                    v-for="g in goodsSelect || []"
                    :key="g.id"
                    :label="g.goodsName"
                    :value="g.id"
                  />
                </el-select>
                <el-button
                  v-if="rows.length > 1"
                  link
                  type="danger"
                  size="small"
                  @click="removeGoodsRow(r._ri)"
                  >删除</el-button
                >
              </template>
              <template v-else>{{ r.goodsName }}</template>
            </div>
            <div class="bmt-c muted" :style="{ width: wd('规格') }">{{ r.skuSpec || '—' }}</div>
            <div class="bmt-c muted" :style="{ width: wd('单位') }">{{ r.unitName || '—' }}</div>
            <div class="bmt-c muted" :style="{ width: wd('当前库存') }">{{ r.stockQty }}</div>
          </template>
          <template v-else>
            <div class="bmt-c muted bmt-sub" :style="{ width: wd('商品编码') }"></div>
            <div class="bmt-c muted bmt-sub" :style="{ width: wd('商品名称') }">批号子行</div>
            <div class="bmt-c muted bmt-sub" :style="{ width: wd('规格') }"></div>
            <div class="bmt-c muted bmt-sub" :style="{ width: wd('单位') }"></div>
            <div class="bmt-c muted bmt-sub" :style="{ width: wd('当前库存') }"></div>
          </template>
        </template>

        <!-- Batch controls: same for all modes -->
        <div class="bmt-c" :style="{ width: wd('批号') }">
          <el-select
            v-if="editable"
            v-model="r._br.batchNo"
            size="small"
            style="width: 100%"
            @change="batchChanged(r, r._br)"
          >
            <el-option
              v-for="s in stockFor(r)"
              :key="s.batchNo"
              :label="`${s.batchNo} · 可用${s.inventoryQty}`"
              :value="s.batchNo"
            />
          </el-select>
          <span v-else class="bmt-readonly-value">{{ r._br.batchNo || '—' }}</span>
        </div>
        <div class="bmt-c" :style="{ width: wd(mode === 'supplement' ? '补料数量' : '出库数量') }">
          <el-input-number
            v-if="editable"
            v-model="r._br.qty"
            :min="0"
            :max="Number(r._br.avail)"
            :precision="0"
            :step="1"
            size="small"
            controls-position="right"
            style="width: 100%"
            @change="(value: number | undefined) => batchQuantityChanged(r._source, r._br, value)"
          />
          <span v-else class="bmt-readonly-number">{{
            Number(r._br.qty || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 })
          }}</span>
        </div>
        <div v-if="editable" class="bmt-c bmt-acts" :style="{ width: wd('操作') }">
          <template v-if="r._bi === 0">
            <el-button link type="primary" size="small" @click="addBatchRow(r)">增加批号</el-button>
            <el-button
              v-if="r._len > 1 && Number(r._br.qty) > 0"
              link
              type="danger"
              size="small"
              @click="r._br.qty = 0"
              >清空</el-button
            >
          </template>
          <template v-else>
            <el-button
              v-if="r._bi > 0"
              link
              type="danger"
              size="small"
              @click="removeBatchRow(r, r._bi)"
              >删除</el-button
            >
          </template>
        </div>
      </div>
    </div>
  </div>

  <div v-if="mode === 'lab' && editable && goodsEditable" class="bmt-foot">
    <el-button link type="primary" @click="addGoodsRow">添加明细行</el-button>
    <span class="bmt-total">合计数量 {{ totalQty }}</span>
  </div>
</template>

<style scoped>
.bmt-scroll {
  width: 100%;
  overflow-x: auto;
  border: 1px solid #e5e9f0;
  border-radius: 4px;
}
.bmt-wrap {
  overflow: hidden;
  background: #fff;
}
.bmt-thead {
  display: flex;
  background: #f7f9fc;
  border-bottom: 1px solid #e5e9f0;
}
.bmt-th {
  flex: 0 0 auto;
  box-sizing: border-box;
  min-height: 40px;
  padding: 0 10px;
  font-size: 11px;
  font-weight: 700;
  color: #5f6b7c;
  border-right: 1px solid #e5e9f0;
  white-space: nowrap;
  display: flex;
  align-items: center;
}
.bmt-th:last-child {
  border-right: none;
}
.bmt-th-actions {
  position: sticky;
  right: 0;
  z-index: 3;
  border-left: 1px solid #e5e9f0;
  background: #f7f9fc;
  box-shadow: -4px 0 8px rgb(31 42 68 / 5%);
}
.bmt-row {
  display: flex;
  border-bottom: 1px solid #f0f2f5;
}
.bmt-row-end {
  border-bottom: 1px solid #e5e9f0;
}
.bmt-row:last-child {
  border-bottom: none;
}
.bmt-c {
  flex: 0 0 auto;
  box-sizing: border-box;
  min-height: 50px;
  padding: 6px 10px;
  font-size: 12px;
  color: #1f2a44;
  display: flex;
  align-items: center;
  border-right: 1px solid #f0f2f5;
  gap: 4px;
  overflow: hidden;
}
.bmt-c:last-child {
  border-right: none;
}
.bmt-c.muted {
  color: #8a94a6;
}
.bmt-bold {
  font-weight: 600;
}
.bmt-sub {
  background: #fcfdfe;
}
.bmt-acts {
  position: sticky;
  right: 0;
  z-index: 2;
  gap: 4px;
  border-left: 1px solid #f0f2f5;
  background: #fff;
  white-space: nowrap;
  box-shadow: -4px 0 8px rgb(31 42 68 / 5%);
}
.bmt-sub + .bmt-acts {
  background: #fcfdfe;
}
.bmt-readonly-value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bmt-readonly-number {
  width: 100%;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.bmt-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0;
}
.bmt-total {
  color: #1f2a44;
  font-weight: 700;
}
</style>
