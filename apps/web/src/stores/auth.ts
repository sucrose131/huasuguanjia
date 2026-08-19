import { defineStore } from 'pinia';
import { api } from '@/api';
export interface User {
  id: string;
  username: string;
  orgId: string | null;
  orgName: string | null;
  deptId: string | null;
  staffId: string | null;
  currentOrgId: string;
  currentOrgName: string;
  roleName: string | null;
  authorizedOrganizations: Array<{ id: string; name: string }>;
  permissions: string[];
}
export interface Menu {
  id: number;
  parent_id: number;
  name: string;
  code: string;
  route?: string | null;
  icon?: string | null;
  sort?: number | null;
  type?: number | null;
}
export interface AmountAccessState {
  level: 'none' | 'view' | 'edit';
  canViewAmount: boolean;
  canEditAmount: boolean;
}
const defaultAmountAccess = (): AmountAccessState => ({
  level: 'none',
  canViewAmount: false,
  canEditAmount: false,
});
const storedMenus = () => {
  try {
    return JSON.parse(localStorage.getItem('hspsi_menus') ?? '[]') as Menu[];
  } catch {
    return [];
  }
};
export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null as User | null,
    token: localStorage.getItem('hspsi_token') ?? '',
    menus: storedMenus(),
    amountAccess: defaultAmountAccess(),
  }),
  actions: {
    async login(username: string, password: string, remember: boolean) {
      const result = (await api.post('/auth/login', { username, password })) as {
        token: string;
        user: User;
        menus: Menu[];
      };
      this.token = result.token;
      this.user = result.user;
      this.menus = result.menus;
      localStorage.setItem('hspsi_token', result.token);
      localStorage.setItem('hspsi_menus', JSON.stringify(result.menus));
      localStorage.setItem('hspsi_remember', remember ? '1' : '0');
      await this.loadAmountAccess();
    },
    async loadAmountAccess() {
      if (!this.token) {
        this.amountAccess = defaultAmountAccess();
        return;
      }
      this.amountAccess = (await api.get('/auth/amount-access')) as AmountAccessState;
      localStorage.setItem('hspsi_amount_access', this.amountAccess.level);
    },
    async load() {
      if (!this.token) return;
      const [result] = (await Promise.all([
        api.get('/auth/session'),
        this.loadAmountAccess(),
      ])) as unknown as [{ user: User; menus: Menu[] }, void];
      this.user = result.user;
      this.menus = result.menus;
      localStorage.setItem('hspsi_menus', JSON.stringify(result.menus));
    },
    async logout() {
      try {
        await api.post('/auth/logout');
      } finally {
        this.token = '';
        this.user = null;
        this.menus = [];
        this.amountAccess = defaultAmountAccess();
        localStorage.removeItem('hspsi_token');
        localStorage.removeItem('hspsi_menus');
        localStorage.removeItem('hspsi_amount_access');
      }
    },
  },
});
