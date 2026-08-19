<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, Refresh, Search, ArrowDown, ArrowRight } from '@element-plus/icons-vue';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import SummaryStrip from '@/components/SummaryStrip.vue';
import TableRowActions from '@/components/business/TableRowActions.vue';
import { buildOrganizationTree, type OrganizationTreeNode } from '@/utils/organization-tree';
import ScheduledTaskPanel from '@/views/ScheduledTaskPanel.vue';

type Resource = 'roles' | 'users' | 'config' | 'tasks';
type Mode = 'create' | 'edit' | 'view';
type RolePermissionRow = {
  id: string;
  moduleName: string;
  menuName: string;
  menuCode: string;
  actions: any[];
};

const route = useRoute();
const auth = useAuthStore();
const resource = computed<Resource>(() => String(route.params.resource) as Resource);
const title = computed(() =>
  resource.value === 'roles'
    ? '角色管理'
    : resource.value === 'users'
      ? '用户管理'
      : resource.value === 'tasks'
        ? '任务管理'
        : '系统配置',
);
const can = (permission: string) =>
  !!auth.user?.permissions?.some((item) => item === '*' || item === permission);
const resourceAction = (action: string) => can(`system:${resource.value}:${action}`);
const isSuperAdmin = computed(() => auth.user?.permissions?.includes('*') === true);

const rows = ref<any[]>([]);
const menus = ref<any[]>([]);
const roleOptions = ref<any[]>([]);
const orgOptions = ref<any[]>([]);
const organizationTree = computed(() =>
  buildOrganizationTree(
    orgOptions.value.map((item) => ({
      ...item,
      value: item.id,
      label: item.name,
    })) as OrganizationTreeNode[],
  ),
);
const deptOptions = ref<any[]>([]);
const staffOptions = ref<any[]>([]);
const dicts = reactive<Record<string, any[]>>({});
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const keyword = ref('');
const statusFilter = ref<string | number>('');
const dialog = ref(false);
const amountDialog = ref(false);
const roleDialog = ref(false);
const mode = ref<Mode>('create');
const current = ref<any>(null);
const form = reactive<any>({});
const amountSaving = ref(false);
const roleSaving = ref(false);
const amountCurrent = ref<any>(null);
const roleCurrent = ref<any>(null);
const amountForm = reactive({ level: 'none', grantReason: '' });
const roleForm = reactive<{ roleId: string; additionalOrgIds: string[] }>({
  roleId: '',
  additionalOrgIds: [],
});
const roleOrganizationTree = computed(() =>
  buildOrganizationTree(
    orgOptions.value.map((item) => ({
      ...item,
      value: item.id,
      label: item.name,
      disabled:
        String(item.id) === String(roleCurrent.value?.fixedOrgId ?? roleCurrent.value?.orgId),
    })) as OrganizationTreeNode[],
  ),
);

const filteredRows = computed(() =>
  rows.value.filter((row) => {
    const status = row.statusValue;
    if (statusFilter.value !== '' && String(status) !== String(statusFilter.value)) return false;
    const word = keyword.value.trim();
    if (!word) return true;
    const values =
      resource.value === 'roles'
        ? [row.name, ...(row.menuPermissions ?? []), ...(row.actionPermissions ?? [])]
        : resource.value === 'users'
          ? [
              row.account,
              row.name,
              row.department,
              row.phone,
              amountAccessLabel(row.amountAccess),
              row.roleName,
            ]
          : [row.name, row.path, row.permission, row.type];
    return values.join(' ').includes(word);
  }),
);

// 系统菜单：扁平列表 → 树形（parentId==='0' 为根，children 挂子级）
const menuTree = computed<any[]>(() => {
  if (resource.value !== 'config') return [];
  const byParent = new Map<string, any[]>();
  for (const row of filteredRows.value) {
    const pid = String(row.parentId ?? '0');
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid)!.push(row);
  }
  const build = (pid: string): any[] =>
    (byParent.get(pid) ?? [])
      .sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0))
      .map((row) => {
        const children = build(String(row.id));
        return children.length ? { ...row, children } : { ...row };
      });
  return build('0');
});

// 树形展开状态（可点击切换），默认仅展开一级
const menuExpandedKeys = ref<string[]>([]);
watch(
  () => resource.value,
  (val) => {
    if (val === 'config') menuExpandedKeys.value = menuTree.value.map((row) => String(row.id));
    else menuExpandedKeys.value = [];
  },
  { immediate: true },
);
watch(
  () => menuTree.value,
  (tree) => {
    if (resource.value === 'config' && !menuExpandedKeys.value.length)
      menuExpandedKeys.value = tree.map((row) => String(row.id));
  },
);

function toggleMenuExpand(row: any) {
  if (!(row.children?.length)) return;
  const key = String(row.id);
  const index = menuExpandedKeys.value.indexOf(key);
  if (index >= 0) menuExpandedKeys.value.splice(index, 1);
  else menuExpandedKeys.value.push(key);
}

// 树形节点计数（含子级，供底部统计/空态判断）
const menuRowCount = computed(() => {
  let count = 0;
  const walk = (nodes: any[]) => {
    for (const node of nodes) {
      count += 1;
      if (node.children?.length) walk(node.children);
    }
  };
  walk(menuTree.value);
  return count;
});

const summaryItems = computed(() => {
  if (resource.value === 'roles')
    return [
      { label: '角色总数', value: rows.value.length },
      {
        label: '启用角色',
        value: rows.value.filter((row) => Number(row.statusValue) === 1).length,
      },
      {
        label: '角色绑定',
        value: rows.value.reduce((sum, row) => sum + Number(row.userCount ?? 0), 0),
      },
    ];
  if (resource.value === 'users')
    return [
      { label: '用户总数', value: rows.value.length },
      {
        label: '启用账号',
        value: rows.value.filter((row) => Number(row.statusValue) === 1).length,
      },
      { label: '已分配角色', value: rows.value.filter((row) => row.roleId).length },
    ];
  return [
    { label: '菜单总数', value: rows.value.length },
    { label: '一级模块', value: rows.value.filter((row) => String(row.parentId) === '0').length },
    { label: '隐藏菜单', value: rows.value.filter((row) => !row.visible).length },
  ];
});

