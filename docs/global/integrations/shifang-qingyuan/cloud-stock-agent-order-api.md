# OpenApi 云库存自提单接口文档

> 版本：v1 | 更新日期：2026-08-24 | 插件：OpenApi

## 概述

云库存自提单接口提供自提单列表、详情与常量映射三个 POST 接口，供第三方系统查询云库存自提单数据。

- **基础路径**：`/open-api/v1/cloud-stock-agent-order/`
- **请求方式**：POST（JSON body）
- **Content-Type**：`application/json`
- **认证方式**：所有接口需携带商城签名（`x-mall-sign` 或 `mall-id` 请求头）

---

## 认证

所有请求必须携带商城签名，通过请求头传递：

| 请求头 | 必填 | 说明 |
|--------|------|------|
| `x-mall-sign` | 是 | 商城签名，对应 `qimall_mall` 表的 `mall_sign` 字段 |
| `Host` | 是 | 域名，如 `api.ten.com` |

> 也可通过 `mall-id` 请求头传递商城ID（二选一）。两者都为空时返回 `code=1, 商城签名不能为空`。

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

## 1. 自提单列表

### 请求

```
POST /open-api/v1/cloud-stock-agent-order/list
```

### 请求参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| page | int | 否 | 1 | 页码，最小值 1 |
| limit | int | 否 | 20 | 每页条数，最大值 100 |
| keyword | string | 否 | - | 搜索关键词（用户ID / 手机号 / 昵称） |
| order_no | string | 否 | - | 订单编号精确匹配 |
| order_id | int | 否 | - | 自提单ID |
| order_type | int | 否 | - | 订单类型过滤（1=云仓自提，2=价差礼包自提） |
| status | int | 否 | - | 发货状态过滤（0=待发货，1=已发货，2=已完成，4=已取消） |
| express_no | string | 否 | - | 物流单号精确匹配 |
| receiving_info | string | 否 | - | 收货人信息（手机号或姓名模糊搜索） |
| start_time | string | 否 | - | 更新时间起始（Y-m-d H:i:s） |
| end_time | string | 否 | - | 更新时间截止（Y-m-d H:i:s） |

### 请求示例

