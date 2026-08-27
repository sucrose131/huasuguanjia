# 外部订单出库过账键改用出库单 ID 实施记录（2026-08-21）

## 一、需求

同步外部订单出库时，库存过账幂等键原先读取外部订单 ID / 发货单 ID（无发货记录时为共享 `ALL`），而不是本次生成的出库数据 ID。不同订单出同一仓库、同一 SKU 时撞 `uk_inventory_posting_key`，报「该业务明细已经完成库存过账」，整单回滚，部分订单无法过账。

## 二、范围

- **本次**：华溯普通单、会议门票、分期单，以及十方清源订单的出库过账幂等键，改为绑定本平台出库单主键 `so_output_id`。
- **不改**：出库单 `remark` 仍用 `HH-SHIP-` / `SFQY-SHIP-` 防重复生成出库单；退货过账键、表结构、字典、页面。
- **兼容**：历史已用旧键过账的流水保留；失败单再次同步会走新键，可完成过账。

不新增表或字段。

## 三、影响

| 页面/接口/数据 | 变化 |
| --- | --- |
| 华溯之家 / 十方清源订单同步出库过账 | `idempotencyKey` 从外部订单/发货单/`ALL` 改为 `huasu-home-output:{so_output_id}:v1` 或 `shifang-qingyuan-output:{so_output_id}:v1` |
| `hspsi_inventory_total_detail.posting_key` | 新出库流水按出库单 ID 区分 |
| `hspsi_inventory_total_detail.source_id` | 仍为出库单 `so_output_id`（与平台销售出库一致） |

## 四、验证

| 项 | 结果 |
| --- | --- |
| `order-sync.unit.spec`（华溯之家） | 21 项通过，含「已发货过账键使用出库单 ID、不含外部订单 ID / ALL」 |
| `conference-order-sync.unit.spec` | 11 项通过，过账键为 `huasu-home-output:8001:v1`，不含门票订单 ID |
| `installment-order-sync.unit.spec` | 13 项通过，过账键为出库单 ID |
| `order-sync.unit.spec`（十方清源） | 15 项通过，过账键为 `shifang-qingyuan-output:8001:v1` |
| 合计 | 4 个文件 60 项通过 |

## 五、状态

代码完成待验收。未提交 Git。

## 六、主要文件

- `apps/api/src/integrations/huasu-home/sync/order-sync.service.ts`
- `apps/api/src/integrations/huasu-home/sync/conference-order-sync.service.ts`
- `apps/api/src/integrations/huasu-home/sync/installment-order-sync.service.ts`
- `apps/api/src/integrations/shifang-qingyuan/sync/order-sync.service.ts`
- `docs/global/integrations/huasu-home/订单同步.md`
- `docs/global/integrations/shifang-qingyuan/订单同步.md`