const pageMenus = computed(() =>
  menus.value.filter((menu) => menu.typeValue === 2 && menu.statusValue === 1),
);
const actionMenus = computed(() =>
  menus.value.filter((menu) => menu.typeValue === 3 && menu.statusValue === 1),
);
const directoryMenus = computed(() =>
  menus.value.filter((menu) => menu.typeValue === 1 && menu.statusValue === 1),
);
const rolePermissionRows = computed<RolePermissionRow[]>(() =>
  pageMenus.value.map((menu) => ({
    id: String(menu.id),
    moduleName: menu.parentName || '未分组',
    menuName: menu.name,
    menuCode: menu.permission,
    actions: actionMenus.value.filter((action) => String(action.parentId) === String(menu.id)),
  })),
);
const visibleActionCodes = computed(
  () =>
    new Set(
      rolePermissionRows.value.flatMap((row) => row.actions.map((action) => action.permission)),
    ),
);
const filteredDepartments = computed(() =>
  deptOptions.value.filter((item) => !form.orgId || String(item.orgId) === String(form.orgId)),
);
const selectedStaff = computed(() =>
  staffOptions.value.find((item) => String(item.id) === String(form.staffId)),
);
const allRolePermissionsSelected = computed({
  get: () =>
    rolePermissionRows.value.length > 0 &&
    rolePermissionRows.value.every(
      (row) =>
        form.menuIds?.includes(row.id) &&
        row.actions.every((action) => form.actionPermissionCodes?.includes(action.permission)),
    ),
  set: (selected: boolean) => {
    const hiddenActionCodes = (form.actionPermissionCodes ?? []).filter(
      (code: string) => !visibleActionCodes.value.has(code),
    );
    form.menuIds = selected ? rolePermissionRows.value.map((row) => row.id) : [];
    form.actionPermissionCodes = selected
      ? [
          ...hiddenActionCodes,
          ...rolePermissionRows.value.flatMap((row) =>
            row.actions.map((action) => action.permission),
          ),
        ]
      : hiddenActionCodes;
  },
});

function actionByKey(row: RolePermissionRow, key: 'create' | 'update' | 'delete') {
  return row.actions.find((action) => action.permission.endsWith(`:${key}`));
}

function otherActions(row: RolePermissionRow) {
  return row.actions.filter(
    (action) =>
      !['create', 'update', 'delete'].some((key) => action.permission.endsWith(`:${key}`)),
  );
}

function menuViewSelected(row: RolePermissionRow) {
  return form.menuIds?.includes(row.id) === true;
}

function setMenuView(row: RolePermissionRow, selected: boolean) {
  const menuIds = new Set<string>((form.menuIds ?? []).map(String));
  if (selected) menuIds.add(row.id);
  else {
    menuIds.delete(row.id);
    const rowActionCodes = new Set(row.actions.map((action) => action.permission));
    form.actionPermissionCodes = (form.actionPermissionCodes ?? []).filter(
      (code: string) => !rowActionCodes.has(code),
    );
  }
  form.menuIds = [...menuIds];
}

function actionSelected(action: any) {
  return form.actionPermissionCodes?.includes(action.permission) === true;
}

function setAction(row: RolePermissionRow, action: any, selected: boolean) {
  const codes = new Set<string>(form.actionPermissionCodes ?? []);
  if (selected) {
    codes.add(action.permission);
    setMenuView(row, true);
  } else codes.delete(action.permission);
  form.actionPermissionCodes = [...codes];
}

function dictionary(code: string) {
  return dicts[code] ?? [];
}
function dictionaryLabel(code: string, value: any) {
  return dictionary(code).find((item) => String(item.value) === String(value))?.label ?? '—';
}
function timeText(value: any) {
  return value ? String(value).replace('T', ' ').slice(0, 16) : '—';
}

function amountAccessLabel(level: string) {
  return level === 'edit' ? '可编辑' : level === 'view' ? '仅查看' : '无权限';
}

function amountAccessTag(level: string) {
  return level === 'edit' ? 'success' : level === 'view' ? 'primary' : 'info';
}

async function loadDictionaries() {
  const codes = ['enabled_status', 'system_account_status', 'system_menu_type'];
  const values = (await Promise.all(
    codes.map((code) => api.get(`/dictionaries/${code}`)),
  )) as any[];
  codes.forEach((code, index) => {
    dicts[code] = values[index] ?? [];
  });
}

async function loadSupport() {
  if (resource.value === 'roles' || resource.value === 'config') {
    menus.value = (await api.get('/system/menus')) as any[];
  }
  if (resource.value === 'users') {
    const options = (await api.get('/system/user-options')) as any;
    roleOptions.value = options.roles ?? [];
    orgOptions.value = options.organizations ?? [];
    deptOptions.value = options.departments ?? [];
    staffOptions.value = options.staff ?? [];
  }
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const endpoint =
      resource.value === 'roles'
        ? '/system/roles'
        : resource.value === 'users'
          ? '/system/users'
          : '/system/menus';
    rows.value = (await api.get(endpoint)) as any[];
    if (resource.value === 'config') menus.value = rows.value;
    await loadSupport();
  } catch (caught: any) {
    error.value = caught?.response?.data?.message ?? `无法读取${title.value}`;
  } finally {
    loading.value = false;
  }
}

function resetForm() {
  Object.keys(form).forEach((key) => delete form[key]);
  if (resource.value === 'roles')
    Object.assign(form, {
      name: '',
      status: 1,
      menuIds: [],
      actionPermissionCodes: [],
    });
  else if (resource.value === 'users')
    Object.assign(form, {
      account: '',
      password: '',
      name: '',
      phone: '',
      orgId: '',
      deptId: '',
      staffId: '',
      authorizedOrgIds: [],
      roleId: '',
      status: 1,
    });
  else
    Object.assign(form, {
      parentId: '0',
      name: '',
      type: 2,
      route: '',
      permission: '',
      sortOrder: 0,
      status: 1,
      icon: '',
    });
}

