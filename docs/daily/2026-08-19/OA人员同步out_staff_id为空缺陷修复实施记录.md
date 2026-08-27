# OA 人员同步 out_staff_id 为空缺陷修复实施记录（2026-08-19）

## 一、原始一级需求

OA 审批发起时，`FinPeopleSelect` 人员控件（领用申请「领用人」、库存调拨「发货人/接收人」等）要求 `out_staff_id`（OA staffId/STFSEQ）与 `outer_ref_id`（OA memberId/USRNBR）同时非空，否则报「人员尚未关联有效OA账号」。实测 `hspsi_basic_staff.out_staff_id` 全库 260 人全空，导致人员控件提交即失败。

## 二、根因

`XinfutongOaOrganizationService.getAllMembers()` 调用企业成员接口（`/xft-member/openapi/xft-member/member/page/by-condition`）时未传 `extFields`。生产实拉验证：

| extFields | 返回 `idRelation.staffId` | 返回 `post` |
|---|---|---|
| 不传（修复前） | ❌ | ❌ |
| `['position']` | ✅ | ✅ |
| `['historyId']` | ✅ | ❌ |
| `['org']` / `['personal']` | ❌ | ❌ |

同步代码 `sync.service.ts` 写 `out_staff_id = record.idRelation?.staffId ?? ''`，因 `idRelation` 从未被请求而恒取空，且同步 UPSERT 每次将 `out_staff_id`、`post_id` 覆盖为空。`post_id` 全 0 为同一根因（`post` 也依赖 `extFields`）。

## 三、修复内容

`apps/api/src/integrations/xinfutong-oa/organization/organization.service.ts` 的 `getAllMembers()` 增加缺省 `extFields`：

```ts
params.extFields = params.extFields ?? ['org', 'position'];
```

- `position`：同时返回 `idRelation.staffId`（→ `out_staff_id`）与 `post`（`post.id` → `post_id`，经 `hspsi_basic_position.outer_ref_id` 匹配）；
- `org`：返回组织详情（名称/idPath）；
- 调用方显式传入 `extFields` 时尊重调用方，仅缺省补齐；
- 类型 `MemberRecord` 已含 `idRelation`、`post` 字段，无需类型改动。

## 四、验证结果

修复后手动执行「薪福通OA组织同步」（等效任务手动触发），三账套同步成功。

### 1. out_staff_id / post_id 回填

| 账套 | 启用员工 | out_staff_id 回填 | post_id 回填 |
|---|---|---|---|
| 1 华溯集团 | 209 | 209/209（10 位 staffId） | 205/209 |
| 2 华溯生物科技 | 44 | 44/44（10 位 staffId） | 44/44 |
| 3 新华溯科技 | 7 | 7/7（镜像 memberId，见遗留） | 6/7 |

样例：账套1 吴琳娜 `out_staff_id=0000000006`、账套2 陈素泰 `out_staff_id=0000000001`。

### 2. post_id 仍为 0 的 5 人（OA 侧无岗位，非匹配失败）

实拉原始返回确认均为 `post: null`：账套1 王许洋(V0004)、张淑珍(V000E)、谭铁岩(V0075)、刘凯(V0077)；账套3 王许洋(W0001)。`post_id=0` 为正确结果。

### 3. 同人多账套身份不串（重点验证）

| 自然人 | 账套1 | 账套2 | 账套3 |
|---|---|---|---|
| 陈素泰（memberId 三账套均 U0000） | out_staff_id=0000000001, post=59, 主组织 CEO(0046) | out_staff_id=0000000001, post=240, 主组织 CEO(0019) | out_staff_id=U0000, post=252, 主组织 总经理(0005) |
| 苏碧安 | 0000000007, 财务部(0002) | 0000000038, 财务部(0003) | — |
| 王婷 | 0000000011, 财务部(0002) | 0000000037, 财务部(0003) | W0007, 财务部(0007) |

- 同一自然人多账套身份按 `hspsi_basic_staff` 幂等键 `(outer_ref_id, account_set_id)` 独立成行，各自 `out_staff_id`/`post_id`/主组织均取自对应账套，互不覆盖。
- 陈素泰账套1/2 的 `out_staff_id` 恰好相同（`0000000001`），实证「staffId 是账套内序列号、跨账套不唯一」；`resolvePerson` 按「本地主键 + account_set_id」经 `hspsi_sys_user_oa_staff` 定位，不依赖 OA 标识跨账套唯一，取值正确。
- 三表关联完整性核对通过：启用 260 人主组织(type=1) 缺失 0、多主 0；主组织 `outer_ref_id` 缺失 0；`sys_user_oa_staff` 孤儿身份 0、账套错配 0。

### 4. 其他

- API typecheck：无新增错误（既有 huasu-home/shifang-qingyuan spec 历史技术债除外）。
- 相关专项计划已同步更新：`docs/global/plans/OA账套维度表单映射改造计划-20260819.md`（§10 验证断言）。

## 五、遗留问题

1. 账套3（新华溯科技）OA 侧 `idRelation.staffId` 本身等于 `memberId`（如 `W0007`），且 `enterpriseId` 为 `AAC61415`，与账套1/2 不同。该账套已确认不接入 OA 审批，无当前影响；未来若接入需 OA 侧核对 `idRelation.staffId` 口径。
2. `getStaffList()`（员工花名册）接口未在同步链路使用；如 OA 侧 `idRelation.staffId` 缺失的账套需要接入，可评估以花名册 `staffSeq` 兜底。

## 六、Git

- 分支：`refactor/0819-split-generic-pages`
- 提交号：`f312c42`（fix(api): OA成员同步补extFields，回填out_staff_id与post_id）
