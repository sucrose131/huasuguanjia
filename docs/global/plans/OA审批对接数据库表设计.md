# OA审批对接数据库表设计

## 概述

本文档定义薪福通OA审批对接功能所需的数据库表设计，涵盖表单配置缓存、字段映射、审批实例记录、回调日志四大模块。

## 设计原则

- **不改造现有业务表**：审批状态通过 `hspsi_oa_approval_instance.business_type + business_id` 反查关联，业务表的 `approve_status` 等字段保持原样用于本地审批流程
- **幂等由代码层保证**：推送幂等通过分布式锁 + 状态机实现，回调幂等通过状态机判断，不依赖数据库唯一索引
- **人员映射复用现有字段**：通过 `sys_user.username → staff.mobile(+account_set_id) → staff.outer_ref_id` 链路获取OA人员标识，无需新建映射表
- **字段映射与取值逻辑分离**：mapping 表只存 OA uniqueName ↔ 本地字段名的映射，ID→文本、字典→文本等转换逻辑在代码中按 business_type 策略模式实现

---

## 1. hspsi_oa_form_template — OA表单模板配置

缓存从OA拉取的表单配置，避免每次提交审批都请求OA接口。

### Prisma Schema

```prisma
model hspsi_oa_form_template {
  id             BigInt    @id @default(autoincrement()) @db.UnsignedBigInt
  form_id        String    @default("") @db.VarChar(50)
  form_key       String    @default("") @db.VarChar(100)
  form_name      String    @default("") @db.VarChar(100)
  form_config    String    @default("") @db.MediumText
  account_set_id BigInt    @default(0) @db.UnsignedBigInt
  synced_at      DateTime? @db.DateTime(0)
  status         Int       @default(1) @db.TinyInt
  created_by     BigInt    @default(0)
  updated_by     BigInt    @default(0)
  created_at     DateTime? @default(now()) @db.DateTime(0)
  updated_at     DateTime? @default(now()) @db.DateTime(0)
  deleted_at     DateTime? @db.DateTime(0)

  @@index([account_set_id], map: "idx_oa_ft_account_set_id")
  @@index([form_key], map: "idx_oa_ft_form_key")
}
```

### 字段说明

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| id | BigInt Unsigned PK | 自增 | 主键 |
| form_id | varchar(50) | "" | OA表单ID（如 `379494851337453568`） |
| form_key | varchar(100) | "" | OA表单Key（如 `AAC22502_NFORM_379451564510347266`） |
| form_name | varchar(100) | "" | 表单名称/业务用途描述 |
| form_config | mediumtext | "" | OA返回的完整formConfig JSON字符串 |
| account_set_id | BigInt Unsigned | 0 | 账套ID，区分不同企业 |
| synced_at | datetime | null | 最近一次从OA同步配置的时间 |
| status | tinyint | 1 | 状态：1-启用 0-停用 |
| created_by / updated_by | BigInt | 0 | 操作人 |
| created_at / updated_at / deleted_at | datetime | now()/null | 审计字段 |

---

## 2. hspsi_oa_form_field_mapping — 表单字段映射

定义业务字段与OA控件 uniqueName 的映射关系，提交审批时按此映射组装 formData。取值转换逻辑（ID→文本、字典→文本等）在代码中按 business_type 策略模式实现，不在数据库中配置。

### Prisma Schema

```prisma
model hspsi_oa_form_field_mapping {
  id             BigInt    @id @default(autoincrement()) @db.UnsignedBigInt
  template_id    BigInt    @default(0)
  business_type  String    @default("") @db.VarChar(50)
  unique_name    String    @default("") @db.VarChar(50)
  field_label    String    @default("") @db.VarChar(100)
  component_type String    @default("") @db.VarChar(50)
  local_field    String    @default("") @db.VarChar(100)
  required       Int       @default(0) @db.TinyInt
  sort_order     Int       @default(0)
  account_set_id BigInt    @default(0) @db.UnsignedBigInt
  created_by     BigInt    @default(0)
  updated_by     BigInt    @default(0)
  created_at     DateTime? @default(now()) @db.DateTime(0)
  updated_at     DateTime? @default(now()) @db.DateTime(0)
  deleted_at     DateTime? @db.DateTime(0)

  @@index([template_id], map: "idx_oa_ffm_template_id")
  @@index([business_type], map: "idx_oa_ffm_business_type")
  @@index([account_set_id], map: "idx_oa_ffm_account_set_id")
}
```

