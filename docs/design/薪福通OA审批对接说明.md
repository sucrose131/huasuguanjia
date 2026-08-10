# 薪福通OA审批对接说明

## 1. 对接概述

### 1.1 业务流程

平台将业务单据提交至薪福通OA进行审批，完整流程如下：

1. **拉取表单配置**：从OA获取审批表单的完整配置（控件列表、字段定义），缓存到本地
2. **配置字段映射**：将OA控件的 `uniqueName` 与平台本地业务字段建立映射关系
3. **组装审批数据**：根据映射关系，将本地业务数据转换为OA表单控件所需的 `formData` 格式
4. **发起审批流程**：调用OA发起流程v2接口，将 `formData` 提交至OA
5. **OA审批处理**：OA侧进行审批流转，平台不管理审批待办
6. **接收审批结果**：OA审批到达终态时，通过事件订阅回调通知平台
7. **更新业务状态**：平台根据回调结果更新本地审批实例和业务单据状态

### 1.2 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                       平台（HSPSI）                          │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ 表单配置服务  │  │ 审批出站服务  │  │ 审批回调入站服务   │  │
│  │ FormService  │  │ ApprovalSvc  │  │ CallbackService   │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬──────────┘  │
│         │                 │                    │             │
│  ┌──────┴─────────────────┴────────────────────┴──────────┐  │
│  │              XinfutongOaClient（基础请求层）              │  │
│  │         签名 / 加解密 / HTTP / assertSuccess            │  │
│  └────────────────────────┬───────────────────────────────┘  │
│                           │                                  │
│  ┌────────────────────────┴───────────────────────────────┐  │
│  │              数据库（4张表 + 字段映射策略）                │  │
│  └────────────────────────────────────────────────────────┘  │
└─────────────────────────────┬───────────────────────────────┘
                              │
                    薪福通OA开放平台API
```

### 1.3 设计原则

- **不改造现有业务表**：通过新增4张OA专用表实现对接
- **字段映射与取值逻辑分离**：mapping表只存 `uniqueName ↔ local_field` 映射，取值转换逻辑在代码策略模式中实现
- **幂等由代码层保证**：推送幂等通过分布式锁+状态机实现，回调幂等通过状态机判断

## 2. OA接口清单

### 2.1 出站接口（平台 → OA）

| 序号 | 接口名称 | 路径 | 方法 | 用途 | 服务实现 |
|------|---------|------|------|------|---------|
| 1 | 获取表单列表 | `/xft-oa/openapi/xft-oaquery/form/query-list` | POST | 按名称模糊查询表单列表 | `FormService.getFormList` |
| 2 | 获取表单配置信息 | `/xft-oa/openapi/xft-oaquery/form-config/query` | POST | 按formId/formKey查询表单配置（1.0旧版格式） | `FormService.getFormConfig` |
| 3 | 查询完整表单配置 | `/xft-oa/openapi/oa-gateway/api/open/form/inst/new-form-config-query` | POST | 按formKey查询2.0中间格式配置（**推荐使用**） | `FormService.getNewFormConfig` |
| 4 | 获取表单数据 | `/xft-oa/openapi/xft-oaquery/form-data/query-list` | POST | 按busKey/procInstId批量查询已提交的表单数据 | `FormService.getFormDataList` |
| 5 | 发起流程v2 | `/xft-oa/openapi/xft-newform/open/form-start` | POST | 提交formData发起审批流程 | `ApprovalService.startFormProcess` |
| 6 | 文件上传 | `/xft-oa/openapi/xft-oa/file/upload` | POST(form-data) | 上传附件/图片，获取objectKey用于formData | `ApprovalService.uploadFile` |

### 2.2 入站事件（OA → 平台）

| 事件编号 | 事件名称 | 触发时机 | 服务实现 |
|---------|---------|---------|---------|
| XFTOAFPS | OA审批流程结束事件 | 流程到达终态（PASSED/REJECTED/CANCELED/DELETED） | `ApprovalCallbackService.handleProcessFinishEvent` |

### 2.3 接口调用规范

- **认证方式**：SM2签名 + SM4加解密（加密应用），由 `XinfutongOaClient` 统一处理
- **凭证来源**：`hspsi_sys_account_set` 表，由 `XinfutongOaCredentialService` 提供
- **超时时间**：默认60秒
- **返回码校验**：`returnCode === 'SUC0000'` 表示成功
- **环境地址**：生产 `https://api.cmbchina.com`，测试 `https://api.cmburl.cn:8065`

### 2.4 关键接口详细说明

#### 2.4.1 获取表单列表

```
POST /xft-oa/openapi/xft-oaquery/form/query-list
Content-Type: application/json

请求参数：
  formName?: string  // 可选，表单名称（模糊查询）

响应 body：
  returnCode: string
  errorMsg: string
  body: Array<{       // 按分类分组的表单列表
    categoryId: string
    categoryName: string
    formInfoList: Array<{
      formId: string
      formKey: string
      formName: string
      ...
    }>
  }>
```

