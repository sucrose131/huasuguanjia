import type { BusinessDocumentConfig } from '../business-document-config';
import { api } from '@/api';
import { ElMessage } from 'element-plus';
import ProductionOutputForm from '../forms/ProductionOutputForm.vue';

export const productionOutputConfig: BusinessDocumentConfig = {
  key: 'production/outputs',
  title: '生产出库单',
  endpoint: '/production/outputs',
  no: 'outNo',
  columns: [
    { prop: 'outNo', label: '单据编号', minWidth: 155 },
    { prop: 'outTypeName', label: '出库类型', minWidth: 105, kind: 'status' },
    { prop: 'destinationTypeName', label: '出库去向', minWidth: 100 },
    { prop: 'planNo', label: '来源生产计划', minWidth: 150 },
    { prop: 'bomNo', label: 'BOM编号', minWidth: 140 },
    { prop: 'goodsName', label: '生产成品', minWidth: 140 },
    { prop: 'materialCount', label: '原料种数', minWidth: 105, kind: 'number', align: 'right' },
    { prop: 'stockCheckStatusName', label: '库存校验', minWidth: 105, kind: 'status' },
    { prop: 'warehouseName', label: '仓库', minWidth: 125 },
    { prop: 'outDate', label: '日期', minWidth: 110, kind: 'date' },
    { prop: 'confirmStatusName', label: '确认状态', minWidth: 105, kind: 'status' },
    { prop: 'createdByName', label: '创建人', minWidth: 110 },
    { prop: 'createdAt', label: '创建时间', minWidth: 150, kind: 'datetime' },
  ],
  dictionaries: [
    'production_material_out_type',
    'temporary_outbound_destination',
    'confirm_status',
  ],
  queryFields: [
    {
      key: 'outType',
      label: '出库类型',
      type: 'select',
      dictionary: 'production_material_out_type',
      width: 150,
    },
  ],
  creatable: true,
  createText: '新增临时出库',
  createPreset: () => ({ outType: 3, destinationType: 1 }),
  formComponent: ProductionOutputForm,
  openFromRoute: async (query, ctx) => {
    if (query.documentId) {
      const detail: any = await api.get(`/production/outputs/${query.documentId}`);
      if (String(query.view ?? '') === '1') ctx.openView(detail);
      else ctx.openEdit(detail);
    } else if (query.planId) {
      ctx.openCreate({
        planId: String(query.planId),
        outType: Number(query.outType ?? 1),
      });
    }
  },
  rowActions: [
    { key: 'view', label: '查看', handler: (row, ctx) => ctx.openView(row) },
    {
      key: 'edit',
      label: '编辑',
      show: (row) => Number(row.confirmStatus ?? row.status) === 0,
      handler: (row, ctx) => ctx.openEdit(row),
    },
    {
      key: 'confirm',
      label: '确认出库',
      kind: 'success',
      primary: false,
      show: (row) =>
        Number(row.outType) !== 1 && Number(row.confirmStatus ?? row.status) === 0,
      confirm: '确认后将立即扣减库存，是否继续？',
      handler: async (row) => {
        await api.post(`/production/outputs/${row.id}/confirm`, {
          comment: String(row.remark ?? '确认出库'),
        });
        ElMessage.success('已确认出库');
      },
    },
    {
      key: 'delete',
      label: '删除',
      kind: 'danger',
      primary: false,
      show: (row) => Number(row.confirmStatus ?? row.status) === 0,
      confirm: '确认删除该出库草稿？',
      handler: async (row) => {
        const result: any = await api.delete(`/production/outputs/${row.id}`);
        ElMessage.success(result?.message ?? '删除成功');
      },
    },
  ],
};
