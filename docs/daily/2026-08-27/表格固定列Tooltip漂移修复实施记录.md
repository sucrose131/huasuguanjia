# 表格固定列 Tooltip 漂移修复实施记录

> 日期：2026-08-27
> 分支：`fix/0827-table-tooltip-offset`（基于 `dev`）
> 类型：影响用户操作的界面缺陷修复（业务已确认范围）
> 当前状态：代码完成，验证通过，待提交（未推送）

## 一、问题描述

基础资料—客户页面中，鼠标悬浮「所属组织」等列时，`show-overflow-tooltip` 的悬浮提示与列头错位、提示信息漂移。

## 二、根因

- `el-table` 原生 `show-overflow-tooltip` 在表格**存在 `fixed` 固定列**时，固定列是独立渲染的覆盖层（`.el-table__fixed`），浮层定位所用单元格坐标与主表体叠加后产生水平偏移（偏移量≈左侧固定列宽度，并随横向滚动变化）。这是 Element Plus 的已知问题，当前实际安装版本 2.14.3 仍存在。
- 受影响表格的共同特征：**固定列 + `show-overflow-tooltip` 同时存在**。

## 三、排查结果（同样写法的位置，共 12 处）

| 文件 | 位置 |
| --- | --- |
| `apps/web/src/views/business/BusinessDocumentPage.vue` | 共享引擎：所有业务单据列表页（采购/库存/生产/销售/领用） |
| `apps/web/src/views/ResourcePage.vue` | 基础资料全部列表（客户/公司/部门/岗位/员工/供应商/仓库/单位） |
| `apps/web/src/views/GoodsPage.vue` | 商品列表 |
| `apps/web/src/views/CategoriesPage.vue` | 商品分类列表 |
| `apps/web/src/views/PropertiesPage.vue` | 属性列表 |
| `apps/web/src/views/SystemPage.vue` | 系统管理（用户表：岗位/所属角色/数据访问组织） |
| `apps/web/src/views/ScheduledTaskPanel.vue` | 定时任务列表与执行记录 |
| `apps/web/src/views/business/InventoryStockPage.vue` | 库存台账（备注） |
| `apps/web/src/components/purchase/PurchaseApplicationOrderPreviewDialog.vue` | 采购申请拆单预览弹窗 |
| `apps/web/src/components/inventory/InventoryCheckTable.vue` | 盘点表格组件 |
| `apps/web/src/views/business/forms/SalesServiceForm.vue` | 销售售后表单 |
| `apps/web/src/views/business/forms/PurchaseRefundForm.vue` | 采购退款表单 |

排除（无固定列，不存在该偏移问题）：ReportPage、InventoryLedgerDialog、BomReturnDialog、InventoryCheckForm、InventoryStockForm。

## 四、本次修改

- 新增 `apps/web/src/components/business/OverflowTooltipCell.vue`：
  - 以单元格自身为**虚拟触发元素**（`virtual-triggering` + `virtual-ref`），浮层定位由 `el-tooltip` 基于真实单元格矩形计算，不存在固定列偏移；
  - 内容包裹层自带 `overflow:hidden; text-overflow:ellipsis; white-space:nowrap`，与原生行为一致；
  - `mouseenter` 时判断 `scrollWidth > clientWidth`，**仅内容溢出才显示 Tooltip**；
  - `content` prop 缺省时取触发元素 `innerText`。
- 上述 12 个文件：移除 `show-overflow-tooltip` / `:show-overflow-tooltip="column.tooltip"`，将文本类单元格内容包进 `OverflowTooltipCell`（状态标签、进度条等非文本单元格不包裹，避免布局裁剪）。

## 五、验证结果

- Web TypeScript 类型检查：通过；
- Web 单元测试：11 个文件 38 项全部通过；
- Web 构建：通过。

## 六、遗留问题与风险

- 未进行浏览器实际操作验收；建议在 DEV 环境验收：
  - 客户页等含固定列的表格，hover 长文本单元格提示位置与单元格对齐、不再漂移；
  - 无溢出内容的单元格不出现 Tooltip；
  - 横向滚动后 hover 仍正常；
  - 状态/进度列显示无异常。
- 仅内容溢出时触发，与原版 `show-overflow-tooltip` 行为一致；`scrollWidth` 判定存在 1px 容差。

## 七、Git 提交

- 提交号：待提交后回填；
- 未推送远端。