```bash
curl -X POST "http://api.ten.com/open-api/v1/cloud-stock-agent-order/list" \
  -H "Host: api.ten.com" \
  -H "Content-Type: application/json" \
  -H "mall-id: 1" \
  -d '{"page":1,"limit":20,"order_type":1,"status":1}'
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| data.list | array | 自提单列表 |
| data.list[].id | int | 自提单ID |
| data.list[].order_no | string | 订单编号 |
| data.list[].order_type | int | 订单类型（1=云仓自提，2=价差礼包自提） |
| data.list[].order_type_text | string | 订单类型文本描述 |
| data.list[].send_status | int | 发货状态（0=待发货，1=已发货，2=已完成，4=已取消） |
| data.list[].send_status_text | string | 发货状态文本描述 |
| data.list[].user | object/null | 下单用户信息（qimall_user 全量字段 + 增强字段，无则为 null） |
| data.list[].details | array | 商品明细列表（`qimall_addons_cloud_stock_agent_order_details` 全量字段，每个元素含嵌套 `goods`） |
| data.list[].num | int | 商品数量（主表 `qimall_addons_cloud_stock_agent_order.num` 字段透传，与 `details[].num` 相互独立，可能为 0） |
| data.list[].name | string | 收货人姓名 |
| data.list[].mobile | string | 收货人手机号（已脱敏，格式：138****8888） |
| data.list[].address | string | 收货地址 |
| data.list[].express_code | string | 物流公司编码 |
| data.list[].express_name | string | 物流公司名称 |
| data.list[].express_no | string | 物流单号 |
| data.list[].refunds | array | 退款单列表（来自 `qimall_addons_cloud_stock_agent_order_refund` 表，全量字段） |
| data.list[].created_at | int | 创建时间戳 |
| data.list[].created_at_text | string | 创建时间文本（Y-m-d H:i:s） |
| data.pagination | object | 分页信息 |
| data.pagination.total | int | 总记录数 |
| data.pagination.page | int | 当前页码 |
| data.pagination.page_size | int | 每页条数 |

### user 字段说明（list）

> 来源表：`qimall_user`，按 `qimall_addons_cloud_stock_agent_order.user_id` 关联，返回用户表全量字段（已过滤 `password` / `transaction_password`），并附带增强字段。
>
> `mobile` **未脱敏**，为真实手机号明文返回（与收货人 `mobile` 的脱敏行为不同）。

#### qimall_user 表字段

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 用户ID |
| base64_code | string | user_id 的64进制编码 |
| mall_id | int | 商城ID |
| mch_id | int | 商户ID |
| store_id | int | 门店ID |
| username | string | 用户账号（手机号） |
| area_code | string | 手机区号 |
| mobile | string | 手机号（未脱敏，明文返回） |
| nickname | string | 用户昵称 |
| birthday | int | 生日（时间戳） |
| avatar_url | string | 用户头像URL |
| platform | string | 登录平台（mp-wx/mp-ali/mp-bd 等） |
| temp_parent_id | int | 临时父级ID |
| parent_id | int | 直推人ID（第一父级） |
| second_parent_id | int | 二级推荐人ID |
| third_parent_id | int | 三级推荐人ID |
| junior_at | int | 成为下级时间 |
| last_login_at | int | 最后登录时间 |
| upgrade_level_at | int | 等级升级时间 |
| inviter_at | int | 邀请时间 |
| login_ip | string | 最后登录IP |
| is_inviter | int | 是否是邀请者（1=是） |
| status | int | 状态（-1=删除, 0=禁用, 1=启用） |
| level | int | 普通会员等级 |
| source | int | 用户来源（1=分享首页, 2=分享海报, ...） |
| signature_title | string/null | 签名标题 |
| signature_content | string/null | 签名内容 |
| background | string/null | 背景图 |
| created_at | int | 注册时间 |
| updated_at | int | 更新时间 |
| verification_token | string/null | 验证token |
| device_type | string/null | 登录设备类型 |
| device_mac | string/null | 登录设备MAC地址 |
| inviter_source | int | 邀请来源 |

#### 扩展字段（代码增强）

| 字段 | 类型 | 说明 |
|------|------|------|
| parent_mobile | string | 直推人手机号（来自 qimall_user 表） |
| parent_username | string | 直推人账号（来自 qimall_user 表） |
| parent_nickname | string | 直推人昵称（来自 qimall_user 表） |
| level_name | string | 普通会员等级名称（来自 qimall_user_level 表，默认"普通会员"） |
| cloud_stock_level | int | 云仓代理等级（来自 qimall_addons_cloud_stock_agent 表，无则为 0） |
| cloud_stock_level_name | string | 云仓代理等级名称（来自 qimall_addons_cloud_stock_level 表，无则为空） |

### details 字段说明（qimall_addons_cloud_stock_agent_order_details 表）

> 来源表：`qimall_addons_cloud_stock_agent_order_details`，按 `order_id` 关联，查询条件含 `mall_id` + `status=1`（启用），按 `id ASC` 排序。
>
> 每条明细嵌套 `goods` 对象（来自 `qimall_goods`，仅返回 `id / goods_name / cover_pic`），无商品信息时为 `null`。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 明细ID |
| user_id | int | 用户ID |
| mall_id | int | 商城ID |
| goods_id | int | 商品ID |
| order_id | int | 关联自提单ID |
| num | int | 提货数量 |
| status | int | 状态 |
| created_at | int | 创建时间戳 |
| updated_at | int | 更新时间戳 |
| goods | object/null | 商品信息（id / goods_name / cover_pic；无则为 null） |

### refunds 字段说明（list / detail 均有）

> 来源表：`qimall_addons_cloud_stock_agent_order_refund`，按 `order_id` 关联，查询条件含 `mall_id` + `status=1`（启用），按 `id DESC` 排序。无退款单时返回空数组 `[]`。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 退款单ID |
| order_id | int | 关联自提单ID |
| order_no | string | 退款单编号 |
| order_type | int | 订单类型 |
| user_id | int | 用户ID |
| refund_price | float | 退款金额 |
| reality_refund_price | float | 实际退款金额 |
| is_refund | int | 是否已打款（-1=失败，0=未打款，1=打款成功） |
| refund_at | int | 打款时间戳 |
| status | int | 状态 |
| created_at | int | 创建时间戳 |
| updated_at | int | 更新时间戳 |

### 实现位置

> `addons/OpenApi/common/services/CloudStockAgentOrderService.php::getList()`
>
> 所有关联数据（用户 / 上级代理 / 商品明细 / 物流公司 / 退款单）均按主键批量查询后分组组装，避免 N+1。

### 响应示例

> 以下为真实接口返回示例（商城 `mall_id=1`，数据来源于生产库）。

```json
{
  "code": 0,
  "msg": "操作成功",
  "data": {
    "list": [
      {
        "id": 17,
        "order_no": "CSP20260109101204835092",
        "order_type": 1,
        "order_type_text": "云仓自提",
        "send_status": 4,
        "send_status_text": "已取消",
        "user": {
          "id": 171973,
          "base64_code": "F/5",
          "mall_id": 1,
          "mch_id": 0,
          "store_id": 0,
          "username": 18665546822,
          "area_code": 86,
          "mobile": 18665546822,
          "nickname": "小明",
          "birthday": 0,
          "avatar_url": "https://slqy.oss-cn-shenzhen.aliyuncs.com/images/1/2026/01/03/image_1767427750_ldAalvCs.jpg",
          "platform": "mp-wx",
          "temp_parent_id": 0,
          "parent_id": 171865,
          "second_parent_id": 171824,
          "third_parent_id": 171809,
          "junior_at": 0,
          "last_login_at": 1783411060,
          "upgrade_level_at": 1767597457,
          "inviter_at": 0,
          "login_ip": "113.111.171.6",
          "is_inviter": 1,
          "status": 1,
          "level": 5,
          "source": 0,
          "signature_title": null,
          "signature_content": null,
          "background": null,
          "created_at": 1767426745,
          "updated_at": 1783776231,
          "verification_token": null,
          "device_type": "android",
          "device_mac": "9e:aa:0e:ee:7a:cb",
          "inviter_source": 0,
          "parent_mobile": 13066481413,
          "parent_username": 13066481413,
          "parent_nickname": "张三",
          "level_name": "VIP会员",
          "cloud_stock_level": 8,
          "cloud_stock_level_name": "批发商"
        },
        "details": [
          {
            "id": 17,
            "user_id": 171973,
            "mall_id": 1,
            "goods_id": 1,
            "order_id": 17,
            "num": 24,
            "status": 1,
            "created_at": 1767924724,
            "updated_at": 1767924724,
            "goods": {
              "id": 1,
              "goods_name": "尝鲜装",
              "cover_pic": "https://slqy.oss-cn-shenzhen.aliyuncs.com/images/1/2026/01/28/image_1769571945_L0MqaY1z.jpg"
            }
          }
        ],
        "num": 0,
        "name": "李四",
        "mobile": "189****9911",
        "address": "广东省广州市天河区",
        "express_code": "",
        "express_name": "",
        "express_no": "",
        "refunds": [],
        "created_at": 1767924724,
        "created_at_text": "2026-01-09 10:12:04"
      }
    ],
    "pagination": {
      "total": 494,
      "page": 1,
      "page_size": 20
    }
  }
}
```

---

## 2. 自提单详情

### 请求

```
POST /open-api/v1/cloud-stock-agent-order/detail
```

### 请求参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| id | int | 是 | - | 自提单ID |

### 请求示例

```bash
curl -X POST "http://api.ten.com/open-api/v1/cloud-stock-agent-order/detail" \
  -H "Host: api.ten.com" \
  -H "Content-Type: application/json" \
  -H "mall-id: 1" \
  -d '{"id":1}'
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| data.id | int | 自提单ID |
| data.order_no | string | 订单编号 |
| data.order_type | int | 订单类型（1=云仓自提，2=价差礼包自提） |
| data.order_type_text | string | 订单类型文本描述 |
| data.send_status | int | 发货状态（0=待发货，1=已发货，2=已完成，4=已取消） |
| data.send_status_text | string | 发货状态文本描述 |
| data.user | object/null | 下单用户信息（qimall_user 全量字段 + 增强字段，无则为 null） |
| data.details | array | 商品明细列表（来自 `qimall_addons_cloud_stock_agent_order_details` 表，返回方式与列表接口一致，每条含嵌套 `goods`） |
| data.num | int | 商品数量（主表 `qimall_addons_cloud_stock_agent_order.num` 字段透传，与 `details[].num` 相互独立，可能为 0） |
| data.name | string | 收货人姓名 |
| data.mobile | string | 收货人手机号（已脱敏） |
| data.address | string | 收货地址 |
| data.province_id | int | 省ID |
| data.city_id | int | 市ID |
| data.district_id | int | 区ID |
| data.town_id | int | 乡镇ID |
| data.region_name | string | 地区名称（省 市 区拼接） |
| data.express_code | string | 物流公司编码 |
| data.express_name | string | 物流公司名称 |
| data.express_no | string | 物流单号 |
| data.seller_remark | string | 卖家备注 |
| data.parent_agents | object/null | 多级上级代理数据（含 parent / second_parent / third_parent） |
| data.parent_agents.parent | object/null | 直推人数据（{user: qimall_user 全量字段, agent: 代理信息}） |
| data.parent_agents.second_parent | object/null | 二级推荐人数据（{user: qimall_user 全量字段, agent: 代理信息}） |
| data.parent_agents.third_parent | object/null | 三级推荐人数据（{user: qimall_user 全量字段, agent: 代理信息}） |
| data.highest_user | object/null | 分区关系树顶级用户数据（{user: qimall_user 全量字段, agent: 代理信息}） |
| data.table_express_status | int | 单据物流状态（0=未完成，1=已完成） |
| data.express_status | int | 物流状态（物流公司官网状态码） |
| data.is_shipping_refunded | int | 是否已退运费（0=否，1=是） |
| data.is_delivery_address_modified | int | 收货地址是否修改过（0=否，1=是） |
| data.refunds | array | 退款单列表（来自 `qimall_addons_cloud_stock_agent_order_refund` 表，全量字段） |
| data.created_at | int | 创建时间戳 |
| data.created_at_text | string | 创建时间文本（Y-m-d H:i:s） |
| data.updated_at | int | 更新时间戳 |
| data.updated_at_text | string | 更新时间文本（Y-m-d H:i:s） |

