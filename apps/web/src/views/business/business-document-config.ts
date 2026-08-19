import type { Component } from 'vue';
import type { BusinessColumn } from '../business-config';

/**
 * 业务文档配置：驱动 BusinessDocumentPage 共享引擎。
 *
 * 目标：把 WorkflowPage / PurchasePage / InventoryPage 里「列表 + 表单」的公共骨架抽成
 * 一个引擎，每个业务类型用一份「完整配置」+「薄壳页面」+「专属表单组件」表达。
 */

/** 查询字段 */
export type QueryField = {
  key: string;
  label: string;
  /** 控件类型 */
  type?: 'input' | 'select';
  /** 静态选项（select 用） */
  options?: Array<{ value: string | number; label: string }>;
  /** 数据字典 code（select 用，优先于 options） */
  dictionary?: string;
  width?: number;
};

/** 行操作 */
export type RowAction = {
  key: string;
  label: string;
  kind?: 'primary' | 'success' | 'warning' | 'danger' | 'info';
  /** 是否显示 */
  show?: (row: Record<string, any>) => boolean;
  /** 操作前的确认文案 */
  confirm?: string;
  /** 操作回调：ctx 提供打开表单、刷新列表等能力 */
  handler: (row: Record<string, any>, ctx: BusinessDocumentContext) => void | Promise<void>;
};

/** 引擎上下文（传给表单组件 / 行操作） */
export type BusinessDocumentContext = {
  refresh: () => Promise<void>;
  openCreate: () => void;
  openEdit: (row: Record<string, any>) => void;
  openView: (row: Record<string, any>) => void;
};

/** 业务文档配置 */
export type BusinessDocumentConfig = {
  /** 业务 key，如 'requisitions/applications' */
  key: string;
  title: string;
  /** 列表接口 */
  endpoint: string;
  /** 列表主编号字段 */
  no: string;
  columns: BusinessColumn[];
  dictionaries?: string[];
  summary?: boolean;
  creatable?: boolean;
  createText?: string;
  queryFields?: QueryField[];
  rowActions?: RowAction[];
  /** 专属表单组件（v-model 接收 form、emit save/cancel），可为空（只读业务） */
  formComponent?: Component;
};
