# 采购申请正式表单 OA 映射更新实施记录（2026-09-02）

日期：2026-09-02
分支：dev-0901-latest
关联：`docs/daily/2026-09-02/采购申请OA表单字段映射对齐实施记录.md`（Test 表单对齐）、OA 正式表单拉取归档（return-result/2026-09-02）

## 一、背景与确认

- 拉取 OA 正式表单（华溯管家-采购申请）确认：**生产侧正式表单也已发布为新结构**（承办部门/成本承担组织/目标仓库/收货人/申请原因/备注/附件/采购明细），两账套均已重新发布（formId 更新）。
- 正式表单与 Test 表单的 承办部门/成本承担组织/申请原因 三个控件 uniqueName **不同**（Test 为复制新建），映射必须按表单各自维护。
- 本次更新"正式映射"：代码常量（账套1 正式兜底注册表）+ 生产 DB 幂等补丁（账套1/2），并同步本地库（当前本地已注册正式 formKey，acct1 映射曾为空）。

## 二、改动

| 对象 | 内容 |
| --- | --- |
| `form-mapping.constants.ts`（purchase_application） | 更新为正式表单新结构：deptName→`np0kahtk2860`、costOrgName→`dhi6d3c7oecn`、receiver→`jg2zwug75y3c`、reason→`zq6glso6x8co`（FinTextArea）、移除 source；formId 更新为 `384157596683534338` |
| `purchase-oa-approval.service.spec.ts` | 常量 mock 用例断言同步为新结构 formData |
| `database/migrations/20260902_purchase_application_formal_oa_mapping.sql` | 幂等生产补丁：按 (account_set_id, form_key=正式) 定位模板，更新 form_id，重建 field_mapping 13 行（账套1/2）；模板不存在时整段无操作 |
| 本地库 | 已执行补丁：acct1/acct2 purchase_application 模板 form_id 更新、field_mapping 各 13 行（新结构） |

## 三、正式表单字段映射（账套1 示例，账套2 uniqueName 见补丁）

| local_field | 账套1 uniqueName | OA 控件 |
| --- | --- | --- |
| deptName | `np0kahtk2860` | 承办部门 |
| costOrgName | `dhi6d3c7oecn` | 成本承担组织 |
| warehouse / receiver / reason / remark / attachments / details+5子控件 | 与 Test 一致（warehouse/receiver/remark/attachments/details）或新（reason=`zq6glso6x8co`） | 目标仓库/收货人/申请原因/备注/附件/采购明细 |

## 四、验证

- 本地库补丁执行：acct1/acct2 模板 form_id 更新为最新、field_mapping 各 13 行；重跑幂等无副作用（exit 0）。
- `getMapping` 实读：acct1/acct2 purchase_application = 正式 formKey + 最新 formId + 13 字段。
- 测试：purchase-oa-approval 4 项、form-mapping.constants 4 项全过；类型检查无新增错误。
- 归档：正式表单完整配置存 `docs/integrations/xinfutong-oa/return-result/2026-09-02/`（该目录在 .gitignore，不入库）。

## 五、遗留

1. 其余 10 种业务表单的正式表单同样可能已随 OA 发布新版本（本次仅采购申请拉取核对）；如需更新需逐张拉取对照。
2. 生产环境执行：跑 `database/migrations/20260902_purchase_application_formal_oa_mapping.sql` 后，生产 OA 采购申请提交即按新结构填写；旧在途单据不受影响。
3. 模板 form_config 未重写（明细 FinTable 及子控件未变，childSet 推导不受影响）；如需完整同步可从归档 JSON 更新。
