<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  ArrowDown,
  Bell,
  DataAnalysis,
  DataBoard,
  Expand,
  Fold,
  Goods,
  OfficeBuilding,
  RefreshRight,
  Search,
  Setting,
  ShoppingCart,
  SwitchButton,
  TakeawayBox,
  Tickets,
} from '@element-plus/icons-vue';
import { useAuthStore } from '@/stores/auth';
import { api } from '@/api';
import huasuLogo from '@/assets/huasu-logo.png';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const collapsed = ref(false);
const mobileOpen = ref(false);
const openGroups = ref<number[]>([]);
const openSubmenus = ref<number[]>([]);
const unreadCount = ref(0);
const active = computed(() => route.path);
const iconMap: Record<string, any> = {
  OfficeBuilding,
  Goods,
  ShoppingCart,
  TakeawayBox,
  DataBoard,
  DataAnalysis,
  Setting,
  Tickets,
};
const runtimeMenus = computed(() => {
  const menus = auth.menus.map((menu) => ({ ...menu }));
  const organizationDirectory = menus.find((menu) => menu.code === 'master-data:organizations');
  if (organizationDirectory && !menus.some((menu) => menu.parent_id === organizationDirectory.id)) {
    organizationDirectory.name = '组织';
    organizationDirectory.route = null;
    organizationDirectory.type = 1;
    menus.push(
      {
        id: -9101,
        parent_id: organizationDirectory.id,
        name: '公司',
        code: 'master-data:companies',
        route: '/base/organizations',
        icon: null,
        sort: 1,
        type: 2,
      },
      {
        id: -9102,
        parent_id: organizationDirectory.id,
        name: '部门',
        code: 'master-data:departments',
        route: '/base/departments',
        icon: null,
        sort: 2,
        type: 2,
      },
      {
        id: -9103,
        parent_id: organizationDirectory.id,
        name: '职位',
        code: 'master-data:positions',
        route: '/base/positions',
        icon: null,
        sort: 3,
        type: 2,
      },
      {
        id: -9104,
        parent_id: organizationDirectory.id,
        name: '员工',
        code: 'master-data:employees',
        route: '/base/employees',
        icon: null,
        sort: 4,
        type: 2,
      },
    );
  }
  return menus;
});
const groups = computed(() =>
  runtimeMenus.value
    .filter((menu) => menu.parent_id === 0 && menu.type !== 3)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    .map((parent) => ({
      ...parent,
      children: runtimeMenus.value
        .filter((menu) => menu.parent_id === parent.id && menu.type !== 3)
        .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
        .map((item) => ({
          ...item,
          children: runtimeMenus.value
            .filter((menu) => menu.parent_id === item.id && menu.type !== 3 && !!menu.route)
            .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)),
        }))
        .filter((item) => !!item.route || item.children.length > 0),
    })),
);
function syncOpenGroup() {
  const current = groups.value.find((group) =>
    group.children.some(
      (item) =>
        item.route === route.path || item.children.some((child) => child.route === route.path),
    ),
  );
  if (current && !openGroups.value.includes(current.id))
    openGroups.value = [...openGroups.value, current.id];
  const submenu = current?.children.find((item) =>
    item.children.some((child) => child.route === route.path),
  );
  if (submenu && !openSubmenus.value.includes(submenu.id))
    openSubmenus.value = [...openSubmenus.value, submenu.id];
}
function syncDocumentTitle() {
  const current = auth.menus.find((menu) => menu.route === route.path);
  if (current?.name) document.title = `${current.name} · 华溯管家`;
}
function groupOpen(group: { id: number }) {
  return openGroups.value.includes(group.id);
}
function toggleGroup(id: number) {
  openGroups.value = groupOpen({ id })
    ? openGroups.value.filter((value) => value !== id)
    : [...openGroups.value, id];
}
function toggleSubmenu(id: number) {
  openSubmenus.value = openSubmenus.value.includes(id)
    ? openSubmenus.value.filter((value) => value !== id)
    : [...openSubmenus.value, id];
}
function openCollapsedGroup(id: number) {
  collapsed.value = false;
  if (!openGroups.value.includes(id)) openGroups.value = [...openGroups.value, id];
}
async function loadUnread() {
  if (!auth.menus.some((menu) => menu.code === 'dashboard:3:view')) return;
  try {
    const data = (await api.get('/dashboard/messages', {
      params: { page: 1, pageSize: 1 },
    })) as any;
    unreadCount.value = data.unreadCount ?? 0;
  } catch {}
}
onMounted(async () => {
  await auth.load();
  syncOpenGroup();
  syncDocumentTitle();
  await loadUnread();
});
watch(
  () => route.path,
  () => {
    syncOpenGroup();
    syncDocumentTitle();
    loadUnread();
  },
);
async function logout() {
  await auth.logout();
  router.push('/login');
}
async function switchOrganization(orgId: string) {
  await auth.switchOrganization(orgId);
  router.go(0);
}
function navigate(path?: string | null) {
  if (path) {
    router.push(path);
    mobileOpen.value = false;
  }
}
</script>

