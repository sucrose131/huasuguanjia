# OpenApi 用户接口文档

> 版本：v1 | 更新日期：2026-08-13 | 插件：OpenApi

## 概述

用户接口提供用户列表、用户详情和用户模块常量映射三个 POST 接口，用于第三方系统获取商城会员及云库存代理数据。

> **重要**：`list` 接口每个用户元素的字段结构与 `detail` 接口完全一致，外部系统拉取 `list` 接口即可获取用户详情的所有数据，无需再调用 `detail` 接口。每个用户元素包含三个对象：**user / user_level / cloud_stock_agent**。其中 `cloud_stock_agent` 为云库存代理全量字段 + `level_name`（非代理用户为 `null`）；`cloud_stock_level` 等级记录不在数据接口返回，仅在 `constants` 接口提供字段说明。

- **基础路径**：`/open-api/v1/user/`
- **请求方式**：POST（JSON body）
- **Content-Type**：`application/json`
- **免登录**：list、detail、constants 接口均免登录验证

---

## 认证

所有请求必须携带商城标识，通过请求头传递：

| 请求头 | 必填 | 说明 |
|--------|------|------|
| `mall-id` | 是 | 商城ID，对应 `qimall_mall` 表的 `id` 字段 |
| `Host` | 是 | 域名，如 `api.ten.com` |

---

## 通用响应格式

```json
{
  "code": 0,
  "msg": "操作成功",
  "data": { ... }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| code | int | 业务状态码，0=成功，1=失败 |
| msg | string | 提示信息 |
| data | object/array | 业务数据 |

---

## 1. 用户列表

### 请求

```
POST /open-api/v1/user/list
```

### 请求参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| page | int | 否 | 1 | 页码，最小值1 |
| limit | int | 否 | 20 | 每页条数，最大值100 |
| keyword | string | 否 | - | 手机号/昵称/用户ID 模糊搜索（命中任一即可） |
| level | int | 否 | - | 会员等级过滤，对应 qimall_user_level.level 字段；level=0 为默认等级（普通会员） |
| status | int | 否 | - | 状态过滤：1=启用，0=禁用；不传则默认返回启用+禁用（排除已删除） |
| start_time | string | 否 | - | 更新时间起始（Y-m-d H:i:s），按 updated_at >= start_time 过滤 |
| end_time | string | 否 | - | 更新时间截止（Y-m-d H:i:s），按 updated_at <= end_time 过滤 |

### 请求示例

```bash
curl -X POST "http://api.ten.com/open-api/v1/user/list" \
  -H "Host: api.ten.com" \
  -H "Content-Type: application/json" \
  -H "mall-id: 1" \
  -d '{"page":1,"limit":5}'