### user 字段说明（detail）

> 来源表：`qimall_user`，返回用户表全量字段（已过滤 `password` / `transaction_password`），**未附带增强字段**（与列表接口不同）。
>
> `mobile` **未脱敏**，为真实手机号明文返回。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 用户ID |
| username | string | 用户账号（手机号） |
| nickname | string | 用户昵称 |
| avatar_url | string | 用户头像URL |
| mobile | string | 手机号（未脱敏，明文返回） |
| level | int | 普通会员等级 |
| ... | ... | qimall_user 表其余字段 |

### parent_agents 字段说明

> 通过 `qimall_user.parent_id` / `second_parent_id` / `third_parent_id` 关联查询多级上级用户及其代理信息。

| 字段 | 类型 | 说明 |
|------|------|------|
| parent | object/null | 直推人数据 |
| parent.user | object/null | qimall_user 全量字段（无则为 null） |
| parent.agent | object/null | 云库存代理信息（id / user_id / level / status） |
| second_parent | object/null | 二级推荐人数据（结构同 parent） |
| second_parent.user | object/null | qimall_user 全量字段 |
| second_parent.agent | object/null | 云库存代理信息 |
| third_parent | object/null | 三级推荐人数据（结构同 parent） |
| third_parent.user | object/null | qimall_user 全量字段 |
| third_parent.agent | object/null | 云库存代理信息 |