function open(nextMode: Mode, row?: any) {
  mode.value = nextMode;
  current.value = row ?? null;
  resetForm();
  if (row) {
    if (resource.value === 'roles')
      Object.assign(form, {
        name: row.name,
        status: row.statusValue,
        menuIds: (row.menuIds ?? [])
          .map(String)
          .filter((id: string) => pageMenus.value.some((menu) => String(menu.id) === id)),
        actionPermissionCodes: row.actionPermissionCodes ?? [],
      });
    else if (resource.value === 'users')
      Object.assign(form, {
        account: row.account,
        password: '',
        name: row.name,
        phone: row.phone,
        orgId: row.orgId,
        deptId: row.deptId,
        staffId: row.staffId,
        authorizedOrgIds: (row.authorizedOrgIds ?? []).map(String),
        roleId: String(row.roleId ?? ''),
        status: row.statusValue,
      });
    else
      Object.assign(form, {
        parentId: String(row.parentId),
        name: row.name,
        type: row.typeValue,
        route: row.route || row.path,
        permission: row.permission,
        sortOrder: row.sortOrder,
        status: row.statusValue,
        icon: row.icon,
      });
  }
  dialog.value = true;
}

function validate() {
  if (!String(form.name ?? '').trim()) return '请填写名称';
  if (resource.value === 'roles' && !form.menuIds?.length) return '请至少选择一项菜单权限';
  if (resource.value === 'users') {
    if (!form.account || String(form.account).length < 3) return '登录账号至少3个字符';
    if (mode.value === 'create' && String(form.password ?? '').length < 6)
      return '初始密码至少6个字符';
    if (!form.orgId) return '请选择所属公司';
    if (!form.roleId) return '请选择一个角色';
    if (!form.authorizedOrgIds?.length) return '请至少选择一个授权组织';
  }
  return '';
}

async function save() {
  const message = validate();
  if (message) {
    ElMessage.warning(message);
    return;
  }
  saving.value = true;
  try {
    const base =
      resource.value === 'roles'
        ? '/system/roles'
        : resource.value === 'users'
          ? '/system/users'
          : '/system/menus';
    if (mode.value === 'edit') await api.put(`${base}/${current.value.id}`, form);
    else await api.post(base, form);
    ElMessage.success(mode.value === 'edit' ? '修改已保存' : '新增成功');
    dialog.value = false;
    await load();
  } finally {
    saving.value = false;
  }
}

function openAmountAccess(row: any) {
  amountCurrent.value = row;
  amountForm.level = row.amountAccess ?? 'none';
  amountForm.grantReason = '';
  amountDialog.value = true;
}

async function saveAmountAccess() {
  if (!amountForm.grantReason.trim()) {
    ElMessage.warning('请填写授权或变更原因');
    return;
  }
  amountSaving.value = true;
  try {
    await api.put(`/system/users/${amountCurrent.value.id}/amount-access`, amountForm);
    ElMessage.success(amountForm.level === 'none' ? '金额权限已取消' : '金额权限已保存');
    amountDialog.value = false;
    await load();
  } finally {
    amountSaving.value = false;
  }
}

function openRoleAccess(row: any) {
  roleCurrent.value = row;
  roleForm.roleId = String(row.roleId ?? '');
  const fixedOrgId = String(row.fixedOrgId ?? row.orgId ?? '');
  const authorizedOrgIds: string[] = Array.isArray(row.authorizedOrgIds)
    ? row.authorizedOrgIds.map((orgId: unknown) => String(orgId))
    : [];
  roleForm.additionalOrgIds = [
    ...new Set(authorizedOrgIds.filter((orgId) => orgId !== fixedOrgId)),
  ];
  roleDialog.value = true;
}

async function saveRoleAccess() {
  if (!roleForm.roleId) {
    ElMessage.warning('请选择一个角色');
    return;
  }
  const fixedOrgId = String(roleCurrent.value?.fixedOrgId ?? roleCurrent.value?.orgId ?? '');
  if (!fixedOrgId) {
    ElMessage.warning('该用户尚未配置固定所属组织');
    return;
  }
  const authorizedOrgIds = [
    ...new Set([fixedOrgId, ...roleForm.additionalOrgIds.map(String)].filter(Boolean)),
  ];
  roleSaving.value = true;
  try {
    await api.put(`/system/users/${roleCurrent.value.id}/roles`, {
      roleId: roleForm.roleId,
      authorizedOrgIds,
    });
    ElMessage.success('角色和数据访问组织已保存');
    roleDialog.value = false;
    await load();
  } finally {
    roleSaving.value = false;
  }
}

async function removeMenu(row: any) {
  await ElMessageBox.confirm(`确认删除菜单“${row.name}”？`, '删除菜单', {
    type: 'warning',
    confirmButtonText: '确认删除',
  });
  await api.delete(`/system/menus/${row.id}`);
  ElMessage.success('菜单删除成功');
  await load();
}

watch(resource, () => {
  keyword.value = '';
  statusFilter.value = '';
  if (resource.value !== 'tasks') load();
});
watch(
  () => form.staffId,
  () => {
    if (!form.staffId || !selectedStaff.value) return;
    form.orgId = selectedStaff.value.orgId;
    form.deptId = selectedStaff.value.deptId || '';
    if (mode.value === 'create' || !String(form.name ?? '').trim())
      form.name = selectedStaff.value.name;
    if (!String(form.phone ?? '').trim()) form.phone = selectedStaff.value.mobile || '';
  },
);
watch(
  () => form.orgId,
  () => {
    if (
      form.deptId &&
      !filteredDepartments.value.some((item) => String(item.id) === String(form.deptId))
    )
      form.deptId = '';
    if (resource.value === 'users' && mode.value === 'create' && form.orgId) {
      const authorizedOrgIds = new Set<string>((form.authorizedOrgIds ?? []).map(String));
      authorizedOrgIds.add(String(form.orgId));
      form.authorizedOrgIds = [...authorizedOrgIds];
    }
  },
);
onMounted(async () => {
  if (resource.value === 'tasks') return;
  await loadDictionaries();
  await load();
});
</script>

