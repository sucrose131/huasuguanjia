# OA 账套维度表单映射实施记录（DB 表承载）（2026-08-19）

## 一、原始一级需求

OA 审批表单映射从硬编码常量改为按账套（`account_set_id`）由数据库承载：账套1（华溯集团）、账套2（华溯生物科技）各 11 张表单使用各自 `formKey` 与 `uniqueName`；账套3（新华溯科技）不接入，提交明确阻断。

业务确认结论（2026-08-19，见计划 §9）：复用现有 `hspsi_oa_form_template` + `hspsi_oa_form_field_mapping` 两张表；FinTable 子元素用方案 A（不改表）；formId 不参与发起；先一次性填充跑通推送。

## 二、完成内容

### 1. 数据填充（两张表）

- 来源：`docs/integrations/xinfutong-oa/return-result/form-configs/` 22 份 JSON（账套1、2 各 11 张）。
- 匹配策略：代码常量 `OA_FORM_MAPPINGS` 的字段声明顺序与 JSON 控件顺序（分层：顶层 + FinTable 子元素）逐一验证一致，按序映射 `local_field ↔ unique_name`。
- 结果：`hspsi_oa_form_template` 22 行（账套1/2 各 11），`hspsi_oa_form_field_mapping` 374 行（各 187）。
- 幂等：脚本先清空两张表再写入（表此前为空）。

### 2. 新增 `OaFormMappingService`

`apps/api/src/integrations/xinfutong-oa/form/form-mapping.service.ts`

- `getMapping(businessType, accountSetId)`：按 `(business_type, account_set_id)` 读 `field_mapping` + 关联 `template`，重建与 `OaFormMapping` 等价结构。
- child 标识从 `template.form_config` 推导（方案 A，不改表）：解析 `FinTable` children 的 `uniqueName` 集合。
- 进程内缓存（`businessType:accountSetId` 键）；`invalidate()` 供重新填充后调用。
- 兜底：DB 无映射且账套为 1 时降级到 `OA_FORM_MAPPINGS` 常量并告警；其余账套抛「该账套未配置OA审批表单」。
- 已注册到 `XinfutongOaModule`（providers + exports）。

### 3. 各业务服务切换为 DB 驱动

6 个 `*-oa-approval.service.ts` 从模块级 `OA_FORM_MAPPINGS.xxx` 常量改为 submit 时按单据账套动态读取：

| 文件 | 账套来源 |
|---|---|
| requisition-oa-approval.service.ts | 领用人 `hspsi_basic_staff.account_set_id` |
| purchase-oa-approval.service.ts | 所属组织 `hspsi_basic_organization.account_set_id` |
| purchase-return-oa-approval.service.ts | `OaStarterContextService.resolve()` |
| production-oa-approval.service.ts | `resolve()` |
| sales-oa-approval.service.ts | `resolve()` |
| inventory-oa-approval.service.ts | `resolve()` |

- 附件字段名、`formKey`、明细子字段名均改从 DB 映射读取。
- 相关 spec 同步更新（构造增加 mappingService mock，断言仍用账套1 常量映射）。

## 三、验证结果

| 验证项 | 结果 |
|---|---|
| API typecheck | 通过（无新增错误；既有 huasu-home/shifang-qingyuan spec 历史技术债除外） |
| 单元测试（6 个 spec） | 51/51 通过（form-mapping.constants、requisition、purchase、production、sales、inventory.service） |
| 数据回查 | template 22 行、field_mapping 374 行；账套2 领用申请 formKey=`AAC22502_…`、uniqueName 与落盘 JSON 一致 |
| getMapping 行为 | 账套1/2 各取各的 formKey+uniqueName；11 业务全通；child 标识正确（如领用申请 goodsName/quantity=true）；账套3 正确抛「该账套未配置OA审批表单」 |
| form_config 推导 | `collectFinTableChildUniqueNames` 解析 childSet 正确 |

真实 OA 发起（账套1/2 各提交一张单据到 OA 并确认流程创建、账套3 提交被拦截）需 DEV 外网环境执行，未在本机完成。

## 四、缺陷修复：领用申请跨账套错配兜底（2026-08-19 追加）

### 背景

核对「登录自动填登录人 → OA 员工映射」链路时发现：领用申请前端自动填 `applicantId = auth.user.staffId`（登录时的**主身份** staff_id，几乎总是账套1），后端 `buildSubmissionContext` 按 `hspsi_basic_staff.id` 直接查并用其 `account_set_id` 作为单据 OA 账套——多账套用户（如苏碧安：账套1 staff=6、账套2 staff=204）在账套2 组织创建领用申请时会用账套1 身份 + 账套1 表单发起，造成跨账套错配。单账套用户不受影响。采购/库存/生产/销售已按单据组织账套解析，无此问题。

### 修复（后端兜底，`requisition-oa-approval.service.ts`）