### highest_user 字段说明（detail）

> 通过 `qimall_user_partition_relationship` 表获取 `tree` 字段，解码树顶节点获得 `highest_user_id`，关联 `qimall_user` 和 `qimall_addons_cloud_stock_agent` 表获取数据。

| 字段 | 类型 | 说明 |
|------|------|------|
| user | object/null | qimall_user 全量字段（无则为 null） |
| agent | object/null | 云库存代理信息（id / user_id / level / status） |

### 实现位置

> `addons/OpenApi/common/services/CloudStockAgentOrderService.php::getDetail()`
>
> 商品明细返回方式与列表接口一致：按 `order_id` 查询 `qimall_addons_cloud_stock_agent_order_details` 表（`status=1` 启用，按 `id ASC` 排序），每条明细嵌套 `goods` 对象（来自 `qimall_goods`，`id / goods_name / cover_pic`）。

### 响应示例

> 以下为真实接口返回示例（商城 `mall_id=1`，数据来源于生产库）。

```json
{
  "code": 0,
  "msg": "操作成功",
  "data": {
    "id": 17,
    "order_no": "CSP20260109101204835092",
    "order_type": 1,
    "order_type_text": "云仓自提",
    "send_status": 4,
    "send_status_text": "已取消",
    "user": {
      "id": 171973,
      "username": 18665546822,
      "nickname": "小明",
      "avatar_url": "https://slqy.oss-cn-shenzhen.aliyuncs.com/images/1/2026/01/03/image_1767427750_ldAalvCs.jpg",
      "mobile": 18665546822,
      "level": 5,
      ...
    },
    "details": [
      {
        "id": 17,
        "user_id": 171973,
        "mall_id": 1,
        "goods_id": 1,
        "order_id": 17,
        "num": 24,
        "status": 1,
        "created_at": 1767924724,
        "updated_at": 1767924724,
        "goods": {
          "id": 1,
          "goods_name": "尝鲜装",
          "cover_pic": "https://slqy.oss-cn-shenzhen.aliyuncs.com/images/1/2026/01/28/image_1769571945_L0MqaY1z.jpg"
        }
      }
    ],
    "num": 0,
    "name": "李四",
    "mobile": "189****9911",
    "address": "广东省广州市天河区",
    "province_id": 1941,
    "city_id": 1942,
    "district_id": 1947,
    "town_id": 26079,
    "region_name": "广东省 广州市 天河区",
    "express_code": "",
    "express_name": "",
    "express_no": "",
    "seller_remark": "",
    "parent_agents": {
      "parent": {
        "user": { "id": 171865, "username": 13066481413, "nickname": "张三", ... },
        "agent": { "id": 79, "user_id": 171865, "level": 8, "status": 1 }
      },
      "second_parent": {
        "user": { "id": 171824, "username": 17342689911, "nickname": "李四", ... },
        "agent": { "id": 37, "user_id": 171824, "level": 8, "status": 1 }
      },
      "third_parent": {
        "user": { "id": 171809, "username": 18983837289, "nickname": "王五", ... },
        "agent": { "id": 25, "user_id": 171809, "level": 8, "status": 1 }
      }
    },
    "highest_user": {
      "user": { "id": 171754, "username": 13168686868, "nickname": "顶级用户", ... },
      "agent": { "id": 24, "user_id": 171754, "level": 8, "status": 1 }
    },
    "table_express_status": 0,
    "express_status": 9,
    "is_shipping_refunded": 0,
    "is_delivery_address_modified": 0,
    "refunds": [],
    "created_at": 1767924724,
    "created_at_text": "2026-01-09 10:12:04",
    "updated_at": 1767929410,
    "updated_at_text": "2026-01-09 11:30:10"
  }
}
```

