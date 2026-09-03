import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { GLOBAL_AMOUNT_FIELDS } from './amount-field-registry';
import { AmountAccessService } from './amount-access.service';

function setup(options?: {
  user?: Record<string, unknown> | null;
  access?: Record<string, unknown> | null;
}) {
  const prisma: any = {
    hspsi_sys_user: {
      findFirst: vi
        .fn()
        .mockResolvedValue(options?.user === undefined ? { id: 3n, status: 1 } : options.user),
    },
    hspsi_sys_user_amount_access: {
      findUnique: vi.fn().mockResolvedValue(options?.access ?? null),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      upsert: vi.fn().mockResolvedValue({}),
    },
    hspsi_sys_oper_log: { create: vi.fn().mockResolvedValue({}) },
  };
  prisma.$transaction = vi.fn((callback: (tx: any) => unknown) => callback(prisma));
  return { service: new AmountAccessService(prisma), prisma };
}

const NONE_STATE = {
  level: 'none',
  canViewAmount: false,
  canEditAmount: false,
  amountScope: 'own',
} as const;

describe('AmountAccessService', () => {
  it('defaults every user without a whitelist record to no amount access', async () => {
    const { service } = setup();

    await expect(service.forUser('3')).resolves.toEqual(NONE_STATE);
  });

  it('does not grant an inactive user access even when a whitelist record exists', async () => {
    const { service } = setup({
      user: null,
      access: { user_id: 3n, can_view_amount: 1, can_edit_amount: 1 },
    });

    await expect(service.forUser('3')).resolves.toMatchObject({ level: 'none' });
  });

  it('treats edit access as including view access', async () => {
    const { service } = setup({
      access: { user_id: 3n, can_view_amount: 0, can_edit_amount: 1 },
    });

    await expect(service.forUser('3')).resolves.toEqual({
      level: 'edit',
      canViewAmount: true,
      canEditAmount: true,
      amountScope: 'own',
    });
  });

  it('defaults an existing grant without a scope column value to own scope', async () => {
    const { service } = setup({
      access: { user_id: 3n, can_view_amount: 1, can_edit_amount: 0, amount_scope: 1 },
    });

    await expect(service.forUser('3')).resolves.toEqual({
      level: 'view',
      canViewAmount: true,
      canEditAmount: false,
      amountScope: 'own',
    });
  });

  it('reads amount_scope=2 as all-documents scope', async () => {
    const { service } = setup({
      access: { user_id: 3n, can_view_amount: 1, can_edit_amount: 1, amount_scope: 2 },
    });

    await expect(service.forUser('3')).resolves.toEqual({
      level: 'edit',
      canViewAmount: true,
      canEditAmount: true,
      amountScope: 'all',
    });
  });

  it('rejects amount writes for users outside the edit whitelist', async () => {
    const { service } = setup();

    await expect(service.assertCanEdit('3')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows all-scope editors to edit any record', async () => {
    const { service } = setup({
      access: { user_id: 3n, can_view_amount: 1, can_edit_amount: 1, amount_scope: 2 },
    });

    await expect(service.assertCanEditRecord('3', '99')).resolves.toMatchObject({
      amountScope: 'all',
    });
  });

  it('allows own-scope editors to edit records they created', async () => {
    const { service } = setup({
      access: { user_id: 3n, can_view_amount: 1, can_edit_amount: 1, amount_scope: 1 },
    });

    await expect(service.assertCanEditRecord('3', '3')).resolves.toMatchObject({
      amountScope: 'own',
    });
  });

  it('blocks own-scope editors from editing records created by others', async () => {
    const { service } = setup({
      access: { user_id: 3n, can_view_amount: 1, can_edit_amount: 1, amount_scope: 1 },
    });

    await expect(service.assertCanEditRecord('3', '99')).rejects.toThrow(
      '只能编辑自己经办单据',
    );
  });

  it('treats a missing or system owner as not-owned for own-scope editors', async () => {
    const { service } = setup({
      access: { user_id: 3n, can_view_amount: 1, can_edit_amount: 1, amount_scope: 1 },
    });

    await expect(service.assertCanEditRecord('3', undefined)).rejects.toThrow(
      '只能编辑自己经办单据',
    );
  });

  it('masks registered amount fields recursively without changing normal fields', () => {
    const { service } = setup();
    const result = service.maskFields(
      {
        orderNo: 'PO001',
        totalAmount: 120,
        details: [{ goodsName: '试剂', unitPrice: 12, quantity: 10 }],
      },
      new Set(['totalAmount', 'unitPrice']),
    );

    expect(result).toEqual({
      orderNo: 'PO001',
      totalAmount: null,
      details: [{ goodsName: '试剂', unitPrice: null, quantity: 10 }],
    });
  });

  it('masks inventory alert and check amount fields returned by their APIs', () => {
    const { service } = setup();
    const result = service.maskFields(
      {
        alertValue: 90,
        check: {
          all_value: 100,
          less_value: 10,
          overflow_value: 5,
          less_process_value: 4,
          overflow_process_value: 2,
          all_qty: 12,
        },
      },
      GLOBAL_AMOUNT_FIELDS,
    );

    expect(result).toEqual({
      alertValue: null,
      check: {
        all_value: null,
        less_value: null,
        overflow_value: null,
        less_process_value: null,
        overflow_process_value: null,
        all_qty: 12,
      },
    });
  });

  it('keeps amounts on records created by the user and masks others with nested lines', () => {
    const { service } = setup();
    const result = service.maskAmountsByOwner(
      {
        items: [
          {
            orderNo: 'PO001',
            createdBy: '3',
            totalAmount: 120,
            details: [{ goodsName: '试剂', unitPrice: 12, quantity: 10 }],
          },
          {
            orderNo: 'PO002',
            createdBy: '99',
            totalAmount: 300,
            details: [{ goodsName: '耗材', unitPrice: 30, quantity: 10 }],
          },
        ],
        total: 2,
      },
      '3',
    );

    expect(result).toEqual({
      items: [
        {
          orderNo: 'PO001',
          createdBy: '3',
          totalAmount: 120,
          details: [{ goodsName: '试剂', unitPrice: 12, quantity: 10 }],
        },
        {
          orderNo: 'PO002',
          createdBy: '99',
          totalAmount: null,
          details: [{ goodsName: '耗材', unitPrice: null, quantity: 10 }],
        },
      ],
      total: 2,
    });
  });

  it('default-denies amounts that carry no owner field (aggregates)', () => {
    const { service } = setup();
    const result = service.maskAmountsByOwner(
      { purchaseAmount: 1000, orderCount: 5 },
      '3',
    );

    expect(result).toEqual({ purchaseAmount: null, orderCount: 5 });
  });

  it('keeps an amount-bearing child object under an owned parent', () => {
    const { service } = setup();
    const result = service.maskAmountsByOwner(
      {
        createdBy: '3',
        paidAmount: 50,
        position: { effectivePayable: 60, paidAmount: 50 },
      },
      '3',
    );

    expect(result).toEqual({
      createdBy: '3',
      paidAmount: 50,
      position: { effectivePayable: 60, paidAmount: 50 },
    });
  });

  it('saves an explicit edit grant and writes an audit log', async () => {
    const { service, prisma } = setup({
      user: { id: 3n, username: 'buyer', nickname: '采购', status: 1 },
    });

    await service.saveForUser('3', { level: 'edit', grantReason: '业务负责人确认' }, '1');

    expect(prisma.hspsi_sys_user_amount_access.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          can_view_amount: 1,
          can_edit_amount: 1,
          amount_scope: 1,
        }),
      }),
    );
    expect(prisma.hspsi_sys_oper_log.create).toHaveBeenCalledOnce();
  });

  it('persists all scope on an all-documents edit grant', async () => {
    const { service, prisma } = setup({
      user: { id: 3n, username: 'finance', nickname: '财务', status: 1 },
    });

    await service.saveForUser(
      '3',
      { level: 'edit', amountScope: 'all', grantReason: '业务负责人确认' },
      '1',
    );

    expect(prisma.hspsi_sys_user_amount_access.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ amount_scope: 2 }),
      }),
    );
  });

  it('rejects an invalid amount scope value', async () => {
    const { service } = setup({
      user: { id: 3n, username: 'buyer', nickname: '采购', status: 1 },
    });

    await expect(
      service.saveForUser(
        '3',
        { level: 'view', amountScope: 'team', grantReason: '业务负责人确认' },
        '1',
      ),
    ).rejects.toThrow('金额数据范围无效');
  });
});