```

### 响应参数

> **说明**：list 接口每个用户元素的字段结构与 detail 接口完全一致，外部系统拉取 list 接口即可获取用户详情的所有数据，无需再调用 detail 接口。各嵌套字段的详细说明见下方字段说明。

| 字段 | 类型 | 说明 |
|------|------|------|
| data.list | array | 用户列表 |
| data.list[].user | object | 用户主信息（qimall_user 全量字段 + 补充字段，已过滤 password、transaction_password） |
| data.list[].user_level | object/null | 会员等级记录（qimall_user_level 全量字段，level=0 时为 null） |
| data.list[].cloud_stock_agent | object/null | 云库存代理记录（qimall_addons_cloud_stock_agent 全量字段 + level_name，非代理为 null） |
| data.pagination | object | 分页信息 |
| data.pagination.total | int | 总记录数 |
| data.pagination.page | int | 当前页码 |
| data.pagination.page_size | int | 每页条数 |

### 过滤逻辑说明

| 参数 | 实现位置 | 逻辑 |
|------|----------|------|
| keyword | UserService::getList() | OR 匹配：`id = (int)keyword` 或 `mobile LIKE %keyword%` 或 `nickname LIKE %keyword%` |
| status | UserService::getList() | 传值精确过滤；不传时 `status >= 0`（排除删除=-1） |
| level | UserService::getList() | 精确匹配 `qimall_user.level = level` |
| start_time/end_time | UserService::getList() | end_time 自动补 `23:59:59`，按 updated_at 范围过滤 |

### user 字段说明（qimall_user 表全量字段，已过滤敏感字段）

> **敏感字段过滤**：接口返回前已剔除 `password`、`transaction_password` 两个字段，外部系统不会收到这些数据。

| 字段 | 类型 | 说明 | 表名 | 数据库字段 | comment |
|------|------|------|------|------|------|
| id | int | 用户ID | qimall_user | id | ID |
| base64_code | string | user_id的64进制 | qimall_user | base64_code | user_id的64进制 |
| mall_id | int | 商城ID | qimall_user | mall_id | 商城ID |
| mch_id | int | 商户ID | qimall_user | mch_id | 商户ID |
| store_id | int | 门店ID | qimall_user | store_id | 门店id |
| username | string | 用户名 | qimall_user | username | 用户名 |
| area_code | string | 手机区号 | qimall_user | area_code | 手机区号 |
| mobile | string | 手机号 | qimall_user | mobile | 手机号 |
| nickname | string | 昵称 | qimall_user | nickname | 昵称 |
| birthday | string | 生日 | qimall_user | birthday | 生日 |
| avatar_url | string | 头像 | qimall_user | avatar_url | 头像 |
| platform | string | 注册平台 | qimall_user | platform | 平台名字 |
| temp_parent_id | int | 临时父级 | qimall_user | temp_parent_id | 临时父级 |
| parent_id | int | 直推人ID（第一父级） | qimall_user | parent_id | 第一父级ID（直推人id） |
| second_parent_id | int | 第二推荐人ID | qimall_user | second_parent_id | 第二推荐人id |
| third_parent_id | int | 第三推荐人ID | qimall_user | third_parent_id | 第三推荐人id |
| junior_at | int | 成为下级时间 | qimall_user | junior_at | 成为下级时间 |
| last_login_at | int | 最后登录时间 | qimall_user | last_login_at | 最后登录时间 |
| upgrade_level_at | int | 升级时间 | qimall_user | upgrade_level_at | 升级时间 |
| inviter_at | int | 邀请时间 | qimall_user | inviter_at | 邀请时间 |
| login_ip | string | 用户登录IP | qimall_user | login_ip | 用户登录ip |
| is_inviter | int | 是否是邀请者 | qimall_user | is_inviter | 是否是邀请者 |
| status | int | 状态 | qimall_user | status | 状态[-1:删除;0:禁用;1启用] |
| level | int | 会员等级 | qimall_user | level | 会员等级，0为普通会员，对应qimall_user_level.level字段 |
| source | int | 用户来源 | qimall_user | source | 用户来源 |
| signature_title | string | 个性签名标题 | qimall_user | signature_title | 个性签名标题 |
| signature_content | string | 个性签名内容 | qimall_user | signature_content | 个性签名内容 |
| background | string | 个人主页背景图 | qimall_user | background | 个人主页背景图 |
| created_at | int | 添加时间 | qimall_user | created_at | 添加时间 |
| updated_at | int | 更新时间 | qimall_user | updated_at | 更新时间 |
| verification_token | string | 验证token | qimall_user | verification_token | 验证token |
| device_type | string | 登录设备 | qimall_user | device_type | 登录设备 |
| device_mac | string | 登录设备MAC地址 | qimall_user | device_mac | 登录设备MAC地址 |
| inviter_source | int | 邀请来源 | qimall_user | inviter_source | 邀请来源 |

#### 接口已实现的补充字段（关联其他表组装）

| 字段 | 类型 | 说明 | 来源表 | 来源字段 | 关联键 | 查询条件 | 默认值 |
|------|------|------|--------|----------|--------|----------|--------|
| parent_mobile | string | 直推人手机号 | qimall_user | mobile | user.parent_id → qimall_user.id | 无 status 过滤，1:1 | ""（无直推人） |
| parent_username | string | 直推人用户名 | qimall_user | username | user.parent_id → qimall_user.id | 无 status 过滤，1:1 | ""（无直推人） |
| parent_nickname | string | 直推人昵称 | qimall_user | nickname | user.parent_id → qimall_user.id | 无 status 过滤，1:1 | ""（无直推人） |
| level_name | string | 会员等级名称 | qimall_user_level | name | user.level → user_level.level | status >= 0 | "普通会员"（level=0 时回退） |

#### 补充字段关联路径详解

```
1. 直推人信息（parent_mobile / parent_username / parent_nickname）
   qimall_user.parent_id → qimall_user.id（自关联，1:1）
   批量查询：收集 parent_id → User::find()->where(['id' => $parentIds])
   默认值：parent_id 为空或不存在时，三个字段均为 ""

