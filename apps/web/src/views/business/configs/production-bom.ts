import type { BusinessDocumentConfig } from '../business-document-config';
import { api } from '@/api';
import { ElMessage } from 'element-plus';
import ProductionBomForm from '../forms/ProductionBomForm.vue';

export const productionBomConfig: BusinessDocumentConfig = {
  key: 'production/boms',
  title: '生产BOM',
  endpoint: '/production/boms',
  no: 'bomNo',
  columns: [
    { prop: 'bomNo', label: 'BOM编号', minWidth: 155 },
    { prop: 'bomName', label: 'BOM名称', minWidth: 155, tooltip: true },
    { prop: 'goodsCode', label: '成品编码', minWidth: 110 },
    { prop: 'goodsName', label: '生产成品', minWidth: 135, tooltip: true },
    { prop: 'categoryName', label: '分类', minWidth: 100 },
    { prop: 'unitName', label: '单位', minWidth: 65 },
    { prop: 'materialCount', label: '原料种数', minWidth: 105, kind: 'number', align: 'right' },
    { prop: 'orgName', label: '所属组织', minWidth: 125 },
    { prop: 'warehouseName', label: '原料仓库', minWidth: 125 },
    { prop: 'statusName', label: '状态', minWidth: 105, kind: 'status' },
    { prop: 'createdByName', label: '创建人', minWidth: 110 },
    { prop: 'createdAt', label: '创建时间', minWidth: 150, kind: 'datetime' },
  ],
  dictionaries: ['enabled_status'],
  creatable: true,
  createText: '新增BOM',
  formComponent: ProductionBomForm,
  openFromRoute: async (query, ctx) => {
    if (query.documentId) {
      const detail: any = await api.get(`/production/boms/${query.documentId}`);
      if (String(query.view ?? '') === '1') ctx.openView(detail);
      else ctx.openEdit(detail);
    }
  },
  rowActions: [
    { key: 'view', label: '查看', handler: (row, ctx) => ctx.openView(row) },
    {
      key: 'edit',
      label: '编辑',
      handler: (row, ctx) => ctx.openEdit(row),
    },
    {
      key: 'toggle-bom',
      label: (row) => (Number(row.status) === 1 ? '停用' : '启用'),
      permission: 'status',
      kind: 'warning',
      primary: false,
      confirm: (row) =>
        Number(row.status) === 1 ? '停用后不可用于新生产计划，是否继续？' : '启用该BOM，是否继续？',
      handler: async (row) => {
        const newStatus = Number(row.status) === 1 ? 2 : 1;
        const result: any = await api.patch(`/production/boms/${row.id}/status`, {
          status: newStatus,
        });
        ElMessage.success(result?.message ?? '状态已更新');
      },
    },
    {
      key: 'delete',
      label: '删除',
      kind: 'danger',
      primary: false,
      confirm: '确认删除该BOM？',
      handler: async (row) => {
        const result: any = await api.delete(`/production/boms/${row.id}`);
        ElMessage.success(result?.message ?? '删除成功');
      },
    },
  ],
};
