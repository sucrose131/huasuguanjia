import { describe, expect, it, vi } from 'vitest';
import { TodoService } from './todo.service';

describe('TodoService', () => {
  function fixture() {
    const findFirst = vi.fn().mockResolvedValue(null);
    const create = vi.fn().mockResolvedValue({ id: 1 });
    const prisma = {
      hspsi_sys_todo: { findFirst, create },
    };
    return { service: new TodoService(prisma as never), findFirst, create };
  }

  const base = {
    userId: 5,
    organizationId: 9,
    title: 'CG202608260001',
    content: '测试待办',
    businessType: 'purchase_order',
    businessId: 20,
    actorUserId: '3',
  };

  it('creates a pending todo with business_type mapping fields', async () => {
    const { service, create } = fixture();

    const result = await service.create(base);

    expect(result).toEqual({ created: true });
    expect(create).toHaveBeenCalledWith({
      data: {
        organization_id: 9,
        user_id: 5,
        title: 'CG202608260001',
        content: '测试待办',
        source_type: 'purchase_order',
        source_id: 20,
        business_type: 'purchase_order',
        business_id: 20,
        status: 0,
        created_by: 3,
        updated_by: 3,
      },
    });
  });

  it('does not duplicate an existing uncompleted todo for the same business+user', async () => {
    const { service, findFirst, create } = fixture();
    findFirst.mockResolvedValue({ id: 7 });

    const result = await service.create(base);

    expect(result).toEqual({ created: false });
    expect(create).not.toHaveBeenCalled();
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        business_type: 'purchase_order',
        business_id: 20,
        user_id: 5,
        status: 0,
        deleted_at: null,
      },
      select: { id: true },
    });
  });

  it('skips writing when userId is missing or invalid', async () => {
    const { service, create } = fixture();

    await expect(service.create({ ...base, userId: 0 })).resolves.toEqual({ created: false });
    await expect(service.create({ ...base, userId: -1 })).resolves.toEqual({ created: false });
    expect(create).not.toHaveBeenCalled();
  });
});
