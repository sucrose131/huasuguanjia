<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, Refresh, Search } from '@element-plus/icons-vue';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import SummaryStrip from '@/components/SummaryStrip.vue';
import TableRowActions from '@/components/business/TableRowActions.vue';
import { buildOrganizationTree, type OrganizationTreeNode } from '@/utils/organization-tree';
import ScheduledTaskPanel from '@/views/ScheduledTaskPanel.vue';

type Resource = 'roles' | 'users' | 'config' | 'tasks';
type Mode = 'create' | 'edit' | 'view';

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
const dicts = reactive<Record<string, any[]>>({});
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const keyword = ref('');
const statusFilter = ref<string | number>('');
const dialog = ref(false);
const mode = ref<Mode>('create');
const current = ref<any>(null);
const form = reactive<any>({});

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
          ? [row.account, row.name, row.department, row.phone, ...(row.roleNames ?? [])]
          : [row.name, row.path, row.permission, row.type];
    return values.join(' ').includes(word);
  }),
);

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
      { label: '已分配角色', value: rows.value.filter((row) => row.roleIds?.length).length },
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
const filteredDepartments = computed(() =>
  deptOptions.value.filter((item) => !form.orgId || String(item.orgId) === String(form.orgId)),
);
const allMenusSelected = computed({
  get: () =>
    pageMenus.value.length > 0 &&
    pageMenus.value.every((menu) => form.menuIds?.includes(String(menu.id))),
  set: (selected: boolean) => {
    form.menuIds = selected ? pageMenus.value.map((menu) => String(menu.id)) : [];
  },
});

function dictionary(code: string) {
  return dicts[code] ?? [];
}
function dictionaryLabel(code: string, value: any) {
  return dictionary(code).find((item) => String(item.value) === String(value))?.label ?? '—';
}
function timeText(value: any) {
  return value ? String(value).replace('T', ' ').slice(0, 16) : '—';
}