#### 2.4.2 查询完整表单配置（推荐）

```
POST /xft-oa/openapi/oa-gateway/api/open/form/inst/new-form-config-query
Content-Type: application/json

请求参数：
  formKey: string   // 必填，表单编码
  formId?: string   // 可选，表单id（与版本一一对应）

响应 body：
  returnCode: string
  errorMsg: string
  body: {
    formId: string
    formKey: string
    formConfig: string  // 2.0中间格式JSON字符串，需自行解析
  }
```

> **重要**：平台应使用此接口获取表单配置，返回的 `formConfig` 为2.0中间格式，与1.0格式结构不同。

#### 2.4.3 发起流程v2

```
POST /xft-oa/openapi/xft-newform/open/form-start
Content-Type: application/json

请求参数：
  formKey: string        // 必填，表单编码
  busKey?: string        // 可选（start时），restart时必填
  procStartType: string  // 必填，start|trialStart|restart
  formData: string       // 必填，JSON字符串（key为uniqueName，value为控件数据格式）
  starterId?: string     // 发起人id（后续会改为必填）
  starterOrgId?: string  // 发起人组织id（支持部门选择时必填）
  agentStarterId?: string // 代理发起人id（代理提单时必填）
  trialId?: string       // 试算id
  startParams?: string   // 发起人自选参数（试算组件发起时必填）

响应 body：
  returnCode: string
  errorMsg: string
  body: {
    formKey: string
    busKey: string
    procInstId: string     // 流程实例id，后续回调关联用
    procStatus: string     // RUNNING|BACKTOSTART|PASSED|CANCELED|REJECTED|DELETED|WITHDRAWN
    todoTaskList: TodoTask[]
  }
```

> **关键**：`formData` 必须使用OA控件的 `uniqueName` 作为key，value格式因控件类型而异（见第3节）。

#### 2.4.4 文件上传

```
POST /xft-oa/openapi/xft-oa/file/upload
Content-Type: multipart/form-data

请求参数：
  fileName: string    // 文件名（含扩展名，长度≤100）
  file: Buffer        // 文件内容

限制：
  - 文件大小：≤20MB
  - 允许格式：BMP/DAT/DOC/DOCX/PDF/XLS/XLSX/PPT/PPTX/JPG/PNG/GIF/ZIP等

响应 body：
  returnCode: string
  errorMsg: string
  body: {
    fileId: string      // 文件id
    objectKey: string   // 对象存储key（用于formData中的附件控件）
    fileUrl: string     // 下载链接（7天有效）
    fileType: string
    fileName: string
    fileSize: number
  }
```

#### 2.4.5 OA审批流程结束事件回调

```
事件编号：XFTOAFPS
触发条件：流程到达终态

回调报文：
  prjCod: string      // 企业号
  procStatus: string  // 终态：PASSED|REJECTED|CANCELED|DELETED
  busKey: string      // 业务编号
  procInstId: string  // 审批编号（流程实例id）
  procKey: string     // 流程Key
```

## 3. 表单控件数据格式速查表

OA表单2.0采用中间格式，每个控件由 `componentType` + `props`（含 `uniqueName`）定义。提交 `formData` 时，key为控件的 `uniqueName`，value格式因控件类型而异。

### 3.1 通用配置格式（所有控件props均包含）

```json
{
  "required": false,       // 是否必填
  "label": "控件标题",      // 控件名称
  "placeholder": "请输入",  // 输入提示
  "uniqueName": "abc123"   // 控件业务标识，表单内唯一
}
```

### 3.2 控件类型速查表

#### 文本类控件

| componentType | 说明 | formData值类型 | 数据格式示例 |
|--------------|------|---------------|-------------|
| FinInput | 单行文本 | `string` | `"文本内容"` |
| FinTextArea | 多行文本 | `string` | `"多行文本内容"` |
| FinEmail | 邮箱 | `string` | `"user@qq.com"` |
| FinIdentity | 身份证 | `string` | `"361023200003195692"` |
| FinBankCard | 银行卡号 | `string` | `"1324667596879435"` |
| FinPhone | 电话 | `object` | `{"type":"mobile","countryCode":"+86","number":"13214567324","areaCode":"1234"}` |
| FinAddress | 地址 | `object` | `{"value":["北京市","北京市","东城区"],"text":"北京市东城区","detail":"天天大酒店"}` |

#### 选项类控件

