import { computed, reactive } from 'vue';
import { api } from '@/api';
import type { BusinessDocumentConfig, OptionBagName, QueryField } from './business-document-config';

const OPTION_BAG_ENDPOINTS: Record<OptionBagName, string> = {
  orgs: '/base-data/organizations/options',
  warehouses: '/base-data/warehouses/options',
  depts: '/base-data/departments/options',
  vendors: '/base-data/vendors/options',
  users: '/base-data/users/options',
  units: '/base-data/units/options',
  goods: '/goods',
};

/** 字典、查询选项和组织联动加载，保持共享页面只负责编排。 */
export function useBusinessDocumentOptions(
  getConfig: () => BusinessDocumentConfig,
  query: Record<string, any>,
) {
  const dicts = reactive<Record<string, any[]>>({});
  const options = reactive<Record<string, any[]>>({});
  const dynamicOptions = reactive<Record<string, any[]>>({});

  const statusOptions = computed(() => {
    const config = getConfig();
    if (config.autoStatusFilter === false) return [];
    const code = (config.dictionaries ?? []).find((item) => item.includes('status'));
    return code ? (dicts[code] ?? []) : [];
  });

  const organizationTree = computed(() => {
    const build = (items: any[], parentId?: string): any[] =>
      items
        .filter((item: any) => (item.raw?.parentId ?? item.parentId ?? null) === (parentId ?? null))
        .map((item: any) => ({
          value: item.value,
          label: item.label,
          children: build(items, item.value),
        }));
    return build(options.orgs ?? []);
  });

  const fieldOptions = (field: QueryField) => {
    if (field.dependsOn) return dynamicOptions[field.key] ?? [];
    if (field.dictionary) return dicts[field.dictionary] ?? [];
    if (field.optionBag) return options[field.optionBag] ?? [];
    return field.options ?? [];
  };

  async function loadDicts() {
    for (const code of getConfig().dictionaries ?? []) {
      if (dicts[code]) continue;
      dicts[code] = (await api.get(`/dictionaries/${code}`).catch(() => [])) as any[];
    }
  }

  async function loadOptionBags() {
    const bags = [...new Set<OptionBagName>([...(getConfig().optionBags ?? []), 'users'])];
    const results = await Promise.all(
      bags.map((name) =>
        api
          .get(OPTION_BAG_ENDPOINTS[name], {
            ...(name === 'goods'
              ? { params: { pageSize: 200, status: 1 } }
              : name === 'users'
                ? { params: { pageSize: 1000 } }
                : {}),
          })
          .catch(() => []),
      ),
    );
    bags.forEach((name, index) => {
      const data: any = results[index];
      options[name] = (Array.isArray(data) ? data : data?.items ?? []) as any[];
    });
  }

  async function loadFieldOptions(field: QueryField) {
    if (!field.dependsOn) return;
    const depValue = query[field.dependsOn];
    if (depValue === undefined || depValue === null || depValue === '') {
      dynamicOptions[field.key] = [];
      return;
    }
    try {
      if (field.loadOptions) {
        dynamicOptions[field.key] = await field.loadOptions({ [field.dependsOn]: depValue });
        return;
      }
      if (field.optionBag) {
        const data: any = await api.get(OPTION_BAG_ENDPOINTS[field.optionBag], {
          params: { [field.dependsOn]: depValue },
        });
        dynamicOptions[field.key] = (Array.isArray(data) ? data : data?.items ?? []) as any[];
      }
    } catch {
      dynamicOptions[field.key] = [];
    }
  }

  function clearDynamicOptions() {
    for (const key of Object.keys(dynamicOptions)) delete dynamicOptions[key];
  }

  return {
    dicts,
    options,
    dynamicOptions,
    statusOptions,
    organizationTree,
    fieldOptions,
    loadDicts,
    loadOptionBags,
    loadFieldOptions,
    clearDynamicOptions,
  };
}
