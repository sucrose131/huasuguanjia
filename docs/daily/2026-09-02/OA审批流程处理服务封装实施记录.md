# OA 审批流程处理服务封装实施记录

日期：2026-09-02
关联：`docs/global/integrations/xft-oa/审批流程处理.md`、`docs/global/integrations/薪福通OA审批对接说明.md`

## 一、需求与范围

按薪福通「审批流程处理」接口，在现有审批出站服务中封装调用能力，供后续业务（例如从本系统撤销、退回、转派）使用。

本次范围：

- 封装出站方法，不新增本系统 HTTP 接口；
- 不改数据库、不改业务单据状态机、不改前端；
- 本地校验官方已明确的条件必填，再交给 `XinfutongOaClient` 签名发送。

## 二、接口映射

| 页面字段 | 业务含义 | API字段 | 数据库表 | 说明 |
| --- | --- | --- | --- | --- |
| 无（出站封装） | 审批人用户号 | `approverId` | 不写库 | OA 用户号 |
| 无 | 处理类型 | `operateType` | 不写库 | pass/submit/reject/transfer/addSign/back/cancel |
| 无 | 业务编号 | `busKey` | 已有审批实例 `bus_key` 可复用，本次不写 | 对应已发起流程 |
| 无 | 任务 id | `taskId` | 不写库 | 通过/提交/否决/转派/加签必填 |
| 无 | 审批意见 | `approveComment` | 不写库 | OA 开启必填校验时才必填 |
| 无 | 退回节点 | `backNodeId` | 不写库 | 退回必填 |
| 无 | 转派人 | `transferApproverId` | 不写库 | 转派必填 |
| 无 | 加签类型/加签人 | `addSignType` / `addSignApproverIdList` | 不写库 | 加签必填 |

## 三、改动

| 文件/对象 | 改动 |
| --- | --- |
| `apps/api/src/integrations/xinfutong-oa/approval/approval.types.ts` | 增加路径、处理类型、加签类型、请求/响应类型 |
| `apps/api/src/integrations/xinfutong-oa/approval/approval.service.ts` | 新增 `dealProcess`，按官方错误码做条件必填校验 |
| `apps/api/src/integrations/xinfutong-oa/approval/approval.service.spec.ts` | 新增参数校验与请求体组装单元测试 |
| `docs/global/integrations/薪福通OA审批对接说明.md` | 出站接口清单增加第 7 项，补充 2.4.5 说明 |
| `docs/global/architecture/HSPSI代码目录逐文件说明-20260827.md` | 补充流程处理文档与服务职责 |

## 四、验证

- `pnpm --filter @hspsi/api exec vitest run src/integrations/xinfutong-oa/approval/approval.service.spec.ts`
- 取消流程单元测试覆盖：不要求 taskId、可带审批意见、传入 taskId 仍保持 `operateType=cancel`。
- 真实取消用例写在 `RUN_EXTERNAL_INTEGRATION_TESTS=true` 下：直接对已有流程调用 `dealProcess(cancel)`，不重新发起；默认跳过。

## 五、遗留

1. `picAttachmentList` / `fileAttachmentList` 官方文档未展开元素结构，当前按发起流程附件控件使用 `{id, objectKey, name}`；若实调结构不同再对齐。
2. 退回节点 id 需另接「可退回节点查询」接口，本次未封装。
3. 采购申请创建人终止/撤回已调用 `dealProcess(cancel)`；其它单据的主动撤销仍未接入。