<template>
  <div class="app-shell">
    <div v-if="mobileOpen" class="nav-mask" @click="mobileOpen = false" />
    <aside class="sidebar" :class="{ collapsed, open: mobileOpen }">
      <div class="brand">
        <span class="brand-mark"><img :src="huasuLogo" alt="华溯管家 Logo" /></span>
        <div v-show="!collapsed" class="brand-copy">
          <strong>华溯管家</strong><small>INVENTORY ERP</small>
        </div>
      </div>
      <!-- 当前账套信息暂不展示
      <div v-show="!collapsed" class="account-set"><span>当前账套</span><strong>华溯智能制造 · 2026</strong><b>⌄</b></div>
      -->
      <el-scrollbar class="nav-scroll"
        ><nav aria-label="主菜单">
          <section
            v-for="group in groups"
            :key="group.id"
            class="nav-group"
            :class="{ expanded: groupOpen(group) }"
          >
            <button
              v-show="!collapsed"
              class="nav-title"
              :aria-expanded="groupOpen(group)"
              @click="toggleGroup(group.id)"
            >
              <el-icon><component :is="iconMap[group.icon || ''] || OfficeBuilding" /></el-icon
              ><span>{{ group.name }}</span
              ><el-icon class="nav-arrow"><ArrowDown /></el-icon>
            </button>
            <div v-show="!collapsed && groupOpen(group)" class="nav-children">
              <div v-for="item in group.children" :key="item.id" class="nav-child">
                <button
                  v-if="item.children.length"
                  class="nav-item nav-submenu"
                  :class="{
                    active: item.children.some((child) => active === child.route),
                    expanded: openSubmenus.includes(item.id),
                  }"
                  :title="item.name"
                  @click="toggleSubmenu(item.id)"
                >
                  <i />{{ item.name }}<el-icon class="nav-submenu-arrow"><ArrowDown /></el-icon>
                </button>
                <button
                  v-else
                  class="nav-item"
                  :class="{ active: active === item.route }"
                  :title="item.name"
                  @click="navigate(item.route)"
                >
                  <i />{{ item.name }}
                </button>
                <div
                  v-if="item.children.length && openSubmenus.includes(item.id)"
                  class="nav-third-level"
                >
                  <button
                    v-for="child in item.children"
                    :key="child.id"
                    class="nav-item nav-item-third"
                    :class="{ active: active === child.route }"
                    :title="child.name"
                    @click="navigate(child.route)"
                  >
                    <i />{{ child.name }}
                  </button>
                </div>
              </div>
            </div>
            <button
              v-show="collapsed"
              class="nav-icon"
              :title="group.name"
              @click="openCollapsedGroup(group.id)"
            >
              <el-icon><component :is="iconMap[group.icon || ''] || OfficeBuilding" /></el-icon>
            </button>
          </section>
          <div v-if="!groups.length && !collapsed" class="nav-empty">当前账号暂无菜单权限</div>
        </nav></el-scrollbar
      >
      <button class="sidebar-toggle" @click="collapsed = !collapsed">
        <el-icon><component :is="collapsed ? Expand : Fold" /></el-icon
        ><span v-show="!collapsed">收起菜单</span>
      </button>
    </aside>

    <div class="app-main">
      <header class="topbar">
        <button class="mobile-menu mobile-only" @click="mobileOpen = true">
          <el-icon><Expand /></el-icon>
        </button>
        <div class="global-search desktop-only">
          <el-icon><Search /></el-icon><input readonly placeholder="搜索单据、商品、客户…" /><kbd
            >⌘ K</kbd
          >
        </div>
        <div class="top-actions">
          <div class="organization-switcher desktop-only">
            <span>当前组织</span>
            <el-select
              :model-value="auth.user?.currentOrgId"
              :loading="auth.switchingOrganization"
              :disabled="(auth.user?.authorizedOrganizations?.length ?? 0) <= 1"
              size="small"
              @change="switchOrganization"
            >
              <el-option
                v-for="organization in auth.user?.authorizedOrganizations ?? []"
                :key="organization.id"
                :label="organization.name"
                :value="organization.id"
              />
            </el-select>
          </div>
          <button title="刷新数据" @click="router.go(0)">
            <el-icon><RefreshRight /></el-icon>
          </button>
          <button class="message-button" title="消息中心" @click="navigate('/dashboard/messages')">
            <el-icon><Bell /></el-icon
            ><i v-if="unreadCount">{{ unreadCount > 99 ? '99+' : unreadCount }}</i>
          </button>
          <span class="top-divider" />
          <span class="avatar">{{ (auth.user?.username || 'U').slice(0, 1).toUpperCase() }}</span>
          <div class="user-copy desktop-only">
            <strong>{{ auth.user?.username || '加载中' }}</strong
            ><small>系统管理员</small>
          </div>
          <button title="退出登录" @click="logout">
            <el-icon><SwitchButton /></el-icon>
          </button>
        </div>
      </header>
      <main class="content"><router-view :key="route.fullPath" /></main>
    </div>
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
}
.sidebar {
  position: fixed;
  z-index: 30;
  inset: 0 auto 0 0;
  width: 244px;
  display: flex;
  flex-direction: column;
  background: #101826;
  color: #dce5f3;
  transition: width 0.2s ease;
}
.sidebar.collapsed {
  width: 72px;
}
.brand {
  height: 66px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 18px;
}
.brand-mark {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  padding: 4px;
  border-radius: 6px;
  background: #fff;
  box-shadow: 0 7px 18px #00000038;
}
.brand-mark img {
  display: block;
  width: 28px;
  height: 28px;
  object-fit: contain;
}
.brand-copy {
  display: flex;
  flex-direction: column;
}
.brand-copy strong {
  color: #fff;
  font-size: 18px;
  line-height: 23px;
  letter-spacing: 0.5px;
}
.brand-copy small {
  color: #8492a8;
  font-size: 8px;
  letter-spacing: 2px;
}
.account-set {
  position: relative;
  height: 58px;
  flex: none;
  margin: 10px;
  padding: 12px 34px 10px 16px;
  border: 1px solid #2b3442;
  background: #151f2d;
}
.account-set span {
  display: block;
  color: #748196;
  font-size: 10px;
}
.account-set strong {
  display: block;
  margin-top: 5px;
  overflow: hidden;
  color: #e7ecf5;
  font-size: 11px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.account-set b {
  position: absolute;
  right: 16px;
  top: 22px;
  color: #8c98aa;
  font-size: 11px;
}
.nav-scroll {
  flex: 1;
}
.nav-group {
  margin: 3px 9px;
}
.nav-title {
  width: 100%;
  height: 38px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 11px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #a9b5c8;
  font-size: 13px;
  font-weight: 650;
  cursor: pointer;
}
.nav-arrow {
  margin-left: auto;
  color: #768398;
  font-size: 12px;
  transition: transform 0.18s ease;
}
.nav-group.expanded .nav-arrow {
  transform: rotate(180deg);
}
.nav-group.expanded .nav-title {
  background: #1a2433;
  color: #fff;
}
.nav-children {
  position: relative;
  margin: 0 0 7px 18px;
  padding: 2px 0 3px 12px;
  border-left: 1px solid #273348;
}
.nav-item {
  position: relative;
  width: 100%;
  height: 34px;
  margin: 1px 0;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: #98a6ba;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.nav-item i {
  position: absolute;
  left: 2px;
  top: 15px;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: #56647a;
}
.nav-item:hover {
  color: #fff;
}
.nav-item.active {
  border-color: #6f89e8;
  background: #3151bd;
  box-shadow: 0 0 0 2px #3157d540;
  color: #fff;
}
.nav-item.active i {
  background: #fff;
}
.nav-icon {
  width: 42px;
  height: 38px;
  display: grid;
  place-items: center;
  margin: auto;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: #a9b5c8;
  cursor: pointer;
}
.nav-empty {
  padding: 28px 18px;
  color: #8190a6;
  font-size: 12px;
}
.sidebar-toggle {
  height: 44px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  border: 0;
  border-top: 1px solid #27303e;
  background: #101826;
  color: #7e8ba0;
  font-size: 11px;
  cursor: pointer;
}
.app-main {
  min-height: 100vh;
  margin-left: 244px;
  transition: margin-left 0.2s ease;
}
.sidebar.collapsed + .app-main {
  margin-left: 72px;
}
.topbar {
  position: sticky;
  z-index: 20;
  top: 0;
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 28px;
  border-bottom: 1px solid #e5e9f0;
  background: #fffffff5;
}
.global-search {
  width: 420px;
  height: 36px;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 10px;
  border: 1px solid #dce1e8;
  background: #fafbfc;
  color: #8994a5;
}
.global-search input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  background: transparent;
  color: #4b5565;
  font-size: 12px;
}
.global-search kbd {
  padding: 2px 7px;
  border: 1px solid #dfe3e9;
  background: #fff;
  color: #9099a8;
  font-family: inherit;
  font-size: 9px;
}
.top-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.organization-switcher {
  width: 210px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding-right: 6px;
}
.organization-switcher > span {
  flex: none;
  color: #8a94a4;
  font-size: 10px;
}
.organization-switcher :deep(.el-select) {
  min-width: 0;
  flex: 1;
}
.top-actions button,
.mobile-menu {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border: 0;
  background: transparent;
  color: #637083;
  cursor: pointer;
}
.top-actions button:hover {
  background: #f2f4f8;
}
.top-divider {
  width: 1px;
  height: 28px;
  margin: 0 4px;
  background: #e5e9f0;
}
.avatar {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #4162d5;
  color: #fff;
  font-size: 13px;
  font-weight: 700;
}
.user-copy {
  min-width: 62px;
  display: flex;
  flex-direction: column;
}
.user-copy strong {
  color: #293244;
  font-size: 11px;
}
.user-copy small {
  margin-top: 2px;
  color: #8a94a4;
  font-size: 9px;
}
.content {
  min-height: calc(100vh - 60px);
}
.mobile-only {
  display: none;
}
.nav-mask {
  display: none;
}
.sidebar {
  background:
    radial-gradient(
      120% 46% at 0 0,
      rgba(84, 109, 174, 0.11) 0%,
      rgba(84, 109, 174, 0.035) 42%,
      transparent 68%
    ),
    #0c1b35;
  border-right: 1px solid rgba(124, 146, 198, 0.12);
  box-shadow:
    4px 0 20px rgba(7, 18, 39, 0.09),
    inset -1px 0 rgba(255, 255, 255, 0.025);
}
.brand {
  border-bottom: 1px solid rgba(132, 153, 202, 0.09);
}
.brand-copy small {
  color: #8fa0bd;
}
.nav-title {
  color: #afbdd3;
}
.nav-arrow {
  color: #7e90ad;
}
.nav-group.expanded .nav-title {
  background: rgba(124, 148, 204, 0.075);
  color: #f5f7fb;
}
.nav-children {
  border-left-color: rgba(126, 149, 202, 0.18);
}
.nav-item {
  color: #9fadc4;
}
.nav-item i {
  background: #5f718f;
}
.nav-item:hover {
  background: rgba(126, 149, 202, 0.07);
  color: #f7f9fc;
}
.nav-item.active {
  border-color: rgba(126, 153, 236, 0.42);
  background: rgba(49, 87, 213, 0.82);
  box-shadow:
    inset 0 1px rgba(255, 255, 255, 0.08),
    0 4px 12px rgba(4, 13, 34, 0.16);
  color: #fff;
}
.nav-icon {
  color: #afbdd3;
}
.nav-empty {
  color: #8798b4;
}
.sidebar-toggle {
  border-top-color: rgba(125, 146, 194, 0.13);
  background: rgba(5, 15, 32, 0.18);
  color: #8798b5;
}
.nav-child {
  min-width: 0;
}
.nav-submenu {
  display: flex;
  align-items: center;
}
.nav-submenu-arrow {
  margin-left: auto;
  font-size: 10px;
  transition: transform 0.18s;
}
.nav-submenu.expanded .nav-submenu-arrow {
  transform: rotate(180deg);
}
.nav-third-level {
  margin: 1px 0 4px 9px;
  padding-left: 8px;
  border-left: 1px solid rgba(126, 149, 202, 0.14);
}
.nav-item-third {
  height: 31px;
  padding-left: 14px;
  color: #8f9db3;
  font-size: 11px;
}
.nav-item-third i {
  left: 4px;
}
.nav-submenu.active:not(.expanded) {
  background: rgba(126, 149, 202, 0.07);
  border-color: transparent;
}
@media (max-width: 780px) {
  .desktop-only {
    display: none;
  }
  .mobile-only {
    display: grid;
  }
  .topbar {
    padding: 0 14px;
  }
  .sidebar,
  .sidebar.collapsed {
    width: 244px;
    transform: translateX(-100%);
  }
  .sidebar.open {
    transform: translateX(0);
  }
  .app-main,
  .sidebar.collapsed + .app-main {
    margin-left: 0;
  }
  .nav-mask {
    position: fixed;
    z-index: 29;
    inset: 0;
    display: block;
    background: #08131c88;
  }
}
.top-actions button,
.mobile-menu {
  position: relative;
}
.message-button i {
  position: absolute;
  top: -3px;
  right: -5px;
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  display: grid;
  place-items: center;
  border: 2px solid #fff;
  border-radius: 9px;
  background: #d14343;
  color: #fff;
  font-size: 8px;
  font-style: normal;
}
</style>
