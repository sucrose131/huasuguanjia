<template>
  <div
    ref="contentRef"
    class="overflow-tooltip-cell"
    @mouseenter="checkOverflow"
    @mouseleave="visible = false"
  >
    <slot>{{ content }}</slot>
  </div>
  <el-tooltip
    v-model:visible="visible"
    :virtual-ref="contentRef"
    virtual-triggering
    strategy="fixed"
    :popper-options="{
      modifiers: [{ name: 'computeStyles', options: { adaptive: false } }],
    }"
    :content="tooltipContent"
    placement="top"
  />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

/**
 * 单元格溢出 Tooltip：替代 el-table 原生 show-overflow-tooltip。
 *
 * 原生 show-overflow-tooltip 在表格存在 fixed 固定列时，浮层定位坐标与
 * 固定列独立渲染层叠加会产生水平偏移（Tooltip 漂移、与列头错位）。
 * 本组件以单元格自身为虚拟触发元素（virtual-triggering），定位由
 * el-tooltip 基于真实单元格矩形计算，不存在固定列偏移问题；
 * 仅当内容溢出时才显示 Tooltip，行为与原版一致。
 */
const props = withDefaults(
  defineProps<{
    /** Tooltip 展示内容；缺省取触发元素可见文本（innerText） */
    content?: string | number | null;
  }>(),
  { content: null },
);

const contentRef = ref<HTMLElement>();
const visible = ref(false);

function checkOverflow() {
  const el = contentRef.value;
  if (!el) return;
  visible.value = el.scrollWidth > el.clientWidth + 1;
}

const tooltipContent = computed(() => {
  if (props.content !== null && props.content !== undefined && props.content !== '')
    return String(props.content);
  return contentRef.value?.innerText ?? '';
});
</script>

<style scoped>
.overflow-tooltip-cell {
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  word-break: break-all;
}
</style>
