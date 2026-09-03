import type { BusinessDocumentConfig } from '../business-document-config';
import InventoryStockForm from '../forms/InventoryStockForm.vue';

/**
 * 库存查询（只读）：驱动 BusinessDocumentPage 共享引擎。
 *
 * stocks 列表接口为纯 GET，无新增/编辑/删除；行操作仅提供「查看」，
 * 打开只读表单展示当前批次的库存台账流水。
 */
export const inventoryStockConfig: BusinessDocumentConfig = {
  key: 'inventory/stocks',
  title: '库存查询',
  subtitle: '按仓库查看即时库存、库存金额及可追溯流水',
  endpoint: '/inventory/stocks',
  /** 库存存量视图：金额按金额查看能力整体控制，不参与 own/全部 经办范围分级 */
  amountScopeExempt: true,
  no: 'goodsName',
  columns: [
    { prop: 'goodsCode', label: '商品编码', minWidth: 120 },
    { prop: 'goodsName', label: '商品名称', minWidth: 150, tooltip: true },
    { prop: 'categoryName', label: '分类', minWidth: 110 },
    { prop: 'skuSpec', label: 'SKU/规格', minWidth: 130 },
    { prop: 'unitName', label: '单位', width: 80 },
    { prop: 'orgName', label: '组织', minWidth: 130 },
    { prop: 'warehouseName', label: '仓库', minWidth: 130 },
    { prop: 'batchNo', label: '批号', minWidth: 120 },
    { prop: 'inventoryQty', label: '库存数量', minWidth: 105, kind: 'number', align: 'right' },
    { prop: 'inventoryAmount', label: '库存金额', minWidth: 120, kind: 'money', align: 'right' },
  ],
  dictionaries: [],
  creatable: false,
  formComponent: InventoryStockForm,
  viewCloseInForm: true,
  rowActions: [{ key: 'view', label: '查看', handler: (row, ctx) => ctx.openView(row) }],
};