### 字段说明

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| id | BigInt Unsigned PK | 自增 | 主键 |
| template_id | BigInt | 0 | 关联 `hspsi_oa_form_template.id` |
| business_type | varchar(50) | "" | 业务类型（如 `purchase_order`、`material_requisition`） |
| unique_name | varchar(50) | "" | OA控件uniqueName（如 `hxvvnrk6daq5`） |
| field_label | varchar(100) | "" | OA控件label（如 `单行文本`） |
| component_type | varchar(50) | "" | OA控件类型（如 `FinInput`、`FinInputNumber`、`FinUpload`） |
| local_field | varchar(100) | "" | 本地业务字段名（如 `code`、`total_amount`、`category_id`） |
| required | tinyint | 0 | 是否必填：1-是 0-否 |
| sort_order | int | 0 | 排序序号 |
| account_set_id | BigInt Unsigned | 0 | 账套ID |
| created_by / updated_by | BigInt | 0 | 操作人 |
| created_at / updated_at / deleted_at | datetime | now()/null | 审计字段 |

### 取值转换策略

mapping 表只负责 **OA uniqueName ↔ 本地字段名** 的映射关系，值的获取和转换逻辑在代码中按 `business_type` 策略模式实现：

```typescript
// 策略模式：按 business_type 注册取值转换器
const valueResolvers: Record<string, FieldValueResolver> = {
  purchase_order: {
    category_id: async (id) => {
      const category = await prisma.hspsi_basic_category.findUnique({
        where: { id }, select: { name: true },
      });
      return category?.name;
    },
    supplier_id: async (id) => {
      const supplier = await prisma.hspsi_basic_supplier.findUnique({
        where: { id }, select: { name: true },
      });
      return supplier?.name;
    },
    // 其他需要转换的字段...
  },
  material_requisition: {
    // ...
  },
};

// 组装 formData
for (const m of mappings) {
  let value = order[m.local_field];
  const resolver = valueResolvers[m.business_type]?.[m.local_field];
  if (resolver) {
    value = await resolver(value);
  }
  formData[m.unique_name] = value;
}
```

**优势**：
- 表结构简洁，只做字段映射
- 不在数据库中暴露表名，无安全风险
- 转换逻辑灵活，可处理级联、多字段组合等复杂场景
- 新增业务类型只需新增策略，不影响现有逻辑

---

## 3. hspsi_oa_approval_instance — 审批实例

记录审批全生命周期，从发起到终态。

### Prisma Schema

```prisma
model hspsi_oa_approval_instance {
  id              BigInt    @id @default(autoincrement()) @db.UnsignedBigInt
  business_type   String    @default("") @db.VarChar(50)
  business_id     BigInt    @default(0)
  form_key        String    @default("") @db.VarChar(100)
  bus_key         String    @default("") @db.VarChar(100)
  proc_inst_id    String    @default("") @db.VarChar(50)
  proc_key        String    @default("") @db.VarChar(100)
  proc_status     String    @default("") @db.VarChar(20)
  submitted_by    BigInt    @default(0)
  submitted_at    DateTime? @db.DateTime(0)
  callback_count  Int       @default(0)
  last_callback_at DateTime? @db.DateTime(0)
  account_set_id  BigInt    @default(0) @db.UnsignedBigInt
  created_by      BigInt    @default(0)
  updated_by      BigInt    @default(0)
  created_at      DateTime? @default(now()) @db.DateTime(0)
  updated_at      DateTime? @default(now()) @db.DateTime(0)
  deleted_at      DateTime? @db.DateTime(0)

  @@index([business_type, business_id], map: "idx_oa_ai_business")
  @@index([proc_inst_id], map: "idx_oa_ai_proc_inst_id")
  @@index([account_set_id], map: "idx_oa_ai_account_set_id")
}
```

### 字段说明

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| id | BigInt Unsigned PK | 自增 | 主键 |
| business_type | varchar(50) | "" | 业务类型（如 `purchase_order`） |
| business_id | BigInt | 0 | 业务单据ID |
| form_key | varchar(100) | "" | 提交时使用的OA表单Key |
| bus_key | varchar(100) | "" | OA返回的业务编号（如 `NFORM_379457712754589696`） |
| proc_inst_id | varchar(50) | "" | OA审批实例ID（如 `379457714917408774`） |
| proc_key | varchar(100) | "" | OA流程Key |
| proc_status | varchar(20) | "" | 流程状态：RUNNING/PASSED/REJECTED/CANCELED/DELETED |
| submitted_by | BigInt | 0 | 提交人（`hspsi_basic_staff.id`） |
| submitted_at | datetime | null | 提交时间 |
| callback_count | int | 0 | 回调接收次数 |
| last_callback_at | datetime | null | 最近一次回调时间 |
| account_set_id | BigInt Unsigned | 0 | 账套ID |
| created_by / updated_by | BigInt | 0 | 操作人 |
| created_at / updated_at / deleted_at | datetime | now()/null | 审计字段 |

### 幂等保证

推送幂等和回调幂等均由代码层实现，不依赖数据库唯一索引：

