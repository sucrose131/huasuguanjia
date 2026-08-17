import { beforeEach, describe, expect, it, vi } from 'vitest';
import { compare } from 'bcryptjs';
import {
  loginPasswordFromMobile,
  normalizeMobile,
  XinfutongOaSyncService,
} from './sync.service';

function createPrisma() {
  return {
    hspsi_sys_user: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    hspsi_basic_staff: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    hspsi_basic_staff_organizations: {
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
    hspsi_basic_position: { findFirst: vi.fn() },
    hspsi_basic_organization: { findFirst: vi.fn() },
    hspsi_basic_dept: { findFirst: vi.fn() },
    hspsi_sys_user_role: {
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  };
}

describe('normalizeMobile / loginPasswordFromMobile', () => {
  it('去掉空白后作为登录账号', () => {
    expect(normalizeMobile(' 138 1234 5678 ')).toBe('13812345678');
  });

  it('初始密码取数字后六位', () => {
    expect(loginPasswordFromMobile('13812345678')).toBe('345678');
    expect(loginPasswordFromMobile('')).toBeNull();
    expect(loginPasswordFromMobile('12345')).toBeNull();
  });
});

describe('XinfutongOaSyncService.upsertLoginUserByMobile', () => {
  let prisma: ReturnType<typeof createPrisma>;
  let service: XinfutongOaSyncService;

  beforeEach(() => {
    prisma = createPrisma();
    service = new XinfutongOaSyncService(prisma as never);
  });

  it('空手机号或不足六位数字时跳过', async () => {
    await expect(service.upsertLoginUserByMobile({ mobile: '', name: '张三' })).resolves.toBe(
      'skipped',
    );
    await expect(service.upsertLoginUserByMobile({ mobile: '12345', name: '张三' })).resolves.toBe(
      'skipped',
    );
    expect(prisma.hspsi_sys_user.create).not.toHaveBeenCalled();
  });

  it('新建账号使用手机号登录、后六位密码，且不分配角色', async () => {
    prisma.hspsi_sys_user.findFirst.mockResolvedValue(null);
    prisma.hspsi_basic_staff.findFirst.mockResolvedValue({ id: 1n });
    prisma.hspsi_sys_user.create.mockResolvedValue({ id: 9n });

    await expect(
      service.upsertLoginUserByMobile({
        mobile: '13812345678',
        name: '张三',
        orgId: 2n,
        deptId: 3n,
      }),
    ).resolves.toBe('inserted');

    const data = prisma.hspsi_sys_user.create.mock.calls[0][0].data;
    expect(data.username).toBe('13812345678');
    expect(data.phone).toBe('13812345678');
    expect(data.nickname).toBe('张三');
    expect(data.org_id).toBe(2n);
    expect(data.dept_id).toBe(3n);
    expect(data.status).toBe(1);
    expect(await compare('345678', data.password)).toBe(true);
    expect(prisma.hspsi_sys_user_role.createMany).not.toHaveBeenCalled();
  });

  it('同一手机号只更新已有账号，不改密码', async () => {
    prisma.hspsi_sys_user.findFirst.mockResolvedValue({
      id: 9n,
      username: '13812345678',
      password: 'old-hash',
    });
    prisma.hspsi_basic_staff.findFirst.mockResolvedValue({ id: 1n });

    await expect(
      service.upsertLoginUserByMobile({ mobile: '13812345678', name: '李四' }),
    ).resolves.toBe('updated');

    expect(prisma.hspsi_sys_user.create).not.toHaveBeenCalled();
    expect(prisma.hspsi_sys_user.update).toHaveBeenCalledWith({
      where: { id: 9n },
      data: expect.not.objectContaining({ password: expect.anything() }),
    });
    expect(prisma.hspsi_sys_user.update.mock.calls[0][0].data.nickname).toBe('李四');
    expect(prisma.hspsi_sys_user_role.deleteMany).not.toHaveBeenCalled();
  });

  it('该手机号已无有效 OA 人员时禁用登录账号', async () => {
    prisma.hspsi_sys_user.findFirst.mockResolvedValue({
      id: 9n,
      username: '13812345678',
    });
    prisma.hspsi_basic_staff.findFirst.mockResolvedValue(null);

    await service.upsertLoginUserByMobile({ mobile: '13812345678', name: '张三' });

    expect(prisma.hspsi_sys_user.update).toHaveBeenCalledWith({
      where: { id: 9n },
      data: expect.objectContaining({ status: 2, deleted_at: null }),
    });
  });

  it('跨账套仍有有效人员时不禁用登录账号', async () => {
    prisma.hspsi_sys_user.findFirst.mockResolvedValue({
      id: 9n,
      username: '13812345678',
    });
    prisma.hspsi_basic_staff.findFirst.mockResolvedValue({ id: 88n });

    await service.upsertLoginUserByMobile({ mobile: '13812345678', name: '张三' });

    expect(prisma.hspsi_basic_staff.findFirst).toHaveBeenCalledWith({
      where: { mobile: '13812345678', status: 1, deleted_at: null },
      select: { id: true },
    });
    expect(prisma.hspsi_sys_user.update).toHaveBeenCalledWith({
      where: { id: 9n },
      data: expect.objectContaining({ status: 1 }),
    });
  });

  it('不禁用 admin 账号、不改其密码', async () => {
    prisma.hspsi_sys_user.findFirst.mockResolvedValue({
      id: 1n,
      username: 'admin',
      password: 'keep',
    });
    prisma.hspsi_basic_staff.findFirst.mockResolvedValue(null);

    await expect(
      service.upsertLoginUserByMobile({ mobile: '13812345678', name: 'x' }),
    ).resolves.toBe('updated');
    expect(prisma.hspsi_sys_user.update).not.toHaveBeenCalled();
  });

  it('新建时若人员已失效则账号直接停用', async () => {
    prisma.hspsi_sys_user.findFirst.mockResolvedValue(null);
    prisma.hspsi_basic_staff.findFirst.mockResolvedValue(null);
    prisma.hspsi_sys_user.create.mockResolvedValue({ id: 9n });

    await service.upsertLoginUserByMobile({ mobile: '13812345678', name: '张三' });

    expect(prisma.hspsi_sys_user.create.mock.calls[0][0].data.status).toBe(2);
  });

  it('查找登录账号时包含软删除行，并在更新时恢复', async () => {
    prisma.hspsi_sys_user.findFirst.mockResolvedValue({
      id: 9n,
      username: '13812345678',
      deleted_at: new Date('2026-01-01'),
    });
    prisma.hspsi_basic_staff.findFirst.mockResolvedValue({ id: 1n });

    await service.upsertLoginUserByMobile({ mobile: '13812345678', name: '张三' });

    expect(prisma.hspsi_sys_user.findFirst).toHaveBeenCalledWith({
      where: { username: '13812345678' },
    });
    expect(prisma.hspsi_sys_user.update).toHaveBeenCalledWith({
      where: { id: 9n },
      data: expect.objectContaining({ deleted_at: null, status: 1 }),
    });
  });
});