2. 会员等级名称（level_name）
   qimall_user.level → qimall_user_level.level（1:1）
   批量查询：收集 level → UserLevel::find()->where(['level' => $levels, 'mall_id' => $mall_id])
   默认值：level=0 或无对应记录时，回退为 MallSetting::getDefaultLevelName()（通常为"普通会员"）
```

### user_level 字段说明（qimall_user_level 表）

> level=0 时，user_level 对象为 null（默认等级无记录）。

| 字段 | 类型 | 说明 | 表名 | 数据库字段 | comment |
|------|------|------|------|------|------|
| id | int | 等级ID | qimall_user_level | id | ID |
| mall_id | int | 商城ID | qimall_user_level | mall_id | Mall ID |
| level | int | 会员等级 | qimall_user_level | level | 会员等级 |
| name | string | 等级名称 | qimall_user_level | name | 等级名称 |
| pic_url | string | 等级图标 | qimall_user_level | pic_url | 图标 |
| discount | decimal | 折扣 | qimall_user_level | discount | 折扣 |
| status | int | 状态 | qimall_user_level | status | 状态[-1:删除;0:禁用;1启用] |
| is_open_expired | int | 是否开启等级过期 | qimall_user_level | is_open_expired | Is Open Expired |
| expired_day | int | 过期天数 | qimall_user_level | expired_day | Expired Day |
| member_price_is_show | int | 会员价是否展示 | qimall_user_level | member_price_is_show | Member Price Is Show |
| is_specified_level | int | 指定等级会员价展示 | qimall_user_level | is_specified_level | 指定等级会员价展示[0否;1是] |
| specified_level | string | 指定等级 | qimall_user_level | specified_level | 指定等级 |
| created_at | int | 创建时间 | qimall_user_level | created_at | Created At |
| updated_at | int | 更新时间 | qimall_user_level | updated_at | Updated At |

### cloud_stock_agent 字段说明（qimall_addons_cloud_stock_agent 表全量字段 + level_name）

> 非云库存代理用户，cloud_stock_agent 对象为 null。

| 字段 | 类型 | 说明 | 表名 | 数据库字段 | comment |
|------|------|------|------|------|------|
| id | int | 代理ID | qimall_addons_cloud_stock_agent | id | ID |
| mall_id | int | 商城ID | qimall_addons_cloud_stock_agent | mall_id | 商城id |
| user_id | int | 用户ID | qimall_addons_cloud_stock_agent | user_id | 用户id |
| remarks | string | 备注 | qimall_addons_cloud_stock_agent | remarks | 备注 |
| total_childs | int | 所有下级数量 | qimall_addons_cloud_stock_agent | total_childs | 所有下级数量 |
| total_order | int | 订单数量 | qimall_addons_cloud_stock_agent | total_order | 订单数量 |
| upgrade_at | int | 等级升级时间 | qimall_addons_cloud_stock_agent | upgrade_at | 等级升级时间 |
| total_price | decimal | 累计收益 | qimall_addons_cloud_stock_agent | total_price | 累计收益 |
| price | decimal | 已结算收益 | qimall_addons_cloud_stock_agent | price | 已结算收益 |
| frozen_price | decimal | 未结算收益 | qimall_addons_cloud_stock_agent | frozen_price | 未结算收益 |
| upgrade_status | int | 升级类型 | qimall_addons_cloud_stock_agent | upgrade_status | 升级类型;1条件升级;2升级礼包;3平台添加;4上级添加,5购买商品升级 |
| level | int | 代理商等级权重 | qimall_addons_cloud_stock_agent | level | 代理商等级权重 |
| before_level | int/null | 升级前等级 | qimall_addons_cloud_stock_agent | before_level | 升级前等级;null为无 |
| status | int | 状态 | qimall_addons_cloud_stock_agent | status | 状态[-1:删除;0:禁用;1启用] |
| created_at | int | 创建时间 | qimall_addons_cloud_stock_agent | created_at | Created At |
| updated_at | int | 更新时间 | qimall_addons_cloud_stock_agent | updated_at | Updated At |
| fill_num | int | 补货数量 | qimall_addons_cloud_stock_agent | fill_num | 补货数量 |
| stock | int | 总库存 | qimall_addons_cloud_stock_agent | stock | 库存 |
| cloud_warehouse_price | decimal | 云仓已结货款 | qimall_addons_cloud_stock_agent | cloud_warehouse_price | cloud_warehouse_price |
| cloud_warehouse_frozen_price | decimal | 云仓待结货款 | qimall_addons_cloud_stock_agent | cloud_warehouse_frozen_price | cloud_warehouse_frozen_price |
| cloud_warehouse_withdraw_price | decimal | 云仓已提现货款 | qimall_addons_cloud_stock_agent | cloud_warehouse_withdraw_price | cloud_warehouse_withdraw_price |
| equal_award_frozen_price | decimal | 待结算平级奖 | qimall_addons_cloud_stock_agent | equal_award_frozen_price | 待结算平级奖 |
| equal_award_price | decimal | 已结算平级奖 | qimall_addons_cloud_stock_agent | equal_award_price | 已结算平级奖 |
| loss_amount | decimal | 流失金额 | qimall_addons_cloud_stock_agent | loss_amount | loss_amount |
| difference_profit | decimal | 价差利润 | qimall_addons_cloud_stock_agent | difference_profit | difference_profit |
| is_equal_award_restriction | int | 是否开启平级奖限制 | qimall_addons_cloud_stock_agent | is_equal_award_restriction | 是否开启平级奖限制：1是；0：否 |
| is_stock_deducted_by_subordinate | int | 库存是否可给下级补货 | qimall_addons_cloud_stock_agent | is_stock_deducted_by_subordinate | 自己的库存是否可以给下级补货 0允许 1不允许 |

#### 接口已实现的补充字段（关联其他表组装）

| 字段 | 类型 | 说明 | 来源表 | 来源字段 | 关联键 | 查询条件 | 默认值 |
|------|------|------|--------|----------|--------|----------|--------|
| level_name | string | 云库存等级名称 | qimall_addons_cloud_stock_level | name | cloud_stock_agent.level → cloud_stock_level.level | status >= 0 | ""（无对应等级） |

#### 补充字段关联路径详解

```
云库存等级名称（level_name）
   qimall_addons_cloud_stock_agent.level → qimall_addons_cloud_stock_level.level（1:1）
   批量查询：收集 level → CloudStockLevel::find()->select(['level','name'])->where(['level' => $csLevels, 'mall_id' => $mall_id])
   默认值：无对应等级记录时，level_name 为 ""
