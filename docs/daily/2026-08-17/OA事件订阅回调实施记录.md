# OA 事件订阅回调实施记录（2026-08-17）

## 一、原始一级需求

薪福通 OA 审批结果通过事件订阅回传华溯管家。回调地址必须是通用事件入口，不能写死某个事件编号；接收后按官方事件订阅协议验签、解密，并在 3 秒内按约定报文体返回。

## 二、本次完成内容

- 将接收地址从 `POST /api/integrations/xinfutong-oa/events/XFTOAFPS` 改为统一入口 `POST /api/integrations/xinfutong-oa/events`；旧路径仍兼容。
- 连接测试事件 `XFT00000` 不验签、不写回调日志，立即返回 `{ "rtnCod": "200", "errMsg": "" }`。
- 正式事件对 `eventId`、`prjCod`、`eventTime`、`eventCd` 做 SM2 验签；`eventRcdInf` 使用事件公钥前 32 位 hex 做 SM4 解密。
- 验签公钥走环境变量 `XINFUTONG_OA_EVENT_PUBLIC_KEY`（配置回调 URL 后由薪福通生成，130 位 hex），未新增数据库字段。
- 已同步到 `.env.example` 和 `deploy/docker/.env.example`。
- 成功回包为 `{ "rtnCod": "200", "errMsg": "" }`；验签失败为 `{ "rtnCod": "001", "errMsg": "验签失败" }`。该回包不走本系统默认 `{ code, data }` 包装。
- `XFTOAFPS` 解密后仍按原业务类型分发领用、采购、库存、生产、销售审批结果。
- 未改表结构、未改业务字段含义。

## 三、字段 / API / 数据库映射

| 页面字段 | 业务含义 | API字段 | 数据库表 | 数据库字段 | 必填/默认值 | 写入时机 |
| --- | --- | --- | --- | --- | --- | --- |
| 无页面 | 事件编号 | eventId | hspsi_oa_approval_callback_log | event_code | 正式事件必填 | 收到正式事件时 |
| 无页面 | 企业号 | prjCod | hspsi_oa_approval_callback_log | prj_cod | 可空 | 收到正式事件时 |
| 无页面 | 事件业务码 | businessKey | hspsi_oa_approval_callback_log | bus_key | 可空，后续由业务回填 busKey | 收到正式事件时 |
| 无页面 | 原始信封 | body | hspsi_oa_approval_callback_log | raw_payload | 必填 | 收到正式事件时 |
| 无页面 | 流程终态 | eventRcdInf.procStatus | hspsi_oa_approval_callback_log / hspsi_oa_approval_instance | proc_status | XFTOAFPS 必填 | 验签解密并处理成功后 |
| 无页面 | 验签公钥 | XINFUTONG_OA_EVENT_PUBLIC_KEY | 不写数据库 | — | 正式事件必填 | 仅环境配置 |

## 四、验证结果

| 验证项 | 结果 |
| --- | --- |
| 连接测试事件回包 | 自动化通过 |
| SM2 验签 + SM4 解密 | 自动化通过 |
| eventCd Long 精度保留 | 自动化通过 |
| XFTOAFPS 业务分发 | 自动化通过 |
| 验签失败 rtnCod=001 | 自动化通过 |
| 成功回包不被 API 包装 | 自动化通过 |

## 五、当前状态

**状态：代码完成待验收。**

部署后需在薪福通开发者后台把事件订阅 URL 改为统一入口，并填写生成的接口鉴权公钥到 `XINFUTONG_OA_EVENT_PUBLIC_KEY`。未配置公钥时，连接测试可通过，正式事件会验签失败。

## 六、遗留问题

- 业务处理失败仍返回 HTTP 500，以便薪福通最多重试 3 次；成功和验签失败返回 HTTP 200。
- Git 提交号待授权提交后回填。
