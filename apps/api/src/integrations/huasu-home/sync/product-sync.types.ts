/** 商品同步统计 */
export interface HuasuHomeProductSyncStats {
  products: {
    created: number;
    updated: number;
    mappingOnly: number;
    skipped: number;
  };
  packages: {
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

/** 已同步单品在内存中的索引 */
export interface SyncedProductRef {
  sourceProductId: number;
  goodsId: bigint;
  /** 外部 sku.id → 平台 sku_id */
  skuIds: Map<number, bigint>;
  /** 默认规格平台 sku_id（number===1 的第一个；都没有则取列表第一个） */
  defaultSkuId: bigint;
}
