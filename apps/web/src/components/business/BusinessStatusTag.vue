<script setup lang="ts">
type Semantic = 'neutral' | 'processing' | 'success' | 'warning' | 'danger';

defineProps<{
  semantic: Semantic;
  text: string;
  dot?: boolean;
}>();
</script>

<template>
  <span class="business-status" :class="`business-status--${semantic}`">
    <span v-if="dot !== false" class="business-status__dot" aria-hidden="true" />
    {{ text }}
  </span>
</template>

<style scoped>
.business-status {
  display: inline-flex;
  align-items: center;
  gap: var(--hs-space-2);
  min-height: 24px;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  line-height: 18px;
  white-space: nowrap;
}

.business-status__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

.business-status--neutral {
  color: var(--hs-color-info);
  background: var(--hs-color-info-soft);
}

.business-status--processing {
  color: var(--hs-color-primary);
  background: var(--hs-color-primary-soft);
}

.business-status--success {
  color: var(--hs-color-success);
  background: var(--hs-color-success-soft);
}

.business-status--warning {
  color: var(--hs-color-warning);
  background: var(--hs-color-warning-soft);
}

.business-status--danger {
  color: var(--hs-color-danger);
  background: var(--hs-color-danger-soft);
}
</style>
