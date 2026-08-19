import type { BusinessDocumentConfig } from '../business-document-config';
import InventoryQuantityAlertForm from '../forms/InventoryQuantityAlertForm.vue';

export const inventoryQuantityAlertConfig: BusinessDocumentConfig = {
  key: 'inventory/quantity-alerts',
  title: '数量预警',
  subtitle: '按仓库监控安全库存、缺口及建议补货数量',
  endpoint: '/inventory/quantity-alerts',
  no: 'goodsName',
  columns: [
    { prop: 'goodsCode', label: '商品编码', minWidth: 120 },
    { prop: 'goodsName', label: '商品名称', minWidth: 150 },
    { prop: 'skuSpec', label: '规格', minWidth: 120 },
    { prop: 'warehouseName', label: '仓库', minWidth: 120 },
    { prop: 'factQty', label: '当前数量', minWidth: 100, kind: 'number', align: 'right' },
    { prop: 'safeQty', label: '预警阈值', minWidth: 100, kind: 'number', align: 'right' },
  ],
  creatable: false,
  formComponent: InventoryQuantityAlertForm,
  rowActions: [
    { key: 'view', label: '查看', handler: (row, ctx) => ctx.openView(row) },
    { key: 'edit', label: '设置阈值', handler: (row, ctx) => ctx.openEdit(row) },
  ],
};
