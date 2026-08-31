/**
 * 商品下拉按仓库类型过滤（双向联动：选仓库后商品按分类仓库类型收窄）。
 * - 未选仓库 / 仓库类型未知：返回全量；
 * - 已选仓库后只保留分类仓库类型完全匹配的商品；
 * - 未配置仓库类型的商品不能进入正式业务候选；
 * - 混合类型明细（单据未锁定类型）同样只受已选仓库约束。
 */
export function filterGoodsByWarehouseType(
  goods: Array<Record<string, any>>,
  warehouseType: number | string | undefined | null,
) {
  const type = Number(warehouseType ?? 0);
  if (!type) return goods;
  return goods.filter((g) => Number(g.categoryWarehouseType ?? 0) === type);
}

/** 在已经通过组织—仓库类型映射的候选中搜索，不允许绕过候选集合查全库。 */
export function filterMappedGoodsByKeyword(
  goods: Array<Record<string, any>>,
  keyword: string | undefined | null,
) {
  const normalized = String(keyword ?? '').trim().toLocaleLowerCase();
  if (!normalized) return goods;
  return goods.filter((item) =>
    [item.queryCode, item.goodsName, item.shortName, item.brandName]
      .map((value) => String(value ?? '').toLocaleLowerCase())
      .some((value) => value.includes(normalized)),
  );
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