---

## 3. 常量映射

### 请求

```
POST /open-api/v1/cloud-stock-agent-order/constants
```

### 请求参数

无请求参数。

### 请求示例

```bash
curl -X POST "http://api.ten.com/open-api/v1/cloud-stock-agent-order/constants" \
  -H "Host: api.ten.com" \
  -H "Content-Type: application/json" \
  -H "mall-id: 1"
```

### 响应参数

返回按字段分组的枚举映射，每个字段包含 `desc`（中文说明）和 `map`（值-标签数组）。

| 字段 | 类型 | 说明 |
|------|------|------|
| data.order_type | object | 订单类型枚举映射 |
| data.order_type.desc | string | 字段中文说明 |
| data.order_type.map | array | 枚举值映射数组 |
| data.send_status | object | 发货状态枚举映射 |
| data.send_status.desc | string | 字段中文说明 |
| data.send_status.map | array | 枚举值映射数组 |
| data.express_status | object | 物流状态枚举映射 |
| data.express_status.desc | string | 字段中文说明 |
| data.express_status.map | array | 枚举值映射数组 |
| data.cloud_stock_level | object | 云仓代理等级映射 |
| data.cloud_stock_level.desc | string | 字段中文说明 |
| data.cloud_stock_level.map | array | 等级数据数组 |

