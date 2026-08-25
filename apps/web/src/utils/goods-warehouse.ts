/**
 * 商品下拉按仓库类型过滤（双向联动：选仓库后商品按分类仓库类型收窄）。
 * - 未选仓库 / 仓库类型未知：返回全量；
 * - 未配置仓库类型的商品（categoryWarehouseType=0）始终保留显示；
 * - 混合类型明细（单据未锁定类型）同样只受已选仓库约束。
 */
export function filterGoodsByWarehouseType(
  goods: Array<Record<string, any>>,
  warehouseType: number | string | undefined | null,
) {
  const type = Number(warehouseType ?? 0);
  if (!type) return goods;
  return goods.filter((g) => {
    const goodsType = Number(g.categoryWarehouseType ?? 0);
    return goodsType === 0 || goodsType === type;
  });
}

/** 从仓库选项列表解析当前选中仓库的 warehouse_type */
export function warehouseTypeOf(
  warehouses: Array<Record<string, any>>,
  warehouseId: unknown,
) {
  const current = (warehouses ?? []).find(
    (w) => String(w.value) === String(warehouseId),
  );
  return Number(current?.raw?.warehouseType ?? current?.warehouseType ?? 0);
}
