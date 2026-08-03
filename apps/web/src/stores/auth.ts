import { defineStore } from 'pinia';
import { api } from '@/api';
export interface User {
  id: string;
  username: string;
  orgId: string | null;
  deptId: string | null;
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
    },
    async load() {
      if (!this.token) return;
      const result = (await api.get('/auth/session')) as { user: User; menus: Menu[] };
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
        localStorage.removeItem('hspsi_token');
        localStorage.removeItem('hspsi_menus');
      }
    },
  },
});
