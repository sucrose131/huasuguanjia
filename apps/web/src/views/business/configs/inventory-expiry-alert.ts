import type { BusinessDocumentConfig } from '../business-document-config';
import InventoryExpiryAlertForm from '../forms/InventoryExpiryAlertForm.vue';

export const inventoryExpiryAlertConfig: BusinessDocumentConfig = {
  key: 'inventory/expiry-alerts',
  title: '有效期预警',
  subtitle: '依据效期预警配置识别临期和过期批次',
  endpoint: '/inventory/expiry-alerts',
  no: 'goodsName',
  columns: [
    { prop: 'goodsCode', label: '商品编码', minWidth: 120 },
    { prop: 'goodsName', label: '商品名称', minWidth: 150 },
    { prop: 'skuSpec', label: '规格', minWidth: 120 },
    { prop: 'batchNo', label: '批号', minWidth: 120 },
    { prop: 'warehouseName', label: '仓库', minWidth: 120 },
    { prop: 'endDay', label: '有效期', minWidth: 110, kind: 'date' },
    { prop: 'remainingDays', label: '剩余天数', minWidth: 100, kind: 'number', align: 'right' },
    { prop: 'inventoryQty', label: '数量', minWidth: 100, kind: 'number', align: 'right' },
  ],
  creatable: false,
  formComponent: InventoryExpiryAlertForm,
  rowActions: [
    { key: 'view', label: '查看', handler: (row, ctx) => ctx.openView(row) },
  ],
};
