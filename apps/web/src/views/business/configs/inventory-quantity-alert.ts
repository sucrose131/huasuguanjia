import type { BusinessDocumentConfig } from '../business-document-config';
import { api } from '@/api';
import InventoryQuantityAlertForm from '../forms/InventoryQuantityAlertForm.vue';

export const inventoryQuantityAlertConfig: BusinessDocumentConfig = {
  key: 'inventory/quantity-alerts',
  title: '数量预警',
  subtitle: '按仓库监控安全库存、缺口及建议补货数量',
  endpoint: '/inventory/quantity-alerts',
  no: 'goodsName',
  columns: [
    { prop: 'goodsCode', label: '商品编码', minWidth: 120 },
    { prop: 'goodsName', label: '商品名称', minWidth: 150, tooltip: true },
    { prop: 'skuSpec', label: '规格', minWidth: 120 },
    { prop: 'warehouseName', label: '所在仓库', minWidth: 120 },
    { prop: 'factQty', label: '实际库存', minWidth: 95, kind: 'number', align: 'right' },
    { prop: 'safeQty', label: '安全库存', minWidth: 95, kind: 'number', align: 'right' },
    { prop: 'gapQty', label: '缺口', minWidth: 85, kind: 'number', align: 'right' },
    { prop: 'purchaseQty', label: '建议补货', minWidth: 95, kind: 'number', align: 'right' },
    {
      prop: 'warning',
      label: '库存状态',
      minWidth: 95,
      kind: 'status',
      statusDict: 'inventory_stock_health_status',
      render: (row) => String(row.warning ? 1 : 0),
    },
  ],
  dictionaries: ['inventory_stock_health_status'],
  optionBags: ['orgs'],
  queryFields: [
    { key: 'orgId', label: '组织', type: 'tree-select', optionBag: 'orgs', width: 200 },
    {
      key: 'warehouseId',
      label: '仓库',
      type: 'select',
      dependsOn: 'orgId',
      width: 180,
      loadOptions: async (deps) => {
        if (!deps.orgId) return [];
        return (await api.get('/base-data/warehouses/options', {
          params: { orgId: deps.orgId },
        })) as any[];
      },
    },
  ],
  creatable: false,
  formComponent: InventoryQuantityAlertForm,
  rowActions: [
    { key: 'view', label: '查看', handler: (row, ctx) => ctx.openView(row) },
    { key: 'edit', label: '设置阈值', handler: (row, ctx) => ctx.openEdit(row) },
  ],
};
