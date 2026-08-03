export type InventoryCheckColumnKind =
  'text' | 'date' | 'quantity' | 'progress' | 'difference' | 'status';

export type InventoryCheckColumn = {
  key: string;
  label: string;
  kind: InventoryCheckColumnKind;
  width?: number;
  minWidth?: number;
  fixed?: 'left' | 'right';
  align?: 'left' | 'center' | 'right';
  priority: 'primary' | 'secondary' | 'audit';
  region: 'identity' | 'subject' | 'metrics' | 'date' | 'progress' | 'state' | 'audit';
};

export const inventoryCheckTableSchema = {
  module: '库存管理',
  menu: '库存盘点',
  pageLevel: 2,
  tablePattern: 'status-progress',
  designVersion: '2.0.0-pilot',
  rowKey: 'id',
  stripe: true,
  border: false,
  columns: [
    {
      key: 'checkNo',
      label: '盘点单号',
      kind: 'text',
      width: 156,
      fixed: 'left',
      priority: 'primary',
      region: 'identity',
    },
    {
      key: 'checkTypeName',
      label: '盘点类型',
      kind: 'text',
      width: 96,
      priority: 'primary',
      region: 'identity',
    },
    {
      key: 'orgName',
      label: '组织',
      kind: 'text',
      minWidth: 120,
      priority: 'secondary',
      region: 'subject',
    },
    {
      key: 'warehouseName',
      label: '仓库',
      kind: 'text',
      minWidth: 132,
      priority: 'primary',
      region: 'subject',
    },
    {
      key: 'checkDate',
      label: '盘点日期',
      kind: 'date',
      width: 112,
      priority: 'primary',
      region: 'date',
    },
    {
      key: 'goodsCount',
      label: '商品数',
      kind: 'quantity',
      width: 82,
      align: 'right',
      priority: 'secondary',
      region: 'metrics',
    },
    {
      key: 'allQty',
      label: '账面总量',
      kind: 'quantity',
      width: 102,
      align: 'right',
      priority: 'secondary',
      region: 'metrics',
    },
    {
      key: 'lessQty',
      label: '盘亏',
      kind: 'difference',
      width: 90,
      align: 'right',
      priority: 'primary',
      region: 'metrics',
    },
    {
      key: 'overflowQty',
      label: '盘盈',
      kind: 'difference',
      width: 90,
      align: 'right',
      priority: 'primary',
      region: 'metrics',
    },
    {
      key: 'damagedQty',
      label: '损坏',
      kind: 'difference',
      width: 90,
      align: 'right',
      priority: 'primary',
      region: 'metrics',
    },
    {
      key: 'progressPct',
      label: '处理进度',
      kind: 'progress',
      width: 132,
      priority: 'primary',
      region: 'progress',
    },
    {
      key: 'status',
      label: '业务状态',
      kind: 'status',
      width: 104,
      priority: 'primary',
      region: 'state',
    },
    {
      key: 'createdByName',
      label: '创建人',
      kind: 'text',
      width: 92,
      priority: 'audit',
      region: 'audit',
    },
  ] satisfies InventoryCheckColumn[],
} as const;