每个枚举字段格式：

```json
{
  "desc": "字段描述",
  "map": [
    { "value": 0, "label": "标签文本" },
    { "value": 1, "label": "标签文本" }
  ]
}
```

`cloud_stock_level` 字段格式：

```json
{
  "desc": "云仓代理等级",
  "map": [
    { "id": 1, "level": 1, "name": "等级名称" }
  ]
}
```

### 各枚举字段说明

**order_type（订单类型）**：

| 值 | 标签 | 说明 |
|----|------|------|
| 1 | 云仓自提 | 会员从云仓门店自提商品 |
| 2 | 价差礼包自提 | 价差礼包订单自提 |

**send_status（发货状态）**：

| 值 | 标签 | 说明 |
|----|------|------|
| 0 | 待发货 | 待发货 |
| 1 | 已发货 | 已发货 |
| 2 | 已完成 | 已完成（已核销 / 已自提） |
| 3 | 未支付运费 | 未支付运费（仅 order_type=1 且有运费时出现） |
| 4 | 已取消 | 已取消 |

**express_status（物流状态）**：

| 值 | 标签 | 说明 |
|----|------|------|
| 0 | 未完成 | 物流未完成 |
| 1 | 已完成 | 物流已完成 |

> 注：主表 `express_status` 字段默认值为 9，表示"物流公司官网状态码"（由物流接口实时返回，如 9=已签收等），取值以实际物流状态为准。

**cloud_stock_level（云仓代理等级）**：

> 来源表：`qimall_addons_cloud_stock_level`，查询条件含 `mall_id` + `status=1`（启用）。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 等级记录ID |
| level | int | 等级权重值 |
| name | string | 等级名称 |

### 响应示例

```json
{
  "code": 0,
  "msg": "操作成功",
  "data": {
    "order_type": {
      "desc": "订单类型",
      "map": [
        { "value": 1, "label": "云仓自提" },
        { "value": 2, "label": "价差礼包自提" }
      ]
    },
    "send_status": {
      "desc": "发货状态",
      "map": [
        { "value": 0, "label": "待发货" },
        { "value": 1, "label": "已发货" },
        { "value": 2, "label": "已完成" },
        { "value": 3, "label": "未支付运费" },
        { "value": 4, "label": "已取消" }
      ]
    },
    "express_status": {
      "desc": "物流状态",
      "map": [
        { "value": 0, "label": "未完成" },
        { "value": 1, "label": "已完成" }
      ]
    },
    "cloud_stock_level": {
      "desc": "云仓代理等级",
      "map": [
        { "id": 1, "level": 1, "name": "一级代理" },
        { "id": 2, "level": 2, "name": "二级代理" }
      ]
    }
  }
}
```

