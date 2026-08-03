<script setup lang="ts">
defineProps<{
  loading?: boolean;
  error?: string;
  empty?: boolean;
  title: string;
  canCreate?: boolean;
  emptyDescription?: string;
  emptyHint?: string;
}>();
const emit = defineEmits<{ retry: []; create: [] }>();
</script>
<template>
  <div v-if="error" class="error-state">
    <div>
      <el-icon size="30" color="#d14343"><WarningFilled /></el-icon>
      <h3>数据加载失败</h3>
      <p>{{ error }}</p>
      <el-button @click="emit('retry')">重新加载</el-button>
    </div>
  </div>
  <div v-else-if="empty && !loading" class="empty-state">
    <div>
      <el-empty :description="emptyDescription ?? `尚未维护${title}`" :image-size="82" />
      <p>
        {{
          emptyHint ??
          (canCreate ? '可以使用页面右上角的新增按钮开始维护' : '相关业务触发后由系统自动生成')
        }}
      </p>
      <el-button v-if="canCreate" type="primary" @click="emit('create')">新增{{ title }}</el-button>
    </div>
  </div>
</template>
<script lang="ts">
import { WarningFilled } from '@element-plus/icons-vue';
export default { components: { WarningFilled } };
</script>
