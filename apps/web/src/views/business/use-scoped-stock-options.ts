import { api } from '@/api';

/** 库存业务选项必须同时受组织和仓库约束。 */
export async function fetchScopedStockOptions(orgId: unknown, warehouseId: unknown) {
  if (!orgId || !warehouseId) return [];
  return (await api.get('/inventory/stock-options', {
    params: { orgId: String(orgId), warehouseId: String(warehouseId) },
  })) as any[];
}
