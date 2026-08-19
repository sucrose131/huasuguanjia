import type { BusinessDocumentConfig } from '../business-document-config';
import InventoryExpiryAlertForm from '../forms/InventoryExpiryAlertForm.vue';

export const inventoryExpiryAlertConfig: BusinessDocumentConfig = {
  key: 'inventory/expiry-alerts',
  title: '有效期预警',
  subtitle: '依据效期预警配置识别临期和过期批次',
  endpoint: '/inventory/expiry-alerts',
  no: 'goodsName',
  columns: [
    { prop: 'goodsCode', label: '商品编码', minWidth: 125 },
    { prop: 'goodsName', label: '商品名称', minWidth: 150, tooltip: true },
    { prop: 'skuSpec', label: '规格', minWidth: 120 },
    { prop: 'warehouseName', label: '所在仓库', minWidth: 115 },
    { prop: 'alertQty', label: '预警数量', minWidth: 95, kind: 'number', align: 'right' },
    { prop: 'alertTypeName', label: '预警类型', minWidth: 100 },
    { prop: 'endDay', label: '到期日', minWidth: 105, kind: 'date' },
    { prop: 'alertDays', label: '预警天数', minWidth: 85, kind: 'number', align: 'right' },
    {
      prop: 'alertValue',
      label: '预警货值',
      minWidth: 105,
      kind: 'money',
      align: 'right',
    },
    {
      prop: 'expiryStatus',
      label: '效期状态',
      minWidth: 95,
      kind: 'status',
      render: (row) => `⚠ ${row.expiryStatus ?? '—'}`,
    },
  ],
  creatable: false,
  formComponent: InventoryExpiryAlertForm,
  rowActions: [
    { key: 'view', label: '查看', handler: (row, ctx) => ctx.openView(row) },
  ],
};
