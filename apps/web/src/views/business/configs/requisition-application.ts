import type { BusinessDocumentConfig } from '../business-document-config';
import { api } from '@/api';
import { ElMessage } from 'element-plus';
import RequisitionApplicationForm from '../forms/RequisitionApplicationForm.vue';

export const requisitionApplicationConfig: BusinessDocumentConfig = {
  key: 'requisitions/applications',
  title: '领用申请单',
  endpoint: '/requisitions/applications',
  no: 'applicationNo',
  columns: [
    { prop: 'applicationNo', label: '申请单号', minWidth: 160 },
    { prop: 'deptName', label: '领用部门', minWidth: 130 },
    { prop: 'receiverIdName', label: '领用人', minWidth: 110 },
    { prop: 'warehouseName', label: '仓库', minWidth: 125 },
    { prop: 'drawTypeName', label: '领用类型', minWidth: 105, kind: 'status' },
    { prop: 'date', label: '申请日期', minWidth: 110, kind: 'date' },
    { prop: 'quantity', label: '申请总量', minWidth: 105, kind: 'number' },
    { prop: 'actualQty', label: '实际领用', minWidth: 105, kind: 'number' },
    { prop: 'approveStatusName', label: '审批状态', minWidth: 105, kind: 'status' },
    { prop: 'oaStatusName', label: 'OA状态', minWidth: 105, kind: 'status' },
    { prop: 'createdByName', label: '创建人', minWidth: 110 },
    { prop: 'createdAt', label: '创建时间', minWidth: 150, kind: 'datetime' },
  ],
  dictionaries: ['draw_type', 'requisition_status', 'requisition_approval_status', 'yes_no'],
  creatable: true,
  createText: '新增领用申请',
  formComponent: RequisitionApplicationForm,
  rowActions: [
    {
      key: 'view',
      label: '查看',
      handler: (row, ctx) => ctx.openView(row),
    },
    {
      key: 'edit',
      label: '编辑',
      handler: (row, ctx) => ctx.openEdit(row),
    },
    {
      key: 'retry-oa',
      label: '重新提交OA',
      kind: 'warning',
      show: (row) => row.oaStatus === 'PUSH_FAILED',
      handler: async (row) => {
        const result: any = await api.post(`/requisitions/applications/${row.id}/submit-oa`, {});
        if (result?.procStatus === 'PUSH_FAILED') ElMessage.warning(result?.message ?? '提交OA失败');
        else ElMessage.success(result?.message ?? '已提交OA审批');
      },
    },
    {
      key: 'delete',
      label: '删除',
      kind: 'danger',
      show: (row) => row.approveStatus === 0,
      confirm: '确认删除该领用申请？',
      handler: async (row) => {
        await api.delete(`/requisitions/applications/${row.id}`);
        ElMessage.success('删除成功');
      },
    },
  ],
};
