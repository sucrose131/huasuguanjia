import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AmountAccessService } from './amount-access.service';

function setup(options?: { user?: Record<string, unknown> | null; access?: Record<string, unknown> | null }) {
  const prisma: any = {
    hspsi_sys_user: {
      findFirst: vi.fn().mockResolvedValue(options?.user === undefined ? { id: 3n, status: 1 } : options.user),
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

describe('AmountAccessService', () => {
  it('defaults every user without a whitelist record to no amount access', async () => {
    const { service } = setup();

    await expect(service.forUser('3')).resolves.toEqual({
      level: 'none',
      canViewAmount: false,
      canEditAmount: false,
    });
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
    });
  });

  it('rejects amount writes for users outside the edit whitelist', async () => {
    const { service } = setup();

    await expect(service.assertCanEdit('3')).rejects.toBeInstanceOf(ForbiddenException);
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

  it('saves an explicit edit grant and writes an audit log', async () => {
    const { service, prisma } = setup({
      user: { id: 3n, username: 'buyer', nickname: '采购', status: 1 },
    });

    await service.saveForUser('3', { level: 'edit', grantReason: '业务负责人确认' }, '1');

    expect(prisma.hspsi_sys_user_amount_access.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ can_view_amount: 1, can_edit_amount: 1 }),
      }),
    );
    expect(prisma.hspsi_sys_oper_log.create).toHaveBeenCalledOnce();
  });
});
