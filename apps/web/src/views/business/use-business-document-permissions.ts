import { computed, type ComputedRef } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { canPageAction, hasPermission } from '@/utils/permission';
import type { BusinessDocumentConfig, RowAction } from './business-document-config';

function inferredActionPermission(action: RowAction) {
  if (action.key === 'view') return undefined;
  if (action.key === 'edit') return 'update';
  if (['delete', 'remove'].includes(action.key)) return 'delete';
  if (action.key === 'reject') return 'approve';
  return action.key;
}

/** 共享单据页面统一权限入口，避免薄页面和通用引擎各自推导权限。 */
export function useBusinessDocumentPermissions(
  getConfig: () => BusinessDocumentConfig,
): {
  canCreate: ComputedRef<boolean>;
  canViewPage: () => boolean;
  canRunAction: (action: RowAction) => boolean;
  hasConfiguredPermission: (permission?: string, fallbackAction?: string) => boolean;
} {
  const route = useRoute();
  const auth = useAuthStore();

  const hasConfiguredPermission = (permission?: string, fallbackAction?: string) => {
    if (permission?.includes(':')) return hasPermission(auth.user, permission);
    return canPageAction(auth.user, route.path, permission || fallbackAction);
  };
  const canViewPage = () => {
    const config = getConfig();
    return config.pagePermission
      ? hasConfiguredPermission(config.pagePermission)
      : canPageAction(auth.user, route.path);
  };
  const canCreate = computed(() => {
    const config = getConfig();
    return config.creatable !== false && hasConfiguredPermission(config.createPermission, 'create');
  });
  const canRunAction = (action: RowAction) => {
    const permission = action.permission ?? inferredActionPermission(action);
    return permission ? hasConfiguredPermission(permission) : canViewPage();
  };

  return { canCreate, canViewPage, canRunAction, hasConfiguredPermission };
}
