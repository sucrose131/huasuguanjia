/*
 * @Author: KasperFan && kasperfan@outlook.com
 * @Date: 2026-08-27 15:55:50
 * @LastEditTime: 2026-08-27 15:56:15
 * @FilePath: /hspsi/apps/web/src/views/business/configs/sales-order-actions.spec.ts
 * @describes: This file is created for learning Code.
 * Copyright (c) 2026 by KasperFan in WFU, All Rights Reserved. 
 */
import { describe, expect, it } from 'vitest';
import { salesOrderConfig } from './sales-order';

describe('sales order row actions', () => {
  it('keeps only the frequent view and direct-output actions inline', () => {
    const actions = salesOrderConfig.rowActions ?? [];
    const primaryKeys = actions
      .filter((action) => action.primary !== false)
      .map((action) => action.key);
    const moreKeys = actions
      .filter((action) => action.primary === false)
      .map((action) => action.key);

    expect(primaryKeys).toEqual(['view', 'direct-output']);
    expect(moreKeys).toEqual([
      'edit',
      'analyze',
      'receive',
      'refund',
      'return',
      'service',
      'delete',
    ]);
  });
});
