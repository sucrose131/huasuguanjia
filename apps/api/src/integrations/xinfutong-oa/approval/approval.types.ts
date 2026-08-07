/**
 * 薪福通 OA 审批域类型定义
 *
 * 包含：发起流程v2、流程结束事件回调
 */

// ==================== 接口路径 ====================

/** 发起流程v2 接口路径 */
export const FORM_START_PATH = '/xft-oa/openapi/xft-newform/open/form-start';

// ==================== 流程发起类型 ====================

/** 流程发起类型 */
export type ProcStartType = 'start' | 'trialStart' | 'restart';

/** 流程状态 */
export type ProcStatus =
  | 'RUNNING'
  | 'BACKTOSTART'
  | 'PASSED'
  | 'CANCELED'
  | 'REJECTED'
  | 'DELETED'
  | 'WITHDRAWN';

/** 发起流程v2 请求参数 */
export interface FormStartParams {
  /** 表单编码（必填） */
  formKey: string;
  /** 业务编号（restart 时必填，start 时可选） */
  busKey?: string;
  /** 流程发起类型（必填）：start-发起；trialStart-试算发起；restart-重新发起 */
  procStartType: ProcStartType;
  /** 表单数据（JSON 字符串，必填） */
  formData: string;
  /** 试算 id（trialStart 时可选，restart 时可选） */
  trialId?: string;
  /** 发起人组织 id（支持发起人部门选择时必填） */
  starterOrgId?: string;
  /** 发起人自选参数（OA 试算组件发起时必填） */
  startParams?: string;
  /** 代理发起人 id（代理提单时必填） */
  agentStarterId?: string;
  /** 发起人 id */
  starterId?: string;
}

/** 待办任务 */
export interface TodoTask {
  /** 任务 id */
  taskId?: string;
  /** 任务类型 */
  type?: string;
  /** 子类型 */
  subType?: string;
  /** 节点名称 */
  nodeName?: string;
  /** 节点 id */
  nodeId?: string;
  /** 审批人 id */
  assignee?: string;
  /** 审批人姓名 */
  assigneeName?: string;
  /** 任务创建时间 */
  taskCreateTime?: string;
}

/** 发起流程v2 响应 body */
export interface FormStartResult {
  /** 表单编码 */
  formKey?: string;
  /** 业务编号 */
  busKey?: string;
  /** 流程实例 id */
  procInstId?: string;
  /** 流程状态 */
  procStatus?: ProcStatus;
  /** 当前流程待处理任务列表 */
  todoTaskList?: TodoTask[];
}

// ==================== 流程结束事件回调类型 ====================

/** 流程状态终态（触发回调的状态） */
export type FinalProcStatus = 'PASSED' | 'REJECTED' | 'CANCELED' | 'DELETED';

/** OA 审批流程结束事件回调载荷 */
export interface ApprovalCallbackPayload {
  /** 企业号 */
  prjCod: string;
  /** 流程状态（终态） */
  procStatus: FinalProcStatus;
  /** 业务编号 */
  busKey: string;
  /** 审批编号（流程实例 id） */
  procInstId: string;
  /** 流程 Key */
  procKey: string;
}

/** 事件编号：OA 审批流程结束事件 */
export const EVENT_CODE_OA_PROCESS_FINISH = 'XFTOAFPS';
