import { AsyncLocalStorage } from 'node:async_hooks';
import { AuthUser } from '../auth/auth.types';

export interface ActiveDataScope {
  userId: string;
  currentOrgId: string;
  isSuperAdmin: boolean;
}

const storage = new AsyncLocalStorage<ActiveDataScope | undefined>();

export function runWithDataScope<T>(user: AuthUser, work: () => T): T {
  return storage.run(
    {
      userId: user.id,
      currentOrgId: user.currentOrgId ?? user.orgId ?? '',
      isSuperAdmin: user.isSuperAdmin ?? user.permissions.includes('*'),
    },
    work,
  );
}

export function activeDataScope() {
  return storage.getStore();
}

/** 仅用于登录会话自身的授权组织校验，避免被已选当前组织反向截断。 */
export function runWithoutDataScope<T>(work: () => T): T {
  return storage.run(undefined, work);
}