<template>
  <section class="page system-page">
    <header class="page-head">
      <div>
        <h2>{{ title }}</h2>
        <p class="page-subtitle">
          {{
            resource === 'tasks'
              ? '配置同步任务开关和 Linux Cron 执行时间，保存后无需重启。'
              : '配置组织权限、用户和系统级业务规则。'
          }}
        </p>
      </div>
    </header>

    <ScheduledTaskPanel v-if="resource === 'tasks'" />
    <template v-else>
      <div class="panel">
        <SummaryStrip :items="summaryItems" />
        <div class="system-toolbar">
          <div class="status-filter">
            <span>启用状态</span>
            <el-select v-model="statusFilter" style="width: 130px">
              <el-option label="全部" value="" />
              <el-option
                v-for="item in dictionary(
                  resource === 'users' ? 'system_account_status' : 'enabled_status',
                )"
                :key="item.value"
                :label="item.label"
                :value="Number(item.value)"
              />
            </el-select>
          </div>
          <div class="toolbar-actions">
            <el-input v-model="keyword" clearable :placeholder="`搜索${title}`" style="width: 230px"
              ><template #prefix
                ><el-icon><Search /></el-icon></template
            ></el-input>
            <el-button
              v-if="resource !== 'config'"
              :icon="Refresh"
              aria-label="刷新列表"
              title="刷新列表"
              @click="load"
            />
            <el-button
              v-if="resourceAction('create')"
              type="primary"
              :icon="Plus"
              @click="open('create')"
              >{{
                resource === 'roles' ? '新增角色' : resource === 'users' ? '新增用户' : '新增菜单'
              }}</el-button
            >
          </div>
        </div>

        <div v-if="error" class="system-state">
          <strong>无法读取{{ title }}</strong>
          <p>{{ error }}</p>
          <el-button @click="load">重新加载</el-button>
        </div>
        <div v-else class="table-wrap" v-loading="loading">
          <el-table v-if="resource === 'roles'" :data="filteredRows" min-width="1180">
            <el-table-column type="index" label="序号" width="65" />
            <el-table-column prop="id" label="ID" width="100" />
            <el-table-column prop="name" label="角色名称" min-width="130"
              ><template #default="{ row }"
                ><strong class="business-no">{{ row.name }}</strong></template
              ></el-table-column
            >
            <el-table-column label="页面查看" width="110" align="center"
              ><template #default="{ row }"
                ><span>{{
                  row.code === 'admin' ? '全部页面' : `${row.menuPermissionCount} 个页面`
                }}</span></template
              ></el-table-column
            >
            <el-table-column label="业务操作" width="110" align="center"
              ><template #default="{ row }"
                ><span>{{
                  row.code === 'admin' ? '全部操作' : `${row.actionPermissionCount} 项操作`
                }}</span></template
              ></el-table-column
            >
            <el-table-column label="关联用户" width="90"
              ><template #default="{ row }">{{ row.userCount }} 人</template></el-table-column
            >
            <el-table-column label="最后操作人" width="110"
              ><template #default="{ row }">{{
                row.updatedBy || row.createdBy || '—'
              }}</template></el-table-column
            >
            <el-table-column label="操作时间" width="150"
              ><template #default="{ row }">{{
                timeText(row.updatedAt || row.createdAt)
              }}</template></el-table-column
            >
            <el-table-column prop="status" label="状态" width="90"
              ><template #default="{ row }"
                ><el-tag :type="Number(row.statusValue) === 1 ? 'success' : 'info'">{{
                  row.status
                }}</el-tag></template
              ></el-table-column
            >
            <el-table-column label="操作" width="132" fixed="right" align="center"
              ><template #default="{ row }"
                ><TableRowActions
                  ><el-button link type="primary" @click="open('view', row)">查看</el-button
                  ><el-button
                    v-if="resourceAction('update')"
                    link
                    type="primary"
                    @click="open('edit', row)"
                    >编辑</el-button
                  ></TableRowActions
                ></template
              ></el-table-column
            >
          </el-table>

          <el-table v-else-if="resource === 'users'" :data="filteredRows" min-width="1180">
            <el-table-column type="index" label="序号" width="65" />
            <el-table-column prop="id" label="ID" width="100" />
            <el-table-column prop="account" label="登录账号" min-width="120"
              ><template #default="{ row }"
                ><strong class="business-no">{{ row.account }}</strong></template
              ></el-table-column
            >
            <el-table-column prop="name" label="用户姓名" min-width="130"
              ><template #default="{ row }"
                ><span class="user-name"
                  ><i>{{ row.name?.slice(0, 1) }}</i
                  >{{ row.name }}</span
                ></template
              ></el-table-column
            >
            <el-table-column prop="fixedOrgName" label="固定所属组织" min-width="160"
              ><template #default="{ row }"
                ><span v-if="row.fixedOrgName">{{ row.fixedOrgName }}</span
                ><el-tag v-else type="warning">未配置</el-tag></template
              ></el-table-column
            >
            <el-table-column prop="department" label="所属部门" min-width="130"
              ><template #default="{ row }">{{ row.department || '—' }}</template></el-table-column
            >
            <el-table-column label="岗位" min-width="130" show-overflow-tooltip
              ><template #default="{ row }">{{
                row.positionName || '—'
              }}</template></el-table-column
            >
            <el-table-column label="所属角色" min-width="150" show-overflow-tooltip
              ><template #default="{ row }">{{ row.roleName || '—' }}</template></el-table-column
            >
            <el-table-column label="金额权限" width="104" align="center"
              ><template #default="{ row }"
                ><el-tag :type="amountAccessTag(row.amountAccess)">{{
                  amountAccessLabel(row.amountAccess)
                }}</el-tag></template
              ></el-table-column
            >
            <el-table-column label="数据访问组织" min-width="180" show-overflow-tooltip
              ><template #default="{ row }">{{
                row.authorizedOrgNames?.join('、') || '未授权'
              }}</template></el-table-column
            >
            <el-table-column prop="phone" label="联系电话" width="130"
              ><template #default="{ row }">{{ row.phone || '—' }}</template></el-table-column
            >
            <el-table-column prop="status" label="状态" width="90"
              ><template #default="{ row }"
                ><el-tag :type="Number(row.statusValue) === 1 ? 'success' : 'info'">{{
                  row.status
                }}</el-tag></template
              ></el-table-column
            >
            <el-table-column label="操作" width="214" fixed="right" align="center"
              ><template #default="{ row }"
                ><TableRowActions :show-more="can('system:users:configure-amount')"
                  ><el-button link type="primary" @click="open('view', row)">查看</el-button
                  ><el-button
                    v-if="isSuperAdmin && can('system:users:authorize-role')"
                    link
                    type="primary"
                    @click="openRoleAccess(row)"
                    >角色授权</el-button
                  ><el-button
                    v-if="can('system:users:update') && !row.staffId"
                    link
                    type="primary"
                    @click="open('edit', row)"
                    >编辑</el-button
                  ><template #more
                    ><el-dropdown-item
                      v-if="can('system:users:configure-amount')"
                      @click="openAmountAccess(row)"
                      >金额权限</el-dropdown-item
                    ></template
                  ></TableRowActions
                ></template
              ></el-table-column
            >
          </el-table>

          <el-table
          <el-table
            v-else
            :data="menuTree"
            row-key="id"
            :tree-props="{ children: 'children' }"
            v-model:expand-row-keys="menuExpandedKeys"
            :indent="20"
            min-width="1180"
          >
            <el-table-column width="44" align="center">
              <template #default="{ row }">
                <span
                  v-if="row.children?.length"
                  class="menu-expand-toggle"
                  @click="toggleMenuExpand(row)"
                >
                  <el-icon :size="14">
                    <ArrowDown v-if="menuExpandedKeys.includes(String(row.id))" />
                    <ArrowRight v-else />
                  </el-icon>
                </span>
              </template>
            </el-table-column>
            <el-table-column prop="name" label="菜单名称" min-width="200">
              <template #default="{ row }">
                <strong v-if="row.typeValue === 1">{{ row.name }}</strong>
                <span v-else-if="row.typeValue === 2">{{ row.name }}</span>
                <span v-else class="menu-action-name">{{ row.name }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="id" label="ID" width="100" />
            <el-table-column prop="type" label="菜单类型" width="90">
              <template #default="{ row }">
                <el-tag
                  :type="row.typeValue === 1 ? 'primary' : row.typeValue === 2 ? '' : 'info'"
                  >{{ row.type }}</el-tag
                >
              </template>
            </el-table-column>
            <el-table-column prop="path" label="访问路径" min-width="180">
              <template #default="{ row }">{{ row.path || '—' }}</template>
            </el-table-column>
            <el-table-column prop="permission" label="权限编码" min-width="160">
              <template #default="{ row }">{{ row.permission || '—' }}</template>
            </el-table-column>
            <el-table-column label="权限类别" width="90">
              <template #default="{ row }">
                <el-tag :type="row.typeValue === 3 ? 'warning' : undefined">
                  {{ row.typeValue === 3 ? '操作' : '页面' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="sortOrder" label="显示顺序" width="90" />
            <el-table-column label="数据来源" width="90">MySQL</el-table-column>
            <el-table-column prop="statusName" label="状态" width="90">
              <template #default="{ row }">
                <el-tag :type="row.visible ? 'success' : 'info'">{{ row.statusName }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="176" fixed="right" align="center">
              <template #default="{ row }">
                <TableRowActions :show-more="can('system:config:delete')">
                  <el-button link type="primary" @click="open('view', row)">查看</el-button>
                  <el-button v-if="can('system:config:update')" link type="primary" @click="open('edit', row)">编辑</el-button>
                  <template #more>
                    <el-dropdown-item
                      v-if="can('system:config:delete')"
                      class="table-action-danger"
                      @click="removeMenu(row)"
                      >删除菜单</el-dropdown-item
                    >
                  </template>
                </TableRowActions>
              </template>
            </el-table-column>
          </el-table>
          <div
            v-if="!loading && !(resource === 'config' ? menuRowCount : filteredRows.length)"
            class="system-state"
          >
            <strong>暂无符合条件的{{ title.replace('管理', '').replace('配置', '菜单') }}</strong>
            <p>请调整状态或搜索条件。</p>
          </div>
        </div>
        <footer class="table-footer">
          <span class="result-total"
            >共 {{ resource === 'config' ? menuRowCount : filteredRows.length }}
            {{
              resource === 'users' ? '名用户' : resource === 'config' ? '个菜单' : '条记录'
            }}</span
          ><el-pagination
            :total="resource === 'config' ? menuRowCount : filteredRows.length"
            :page-size="Math.max(resource === 'config' ? menuRowCount : filteredRows.length, 1)"
            layout="prev, pager, next"
            disabled
          />
        </footer>
      </div>

      <el-dialog
        v-model="dialog"
        :width="resource === 'roles' ? 1120 : resource === 'users' ? 760 : 680"
        :close-on-click-modal="mode === 'view'"
      >
        <template #header
          ><div>
            <strong>{{
              mode === 'create'
                ? `新增${resource === 'config' ? '系统菜单' : resource === 'roles' ? '角色' : '用户'}`
                : mode === 'edit'
                  ? `编辑${resource === 'config' ? '系统菜单' : resource === 'roles' ? '角色' : '用户'}`
                  : current?.name
            }}</strong
            ><small class="dialog-subtitle">{{
              resource === 'roles'
                ? '配置菜单和操作权限'
                : resource === 'users'
                  ? `登录账号：${current?.account ?? form.account}`
                  : mode === 'view'
                    ? '菜单详情'
                    : form.parentId === '0'
                      ? '一级菜单'
                      : `上级菜单 #${form.parentId}`
            }}</small>
          </div></template
        >

        <div v-if="false" class="detail-grid">
          <template v-if="resource === 'roles'">
            <div class="detail-item full">
              <span class="detail-label">菜单权限</span
              ><span>{{ current.menuPermissions?.join('、') || '—' }}</span>
            </div>
            <div class="detail-item full">
              <span class="detail-label">操作权限</span
              ><span>{{ current.actionPermissions?.join('、') || '—' }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">关联用户</span><span>{{ current.userCount }} 人</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">启用状态</span><span>{{ current.status }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">最后操作人</span
              ><span>{{ current.updatedBy || current.createdBy || '—' }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">操作时间</span
              ><span>{{ timeText(current.updatedAt || current.createdAt) }}</span>
            </div>
          </template>
          <template v-else-if="resource === 'users'">
            <div class="detail-item">
              <span class="detail-label">所属公司</span><span>{{ current.orgName || '—' }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">所属部门</span><span>{{ current.department || '—' }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">关联人员</span
              ><span>{{ current.staffName || '本地账号（未关联 OA 人员）' }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">所属岗位</span
              ><span>{{ current.positionName || '—' }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">所属角色</span><span>{{ current.roleName || '—' }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">联系电话</span><span>{{ current.phone || '—' }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">账号状态</span><span>{{ current.status }}</span>
            </div>
            <div class="detail-item full">
              <span class="detail-label">最后操作人</span
              ><span>{{ current.updatedBy || current.createdBy || '—' }}</span>
            </div>
          </template>
          <template v-else>
            <div class="detail-item">
              <span class="detail-label">上级菜单</span><span>{{ current.parentName }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">菜单类型</span><span>{{ current.type }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">访问路径</span><span>{{ current.path || '—' }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">权限编码</span><span>{{ current.permission || '—' }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">显示顺序</span><span>{{ current.sortOrder }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">数据来源</span><span>MySQL</span>
            </div>
            <div class="detail-item full">
              <span class="detail-label">启用状态</span><span>{{ current.statusName }}</span>
            </div>
          </template>
        </div>

        <el-form v-else label-position="top" :disabled="mode === 'view'">
          <template v-if="resource === 'roles'">
            <div class="dialog-grid">
              <el-form-item label="角色名称 *"
                ><el-input
                  v-model="form.name"
                  :disabled="mode === 'view' || (mode === 'edit' && current?.userCount > 0)"
                  maxlength="50"
              /></el-form-item>
              <el-form-item label="启用状态 *"
                ><el-select
                  v-model="form.status"
                  :disabled="mode === 'view' || current?.code === 'admin'"
                  style="width: 100%"
                  ><el-option
                    v-for="item in dictionary('enabled_status')"
                    :key="item.value"
                    :label="item.label"
                    :value="Number(item.value)" /></el-select
              ></el-form-item>
            </div>
            <div class="permission-section role-permission-section">
              <div class="permission-heading">
                <div>
                  <div class="permission-title">菜单与操作权限 *</div>
                  <small>每个页面分别配置查看、新增、编辑、删除和实际业务操作。</small>
                </div>
                <el-checkbox v-model="allRolePermissionsSelected" border>全部权限</el-checkbox>
              </div>
              <el-table
                :data="rolePermissionRows"
                border
                stripe
                max-height="500"
                row-key="id"
                class="role-permission-table"
              >
                <el-table-column prop="moduleName" label="业务模块" width="130" />
                <el-table-column prop="menuName" label="页面菜单" min-width="150">
                  <template #default="{ row }">
                    <div class="permission-menu-name">
                      <strong>{{ row.menuName }}</strong>
                      <small>{{ row.menuCode }}</small>
                    </div>
                  </template>
                </el-table-column>
                <el-table-column label="查看" width="72" align="center">
                  <template #default="{ row }">
                    <el-checkbox
                      :model-value="menuViewSelected(row)"
                      aria-label="查看"
                      @change="setMenuView(row, Boolean($event))"
                    />
                  </template>
                </el-table-column>
                <el-table-column
                  v-for="column in [
                    { key: 'create', label: '新增' },
                    { key: 'update', label: '编辑' },
                    { key: 'delete', label: '删除' },
                  ]"
                  :key="column.key"
                  :label="column.label"
                  width="72"
                  align="center"
                >
                  <template #default="{ row }">
                    <el-checkbox
                      v-if="actionByKey(row, column.key as 'create' | 'update' | 'delete')"
                      :model-value="
                        actionSelected(
                          actionByKey(row, column.key as 'create' | 'update' | 'delete'),
                        )
                      "
                      :aria-label="column.label"
                      @change="
                        setAction(
                          row,
                          actionByKey(row, column.key as 'create' | 'update' | 'delete'),
                          Boolean($event),
                        )
                      "
                    />
                    <span v-else class="permission-empty">—</span>
                  </template>
                </el-table-column>
                <el-table-column label="其他业务操作" min-width="320">
                  <template #default="{ row }">
                    <div v-if="otherActions(row).length" class="business-action-list">
                      <el-checkbox
                        v-for="action in otherActions(row)"
                        :key="action.id"
                        :model-value="actionSelected(action)"
                        @change="setAction(row, action, Boolean($event))"
                        >{{ action.name.replace(`${row.menuName}-`, '') }}</el-checkbox
                      >
                    </div>
                    <span v-else class="permission-empty">无其他操作</span>
                  </template>
                </el-table-column>
              </el-table>
            </div>
          </template>

          <template v-else-if="resource === 'users'">
            <div class="dialog-grid">
              <el-form-item label="登录账号 *"
                ><el-input
                  v-model="form.account"
                  :disabled="mode === 'view' || mode === 'edit'"
                  maxlength="50"
              /></el-form-item>
              <el-form-item :label="mode === 'create' ? '初始密码 *' : '重置密码'"
                ><el-input
                  v-model="form.password"
                  type="password"
                  show-password
                  :placeholder="mode === 'edit' ? '留空不修改' : '至少6位'"
              /></el-form-item>
              <el-form-item label="用户姓名 *"
                ><el-input v-model="form.name" maxlength="50"
              /></el-form-item>
              <el-form-item label="账号来源"
                ><el-input model-value="本地系统账号（OA 人员由同步自动建号）" disabled
              /></el-form-item>
              <el-form-item label="联系电话"
                ><el-input v-model="form.phone" maxlength="20"
              /></el-form-item>
              <el-form-item label="固定所属组织 *"
                ><el-tree-select
                  v-model="form.orgId"
                  :data="organizationTree"
                  filterable
                  check-strictly
                  node-key="value"
                  :props="{ label: 'label', children: 'children' }"
                  :disabled="mode === 'view' || !!form.staffId"
                  style="width: 100%"
                />
                ></el-form-item
              >
              <el-form-item label="所属部门"
                ><el-select
                  v-model="form.deptId"
                  clearable
                  filterable
                  :disabled="mode === 'view' || !!form.staffId"
                  style="width: 100%"
                  ><el-option
                    v-for="item in filteredDepartments"
                    :key="item.id"
                    :label="item.name"
                    :value="item.id" /></el-select
              ></el-form-item>
              <el-form-item label="权限组成"
                ><el-input model-value="单一角色 + 数据访问组织 + 独立金额白名单" disabled
              /></el-form-item>
              <el-form-item label="账号状态 *"
                ><el-select
                  v-model="form.status"
                  :disabled="mode === 'view' || form.account === 'admin'"
                  style="width: 100%"
                  ><el-option
                    v-for="item in dictionary('system_account_status')"
                    :key="item.value"
                    :label="item.label"
                    :value="Number(item.value)" /></el-select
              ></el-form-item>
            </div>
            <div v-if="mode === 'create'" class="permission-section">
              <div class="permission-title">
                所属角色 *<small>（一个用户只能选择一个角色）</small>
              </div>
              <el-radio-group v-model="form.roleId" class="role-grid"
                ><el-radio
                  v-for="item in roleOptions"
                  :key="item.id"
                  :value="String(item.id)"
                  border
                  :disabled="
                    (!isSuperAdmin && item.code === 'admin') ||
                    (form.account === 'admin' && item.code === 'admin')
                  "
                  ><strong>{{ item.name }}</strong></el-radio
                ></el-radio-group
              >
            </div>
            <div v-if="mode === 'create'" class="permission-section">
              <div class="permission-title">数据访问组织 *</div>
              <el-tree-select
                v-model="form.authorizedOrgIds"
                :data="organizationTree"
                multiple
                filterable
                check-strictly
                show-checkbox
                node-key="value"
                :props="{ label: 'label', children: 'children' }"
                style="width: 100%"
              />
              <small class="permission-help"
                >固定所属组织会自动加入且不可缺少；其他组织属于本地人工授权。</small
              >
            </div>
            <div v-else class="permission-section authorization-preview">
              <div class="permission-title">当前业务授权</div>
              <div class="dialog-grid">
                <el-form-item label="单一角色">
                  <el-input :model-value="current?.roleName || '未配置'" disabled />
                </el-form-item>
                <el-form-item label="数据访问组织">
                  <el-input
                    :model-value="current?.authorizedOrgNames?.join('、') || '未配置'"
                    disabled
                  />
                </el-form-item>
              </div>
              <small class="permission-help"
                >角色和数据访问组织统一通过列表中的“角色授权”维护。</small
              >
            </div>
          </template>

          <template v-else>
            <div class="dialog-grid">
              <el-form-item label="上级菜单"
                ><el-select v-model="form.parentId" style="width: 100%"
                  ><el-option label="一级菜单" value="0" /><el-option
                    v-for="item in directoryMenus.filter(
                      (item) => String(item.id) !== String(current?.id),
                    )"
                    :key="item.id"
                    :label="item.name"
                    :value="String(item.id)" /></el-select
              ></el-form-item>
              <el-form-item label="菜单名称 *"
                ><el-input v-model="form.name" maxlength="50"
              /></el-form-item>
              <el-form-item label="菜单类型"
                ><el-select v-model="form.type" style="width: 100%"
                  ><el-option
                    v-for="item in dictionary('system_menu_type')"
                    :key="item.value"
                    :label="item.label"
                    :value="Number(item.value)" /></el-select
              ></el-form-item>
              <el-form-item label="访问路径"><el-input v-model="form.route" /></el-form-item>
              <el-form-item label="权限编码"><el-input v-model="form.permission" /></el-form-item>
              <el-form-item label="显示顺序"
                ><el-input-number v-model="form.sortOrder" :min="0" style="width: 100%"
              /></el-form-item>
              <el-form-item label="显示状态"
                ><el-select v-model="form.status" style="width: 100%"
                  ><el-option
                    v-for="item in dictionary('enabled_status')"
                    :key="item.value"
                    :label="item.label"
                    :value="Number(item.value)" /></el-select
              ></el-form-item>
              <el-form-item label="菜单图标"
                ><el-input v-model="form.icon" placeholder="Element Plus 图标名"
              /></el-form-item>
            </div>
          </template>
        </el-form>

        <template #footer
          ><el-button @click="dialog = false">{{ mode === 'view' ? '关闭' : '取消' }}</el-button
          ><el-button v-if="mode !== 'view'" type="primary" :loading="saving" @click="save">{{
            resource === 'config' ? '保存配置' : '保存'
          }}</el-button></template
        >
      </el-dialog>

      <el-dialog v-model="roleDialog" width="760" title="角色授权" :close-on-click-modal="false">
        <div class="amount-access-user role-access-user">
          <div>
            <span>用户姓名</span><strong>{{ roleCurrent?.name || '—' }}</strong>
          </div>
          <div>
            <span>登录账号</span><strong>{{ roleCurrent?.account || '—' }}</strong>
          </div>
          <div>
            <span>账号来源</span><strong>{{ roleCurrent?.identitySource || '—' }}</strong>
          </div>
          <div>
            <span>固定所属组织</span
            ><strong>{{ roleCurrent?.fixedOrgName || roleCurrent?.orgName || '—' }}</strong>
          </div>
        </div>
        <el-alert
          title="固定所属组织来自 OA 且不可变更；这里只配置单一角色和额外数据访问组织，不影响金额白名单。"
          type="info"
          :closable="false"
          show-icon
        />
        <div class="permission-section">
          <div class="permission-title">所属角色 * <small>（单选）</small></div>
          <el-radio-group v-model="roleForm.roleId" class="role-grid">
            <el-radio
              v-for="item in roleOptions"
              :key="item.id"
              :value="String(item.id)"
              border
              :disabled="roleCurrent?.id === auth.user?.id"
            >
              <strong>{{ item.name }}</strong>
            </el-radio>
          </el-radio-group>
        </div>
        <div class="permission-section">
          <div class="permission-title">数据访问组织 *</div>
          <div class="fixed-org-row">
            <span>固定所属组织</span>
            <strong>{{ roleCurrent?.fixedOrgName || roleCurrent?.orgName || '未配置' }}</strong>
            <el-tag type="success" effect="plain">必选 · 不可取消</el-tag>
          </div>
          <el-form label-position="top" class="authorized-org-form">
            <el-form-item label="额外授权组织（可多选）">
              <el-tree-select
                v-model="roleForm.additionalOrgIds"
                :data="roleOrganizationTree"
                multiple
                filterable
                check-strictly
                show-checkbox
                collapse-tags
                :max-collapse-tags="3"
                node-key="value"
                :props="{ label: 'label', children: 'children', disabled: 'disabled' }"
                placeholder="如无需跨组织访问，只保留固定所属组织即可"
                style="width: 100%"
              />
            </el-form-item>
          </el-form>
          <small class="permission-help">
            最终数据范围是“固定所属组织 + 这里人工增加的组织”；页面顶部仍只显示固定所属组织。
          </small>
        </div>
        <template #footer>
          <el-button @click="roleDialog = false">取消</el-button>
          <el-button type="primary" :loading="roleSaving" @click="saveRoleAccess"
            >保存授权</el-button
          >
        </template>
      </el-dialog>

      <el-dialog
        v-model="amountDialog"
        width="560"
        title="配置金额权限"
        :close-on-click-modal="false"
      >
        <div class="amount-access-user">
          <div>
            <span>用户姓名</span><strong>{{ amountCurrent?.name || '—' }}</strong>
          </div>
          <div>
            <span>登录账号</span><strong>{{ amountCurrent?.account || '—' }}</strong>
          </div>
          <div>
            <span>所属公司</span><strong>{{ amountCurrent?.orgName || '—' }}</strong>
          </div>
        </div>
        <el-alert
          title="金额权限独立于角色、岗位和 OA；未进入白名单时默认不能查看或编辑金额。"
          type="info"
          :closable="false"
          show-icon
        />
        <el-form label-position="top" class="amount-access-form">
          <el-form-item label="金额权限 *">
            <el-radio-group v-model="amountForm.level" class="amount-access-levels">
              <el-radio-button value="none">无权限</el-radio-button>
              <el-radio-button value="view">仅查看</el-radio-button>
              <el-radio-button value="edit" :disabled="Number(amountCurrent?.statusValue) !== 1"
                >可编辑</el-radio-button
              >
            </el-radio-group>
          </el-form-item>
          <el-form-item label="授权或变更原因 *">
            <el-input
              v-model="amountForm.grantReason"
              type="textarea"
              :rows="3"
              maxlength="255"
              show-word-limit
              placeholder="请填写业务负责人确认、取消授权或其他变更原因"
            />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="amountDialog = false">取消</el-button>
          <el-button type="primary" :loading="amountSaving" @click="saveAmountAccess"
            >保存</el-button
          >
        </template>
      </el-dialog>
    </template>
  </section>
</template>

<style scoped>
.menu-action-name {
  color: #8a94a6;
  font-size: 12px;
}
.menu-expand-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  cursor: pointer;
  color: #687487;
}
.menu-expand-toggle:hover {
  background: rgba(24, 104, 253, 0.08);
  color: var(--hs-primary);
}
:deep(.el-table__expand-icon) {
  display: none;
}
.system-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 11px 14px;
  border-bottom: 1px solid var(--hs-border);
  background: #fafbfd;
}
.status-filter,
.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 9px;
}
.status-filter span {
  color: #5f6a7c;
  font-size: 11px;
}
.system-state {
  min-height: 230px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}
.system-state strong {
  font-size: 14px;
}
.system-state p {
  color: var(--hs-muted);
}
.user-name {
  display: flex;
  align-items: center;
  gap: 8px;
}
.user-name i {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #eef1ff;
  color: var(--hs-primary);
  font-style: normal;
  font-weight: 700;
}
.dialog-subtitle {
  display: block;
  margin-top: 4px;
  color: var(--hs-muted);
  font-size: 10px;
  font-weight: 400;
}
.permission-section {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--hs-border);
}
.permission-title {
  margin-bottom: 10px;
  font-size: 12px;
  font-weight: 650;
}
.permission-title small,
.permission-help,
.permission-heading small {
  color: var(--el-text-color-secondary);
  font-size: 11px;
  font-weight: 400;
}
.permission-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}
.permission-heading .permission-title {
  margin-bottom: 3px;
}
.role-permission-table {
  width: 100%;
}
.permission-menu-name {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.permission-menu-name small {
  color: var(--el-text-color-secondary);
  font-size: 10px;
}
.permission-empty {
  color: var(--el-text-color-placeholder);
  font-size: 11px;
}
.business-action-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
}
.business-action-list :deep(.el-checkbox) {
  height: 24px;
  margin-right: 0;
}
.permission-grid {
  display: grid;
  gap: 8px;
  margin-top: 9px;
}
.menu-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.action-grid {
  grid-template-columns: repeat(5, minmax(0, 1fr));
}
.role-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 9px;
}
.permission-grid :deep(.el-checkbox),
.role-grid :deep(.el-checkbox),
.role-grid :deep(.el-radio) {
  width: 100%;
  height: auto;
  min-height: 38px;
  margin: 0;
  padding: 8px 10px;
}
.role-grid :deep(.el-checkbox__label),
.role-grid :deep(.el-radio__label) {
  display: flex;
  flex-direction: column;
}
.role-grid small {
  margin-top: 2px;
  color: var(--hs-muted);
  font-size: 9px;
}
.amount-access-user {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
.role-access-user {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
.fixed-org-row {
  display: grid;
  grid-template-columns: 110px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 11px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--el-fill-color-light);
}
.fixed-org-row span {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.authorized-org-form {
  margin-top: 14px;
}
.authorization-preview :deep(.el-form-item) {
  margin-bottom: 4px;
}
.amount-access-user > div {
  padding: 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--el-fill-color-light);
}
.amount-access-user span,
.amount-access-user strong {
  display: block;
}
.amount-access-user span {
  margin-bottom: 4px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.amount-access-form {
  margin-top: 18px;
}
.amount-access-levels {
  width: 100%;
}
.amount-access-levels :deep(.el-radio-button) {
  flex: 1;
}
.amount-access-levels :deep(.el-radio-button__inner) {
  width: 100%;
}
.table-wrap :deep(.el-table) {
  min-width: 1180px;
}
@media (max-width: 820px) {
  .system-toolbar {
    align-items: stretch;
    flex-direction: column;
  }
  .toolbar-actions {
    flex-wrap: wrap;
  }
  .toolbar-actions .el-input {
    flex: 1;
  }
  .menu-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .action-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .amount-access-user {
    grid-template-columns: 1fr;
  }
  .permission-heading {
    align-items: stretch;
    flex-direction: column;
  }
  .fixed-org-row {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 540px) {
  .toolbar-actions > * {
    width: 100% !important;
  }
  .menu-grid,
  .action-grid,
  .role-grid {
    grid-template-columns: 1fr;
  }
}
</style>
