<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '@/api';
import { buildCategoryTree } from '@/utils/category-tree';

const props = defineProps<{ canEditAmount: boolean }>();
const emit = defineEmits<{
  (e: 'selected-existing', line: any, goods: any): void;
  (e: 'staged', line: any): void;
}>();

const visible = ref(false);
const checking = ref(false);
const mode = ref<'goods' | 'sku'>('goods');
const currentLine = ref<any>(null);
const form = reactive<Record<string, any>>({});
const options = reactive<Record<string, any[]>>({ categories: [], units: [], warehouseTypes: [] });
const treeProps = { value: 'id', label: 'name', children: 'children', disabled: 'disabled' };
const markCategories = (nodes: any[]): any[] =>
  nodes.map((item: any) => ({
    ...item,
    disabled: Number(item.status) !== 1 || Number(item.warehouseType) <= 0,
    children: markCategories(item.children ?? []),
  }));
const categoryTree = computed(() => markCategories(buildCategoryTree(options.categories ?? [])));

function open(line: any, kind: 'goods' | 'sku', goodsName = '') {
  mode.value = kind;
  currentLine.value = line;
  Object.keys(form).forEach((key) => delete form[key]);
  Object.assign(form, {
    goodsName,
    categoryId: '',
    unitType: Number(line.unitType ?? 0) || '',
    specModels: '',
    costPrice: Number(line.unitPrice ?? 0),
    salePrice: 0,
    pcsQty: 1,
  });
  visible.value = true;
}

function warehouseTypeText(value: unknown) {
  return (options.warehouseTypes ?? []).find((item: any) => String(item.value) === String(value))?.label || `仓库类型 ${value}`;
}

async function explainUnavailable(result: any, goodsName: string) {
  const categoryText = result.categoryName ? `，所属分类为“${result.categoryName}”` : '';
  const messages: Record<string, string> = {
    warehouse_type_unavailable: `全局商品主档中已经存在“${goodsName}”${categoryText}，要求使用“${warehouseTypeText(result.warehouseType)}”。当前组织没有启用该类型仓库，因此不能使用，也不能重复新增。请先配置对应类型仓库，或联系管理员调整商品分类。`,
    goods_disabled: `全局商品主档中已经存在“${goodsName}”，但商品当前已停用，不能使用，也不能重复新增。请联系商品管理员恢复。`,
    goods_deleted: `全局商品主档中已经存在“${goodsName}”的历史档案，不能重复新增。请联系商品管理员恢复或处理原档案。`,
    category_disabled: `全局商品主档中已经存在“${goodsName}”${categoryText}，但该分类当前已停用，不能使用，也不能重复新增。`,
    category_deleted: `全局商品主档中已经存在“${goodsName}”，但其分类当前不可用，不能重复新增。`,
  };
  await ElMessageBox.alert(
    messages[result.reason] ?? `全局商品主档中已经存在“${goodsName}”，当前不可使用，也不能重复新增。`,
    '商品已存在但当前不可用',
    { confirmButtonText: '我知道了', type: 'warning' },
  ).catch(() => undefined);
}