1. 账套以**单据所属组织**为准：`hspsi_draw_approve.org_id → hspsi_basic_organization.account_set_id`；
2. 提交人按 `(user_id, accountSetId)` 经 `hspsi_sys_user_oa_staff` 解析该账套员工身份；
3. 校验单据 `applicant_id === 解析出的 staff_id`，不一致抛「领用人与提交人OA身份不一致，请刷新页面重新选择领用人后提交」，不产生错误 OA 流程。

### 验证（真实多账套样本苏碧安 user_id=55）

| 场景 | 结果 |
|---|---|
| 账套1 组织(org1) + applicant_id=6（主身份） | ✅ 通过，用账套1 身份 V0006/0000000007 |
| 账套2 组织(org13) + applicant_id=6（前端错填主身份） | ✅ 正确拦截，提示应为账套2 身份 V0011/0000000038 |
| 账套2 组织(org13) + applicant_id=204（账套2 身份） | ✅ 通过 |

typecheck 无新增错误；requisition spec 4/4 通过。

### 遗留

- 前端仍自动填主身份 staff_id，多账套用户在其他账套组织下创建被拦截。**本日已由下述第五节「多账套按组织/部门匹配身份」补全。**

## 五、多账套用户按组织/部门匹配OA员工身份（2026-08-19 追加）

### 业务口径（业务确认）

- 用户选组织（授权组织范围）后，按「单据组织→账套」解析该用户在该账套的 OA 员工身份：找到则自动填写领用人（=登录用户，锁定）和部门（=该员工主部门），提交走该账套身份与表单（各账套各走各的 OA 流）；
- 找不到 → 可保存草稿（领用人/部门留空），提交被后端拦截；
- 部门有条件跟随：ORGSEQ 优先单据所选部门（须属于该员工，主/兼任），否则回退主部门。

### 实现

**后端**
- `RequisitionService.resolveApplicantIdentity(db, userId, orgId)`：orgId → 组织账套 → `hspsi_sys_user_oa_staff` → staff + 主部门；
- 新增 `GET /requisitions/current-applicant?orgId=`：返回 `{ found, staffId, name, accountSetId, outerRefId, outStaffId, deptId, deptName, deptOuterRefId }`；
- `saveApplication`：去掉 controller 注入主身份（`user.staffId`）；账套以单据组织为准；提交时解析不到身份报「当前账号未关联该组织的OA员工，无法提交审批」；草稿允许领用人/部门为空（`validateApplicationReferences` 放宽 `allowEmptyApplicant`）；编辑锁定组织（跨账套迁移禁止）；
- `applicationFormOptions` 改收前端 orgId（修复此前错用登录用户主身份组织的 bug）；
- `requisition-oa-approval.service` ORGSEQ 按「所选部门属于该员工则用，否则回退主部门」。

**前端** `RequisitionApplicationForm.vue`
- 组织下拉 = 用户授权组织（`auth.user.authorizedOrganizations`）；
- 选组织/创建时调 `current-applicant` 自动填领用人（disabled）+ 主部门；找不到则留空并提示，签名控件禁用，可保存草稿；
- validate：草稿不再强制领用人/部门；提交仍要求完整。

### 验证

- typecheck：API/Web 均无新增错误；
- 测试：requisition 两个 spec 17/17，OA 相关 63/63 通过；
- 真实数据（苏碧安 user_id=55）：

| 组织 | currentApplicant 结果 |
|---|---|
| 账套1 组织(org1) | found=true，staff=6、V0006/0000000007、财务部(0002) |
| 账套2 组织(org13) | found=true，staff=204、V0011/0000000038、财务部(0003) |
| 账套3 组织(org15) | found=false（无可用账套3身份） |
| 测试公司(org18，未关联账套) | found=false |

## 六、遗留问题

1. 真实 OA 发起联调待 DEV 外网环境：账套1/2 各走一张单据确认 OA 侧表单渲染（尤其 `FinPeopleSelect` 人员控件，依赖已修复的 `out_staff_id`）。
2. 表单配置更新时机暂不处理（业务已确认先一次性填充）；重新填充后需调用 `OaFormMappingService.invalidate()` 清缓存。
3. 账套3 OA 侧 `idRelation.staffId` 等于 memberId（`AAC61415` 账套），已确认不接入，无当前影响。
4. `/auth/switch-organization` 接口在当前分支不存在、前端无组织切换入口，与 08-17 文档记录不符，需业务确认。

## 七、Git

- 分支：`refactor/0819-split-generic-pages`
- 提交号：`d5d4542`（feat(api): OA表单映射改由DB按账套承载（OaFormMappingService））；`05e6eb3`（fix(api): 领用申请OA提交按单据组织账套解析提交人，拦截跨账套错配）；`d8cd8b1`（feat(api+web): 领用申请按单据组织账套匹配OA员工身份（多账套））
