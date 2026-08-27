# 表格固定列 Tooltip 漂移修复实施记录

> 日期：2026-08-27
> 分支：`fix/0827-table-tooltip-offset`，已合并至 `fix/0827-lzw`
> 类型：影响用户操作的界面缺陷修复（业务已确认范围）
> 当前状态：代码完成，类型检查与浏览器验收通过（未推送）

## 一、问题描述

1. 基础资料—客户等表格中，鼠标悬浮长文本列时，Tooltip 与目标单元格错位；长表格中甚至向上漂移整张表格的高度。
2. 采购管理—采购申请页面滚动到底部后，点击分页数量选择器，下拉选项漂移到视口上方。

## 二、根因

- `el-table` 原生 `show-overflow-tooltip` 在表格**存在 `fixed` 固定列**时，固定列是独立渲染的覆盖层（`.el-table__fixed`），浮层定位所用单元格坐标与主表体叠加后产生水平偏移（偏移量≈左侧固定列宽度，并随横向滚动变化）。这是 Element Plus 的已知问题，当前实际安装版本 2.14.3 仍存在。
- 受影响表格的共同特征：**固定列 + `show-overflow-tooltip` 同时存在**。
- 自定义虚拟 Tooltip 和分页内部 `ElSelect` 默认使用 teleport、`absolute` 定位及 Popper adaptive 边缘锚定。在长页面中，`body.clientHeight` 与文档高度不一致，Popper 生成的 `bottom` 坐标被浏览器按不同的包含块高度解释，造成整页高度级别的垂直漂移。

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
  - 设置 `strategy="fixed"` 并关闭 `computeStyles.adaptive`，直接按视口坐标定位。
- 上述 12 个文件：移除 `show-overflow-tooltip` / `:show-overflow-tooltip="column.tooltip"`，将文本类单元格内容包进 `OverflowTooltipCell`（状态标签、进度条等非文本单元格不包裹，避免布局裁剪）。
- `BusinessDocumentPage.vue` 的公共分页设置 `:teleported="false"`，使每页数量下拉浮层挂载在分页组件附近，覆盖采购、库存、生产、销售和领用共享列表。

## 五、验证结果

- Web TypeScript 类型检查：通过；
- Web 单元测试：11 个文件 38 项全部通过；
- Web 构建：通过；
- 浏览器验收（系统管理—用户管理—数据访问组织）：修复前目标单元格 `y=633.5px`、Tooltip `y=-13197px`；修复后 Tooltip `y=590px`，正确显示在目标单元格上方；
- 浏览器验收（采购管理—采购申请—分页数量）：修复前选择器 `y=638px`、下拉浮层 `y=-310px`；修复后浮层 `y=505px`，正确显示在选择器上方。

## 六、遗留问题与风险

- 已完成长表格、横向滚动及页面底部分页场景的浏览器验收；其他引用页面复用相同公共组件。
- 仅内容溢出时触发，与原版 `show-overflow-tooltip` 行为一致；`scrollWidth` 判定存在 1px 容差。

## 七、Git 提交

- 提交号：`73d6c73`（分支 `fix/0827-table-tooltip-offset`）；
- 长表格 Tooltip 垂直漂移补充修复：`84a9e2d`；
- 分页数量下拉漂移修复：`3cf8c14`（分支 `fix/0827-lzw`）；
- 未推送远端。