| componentType | 说明 | formData值类型 | 数据格式示例 |
|--------------|------|---------------|-------------|
| FinSingleSelect | 单选下拉 | `object` | `{"label":"选项1","value":"QkrzTSMhjEjX3dYv2TWw9"}` |
| FinMultiSelect | 多选下拉 | `array<object>` | `[{"label":"选项1","value":"xxx"},{"label":"选项2","value":"yyy"}]` |
| FinCascader | 多级下拉 | `array<object>` | `[{"label":"选项1","value":"选项1"},{"label":"选项1-1","value":"选项1-1"}]` |
| FinRadio | 平铺单选 | `object` | `{"label":"选项1","value":"QkrzTSMhjEjX3dYv2TWw9"}` |
| FinCheckbox | 平铺多选 | `array<object>` | `[{"label":"选项1","value":"xxx"},{"label":"选项2","value":"yyy"}]` |

> **选项控件关键说明**：
> - 配置中 `options[].value` 为控件内唯一标识，提交时需使用系统生成的value（如 `QkrzTSMhjEjX3dYv2TWw9`），非配置中自定义的 `option_0`
> - `FinCascader` 的value在配置和提交时均为文本值（如 `"选项1-1"`），非系统生成ID
> - `FinSingleSelect`/`FinRadio` 提交单个object，`FinMultiSelect`/`FinCheckbox` 提交object数组

#### 数值类控件

| componentType | 说明 | formData值类型 | 数据格式示例 |
|--------------|------|---------------|-------------|
| FinInputNumber | 数字 | `number` | `12345` |
| FinMoney | 金额 | `object` | `{"currency":"CNY","currencyId":"1","number":100}` |

#### 时间类控件

| componentType | 说明 | formData值类型 | 数据格式示例 |
|--------------|------|---------------|-------------|
| FinDatePicker | 日期选择 | `string` | `"2025-08-28"` |
| FinDateRange | 日期区间 | `object` | `{"from":"2025-08-27","to":"2025-08-29","duration":3}` |
| FinTimePicker | 时间 | `string` | `"19:24"` |

#### 布局类控件（无表单数据）

| componentType | 说明 | formData值类型 | 备注 |
|--------------|------|---------------|------|
| FinTable | 表格 | `array<object>` | 子控件数据平铺在每行object中 |
| FinBlockTitle | 标题 | 无 | 纯展示，无数据 |
| FinWordExplain | 描述信息 | 无 | 纯展示，无数据 |
| FinCard | 卡片 | 无 | 纯展示，无数据 |
| FinContainer | 容器 | 无 | 子控件数据平铺到formData顶层 |
| FinDivider | 分隔符 | 无 | 纯展示，无数据 |

#### 业务控件

| componentType | 说明 | formData值类型 | 关键字段 |
|--------------|------|---------------|---------|
| FinPeopleSelect | 人员选择 | `array<object>` | USRNAM(姓名), STFSEQ(staffId), USRNBR(memberId), ORGSEQ(部门id) |
| FinOrganSelect | 部门选择 | `array<object>` | ORGNAM(部门名), ORGSEQ(部门id), orgSeqPath(全路径) |
| FinJobSelect | 职位选择 | `array<object>` | PSTSEQ(职位id), PSTNAM(职位名), PSTCOD(职位编码) |
| FinPositionSelect | 岗位选择 | `array<object>` | PSTSEQ(岗位id), PSTNAM(岗位名), PSTCOD(岗位编码) |
| FinRankSelect | 职级选择 | `array<object>` | rankId(职级id), rankName(职级名), path(层级路径) |
| FinCostCenter | 成本中心 | `array<object>` | value(中心id), label(中心名) |
| FinCompany | 法人公司 | `array<object>` | value(公司id), label(公司名) |

> **人员选择控件关键说明**：
> - `STFSEQ` 对应OA的staffId，是人员标识的核心字段
> - `USRNBR` 对应OA的memberId
> - 平台通过 `staff.outer_ref_id` 关联OA人员，映射链路见第4节

#### 其他控件

| componentType | 说明 | formData值类型 | 数据格式示例 |
|--------------|------|---------------|-------------|
| FinImageUpload | 图片 | `array<object>` | `[{"id":"fileId","objectKey":"xxx","name":"图片.jpg"}]` |
| FinUpload | 附件 | `array<object>` | `[{"id":"fileId","objectKey":"xxx","name":"文件.xlsx"}]` |
| FinSignature | 签名 | `object` | `{"signId":"fileId"}` |
| FinCorrelateForm | 关联审批 | `array<object>` | `[{"businessKey":"FORM_xxx","title":"审批名称"}]` |
| FinCalculator | 计算器 | - | 根据配置自动计算 |

> **文件控件关键说明**：
> - 发起流程v2时，**不需要传 `fileToken`**，只需 `id` + `objectKey` + `name`
> - `id` 和 `objectKey` 通过文件上传接口获取
> - 查询已有表单数据时，返回的文件数据会包含 `fileToken`（用于下载/预览）

## 4. 数据库表设计

> 见：[OA审批对接数据库表设计](./OA审批对接数据库表设计.md)