type PermissionRequest = {
  method?: string;
  originalUrl?: string;
  url?: string;
  body?: Record<string, unknown>;
};

const PAGE_RESOURCES: Record<string, Set<string>> = {
  purchase: new Set(['applications', 'orders', 'receipts', 'returns', 'payments', 'refunds']),
  inventory: new Set([
    'stocks',
    'general-inputs',
    'general-outputs',
    'transfers',
    'adjustments',
    'losses',
    'loss-outputs',
    'overflows',
    'checks',
    'quantity-alerts',
    'expiry-alerts',
  ]),
  production: new Set(['plans', 'outputs', 'inputs', 'boms']),
  sales: new Set([
    'orders',
    'outputs',
    'returns',
    'payments',
    'refunds',
    'discount-orders',
    'services',
  ]),
  requisitions: new Set(['applications', 'outputs', 'returns']),
};

const MODULES = new Set([...Object.keys(PAGE_RESOURCES), 'base-data', 'goods']);
const BASE_DATA_RESOURCES: Record<string, string> = {
  vendors: 'vendors',
  customers: 'customers',
  organizations: 'companies',
  departments: 'departments',
  positions: 'positions',
  employees: 'employees',
  warehouses: 'warehouses',
  units: 'units',
};
const SUBMIT_PAGES = new Set([
  'purchase:applications',
  'purchase:returns',
  'inventory:transfers',
  'inventory:adjustments',
  'inventory:losses',
  'inventory:overflows',
  'requisitions:applications',
]);

function normalizedSegments(request: PermissionRequest) {
  const pathname = String(request.originalUrl ?? request.url ?? '').split('?')[0] ?? '';
  const segments = pathname.split('/').filter(Boolean);
  const moduleIndex = segments.findIndex((segment) => MODULES.has(segment));
  return moduleIndex >= 0 ? segments.slice(moduleIndex) : [];
}

function pageContext(segments: string[]) {
  const [moduleName, rawResource] = segments;
  if (!moduleName) return null;
  if (moduleName === 'base-data') {
    const mapped = rawResource ? BASE_DATA_RESOURCES[rawResource] : undefined;
    return mapped
      ? { moduleName: 'master-data', resource: mapped, pageCode: `master-data:${mapped}` }
      : null;
  }
  if (moduleName === 'goods') {
    const resource = rawResource === 'categories' ? 'categories' : rawResource === 'properties' ? 'properties' : 'products';
    return { moduleName, resource, pageCode: `goods:${resource}` };
  }
  if (!rawResource) return null;
  const resource =
    moduleName === 'inventory' && rawResource === 'overflow-inputs'
      ? 'overflows'
      : moduleName === 'production' && rawResource === 'material-returns'
        ? 'outputs'
        : rawResource;
  if (!PAGE_RESOURCES[moduleName]?.has(resource)) return null;
  return { moduleName, resource, pageCode: `${moduleName}:${resource}` };
}

function customAction(segments: string[], method: string) {
  const [moduleName, resource, third, fourth] = segments;
  if (moduleName === 'production' && resource === 'material-returns') {
    if (fourth === 'confirm') return 'confirm-material-return';
    if (fourth === 'void') return 'void-material-return';
    if (fourth === 'reverse') return 'reverse-material-return';
    if (method !== 'GET') return 'create-material-return';
  }
  if (moduleName === 'purchase' && resource === 'refunds') {
    if (method === 'DELETE' && third === 'flows') return 'void-record';
    if (method === 'POST' && fourth === 'flows') return 'record';
  }
  if (moduleName === 'sales' && resource === 'services' && fourth === 'progress') {
    if (method === 'POST') return 'progress-create';
    if (method === 'PATCH' || method === 'PUT') return 'progress-update';
    if (method === 'DELETE') return 'progress-delete';
  }
  if (moduleName === 'inventory' && resource === 'quantity-alerts' && method === 'POST')
    return 'update';
  const last = segments.at(-1) ?? '';
  if (!/^\d+$/.test(last) && segments.length >= 4) {
    if (last === 'submit-oa') return 'submit';
    return last;
  }
  return '';
}

/**
 * 将业务请求映射为“菜单查看 + 页面操作”权限。
 * 只处理已纳入角色权限表的业务页面；选项、健康检查等辅助接口继续使用显式装饰器权限。
 *
 * 权限结果取值：
 * - [PUBLIC_READ]：主数据（商品/基础资料）读取，任意登录用户可读（用于表单引用下拉），仅需登录。
 * - []：下拉/选项辅助接口，回退到装饰器的模块目录 code。
 * - [module]：业务单据读取，按模块目录 code。
 * - [page, page:action]：写操作，按页面 + 操作 code。
 */
export const PUBLIC_READ = '@public-read';

export function inferRequestPermissions(request: PermissionRequest): string[] {
  const segments = normalizedSegments(request);
  // 下拉/选项辅助接口（*-options 或 /options）不绑定具体页面：
  // 统一回退到装饰器里的模块目录 code，由 PermissionGuard 按“目录或其下任一权限”判定，
  // 避免「列表走页面 code、options 走目录 code」的不一致导致新角色 options 报 403。
  if (segments.some((segment) => segment === 'options' || segment.endsWith('-options')))
    return [];
  const context = pageContext(segments);
  if (!context) return [];
  const method = String(request.method ?? 'GET').toUpperCase();
  if (method === 'GET') {
    // 主数据（商品/基础资料）读取：不设权限校验，任意登录用户可读，
    // 供各业务表单引用商品、分类、仓库、组织等下拉数据。
    if (context.moduleName === 'goods' || context.moduleName === 'master-data')
      return [PUBLIC_READ];
    // 业务单据读取：按模块级判断，引用其它单据只要求拥有该模块目录 code。
    const required = new Set<string>([context.moduleName]);
    if (segments.includes('export')) required.add(`${context.pageCode}:export`);
    return [...required];
  }

  const required = new Set<string>([context.pageCode]);
  const action = customAction(segments, method);
  if (action) required.add(`${context.pageCode}:${action}`);
  else if (method === 'POST') required.add(`${context.pageCode}:create`);
  else if (method === 'PATCH' || method === 'PUT') required.add(`${context.pageCode}:update`);
  else if (method === 'DELETE') required.add(`${context.pageCode}:delete`);

  if (Boolean(request.body?.submit) && SUBMIT_PAGES.has(context.pageCode))
    required.add(`${context.pageCode}:submit`);
  return [...required];
}
