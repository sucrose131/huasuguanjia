export type PermissionUser = { permissions?: string[] | null } | null | undefined;

const PAGE_ALIASES: Record<string, string> = {
  '/system/roles': 'system:1:view',
  '/system/users': 'system:2:view',
  '/system/config': 'system:3:view',
  '/system/tasks': 'system:4:view',
  '/base/vendors': 'master-data:vendors',
  '/base/customers': 'master-data:customers',
  '/base/organizations': 'master-data:companies',
  '/base/departments': 'master-data:departments',
  '/base/positions': 'master-data:positions',
  '/base/employees': 'master-data:employees',
  '/base/warehouses': 'master-data:warehouses',
  '/base/units': 'master-data:units',
};

export function pagePermission(path: string) {
  const normalized = path.split('?')[0]?.replace(/\/$/, '') ?? '';
  if (PAGE_ALIASES[normalized]) return PAGE_ALIASES[normalized];
  const segments = normalized.split('/').filter(Boolean);
  return segments.length >= 2 ? `${segments[0]}:${segments[1]}` : '';
}

export function hasPermission(user: PermissionUser, permission: string) {
  if (!permission) return false;
  return user?.permissions?.some((item) => item === '*' || item === permission) === true;
}

export function canPageAction(user: PermissionUser, path: string, action?: string) {
  const page = pagePermission(path);
  if (!action) return hasPermission(user, page);
  const base = page.endsWith(':view') ? page.replace(/:\d+:view$/, '') : page;
  const resource = path.split('/').filter(Boolean)[1];
  const actionPermission = path.startsWith('/system/')
    ? `system:${resource}:${action}`
    : `${base}:${action}`;
  return hasPermission(user, actionPermission);
}
