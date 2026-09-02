/**
 * 薪福通 OA 审批域类型定义
 *
 * 包含：发起流程v2、审批流程处理、流程结束事件回调
 */

// ==================== 接口路径 ====================

/** 发起流程v2 接口路径 */
export const FORM_START_PATH = '/xft-oa/openapi/xft-newform/open/form-start';

/** 审批流程处理接口路径 */
export const PROC_INST_DEAL_PATH = '/xft-oa/openapi/xft-oa/open/operate/proc/inst/deal';

/** 文件上传接口路径 */
export const FILE_UPLOAD_PATH = '/xft-oa/openapi/xft-oa/file/upload';

/** 文件上传最大大小（20MB） */
export const FILE_UPLOAD_MAX_SIZE = 20 * 1024 * 1024;

/** 允许上传的文件扩展名集合 */
export const FILE_UPLOAD_ALLOWED_EXTENSIONS = new Set([
  'BMP',
  'DAT',
  'DMG',
  'DOC',
  'DOCX',
  'DPS',
  'ET',
  'GIF',
  'JFIF',
  'JPEG',
  'JPG',
  'MP3',
  'MP4',
  'P12',
  'PDF',
  'PEM',
  'PNG',
  'PPT',
  'PPTX',
  'RAR',
  'TXT',
  'WPS',
  'XEC',
  'XLS',
  'XLSX',
  'ZIP',
  'DWG',
  'MOV',
  'BW',
  'AI',
  'CDR',
  'COL',
  'DXB',
  'DXF',
  'EPS',
  'QT',
  'AVI',
  'MPEG',
  'MPE',
  'RM',
  'ASF',
  'STP',
  'CSV',
  'STEP',
]);

/** 文件名最大长度 */
export const FILE_UPLOAD_FILENAME_MAX_LENGTH = 100;

// ==================== 流程发起类型 ====================

/** 流程发起类型 */
export type ProcStartType = 'start' | 'trialStart' | 'restart';

/** 流程状态 */
export type ProcStatus =
  'RUNNING' | 'BACKTOSTART' | 'PASSED' | 'CANCELED' | 'REJECTED' | 'DELETED' | 'WITHDRAWN';

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

// ==================== 审批流程处理 ====================

/**
 * 流程处理类型
 *
 * 通过（pass）、提交（submit）、否决（reject）、转派（transfer）、
 * 加签（addSign）、退回（back）、撤销（cancel）
 */
export const PROC_OPERATE_TYPES = [
  'pass',
  'submit',
  'reject',
  'transfer',
  'addSign',
  'back',
  'cancel',
] as const;

export type ProcOperateType = (typeof PROC_OPERATE_TYPES)[number];

/** 通过、否决、转派、加签、提交时 taskId 必填（OA00048） */
export const PROC_OPERATE_TYPES_REQUIRE_TASK_ID: ReadonlySet<ProcOperateType> = new Set([
  'pass',
  'submit',
  'reject',
  'transfer',
  'addSign',
]);

/**
 * 加签类型
 *
 * FRONT：前加签，适用于依次审批、允许加签的单人审批
 * BEHIND：后加签，适用于依次审批、允许加签的单人审批
 * PARALLEL：并行加签，适用于或签、会签
 */
export const ADD_SIGN_TYPES = ['FRONT', 'BEHIND', 'PARALLEL'] as const;

export type AddSignType = (typeof ADD_SIGN_TYPES)[number];

/**
 * 审批流程处理附件项
 *
 * 官方文档未展开数组元素结构；与发起流程附件控件一致，使用上传接口返回的 id / objectKey / name。
 */
export interface ProcDealAttachment {
  /** 文件 id（上传接口返回的 fileId） */
  id?: string;
  /** 对象存储 key */
  objectKey?: string;
  /** 文件名 */
  name?: string;
}

