import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '@/api';

type BusinessRow = Record<string, any>;

export function supplementHistoryAction(row: BusinessRow): 'confirm' | 'bom-return' {
  return Number(row.confirmStatus) === 0 ? 'confirm' : 'bom-return';
}

export async function confirmPendingSupplement(row: BusinessRow) {
  await ElMessageBox.confirm('确认后将按补料明细立即扣减库存，是否继续？', '确认补料出库', {
    type: 'warning',
  });
  await api.post(`/production/outputs/${row.id}/confirm`, {
    comment: String(row.remark ?? '临时补料'),
    details: row.details ?? [],
  });
  ElMessage.success('临时补料已确认出库');
}
