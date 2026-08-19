import type { BusinessDocumentConfig } from '../business-document-config';
import { api } from '@/api';
import { ElMessage, ElMessageBox } from 'element-plus';
import ShortageViewForm from '../forms/ShortageViewForm.vue';

export const productionShortageConfig: BusinessDocumentConfig = {
  key: 'production/shortages',
  title: '生产缺料清单',
  endpoint: '/production/shortages',
  no: 'shortageNo',
  creatable: false,
  columns: [
    { prop: 'shortageNo', label: '缺料清单编号', minWidth: 155 },
    { prop: 'planNo', label: '生产计划', minWidth: 145 },
    { prop: 'productGoodsName', label: '生产成品', minWidth: 130 },
    { prop: 'goodsCode', label: '原料编码', minWidth: 120 },
    { prop: 'goodsName', label: '原料名称', minWidth: 145 },
    { prop: 'requireQty', label: '总需求', minWidth: 105, kind: 'number' },
    { prop: 'factQty', label: '当前库存', minWidth: 105, kind: 'number' },
    { prop: 'gapQty', label: '缺口数量', minWidth: 105, kind: 'number' },
    { prop: 'purchaseQty', label: '建议采购数量', minWidth: 105, kind: 'number' },
    { prop: 'purchaseId', label: '采购申请', minWidth: 130 },
    { prop: 'updatedByName', label: '操作人', minWidth: 110 },
    { prop: 'updatedAt', label: '操作时间', minWidth: 150, kind: 'datetime' },
    { prop: 'statusName', label: '状态', minWidth: 105, kind: 'status' },
  ],
  dictionaries: ['production_shortage_status'],
  formComponent: ShortageViewForm,
  rowActions: [
    { key: 'view', label: '查看', handler: (row, ctx) => ctx.openView(row) },
    {
      key: 'terminate',
      label: '终止生产',
      kind: 'danger',
      show: (row) => Number(row.status) === 0,
      confirm: '终止后将关闭未执行出库和未处理缺料，是否继续？',
      handler: async (row) => {
        await api.post(`/production/plans/${row.planId}/terminate`, {});
        ElMessage.success('已终止生产计划');
      },
    },
  ],
};