---

## 错误码

| code | msg | 场景 |
|------|-----|------|
| 0 | 操作成功 | 成功 |
| 1 | 商城签名不能为空 | 未传 x-mall-sign 或 mall-id |
| 1 | 商城不存在 | 签名对应的商城未找到 |
| 1 | 自提单ID不能为空 | detail 接口 id <= 0 |
| 1 | 自提单不存在 | detail 接口订单未找到 |

---

## 数据说明

### 手机号脱敏

接口下发时对部分手机号字段执行脱敏处理，规则为保留前 3 位和后 4 位，中间 4 位用 `****` 替换，例如：`138****8888`。

涉及字段：`mobile`（收货人）。

**例外**：`user.mobile` **未脱敏**，为真实手机号明文返回（当前实现为 qimall_user 字段透传，未执行脱敏）。

### 时间字段

所有时间字段（created_at / updated_at）为 Unix 时间戳（秒），同时接口额外返回格式化后的文本字段（`*_text`，格式 `Y-m-d H:i:s`），前端按需使用。

`start_time` / `end_time` 查询参数对应 `updated_at` 字段过滤。

### 排序规则

列表接口按 `id ASC` 排序（ID升序，最早订单优先）。

### num 字段说明

- 顶层 `num` 来自主表 `qimall_addons_cloud_stock_agent_order.num`（商品数量），为透传字段，**不代表明细数量之和**，历史数据可能为 0。
- 明细的 `details[].num` 来自明细表 `qimall_addons_cloud_stock_agent_order_details.num`（提货数量），两者相互独立。

### 分页限制

- page 最小值：1（小于 1 自动修正为 1）
- limit 范围：1~100（超出 100 自动截断为 100）

### 数据来源表

| 表名 | 说明 |
|------|------|
| `qimall_addons_cloud_stock_agent_order` | 自提单主表 |
| `qimall_addons_cloud_stock_agent_order_details` | 自提单商品明细表 |
| `qimall_addons_cloud_stock_agent_order_refund` | 自提单退款表 |
| `qimall_user` | 用户表（下单用户、上级代理用户） |
| `qimall_goods` | 商品表 |
| `qimall_common_express` | 物流公司表 |
| `qimall_addons_cloud_stock_agent` | 云库存代理商表（代理等级） |
| `qimall_addons_cloud_stock_level` | 云仓代理等级表 |
| `qimall_user_level` | 普通会员等级表 |
| `qimall_user_partition_relationship` | 用户分区关系表（highest_user 树顶节点） |
| `qimall_region` | 地区表（region_name 拼接用） |

---

## 关联关系

```
qimall_addons_cloud_stock_agent_order（自提单主表）
  ├── qimall_user（下单用户）                    1:1  通过 user_id 关联
  ├── qimall_addons_cloud_stock_agent_order_details（商品明细）  1:N  通过 order_id 关联
  │       └── qimall_goods（商品信息）           1:1  通过 details.goods_id 关联
  ├── qimall_common_express（物流公司）          1:1  通过 express_code 关联
  ├── qimall_addons_cloud_stock_agent（代理商）   1:N  通过 user_id 关联
  │       └── qimall_addons_cloud_stock_level（等级）  1:1  通过 level 关联
  ├── qimall_user（上级代理用户）               1:N  通过 parent_id / second_parent_id / third_parent_id 关联
  ├── qimall_user_partition_relationship（分区关系）  1:1  通过 user_id 关联，tree 字段解码得 highest_user_id
  │       └── qimall_user（顶级用户）            1:1  通过 highest_user_id 关联
  └── qimall_addons_cloud_stock_agent_order_refund（退款单）  1:N  通过 order_id 关联
```
