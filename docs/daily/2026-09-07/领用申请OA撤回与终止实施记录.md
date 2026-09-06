# 领用申请（借用/OA 渠道）撤回与终止 实施记录

日期：2026-09-07
对应需求/一级需求：领用申请 OA 审批主动撤销（撤回/终止），与采购申请对齐
对应全局文档：`docs/global/plans/领用申请OA撤回与终止/实施构想.md`
代码分支：`feature/0907-requisition-oa-withdraw-terminate`（基于与远端一致的 master `b8ab15c`）

## 需求确认（业务负责人拍板 A1–F，2026-09-07）

A1 双入口照搬（撤回+终止）；A2 允许对 OA 审批中借用单撤回/终止；A3 状态口径与采购一致（共用展示字典）；A4 撤回回草稿可改可重提、重提重发 OA，与采购一致；A5 留痕沿用；B1 追回复用驳回路径；B2 撤回与终止都追回，但撤回后同单据再次发起 OA 审批即撤销已生成的待确认退回单；C1 仅领用人可操作；C3 组织/账套校验沿用采购实现；D1 同驳回清/重建待办；D2 统计口径沿用采购（可沿用）；D3 字典与展示沿用采购（可沿用）；E 竞态容错沿用采购；F 本期只做 OA 渠道（借用单）。

## 交付项

### 1. 后端：领用申请撤回/终止 + OA 主动撤销

- 做了什么：
  - `RequisitionOaApprovalService.cancelRemoteProcess`：以领用人账套内 OA 身份调用薪福通 `dealProcess(cancel)`（busKey 定位，cancel 无需 taskId）；账套未启用/领用人无有效 OA 账号分别报错；OA 已撤销视为成功（幂等重试），其余失败抛"撤销OA审批失败：原因"。
  - `RequisitionService` 新增 `withdrawApplication` / `terminateApplication` / `submitApplicationToOa` 及私有编排：事务外先撤 OA（PENDING_PUSH 拦截、RUNNING/BACKTOSTART 才撤），事务内行锁二次校验后落账（撤回→草稿 0/0；终止→3），关闭 `draw_approve` 待办，直接领用已出库则自动生成待确认退回单（`exit_reson`/`relation_kind` 区分 `withdraw_return`/`terminate_return`，复用 `ensureRejectedDirectOutputReturn`，参数化原因与关系类型），OA 实例置 `CANCELED`。
  - 权限 C1：`assertApplicantCanAction` 用单据 org 账套解析操作人 OA 员工身份，必须等于单据领用人 `applicant_id`；仅 `draw_type=2`；仅审批中（status1/approve0）。
  - B2：`saveApplication` 提交 OA 成功与 `/submit-oa`（改走 service）成功后释放 `relation_kind='withdraw_return'` 且 `comfirm_status=0` 的退回单（软删+文档链移除）。
  - 回调 `handleOaApprovalResult`：`PASSED→1 / CANCELED→3 / REJECTED·DELETED→2`；新增 `withdrawnLocally` 判重（撤回草稿不被 OA 取消回调覆盖）；OA 取消回调同终止做直接出库追回与待办关闭。
  - 编辑/删除守卫补充：`approve_status=3` 不可修改、不可删除。
- 影响：`apps/api/src/requisition/requisition.service.ts`、`requisition.controller.ts`、`requisition-oa-approval.service.ts`；路由 `POST /requisitions/applications/:id/withdraw|terminate`（`@RequirePermissions('requisitions')`）；`submit-oa` 行为不变但改走 service（附加 B2）。
- 验证：`requisition.service.spec.ts` 44 项（新增撤回/终止/拒绝/直接出库追回/B2/回调对齐 12 项）、`requisition-oa-approval.service.spec.ts` 12 项（新增 cancelRemoteProcess 5 项）、`requisition-oa-callback.controller.spec.ts` 13 项，全部通过。
- 状态：代码完成待验收。

### 2. 前端：行操作按钮与统计

- 做了什么：`requisition-application.ts` 新增"撤回/终止"行操作（条件：当前用户 staffId=领用人 && drawType=2 && status=1 && approveStatus=0，确认弹窗 + toast）；页面顶部新增与采购一致的 summaryLabels（申请单总数/待审批/已审批）。
- 影响页面：领用申请单列表页（`/requisitions/applications`）。
- 验证：`requisition-application.spec.ts` 3 项、`approval-status.spec.ts` 4 项通过；vue-tsc 0 错误。
- 状态：代码完成待验收。

### 3. 列表统计口径（D2）

- 做了什么：`applications` 列表返回 `summary:{total,pending,complete}`（pending=approve0 且 status1，complete=approve1；驳回/取消不进桶，与采购一致）。
- 验证：随服务层单测覆盖（列表 shape 未单测，口径与采购代码一致）。
- 状态：代码完成待验收。

### 4. 数据库变更（迁移脚本，尚未执行）

- 做了什么：`database/migrations/20260907_requisition_application_withdraw_terminate.sql`：菜单操作权限 `requisitions:applications:withdraw/terminate`（type 3，挂 `requisitions:applications` 页面，排序 55/56）并授权角色 admin、oa-staff-applicant（沿用采购先例）；`requisition_approval_status` 字典补 value=3 '已取消'（`approval_status` 防御性同补）。
- 影响：菜单权限表、字典表。
- 验证：SQL 未在本地/目标数据库执行（本地无 mysql 客户端；执行后菜单按钮与字典 3 才生效）。
- 状态：待执行（需在目标环境按迁移流程执行并验证）。

## 验证结果汇总

- API 类型检查：requisition 相关 0 错误；全量仅剩既有 integrations 外部同步 spec 类型错误（历史遗留，与本次无关）。
- Web 类型检查（vue-tsc）：0 错误。
- 自动化：领用模块 69 项全绿；API 全量 588 项通过，失败项仅为 huasu-home "真实请求"集成测试与偶发超时（历史/环境性，未触碰）。
- Git 提交号：代码提交 `794fb96`（含迁移脚本）；本记录文件提交见 `git log`（跟随本提交）。

## 遗留问题

1. 数据库迁移脚本未执行（目标环境执行后：按钮菜单权限、审批状态字典 value=3 生效）；角色授权清单（admin、oa-staff-applicant）如需扩展请业务确认后在脚本追加。
2. 浏览器端到端验收未做（按钮可见性、追回退回单、B2 重提撤销、OA 取消渠道文案、统计口径），验收通过前状态为"代码完成待验收"。
3. 全量 API 单测的 huasu-home 真实请求失败/偶发超时为既有环境问题。
