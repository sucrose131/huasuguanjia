<script setup lang="ts">
import { ArrowDown } from '@element-plus/icons-vue';

withDefaults(defineProps<{ showMore?: boolean }>(), {
  showMore: true,
});
</script>

<template>
  <div class="table-row-actions">
    <slot />
    <el-dropdown v-if="$slots.more && showMore" trigger="click" placement="bottom-end">
      <el-button link type="primary" class="table-row-actions__more">
        更多
        <el-icon><ArrowDown /></el-icon>
      </el-button>
      <template #dropdown>
        <el-dropdown-menu>
          <slot name="more" />
        </el-dropdown-menu>
      </template>
    </el-dropdown>
  </div>
</template>

<style scoped>
.table-row-actions {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--hs-space-2, 8px);
  width: 100%;
  white-space: nowrap;
}

.table-row-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

.table-row-actions__more {
  display: inline-flex;
  gap: 2px;
}
</style>
