import type { Component } from 'vue';
import type { BusinessColumn } from '../business-config';

/**
 * 业务文档配置：驱动 BusinessDocumentPage 共享引擎。
 *
 * 目标：把 WorkflowPage / PurchasePage / InventoryPage 里「列表 + 表单」的公共骨架抽成
 * 一个引擎，每个业务类型用一份「完整配置」+「薄壳页面」+「专属表单组件」表达。
 */

/** 列渲染上下文：提供与旧页一致的名称反查、字典、创建人等能力 */
export type ColumnRenderContext = {
  /** 按 options 集合反查名称（orgs/warehouses/depts/vendors/users/units/goods 等） */
  lookup: (name: string, value: unknown) => string;
  /** 按 id 取 options 集合中的原始条目（可再取 goodsName/queryCode 等字段） */
  byId: (name: string, value: unknown) => Record<string, any> | undefined;
  /** 字典 label */
  dictLabel: (code: string, value: unknown) => string;
  /** 创建人（当前用户显示用户名，否则 —） */
  creator: (row: Record<string, any>) => string;
};

/** 引擎加载的公共 options 集合名 */
export type OptionBagName =
  | 'orgs'
  | 'warehouses'
  | 'depts'
  | 'vendors'
  | 'users'
  | 'units'
  | 'goods';

/** 查询字段 */
export type QueryField = {
  key: string;
  label: string;
  /** 控件类型 */
  type?: 'input' | 'select' | 'tree-select' | 'date-range' | 'remote-select';
  /** 静态选项（select 用） */
  options?: Array<{ value: string | number; label: string }>;
  /** 数据字典 code（select 用，优先于 options） */
  dictionary?: string;
  /** options 集合名（tree-select/select 从引擎预加载的 optionBags 取数据） */
  optionBag?: OptionBagName;
  /** 依赖字段：该字段值变化时，清空本字段值并重新加载选项、重新查询（如 仓库 依赖 组织） */
  dependsOn?: string;
  /** 依赖字段为空时也加载选项（配合 loadOptions：不选组织时默认加载授权组织下的仓库，选中后收窄） */
  loadOnEmptyDep?: boolean;
  /** 动态选项加载（走后端）：返回 {value,label,raw?}[]，优先于 optionBag/options/dictionary；常用于按依赖字段过滤的选项 */
  loadOptions?: (deps: Record<string, any>) => Promise<Array<{ value: string | number; label: string; raw?: any }>>;
  /** 远程搜索（remote-select 用）：返回 {value,label}[] */
  fetch?: (keyword: string) => Promise<Array<{ value: string | number; label: string }>>;
  /** 已选值回显标签（remote-select 用） */
  currentLabel?: (value: unknown) => string;
  /** 传给后端的参数键名（缺省用 key） */
  param?: string;
  width?: number;
};

/** 行操作 */
export type RowAction = {
  key: string;
  /** 静态文案，或按行数据返回的动态文案（如“办理出库/查看出库”） */
  label: string | ((row: Record<string, any>) => string);
  kind?: 'primary' | 'success' | 'warning' | 'danger' | 'info';
  /** 是否显示 */
  show?: (row: Record<string, any>) => boolean;
  /** 操作前的确认文案（可动态按行生成） */
  confirm?: string | ((row: Record<string, any>) => string);
  /** 旧版确认框标题和按钮文案；未配置时按当前操作名称生成。 */
  confirmTitle?: string | ((row: Record<string, any>) => string);
  confirmButtonText?: string;
  cancelButtonText?: string;
  confirmType?: 'success' | 'warning' | 'info' | 'error';
  /** 预检：返回非空文案时中止操作（不发请求、不弹确认框），用于“先编辑补数据再操作”的引导 */
  verify?: (row: Record<string, any>) => string | null | undefined | Promise<string | null | undefined>;
  /** 是否作为主操作平铺展示（默认 true：平铺在操作列；false 时收进“更多”下拉） */
  primary?: boolean;
  /** 菜单内操作权限；支持 create/update/delete，或完整权限码。缺省按 action key 推导。 */
  permission?: string;
  /** 操作回调：ctx 提供打开表单、刷新列表等能力 */
  handler: (row: Record<string, any>, ctx: BusinessDocumentContext) => void | Promise<void>;
};

/** 引擎上下文（传给表单组件 / 行操作） */
export type BusinessDocumentContext = {
  refresh: () => Promise<void>;
  /** 打开新增表单，initial 为表单初始值（配合 createPreset 使用） */
  openCreate: (initial?: Record<string, any>) => void;
  openEdit: (row: Record<string, any>) => void;
  openView: (row: Record<string, any>) => void;
  /** 跳转其它业务页面（跨页深链，如“生成退回”） */
  navigate: (path: string, query?: Record<string, string>) => Promise<void>;
};

/** 业务文档配置 */
export type BusinessDocumentConfig = {
  /** 业务 key，如 'requisitions/applications' */
  key: string;
  title: string;
  /** 副标题（页面头部标题下方的小字），缺省用通用文案 */
  subtitle?: string;
  /** 列表接口 */
  endpoint: string;
  /** 单据中心类型；配置后统一提供附件与全链路追溯。 */
  documentType?: string;
  /** 列表主编号字段 */
  no: string;
  columns: BusinessColumn[];
  /** 引擎需要预加载的公共 options 集合（供列 render 的 lookup/byId 使用） */
  optionBags?: OptionBagName[];
  dictionaries?: string[];
  /** 是否自动显示「业务状态」下拉（默认 true；当 queryFields 已有状态筛选时置 false 避免重复） */
  autoStatusFilter?: boolean;
  summary?: boolean;
  /** 摘要卡片映射（summary 为 true 时按此渲染头部卡片；key 对应列表接口返回的 summary 对象字段） */
  summaryLabels?: Array<{ label: string; key: string; kind?: 'money' | 'number' }>;
  creatable?: boolean;
  /** 页面及新增权限。缺省按当前路由和 create 操作判断。 */
  pagePermission?: string;
  createPermission?: string;
  /** 关键字搜索框占位文案；缺省「单号 / 关键字」 */
  keywordPlaceholder?: string;
  /** 是否显示分页 footer；缺省 true（预警类全量列表设 false） */
  pagination?: boolean;
  createText?: string;
  /** 新增表单的初始值预设（如领用出库的 directOutput），在 openCreate 时合并 */
  createPreset?: () => Record<string, any>;
  queryFields?: QueryField[];
  rowActions?: RowAction[];
  /** 专属表单组件（v-model 接收 form、emit save/cancel），可为空（只读业务） */
  formComponent?: Component;
  /** 通用表单弹框布局；复杂业务弹框仍由薄页面通过 business-dialogs 插槽挂载。 */
  dialog?: { width?: string; top?: string; className?: string };
  /** 表单弹框标题定制（如采购入库的「办理采购入库」）；缺省用 title */
  dialogTitle?: (mode: 'create' | 'edit' | 'view') => string;
  /** 查看态关闭按钮已经由专属表单提供；缺省由共享弹框统一提供。 */
  viewCloseInForm?: boolean;
  /** 查看、编辑前加载完整详情；未配置时沿用列表行。 */
  loadDetail?: (id: string | number) => Promise<Record<string, any>>;
  /** 路由深链处理：页面挂载时如有相关 query（documentId/applicationId/outputId 等），打开对应表单 */
  openFromRoute?: (
    query: Record<string, any>,
    ctx: BusinessDocumentContext,
  ) => Promise<void> | void;
};
