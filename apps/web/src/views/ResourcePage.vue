<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import { api } from '@/api';
import SummaryStrip from '@/components/SummaryStrip.vue';
import StatusTag from '@/components/StatusTag.vue';
import DataState from '@/components/DataState.vue';
import TableRowActions from '@/components/business/TableRowActions.vue';
import { dateText, display } from '@/utils/format';
type InputType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'organization'
  | 'department'
  | 'position'
  | 'user'
  | 'customer'
  | 'dictionary';
type Field = {
  key: string;
  label: string;
  type?: InputType;
  required?: boolean;
  dict?: string;
  full?: boolean;
  immutable?: boolean;
};
type Column = {
  key: string;
  label: string;
  width?: number;
  min?: number;
  kind?:
    'date' | 'status' | 'org' | 'parent' | 'department' | 'position' | 'user' | 'customer' | 'dict';
};
type OrganizationOption = {
  value: string | number;
  label: string;
  raw?: { parentId?: string | number; sort?: number };
};
type OrganizationTreeNode = OrganizationOption & { children?: OrganizationTreeNode[] };
const configs: Record<
  string,
  {
    title: string;
    subtitle: string;
    summary: string[];
    keyword: string;
    fields: Field[];
    columns: Column[];
    dicts: string[];
  }
> = {
  vendors: {
    title: '供应商',
    subtitle: '维护采购和商品引用的供应商标准档案',
    summary: ['供应商总数', '有效供应商', '已删除供应商'],
    keyword: '速查码、公司名称、简称、联系人或电话',
    dicts: [],
    columns: [
      { key: 'queryCode', label: '速查码', width: 110 },
      { key: 'companyName', label: '公司名称', min: 170 },
      { key: 'shortName', label: '简称', min: 110 },
      { key: 'saleContact', label: '联系人', width: 110 },
      { key: 'saleTel', label: '联系电话', width: 130 },
      { key: 'serviceContact', label: '售后联系人', width: 120 },
      { key: 'operatorName', label: '操作人', width: 110 },
      { key: 'updatedAt', label: '操作时间', width: 168, kind: 'date' },
    ],
    fields: [
      { key: 'queryCode', label: '速查码' },
      { key: 'companyName', label: '公司名称', required: true },
      { key: 'saleContact', label: '销售联系人', required: true },
      { key: 'saleTel', label: '销售电话', required: true },
      { key: 'saleEmail', label: '联系邮箱' },
      { key: 'shortName', label: '简称' },
      { key: 'serviceContact', label: '售后联系人' },
      { key: 'serviceTel', label: '售后电话' },
      { key: 'address', label: '地址', full: true },
      { key: 'remark', label: '备注', type: 'textarea', full: true },
    ],
  },
  customers: {
    title: '客户',
    subtitle: '维护客户归属、来源及关联关系',
    summary: ['客户总数', '启用客户', '停用客户'],
    keyword: '客户名称或手机号',
    dicts: ['gender', 'customer_source', 'enabled_status'],
    columns: [
      { key: 'name', label: '客户名称', min: 130 },
      { key: 'mobile', label: '手机号', width: 130 },
      { key: 'organization', label: '所属组织', min: 170, kind: 'org' },
      { key: 'sourceType', label: '客户来源', width: 110, kind: 'dict' },
      { key: 'relatedCustomer', label: '关联客户', min: 150, kind: 'customer' },
      { key: 'status', label: '状态', width: 90, kind: 'status' },
      { key: 'operatorName', label: '操作人', width: 110 },
      { key: 'updatedAt', label: '操作时间', width: 168, kind: 'date' },
    ],
    fields: [
      { key: 'name', label: '客户名称', required: true },
      { key: 'mobile', label: '手机号', required: true },
      { key: 'orgId', label: '所属组织', type: 'organization', required: true, immutable: true },
      { key: 'sourceType', label: '客户来源', type: 'dictionary', dict: 'customer_source' },
      { key: 'relatedCustomerId', label: '关联客户', type: 'customer', immutable: true },
      { key: 'status', label: '状态', type: 'dictionary', dict: 'enabled_status' },
      { key: 'gender', label: '性别', type: 'dictionary', dict: 'gender' },
      { key: 'birthday', label: '生日', type: 'date' },
      { key: 'address', label: '地址', full: true },
      { key: 'referrerName', label: '推荐人姓名' },
      { key: 'referrerMobile', label: '推荐人手机' },
      { key: 'sort', label: '排序', type: 'number' },
      { key: 'remark', label: '备注', type: 'textarea', full: true },
    ],
  },
  organizations: {
    title: '公司',
    subtitle: '维护公司及上下级组织层级关系',
    summary: ['公司总数', '正常公司', '停业公司'],
    keyword: '公司编码、名称、简称或联系人',
    dicts: ['organization_operation_status'],
    columns: [
      { key: 'orgNo', label: '公司编码', width: 120 },
      { key: 'name', label: '公司名称', min: 160 },
      { key: 'parentOrganization', label: '上级公司', min: 180, kind: 'parent' },
      { key: 'contactName', label: '联系人', width: 110 },
      { key: 'contactPhone', label: '联系电话', width: 130 },
      { key: 'operationStatus', label: '运营状态', width: 100, kind: 'status' },
      { key: 'operatorName', label: '操作人', width: 110 },
      { key: 'updatedAt', label: '操作时间', width: 168, kind: 'date' },
    ],
    fields: [
      { key: 'orgNo', label: '公司编码', required: true, immutable: true },
      { key: 'name', label: '公司名称', required: true },
      { key: 'parentId', label: '上级公司', type: 'organization', immutable: true },
      { key: 'shortName', label: '公司简称' },
      { key: 'contactName', label: '联系人' },
      { key: 'contactPhone', label: '联系电话' },
      { key: 'address', label: '地址', full: true },
      {
        key: 'operationStatus',
        label: '运营状态',
        type: 'dictionary',
        dict: 'organization_operation_status',
        required: true,
      },
      { key: 'establishedAt', label: '成立日期', type: 'date' },
      { key: 'sort', label: '排序', type: 'number' },
      { key: 'remark', label: '备注', type: 'textarea', full: true },
    ],
  },
  departments: {
    title: '部门',
    subtitle: '维护公司下的部门层级、负责人及启停状态',
    summary: ['部门总数', '启用部门', '停用部门'],
    keyword: '部门编码或部门名称',
    dicts: ['enabled_status'],
    columns: [
      { key: 'deptNo', label: '部门编码', width: 120 },
      { key: 'name', label: '部门名称', min: 160 },
      { key: 'organization', label: '所属公司', min: 180, kind: 'org' },
      { key: 'parentDepartment', label: '上级部门', min: 150, kind: 'department' },
      { key: 'leader', label: '负责人', width: 120, kind: 'user' },
      { key: 'sort', label: '排序', width: 80 },
      { key: 'status', label: '状态', width: 90, kind: 'status' },
      { key: 'operatorName', label: '操作人', width: 110 },
      { key: 'updatedAt', label: '操作时间', width: 168, kind: 'date' },
    ],
    fields: [
      { key: 'orgId', label: '所属公司', type: 'organization', required: true },
      { key: 'parentId', label: '上级部门', type: 'department' },
      { key: 'deptNo', label: '部门编码' },
      { key: 'name', label: '部门名称', required: true },
      { key: 'leaderId', label: '负责人', type: 'user' },
      { key: 'sort', label: '排序', type: 'number' },
      { key: 'status', label: '状态', type: 'dictionary', dict: 'enabled_status' },
    ],
  },
  positions: {
    title: '职位',
    subtitle: '读取岗位表及岗位所属组织关系',
    summary: ['职位总数', '启用职位', '停用职位'],
    keyword: '职位编码或职位名称',
    dicts: ['enabled_status'],
    columns: [
      { key: 'postCode', label: '职位编码', width: 130 },
      { key: 'name', label: '职位名称', min: 180 },
      { key: 'belongNames', label: '所属公司/部门', min: 210 },
      { key: 'status', label: '状态', width: 90, kind: 'status' },
      { key: 'sort', label: '排序', width: 80 },
      { key: 'remark', label: '备注', min: 180 },
      { key: 'updatedAt', label: '更新时间', width: 168, kind: 'date' },
    ],
    fields: [
      { key: 'postCode', label: '职位编码' },
      { key: 'name', label: '职位名称', required: true },
      { key: 'status', label: '状态', type: 'dictionary', dict: 'enabled_status' },
      { key: 'sort', label: '排序', type: 'number' },
      { key: 'remark', label: '备注', type: 'textarea', full: true },
    ],
  },
  employees: {
    title: '员工',
    subtitle: '读取员工表及其岗位、公司和部门关系',
    summary: ['员工总数', '在职员工', '离职员工'],
    keyword: '员工编号、姓名或手机号',
    dicts: ['gender', 'enabled_status'],
    columns: [
      { key: 'staffCode', label: '员工编号', width: 140 },
      { key: 'name', label: '员工姓名', min: 120 },
      { key: 'position', label: '职位', min: 150, kind: 'position' },
      { key: 'organization', label: '所属公司', min: 190, kind: 'org' },
      { key: 'departmentNames', label: '所属部门', min: 150 },
      { key: 'gender', label: '性别', width: 80, kind: 'dict' },
      { key: 'mobile', label: '手机号', width: 140 },
      { key: 'status', label: '状态', width: 90, kind: 'status' },
      { key: 'updatedAt', label: '更新时间', width: 168, kind: 'date' },
    ],
    fields: [
      { key: 'staffCode', label: '员工编号' },
      { key: 'name', label: '员工姓名', required: true },
      { key: 'postId', label: '职位', type: 'position' },
      { key: 'gender', label: '性别', type: 'dictionary', dict: 'gender' },
      { key: 'mobile', label: '手机号' },
      { key: 'status', label: '状态', type: 'dictionary', dict: 'enabled_status' },
    ],
  },
  warehouses: {
    title: '仓库',
    subtitle: '维护组织下的实体仓库及仓库类型',
    summary: ['仓库总数', '启用仓库', '停用仓库'],
    keyword: '仓库名称',
    dicts: ['warehouse_type', 'enabled_status'],
    columns: [
      { key: 'name', label: '仓库名称', min: 150 },
      { key: 'warehouseType', label: '仓库类型', width: 110, kind: 'dict' },
      { key: 'organization', label: '所属组织', min: 180, kind: 'org' },
      { key: 'managerName', label: '负责人', width: 110 },
      { key: 'contactPhone', label: '联系电话', width: 130 },
      { key: 'status', label: '状态', width: 90, kind: 'status' },
      { key: 'operatorName', label: '操作人', width: 110 },
      { key: 'updatedAt', label: '操作时间', width: 168, kind: 'date' },
    ],
    fields: [
      { key: 'name', label: '仓库名称', required: true },
      { key: 'orgId', label: '所属组织', type: 'organization', required: true, immutable: true },
      {
        key: 'warehouseType',
        label: '仓库类型',
        type: 'dictionary',
        dict: 'warehouse_type',
        required: true,
      },
      { key: 'address', label: '地址', full: true },
      { key: 'managerName', label: '负责人' },
      { key: 'contactPhone', label: '联系电话' },
      { key: 'status', label: '状态', type: 'dictionary', dict: 'enabled_status' },
      { key: 'sort', label: '排序', type: 'number' },
      { key: 'remark', label: '备注', type: 'textarea', full: true },
    ],
  },
  units: {
    title: '计量单位',
    subtitle: '维护商品和 SKU 使用的基础计量单位',
    summary: ['单位总数', '启用单位', '停用单位'],
    keyword: '单位名称',
    dicts: ['enabled_status'],
    columns: [
      { key: 'name', label: '单位名称', min: 180 },
      { key: 'sort', label: '排序', width: 100 },
      { key: 'status', label: '状态', width: 90, kind: 'status' },
      { key: 'operatorName', label: '操作人', width: 120 },
      { key: 'updatedAt', label: '操作时间', width: 168, kind: 'date' },
    ],
    fields: [
      { key: 'name', label: '单位名称', required: true },
      { key: 'status', label: '状态', type: 'dictionary', dict: 'enabled_status' },
      { key: 'sort', label: '排序', type: 'number' },
      { key: 'remark', label: '备注', type: 'textarea', full: true },
    ],
  },
};
const route = useRoute(),
  resource = computed(() => String(route.params.resource)),
  config = computed(() => configs[resource.value] ?? configs.vendors!);
