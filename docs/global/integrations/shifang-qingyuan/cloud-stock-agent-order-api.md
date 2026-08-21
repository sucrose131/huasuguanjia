# OpenApi 云库存自提单接口文档

> 版本：v1 | 更新日期：2026-08-20 | 插件：OpenApi

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
| data.list[].user | object/null | 下单用户信息（nickname / avatar_url / mobile，手机号；无则为 null） |
| data.list[].details | array | 商品明细列表（`qimall_addons_cloud_stock_agent_order_details` 全量字段，每个元素含嵌套 `goods`） |
| data.list[].num | int | 商品数量（主表 `qimall_addons_cloud_stock_agent_order.num` 字段透传，与 `details[].num` 相互独立，可能为 0） |
| data.list[].name | string | 收货人姓名 |
| data.list[].mobile | string | 收货人手机号（已脱敏，格式：138****8888） |
| data.list[].address | string | 收货地址 |
| data.list[].express_code | string | 物流公司编码 |
| data.list[].express_name | string | 物流公司名称 |
| data.list[].express_no | string | 物流单号 |
| data.list[].highest_user | object/null | 归属店铺用户信息（id / nickname / level / mobile，手机号；无则为 null） |
| data.list[].refunds | array | 退款单列表（来自 `qimall_addons_cloud_stock_agent_order_refund` 表，全量字段） |
| data.list[].created_at | int | 创建时间戳 |
| data.list[].created_at_text | string | 创建时间文本（Y-m-d H:i:s） |
| data.pagination | object | 分页信息 |
| data.pagination.total | int | 总记录数 |
| data.pagination.page | int | 当前页码 |
| data.pagination.page_size | int | 每页条数 |

### user 字段说明

> 来源表：`qimall_user`，按 `qimall_addons_cloud_stock_agent_order.user_id` 关联，仅查询 `id / nickname / avatar_url / mobile` 四个字段。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 用户ID |
| nickname | string | 用户昵称 |
| avatar_url | string | 用户头像URL |
| mobile | string | 手机号 |

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

### highest_user 字段说明

> 来源表：`qimall_addons_cloud_stock_agent`（关联 `qimall_user`），按 `highest_user_id` 关联，查询条件含 `mall_id` + `status=1`（启用）。字段为 qimall_user 的 `id / nickname / avatar_url / mobile` 四个字段透传，另附 `level`（云库存代理等级）。
>
> 注意：`mobile` **未脱敏**，为真实手机号明文返回（与 `user` / 收货人 `mobile` 的脱敏行为不同）。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 归属店铺用户ID |
| nickname | string | 归属店铺用户昵称 |
| avatar_url | string | 归属店铺用户头像URL |
| mobile | string | 手机号（未脱敏，明文返回） |
| level | int | 云库存代理等级 |

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
> 所有关联数据（用户 / 商品明细 / 物流公司 / 归属店铺 / 退款单）均按主键批量查询后分组组装，避免 N+1。

### 响应示例

> 以下为真实接口返回示例（商城 `mall_id=1`，数据来源于生产库 `qimall_prod`）。