```

> **注意**：`cloud_stock_level`（qimall_addons_cloud_stock_level 表）的完整等级记录不在 list/detail 数据接口返回，仅在 constants 接口提供该表的字段常量映射说明。如需获取等级完整配置（如升级条件、补货规则等），请联系平台方通过后台查询。

### 其他嵌套字段来源说明

> 以下为 list/detail 接口中 3 个对象的数据来源、关联键、查询条件、默认值汇总。

| 字段 | 类型 | 来源表 | 关联键 | 查询条件 | 默认值 |
|------|------|--------|--------|----------|--------|
| data.list[].user / data.user | object | qimall_user | 按 mall_id 分页查询 | status >= 0（排除删除）；支持 keyword/level/status/time 过滤 | - |
| data.list[].user_level / data.user_level | object/null | qimall_user_level | user.level → user_level.level | mall_id 匹配，status >= 0 | null（level=0 无记录） |
| data.list[].cloud_stock_agent / data.cloud_stock_agent | object/null | qimall_addons_cloud_stock_agent | user.id → agent.user_id | mall_id 匹配，status >= 0 | null（非代理用户） |

> **敏感字段过滤**：user 对象返回前已剔除 `password`、`transaction_password`。
>
> **JSON 字段自动解码**：所有嵌套数据中的 JSON 类型字段在返回前已自动 json_decode，直接作为对象/数组下发，无需客户端二次解析。
>
> **N+1 查询优化**：所有关联数据按 user_id / parent_id / level 批量查询后分组组装，避免 N+1 查询。

### 响应示例

```json
{
  "code": 0,
  "msg": "操作成功",
  "data": {
    "list": [
      {
        "user": {
          "id": 173032,
          "mall_id": 1,
          "username": "张三",
          "mobile": "13800138000",
          "nickname": "张三的昵称",
          "level": 1,
          "level_name": "经销商",
          "parent_id": 100,
          "parent_mobile": "13900139000",
          "parent_username": "李四",
          "parent_nickname": "李四的昵称",
          "status": 1
        },
        "user_level": {
          "id": 1,
          "mall_id": 1,
          "level": 1,
          "name": "经销商",
          "status": 1
        },
        "cloud_stock_agent": {
          "id": 50,
          "mall_id": 1,
          "user_id": 173032,
          "level": 1,
          "level_name": "经销商",
          "upgrade_status": 3,
          "status": 1,
          "stock": 100,
          "total_price": 5000.00
        }
      }
    ],
    "pagination": {
      "total": 1835,
      "page": 1,
      "page_size": 5
    }
  }
}
```

---

## 2. 用户详情

### 请求

```
POST /open-api/v1/user/detail
```

### 请求参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| user_id | int | 是 | - | 用户ID（必填，必须 > 0），对应 qimall_user.id |

### 请求示例

```bash
curl -X POST "http://api.ten.com/open-api/v1/user/detail" \
  -H "Host: api.ten.com" \
  -H "Content-Type: application/json" \
  -H "mall-id: 1" \
  -d '{"user_id":173032}'
