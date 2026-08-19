import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SystemService } from './system.service';

function createPrisma() {
  const prisma = {
    hspsi_sys_user: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    hspsi_sys_role: {
      findFirst: vi.fn(),
    },
    hspsi_sys_user_role: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    hspsi_sys_user_role_override: {
      upsert: vi.fn(),
    },
    hspsi_sys_user_authorized_org: {
      findMany: vi.fn().mockResolvedValue([{ org_id: 2n }]),
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    hspsi_basic_organization: {
      findMany: vi.fn().mockResolvedValue([{ org_id: 2n }, { org_id: 3n }]),
    },
  };
  return Object.assign(prisma, {
    $transaction: vi.fn(async (work: (tx: typeof prisma) => unknown) => work(prisma)),
  });
}

describe('SystemService.updateUserRoles', () => {
  let prisma: ReturnType<typeof createPrisma>;
  let service: SystemService;

  beforeEach(() => {
    prisma = createPrisma();
    service = new SystemService(prisma as never, {} as never);
  });

  it('拒绝非超级管理员变更用户角色', async () => {
    await expect(service.updateUserRoles('9', { roleId: '1' }, '2', false)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.hspsi_sys_user.findFirst).not.toHaveBeenCalled();
  });

  it('超级管理员可以变更OA用户角色且不访问金额白名单', async () => {
    prisma.hspsi_sys_user.findFirst.mockResolvedValue({
      id: 9n,
      username: '13812345678',
      staff_id: 10n,
      org_id: 2n,
    });
    prisma.hspsi_sys_role.findFirst.mockResolvedValue({ id: 1n, code: 'admin' });

    await expect(
      service.updateUserRoles('9', { roleId: '1', authorizedOrgIds: ['2', '3'] }, '1', true),
    ).resolves.toMatchObject({ roleId: '1' });

    expect(prisma.hspsi_sys_user_role.createMany).toHaveBeenCalledWith({
      data: [{ user_id: 9, role_id: 1 }],
      skipDuplicates: true,
    });
    expect(prisma.hspsi_sys_user_role_override.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { user_id: 9n } }),
    );
    expect(prisma.hspsi_sys_user_authorized_org.createMany).toHaveBeenCalledWith({
      data: [
        { user_id: 9n, org_id: 2n, created_by: 0n },
        { user_id: 9n, org_id: 3n, created_by: 1n },
      ],
      skipDuplicates: true,
    });
  });
});
