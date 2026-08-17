import { AsyncLocalStorage } from 'node:async_hooks';
import { AuthUser } from '../auth/auth.types';

export interface ActiveDataScope {
  userId: string;
  scopeType: number;
  organizationIds: string[];
  isSuperAdmin: boolean;
}

const storage = new AsyncLocalStorage<ActiveDataScope>();

export function runWithDataScope<T>(user: AuthUser, work: () => T): T {
  return storage.run(
    {
      userId: user.id,
      scopeType: user.dataScopeType ?? 3,
      organizationIds: user.organizationIds ?? (user.orgId ? [user.orgId] : []),
      isSuperAdmin: user.isSuperAdmin ?? user.permissions.includes('*'),
    },
    work,
  );
}

export function activeDataScope() {
  return storage.getStore();
}
