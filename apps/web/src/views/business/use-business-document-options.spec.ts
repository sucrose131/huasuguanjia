import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock('@/api', () => ({
  api: {
    get: apiGet,
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

import { useBusinessDocumentOptions } from './use-business-document-options';
import type { BusinessDocumentConfig, QueryField } from './business-document-config';

const authorizedWarehouses = [
  { value: '1', label: '销售-实体成品仓', raw: { orgId: '9' } },
  { value: '12', label: '生产-原料仓', raw: { orgId: '6' } },
];
const org9Warehouses = [{ value: '1', label: '销售-实体成品仓', raw: { orgId: '9' } }];

function warehouseField(extra: Record<string, any> = {}): QueryField {
  return {
    key: 'warehouseId',
    label: '仓库',
    type: 'select',
    dependsOn: 'orgId',
    width: 180,
    loadOptions: async (deps: Record<string, any>) => {
      return (await apiGet('/base-data/warehouses/options', {
        params: deps.orgId ? { orgId: deps.orgId } : {},
      })) as any[];
    },
    ...extra,
  };
}

function setup(field = warehouseField()) {
  const query = reactive<Record<string, any>>({ orgId: '', warehouseId: '' });
  const config = {
    key: 'test',
    title: '测试',
    endpoint: '/test',
    no: 'no',
    columns: [],
    optionBags: ['orgs'],
    dictionaries: [],
    queryFields: [
      { key: 'orgId', label: '组织', type: 'tree-select', optionBag: 'orgs', width: 200 },
      field,
    ],
  } as unknown as BusinessDocumentConfig;
  const engine = useBusinessDocumentOptions(() => config, query);
  return { engine, query, field };
}

describe('仓库筛选 loadOnEmptyDep（不选组织加载授权仓库，选中后收窄）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('未选择组织时，loadOptions 不带 orgId 调用并展示授权组织下的仓库', async () => {
    apiGet.mockResolvedValue(authorizedWarehouses);
    const { engine, field } = setup(warehouseField({ loadOnEmptyDep: true }));

    await engine.loadFieldOptions(field);

    expect(apiGet).toHaveBeenCalledWith('/base-data/warehouses/options', { params: {} });
    expect(engine.dynamicOptions.warehouseId).toEqual(authorizedWarehouses);
    expect(engine.fieldOptions(field)).toEqual(authorizedWarehouses);
  });

  it('选择组织后，loadOptions 带 orgId 调用并收窄到该组织仓库', async () => {
    apiGet.mockResolvedValue(org9Warehouses);
    const { engine, query, field } = setup(warehouseField({ loadOnEmptyDep: true }));
    query.orgId = '9';

    await engine.loadFieldOptions(field);

    expect(apiGet).toHaveBeenCalledWith('/base-data/warehouses/options', {
      params: { orgId: '9' },
    });
    expect(engine.dynamicOptions.warehouseId).toEqual(org9Warehouses);
  });

  it('未配置 loadOnEmptyDep 时保持旧行为：依赖为空则清空选项且不请求', async () => {
    const { engine, field } = setup(warehouseField());

    await engine.loadFieldOptions(field);

    expect(apiGet).not.toHaveBeenCalled();
    expect(engine.dynamicOptions.warehouseId).toEqual([]);
  });

  it('依赖为空且 loadOnEmptyDep 时接口失败回退为空选项', async () => {
    apiGet.mockRejectedValue(new Error('网络错误'));
    const { engine, field } = setup(warehouseField({ loadOnEmptyDep: true }));

    await engine.loadFieldOptions(field);

    expect(engine.dynamicOptions.warehouseId).toEqual([]);
  });
});
