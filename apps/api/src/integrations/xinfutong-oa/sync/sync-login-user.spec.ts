import { beforeEach, describe, expect, it, vi } from 'vitest';
import { compare } from 'bcryptjs';
import { loginPasswordFromMobile, normalizeMobile, XinfutongOaSyncService } from './sync.service';

function createPrisma() {
  const prisma = {
    hspsi_sys_user: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    hspsi_basic_staff: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    hspsi_basic_staff_organizations: {
      deleteMany: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
    },
    hspsi_basic_position: { findFirst: vi.fn() },
    hspsi_basic_position_belongs: { findMany: vi.fn() },
    hspsi_basic_organization: { findFirst: vi.fn(), findMany: vi.fn() },
    hspsi_basic_dept: { findFirst: vi.fn() },
    hspsi_sys_dictionary_category: { findFirst: vi.fn() },
    hspsi_sys_dictionary: { findMany: vi.fn() },
    hspsi_sys_role: { findMany: vi.fn(), findFirst: vi.fn() },
    hspsi_sys_user_role: {
      createMany: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    hspsi_sys_user_role_override: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    hspsi_sys_user_authorized_org: {
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    hspsi_sys_user_oa_staff: {
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn(),
    },
  };
  return Object.assign(prisma, {
    $transaction: vi.fn(async (work: (tx: typeof prisma) => unknown) => work(prisma)),
  });
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

  it('新建账号使用手机号登录、后六位密码，角色由后续字典授权统一分配', async () => {
    prisma.hspsi_sys_user.findFirst.mockResolvedValue(null);
    prisma.hspsi_basic_staff.findFirst.mockResolvedValue({ id: 1n });
    prisma.hspsi_basic_staff.findUnique.mockResolvedValue({ account_set_id: 1n });
    prisma.hspsi_sys_user.create.mockResolvedValue({ id: 9n });

    await expect(
      service.upsertLoginUserByMobile({
        mobile: '13812345678',
        name: '张三',
        orgId: 2n,
        deptId: 3n,
        staffId: 1n,
        identityUsable: true,
      }),
    ).resolves.toBe('inserted');

    const data = prisma.hspsi_sys_user.create.mock.calls[0]![0].data;
    expect(data.username).toBe('13812345678');
    expect(data.phone).toBe('13812345678');
    expect(data.nickname).toBe('张三');
    expect(data.org_id).toBe(2n);
    expect(data.dept_id).toBe(3n);
    expect(data.staff_id).toBe(1n);
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
    expect(prisma.hspsi_sys_user.update.mock.calls[0]![0].data.nickname).toBe('李四');
    expect(prisma.hspsi_sys_user_role.deleteMany).not.toHaveBeenCalled();
  });

  it('账号已关联其他 OA 人员时拒绝自动改绑', async () => {
    prisma.hspsi_sys_user.findFirst.mockResolvedValue({
      id: 9n,
      username: '13812345678',
      staff_id: 8n,
    });
    prisma.hspsi_basic_staff.findFirst.mockResolvedValue({ id: 1n });

    await expect(
      service.upsertLoginUserByMobile({
        mobile: '13812345678',
        name: '张三',
        staffId: 1n,
        accountSetId: 1n,
        identityUsable: true,
      }),
    ).resolves.toBe('skipped');

    expect(prisma.hspsi_sys_user.update).not.toHaveBeenCalled();
  });

  it('同一手机号在不同OA账套时复用一个登录账号，不改主员工关联', async () => {
    prisma.hspsi_sys_user.findFirst.mockResolvedValue({
      id: 9n,
      username: '13812345678',
      staff_id: 8n,
    });
    prisma.hspsi_basic_staff.findFirst.mockResolvedValue({ id: 1n });
    prisma.hspsi_basic_staff.findUnique.mockResolvedValue({ account_set_id: 1n });

    await expect(
      service.upsertLoginUserByMobile({
        mobile: '13812345678',
        name: '张三',
        staffId: 1n,
        accountSetId: 2n,
        orgId: 6n,
        identityUsable: false,
      }),
    ).resolves.toBe('updated');

    expect(prisma.hspsi_sys_user.update.mock.calls[0]![0].data).not.toHaveProperty('staff_id');
    expect(prisma.hspsi_sys_user.update.mock.calls[0]![0].data).not.toHaveProperty('org_id');
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

    expect(prisma.hspsi_sys_user.create.mock.calls[0]![0].data.status).toBe(2);
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

describe('XinfutongOaSyncService.refreshUserAuthorization', () => {
  let prisma: ReturnType<typeof createPrisma>;
  let service: XinfutongOaSyncService;

  beforeEach(() => {
    prisma = createPrisma();
    service = new XinfutongOaSyncService(prisma as never);
    prisma.hspsi_basic_position.findFirst.mockResolvedValue({ outer_ref_id: 'PB0001' });
    prisma.hspsi_sys_dictionary_category.findFirst.mockImplementation(({ where }) => {
      const categories: Record<string, { dict_catg_id: number }> = {
        oa_default_staff_role: { dict_catg_id: 99 },
        oa_position_role_mapping: { dict_catg_id: 100 },
        oa_org_authorization_rule: { dict_catg_id: 101 },
      };
      return categories[where.dict_catg_code] ?? null;
    });
    prisma.hspsi_sys_dictionary.findMany.mockImplementation(({ where }) => {
      if (where.dict_catg_id === 99) return [{ dict_value: 'oa-staff-applicant' }];
      if (where.dict_catg_id === 100) return [{ dict_value: 'buyer' }];
      if (where.dict_catg_id === 101) return [{ dict_value: 'PRIMARY_ORG' }];
      return [];
    });
    prisma.hspsi_sys_role.findFirst.mockImplementation(({ where }) => {
      if (where.code === 'buyer') return { id: 8n };
      if (where.code === 'oa-staff-applicant') return { id: 7n };
      return null;
    });
    prisma.hspsi_basic_staff_organizations.findMany.mockResolvedValue([
      { org_id: 6n, org_type: 1, type: 1 },
    ]);
    prisma.hspsi_basic_organization.findMany.mockResolvedValue([{ org_id: 6n }]);
  });

  it('岗位映射角色优先于基础角色，并生成授权组织', async () => {
    await expect(
      service.refreshUserAuthorization({
        userId: 9n,
        staffId: 10n,
        postId: 11n,
        accountSetId: 1n,
        identityUsable: true,
      }),
    ).resolves.toEqual({ roleId: 8, authorizedOrgIds: [6n] });

    expect(prisma.hspsi_sys_dictionary.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: expect.objectContaining({ dict_catg_id: 99 }) }),
    );
    expect(prisma.hspsi_sys_dictionary.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: expect.objectContaining({ dict_name: 'PB0001' }) }),
    );
    expect(prisma.hspsi_sys_user_role.createMany).toHaveBeenCalledWith({
      data: [{ user_id: 9, role_id: 8 }],
      skipDuplicates: true,
    });
    expect(prisma.hspsi_sys_user_authorized_org.createMany).toHaveBeenCalledWith({
      data: [{ user_id: 9n, org_id: 6n, created_by: 0n }],
      skipDuplicates: true,
    });
    expect(prisma.hspsi_sys_user.update).toHaveBeenCalledWith({
      where: { id: 9n },
      data: expect.objectContaining({ status: 1 }),
    });
    // 测试替身故意不定义 hspsi_sys_user_amount_access；方法若碰金额白名单会立即报错。
  });

  it('员工缺少岗位时仍获得全员基础角色和主组织授权', async () => {
    prisma.hspsi_basic_position.findFirst.mockResolvedValue(null);

    await expect(
      service.refreshUserAuthorization({
        userId: 9n,
        staffId: 10n,
        postId: 0n,
        accountSetId: 1n,
        identityUsable: true,
      }),
    ).resolves.toEqual({ roleId: 7, authorizedOrgIds: [6n] });

    expect(prisma.hspsi_basic_position_belongs.findMany).not.toHaveBeenCalled();
    expect(prisma.hspsi_sys_user.update).toHaveBeenCalledWith({
      where: { id: 9n },
      data: expect.objectContaining({ status: 1 }),
    });
  });

  it('人员失效时清除 OA 角色和组织授权，不授予任何默认权限', async () => {
    await expect(
      service.refreshUserAuthorization({
        userId: 9n,
        staffId: 10n,
        postId: 11n,
        accountSetId: 1n,
        identityUsable: false,
      }),
    ).resolves.toEqual({ roleId: null, authorizedOrgIds: [] });
    expect(prisma.hspsi_sys_user_role.deleteMany).toHaveBeenCalled();
    expect(prisma.hspsi_sys_user_authorized_org.deleteMany).toHaveBeenCalled();
    expect(prisma.hspsi_sys_user_role.createMany).not.toHaveBeenCalled();
    expect(prisma.hspsi_sys_user_authorized_org.createMany).not.toHaveBeenCalled();
    expect(prisma.hspsi_sys_user.update).toHaveBeenCalledWith({
      where: { id: 9n },
      data: expect.objectContaining({ status: 2 }),
    });
  });

  it('超级管理员人工覆盖角色后，OA同步仅刷新组织且不覆盖本地角色', async () => {
    prisma.hspsi_sys_user_role_override.findUnique.mockResolvedValue({ user_id: 9n });
    prisma.hspsi_sys_user_role.count.mockResolvedValue(2);

    await expect(
      service.refreshUserAuthorization({
        userId: 9n,
        staffId: 10n,
        postId: 11n,
        accountSetId: 1n,
        identityUsable: true,
      }),
    ).resolves.toEqual({ roleId: 8, authorizedOrgIds: [6n] });

    expect(prisma.hspsi_sys_user_role.deleteMany).not.toHaveBeenCalled();
    expect(prisma.hspsi_sys_user_role.createMany).not.toHaveBeenCalled();
    expect(prisma.hspsi_sys_user_authorized_org.deleteMany).toHaveBeenCalled();
    expect(prisma.hspsi_sys_user.update).toHaveBeenCalledWith({
      where: { id: 9n },
      data: expect.objectContaining({ status: 1 }),
    });
  });
});
