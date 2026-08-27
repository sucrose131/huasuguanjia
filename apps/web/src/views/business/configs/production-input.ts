import type { BusinessDocumentConfig } from '../business-document-config';
import { api } from '@/api';
import { ElMessage } from 'element-plus';
import ProductionInputForm from '../forms/ProductionInputForm.vue';

export const productionInputConfig: BusinessDocumentConfig = {
  key: 'production/inputs',
  title: '生产成品入库单',
  endpoint: '/production/inputs',
  documentType: 'production_input',
  no: 'inputNo',
  columns: [
    { prop: 'inputNo', label: '成品入库单号', minWidth: 160 },
    { prop: 'planNo', label: '来源生产计划', minWidth: 155, tooltip: true },
    { prop: 'goodsName', label: '入库成品', minWidth: 145, tooltip: true },
    { prop: 'quantity', label: '本次入库', minWidth: 105, kind: 'number', align: 'right' },
    { prop: 'batchNo', label: '批号', minWidth: 140 },
    { prop: 'warehouseName', label: '仓库', minWidth: 125 },
    { prop: 'inputDate', label: '日期', minWidth: 110, kind: 'date' },
    { prop: 'createdByName', label: '创建人', minWidth: 110 },
    { prop: 'createdAt', label: '创建时间', minWidth: 150, kind: 'datetime' },
  ],
  dictionaries: [],
  creatable: true,
  createText: '新增生产成品入库单',
  formComponent: ProductionInputForm,
  openFromRoute: async (query, ctx) => {
    if (query.documentId) {
      const detail: any = await api.get(`/production/inputs/${query.documentId}`);
      if (String(query.view ?? '') === '1') ctx.openView(detail);
      else ctx.openEdit(detail);
    }
  },
  rowActions: [
    { key: 'view', label: '查看', handler: (row, ctx) => ctx.openView(row) },
    {
      key: 'delete',
      label: '删除',
      kind: 'danger',
      primary: false,
      show: (row) => Number(row.confirmStatus ?? row.status) === 0,
      confirm: '删除后将回退库存，是否继续？',
      handler: async (row) => {
        const result: any = await api.delete(`/production/inputs/${row.id}`);
        ElMessage.success(result?.message ?? '删除成功');
      },
    },
  ],
};