const rows = ref<any[]>([]),
  total = ref(0),
  loading = ref(false),
  error = ref(''),
  mode = ref<'create' | 'edit' | 'view'>('create'),
  dialog = ref(false),
  saving = ref(false),
  formRef = ref<FormInstance>(),
  editing = ref('');
const summary = reactive({ total: 0, active: 0, inactive: 0 });
const query = reactive<any>({
  page: 1,
  pageSize: 20,
  keyword: '',
  orgId: '',
  status: '',
  sourceType: '',
  warehouseType: '',
  operationStatus: '',
  parentId: '',
});
const form = reactive<any>({}),
  dicts = reactive<Record<string, any[]>>({}),
  options = reactive({
    organizations: [] as OrganizationOption[],
    departments: [] as any[],
    positions: [] as any[],
    users: [] as any[],
    customers: [] as any[],
  });
const organizationTree = computed<OrganizationTreeNode[]>(() => {
  const nodes = new Map<string, OrganizationTreeNode>();
  for (const option of options.organizations)
    nodes.set(String(option.value), { ...option, children: [] });

  const roots: OrganizationTreeNode[] = [];
  for (const node of nodes.values()) {
    const parentId = String(node.raw?.parentId ?? 0);
    const parent = parentId !== '0' ? nodes.get(parentId) : undefined;
    if (parent) parent.children!.push(node);
    else roots.push(node);
  }

  const sortNodes = (items: OrganizationTreeNode[]) => {
    items.sort(
      (left, right) =>
        Number(left.raw?.sort ?? 0) - Number(right.raw?.sort ?? 0) ||
        left.label.localeCompare(right.label, 'zh-CN'),
    );
    for (const item of items) {
      if (item.children?.length) sortNodes(item.children);
      else delete item.children;
    }
  };
  sortNodes(roots);
  return roots;
});
const organizationParentTree = computed<OrganizationTreeNode[]>(() => [
  { value: 0, label: '顶级公司', children: organizationTree.value },
]);
const rules = computed<FormRules>(() =>
  Object.fromEntries(
    config.value.fields
      .filter((f) => f.required)
      .map((f) => [
        f.key,
        [{ required: true, message: `请选择或填写${f.label}`, trigger: 'change' }],
      ]),
  ),
);
const summaryItems = computed(() =>
  config.value.summary.map((label, index) => ({
    label,
    value: index === 0 ? summary.total : index === 1 ? summary.active : summary.inactive,
  })),
);
const dictionary = (code?: string) => (code ? (dicts[code] ?? []) : []);
const dictLabel = (key: string, value: any) => {
  const field = config.value.fields.find((f) => f.key === key);
  return dictionary(field?.dict).find((item) => String(item.value) === String(value))?.label ?? '—';
};
async function loadOptions() {
  const codes = [...new Set([...config.value.dicts, 'enabled_status'])];
  const results = (await Promise.all([
    api.get('/base-data/organizations/options'),
    api.get('/base-data/departments/options'),
    api.get('/base-data/positions/options'),
    api.get('/base-data/users/options'),
    api.get('/base-data/customers/options'),
    ...codes.map((code) => api.get(`/dictionaries/${code}`)),
  ])) as any[];
  options.organizations = results[0];
  options.departments = results[1];
  options.positions = results[2];
  options.users = results[3];
  options.customers = results[4];
  codes.forEach((code, index) => (dicts[code] = results[index + 5]));
}
async function load() {
  loading.value = true;
  error.value = '';
  try {
    const params = Object.fromEntries(
      Object.entries(query).filter(([, v]) => v !== '' && v !== null),
    );
    const data = (await api.get(`/base-data/${resource.value}`, { params })) as any;
    rows.value = data.items;
    total.value = data.total;
    Object.assign(summary, data.summary ?? { total: data.total, active: 0, inactive: 0 });
  } catch (e: any) {
    error.value = e?.response?.data?.message ?? '网络或服务暂不可用';
  } finally {
    loading.value = false;
  }
}
function resetForm() {
  Object.keys(form).forEach((key) => delete form[key]);
  for (const field of config.value.fields)
    form[field.key] =
      field.type === 'number'
        ? 0
        : field.key === 'status' || field.key === 'operationStatus'
          ? 1
          : '';
}
async function open(nextMode: 'create' | 'edit' | 'view', row?: any) {
  mode.value = nextMode;
  editing.value = row?.id ?? '';
  resetForm();
  if (row && nextMode !== 'create') {
    const useRow = ['positions', 'employees'].includes(resource.value);
    const detail = useRow
      ? row
      : ((await api.get(`/base-data/${resource.value}/${row.id}`)) as any);
    Object.assign(form, detail);
  }
  dialog.value = true;
  await nextTick();
  formRef.value?.clearValidate();
}
async function save() {
  if (!(await formRef.value?.validate().catch(() => false))) return;
  saving.value = true;
  try {
    if (mode.value === 'edit')
      await api.patch(`/base-data/${resource.value}/${editing.value}`, form);
    else await api.post(`/base-data/${resource.value}`, form);
    ElMessage.success(mode.value === 'edit' ? '修改已保存' : `${config.value.title}已保存`);
    dialog.value = false;
    await load();
  } finally {
    saving.value = false;
  }
}
async function remove(row: any) {
  await ElMessageBox.confirm(
    `删除后“${row.companyName ?? row.name}”将不再作为有效业务选项。是否继续？`,
    '删除供应商',
    { type: 'warning', confirmButtonText: '确认删除' },
  );
  await api.delete(`/base-data/${resource.value}/${row.id}`);
  ElMessage.success('删除成功');
  load();
}
async function changeStatus(row: any) {
  const field = resource.value === 'organizations' ? 'operationStatus' : 'status';
  const current = row[field];
  const next = current === 1 ? 2 : 1;
  const action = dictLabel(field, next);
  await ElMessageBox.confirm(
    `确认${action}“${row.name}”？${next !== 1 ? `${action}后将不能作为新的业务选项。` : ''}`,
    `${action}${config.value.title}`,
    { type: 'warning', confirmButtonText: `确认${action}` },
  );
  await api.patch(`/base-data/${resource.value}/${row.id}/status`, { status: next });
  ElMessage.success(`${action}成功`);
  load();
}
function search() {
  query.page = 1;
  load();
}
function reset() {
  Object.assign(query, {
    page: 1,
    pageSize: 20,
    keyword: '',
    orgId: '',
    status: '',
    sourceType: '',
    warehouseType: '',
    operationStatus: '',
    parentId: '',
  });
  load();
}
function cell(row: any, col: Column) {
  if (col.kind === 'date') return dateText(row[col.key], true);
  if (col.kind === 'org')
    return row.organization ? `${row.organization.code} ${row.organization.name}` : '—';
  if (col.kind === 'parent')
    return row.parentOrganization
      ? `${row.parentOrganization.code} ${row.parentOrganization.name}`
      : '顶级公司';
  if (col.kind === 'department')
    return row.parentDepartment
      ? `${row.parentDepartment.code || ''} ${row.parentDepartment.name}`.trim()
      : '顶级部门';
  if (col.kind === 'position')
    return row.position ? `${row.position.code || ''} ${row.position.name}`.trim() : '—';
  if (col.kind === 'user') return row.leader?.name ?? '—';
  if (col.kind === 'customer')
    return row.relatedCustomer
      ? `${row.relatedCustomer.name}（${row.relatedCustomer.mobile || '无手机号'}）`
      : '—';
  if (col.kind === 'dict') return dictLabel(col.key, row[col.key]);
  return display(row[col.key]);
}
watch(resource, async () => {
  reset();
  await loadOptions();
});
onMounted(async () => {
  await loadOptions();
  await load();
});
</script>
<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>{{ config.title }}</h2>
        <p class="page-subtitle">{{ config.subtitle }}</p>
      </div>
      <div class="page-actions">
        <el-button type="primary" @click="open('create')">新增{{ config.title }}</el-button>
      </div>
    </header>
    <div class="panel">
      <SummaryStrip :items="summaryItems" />
      <div class="query-bar">
        <el-input
          v-model="query.keyword"
          class="query-field keyword"
          clearable
          :placeholder="config.keyword"
          @keyup.enter="search"
        /><el-tree-select
          v-if="
            ['customers', 'warehouses', 'departments', 'positions', 'employees'].includes(resource)
          "
          v-model="query.orgId"
          :data="organizationTree"
          class="query-field"
          clearable
          filterable
          check-strictly
          node-key="value"
          :props="{ label: 'label', children: 'children' }"
          placeholder="所属公司"
        /><el-select
          v-if="resource === 'customers'"
          v-model="query.sourceType"
          class="query-field"
          clearable
          placeholder="客户来源"
          ><el-option
            v-for="item in dictionary('customer_source')"
            :key="item.value"
            :label="item.label"
            :value="item.value" /></el-select
        ><el-select
          v-if="resource === 'warehouses'"
          v-model="query.warehouseType"
          class="query-field"
          clearable
          placeholder="仓库类型"
          ><el-option
            v-for="item in dictionary('warehouse_type')"
            :key="item.value"
            :label="item.label"
            :value="item.value" /></el-select
        ><el-select
          v-if="resource === 'organizations'"
          v-model="query.operationStatus"
          class="query-field"
          clearable
          placeholder="运营状态"
          ><el-option
            v-for="item in dictionary('organization_operation_status')"
            :key="item.value"
            :label="item.label"
            :value="item.value" /></el-select
        ><el-select
          v-if="resource !== 'vendors' && resource !== 'organizations'"
          v-model="query.status"
          class="query-field"
          clearable
          placeholder="启停状态"
          ><el-option
            v-for="item in dictionary('enabled_status')"
            :key="item.value"
            :label="item.label"
            :value="item.value"
        /></el-select>
        <div class="query-actions">
          <el-button type="primary" @click="search">查询</el-button
          ><el-button @click="reset">重置</el-button>
        </div>
      </div>
      <DataState
        v-if="error || (!rows.length && !loading)"
        :error="error"
        :empty="!rows.length"
        :loading="loading"
        :title="config.title"
        can-create
        @retry="load"
        @create="open('create')"
      />
      <div v-else class="table-wrap">
        <el-table :data="rows" v-loading="loading"
          ><el-table-column type="index" label="序号" width="65" fixed="left" /><el-table-column
            prop="id"
            label="ID"
            width="100"
            fixed="left"
          /><el-table-column
            v-for="column in config.columns"
            :key="column.key"
            :label="column.label"
            :width="column.width"
            :min-width="column.min"
            show-overflow-tooltip
            ><template #default="scope"
              ><StatusTag
                v-if="column.kind === 'status'"
                :value="scope.row[column.key]"
                kind="enabled"
                :label="
                  resource === 'organizations'
                    ? dictLabel(column.key, scope.row[column.key])
                    : undefined
                "
              /><span v-else>{{ cell(scope.row, column) }}</span></template
            ></el-table-column
          ><el-table-column label="操作" width="176" fixed="right" align="center"
            ><template #default="scope"
              ><TableRowActions
                ><el-button link type="primary" @click="open('view', scope.row)">查看</el-button
                ><el-button
                  v-if="!scope.row.derived"
                  link
                  type="primary"
                  @click="open('edit', scope.row)"
                  >编辑</el-button
                ><template #more
                  ><el-dropdown-item
                    v-if="resource !== 'vendors' && !scope.row.derived"
                    :class="
                      (resource === 'organizations'
                        ? scope.row.operationStatus
                        : scope.row.status) === 1
                        ? 'table-action-warning'
                        : 'table-action-success'
                    "
                    @click="changeStatus(scope.row)"
                    >{{
                      resource === 'organizations'
                        ? scope.row.operationStatus === 1
                          ? '停业'
                          : '恢复正常'
                        : scope.row.status === 1
                          ? '停用'
                          : '启用'
                    }}</el-dropdown-item
                  ><el-dropdown-item
                    v-if="resource === 'vendors'"
                    class="table-action-danger"
                    @click="remove(scope.row)"
                    >删除</el-dropdown-item
                  ></template
                ></TableRowActions
              ></template
            ></el-table-column
          ></el-table
        >
      </div>
      <footer v-if="!error && rows.length" class="table-footer">
        <span class="result-total">共 {{ total }} 条{{ config.title }}记录</span
        ><el-pagination
          v-model:current-page="query.page"
          v-model:page-size="query.pageSize"
          :total="total"
          layout="prev, pager, next, sizes"
          @change="load"
        />
      </footer>
    </div>
    <el-dialog
      v-model="dialog"
      :title="`${mode === 'view' ? '查看' : mode === 'edit' ? '编辑' : '新增'}${config.title}`"
      width="520"
      :close-on-click-modal="false"
      ><template v-if="false"
        ><div class="detail-grid">
          <div
            v-for="field in config.fields"
            :key="field.key"
            class="detail-item"
            :class="{ full: field.full }"
          >
            <span class="detail-label">{{ field.label }}</span
            ><span class="detail-value">{{
              field.type === 'dictionary'
                ? dictLabel(field.key, form[field.key])
                : field.type === 'organization'
                  ? (options.organizations.find((i) => String(i.value) === String(form[field.key]))
                      ?.label ?? '—')
                  : field.type === 'customer'
                    ? (options.customers.find((i) => String(i.value) === String(form[field.key]))
                        ?.label ?? '—')
                    : field.type === 'date'
                      ? dateText(form[field.key])
                      : display(form[field.key])
            }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">操作人</span
            ><span class="detail-value">{{ display(form.operatorName) }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">操作时间</span
            ><span class="detail-value">{{
              dateText(form.updatedAt || form.createdAt, true)
            }}</span>
          </div>
        </div></template
      ><el-form
        v-else
        ref="formRef"
        :model="form"
        :rules="rules"
        label-position="top"
        :disabled="mode === 'view'"
        ><div class="dialog-grid">
          <el-form-item
            v-for="field in config.fields"
            :key="field.key"
            :label="field.label"
            :prop="field.key"
            :class="{ full: field.full }"
            ><el-input
              v-if="!field.type || field.type === 'text' || field.type === 'textarea'"
              v-model="form[field.key]"
              :type="field.type === 'textarea' ? 'textarea' : 'text'"
              :rows="3"
              :disabled="mode === 'view' || (mode === 'edit' && field.immutable)" /><el-input-number
              v-else-if="field.type === 'number'"
              v-model="form[field.key]"
              :min="0"
              style="width: 100%" /><el-date-picker
              v-else-if="field.type === 'date'"
              v-model="form[field.key]"
              value-format="YYYY-MM-DD"
              style="width: 100%" /><el-select
              v-else-if="field.type === 'dictionary'"
              v-model="form[field.key]"
              style="width: 100%"
              ><el-option
                v-for="item in dictionary(field.dict)"
                :key="item.value"
                :label="item.label"
                :value="Number(item.value)" /></el-select
            ><el-tree-select
              v-else-if="field.type === 'organization'"
              v-model="form[field.key]"
              :data="field.key === 'parentId' ? organizationParentTree : organizationTree"
              filterable
              check-strictly
              node-key="value"
              :props="{ label: 'label', children: 'children' }"
              :disabled="mode === 'view' || (mode === 'edit' && field.immutable)"
              style="width: 100%" /><el-select
              v-else-if="field.type === 'department'"
              v-model="form[field.key]"
              clearable
              filterable
              style="width: 100%"
              ><el-option label="顶级部门" :value="0" /><el-option
                v-for="item in options.departments.filter(
                  (i) => !form.orgId || String(i.raw?.orgId) === String(form.orgId),
                )"
                :key="item.value"
                :label="item.label"
                :value="item.value" /></el-select
            ><el-select
              v-else-if="field.type === 'position'"
              v-model="form[field.key]"
              clearable
              filterable
              style="width: 100%"
              ><el-option
                v-for="item in options.positions"
                :key="item.value"
                :label="item.label"
                :value="item.value" /></el-select
            ><el-select
              v-else-if="field.type === 'user'"
              v-model="form[field.key]"
              clearable
              filterable
              style="width: 100%"
              ><el-option
                v-for="item in options.users"
                :key="item.value"
                :label="item.label"
                :value="item.value" /></el-select
            ><el-select
              v-else-if="field.type === 'customer'"
              v-model="form[field.key]"
              clearable
              filterable
              :disabled="mode === 'view' || (mode === 'edit' && field.immutable)"
              style="width: 100%"
              ><el-option
                v-for="item in options.customers"
                :key="item.value"
                :label="item.label"
                :value="item.value" /></el-select
          ></el-form-item></div></el-form
      ><template #footer
        ><el-button @click="dialog = false">{{ mode === 'view' ? '关闭' : '取消' }}</el-button
        ><el-button
          v-if="mode !== 'view'"
          type="primary"
          :loading="saving"
          :disabled="saving"
          @click="save"
          >{{ mode === 'edit' ? '保存修改' : `保存${config.title}` }}</el-button
        ></template
      ></el-dialog
    >
  </section>
</template>
