/** 仓库筛选「全部」统计 = 各仓库计数之和（与仓库 Tab 口径一致，不随选中仓库变化） */
export function sumWarehouseCounts(counts?: Record<string, number> | null): number {
  return Object.values(counts ?? {}).reduce((sum, value) => sum + Number(value ?? 0), 0);
}