```

### 响应参数

> **说明**：detail 接口返回单个用户的完整关联数据，结构与 list 接口每个用户元素一致。字段详细说明见 [1. 用户列表 - 字段说明](#user-字段说明qimall_user-表全量字段已过滤敏感字段)。

| 字段 | 类型 | 说明 |
|------|------|------|
| data.user | object | 用户主信息（qimall_user 全量字段 + 补充字段，已过滤 password、transaction_password） |
| data.user_level | object/null | 会员等级记录（qimall_user_level 全量字段，level=0 时为 null） |
| data.cloud_stock_agent | object/null | 云库存代理记录（qimall_addons_cloud_stock_agent 全量字段 + level_name，非代理为 null） |

### 校验逻辑说明

- `user_id <= 0`：返回 `code=1, 用户ID不能为空`
- 用户不存在或已删除（status = -1）：返回 `code=1, 用户不存在`
- 不同商城（mall_id 不匹配）：返回 `code=1, 用户不存在`

### 响应示例

```json
{
  "code": 0,
  "msg": "操作成功",
  "data": {
    "user": {
      "id": 173032,
      "mall_id": 1,
      "username": "张三",
      "mobile": "13800138000",
      "nickname": "张三的昵称",
      "level": 1,
      "level_name": "经销商",
      "parent_id": 100,
      "parent_mobile": "13900139000",
      "parent_username": "李四",
      "parent_nickname": "李四的昵称",
      "status": 1
    },
    "user_level": {
      "id": 1,
      "mall_id": 1,
      "level": 1,
      "name": "经销商",
      "status": 1
    },
    "cloud_stock_agent": {
      "id": 50,
      "mall_id": 1,
      "user_id": 173032,
      "level": 1,
      "level_name": "经销商",
      "upgrade_status": 3,
      "status": 1,
      "stock": 100,
      "total_price": 5000.00
    }
  }
}
```

---

## 3. 用户模块常量

### 请求

```
POST /open-api/v1/user/constants
```

### 请求参数

无请求参数（请求体传空对象 `{}` 或不传均可）。

### 请求示例

```bash
curl -X POST "http://api.ten.com/open-api/v1/user/constants" \
  -H "Host: api.ten.com" \
  -H "Content-Type: application/json" \
  -H "mall-id: 1" \
  -d '{}'
