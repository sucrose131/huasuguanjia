# Element Plus Table 表格样式归档

> 适用项目：华溯管家 Web 前端  
> 当前依赖：Vue 3.5、Element Plus 2.9  
> 参考来源：[Element Plus Table 官方文档](https://element-plus.org/zh-CN/component/table)  
> 说明：本文不是官网示例的逐字复制，而是提炼后的最小可复用写法。示例统一使用 `tableData` 作为数据源。

## 一、通用数据结构

```vue
<script setup lang="ts">
import { ref } from 'vue'
import type {
  TableColumnCtx,
  TableInstance,
  TableProps,
} from 'element-plus'

interface RowData {
  id: number
  code: string
  name: string
  status: '待审核' | '已审核' | '已完成'
  quantity: number
  amount: number
  children?: RowData[]
  hasChildren?: boolean
}

const tableData = ref<RowData[]>([
  { id: 1, code: 'SO20260731001', name: '销售订单A', status: '待审核', quantity: 10, amount: 1200 },
  { id: 2, code: 'SO20260731002', name: '销售订单B', status: '已完成', quantity: 20, amount: 3600 },
])
</script>
```

## 二、25种表格写法

### 1. 基础表格

适合数据量较少的普通列表。

```vue
<el-table :data="tableData">
  <el-table-column prop="code" label="单据编号" width="180" />
  <el-table-column prop="name" label="单据名称" />
  <el-table-column prop="status" label="状态" width="100" />
</el-table>
```

### 2. 斑马纹表格

使用 `stripe` 提高多行数据的辨识度。

```vue
<el-table :data="tableData" stripe>
  <el-table-column prop="code" label="单据编号" />
  <el-table-column prop="name" label="单据名称" />
</el-table>
```

### 3. 带边框表格

适合字段较多、需要明确区分单元格的单据明细。

```vue
<el-table :data="tableData" border>
  <el-table-column prop="code" label="单据编号" />
  <el-table-column prop="quantity" label="数量" align="right" />
</el-table>
```

### 4. 带状态表格

通过 `row-class-name` 标识异常、缺料或待处理行。

```vue
<el-table :data="tableData" :row-class-name="getRowClass">
  <el-table-column prop="code" label="单据编号" />
  <el-table-column prop="status" label="状态" />
</el-table>

<script setup lang="ts">
const getRowClass: TableProps<RowData>['rowClassName'] = ({ row }) =>
  row.status === '待审核' ? 'warning-row' : ''
</script>

<style scoped>
:deep(.el-table .warning-row) {
  --el-table-tr-bg-color: var(--el-color-warning-light-9);
}
</style>
```

### 5. 溢出内容提示

长名称、备注和地址字段建议统一使用。

```vue
<el-table :data="tableData">
  <el-table-column prop="name" label="单据名称" show-overflow-tooltip />
</el-table>
```

### 6. 固定表头

设置 `height` 后，表格内容滚动而表头保持固定。

```vue
<el-table :data="tableData" height="420">
  <el-table-column prop="code" label="单据编号" />
  <el-table-column prop="name" label="单据名称" />
</el-table>
```

### 7. 固定列

适合宽表，通常固定编号列和右侧操作列。

```vue
<el-table :data="tableData">
  <el-table-column fixed prop="code" label="单据编号" width="180" />
  <el-table-column prop="name" label="单据名称" min-width="300" />
  <el-table-column prop="amount" label="金额" width="140" />
  <el-table-column fixed="right" label="操作" width="120">
    <template #default>
      <el-button link type="primary">查看</el-button>
    </template>
  </el-table-column>
</el-table>
```

### 8. 固定列和表头

同时设置 `height` 和 `fixed`。

```vue
<el-table :data="tableData" height="420">
  <el-table-column fixed prop="code" label="单据编号" width="180" />
  <el-table-column prop="name" label="单据名称" min-width="500" />
  <el-table-column fixed="right" label="操作" width="100" />
</el-table>
```

### 9. 流体高度

使用 `max-height`，数据少时自适应，数据多时出现滚动条。

```vue
<el-table :data="tableData" max-height="420">
  <el-table-column prop="code" label="单据编号" />
  <el-table-column prop="name" label="单据名称" />
</el-table>
```

### 10. 多级表头

外层 `el-table-column` 作为分组标题。

```vue
<el-table :data="tableData" border>
  <el-table-column prop="code" label="单据编号" rowspan="2" />
  <el-table-column label="业务数据">
    <el-table-column prop="quantity" label="数量" />
    <el-table-column prop="amount" label="金额" />
  </el-table-column>
</el-table>
```

### 11. 固定分组表头

官网第二个“固定表头”示例实际展示固定群组头；`fixed` 设置在最外层分组列。

```vue
<el-table :data="tableData" height="420">
  <el-table-column fixed label="单据信息">
    <el-table-column prop="code" label="编号" width="180" />
    <el-table-column prop="name" label="名称" width="220" />
  </el-table-column>
  <el-table-column label="业务数据">
    <el-table-column prop="quantity" label="数量" width="120" />
    <el-table-column prop="amount" label="金额" width="140" />
  </el-table-column>
</el-table>
```

### 12. 单选表格

`highlight-current-row` 配合 `current-change`。

```vue
<el-table
  ref="singleTableRef"
  :data="tableData"
  highlight-current-row
  @current-change="handleCurrentChange"
>
  <el-table-column type="index" width="60" />
  <el-table-column prop="code" label="单据编号" />
</el-table>

<script setup lang="ts">
const singleTableRef = ref<TableInstance>()
const currentRow = ref<RowData>()
const handleCurrentChange = (row?: RowData) => {
  currentRow.value = row
}
</script>
```

### 13. 多选表格

增加 `type="selection"` 列，并为数据设置稳定的 `row-key`。

```vue
<el-table :data="tableData" row-key="id" @selection-change="handleSelection">
  <el-table-column type="selection" width="55" />
  <el-table-column prop="code" label="单据编号" />
</el-table>

<script setup lang="ts">
const selectedRows = ref<RowData[]>([])
const handleSelection = (rows: RowData[]) => {
  selectedRows.value = rows
}
</script>
```

### 14. 排序表格

小数据量可前端排序；业务列表建议使用后端排序。

```vue
<el-table :data="tableData" @sort-change="handleSort">
  <el-table-column prop="code" label="单据编号" sortable="custom" />
  <el-table-column prop="amount" label="金额" sortable="custom" />
</el-table>

<script setup lang="ts">
const handleSort = ({ prop, order }: { prop: string; order: string | null }) => {
  // 将 prop、order 传给列表查询接口
}
</script>
```

### 15. 筛选表格

```vue
<el-table :data="tableData">
  <el-table-column
    prop="status"
    label="状态"
    :filters="[
      { text: '待审核', value: '待审核' },
      { text: '已完成', value: '已完成' },
    ]"
    :filter-method="filterStatus"
  />
</el-table>

<script setup lang="ts">
const filterStatus = (value: string, row: RowData) => row.status === value
</script>
```

### 16. 自定义列模板

使用默认插槽组合状态标签、图标、按钮等组件。

```vue
<el-table :data="tableData">
  <el-table-column prop="status" label="状态">
    <template #default="{ row }">
      <el-tag :type="row.status === '已完成' ? 'success' : 'warning'">
        {{ row.status }}
      </el-tag>
    </template>
  </el-table-column>
</el-table>
```

### 17. 自定义表头

```vue
<el-table :data="tableData">
  <el-table-column prop="name">
    <template #header>
      <span>单据名称</span>
      <el-tooltip content="业务单据的显示名称">
        <el-icon><QuestionFilled /></el-icon>
      </el-tooltip>
    </template>
  </el-table-column>
</el-table>
```

### 18. 展开行

适合在列表中快速查看商品明细或关联单据。

```vue
<el-table :data="tableData" row-key="id">
  <el-table-column type="expand">
    <template #default="{ row }">
      <el-descriptions border :column="2">
        <el-descriptions-item label="单据编号">{{ row.code }}</el-descriptions-item>
        <el-descriptions-item label="金额">{{ row.amount }}</el-descriptions-item>
      </el-descriptions>
    </template>
  </el-table-column>
  <el-table-column prop="code" label="单据编号" />
</el-table>
```

### 19. 树形数据与懒加载

适合组织部门、商品分类和BOM层级。

```vue
<el-table
  :data="treeData"
  row-key="id"
  lazy
  :load="loadChildren"
  :tree-props="{ children: 'children', hasChildren: 'hasChildren' }"
>
  <el-table-column prop="name" label="名称" />
</el-table>

<script setup lang="ts">
const treeData = ref<RowData[]>([])
const loadChildren = (
  row: RowData,
  _treeNode: unknown,
  resolve: (rows: RowData[]) => void,
) => {
  resolve(row.children ?? [])
}
</script>
```

### 20. 可选择的树形数据

```vue
<el-table
  :data="treeData"
  row-key="id"
  default-expand-all
  :tree-props="{ children: 'children', checkStrictly: false }"
>
  <el-table-column type="selection" width="55" />
  <el-table-column prop="name" label="名称" />
</el-table>
```

### 21. 表尾合计行

适合采购、销售、库存金额或数量汇总。

```vue
<el-table :data="tableData" border show-summary sum-text="合计">
  <el-table-column prop="name" label="单据名称" />
  <el-table-column prop="quantity" label="数量" />
  <el-table-column prop="amount" label="金额" />
</el-table>
```

自定义合计时使用 `summary-method`：

```vue
<el-table :data="tableData" show-summary :summary-method="getSummaries">
  <!-- columns -->
</el-table>
```

### 22. 合并行或列

通过 `span-method` 返回 `[rowspan, colspan]`。

```vue
<el-table :data="tableData" border :span-method="spanMethod">
  <el-table-column prop="code" label="单据编号" />
  <el-table-column prop="name" label="单据名称" />
</el-table>

<script setup lang="ts">
const spanMethod = ({ rowIndex, columnIndex }: {
  rowIndex: number
  columnIndex: number
}) => {
  if (columnIndex === 0 && rowIndex % 2 === 0) return [2, 1]
  if (columnIndex === 0 && rowIndex % 2 === 1) return [0, 0]
}
</script>
```

### 23. 自定义索引

分页列表可计算连续序号。

```vue
<el-table :data="tableData">
  <el-table-column type="index" :index="indexMethod" label="序号" width="70" />
  <el-table-column prop="code" label="单据编号" />
</el-table>

<script setup lang="ts">
const page = ref(2)
const pageSize = ref(20)
const indexMethod = (index: number) => (page.value - 1) * pageSize.value + index + 1
</script>
```

### 24. 表格布局

使用 `table-layout="fixed"` 保持列宽稳定；字段内容差异很大时可用 `auto`。

```vue
<el-table :data="tableData" table-layout="fixed">
  <el-table-column prop="code" label="单据编号" width="180" />
  <el-table-column prop="name" label="单据名称" />
</el-table>
```

### 25. 自定义 Tooltip

使用 `tooltip-formatter` 自定义溢出提示内容。

```vue
<el-table :data="tableData">
  <el-table-column
    prop="name"
    label="单据名称"
    show-overflow-tooltip
    :tooltip-formatter="({ row }) => `${row.code}：${row.name}`"
  />
</el-table>
```

## 三、当前系统建议采用的组合

| 使用场景 | 推荐组合 |
| --- | --- |
| 普通业务列表 | 斑马纹、固定表头、溢出提示、固定操作列、分页 |
| 销售/采购/生产订单 | 边框、状态标签、展开行、金额对齐、固定操作列 |
| 商品及单据明细 | 边框、多级表头、表尾合计行 |
| 缺料及库存预警 | 状态行、状态标签、自定义 Tooltip |
| 组织/分类/BOM | 树形数据、懒加载、可选择树形数据 |
| 报表汇总 | 排序、筛选、多级表头、合计行；谨慎使用单元格合并 |
| 批量审核 | 多选、稳定 `row-key`、批量操作栏 |

## 四、统一使用规则

1. 业务列表默认开启 `stripe`，单据明细默认开启 `border`。
2. 列表高度超过可视区域时使用 `max-height`；固定页面布局才使用固定 `height`。
3. 单据编号、状态和操作列设置明确宽度，名称类字段使用 `min-width`。
4. 操作列固定在右侧，列表页避免出现双层横向滚动条。
5. 长文本统一使用 `show-overflow-tooltip`，不允许无限撑宽表格。
6. 状态统一使用 `el-tag`，颜色含义在全系统保持一致。
7. 金额和数量右对齐，金额显示两位小数。
8. 大数据列表的排序、筛选和分页由后端完成。
9. 多选表格必须设置稳定的 `row-key`，翻页选择需明确是否保留。
10. 合并单元格只用于报表，不建议在日常业务操作列表中使用。

