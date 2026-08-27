import type { BusinessDocumentConfig } from '../business-document-config';
import { api } from '@/api';
import { ElMessage } from 'element-plus';
import RequisitionOutputForm from '../forms/RequisitionOutputForm.vue';

export const requisitionOutputConfig: BusinessDocumentConfig = {
  key: 'requisitions/outputs',
  title: '领用出库单',
  endpoint: '/requisitions/outputs',
  documentType: 'requisition_output',
  no: 'outputNo',
  columns: [
    { prop: 'outputNo', label: '出库单号', minWidth: 160, tooltip: true },
    { prop: 'applicationNo', label: '领用申请', minWidth: 155, tooltip: true },
    { prop: 'deptName', label: '领用部门', minWidth: 130 },
    { prop: 'receiverIdName', label: '领用接收人', minWidth: 110 },
    { prop: 'warehouseName', label: '仓库', minWidth: 125 },
    { prop: 'outDate', label: '出库日期', minWidth: 110, kind: 'date' },
    { prop: 'applicationQty', label: '申请数量', minWidth: 105, kind: 'number', align: 'right' },
    { prop: 'quantity', label: '实出数量', minWidth: 105, kind: 'number', align: 'right' },
    { prop: 'confirmStatusName', label: '确认状态', minWidth: 105, kind: 'status' },
    { prop: 'createdByName', label: '创建人', minWidth: 110 },
    { prop: 'createdAt', label: '创建时间', minWidth: 150, kind: 'datetime' },
  ],
  dictionaries: ['requisition_confirm_status'],
  creatable: true,
  createText: '直接领用出库',
  createPreset: () => ({ directOutput: true, drawType: 2 }),
  formComponent: RequisitionOutputForm,
  openFromRoute: async (query, ctx) => {
    if (query.documentId) {
      const detail: any = await api.get(`/requisitions/outputs/${query.documentId}`);
      if (String(query.view ?? '') === '1') ctx.openView(detail);
      else ctx.openEdit(detail);
    } else if (query.applicationId) {
      const application: any = await api.get(
        `/requisitions/applications/${String(query.applicationId)}`,
      );
      if (application.autoOutputId) {
        const detail: any = await api.get(`/requisitions/outputs/${application.autoOutputId}`);
        if (Number(application.autoOutputConfirmStatus) === 1) ctx.openView(detail);
        else ctx.openEdit(detail);
      } else {
        ctx.openCreate({ applicationId: String(query.applicationId) });
      }
    }
  },
  rowActions: [
    { key: 'view', label: '查看', handler: (row, ctx) => ctx.openView(row) },
    {
      key: 'edit',
      label: '编辑',
      show: (row) => Number(row.confirmStatus) === 0,
      handler: (row, ctx) => ctx.openEdit(row),
    },
    {
      key: 'confirm',
      label: '确认',
      kind: 'success',
      primary: false,
      show: (row) => Number(row.confirmStatus) === 0,
      verify: async (row) => {
        const detail: any = await api.get(`/requisitions/outputs/${String(row.id)}`);
        const missing = (detail.details ?? []).some(
          (line: any) => !String(line.batchNo ?? '').trim(),
        );
        return missing
          ? '部分出库明细未选择库存批次，请先编辑并选择全部批次后再确认'
          : null;
      },
      confirm: '确认后会立即改变真实库存，是否继续？',
      handler: async (row) => {
        await api.post(`/requisitions/outputs/${row.id}/confirm`, { comment: '确认' });
        ElMessage.success('确认成功');
      },
    },
    {
      key: 'undo-confirm',
      label: '撤销确认',
      kind: 'warning',
      primary: false,
      show: (row) => Number(row.confirmStatus) === 1,
      confirm: '撤销后将回退库存，是否继续？',
      handler: async (row) => {
        await api.post(`/requisitions/outputs/${row.id}/undo-confirm`, { comment: '撤销' });
        ElMessage.success('已撤销确认');
      },
    },
    {
      key: 'view-application',
      label: '查看领用申请',
      permission: 'requisitions:applications',
      show: (row) => Boolean(row.applicationId),
      handler: (row, ctx) =>
        ctx.navigate('/requisitions/applications', {
          documentId: String(row.applicationId),
          view: '1',
        }),
    },
    {
      key: 'create-return',
      label: '生成退回',
      permission: 'requisitions:returns:create',
      kind: 'success',
      primary: false,
      show: (row) => Number(row.confirmStatus) === 1 && Boolean(row.hasReturnableItems),
      handler: (row, ctx) =>
        ctx.navigate('/requisitions/returns', { outputId: String(row.id) }),
    },
    {
      key: 'delete',
      label: '删除',
      kind: 'danger',
      primary: false,
      show: (row) => Number(row.confirmStatus) === 0 && !row.autoCreated,
      confirm: '确认删除该领用出库单？',
      handler: async (row) => {
        await api.delete(`/requisitions/outputs/${row.id}`);
        ElMessage.success('删除成功');
      },
    },
  ],
};
