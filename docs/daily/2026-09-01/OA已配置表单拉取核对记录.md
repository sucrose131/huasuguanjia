# OA 已配置表单拉取核对记录（2026-09-01）

日期：2026-09-01
操作：只读拉取薪福通 OA 三个账套的已配置表单（列表 + 完整配置），与本地 `hspsi_oa_form_template` / `hspsi_oa_form_field_mapping` 核对。

## 一、拉取方式

- 新增临时工具 `apps/api/src/scripts/pull-oa-forms.ts`（只读，不发起任何审批）：
  - 遍历 `hspsi_sys_account_set` 全部启用账套；
  - `getFormList` 拉取全部分类与表单列表；
  - 对名称含「华溯管家」的表单 `getNewFormConfig` 拉取新版中间格式完整配置；
- 结果落盘：`docs/integrations/xinfutong-oa/return-result/2026-09-01/`
  - `form-list-acct1/2/3.json`（各账套全量表单列表）
  - `new-form-config-acct1|2-华溯管家-*.json`（22 份）
  - `summary.json`（汇总报告）

## 二、拉取结果

| 账套 | 组织 | 分类数 | 表单总数 | 华溯管家业务表单 |
| --- | --- | --- | --- | --- |
| 1 | 华溯集团 | 24 | 55 | 11 张全部启用（A） |
| 2 | 华溯生物科技 | 12 | 48 | 11 张全部启用（A） |
| 3 | 新华溯科技 | 5 | 12 | 0 张业务表单（有 2 张「审批流测试」在「华溯管家-审批」分类，状态 A） |

账套 1、2 的 11 张业务表单与 `OA_FORM_MAPPINGS` / DB 模板逐一对应：领用申请、采购申请、采购退货、库存调拨、库存调整、库存盘点、库存报损、盘亏出库、盘盈入库、生产计划、折价销售单。

## 三、与本地 DB 核对结论

逐表单比对 `form_key`、`form_id`、控件级配置（componentType / uniqueName / required / label，含 FinTable 子元素）：

| 维度 | 结果 |
| --- | --- |
| formKey | 22/22 一致（发起审批依赖，无影响） |
| 控件级配置（uniqueName/类型/必填/标签） | 22/22 完全一致（字段映射无影响） |
| formId（版本标识） | 22/22 变化（OA 侧重新发布过新版本） |

影响评估：

1. **发起审批：无影响**。`approval.service.ts` 发起只使用 `formKey` + 各控件的 `uniqueName`，均未变化；
2. **字段映射：无影响**。`hspsi_oa_form_field_mapping` 的 uniqueName 与 OA 最新配置一一对应；
3. **formId 变化：无当前影响**。生产代码没有按 formId 发起或查询（formId 仅作为映射中的版本标识；按 formId 查询历史表单数据的场景暂无调用）。若后续需要按新版本查询历史表单数据，可同步更新 DB `hspsi_oa_form_template.form_id`（本次未改）。

## 四、账套 3 情况

账套 3（新华溯科技）此前记录为"不接入"；本次发现其「华溯管家-审批」分类下已有 2 张「审批流测试」表单（`AAC61415_NFORM_377236946232934401`、`AAC61415_NFORM_383916069210030081`，状态 A），非业务表单。本地无对应模板，无影响；如后续要接入账套 3 需另行业务确认。

## 五、遗留

- `apps/api/src/scripts/pull-oa-forms.ts` 为临时工具，未提交；如需保留为可复用拉取脚本（后续表单变更时复跑并刷新映射），可另行提交。
- 未更新 DB `form_id`（无业务影响）；如需刷新版本标识可执行一次 `form_id` 同步。
