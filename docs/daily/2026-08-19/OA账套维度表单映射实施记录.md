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

## 四、遗留问题

1. 真实 OA 发起联调待 DEV 外网环境：账套1/2 各走一张单据确认 OA 侧表单渲染（尤其 `FinPeopleSelect` 人员控件，依赖已修复的 `out_staff_id`）。
2. 表单配置更新时机暂不处理（业务已确认先一次性填充）；重新填充后需调用 `OaFormMappingService.invalidate()` 清缓存。
3. 账套3 OA 侧 `idRelation.staffId` 等于 memberId（`AAC61415` 账套），已确认不接入，无当前影响。

## 五、Git

- 分支：`refactor/0819-split-generic-pages`
- 提交号：`d5d4542`（feat(api): OA表单映射改由DB按账套承载（OaFormMappingService））