async function stage() {
  const line = currentLine.value;
  if (!line) return;
  if (mode.value === 'goods') {
    const goodsName = String(form.goodsName ?? '').trim();
    if (!goodsName || !form.categoryId || !form.unitType) {
      ElMessage.warning('请填写商品名称、分类和基础单位');
      return;
    }
    checking.value = true;
    try {
      const availability: any = await api.get('/goods/name-availability', { params: { name: goodsName } });
      if (availability.exists) {
        if (availability.usable && availability.goods?.id) {
          emit('selected-existing', line, availability.goods);
          visible.value = false;
          ElMessage.success(`商品“${availability.goods.goodsName}”已存在，已为你选择现有商品`);
        } else await explainUnavailable(availability, goodsName);
        return;
      }
      const category = (options.categories ?? []).find((item: any) => String(item.id) === String(form.categoryId));
      const token = `quick-goods-${Date.now()}-${Math.random()}`;
      line.newGoods = { goodsName, categoryId: form.categoryId, unitType: Number(form.unitType) };
      line.newSku = { specModels: '默认规格', unitType: Number(form.unitType), pcsQty: 1, costPrice: 0, salePrice: 0 };
      line.goodsId = token;
      line.skuId = `${token}-sku`;
      line.goodsName = goodsName;
      line.skuSpec = '默认规格';
      line.unitType = Number(form.unitType);
      line.goodsWarehouseType = Number(category?.warehouseType ?? 0);
    } catch (e: any) {
      ElMessage.error(e.response?.data?.message ?? '全局商品名称检查失败，请稍后重试');
      return;
    } finally {
      checking.value = false;
    }
  } else {
    const specModels = String(form.specModels ?? '').trim();
    if (!specModels || !form.unitType) {
      ElMessage.warning('请填写 SKU 规格和单位');
      return;
    }
    const duplicate = [line.skuSpec, ...(line.skuOptions ?? []).map((item: any) => item.label)]
      .some((label: unknown) => String(label ?? '').trim().toLocaleLowerCase() === specModels.toLocaleLowerCase());
    if (duplicate) {
      ElMessage.warning('该 SKU 规格已存在，请直接选择已有 SKU');
      return;
    }
    line.newSku = { ...form, specModels };
    line.skuId = `quick-sku-${Date.now()}-${Math.random()}`;
    line.skuSpec = specModels;
    line.unitType = Number(form.unitType);
  }
  emit('staged', line);
  visible.value = false;
}

onMounted(async () => {
  const [categories, units, warehouseTypes] = await Promise.all([
    api.get('/goods/categories').catch(() => ({ items: [] })),
    api.get('/base-data/units/options').catch(() => []),
    api.get('/dictionaries/warehouse_type').catch(() => []),
  ]);
  options.categories = (categories as any).items ?? [];
  options.units = units as any[];
  options.warehouseTypes = warehouseTypes as any[];
});

defineExpose({ open });
</script>

<template>
  <el-dialog v-model="visible" :title="mode === 'goods' ? '快捷新增商品' : '单据内补充 SKU'" width="620" append-to-body>
    <el-alert title="当前内容仅暂存在单据行中；保存或提交单据成功时才会创建正式商品/SKU档案。" type="info" :closable="false" style="margin-bottom: 14px" />
    <el-form label-position="top">
      <div class="master-grid">
        <el-form-item v-if="mode === 'goods'" label="商品名称" required><el-input v-model="form.goodsName" /></el-form-item>
        <el-form-item v-if="mode === 'goods'" label="商品分类" required>
          <el-tree-select v-model="form.categoryId" :data="categoryTree" :props="treeProps" filterable check-strictly default-expand-all style="width: 100%" />
        </el-form-item>
        <el-form-item label="基础单位" required>
          <el-select v-model="form.unitType" filterable style="width: 100%">
            <el-option v-for="item in options.units" :key="item.value" :label="item.label" :value="Number(item.value)" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="mode === 'sku'" label="SKU规格"><el-input v-model="form.specModels" placeholder="留空则使用“默认规格”" /></el-form-item>
        <el-form-item v-if="mode === 'sku'" label="每业务单位基础件数" required><el-input-number v-model="form.pcsQty" :min="1" :precision="0" style="width: 100%" /></el-form-item>
        <el-form-item v-if="mode === 'sku'" label="基础件成本"><el-input-number v-model="form.costPrice" :disabled="!props.canEditAmount" :min="0" :precision="2" style="width: 100%" /></el-form-item>
        <el-form-item v-if="mode === 'sku'" label="销售价"><el-input-number v-model="form.salePrice" :disabled="!props.canEditAmount" :min="0" :precision="2" style="width: 100%" /></el-form-item>
      </div>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="checking" @click="stage">暂存到单据行</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.master-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0 16px; }
</style>
