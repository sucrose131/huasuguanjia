# 领用 SKU 可指定与出库库存校验修复实施记录

> 日期：2026-09-04
> 现象：① 领用时无法指定商品对应 SKU，被锁死成默认/第一个规格；② 库存明明够数，确认出库单 DRO20260903000005 却报"批次库存不足"。
> Git 提交：feature=`378ead1`，test=`95f22d2`

## 根因
- 前端 `RequisitionApplicationForm` 与 `RequisitionOutputForm` 的 `lineGoodsChanged` 都把 SKU 强制成 `isDefault===1 ?? 第一个`，SKU 列只读不可改。
- 后端 `saveOutput` 强制 `skuId = source.sku_id`（忽略前端所选），`confirmOutput` 又校验 `source.sku_id === detail.sku_id`，并按 `detail.sku_id + batch` 过账。
- 实测 DRO20260903000005：仓库 23 中 goods_id=6 的 500 件库存挂在 **SKU 760**，而单据锁的是默认 **SKU 6** → 过账查 (goods6, sku6, 仓库23) 无库存 → 报批次不足。

## 交付
| 文件 | 改动 |
| --- | --- |
| `RequisitionApplicationForm.vue` | SKU 列改为可选下拉（商品全部 SKU），`lineGoodsChanged` 生成 `skuOptions` 并默认回显；`lineSkuChanged` 更新规格/单位并清空意向批号；校验有商品的明细必须已选规格 |
| `RequisitionOutputForm.vue` | 新增 `fillSkuOptions`（按商品+当前仓库标注缺货）、`lineSkuChanged`；SKU 列可选（直接出库默认选有库存规格；来源申请出库可切换同商品其他规格）；切换 SKU 清空批号/库存选择；批次下拉改为按 商品+SKU+仓库 过滤，label 带规格 |
| `requisition.service.ts` | `saveOutput` 采用所选 SKU（缺省回退申请 SKU）并校验所选 SKU 属于同一商品；`confirmOutput` 一致性校验放宽为仅校验商品一致，过账按出库明细实际 SKU+批次 |

## 验证
- API 非集成 typecheck 0 错误；`vitest run src/requisition` 50 项全绿。
- web vue-tsc 0 错误；web vitest 92 项全绿。

## 状态与遗留
- 状态：代码完成，待浏览器验收。
- 存量处理：DRO20260903000005 仍是未确认草稿，可直接重编辑——SKU 选 760、批次选 PH20260831，保存后确认出库即可；已确认单据需按现有退回流程处理，不做数据改写。
- 口径：出库允许实际 SKU 与申请 SKU 不同但必须同商品（本次问题即因锁死导致）；申请"意向批号"仍为自由文本、不按 SKU 联动（未扩大范围）。