```

### 响应参数

返回用户模块各表字段的枚举常量映射，每个字段包含 `desc`（字段说明）和 `map`（值→标签映射数组）。

| 字段 | 类型 | 说明 |
|------|------|------|
| data.user | object | qimall_user 表字段常量映射 |
| data.user_level | object | qimall_user_level 表字段常量映射 |
| data.cloud_stock_agent | object | qimall_addons_cloud_stock_agent 表字段常量映射 |
| data.cloud_stock_level | object | qimall_addons_cloud_stock_level 表字段常量映射 |

### 响应示例

```json
{
  "code": 0,
  "msg": "操作成功",
  "data": {
    "user": {
      "status": {
        "desc": "状态",
        "map": [
          {"value": 1, "label": "启用"},
          {"value": 0, "label": "禁用"}
        ]
      },
      "is_inviter": {
        "desc": "是否邀请人",
        "map": [
          {"value": 1, "label": "是"},
          {"value": 0, "label": "否"}
        ]
      },
      "source": {
        "desc": "用户来源",
        "map": [
          {"value": 1, "label": "分享首页"},
          {"value": 2, "label": "分享海报"},
          {"value": 3, "label": "分享商品"}
        ]
      },
      "platform": {
        "desc": "注册平台",
        "map": [
          {"value": "mp-wx", "label": "微信小程序"},
          {"value": "mp-ali", "label": "支付宝小程序"},
          {"value": "h5", "label": "H5"},
          {"value": "app", "label": "APP"}
        ]
      }
    },
    "user_level": {
      "status": {
        "desc": "状态",
        "map": [
          {"value": 1, "label": "启用"},
          {"value": 0, "label": "禁用"}
        ]
      }
    },
    "cloud_stock_agent": {
      "status": {
        "desc": "状态",
        "map": [
          {"value": 1, "label": "启用"},
          {"value": 0, "label": "禁用"}
        ]
      },
      "upgrade_status": {
        "desc": "升级类型",
        "map": [
          {"value": 1, "label": "条件升级"},
          {"value": 2, "label": "升级礼包"},
          {"value": 3, "label": "平台添加"},
          {"value": 4, "label": "上级添加"},
          {"value": 5, "label": "购买商品升级"},
          {"value": 6, "label": "购买门店商品升级"},
          {"value": 7, "label": "购买价差礼包升级"}
        ]
      },
      "is_equal_award_restriction": {
        "desc": "是否开启平级奖限制",
        "map": [
          {"value": 0, "label": "否"},
          {"value": 1, "label": "是"}
        ]
      },
      "is_stock_deducted_by_subordinate": {
        "desc": "库存是否可给下级补货",
        "map": [
          {"value": 0, "label": "允许"},
          {"value": 1, "label": "不允许"}
        ]
      }
    },
    "cloud_stock_level": {
      "status": {
        "desc": "状态",
        "map": [
          {"value": 1, "label": "启用"},
          {"value": 0, "label": "禁用"}
        ]
      },
      "condition_type": {
        "desc": "升级条件类型",
        "map": [
          {"value": 0, "label": "未选择"},
          {"value": 1, "label": "满足其一"},
          {"value": 2, "label": "满足所有"}
        ]
      },
      "upgrade_type_condition": {
        "desc": "是否开启条件升级",
        "map": [
          {"value": 1, "label": "是"},
          {"value": 0, "label": "否"}
        ]
      },
      "is_over": {
        "desc": "超越奖励",
        "map": [
          {"value": 1, "label": "是"},
          {"value": 0, "label": "否"}
        ]
      },
      "is_equal": {
        "desc": "平级奖励",
        "map": [
          {"value": 1, "label": "是"},
          {"value": 0, "label": "否"}
        ]
      },
      "is_fill": {
        "desc": "补货",
        "map": [
          {"value": 1, "label": "是"},
          {"value": 0, "label": "否"}
        ]
      }
    }
  }
}
```

---

## 实现位置

| 模块 | 文件路径 |
|------|----------|
| 控制器 | addons/OpenApi/api/modules/v1/controllers/UserController.php |
| 服务层 | addons/OpenApi/common/services/UserService.php |
| 服务基类 | addons/OpenApi/common/services/BaseService.php |
| 用户模型 | common/models/user/User.php |
| 会员等级模型 | common/models/user/UserLevel.php |
| 云库存代理模型 | addons/CloudStock/common/models/CloudStockAgent.php |
| 云库存等级模型 | addons/CloudStock/common/models/CloudStockLevel.php |
| 商城配置 | common/models/common/MallSetting.php（getDefaultLevelName 方法） |

---

## 变更记录

| 日期 | 版本 | 变更内容 |
|------|------|----------|
| 2026-08-13 | v1 | 初始版本：提供用户列表、用户详情、用户模块常量 3 个接口；移除 cloud_stock_level 独立节点（仅在 constants 提供），保留 user / user_level / cloud_stock_agent 三个对象；cloud_stock_agent 返回全量字段 + level_name |
