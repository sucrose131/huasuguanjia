import type { BusinessDocumentConfig } from '../business-document-config';
import { api } from '@/api';
import { ElMessage, ElMessageBox } from 'element-plus';
import ProductionPlanForm from '../forms/ProductionPlanForm.vue';

export const productionPlanConfig: BusinessDocumentConfig = {
  key: 'production/plans',
  title: '生产计划单',
  endpoint: '/production/plans',
  documentType: 'production_plan',
  no: 'planNo',
  columns: [
    { prop: 'planNo', label: '生产计划单号', minWidth: 155, tooltip: true },
    { prop: 'sourceOrderNo', label: '关联销售订单', minWidth: 155, tooltip: true },
    { prop: 'bomNo', label: 'BOM编号', minWidth: 135 },
    { prop: 'goodsName', label: '生产成品', minWidth: 145, tooltip: true },
    { prop: 'planQty', label: '生产数量', minWidth: 105, kind: 'number', align: 'right' },
    { prop: 'deliveryProgress', label: '交付进度', minWidth: 120, kind: 'progress' },
    { prop: 'warehouseName', label: '仓库', minWidth: 125 },
    { prop: 'planDate', label: '日期', minWidth: 110, kind: 'date' },
    { prop: 'planStatusName', label: '计划状态', minWidth: 105, kind: 'status' },
    { prop: 'outboundStatusName', label: '出库状态', minWidth: 105, kind: 'status' },
    { prop: 'createdByName', label: '创建人', minWidth: 110 },
    { prop: 'createdAt', label: '创建时间', minWidth: 150, kind: 'datetime' },
  ],
  dictionaries: [
    'production_plan_status',
    'production_material_status',
    'production_stock_check_status',
    'production_outbound_status',
    'approval_status',
  ],
  creatable: true,
  createText: '新增生产计划',
  formComponent: ProductionPlanForm,
  openFromRoute: async (query, ctx) => {
    if (query.documentId) {
      const detail: any = await api.get(`/production/plans/${query.documentId}`);
      if (String(query.view ?? '') === '1') ctx.openView(detail);
      else ctx.openEdit(detail);
    }
  },
  rowActions: [
    { key: 'view', label: '查看', handler: (row, ctx) => ctx.openView(row) },
    {
      key: 'edit',
      label: '编辑',
      show: (row) =>
        Number(row.approveStatus) === 0 && [0, 1].includes(Number(row.planStatus)),
      handler: (row, ctx) => ctx.openEdit(row),
    },
    {
      key: 'approve',
      label: '通过',
      kind: 'success',
      primary: false,
      show: (row) => Number(row.approveStatus) === 0 && Number(row.planStatus) === 1,
      confirm: '通过后将检查库存并生成缺料清单，是否继续？',
      handler: async (row) => {
        const result: any = await api.post(`/production/plans/${row.id}/approve`, {
          approved: true,
          comment: '通过',
        });
        if (result?.shortage) ElMessage.warning('库存不足，已生成缺料清单');
        else ElMessage.success(result?.message ?? '审批通过');
      },
    },
    {
      key: 'reject',
      label: '驳回',
      kind: 'danger',
      primary: false,
      show: (row) => Number(row.approveStatus) === 0 && Number(row.planStatus) === 1,
      handler: async (row) => {
        const prompt = await ElMessageBox.prompt('请输入驳回原因', '驳回生产计划', {
          inputValidator: (value) => Boolean(String(value).trim()) || '驳回原因不能为空',
        });
        const result: any = await api.post(`/production/plans/${row.id}/approve`, {
          approved: false,
          comment: String(prompt.value).trim(),
        });
        ElMessage.success(result?.message ?? '已驳回');
      },
    },
    {
      key: 'recheck',
      label: '重校库存',
      kind: 'warning',
      primary: false,
      show: (row) =>
        Number(row.approveStatus) === 0 &&
        Number(row.planStatus) === 7 &&
        Number(row.outboundStatus) === 0 &&
        Number(row.materialStatus) === 4,
      confirm: '重新校验库存并更新缺料清单，是否继续？',
      handler: async (row) => {
        const result: any = await api.post(`/production/plans/${row.id}/recheck`, {});
        ElMessage.success(result?.message ?? '库存已重新校验');
      },
    },
    {
      key: 'create-output',
      label: '生成BOM出库',
      permission: 'production:outputs:create',
      kind: 'success',
      primary: false,
      show: (row) =>
        Number(row.approveStatus) === 1 &&
        Number(row.planStatus) === 3 &&
        Number(row.stockCheckStatus) === 1 &&
        [1, 4].includes(Number(row.materialStatus)) &&
        Number(row.outboundStatus) === 0,
      handler: (row, ctx) =>
        ctx.navigate('/production/outputs', {
          planId: String(row.id),
          outType: '1',
        }),
    },
    {
      key: 'terminate',
      label: '终止',
      kind: 'danger',
      primary: false,
      show: (row) => ![5, 6].includes(Number(row.planStatus)) && Number(row.outboundStatus) !== 2,
      confirm: '终止后将关闭未执行出库和未处理缺料，是否继续？',
      handler: async (row) => {
        const result: any = await api.post(`/production/plans/${row.id}/terminate`, {});
        ElMessage.success(result?.message ?? '已终止');
      },
    },
    {
      key: 'delete',
      label: '删除',
      kind: 'danger',
      primary: false,
      confirm: '确认删除该生产计划？',
      handler: async (row) => {
        const result: any = await api.delete(`/production/plans/${row.id}`);
        ElMessage.success(result?.message ?? '删除成功');
      },
    },
  ],
};