async function loadDictionaries() {
  const codes = ['enabled_status', 'system_account_status', 'role_scope_type', 'system_menu_type'];
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
      dataScope: 3,
      menuIds: [],
      actionPermissionCodes: ['system:view'],
    });
  else if (resource.value === 'users')
    Object.assign(form, {
      account: '',
      password: '',
      name: '',
      phone: '',
      orgId: '',
      deptId: '',
      roleIds: [],
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
        dataScope: row.dataScopeValue,
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
        roleIds: (row.roleIds ?? []).map(String),
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
    if (!form.roleIds?.length) return '请至少选择一个角色';
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
  () => form.orgId,
  () => {
    if (
      form.deptId &&
      !filteredDepartments.value.some((item) => String(item.id) === String(form.deptId))
    )
      form.deptId = '';
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
        <p class="page-subtitle">{{
          resource === 'tasks'
            ? '配置同步任务开关和 Linux Cron 执行时间，保存后无需重启。'
            : '配置组织权限、用户和系统级业务规则。'
        }}</p>
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
            v-if="can('system:create')"
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
          <el-table-column label="菜单权限" min-width="180" show-overflow-tooltip
            ><template #default="{ row }">{{
              row.menuPermissions?.length ? row.menuPermissions.join('、') : '未配置'
            }}</template></el-table-column
          >
          <el-table-column label="操作权限" min-width="150" show-overflow-tooltip
            ><template #default="{ row }">{{
              row.actionPermissions?.length ? row.actionPermissions.join('、') : '未配置'
            }}</template></el-table-column
          >
          <el-table-column prop="dataScope" label="默认数据范围" width="130" />
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
                  v-if="can('system:update')"
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
          <el-table-column prop="orgName" label="所属公司" min-width="160"
            ><template #default="{ row }"
              ><span v-if="row.orgName">{{ row.orgName }}</span
              ><el-tag v-else type="warning">未配置</el-tag></template
            ></el-table-column
          >
          <el-table-column prop="department" label="所属部门" min-width="130"
            ><template #default="{ row }">{{ row.department || '—' }}</template></el-table-column
          >
          <el-table-column label="所属角色" min-width="150" show-overflow-tooltip
            ><template #default="{ row }">{{
              row.roleNames?.join('、') || '—'
            }}</template></el-table-column
          >
          <el-table-column label="数据范围" width="130"
            ><template #default="{ row }">{{
              row.dataScope?.scopeType || '未配置'
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
          <el-table-column label="操作" width="132" fixed="right" align="center"
            ><template #default="{ row }"
              ><TableRowActions
                ><el-button link type="primary" @click="open('view', row)">查看</el-button
                ><el-button
                  v-if="can('system:update')"
                  link
                  type="primary"
                  @click="open('edit', row)"
                  >编辑</el-button
                ></TableRowActions
              ></template
            ></el-table-column
          >
        </el-table>

        <el-table v-else :data="filteredRows" min-width="1180">
          <el-table-column type="index" label="序号" width="65" />
          <el-table-column prop="id" label="ID" width="100" />
          <el-table-column prop="parentName" label="上级菜单" min-width="120" />
          <el-table-column prop="name" label="菜单名称" min-width="140"
            ><template #default="{ row }"
              ><strong>{{ row.name }}</strong></template
            ></el-table-column
          >
          <el-table-column prop="type" label="菜单类型" width="90"
            ><template #default="{ row }"
              ><el-tag>{{ row.type }}</el-tag></template
            ></el-table-column
          >
          <el-table-column prop="path" label="访问路径" min-width="180"
            ><template #default="{ row }">{{ row.path || '—' }}</template></el-table-column
          >
          <el-table-column prop="permission" label="权限编码" min-width="160"
            ><template #default="{ row }">{{ row.permission || '—' }}</template></el-table-column
          >
          <el-table-column label="权限类别" width="90"
            ><template #default="{ row }"
              ><el-tag :type="row.typeValue === 3 ? 'warning' : undefined">{{
                row.typeValue === 3 ? '操作' : '页面'
              }}</el-tag></template
            ></el-table-column
          >
          <el-table-column prop="sortOrder" label="显示顺序" width="90" />
          <el-table-column label="数据来源" width="90">MySQL</el-table-column>
          <el-table-column prop="statusName" label="状态" width="90"
            ><template #default="{ row }"
              ><el-tag :type="row.visible ? 'success' : 'info'">{{
                row.statusName
              }}</el-tag></template
            ></el-table-column
          >
          <el-table-column label="操作" width="176" fixed="right" align="center"
            ><template #default="{ row }"
              ><TableRowActions :show-more="can('system:delete')"
                ><el-button link type="primary" @click="open('view', row)">查看</el-button
                ><el-button
                  v-if="can('system:update')"
                  link
                  type="primary"
                  @click="open('edit', row)"
                  >编辑</el-button
                ><template #more
                  ><el-dropdown-item class="table-action-danger" @click="removeMenu(row)"
                    >删除菜单</el-dropdown-item
                  ></template
                ></TableRowActions
              ></template
            ></el-table-column
          >
        </el-table>
        <div v-if="!loading && !filteredRows.length" class="system-state">
          <strong>暂无符合条件的{{ title.replace('管理', '').replace('配置', '菜单') }}</strong>
          <p>请调整状态或搜索条件。</p>
        </div>
      </div>
      <footer class="table-footer">
        <span class="result-total"
          >共 {{ filteredRows.length }}
          {{ resource === 'users' ? '名用户' : resource === 'config' ? '个菜单' : '条记录' }}</span
        ><el-pagination
          :total="filteredRows.length"
          :page-size="Math.max(filteredRows.length, 1)"
          layout="prev, pager, next"
          disabled
        />
      </footer>
    </div>

    <el-dialog
      v-model="dialog"
      :width="resource === 'roles' ? 860 : resource === 'users' ? 760 : 680"
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
              ? '配置菜单、操作权限和默认数据范围'
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
          <div class="detail-item">
            <span class="detail-label">默认数据范围</span
            ><span>{{ current.dataScope || '—' }}</span>
          </div>
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
            <span class="detail-label">所属角色</span
            ><span>{{ current.roleNames?.join('、') || '—' }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">数据范围</span
            ><span>{{ current.dataScope?.scopeType || '—' }}</span>
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
            <el-form-item label="默认数据范围 *"
              ><el-select v-model="form.dataScope" style="width: 100%"
                ><el-option
                  v-for="item in dictionary('role_scope_type')"
                  :key="item.value"
                  :label="item.label"
                  :value="Number(item.value)" /></el-select
            ></el-form-item>
          </div>
          <div class="permission-section">
            <div class="permission-title">菜单权限 *</div>
            <el-checkbox v-model="allMenusSelected" border>全部菜单</el-checkbox
            ><el-checkbox-group v-model="form.menuIds" class="permission-grid menu-grid"
              ><el-checkbox v-for="item in pageMenus" :key="item.id" :value="String(item.id)" border
                >{{ item.parentName }} · {{ item.name }}</el-checkbox
              ></el-checkbox-group
            >
          </div>
          <div class="permission-section">
            <div class="permission-title">操作权限 *</div>
            <el-checkbox-group
              v-model="form.actionPermissionCodes"
              class="permission-grid action-grid"
              ><el-checkbox
                v-for="item in actionMenus"
                :key="item.id"
                :value="item.permission"
                border
                >{{ item.name }}</el-checkbox
              ></el-checkbox-group
            >
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
            <el-form-item label="联系电话"
              ><el-input v-model="form.phone" maxlength="20"
            /></el-form-item>
            <el-form-item label="所属公司 *"
              ><el-tree-select
                v-model="form.orgId"
                :data="organizationTree"
                filterable
                check-strictly
                node-key="value"
                :props="{ label: 'label', children: 'children' }"
                style="width: 100%"
              />
              ></el-form-item
            >
            <el-form-item label="所属部门"
              ><el-select v-model="form.deptId" clearable filterable style="width: 100%"
                ><el-option
                  v-for="item in filteredDepartments"
                  :key="item.id"
                  :label="item.name"
                  :value="item.id" /></el-select
            ></el-form-item>
            <el-form-item label="数据范围 *"
              ><el-input
                :model-value="
                  mode === 'edit' ? current?.dataScope?.scopeType : '由所选角色合并计算'
                "
                disabled
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
          <div class="permission-section">
            <div class="permission-title">所属角色 *</div>
            <el-checkbox-group v-model="form.roleIds" class="role-grid"
              ><el-checkbox
                v-for="item in roleOptions"
                :key="item.id"
                :value="String(item.id)"
                border
                :disabled="mode === 'view' || (form.account === 'admin' && item.code === 'admin')"
                ><strong>{{ item.name }}</strong
                ><small>{{
                  dictionaryLabel('role_scope_type', item.dataScope)
                }}</small></el-checkbox
              ></el-checkbox-group
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
    </template>
  </section>
</template>

<style scoped>
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
.role-grid :deep(.el-checkbox) {
  width: 100%;
  height: auto;
  min-height: 38px;
  margin: 0;
  padding: 8px 10px;
}
.role-grid :deep(.el-checkbox__label) {
  display: flex;
  flex-direction: column;
}
.role-grid small {
  margin-top: 2px;
  color: var(--hs-muted);
  font-size: 9px;
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
