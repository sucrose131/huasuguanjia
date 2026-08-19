import type { BusinessDocumentConfig } from '../business-document-config';
import { api } from '@/api';
import { ElMessage } from 'element-plus';
import SalesServiceForm from '../forms/SalesServiceForm.vue';

export const salesServiceConfig: BusinessDocumentConfig = {
  key: 'sales/services',
  title: '售后记录',
  endpoint: '/sales/services',
  no: 'serviceNo',
  columns: [
    { prop: 'serviceNo', label: '服务编号', minWidth: 155 },
    { prop: 'sourceSystemName', label: '售后来源', minWidth: 110 },
    { prop: 'orderNo', label: '销售订单', minWidth: 155 },
    { prop: 'customerName', label: '客户', minWidth: 130 },
    { prop: 'goodsName', label: '商品', minWidth: 145 },
    { prop: 'eventTypeName', label: '事件类型', minWidth: 105, kind: 'status' },
    { prop: 'eventContent', label: '事件内容', minWidth: 220 },
    { prop: 'handlerIdName', label: '处理人', minWidth: 110 },
    { prop: 'eventDate', label: '事件日期', minWidth: 110, kind: 'date' },
    { prop: 'eventStatusName', label: '状态', minWidth: 105, kind: 'status' },
    { prop: 'createdByName', label: '创建人', minWidth: 110 },
    { prop: 'createdAt', label: '创建时间', minWidth: 150, kind: 'datetime' },
  ],
  dictionaries: ['after_sale_event_type', 'after_sale_event_status'],
  creatable: true,
  createText: '登记售后',
  formComponent: SalesServiceForm,
  openFromRoute: async (query, ctx) => {
    if (String(query.create ?? '') === '1' && query.orderId) {
      ctx.openCreate({ orderId: String(query.orderId) });
    } else if (query.documentId) {
      const detail: any = await api.get(`/sales/services/${query.documentId}`);
      ctx.openView(detail);
    }
  },
  rowActions: [
    { key: 'view', label: '查看', handler: (row, ctx) => ctx.openView(row) },
    {
      key: 'edit',
      label: '编辑',
      show: (row) => !row.sourceSystem && Number(row.eventStatus) !== 2,
      handler: (row, ctx) => ctx.openEdit(row),
    },
    {
      key: 'process',
      label: (row) =>
        row.successorType === 'sales_return'
          ? '处理完成'
          : Number(row.eventType) === 5
            ? '办理换货'
            : Number(row.eventType) === 4
              ? '办理退货'
              : '处理完成',
      kind: 'success',
      primary: false,
      show: (row) =>
        Number(row.eventStatus) === 1 &&
        (!row.successorId || row.successorType === 'sales_return'),
      confirm: (row) =>
        Number(row.eventType) === 5
          ? '办理后将先确认退货返库，再生成一张待确认换货出库单，是否继续？'
          : Number(row.eventType) === 4
            ? '办理后将自动生成并确认销售退货返库，是否继续？'
            : '确认将该售后事项标记为已完成？',
      handler: async (row) => {
        const result: any = await api.post(`/sales/services/${row.id}/process`, {});
        ElMessage.success(result?.message ?? '处理完成');
      },
    },
    {
      key: 'exchange-output',
      label: '办理换货出库',
      kind: 'success',
      primary: false,
      show: (row) => row.successorType === 'sales_exchange_output' && Boolean(row.successorId),
      handler: (row, ctx) =>
        ctx.navigate('/sales/outputs', { documentId: String(row.successorId) }),
    },
    {
      key: 'delete',
      label: '删除',
      kind: 'danger',
      primary: false,
      show: (row) => Number(row.eventStatus) !== 2,
      confirm: '确认删除该售后记录？',
      handler: async (row) => {
        const result: any = await api.delete(`/sales/services/${row.id}`);
        ElMessage.success(result?.message ?? '删除成功');
      },
    },
  ],
};
