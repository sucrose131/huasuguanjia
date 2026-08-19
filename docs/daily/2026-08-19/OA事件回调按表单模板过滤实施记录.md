# OA 事件回调按表单模板过滤实施记录（2026-08-19）

## 一、原始一级需求

薪福通 OA 事件订阅会推送该应用下全部表单的流程结束通知。华溯管家只处理 `hspsi_oa_form_template` 中已配置的审批表单，其它表单验签解密后忽略并成功回包，避免落入领用申请等业务处理。

## 二、本次完成内容

- 解密后的 `procKey` 实测为 `FORM_` + 表单 `form_key`（如 `FORM_AAC15400_NFORM_380014832305831937`）；代码用去掉 `FORM_` 前缀的值作为 `form_key`。
- `XFTOAFPS` 验签解密后，按当前账套（`appId` → `account_set_id`）查询 `hspsi_oa_form_template`；未命中则写回调日志「非本系统表单，已忽略」，返回 `{ "rtnCod": "200", "errMsg": "" }`，不进入业务分发。
- 命中模板的回调仍按原 `hspsi_oa_approval_instance.business_type` 分发领用、采购、库存、生产、销售。
- 去掉回调入口中用于本地解密排查的硬编码报文和提前回包。

## 三、字段 / API / 数据库映射

| 页面字段 | 业务含义 | API字段 | 数据库表 | 数据库字段 | 必填/默认值 | 写入时机 |
| --- | --- | --- | --- | --- | --- | --- |
| 无页面 | 流程 Key | eventRcdInf.procKey | hspsi_oa_approval_callback_log | proc_key | XFTOAFPS 必填 | 解密后 |
| 无页面 | 表单编码 | procKey 去掉 FORM_ | hspsi_oa_form_template | form_key | 仅处理表内已启用行 | 过滤是否进入业务处理时 |
| 无页面 | 账套 | 外层 appId | hspsi_oa_form_template / hspsi_oa_approval_callback_log | account_set_id | 正式事件必填 | 验签后 |
| 无页面 | 忽略原因 | — | hspsi_oa_approval_callback_log | process_result | 非本系统表单，已忽略：{form_key} | 模板未命中时 |

无界面变更；不新增表或字段。

## 四、验证结果

| 验证项 | 结果 |
| --- | --- |
| procKey 去掉 FORM_ 得到 form_key | 自动化通过 |
| 模板命中后仍按业务类型分发 | 自动化通过 |
| 模板未命中成功回包且不分发 | 自动化通过 |
| 连接测试 / 验签失败行为不变 | 自动化通过 |

## 五、当前状态

**状态：代码完成待验收。**

## 六、遗留问题

- Git 提交号待授权提交后回填。
