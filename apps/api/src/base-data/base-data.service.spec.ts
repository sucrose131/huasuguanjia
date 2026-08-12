import { describe, expect, it, vi } from 'vitest';
import { BaseDataService } from './base-data.service';

describe('BaseDataService organization availability', () => {
  it('only requests operating organizations for business options', async () => {
    const service = new BaseDataService({} as never);
    const list = vi.spyOn(service, 'list').mockResolvedValue({
      items: [{ id: 1n, orgNo: 'ORG001', name: '正常公司' }],
    } as never);

    await service.options('organizations');

    expect(list).toHaveBeenCalledWith('organizations', {
      keyword: undefined,
      orgId: undefined,
      page: '1',
      pageSize: '100',
      operationStatus: '1',
    });
  });

  it('rejects warehouse creation under a closed organization', async () => {
    const prisma = {
      hspsi_basic_organization: { findFirst: vi.fn().mockResolvedValue(null) },
      hspsi_basic_warehouse: { create: vi.fn() },
    };
    const service = new BaseDataService(prisma as never);

    await expect(
      service.create('warehouses', { orgId: '8', name: '停业公司仓库', warehouseType: 1 }, '1'),
    ).rejects.toThrow('所属组织已停业，不能新增或修改仓库');
    expect(prisma.hspsi_basic_warehouse.create).not.toHaveBeenCalled();
  });

  it('allows warehouse creation under an operating organization', async () => {
    const prisma = {
      hspsi_basic_organization: { findFirst: vi.fn().mockResolvedValue({ org_id: 8n }) },
      hspsi_basic_warehouse: { create: vi.fn().mockResolvedValue({ warehouse_id: 9n }) },
    };
    const service = new BaseDataService(prisma as never);

    await expect(
      service.create('warehouses', { orgId: '8', name: '正常仓库', warehouseType: 1 }, '1'),
    ).resolves.toMatchObject({ id: 9n });
    expect(prisma.hspsi_basic_organization.findFirst).toHaveBeenCalledWith({
      where: { org_id: 8n, operation_status: 1, deleted_at: null },
      select: { org_id: true },
    });
  });
});
