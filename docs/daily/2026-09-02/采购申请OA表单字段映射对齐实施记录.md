# 采购申请 OA 表单字段映射对齐实施记录（账套1 新 Test 表单结构）

日期：2026-09-02
关联：`docs/daily/2026-09-01/OA采购申请Test表单调整对照记录.md`（此前"先不改，仅报告"，本次落实）

## 一、需求与确认

- 账套1 Test-采购申请 在 OA 侧调整为：**承办部门 / 成本承担组织 / 目标仓库 / 收货人 / 申请原因 / 备注 / 附件 / 采购明细**（新增 2 控件、改名 2 控件，唯一标识 uniqueName 与明细子控件不变）。
- 账套2 Test-采购申请 仍为旧结构（采购原因 / 目标仓库 / 业务来源 / 备注 / 附件 / 采购明细）。
- 本次把采购申请单据字段与 OA 映射对齐：账套1 按新结构填写，账套2 维持旧结构（其 OA 表单未调整，若需同构需先调整 OA）。

## 二、字段映射（账套1 新结构）

| local_field（单据字段） | unique_name（OA 控件） | 数据来源 |
| --- | --- | --- |
| deptName | `dhi6d3c7oecn` 承办部门 | 申请部门 `dept_id` → 部门名 |
| costOrgName | `kpiw89hn1sqh` 成本承担组织 | 成本承担组织 `org_id` → 组织名 |
| warehouse | `iluym6g473ox` 目标仓库 | 仓库名（原映射不变） |
| receiver | `jg2zwug75y3c` 收货人 | 收货人 `receiver_id` → 系统用户名（原 source 控件更名） |
| reason | `xi5us0dyak0j` 申请原因 | `pur_reson`（原指向 dhi6d3c7oecn 错位，本次修正） |
| remark / attachments / details + 5 子控件 | 不变 | 不变 |

- `source`（业务来源）：账套1 新表单已无对应控件，**移除账套1 映射**；账套2 保留（其表单仍有）。

## 三、改动

| 文件/对象 | 改动 |
| --- | --- |
| `hspsi_oa_form_field_mapping`（账套1 purchase_application，template_id=24） | reason→`xi5us0dyak0j`（FinTextArea）；source 行改 local_field=`receiver`、label=收货人；新增 deptName→`dhi6d3c7oecn`、costOrgName→`kpiw89hn1sqh`；sort_order 按 OA 控件顺序重排 1–13 |
| `apps/api/src/purchase/purchase-oa-approval.service.ts` | `buildContext` 增加成本承担组织名/申请部门名/收货人名查询；formData 改为**按映射动态组装**（映射缺失的字段跳过），账套1 发新字段、账套2 发旧字段 |
| `apps/api/src/purchase/purchase-oa-approval.service.spec.ts` | fixture 补 dept/user 查询 mock 与 receiver/oa_org 字段；新增"新结构映射"用例断言 承办部门/成本承担组织/收货人/申请原因 正确落位 |

- 代码常量 `OA_FORM_MAPPINGS` 未改（仅账套1 DB 缺失时的兜底，保持生产表单旧结构，避免影响生产兜底路径）。

## 四、验证

- `getMapping` 实读：账套1 返回 13 字段新结构（Test formKey），账套2 返回 11 字段旧结构（Test formKey）。
- 测试：`purchase-oa-approval.service.spec.ts` 4 项（含新结构映射断言）全过；purchase/attachments/requisition 共 113 项全过；API 类型检查非 integrations 0 错误。
- 未发起真实 OA 审批（避免污染 OA）。

## 五、遗留

1. 账套2 若需与账套1 同构（承办部门/成本承担组织/收货人），需先在 OA 调整账套2 Test-采购申请，再按本记录流程更新账套2 映射。
2. 生产表单（华溯管家-采购申请）如需同样调整，需 OA 侧变更后另行核对与映射。
3. 常量兜底仍为生产旧结构；测试环境账套1 DB 映射缺失时兜底会指向旧结构（既有风险，见 09-01 切换记录）。