- **推送幂等**：分布式锁（同一 `business_type + business_id` 加锁）+ 状态机（审批状态只能从未提交 → RUNNING，已提交的不能再提交）
- **回调幂等**：状态机判断（按 `proc_inst_id` 查实例，如果已经是终态则直接忽略）

---

## 4. hspsi_oa_approval_callback_log — 回调日志

记录OA审批流程结束事件的回调数据，用于审计追踪和异常排查。

### Prisma Schema

```prisma
model hspsi_oa_approval_callback_log {
  id             BigInt    @id @default(autoincrement()) @db.UnsignedBigInt
  instance_id    BigInt    @default(0)
  event_code     String    @default("") @db.VarChar(30)
  prj_cod        String    @default("") @db.VarChar(50)
  proc_status    String    @default("") @db.VarChar(20)
  bus_key        String    @default("") @db.VarChar(100)
  proc_inst_id   String    @default("") @db.VarChar(50)
  proc_key       String    @default("") @db.VarChar(100)
  raw_payload    String    @default("") @db.MediumText
  processed      Int       @default(0) @db.TinyInt
  process_result String    @default("") @db.VarChar(500)
  account_set_id BigInt    @default(0) @db.UnsignedBigInt
  created_at     DateTime? @default(now()) @db.DateTime(0)

  @@index([instance_id], map: "idx_oa_acl_instance_id")
  @@index([proc_inst_id, proc_status], map: "idx_oa_acl_dedup")
  @@index([account_set_id], map: "idx_oa_acl_account_set_id")
}
```

### 字段说明

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| id | BigInt Unsigned PK | 自增 | 主键 |
| instance_id | BigInt | 0 | 关联 `hspsi_oa_approval_instance.id`（首次回调时可能为0） |
| event_code | varchar(30) | "" | 事件编号（`XFTOAFPS`） |
| prj_cod | varchar(50) | "" | 企业号 |
| proc_status | varchar(20) | "" | 回调流程状态 |
| bus_key | varchar(100) | "" | 业务编号 |
| proc_inst_id | varchar(50) | "" | 审批编号 |
| proc_key | varchar(100) | "" | 流程Key |
| raw_payload | mediumtext | "" | 原始回调JSON，用于审计排查 |
| processed | tinyint | 0 | 是否已处理：1-是 0-否 |
| process_result | varchar(500) | "" | 处理结果或错误信息 |
| account_set_id | BigInt Unsigned | 0 | 账套ID |
| created_at | datetime | now() | 接收时间（仅创建，无更新/删除） |

---

## 索引汇总

| 表 | 索引名 | 索引字段 | 用途 |
|---|---|---|---|
| hspsi_oa_form_template | idx_oa_ft_account_set_id | account_set_id | 按账套隔离 |
| hspsi_oa_form_template | idx_oa_ft_form_key | form_key | 按formKey查询模板 |
| hspsi_oa_form_field_mapping | idx_oa_ffm_template_id | template_id | 查询模板下的字段映射 |
| hspsi_oa_form_field_mapping | idx_oa_ffm_business_type | business_type | 按业务类型查询映射 |
| hspsi_oa_form_field_mapping | idx_oa_ffm_account_set_id | account_set_id | 按账套隔离 |
| hspsi_oa_approval_instance | idx_oa_ai_business | business_type + business_id | 按业务类型+ID反查审批状态 |
| hspsi_oa_approval_instance | idx_oa_ai_proc_inst_id | proc_inst_id | 回调时按procInstId匹配实例 |
| hspsi_oa_approval_instance | idx_oa_ai_account_set_id | account_set_id | 按账套隔离 |
| hspsi_oa_approval_callback_log | idx_oa_acl_instance_id | instance_id | 查询某实例的回调历史 |
| hspsi_oa_approval_callback_log | idx_oa_acl_dedup | proc_inst_id + proc_status | 回调幂等去重查询 |
| hspsi_oa_approval_callback_log | idx_oa_acl_account_set_id | account_set_id | 按账套隔离 |

---

## OA人员映射

OA人员标识通过现有字段链路获取，无需新建映射表：

```
sys_user.username → staff.mobile(+account_set_id) → staff.outer_ref_id
```

- `hspsi_sys_user.username`：系统用户登录账号
- `hspsi_basic_staff.mobile`：员工手机号（与登录账号匹配）
- `hspsi_basic_staff.account_set_id`：账套ID（区分不同企业）
- `hspsi_basic_staff.outer_ref_id`：OA企业成员ID（提交审批时作为发起人标识）

---

## 不需要新建的表

| 能力 | 说明 |
|---|---|
| OA用户映射表 | 已有 `staff.outer_ref_id` 链路支撑 |
| 审批待办任务表 | 平台不展示审批待办，所有审批过程在OA侧完成 |
| 现有业务表改造 | 通过 `approval_instance.business_type + business_id` 反查关联，不侵入现有表结构 |