```json
{
    "code": 0,
    "msg": "操作成功",
    "data": {
        "list": [
            {
                "id": 6,
                "order_no": "CSP20251225131702968925",
                "order_type": 1,
                "order_type_text": "云仓自提",
                "send_status": 2,
                "send_status_text": "已完成",
                "user": {
                    "id": 171758,
                    "base64_code": "FXK",
                    "mall_id": 1,
                    "mch_id": 0,
                    "store_id": 0,
                    "username": 13787956299,
                    "area_code": 86,
                    "mobile": 13787956299,
                    "nickname": "缘份天注定",
                    "birthday": 0,
                    "avatar_url": "https://slqy.oss-cn-shenzhen.aliyuncs.com/images/1/2025/12/25/image_1766625225_dJ5B8B3j.jpg",
                    "platform": "mp-wx",
                    "temp_parent_id": 0,
                    "parent_id": 171755,
                    "second_parent_id": 171754,
                    "third_parent_id": 0,
                    "junior_at": 0,
                    "last_login_at": 1783492626,
                    "upgrade_level_at": 1767497284,
                    "inviter_at": 0,
                    "login_ip": "120.227.212.10",
                    "is_inviter": 1,
                    "status": 1,
                    "level": 5,
                    "source": 1,
                    "signature_title": null,
                    "signature_content": null,
                    "background": null,
                    "created_at": 1766468788,
                    "updated_at": 1783492626,
                    "verification_token": null,
                    "device_type": "android",
                    "device_mac": "a9:35:26:22:83:ef",
                    "inviter_source": 0
                },
                "details": [
                    {
                        "id": 6,
                        "user_id": 171758,
                        "mall_id": 1,
                        "goods_id": 1,
                        "order_id": 6,
                        "num": 3,
                        "status": 1,
                        "created_at": 1766639822,
                        "updated_at": 1766639822,
                        "goods": {
                            "id": 1,
                            "goods_name": "尝鲜装",
                            "cover_pic": "https://slqy.oss-cn-shenzhen.aliyuncs.com/images/1/2026/01/28/image_1769571945_L0MqaY1z.jpg"
                        }
                    }
                ],
                "num": 0,
                "name": "杜修君",
                "mobile": "150****7079",
                "address": "江苏省苏州市昆山市千灯镇锦景园26栋",
                "express_code": "SF",
                "express_name": "顺丰速运",
                "express_no": "SF0257790655543",
                "highest_user": {
                    "id": 171758,
                    "base64_code": "FXK",
                    "mall_id": 1,
                    "mch_id": 0,
                    "store_id": 0,
                    "username": 13787956299,
                    "area_code": 86,
                    "mobile": 13787956299,
                    "nickname": "缘份天注定",
                    "birthday": 0,
                    "avatar_url": "https://slqy.oss-cn-shenzhen.aliyuncs.com/images/1/2025/12/25/image_1766625225_dJ5B8B3j.jpg",
                    "platform": "mp-wx",
                    "temp_parent_id": 0,
                    "parent_id": 171755,
                    "second_parent_id": 171754,
                    "third_parent_id": 0,
                    "junior_at": 0,
                    "last_login_at": 1783492626,
                    "upgrade_level_at": 1767497284,
                    "inviter_at": 0,
                    "login_ip": "120.227.212.10",
                    "is_inviter": 1,
                    "status": 1,
                    "level": 8,
                    "source": 1,
                    "signature_title": null,
                    "signature_content": null,
                    "background": null,
                    "created_at": 1766468788,
                    "updated_at": 1783492626,
                    "verification_token": null,
                    "device_type": "android",
                    "device_mac": "a9:35:26:22:83:ef",
                    "inviter_source": 0
                },
                "refunds": [],
                "created_at": 1766639822,
                "created_at_text": "2025-12-25 13:17:02"
            }
        ],
        "pagination": {
            "total": 494,
            "page": 1,
            "page_size": 1
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
| data.user | object/null | 下单用户信息（id / nickname / avatar_url / mobile，已脱敏；无则为 null） |
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
| data.highest_user | object/null | 归属店铺用户信息（id / nickname / level / mobile，已脱敏；无则为 null） |
| data.table_express_status | int | 单据物流状态（0=未完成，1=已完成） |
| data.express_status | int | 物流状态（物流公司官网状态） |
| data.is_shipping_refunded | int | 是否已退运费（0=否，1=是） |
| data.is_delivery_address_modified | int | 收货地址是否修改过（0=否，1=是） |
| data.refunds | array | 退款单列表（来自 `qimall_addons_cloud_stock_agent_order_refund` 表，全量字段） |
| data.created_at | int | 创建时间戳 |
| data.created_at_text | string | 创建时间文本（Y-m-d H:i:s） |
| data.updated_at | int | 更新时间戳 |
| data.updated_at_text | string | 更新时间文本（Y-m-d H:i:s） |

### 实现位置

> `addons/OpenApi/common/services/CloudStockAgentOrderService.php::getDetail()`
>
> 商品明细返回方式与列表接口一致：按 `order_id` 查询 `qimall_addons_cloud_stock_agent_order_details` 表（`status=1` 启用，按 `id ASC` 排序），每条明细嵌套 `goods` 对象（来自 `qimall_goods`，`id / goods_name / cover_pic`）。

### 响应示例

> 以下为真实接口返回示例（商城 `mall_id=1`，数据来源于生产库 `qimall_prod`）。

```json
{
  "code": 0,
  "msg": "操作成功",
  "data": {
    "id": 6,
    "order_no": "CSP20251225131702968925",
    "order_type": 1,
    "order_type_text": "云仓自提",
    "send_status": 2,
    "send_status_text": "已完成",
    "user": {
      "id": 171758,
      "nickname": "缘份天注定",
      "avatar_url": "https://slqy.oss-cn-shenzhen.aliyuncs.com/images/1/2025/12/25/image_1766625225_dJ5B8B3j.jpg",
      "mobile": "137****6299"
    },
    "details": [
      {
        "id": 6,
        "user_id": 171758,
        "mall_id": 1,
        "goods_id": 1,
        "order_id": 6,
        "num": 3,
        "status": 1,
        "created_at": 1766639822,
        "updated_at": 1766639822,
        "goods": {
          "id": 1,
          "goods_name": "尝鲜装",
          "cover_pic": "https://slqy.oss-cn-shenzhen.aliyuncs.com/images/1/2026/01/28/image_1769571945_L0MqaY1z.jpg"
        }
      }
    ],
    "num": 0,
    "name": "杜修君",
    "mobile": "150****7079",
    "address": "江苏省苏州市昆山市千灯镇锦景园26栋",
    "province_id": 811,
    "city_id": 850,
    "district_id": 858,
    "town_id": 11617,
    "region_name": "江苏省 苏州市 昆山市",
    "express_code": "SF",
    "express_name": "顺丰速运",
    "express_no": "SF0257790655543",
    "seller_remark": "",
    "highest_user": {
      "id": 171758,
      "nickname": "缘份天注定",
      "avatar_url": "https://slqy.oss-cn-shenzhen.aliyuncs.com/images/1/2025/12/25/image_1766625225_dJ5B8B3j.jpg",
      "mobile": "13787956299",
      "level": 8
    },
    "table_express_status": 0,
    "express_status": 9,
    "is_shipping_refunded": 0,
    "is_delivery_address_modified": 0,
    "refunds": [],
    "created_at": 1766639822,
    "created_at_text": "2025-12-25 05:17:02",
    "updated_at": 1767875299,
    "updated_at_text": "2026-01-08 12:28:19"
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

> 注：常量映射仅给出 0/1 两个枚举，但主表 `express_status` 字段默认值为 9，表示"物流公司官网状态码"（由物流接口实时返回，如 9=已签收等），取值以实际物流状态为准。

| 值 | 标签 | 说明 |
|----|------|------|
| 0 | 未完成 | 物流未完成 |
| 1 | 已完成 | 物流已完成 |

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

接口下发时对大部分手机号字段执行脱敏处理，规则为保留前 3 位和后 4 位，中间 4 位用 `****` 替换，例如：`138****8888`。

涉及字段：`user.mobile`、`mobile`（收货人）。

**例外**：`highest_user.mobile` **未脱敏**，为真实手机号明文返回（当前实现为 qimall_user 字段透传，未执行脱敏）。

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
| `qimall_user` | 用户表（下单用户、归属店铺用户） |
| `qimall_goods` | 商品表 |
| `qimall_common_express` | 物流公司表 |
| `qimall_addons_cloud_stock_agent` | 云库存代理商表（归属店铺等级） |
| `qimall_region` | 地区表（region_name 拼接用） |

---

## 关联关系

```
qimall_addons_cloud_stock_agent_order（自提单主表）
  ├── qimall_user（下单用户）                    1:1  通过 user_id 关联
  ├── qimall_addons_cloud_stock_agent_order_details（商品明细）  1:N  通过 order_id 关联
  │       └── qimall_goods（商品信息）           1:1  通过 details.goods_id 关联
  ├── qimall_common_express（物流公司）          1:1  通过 express_code 关联
  ├── qimall_addons_cloud_stock_agent（归属店铺） 1:1  通过 highest_user_id 关联
  │       └── qimall_user（归属店铺用户）        1:1  通过 user_id 关联
  └── qimall_addons_cloud_stock_agent_order_refund（退款单）  1:N  通过 order_id 关联
```
