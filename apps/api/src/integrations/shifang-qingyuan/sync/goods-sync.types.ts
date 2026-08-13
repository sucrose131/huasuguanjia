/** 商品同步统计 */
export interface ShifangQingyuanGoodsSyncStats {
  goods: {
    created: number;
    updated: number;
    mappingOnly: number;
    skipped: number;
  };
  skus: {
    created: number;
    updated: number;
  };
  mappings: {
    upserted: number;
    disabled: number;
  };
  conversionRules: {
    upserted: number;
  };
  warnings: string[];
}

/** 已同步商品在内存中的索引 */
export interface SyncedGoodsRef {
  sourceGoodsId: number;
  goodsId: bigint;
  /** 外部 attr.id → 平台 sku_id */
  skuIds: Map<number, bigint>;
  /** 默认规格平台 sku_id（sort 最小的第一个） */
  defaultSkuId: bigint;
}
