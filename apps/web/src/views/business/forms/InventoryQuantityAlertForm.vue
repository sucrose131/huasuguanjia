<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '@/api';

const props = defineProps<{
  modelValue: Record<string, any>;
  mode: 'create' | 'edit' | 'view';
}>();
const emit = defineEmits<{ (e: 'saved'): void; (e: 'cancel'): void }>();

const form = computed(() => props.modelValue);
const saving = ref(false);
const isView = computed(() => props.mode === 'view');

async function save() {
  const safeQty = Number(form.value.safeQty ?? 0);
  const purchaseQty = Number(form.value.purchaseQty ?? 0);
  if (safeQty < 0 || purchaseQty < 0) {
    ElMessage.warning('安全库存和建议补货数量不能小于0');
    return;
  }
  saving.value = true;
  try {
    const result: any = await api.post('/inventory/quantity-alerts', {
      orgId: form.value.orgId,
      warehouseId: form.value.warehouseId,
      goodsId: form.value.goodsId,
      skuId: form.value.skuId,
      safeQty,
      purchaseQty,
    });
    ElMessage.success(result?.message ?? '库存预警配置已保存');
    emit('saved');
  } catch {
    // axios 拦截器已提示
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="alert-summary">
    <strong>{{ form.goodsCode || '—' }} · {{ form.goodsName || '—' }}</strong>
    <span>{{ form.skuSpec || '默认规格' }} · {{ form.warehouseName || '—' }}</span>
  </div>
  <el-form label-position="top" :disabled="isView">
    <div class="form-grid">
      <el-form-item label="当前实际库存">
        <el-input
          :model-value="Number(form.factQty ?? 0).toLocaleString('zh-CN', { maximumFractionDigits: 4 })"
          disabled
        />
      </el-form-item>
      <el-form-item label="安全库存">
        <el-input-number v-model="form.safeQty" :min="0" :precision="0" :step="1" controls-position="right" />
      </el-form-item>
      <el-form-item label="当前缺口">
        <el-input
          :model-value="
            Number(Math.max(0, Number(form.safeQty ?? 0) - Number(form.factQty ?? 0))).toLocaleString()
          "
          disabled
        />
      </el-form-item>
      <el-form-item label="建议补货数量">
        <el-input-number v-model="form.purchaseQty" :min="0" :precision="0" :step="1" controls-position="right" />
      </el-form-item>
    </div>
  </el-form>

  <div v-if="!isView" class="form-actions">
    <el-button @click="emit('cancel')">取消</el-button>
    <el-button type="primary" :loading="saving" @click="save">保存配置</el-button>
  </div>
  <div v-else class="form-actions">
    <el-button @click="emit('cancel')">关闭</el-button>
  </div>
</template>

<style scoped>
.alert-summary {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 14px;
  padding: 12px 14px;
  border: 1px solid var(--hs-border, #e4e7ed);
  border-radius: 6px;
  background: var(--hs-surface-soft, #f7f9fc);
}
.alert-summary span {
  color: var(--hs-muted, #909399);
  font-size: 12px;
}
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0 16px;
}
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>
