<script setup lang="ts">
defineProps<{
  title: string;
  meta?: string;
  description?: string;
}>();
</script>

<template>
  <header class="purchase-order-section-heading">
    <div>
      <strong>{{ title }}</strong>
      <span v-if="meta">{{ meta }}</span>
    </div>
    <span v-if="description">{{ description }}</span>
  </header>
</template>

<style scoped>
.purchase-order-section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--hs-space-3);
  min-height: 40px;
  margin-bottom: var(--hs-space-2);
  padding: 0 var(--hs-space-3);
  border: 1px solid var(--hs-color-border);
  border-radius: var(--hs-radius-md);
  background: var(--hs-color-surface-muted);
  color: var(--hs-color-text-primary);
}
.purchase-order-section-heading > div {
  display: flex;
  align-items: center;
  gap: var(--hs-space-2);
}
.purchase-order-section-heading strong {
  font-size: var(--hs-font-section);
}
.purchase-order-section-heading span {
  color: var(--hs-color-text-secondary);
  font-size: var(--hs-font-helper);
  font-weight: 400;
}
</style>
