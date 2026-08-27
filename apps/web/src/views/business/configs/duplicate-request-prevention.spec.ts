import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('business page duplicate request prevention contract', () => {
  it('does not refresh a list after opening a dialog or navigating away', () => {
    const page = source('../BusinessDocumentPage.vue');
    expect(page).toContain('const interactionVersionBefore = interactionVersion');
    expect(page).toContain(
      'action.refreshAfter !== false && interactionVersion === interactionVersionBefore',
    );
    expect(page).toContain('interactionVersion += 1');
  });

  it('loads purchase application and order detail in the shared owner only', () => {
    const applicationConfig = source('./purchase-application.ts');
    const applicationForm = source('../forms/PurchaseApplicationForm.vue');
    const orderConfig = source('./purchase-order.ts');
    const orderForm = source('../forms/PurchaseOrderForm.vue');

    expect(applicationConfig).toContain('loadDetail: async (id)');
    expect(applicationConfig).toContain("const row = { id: String(query.documentId) }");
    expect(applicationForm).not.toContain('api.get(`/purchase/applications/${form.value.id}`)');

    expect(orderConfig).toContain('loadDetail: async (id)');
    expect(orderConfig).toContain('const row = { id }');
    expect(orderForm).not.toContain('api.get(`/purchase/orders/${form.value.id}`)');
  });

  it('uses router-view remounting as the only generic-route loading lifecycle', () => {
    expect(source('../../Layout.vue')).toContain('<router-view :key="route.fullPath" />');
    expect(source('../../ResourcePage.vue')).not.toContain('watch(resource');
    expect(source('../../InventoryGeneralPage.vue')).not.toContain('watch(resource');
    expect(source('../../DashboardPage.vue')).not.toContain('watch(resource');
    expect(source('../../SystemPage.vue')).not.toContain('watch(resource');
    expect(source('../../ReportPage.vue')).not.toContain('watch(key, load)');
  });
});