/** 审批流程处理请求参数 */
export interface ProcInstDealParams {
  /** 审批人用户号（必填） */
  approverId: string;
  /** 处理类型（必填） */
  operateType: ProcOperateType;
  /** 业务编号（必填） */
  busKey: string;
  /** 任务 id（通过、提交、否决、转派、加签时必填；文档类型为 LONG，示例为字符串） */
  taskId?: string | number;
  /** 审批意见（开启审批意见必填校验时必填） */
  approveComment?: string;
  /** 业务数据（JSON 字符串，审批时需要修改表单数据时可传） */
  busData?: string;
  /** 退回节点 id（退回时必填，通过可退回节点查询接口获取） */
  backNodeId?: string;
  /** 转派人用户号（转派时必填） */
  transferApproverId?: string;
  /** 加签类型（加签时必填） */
  addSignType?: AddSignType;
  /** 加签人用户号集合（加签时必填） */
  addSignApproverIdList?: string[];
  /** 审批图片附件集合 */
  picAttachmentList?: ProcDealAttachment[];
  /** 审批文件集合 */
  fileAttachmentList?: ProcDealAttachment[];
  /** 审批签名文件 id（须先调用 OA 文件上传接口获取） */
  signKey?: string;
}

/** 审批流程处理响应 body */
export interface ProcInstDealResult {
  /** 业务数据（JSON 字符串） */
  busData?: string;
  /** 业务编号 */
  busKey?: string;
  /** 扩展数据 */
  extensionData?: Record<string, unknown>;
  /** 企业号 */
  prjCod?: string;
  /** 流程定义 id */
  procDefId?: string;
  /** 流程实例 id */
  procInstId?: string;
  /** 流程 Key */
  procKey?: string;
  /** 流程发起人 id */
  procStarterId?: string;
  /** 流程状态 */
  procStatus?: ProcStatus;
  /** 当前流程待处理任务列表 */
  todoTaskList?: TodoTask[];
}

// ==================== 流程结束事件回调类型 ====================

/** 流程状态终态（触发回调的状态） */
export type FinalProcStatus = 'PASSED' | 'REJECTED' | 'CANCELED' | 'DELETED';

/** 解密后 procKey 的表单前缀；去掉后即为 hspsi_oa_form_template.form_key */
export const OA_PROC_KEY_FORM_PREFIX = 'FORM_';

/**
 * 从流程结束事件的 procKey 还原 OA 表单 form_key。
 * 实测值为 `FORM_AAC15400_NFORM_…`，去掉 `FORM_` 即模板表 form_key。
 */
export function formKeyFromProcKey(procKey: string): string {
  return procKey.startsWith(OA_PROC_KEY_FORM_PREFIX)
    ? procKey.slice(OA_PROC_KEY_FORM_PREFIX.length)
    : procKey;
}

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
  /** 由 procKey 去掉 FORM_ 前缀得到的表单 Key */
  formKey: string;
}

/** 事件编号：OA 审批流程结束事件 */
export const EVENT_CODE_OA_PROCESS_FINISH = 'XFTOAFPS';

// ==================== 文件上传 ====================

/** 文件上传请求参数 */
export interface FileUploadParams {
  /** 文件名（含扩展名，长度不超过 100） */
  fileName: string;
  /** 文件内容（Buffer） */
  fileBuffer: Buffer;
  /** 文件 MIME 类型（可选，不传则根据扩展名自动推断） */
  mimeType?: string;
}

/** 文件上传响应 body */
export interface FileUploadResult {
  /** 文件 id（可用于 /file/download 接口下载） */
  fileId?: string;
  /** 文件类型（扩展名） */
  fileType?: string;
  /** 文件名 */
  fileName?: string;
  /** 文件大小（字节） */
  fileSize?: number;
  /** 对象存储 key */
  objectKey?: string;
  /** 文件下载链接（7 天有效） */
  fileUrl?: string;
  /** 父级 id */
  parentId?: string | null;
}
