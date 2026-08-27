# OpenApi 订单接口文档

> 版本：v1 | 更新日期：2026-08-20 | 插件：OpenApi

## 概述

订单接口提供订单列表、订单详情、售后列表和常量映射四个 POST 接口，用于第三方系统获取商城订单及售后数据。

> **重要**：`list` 接口的每个订单元素包含嵌套数据（**order/order_type/details/refunds/actions/behavior_logs/express/extra/user**，共 9 个）；**发票字段 invoice 不返回**（如需发票请调用 detail 接口）。`user` 字段补充：直推人信息（parent_mobile / parent_username / parent_nickname）、会员等级名称（level_name，来自 qimall_user_level）、云库存代理等级（cloud_stock_level / cloud_stock_level_name，来自 qimall_addons_cloud_stock_agent + qimall_addons_cloud_stock_level）。各字段来源详见 [user 字段说明](#user-字段说明仅-list-接口返回-11无则为-null)。`refunds` 嵌套字段对齐 `refund-list` 接口（含 steps / detail / order）。`extra` 在无数据时统一返回空数组 `[]`。

> **云库存字段扁平化**：**只有 `detail` 接口**在订单有云库存关联数据时，返回 9 个扁平数组（`cloud_stock_buying_orders` / `cloud_stock_fill_orders` / `cloud_stock_fill_order_relation` / `cloud_stock_stock_logs` / `cloud_stock_offer_orders` / `cloud_stock_agent_orders` / `cloud_stock_dispense_orders` / `cloud_stock_shipping_orders` / `cloud_stock_refund_orders`），与 `order` / `details` / `refunds` / `user` 同级。对象间通过 `related_order_ids` / `shipping_doc_ids` / `refund_doc_ids` 的 **纯 ID 引用** 关联，消费端按 ID 在顶层数组查找即可。**list 接口不返回云库存字段**（`assembleOrderList` 仅组装 order/details/user/order_type + includes 配置的 refunds/actions/behavior_logs/express/extra）。无数据时 9 键全部为 `[]`。详见下方 §云库存 9 顶层字段说明。

- **基础路径**：`/open-api/v1/order/`
- **请求方式**：POST（JSON body）
- **Content-Type**：`application/json`
- **免登录**：list、detail、refund-list、constants 接口均免登录验证

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

## 1. 订单列表

### 请求

```
POST /open-api/v1/order/list
```

### 请求参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| page | int | 否 | 1 | 页码，最小值1 |
| limit | int | 否 | 20 | 每页条数，最大值100 |
| order_no | string | 否 | - | 订单编号精确搜索 |
| order_status | int | 否 | - | 订单状态过滤 |
| pay_status | int | 否 | - | 支付状态过滤（默认只返回已支付订单 pay_status=1） |
| shipping_status | int | 否 | - | 配送状态过滤 |
| start_time | string | 否 | - | 更新时间起始(Y-m-d H:i:s) |
| end_time | string | 否 | - | 更新时间截止(Y-m-d H:i:s) |

> **注意**：订单列表接口默认过滤未支付订单（`pay_status=1`），如需查看所有订单请显式传入 `pay_status` 参数。

### 请求示例

```bash
curl -X POST "http://api.ten.com/open-api/v1/order/list" \
  -H "Host: api.ten.com" \
  -H "Content-Type: application/json" \
  -H "mall-id: 1" \
  -d '{"page":1,"limit":5}'
```

### 响应参数

> **说明**：list 接口每个订单元素的字段结构 = order/details/user/order_type + includes 配置的可选数据块（refunds/actions/behavior_logs/express/extra）。**list 不返回云库存 9 个字段（cloud_stock_*）与 invoice**，云库存数据需调用 detail 接口获取（详见 [2. 订单详情](#2-订单详情)）。

| 字段 | 类型 | 说明 |
|------|------|------|
| data.list | array | 订单列表 |
| data.list[].order | object | 订单主信息（qimall_order 全量字段，同详情 order） |
| data.list[].order_type | int | 订单出库类型（与 order 同级；list 使用简化算法 `calcOrderTypeSimple`，与 detail 完整算法不同，详见 [order_type 字段说明](#order_type-字段说明list--detail-逻辑不同)） |
| data.list[].details | array | 订单明细列表（含嵌套 marketing，同详情 details） |
| data.list[].refunds | array | 售后单列表（含嵌套 steps；`detail` / `order` 恒为 null，需调用 refund-list 接口获取完整关联） |
| data.list[].actions | array | 操作日志列表（同详情 actions） |
| data.list[].behavior_logs | array | 行为日志列表（同详情 behavior_logs） |
| data.list[].express | array | 物流信息列表（同详情 express） |
| data.list[].extra | array | 订单留言（1:1，有数据为长度1的数组，无数据则为 `[]`，统一数组格式方便 length 判断） |
| data.list[].user | object/null | 下单会员（qimall_user 全量字段 + level_name / parent_mobile / parent_username / parent_nickname / cloud_stock_level / cloud_stock_level_name，已过滤 password、transaction_password，1:1，无则为 null） |
| data.pagination | object | 分页信息 |
| data.pagination.total | int | 总记录数 |
| data.pagination.page | int | 当前页码 |
| data.pagination.page_size | int | 每页条数 |

### order 字段说明（qimall_order 表）

| 字段 | 类型 | 说明 | 表名 | 数据库字段 | comment |
|------|------|------|------|------|------|
| id | int | 订单ID | qimall_order | id | 订单id |
| mall_id | int | 商城ID | qimall_order | mall_id | 商城ID |
| mch_id | int | 多商户ID，0表示商城订单 | qimall_order | mch_id | 多商户id，0表示商城订单 |
| store_id | int | 门店ID | qimall_order | store_id | 门店id |
| user_id | int | 用户ID | qimall_order | user_id | 用户id |
| order_no | string | 订单编号 | qimall_order | order_no | 订单编号 |
| out_trade_no | string | 外部交易号 | qimall_order | out_trade_no | 外部交易号 |
| mobile | string | 收货人手机号 | qimall_order | mobile | 收货人的手机号码 |
| province | int | 收货人所在省 | qimall_order | province | 收货人所在省 |
| city | int | 收货人所在城市 | qimall_order | city | 收货人所在城市 |
| area | int | 收货人所在街道 | qimall_order | area | 收货人所在街道 |
| town | int | 收货人所在镇 | qimall_order | town | |
| community | int | 收货人所在社区 | qimall_order | community | 小区ID |
| address | string | 收货详细地址 | qimall_order | address | 详细地址 |
| region_name | string | 收货地区名称 | qimall_order | region_name | 地区名称（省市区[乡/镇]） |
| zip | string | 收货人邮编 | qimall_order | zip | 收货人邮编 |
| receiver_name | string | 收货人姓名 | qimall_order | receiver_name | 收货人姓名 |
| remark | string | 用户订单备注 | qimall_order | remark | 用户订单备注 |
| seller_remark | string | 商家订单备注 | qimall_order | seller_remark | 商家订单备注 |
| shipping_type | int | 配送方式 | qimall_order | shipping_type | 订单配送方式【1物流配送 2买家自提 3货到付款 4本地配送】 |
| shipping_money | decimal | 订单运费 | qimall_order | shipping_money | 订单运费 |
| reduce_shipping_money | decimal | 满邮减免 | qimall_order | reduce_shipping_money | 满邮减免 |
| refund_money | decimal | 订单退款金额 | qimall_order | refund_money | 订单退款金额 |
| pay_money | decimal | 订单实付金额 | qimall_order | pay_money | 订单实付金额 |
| goods_price | decimal | 商品优惠后总价 | qimall_order | goods_price | 商品优惠后总价 |
| original_goods_price | decimal | 商品原本总价 | qimall_order | original_goods_price | 商品原本总价 |
| ip | string | 买家IP | qimall_order | ip | 买家ip |
| coupon_id | int | 优惠券ID | qimall_order | coupon_id | 优惠券券id |
| coupon_money | decimal | 优惠券支付金额 | qimall_order | coupon_money | 优惠券券支付金额 |
| score | decimal | 消耗积分 | qimall_order | score | 订单消耗积分 |
| score_money | decimal | 积分抵扣金额 | qimall_order | score_money | 订单消耗积分抵多少钱 |
| order_status | int | 订单状态 | qimall_order | order_status | 订单状态 |
| pay_status | int | 付款状态 | qimall_order | pay_status | 订单付款状态 |
| shipping_status | int | 配送状态 | qimall_order | shipping_status | 订单配送状态 |
| review_status | int | 评价状态 | qimall_order | review_status | 订单评价状态 |
| is_feedback | int | 售后状态 | qimall_order | is_feedback | 订单售后状态:0:未售后；1：售后中；2：售后完成 |
| payment_type | int | 支付类型 | qimall_order | payment_type | 支付类型 |
| marketing_id | int | 营销活动ID | qimall_order | marketing_id | 营销活动id |
| marketing_type | string | 营销活动类型 | qimall_order | marketing_type | |
| invoice_id | int | 发票ID | qimall_order | invoice_id | 发票id |
| status | int | 状态 | qimall_order | status | 状态[-1:删除;0:禁用;1启用] |
| is_comment | int | 是否评价 | qimall_order | is_comment | 是否评价 0为未评价 1为已评价 2为已追评 |
| is_recycle | int | 是否回收站 | qimall_order | is_recycle | 是否加入回收站【1是 0否】 |
| is_virtual | int | 是否包含虚拟商品 | qimall_order | is_virtual | 是否包含虚拟商品【1是 0否】 |
| is_new_user | int | 是否新顾客 | qimall_order | is_new_user | 是否新顾客 |
| pay_time | int | 付款时间戳 | qimall_order | pay_time | 订单付款时间 |
| shipping_time | int | 要求配送时间戳 | qimall_order | shipping_time | 买家要求配送时间 |
| sign_time | int | 签收时间戳 | qimall_order | sign_time | 买家签收时间 |
| consign_time | int | 发货时间戳 | qimall_order | consign_time | 卖家发货时间 |
| finish_time | int | 完成时间戳 | qimall_order | finish_time | 订单完成时间 |
| close_time | int | 关闭时间戳 | qimall_order | close_time | 关闭的时间 |
| extra_info | string | 额外信息 | qimall_order | extra_info | |
| order_source | string | 订单来源 | qimall_order | order_source | 订单来源：juhe_shop=>聚合供应链 |
| created_at | int | 创建时间戳 | qimall_order | created_at | 创建时间 |
| updated_at | int | 更新时间戳 | qimall_order | updated_at | 更新时间 |
| is_bill | int | 是否开票 | qimall_order | is_bill | 是否已开票 0 否 1 是 |
| bill_time | int | 开票时间戳 | qimall_order | bill_time | 开票时间 |
| clerk_code | string | 核销码 | qimall_order | clerk_code | 核销码 |
| is_print | int | 是否打印 | qimall_order | is_print | 是否已打印 0 否 1 是 |
| extra_data | array | 额外信息（JSON自动解码） | qimall_order | extra_data | 额外数据 |
| goods_subtype | int | 商品子类型 | qimall_order | goods_subtype | 订单商品子类型（0:普通商品 其他:根据商品的goods_subtype而定） |

### details 字段说明（qimall_order_detail 表）

| 字段 | 类型 | 说明 | 表名 | 数据库字段 | comment |
|------|------|------|------|------|------|
| id | int | 订单项ID | qimall_order_detail | id | 订单项ID |
| mall_id | int | 商城ID | qimall_order_detail | mall_id | 商城ID |
| order_id | int | 订单ID | qimall_order_detail | order_id | 订单ID |
| user_id | int | 用户ID | qimall_order_detail | user_id | 用户id |
| mch_id | int | 多商户ID | qimall_order_detail | mch_id | 店铺ID |
| store_id | int | 门店ID | qimall_order_detail | store_id | 门店id |
| goods_id | int | 商品ID | qimall_order_detail | goods_id | 商品ID |
| goods_name | string | 商品名称 | qimall_order_detail | goods_name | 商品名称 |
| goods_attr_id | int | 规格ID | qimall_order_detail | goods_attr_id | 规格ID |
| goods_attr_name | string | 规格名称 | qimall_order_detail | goods_attr_name | 规格名称 |
| sign_id | string | 规格ID标识 | qimall_order_detail | sign_id | 规格ID标识 |
| attr_groups_format | string | 格式化规格组 | qimall_order_detail | attr_groups_format | 格式化规格组 |
| price | decimal | 商品价格 | qimall_order_detail | price | 商品价格 |
| cost_price | decimal | 成本价 | qimall_order_detail | cost_price | 商品成本价 |
| num | int | 购买数量 | qimall_order_detail | num | 购买数量 |
| adjust_money | decimal | 调整金额 | qimall_order_detail | adjust_money | 调整金额 |
| goods_price | decimal | 优惠后总价 | qimall_order_detail | goods_price | 商品优惠后总价 |
| original_goods_price | decimal | 原本总价 | qimall_order_detail | original_goods_price | 商品原本总价 |
| pic_url | string | 商品图片 | qimall_order_detail | pic_url | 商品图片 |
| marketing_id | int | 促销ID | qimall_order_detail | marketing_id | 促销ID |
| marketing_type | string | 促销类型 | qimall_order_detail | marketing_type | 促销类型 |
| order_type | int | 订单类型 | qimall_order_detail | order_type | 订单类型 |
| give_score | int | 赠送积分 | qimall_order_detail | give_score | 赠送积分数量 |
| order_status | int | 订单状态 | qimall_order_detail | order_status | 订单状态【0待付款 1待发货 2 已发货 3已收货 4已完成 -1申请售后 -2售后中 -3售后完成 -4 已关闭 -5撤销售后】 |
| shipping_status | int | 物流状态 | qimall_order_detail | shipping_status | 物流状态【1已发货 0待发货】 |
| is_feedback | int | 退款状态 | qimall_order_detail | is_feedback | 订单售后状态【0未售后 1售后中 2售后完成】 |
| remark | string | 备注 | qimall_order_detail | remark | 备注 |
| is_evaluate | int | 是否评价 | qimall_order_detail | is_evaluate | 是否评价【0未评价 1已评价 2已追评】 |
| refund_balance_money | decimal | 退款余额 | qimall_order_detail | refund_balance_money | 订单退款余额 |
| is_virtual | int | 是否虚拟商品 | qimall_order_detail | is_virtual | 是否包含虚拟商品 0不包含 1包含 |
| status | int | 状态 | qimall_order_detail | status | 状态[-1:删除;0:禁用;1启用] |
| extra_info | string | 额外信息 | qimall_order_detail | extra_info | |
| created_at | int | 创建时间戳 | qimall_order_detail | created_at | |
| updated_at | int | 更新时间戳 | qimall_order_detail | updated_at | |
| order_source | string | 订单来源 | qimall_order_detail | order_source | 订单来源：juhe_shop=>聚合供应链 |
| shipped_num | int | 已发货数量 | qimall_order_detail | shipped_num | 已发货数量 |
| extra_data | array | 额外信息（JSON自动解码） | qimall_order_detail | extra_data | 额外数据 |
| unit | string | 单位 | qimall_order_detail | unit | 商品单位 |
| goods_subtype | int | 商品子类型 | qimall_order_detail | goods_subtype | 商品子类型（0:普通商品 其他:根据商品的goods_subtype而定） |
| marketing | object/null | 营销信息（1:1嵌套，无则为 null，字段说明见 [details[].marketing 字段说明](#detailsmarketing-字段说明qimall_order_marketing-表1嵌套)） | qimall_order_marketing | - | 通过 order_detail_id 关联 |

### 其他嵌套字段来源说明

> 以下为 list 接口除 order / details / user / order_type 外的 5 个可选嵌套数据块（由后台配置 `order_list_include` 控制，默认全部返回）。每个数据块给出**来源表、关联键、查询条件、默认值**，完整字段注释见对应跳转链接（字段表与 detail 接口共用，避免重复）。
>
> **实现位置**：`addons/OpenApi/common/services/OrderService.php`（getList → batchLoadOrderPrimaryData → buildOrderRelationMaps → assembleOrderList），所有关联数据按 order_id / user_id 批量查询后分组组装，避免 N+1。

| 字段 | 类型 | 来源表 | 关联键 | 查询条件 | 默认值 | 字段说明 |
|------|------|--------|--------|----------|--------|----------|
| data.list[].refunds | array | qimall_order_refund | `qimall_order_refund.order_id` = `qimall_order.id` | `status = 1`（启用） | `[]` | [refunds 字段说明](#refunds-字段说明qimall_order_refund-表) |
| data.list[].refunds[].steps | array | qimall_order_refund_step | `qimall_order_refund_step.order_refund_id` = `qimall_order_refund.id` | `status = 1`，按 `id ASC` | `[]` | [refunds[].steps 字段说明](#refundssteps-字段说明qimall_order_refund_step-表1n嵌套) |
| data.list[].refunds[].detail | object/null | qimall_order_detail | `qimall_order_refund.order_detail_id` = `qimall_order_detail.id` | 无 status 过滤，1:1 | `null`（list 简化模式恒为 null，需用 refund-list） | 字段同 [details 字段说明](#details-字段说明qimall_order_detail-表)（不含 marketing 嵌套） |
| data.list[].refunds[].order | object/null | qimall_order | `qimall_order_refund.order_id` = `qimall_order.id` | 复用本批 orderList，1:1 | `null`（list 简化模式恒为 null，需用 refund-list） | 字段同 [order 字段说明](#order-字段说明qimall_order-表) |
| data.list[].actions | array | qimall_order_action | `qimall_order_action.order_id` = `qimall_order.id` | `status = 1`，按 `id ASC` | `[]` | [actions 字段说明](#actions-字段说明qimall_order_action-表) |
| data.list[].behavior_logs | array | qimall_order_behavior_logs | `qimall_order_behavior_logs.order_id` = `qimall_order.id` | `status = 1`，按 `id ASC` | `[]` | [behavior_logs 字段说明](#behavior_logs-字段说明qimall_order_behavior_logs-表) |
| data.list[].express | array | qimall_order_express | `qimall_order_express.order_id` = `qimall_order.id` | `status = 1` | `[]` | [express 字段说明](#express-字段说明qimall_order_express-表) |
| data.list[].extra | array | qimall_order_extra | `qimall_order_extra.order_id` = `qimall_order.id` | 无 status 过滤，1:1 包装为长度1数组 | `[]`（无数据时统一空数组，便于 length 判断） | [extra 字段说明](#extra-字段说明qimall_order_extra-表11包装为数组格式统一返回) |
| data.list[].user | object/null | qimall_user | `qimall_user.id` = `qimall_order.user_id` | 无 mall_id / status 过滤（原样返回，含禁用用户）；下发前剔除 password、transaction_password | `null`（订单无 user_id 时） | [user 字段说明](#user-字段说明仅-list-接口返回11无则为-null) |

> **refunds 嵌套结构**：list 接口的 `refunds[]` 中 `steps` 有值（对齐 refund-list），但 `detail` / `order` **恒为 `null`**（简化模式，不组装嵌套明细/订单）；如需售后关联的 detail / order 请调用 `refund-list` 接口。三方系统解析 list 时勿依赖 `refunds[].detail` / `refunds[].order`。
>
> **user 仅 list 接口返回**：detail 接口不返回 user 字段。user 额外补充 6 个字段（parent_mobile / parent_username / parent_nickname / level_name / cloud_stock_level / cloud_stock_level_name），来源详见 [user 字段说明 - 4.2 补充字段](#42-接口已实现的补充字段来源关联其他表组装)。
>
> **JSON 字段自动解码**：所有嵌套数据中的 JSON 类型字段（如 refunds[].pic_list、express[].order_detail_ids、extra[].extra_data 等）在返回前已自动 json_decode，直接作为对象/数组下发，无需客户端二次解析。

### 响应示例

```json
{
  "code": 0,
  "msg": "操作成功",
  "data": {
    "list": [
      {
        "order": {
          "id": 47,
          "mall_id": 1,
          "order_no": "s20251223145442156603",
          "user_id": 171755,
          "pay_money": "11976.00",
          "goods_price": "11976.00",
          "order_status": 4,
          "pay_status": 1,
          "shipping_status": 2,
          "created_at": 1766472882,
          "...": "qimall_order 全量字段"
        },
        "order_type": 1,
        "details": [
          {
            "id": 47,
            "order_id": 47,
            "goods_id": 13,
            "goods_name": "颐养包",
            "goods_attr_name": "",
            "price": "11976.00",
            "num": 1,
            "pic_url": "https://...",
            "marketing": null,
            "...": "qimall_order_detail 全量字段"
          }
        ],
        "refunds": [],
        "actions": [
          { "id": 185, "order_id": 47, "action": "手机号为：15274434888 用户订单创建成功", "member_name": "微信用户", "...": "qimall_order_action 全量字段" }
        ],
        "behavior_logs": [
          { "id": 191, "order_id": 47, "behavior": 1, "operator_user_type": 2, "extra_info": null, "...": "qimall_order_behavior_logs 全量字段" }
        ],
        "express": [
          { "id": 33, "order_id": 47, "order_detail_ids": ["47"], "nums": {"47": "1"}, "...": "qimall_order_express 全量字段" }
        ],
        "extra": [],
        "user": {
          "id": 171755, "base64_code": "FXH", "mobile": "15274434888", "username": "15274434888", "nickname": "十方清源",
          "level": 5, "level_name": "服务商",
          "parent_id": 171754, "parent_mobile": "13168686868", "parent_username": "13168686868", "parent_nickname": "十方清源",
          "second_parent_id": 0, "third_parent_id": 0,
          "cloud_stock_level": 8, "cloud_stock_level_name": "批发商",
          "platform": "mp-wx", "status": 1,
          "...": "qimall_user 全量字段（已过滤 password、transaction_password）"
        }
      }
    ],
    "pagination": {
      "total": 1291,
      "page": 1,
      "page_size": 1
    }
  }
}
```

> **list 不返回云库存字段**：以上示例基于真实返回（订单 id=47），list 接口每个订单元素**不含** `cloud_stock_*` 9 个字段，也不含 `invoice`。如需云库存出入库流水等数据请调用 detail 接口。

---

## 2. 订单详情

### 请求

```
POST /open-api/v1/order/detail
```

### 请求参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| order_id | int | 是 | - | 订单ID |

### 请求示例

```bash
curl -X POST "http://api.ten.com/open-api/v1/order/detail" \
  -H "Host: api.ten.com" \
  -H "Content-Type: application/json" \
  -H "mall-id: 1" \
  -d '{"order_id":1}'
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| data.order | object | 订单主信息（qimall_order 全量字段，同列表order） |
| data.order_type | int | 订单出库类型（与 order 同级；detail 使用完整算法 `calcOrderType`，与 list 简化算法不同，详见 [order_type 字段说明](#order_type-字段说明list--detail-逻辑不同)） |
| data.details | array | 订单明细列表（含嵌套marketing） |
| data.refunds | array | 售后单列表（含嵌套steps） |
| data.actions | array | 操作日志列表 |
| data.behavior_logs | array | 行为日志列表 |
| data.express | array | 物流信息列表 |
| data.extra | object/null | 订单留言（1:1，有数据为对象，无数据则为 `null`，与 list 接口的数组格式不同） |
| data.invoice | object/null | 发票信息（1:1，有数据为对象，无数据则为 `null`，与 list 接口的数组格式不同） |
| data.cloud_stock_buying_orders | array | 云库存买货单数组（qimall_addons_cloud_stock_buying_order 全量字段，主键 id） |
| data.cloud_stock_fill_orders | array | 云库存 fill_order 数组（qimall_addons_cloud_stock_fill_order 全量字段，主键 id） |
| data.cloud_stock_fill_order_relation | array | 主订单 ↔ fill_order 关联桥（qimall_addons_cloud_stock_fill_order_relation 全量字段；order_id=主订单 id，fill_order_id → 上一数组主键） |
| data.cloud_stock_stock_logs | array | 云库存出入库流水（合并扁平；每条带 belong_to_type/belong_to_id/source/related_order_ids + detail 级 shipping_doc_ids/refund_doc_ids 纯 ID 引用；A 池限定 changes_type IN (200,207,102) + order_type=1 + user_id 防御性过滤，B 池补充 order_type=2 + status 过滤，详见 [查询加固说明](#查询加固说明)） |
| data.cloud_stock_offer_orders | array | 云库存报价单数组（qimall_addons_cloud_stock_offer_order 全量字段，主键 id） |
| data.cloud_stock_agent_orders | array | 云库存配货单数组（qimall_addons_cloud_stock_agent_order 全量字段，主键 id） |
| data.cloud_stock_dispense_orders | array | 云库存自提单数组（qimall_addons_cloud_stock_dispense_order 全量字段，主键 id） |
| data.cloud_stock_shipping_orders | array | 实体发货单数组（qimall_order_express 全量字段 + qimall_order_id 字段，主键 id） |
| data.cloud_stock_refund_orders | array | 退货单数组（qimall_order_refund 全量字段 + steps 内联；不含 detail.marketing/order 嵌套） |

> **detail 接口不返回 user 字段**：详情接口仅返回订单本身的 9 个关联数据块（order/details/refunds/actions/behavior_logs/express/extra/invoice + 云库存 9 字段），不含下单会员信息。如需下单会员数据（含直推人 / 会员等级 / 云库存等级），请改用 list 接口（可按 order_no 精确搜索），user 字段来源详见 [user 字段说明](#user-字段说明仅-list-接口返回-11无则为-null)。

### details[].marketing 字段说明（qimall_order_marketing 表，1:1嵌套）

| 字段 | 类型 | 说明 | 表名 | 数据库字段 | comment |
|------|------|------|------|------|------|
| id | int | 主键 | qimall_order_marketing | id | 主键 |
| order_detail_id | int | 订单明细ID | qimall_order_marketing | order_detail_id | mall_id |
| give_score | decimal | 赠送积分 | qimall_order_marketing | give_score | 赠送积分 |
| give_balance | decimal | 赠送余额 | qimall_order_marketing | give_balance | 赠送余额 |
| give_currency | array | 赠送货币（JSON自动解码） | qimall_order_marketing | give_currency | 赠送货币(json字符串保存) |
| deduct_score | decimal | 减扣积分 | qimall_order_marketing | deduct_score | 减扣积分 |
| deduct_currency | array | 减扣货币（JSON自动解码） | qimall_order_marketing | deduct_currency | 减扣货币(json字符串保存) |
| pay_money | decimal | 实际付款金额 | qimall_order_marketing | pay_money | 商品实际付款金额，单位：元 |
| full_reduce_money | decimal | 满减金额 | qimall_order_marketing | full_reduce_money | 满减金额，单位：元 |
| coupon_discount_money | decimal | 优惠券优惠金额 | qimall_order_marketing | coupon_discount_money | 优惠券优惠金额，单位：元 |
| member_price_deduct | decimal | 会员价优惠金额 | qimall_order_marketing | member_price_deduct | 会员价优惠 |
| user_coupon_id | string | 用户优惠券ID | qimall_order_marketing | user_coupon_id | 用户优惠券id map |
| user_card_id | string | 亲友卡抵扣信息 | qimall_order_marketing | user_card_id | 用户会员卡id map |
| agent_deduct | decimal | 经销商内购抵扣 | qimall_order_marketing | agent_deduct | |
| agent_extra | string | 经销商内购额外信息 | qimall_order_marketing | agent_extra | |
| give_balance_settlement | int | 赠送余额结算方式 | qimall_order_marketing | give_balance_settlement | 赠送余额的结算方式：0:订单完成,1:支付完成 |
| give_score_settlement | int | 赠送积分结算方式 | qimall_order_marketing | give_score_settlement | 赠送积分的结算方式 |
| give_digital | decimal | 赠送数字币 | qimall_order_marketing | give_digital | 赠送数字币 |
| give_digital_settlement | int | 赠送数字币结算方式 | qimall_order_marketing | give_digital_settlement | 赠送数字币结算方式 |
| deduct_self_zone | decimal | 自营区抵扣 | qimall_order_marketing | deduct_self_zone | 减扣卡券-购物卡-自营区资产 |
| deduct_consume_zone | decimal | 消费区抵扣 | qimall_order_marketing | deduct_consume_zone | 减扣卡券-购物卡-大众消费区资产 |
| status | int | 状态 | qimall_order_marketing | status | 状态[-1:删除;0:禁用;1启用] |
| created_at | int | 创建时间戳 | qimall_order_marketing | created_at | 创建时间 |
| updated_at | int | 修改时间戳 | qimall_order_marketing | updated_at | 修改时间 |

### refunds 字段说明（qimall_order_refund 表）

| 字段 | 类型 | 说明 | 表名 | 数据库字段 | comment |
|------|------|------|------|------|------|
| id | int | 售后ID | qimall_order_refund | id | |
| mall_id | int | 商城ID | qimall_order_refund | mall_id | |
| mch_id | int | 多商户ID | qimall_order_refund | mch_id | |
| store_id | int | 门店ID | qimall_order_refund | store_id | 门店id |
| user_id | int | 用户ID | qimall_order_refund | user_id | 用户id |
| order_id | int | 订单ID | qimall_order_refund | order_id | 订单id |
| order_detail_id | int | 关联订单详情ID | qimall_order_refund | order_detail_id | 关联订单详情id |
| order_no | string | 售后单号 | qimall_order_refund | order_no | 售后单号 |
| type | int | 售后类型：1=仅退款，2=退货退款，3=换货 | qimall_order_refund | type | 售后类型：1=仅退款，2=退货退款，3=换货 |
| reason | string | 退款原因 | qimall_order_refund | reason | 退款原因 |
| remark | string | 用户退款备注 | qimall_order_refund | remark | 用户退款备注、说明 |
| pic_list | array | 上传图片凭证（JSON自动解码） | qimall_order_refund | pic_list | 用户上传图片凭证 |
| refuse_remark | string | 商家拒绝理由 | qimall_order_refund | refuse_remark | 商家拒绝理由 |
| express | string | 快递公司 | qimall_order_refund | express | 快递公司 |
| express_no | string | 快递单号 | qimall_order_refund | express_no | 快递单号 |
| saler_express | string | 商家快递公司 | qimall_order_refund | saler_express | 商家快递公司 |
| customer_name | string | 京东物流 | qimall_order_refund | customer_name | 京东物流 |
| saler_express_no | string | 商家快递单号 | qimall_order_refund | saler_express_no | 商家快递单号 |
| saler_address | array | 买家收货地址（JSON自动解码） | qimall_order_refund | saler_address | 买家收货地址(json存储) |
| is_refund | int | 是否打款：0=否，1=是 | qimall_order_refund | is_refund | 是否打款，【0否，1是】 |
| refund_at | int | 打款时间戳 | qimall_order_refund | refund_at | 打款时间 |
| refund_price | decimal | 退款金额 | qimall_order_refund | refund_price | 退款金额 |
| reality_refund_price | decimal | 实际退款金额 | qimall_order_refund | reality_refund_price | 实际退款金额 |
| express_at | int | 买家发货时间戳 | qimall_order_refund | express_at | 买家发货时间 |
| saler_express_at | int | 卖家重新发货时间戳 | qimall_order_refund | saler_express_at | 卖家重新发货时间 |
| step_status | int | 售后步骤状态 | qimall_order_refund | step_status | 售后步骤状态，对应qimall_order_refund_step.step_status最新状态 |
| refund_status | int | 售后状态 | qimall_order_refund | refund_status | 售后状态 |
| status | int | 状态 | qimall_order_refund | status | 状态【1启用 0禁用 -1删除】 |
| created_at | int | 创建时间戳 | qimall_order_refund | created_at | 创建时间 |
| updated_at | int | 修改时间戳 | qimall_order_refund | updated_at | 修改时间 |
| goods_type | int | 商品类型 | qimall_order_refund | goods_type | 商品类型 |
| refund_remark | string | 退款备注 | qimall_order_refund | refund_remark | 后台同意时，填写的退款备注 |
| old_reality_refund_price | decimal | 原实际退款金额 | qimall_order_refund | old_reality_refund_price | 原来实际退款金额 |
| num | int | 数量 | qimall_order_refund | num | 售后数量 |
| order_source | string | 订单来源 | qimall_order_refund | order_source | 订单来源 |
| is_auto_refund | int | 是否自动退款 | qimall_order_refund | is_auto_refund | 是否自动退款 |
| steps | array | 售后步骤列表（字段说明见 [refunds[].steps 字段说明](#refundssteps-字段说明qimall_order_refund_step-表1n嵌套)） | qimall_order_refund_step | - | 通过 order_refund_id 关联，1:N |
| detail | object/null | 关联订单明细（1:1，字段同 [details 字段说明](#details-字段说明qimall_order_detail-表) 但不含 marketing 嵌套） | qimall_order_detail | - | 通过 order_detail_id 关联，**仅 refund-list 接口返回**；detail 接口的 refunds[] 不含此键，list 接口中此键恒为 null |
| order | object/null | 关联订单主信息（1:1，字段同 [order 字段说明](#order-字段说明qimall_order-表)） | qimall_order | - | 通过 order_id 关联，**仅 refund-list 接口返回**；detail 接口的 refunds[] 不含此键，list 接口中此键恒为 null |

### refunds[].steps 字段说明（qimall_order_refund_step 表，1:N嵌套）

| 字段 | 类型 | 说明 | 表名 | 数据库字段 | comment |
|------|------|------|------|------|------|
| id | int | ID | qimall_order_refund_step | id | |
| order_refund_id | int | 售后表ID | qimall_order_refund_step | order_refund_id | 维权表id |
| role | int | 角色：1=买家，2=商家 | qimall_order_refund_step | role | 角色【1买家 2商家】 |
| content | array | 内容（JSON 数组自动解码，如 `["售后方式：仅退款","发起了仅退款申请,等待商家处理",...]`） | qimall_order_refund_step | content | 内容 |
| step_num | int | 进度条当前步骤 | qimall_order_refund_step | step_num | 进度条当前步骤 |
| step_status | int | 步骤状态 | qimall_order_refund_step | step_status | 步骤状态 |
| status | int | 状态 | qimall_order_refund_step | status | 状态【1启用 0禁用 -1删除】 |
| created_at | int | 创建时间戳 | qimall_order_refund_step | created_at | 创建时间 |
| updated_at | int | 修改时间戳 | qimall_order_refund_step | updated_at | 修改时间 |

### actions 字段说明（qimall_order_action 表）

| 字段 | 类型 | 说明 | 表名 | 数据库字段 | comment |
|------|------|------|------|------|------|
| id | int | 动作ID | qimall_order_action | id | 动作id |
| order_id | int | 订单ID | qimall_order_action | order_id | 订单id |
| action | string | 动作内容 | qimall_order_action | action | 动作内容 |
| member_id | int | 操作人ID | qimall_order_action | member_id | 操作人id |
| member_name | string | 操作人 | qimall_order_action | member_name | 操作人 |
| order_status | int | 订单状态 | qimall_order_action | order_status | 订单状态 |
| order_status_text | string | 订单状态名称 | qimall_order_action | order_status_text | 订单状态名称 |
| status | int | 状态 | qimall_order_action | status | 状态[-1:删除;0:禁用;1启用] |
| created_at | int | 创建时间戳 | qimall_order_action | created_at | |
| updated_at | int | 更新时间戳 | qimall_order_action | updated_at | |

### behavior_logs 字段说明（qimall_order_behavior_logs 表）

| 字段 | 类型 | 说明 | 表名 | 数据库字段 | comment |
|------|------|------|------|------|------|
| id | int | ID | qimall_order_behavior_logs | id | |
| mall_id | int | 商城ID | qimall_order_behavior_logs | mall_id | |
| operator_user_id | int | 操作人用户ID | qimall_order_behavior_logs | operator_user_id | 操作人用户id |
| operator_user_type | int | 操作用户类型：1=后台，2=用户 | qimall_order_behavior_logs | operator_user_type | 操作用户类型 1后台管理员操作 2用户操作 3门店独立后台 4爱优诺 5多商户 6系统自动操作 |
| behavior | int | 行为类型（1-24种，见常量映射接口） | qimall_order_behavior_logs | behavior | 操作行为 1创建订单 2取消订单 3订单支付 4提醒发货 5订单发货 6修改物流 7确认收货 8订单完成 9评价 10申请售后 11删除订单 12备注 13留言 14修改地址 15取消发货 16撤销售后 |
| desc | string | 描述 | qimall_order_behavior_logs | desc | |
| extra_info | array | 额外信息（JSON自动解码） | qimall_order_behavior_logs | extra_info | |
| ip | int | IP地址 | qimall_order_behavior_logs | ip | |
| status | int | 状态 | qimall_order_behavior_logs | status | |
| operation_time | int | 实际操作时间戳 | qimall_order_behavior_logs | operation_time | 实际操作时间 |
| order_id | int | 订单ID | qimall_order_behavior_logs | order_id | 订单ID |
| created_at | int | 创建时间戳 | qimall_order_behavior_logs | created_at | |
| updated_at | int | 更新时间戳 | qimall_order_behavior_logs | updated_at | |

### express 字段说明（qimall_order_express 表）

| 字段 | 类型 | 说明 | 表名 | 数据库字段 | comment |
|------|------|------|------|------|------|
| id | int | ID | qimall_order_express | id | |
| order_id | int | 订单ID | qimall_order_express | order_id | 订单id |
| cs_order_id | int | 云库存订单ID | qimall_order_express | cs_order_id | 云库存ID |
| order_detail_ids | array | 产品列表（JSON自动解码） | qimall_order_express | order_detail_ids | 产品列表 |
| shipping_type | int | 发货方式：1=快递，0=其他 | qimall_order_express | shipping_type | 发货方式1 快递 0其他 |
| express_id | int | 快递公司ID | qimall_order_express | express_id | 快递公司id |
| express_name | string | 物流公司名称 | qimall_order_express | express_name | 物流公司名称 |
| express_no | string | 运单编号 | qimall_order_express | express_no | 运单编号 |
| customer_name | string | 京东物流 | qimall_order_express | customer_name | 京东物流编号 |
| buyer_id | int | 买家ID | qimall_order_express | buyer_id | 买家id |
| buyer_name | string | 买家信息 | qimall_order_express | buyer_name | 买家信息 |
| operator_id | int | 发货人用户ID | qimall_order_express | operator_id | 发货人用户id |
| operator_username | string | 发货人用户名 | qimall_order_express | operator_username | 发货人用户名 |
| memo | string | 备注 | qimall_order_express | memo | 备注 |
| status | int | 状态 | qimall_order_express | status | 状态[-1:删除;0:禁用;1启用] |
| created_at | int | 创建时间戳 | qimall_order_express | created_at | 创建时间 |
| updated_at | int | 更新时间戳 | qimall_order_express | updated_at | 更新时间 |
| nums | object | 发货数量（JSON自动解码，为对象 `{detail_id: num}`，如 `{"47":"1"}`） | qimall_order_express | nums | 发货数量 {detail_id: num} |
| source_table | string | 来源表 | qimall_order_express | source_table | 来源表 |
| source_table_id | int | 来源表ID | qimall_order_express | source_table_id | 主键ID |
| edit_num | int | 修改次数 | qimall_order_express | edit_num | 修改次数 |

### extra 字段说明（qimall_order_extra 表，1:1）

> **list 与 detail 格式不同**：
> - **list 接口**：始终返回数组。有 1 条留言时为 `[{ "id": 1, "order_id": 1, ... }]`（长度 1），无留言时为 `[]`（长度 0）。客户端用 `extra.length` 判断。
> - **detail 接口**：有留言时为单对象 `{ "id": 1, "order_id": 1, ... }`，无留言时为 `null`（**非** `[]`）。客户端用 `extra !== null` 判断。

| 字段 | 类型 | 说明 | 表名 | 数据库字段 | comment |
|------|------|------|------|------|------|
| id | int | 留言项ID | qimall_order_extra | id | |
| mall_id | int | 商城ID | qimall_order_extra | mall_id | Mall Id |
| order_id | int | 订单ID | qimall_order_extra | order_id | 订单ID |
| mch_id | int | 多商户ID | qimall_order_extra | mch_id | 多商户ID |
| store_id | int | 门店ID | qimall_order_extra | store_id | 门店ID |
| message | string | 留言信息 | qimall_order_extra | message | 留言 |
| created_at | int | 创建时间戳 | qimall_order_extra | created_at | |
| updated_at | int | 更新时间戳 | qimall_order_extra | updated_at | |
| share_user_id | int | 分享用户ID | qimall_order_extra | share_user_id | 分享的上级ID |

### invoice 字段说明（qimall_order_invoice 表，1:1）

> **仅 detail 接口返回**：invoice 仅在 detail 接口出现。有发票申请时为单对象 `{ "id": 1, "order_id": 1, ... }`，无发票时为 `null`（**非** `[]`）。list 接口不返回 invoice 字段。

| 字段 | 类型 | 说明 | 表名 | 数据库字段 | comment |
|------|------|------|------|------|------|
| id | int | ID | qimall_order_invoice | id | |
| user_id | int | 用户ID | qimall_order_invoice | user_id | |
| mall_id | int | 商城ID | qimall_order_invoice | mall_id | |
| order_id | int | 订单ID | qimall_order_invoice | order_id | |
| order_no | string | 订单编号 | qimall_order_invoice | order_no | |
| pay_money | decimal | 订单实付金额 | qimall_order_invoice | pay_money | |
| type | int | 发票类型 | qimall_order_invoice | type | |
| head_type | int | 抬头类型 | qimall_order_invoice | head_type | |
| head_name | string | 发票抬头 | qimall_order_invoice | head_name | 发票抬头 |
| bank_name | string | 开户银行 | qimall_order_invoice | bank_name | 开户银行 |
| account | string | 开户账户 | qimall_order_invoice | account | 开户账户 |
| email | string | 邮箱号 | qimall_order_invoice | email | 邮箱号 |
| address | string | 地址 | qimall_order_invoice | address | 地址 |
| mobile | string | 电话 | qimall_order_invoice | mobile | 电话 |
| tax_no | string | 税号 | qimall_order_invoice | tax_no | 税号 |
| invoice_status | int | 发票状态 | qimall_order_invoice | invoice_status | 开票状态 0申请中 1已同意 2已拒绝 |
| remark | string | 备注 | qimall_order_invoice | remark | 备注 |
| status | int | 状态 | qimall_order_invoice | status | 状态[-1:删除;0:禁用;1启用] |
| created_at | int | 创建时间戳 | qimall_order_invoice | created_at | |
| updated_at | int | 更新时间戳 | qimall_order_invoice | updated_at | |

### order_type 字段说明（list / detail 逻辑不同）

> list 与 detail 接口的 `order_type` 由两套**不同**算法得出，取值与判定逻辑不共用。同一个订单在两个接口中的值**可能不同**。

#### list 接口 order_type

> **实现位置**：`addons/OpenApi/common/services/OrderService.php::calcOrderTypeSimple()`
>
> **数据来源**：只查订单表与云库存关联表，不做云库存流水级判定，**不会返回 `4=混合出库`**。

| 值 | 常量名 | 说明 | 判定条件（按顺序命中即返回） |
|----|--------|------|------|
| 0 | NOT_SHIPPED | 未发货 / 无云库存数据 | 订单不存在，或 `pay_status != 1`（未支付），或 `shipping_status = 0`（待发货） |
| 3 | WAREHOUSE_OUT | 从系统仓库出库 | 用户非云库存代理（qimall_addons_cloud_stock_agent 无该用户启用记录） |
| 2 | CLOUD_OUT | 从云库存出库 | 存在 `qimall_addons_cloud_stock_buying_order`（order_id = 本订单且 status 启用） |
| 1 | INCREASE | 向云库存增加库存量（纯入库） | 存在 `qimall_addons_cloud_stock_fill_order_relation`（order_id = 本订单且 status 启用） |
| 3 | WAREHOUSE_OUT | 从系统仓库出库 | 云库存代理但无上述任何云库存关联记录 |

> list 接口返回值域：`0 / 1 / 2 / 3`。

#### detail 接口 order_type

> **实现位置**：`addons/OpenApi/common/services/OrderService.php::calcOrderType()`
>
> **数据来源**：基于 `cloud_stock_stock_logs` 中每条 `deduction_details` 的 `user_id` 字段，结合是否有实体发货单（`cloud_stock_shipping_orders` / `cloud_stock_dispense_orders`）判定。
>
> **判定核心依据**：`qimall_addons_cloud_stock_deduction_detail` 表的 `user_id` 字段：
> - `user_id > 0` → 该条扣减记录来自云库存账户
> - `user_id = 0` → 该条扣减记录来自系统仓库（无云库存扣减记录）

| 值 | 常量名 | 说明 | 判定条件（按顺序命中即返回） |
|----|--------|------|------|
| 1 | INCREASE | 向云库存增加库存量（纯入库） | 无实体发货单，且存在 `changes_dir=1`（增加类）记录 |
| 2 | CLOUD_OUT | 从云库存出库（扣减库存量） | 有实体发货单，且扣减记录全部为 `user_id > 0`（云库存扣减） |
| 3 | WAREHOUSE_OUT | 从系统仓库出库（无云库存扣减记录） | 有实体发货单，且不存在任何 `user_id > 0` 的扣减记录（全部为系统仓库扣减，或无扣减记录） |
| 4 | MIXED_OUT | 同时从云库存、系统仓库出库 | 有实体发货单，且扣减记录同时存在 `user_id > 0` 和 `user_id = 0` |
| 3 | WAREHOUSE_OUT | 从系统仓库出库 | 有实体发货单但无任何扣减记录 |
| 0 | NOT_SHIPPED | 未发货 / 无云库存数据 | 无实体发货单（且无增加记录） |

> detail 接口返回值域：`0 / 1 / 2 / 3 / 4`。

#### detail 判定流程图

```text
                    ┌─────────────────────────────────────┐
                    │      扫描 cloud_stock_stock_logs     │
                    │   提取每条 deduction_details.user_id  │
                    └─────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
           hasDeductionWithUserId          hasDeductionWithoutUserId
            (user_id > 0 云库存)              (user_id = 0 系统仓库)
                    │                               │
                    └───────────────┬───────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
            hasPhysicalShipment              !hasPhysicalShipment
         (shipping_orders 或                 (无实体发货单)
          dispense_orders 非空)                      │
                    │                               │
        ┌───────────┼───────────┐                   ▼
        ▼           ▼           ▼              order_type = 1
  仅云库存扣减  仅系统仓库扣减  混合扣减         (纯入库)
  (userId>0)   (userId=0)    (两者都有)
        │           │           │
        ▼           ▼           ▼
  type=2        type=3       type=4
 (云库存)     (系统仓库)     (混合出库)
```

#### 示例：order_id=1605（混合出库 order_type=4）

```json
{
  "order": { "id": 1605, "order_no": "s20260622164332804200", ... },
  "order_type": 4,
  "cloud_stock_stock_logs": [
    {
      "stock_log": { "id": 1234, "changes_dir": 2, ... },
      "detail_type": "deduction",
      "deduction_details": [
        { "id": 993, "user_id": 105, "num": 2, "shipping_doc_ids": { "order_express": [77] } },
        { "id": 1000, "user_id": 0, "num": 1, "shipping_doc_ids": { "order_express": [78] } }
      ]
    }
  ],
  "cloud_stock_shipping_orders": [
    { "id": 77, "order_id": 1605, "express_name": "顺丰速运", ... },
    { "id": 78, "order_id": 1605, "express_name": "圆通速递", ... }
  ]
}
```

> **说明**：deduction_details 中 id=993 的 user_id=105（云库存扣减），id=1000 的 user_id=0（系统仓库扣减），同时存在两种类型的扣减记录，因此 order_type=4（混合出库）。

### user 字段说明（仅 list 接口返回，1:1，无则为 null）

> **接口实现位置**：`addons/OpenApi/common/services/OrderService.php::buildOrderRelationMaps()`（用户数据增强在第 339-363 行，`getList()` 调用链）
>
> **数据组装方式**：批量查询 `qimall_user` 主表 + 批量查询关联表（直推人 / 会员等级 / 云库存代理 / 云库存等级），按外键分组组装，避免 N+1。
>
> **敏感字段过滤**：响应下发前剔除 `password`（登录密码）、`transaction_password`（交易密码）两个字段。
>
> **detail 接口不返回 user**：详情接口（`/order/detail`）只返回订单本身的关联数据，不含 user 字段。如需下单会员信息请调用 list 接口（可按 order_no 精确搜索）。

#### 4.1 基础字段（来源：qimall_user 表全量字段）

> 直接来自 `qimall_user` 表，按 `qimall_order.user_id` 关联查询（无 mall_id / status 过滤，原样返回，含禁用用户）。

| 字段 | 类型 | 说明 | 表名 | 数据库字段 | comment |
|------|------|------|------|------|------|
| id | int | 用户ID | qimall_user | id | |
| base64_code | string | 用户短标识（分享码） | qimall_user | base64_code | Base64 短编码 |
| mall_id | int | 商城ID | qimall_user | mall_id | 商城ID |
| mch_id | int | 商户ID | qimall_user | mch_id | 商户ID |
| store_id | int | 门店ID | qimall_user | store_id | 门店id |
| username | string | 用户名 | qimall_user | username | 用户名 |
| area_code | string | 手机区号 | qimall_user | area_code | 手机区号，默认 86 |
| mobile | string | 手机号 | qimall_user | mobile | 手机号 |
| nickname | string | 昵称 | qimall_user | nickname | 昵称 |
| birthday | int | 生日时间戳 | qimall_user | birthday | 生日（时间戳，0表示未设置） |
| avatar_url | string | 头像 | qimall_user | avatar_url | 头像 |
| platform | string | 注册平台 | qimall_user | platform | 平台名字（mp-wx/h5/mp-qq等） |
| temp_parent_id | int | 临时推荐人ID | qimall_user | temp_parent_id | 临时父级ID |
| parent_id | int | 直推人ID（一级） | qimall_user | parent_id | 第一父级ID |
| second_parent_id | int | 二级推荐人ID | qimall_user | second_parent_id | 第二推荐人id |
| third_parent_id | int | 三级推荐人ID | qimall_user | third_parent_id | 第三推荐人id |
| junior_at | int | 成为下级时间戳 | qimall_user | junior_at | 成为下级的时间 |
| created_at | int | 注册时间戳 | qimall_user | created_at | 添加时间 |
| last_login_at | int | 最后登录时间戳 | qimall_user | last_login_at | 最后登录时间 |
| upgrade_level_at | int | 升级时间戳 | qimall_user | upgrade_level_at | 升级到当前等级的时间 |
| inviter_at | int | 成为邀请人时间戳 | qimall_user | inviter_at | 成为邀请人的时间 |
| login_ip | string | 最后登录IP | qimall_user | login_ip | 最后登录的IP地址 |
| is_inviter | int | 是否邀请人 | qimall_user | is_inviter | 是否为邀请人【0否 1是】 |
| status | int | 状态 | qimall_user | status | 状态[-1:删除;0:禁用;1启用] |
| level | int | 用户等级 | qimall_user | level | 等级 |
| source | int | 注册来源 | qimall_user | source | 注册来源 |
| signature_title | string/null | 称号标题 | qimall_user | signature_title | 用户称号 |
| signature_content | string/null | 称号内容/说明 | qimall_user | signature_content | 称号内容 |
| background | string/null | 背景图URL | qimall_user | background | 个人中心背景图 |
| updated_at | int | 更新时间戳 | qimall_user | updated_at | 更新时间 |
| verification_token | string/null | 验证令牌 | qimall_user | verification_token | 邮箱/手机验证令牌 |
| device_type | string | 设备类型 | qimall_user | device_type | 最近登录设备（android/ios/h5/mp等） |
| device_mac | string | 设备标识MAC | qimall_user | device_mac | 最近登录设备MAC地址 |
| inviter_source | int | 邀请来源 | qimall_user | inviter_source | 成为邀请人的来源 |

> **已过滤的敏感字段（不下发）**：
> - `password`（qimall_user.password，登录密码，BCrypt 哈希）
> - `transaction_password`（qimall_user.transaction_password，交易密码，BCrypt 哈希）

#### 4.2 接口已实现的补充字段（来源：关联其他表组装）

> 以下 6 个字段是接口实现时**额外补充**的，非 qimall_user 表原生字段。组装逻辑位于 `OrderService::buildOrderRelationMaps()` 第 339-363 行。

| 字段 | 类型 | 说明 | 来源表 | 来源字段 | 关联键 | 查询条件 | 默认值 |
|------|------|------|--------|----------|--------|----------|--------|
| **parent_mobile** | string | 直推人手机号 | qimall_user | mobile | `qimall_user.parent_id` → `qimall_user.id` | 无（按 id 精确查询，无 mall_id / status 过滤） | 空字符串 `""` |
| **parent_username** | string | 直推人用户名 | qimall_user | username | `qimall_user.parent_id` → `qimall_user.id` | 同上 | 空字符串 `""` |
| **parent_nickname** | string | 直推人昵称 | qimall_user | nickname | `qimall_user.parent_id` → `qimall_user.id` | 同上 | 空字符串 `""` |
| **level_name** | string | 会员等级名称 | qimall_user_level | name | `qimall_user.level` → `qimall_user_level.level` | `mall_id = 当前商城ID` 且 `status = 1`（启用） | level=0 时回退为 `"普通会员"` |
| **cloud_stock_level** | int | 云库存代理等级权重 | qimall_addons_cloud_stock_agent | level | `qimall_user.id` → `qimall_addons_cloud_stock_agent.user_id` | `mall_id = 当前商城ID` 且 `status = 1`（启用），1:1 关联 | `0`（非云库存代理） |
| **cloud_stock_level_name** | string | 云库存代理等级名称 | qimall_addons_cloud_stock_level | name | `cloud_stock_level` → `qimall_addons_cloud_stock_level.level` | `mall_id = 当前商城ID` 且 `status = 1`（启用） | 空字符串 `""`（非云库存代理） |

#### 4.3 补充字段关联路径详解

**1. 直推人信息（parent_mobile / parent_username / parent_nickname）**

```
qimall_order.user_id ──► qimall_user.id （取 parent_id）
                                       │
                                       └──► qimall_user.parent_id ──► qimall_user.id （查询直推人记录）
                                                                              │
                                                                              └──► 取 mobile / username / nickname
```

- 批量查询：先收集所有 `user.parent_id`，一次查询 `qimall_user` 表（仅 select id, mobile, username, nickname）
- parent_id 为 0 或查询无结果时，三个字段统一返回空字符串 `""`

**2. 会员等级名称（level_name）**

```
qimall_user.level ──► qimall_user_level.level （匹配等级权重）
                                            │
                                            └──► 取 name
```

- 查询条件：`mall_id = 当前商城ID` 且 `level IN (用户 level 集合)` 且 `status = 1`
- level=0 为默认等级，`qimall_user_level` 表无对应记录，回退为 `"普通会员"`

**3. 云库存代理等级（cloud_stock_level / cloud_stock_level_name）**

```
qimall_user.id ──► qimall_addons_cloud_stock_agent.user_id （1:1，确定该用户是否为云库存代理）
                                       │
                                       └──► .level ──► qimall_addons_cloud_stock_level.level （匹配等级权重）
                                                                      │
                                                                      └──► .name （拿到云库存等级名称）
```

- 查询条件：
  - `qimall_addons_cloud_stock_agent`：`mall_id = 当前商城ID` 且 `user_id IN (订单 user_id 集合)` 且 `status = 1`
  - `qimall_addons_cloud_stock_level`：`mall_id = 当前商城ID` 且 `level IN (代理 level 集合)` 且 `status = 1`
- 非云库存代理时：`cloud_stock_level=0`、`cloud_stock_level_name=""`

### 响应示例

> 以下示例基于真实返回（订单 id=47）。detail 接口**不含 user 字段**；`extra`/`invoice` 无数据时为 `null`（非 `[]`）；订单有云库存关联时返回云库存 9 个顶层数组，无云库存数据时 9 键全部为 `[]`。

```json
{
  "code": 0,
  "msg": "操作成功",
  "data": {
    "order": { "id": 47, "mall_id": 1, "order_no": "s20251223145442156603", "pay_money": "11976.00", "order_status": 4, "...": "qimall_order 全量字段" },
    "order_type": 1,
    "details": [
      { "id": 47, "order_id": 47, "goods_id": 13, "goods_name": "颐养包",
        "marketing": null,
        "...": "qimall_order_detail 全量字段" }
    ],
    "refunds": [],
    "actions": [ { "id": 185, "order_id": 47, "action": "手机号为：15274434888 用户订单创建成功", "...": "qimall_order_action 全量字段" } ],
    "behavior_logs": [ { "id": 191, "order_id": 47, "behavior": 1, "operator_user_type": 2, "...": "qimall_order_behavior_logs 全量字段" } ],
    "express": [ { "id": 33, "order_id": 47, "order_detail_ids": ["47"], "nums": {"47": "1"}, "...": "qimall_order_express 全量字段" } ],
    "extra": null,
    "invoice": null,
    "cloud_stock_buying_orders": [],
    "cloud_stock_fill_orders": [ { "id": 33, "mall_id": 1, "user_id": 171755, "order_no": "CSFL20251223145507176154", "pay_money": "11976.00", "num": 24, "...": "qimall_addons_cloud_stock_fill_order 全量字段" } ],
    "cloud_stock_fill_order_relation": [ { "id": 18, "order_id": 47, "fill_order_id": 33, "...": "qimall_addons_cloud_stock_fill_order_relation 全量字段" } ],
    "cloud_stock_stock_logs": [ {
      "stock_log": { "id": 72, "mall_id": 1, "user_id": 0, "goods_id": 1, "changes_dir": 2, "order_id": 33, "order_type": 2, "changes_type": 202, "num": 24, "...": "qimall_addons_cloud_stock_goods_stock_log 全量字段" },
      "detail_type": "deduction",
      "deduction_details": [ { "id": 54, "stock_log_id": 72, "num": 24, "user_id": 0, "shipping_doc_ids": {} } ],
      "increase_details": [],
      "related_order_ids": { "fill_order": 33, "offer_order": 33 },
      "belong_to_type": "fill_order", "belong_to_id": 33, "source": "pool"
    } ],
    "cloud_stock_offer_orders": [ { "id": 33, "order_id": 47, "order_no": "s20251223145442156603", "user_id": 171755, "order_status": 4, "...": "qimall_addons_cloud_stock_offer_order 全量字段" } ],
    "cloud_stock_agent_orders": [ { "id": 41, "mall_id": 1, "user_id": 172232, "num": 0, "express_no": "1371725818626", "express_code": "EMS", "send_status": 1, "mobile": "13530592070", "name": "欧女士", "order_no": "CSP20260128115459495330", "order_type": 1, "express_status": 2, "table_express_status": 0, "highest_user_id": 171810, "...": "qimall_addons_cloud_stock_agent_order 全量字段" } ],
    "cloud_stock_dispense_orders": [],
    "cloud_stock_shipping_orders": [],
    "cloud_stock_refund_orders": []
  }
}
```

> **无数据空值规则**：
> - detail 接口：`extra` / `invoice` 无数据时为 `null`（有数据为单对象，**不是**数组）；云库存 9 键无数据时为 `[]`。
> - list 接口：`extra` 无数据时为 `[]`（统一数组格式）；`invoice` 与云库存字段一律不返回。
> 客户端需按接口区分 `extra` 的判空方式（list 用 `extra.length`，detail 用 `extra !== null`）。**注意**：`invoice`（发票）字段不在 list 接口返回，如需发票信息请调用 `detail` 接口。

---


---


### 云库存 9 顶层字段说明

> **适用接口**：仅 `detail` 接口 `data` 顶层（`list` 接口不返回云库存字段），与 `order`/`details`/`refunds`/`user` 平级。
> **设计目标**（AC-34 深度定义放宽，双定义并行）：
> - 逻辑嵌套深度 ≤ 6（推荐，**连续数字键的数组层不计入**——数组层由前端 forEach 平层遍历，不走对象递归，无栈深风险）；
> - 物理嵌套深度 ≤ 7（含数组下标层，允许如 `shipping_doc_ids.order_express = [77,78]` 一单多物流的额外 1 层下标）；
> - 同主键响应内仅出现 1 次；禁止循环嵌套。

#### 查询加固说明

> **背景**：`cloud_stock_stock_logs` 返回的出入库流水数据来源于三池查询（A 池 = buying 级 stock_log、B 池 = fill 级 stock_log、B 池个人扣减）。由于 `buying_order.id` 与 `fill_order.id` 可能存在主键碰撞，且不同 `changes_type` 的 stock_log 记录其 `order_id` 字段存储的主键含义不同，导致脏数据/历史残留记录可能被误挂到当前订单。
>
> **查询过滤条件**：

| 池 | 查询加固项 | 说明 |
|---|---|---|
| A 池（buying 级） | `order_type = 1` 过滤 | order_id 是 buying_order.id，必须限定 order_type=1（会员购买订单），否则当 fill_order.id 与 buying_order.id 主键碰撞时会拉到补货业务的 stock_log |
| A 池（buying 级） | `changes_type IN (200, 207, 102)` 过滤 | 仅 200（会员买货）、207（会员买货配货礼包）、102（退货退库存）这三种类型的 order_id 才是 buying_order.id；其他类型（如 105 购买礼包赠送）的 order_id 存的是 qimall_order.id（主商城订单主键），直接命中会误挂 |
| A 池（buying 级） | `user_id` 防御性过滤 | stock_log.user_id 必须属于当前批次买家的 user_id 集合，防止脏数据/历史残留导致其他用户的记录被误算 |
| A 池 + B 池 | `status = 1` 过滤 | 过滤启用状态，避免非启用残留记录污染 |
| B 池（fill 级） | `order_type = 2` 过滤 | order_id 是 fill_order.id，必须限定 order_type=2（补货订单），防止 buying_order.id 与 fill_order.id 主键碰撞时拉到买货业务的 stock_log |
| B 池个人扣减 | `status = 1` 过滤 | 过滤启用状态，避免非启用残留记录污染 |

> **对消费端的影响**：返回格式不变，但 `cloud_stock_stock_logs[]` 数组中的记录数量可能减少（因为过滤掉了脏数据/历史残留/非启用记录），数据准确性提升。三方系统无需调整解析逻辑。

#### 9 个数组概览

| # | 键名 | 主键 | 来源表 | 说明 |
|---|---|---|---|---|
| 1 | `cloud_stock_buying_orders[]` | `id` | `qimall_addons_cloud_stock_buying_order` | 会员买货单（路径 A：686 实体品下单扣云库存） |
| 2 | `cloud_stock_fill_orders[]` | `id` | `qimall_addons_cloud_stock_fill_order` | 共享库存池（路径 B：升级礼包/xx 包虚拟品写入 fill 池） |
| 3 | `cloud_stock_fill_order_relation[]` | `id` | `qimall_addons_cloud_stock_fill_order_relation` | 主订单 ↔ fill_order 关联桥（`order_id=主订单.id`；`fill_order_id` → 第 2 项主键） |
| 4 | `cloud_stock_stock_logs[]` | `stock_log.id` | `qimall_addons_cloud_stock_goods_stock_log` + 两张详情表 | 出入库流水（合并扁平） |
| 5 | `cloud_stock_offer_orders[]` | `id` | `qimall_addons_cloud_stock_offer_order` | 云库存报价单（686 采购链路） |
| 6 | `cloud_stock_agent_orders[]` | `id` | `qimall_addons_cloud_stock_agent_order` | 配货单（changes_type=201/104） |
| 7 | `cloud_stock_dispense_orders[]` | `id` | `qimall_addons_cloud_stock_dispense_order` | 自提单（changes_type=203） |
| 8 | `cloud_stock_shipping_orders[]` | `id` | `qimall_order_express` | 实体发货单（changes_type=200/207）；额外含 `qimall_order_id` 字段 |
| 9 | `cloud_stock_refund_orders[]` | `id` | `qimall_order_refund` | 退货入库单（changes_type=102）；`steps` 内联；**不含 `detail.marketing` / `order` 嵌套** |

#### cloud_stock_stock_logs[] 每条结构

```json
{
  "stock_log": { "...": "qimall_addons_cloud_stock_goods_stock_log 全量字段" },
  "detail_type": "deduction | increase",
  "deduction_details": [
    {
      "...": "qimall_addons_cloud_stock_deduction_detail 全量字段",
      "shipping_doc_ids": {
        "order_express": [77, 78],
        "agent_order": 41,
        "dispense_order": 5,
        "fill_order": 33
      }
    }
  ],
  "increase_details": [
    {
      "...": "qimall_addons_cloud_stock_increase_detail 全量字段",
      "refund_doc_ids": { "order_refund": [12, 13] }
    }
  ],
  "related_order_ids": {
    "buying_order": 30,
    "fill_order": 33,
    "offer_order": 33,
    "qimall_order": 131,
    "agent_order": 41,
    "dispense_order": 5
  },
  "belong_to_type": "buying_order | fill_order",
  "belong_to_id": 33,
  "source": "pool | personal"
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `belong_to_type` + `belong_to_id` | enum + int | 本条流水 UI 归属：`buying_order` → BO.id 查第 1 项；`fill_order` → FO.id 查第 2 项 |
| `source` | enum | `pool`=共享池级（入库存/扣共享池）；`personal`=个人云库存级（扣配货/自提/系统扣） |
| `related_order_ids` | object | 纯 ID 引用键集合；缺失键直接省略（不写 null） |
| `deduction_details[*].shipping_doc_ids` | object | 纯 ID 引用：`order_express`→8、`agent_order`→6、`dispense_order`→7、`fill_order`→2；空时 `{}` |
| `increase_details[*].refund_doc_ids` | object | 纯 ID 引用：`order_refund`→9；空时 `{}` |

#### 消费端关联查找示例（order_id = 主订单 id）

```text
主订单 id = X
  ↓ cloud_stock_fill_order_relation[*].order_id = X
  → FOR.fill_order_id = F
  ↓ cloud_stock_fill_orders[*].id = F
  → FO 对象
  ↓ cloud_stock_stock_logs[*]
      AND belong_to_type = 'fill_order'
      AND belong_to_id = F
  → 所有属于该 FO 的出入库流水
  → sl.related_order_ids.fill_order = F → 回查第 2 项
    sl.deduction_details[i].shipping_doc_ids.agent_order = A → 查第 6 项
    sl.shipping_doc_ids.order_express = [E] → 查第 8 项 → OE.qimall_order_id
    sl.increase_details[i].refund_doc_ids.order_refund = [R] → 查第 9 项得退货单+步骤
```

> **常量映射**：云库存 10 个分组（buying_order / stock_log / deduction_detail / increase_detail / fill_order_relation / fill_order / agent_order / dispense_order / offer_order / price_diff_order）枚举与中文描述请调用 `POST /open-api/v1/order/constants` 的 `data.cloud_stock_*` 分组，每个字段都含 `desc`。

#### 以 `qimall_order.id = 47` 为例：11 条 `cloud_stock_stock_logs[]` 的来源表与关联链路

> 适用范围：detail 接口 `data`（当 order_id=47）。**注意**：云库存流水数据仅 detail 接口返回，list 接口不返回云库存 9 字段。
> 所有 11 条 sl 的 `belong_to_type = 'fill_order'`，`belong_to_id = 33`（即共享库存池的共享 FO 行 id=33，由主订单下单时 FOR 桥挂入），区别仅在 `stock_log.changes_type`、`source`（pool 共享池 / personal 个人账户）、以及增加/扣减明细的 `shipping_doc_ids / refund_doc_ids` 指向哪张单据。

##### 1. 主链路总览（qimall_order.id = 47 → 11 条 sl）

```text
【商城订单】qimall_order id=47（order_no=202608100047，下单会员=U）
  ↓ 云库存 FOR 桥表  qimall_addons_cloud_stock_fill_order_relation
      WHERE fill_order_relation.order_id = 47
  → FOR id=18，fill_order_id=33
  ↓ 共享池 FO       qimall_addons_cloud_stock_fill_order  WHERE id=33
  → FO id=33（共享库存池，无 changes_type 含义，仅表示共享池的共享账户）
  ↓ 出入库流水合并（扁平化，不嵌套在 FO 下）
      cloud_stock_stock_logs[*]
        WHERE belong_to_type = 'fill_order'
          AND belong_to_id = 33
  → 共 11 条（stock_log.id = 72,73,259,310,323,327,555,1258,1356,1402,1434）
```

##### 2. 11 条 sl 逐条来源表、changes_type、分类对照

| # | sl.id | changes_type | Enum 中文名（CloudStockEnum） | 增减方向 | source | 对应业务单据（= `related_order_ids.*`） | 主数据来源表 | 分类：实际出入库 / 云库存周转 |
|---|---|---|---|---|---|---|---|---|
| 0 | 72 | **202** | 下级向自己补货（STOCK_CHANGE_TYPE202） | 扣减 | pool | `related_order_ids.fill_order = 33` | `qimall_addons_cloud_stock_goods_stock_log` + `deduction` 明细行（ct=202） | **云库存周转**（下级从共享池 FO 账号把货补到自己的云库存；还没真正发货到用户手上） |
| 1 | 73 | **105** | 升级礼包赠送 / 购买礼包赠送（STOCK_CHANGE_TYPE105） | 增加 | pool | `related_order_ids.fill_order = 33`；若为升级礼包活动反查 → 通过 `increase_details[*].stock_log_id=73` + `changes_type=105` 定位是"池内赠送入库" | `qimall_addons_cloud_stock_goods_stock_log` + `increase` 明细行（ct=105） | **云库存周转（入库）**（共享池因活动赠送获得入库数量；实际物理仓不一定随这一条发过货） |
| 2 | 259 | **200** | 会员买货（STOCK_CHANGE_TYPE200） | 扣减 | personal | `related_order_ids.buying_order = BO.id`（BO.order_id=47 路径 A 订单）；`deduction.shipping_doc_ids.order_express → OE.77`（实体单号） | `qimall_addons_cloud_stock_buying_order` + `stock_log`（ct=200）+ `deduction` 明细 | **实际出库**（用户从个人账户扣减库存 → 真实发货生成 OE 实体快递单，最终寄到用户手上） |
| 3 | 310 | **207** | 会员买货（配货礼包，STOCK_CHANGE_TYPE207） | 扣减 | pool | `related_order_ids.offer_order = Offer.33`（Offer.order_id=47）；`deduction.shipping_doc_ids.order_express → OE.77` | `qimall_addons_cloud_stock_offer_order` + `stock_log`（ct=207）+ `deduction` 明细 | **实际出库**（共享池因 686 报价单/配货礼包触发扣减 → 真实发货） |
| 4 | 323 | **204** | 系统扣减（STOCK_CHANGE_TYPE204） | 扣减 | personal | `related_order_ids.fill_order = 33`（回退路径，因为系统扣减无独立单据表） | `stock_log`（ct=204）+ `deduction` 明细 | **云库存周转**（平台后台/人工调整个人账号库存数量，不触发真实物流） |
| 5 | 327 | **203** | 自提货到线下（STOCK_CHANGE_TYPE203） | 扣减 | pool | `related_order_ids.dispense_order = DO.id`（若存在 DO）；若无 DO 行回退到 FO.33；`deduction.shipping_doc_ids.dispense_order` 指向自提单 | `qimall_addons_cloud_stock_dispense_order` + `stock_log`（ct=203）+ `deduction` 明细 | **实际出库**（用户到线下门店自提 / 核销自提单，共享池扣减 → 货品真实交付到用户） |
| 6 | 555 | **201** | 给下级配货（STOCK_CHANGE_TYPE201） | 扣减 | personal | `related_order_ids.agent_order = AO.41` | `qimall_addons_cloud_stock_agent_order` + `stock_log`（ct=201）+ `deduction` 明细 | **云库存周转**（上级账号给下级账号在云库存内部转移货量；货品仍在共享仓/云仓内，未实际出库到会员手上） |
| 7 | 1258 | **204** | 系统扣减（STOCK_CHANGE_TYPE204） | 扣减 | personal | `related_order_ids.fill_order = 33` | `stock_log`（ct=204）+ `deduction` 明细 | **云库存周转**（平台人工调整，无真实物流） |
| 8 | 1356 | **204** | 系统扣减（STOCK_CHANGE_TYPE204） | 扣减 | personal | 同上 | `stock_log`（ct=204）+ `deduction` 明细 | **云库存周转**（同上） |
| 9 | 1402 | **204** | 系统扣减（STOCK_CHANGE_TYPE204） | 扣减 | personal | 同上 | `stock_log`（ct=204）+ `deduction` 明细 | **云库存周转**（同上） |
| 10 | 1434 | **201** | 给下级配货（STOCK_CHANGE_TYPE201） | 扣减 | personal | `related_order_ids.agent_order = AO.97` | `qimall_addons_cloud_stock_agent_order` + `stock_log`（ct=201）+ `deduction` 明细 | **云库存周转**（同级另一笔配货，未实际出库） |

> **changes_type 范围说明**（枚举来源 `addons/CloudStock/common/enums/CloudStockEnum.php`）：
> - 增加类（对应 `increase_details` 有数据，`deduction_details = []`）：100~107。本例出现 **105** = 升级礼包赠送（购买礼包赠送）。
> - 扣减类（对应 `deduction_details` 有数据，`increase_details = []`）：200~207。本例出现 **200=会员买货、201=给下级配货、202=下级补货、203=自提、204=系统扣减、207=配货礼包**。

##### 3. `changes_type` → "实际出入库" vs "云库存周转" 汇总分类（消费端判定规则）

| 分类 | changes_type | Enum 中文名 | 业务含义 | 是否有真实物流单据（OE/DO）反查 |
|---|---|---|---|---|
| **① 实际出库（从仓到用户/到线下）** | 200 | 会员买货 | 用户下单 → 从云库存个人账户扣货 → 生成 OE 实体快递单发货 | 是：`deduction.shipping_doc_ids.order_express[] → cloud_stock_shipping_orders[]` |
|  | 203 | 自提货到线下 | 用户到店核销自提单 → 扣减对应账号库存 → 货品当面交付 | 是：`deduction.shipping_doc_ids.dispense_order → cloud_stock_dispense_orders[]`（若自提单存在） |
|  | 207 | 会员买货（配货礼包） | 686 报价单 / 配货礼包触发 → 共享池扣货 → 生成 OE 实体单发货 | 是：`deduction.shipping_doc_ids.order_express[] → cloud_stock_shipping_orders[]`；同时反查 `related_order_ids.offer_order → cloud_stock_offer_orders[]` |
| **② 实际入库（用户/仓把货退回来）** | 102 | 退货退库存 | 售后退款/退货 → 库存加回个人账户或共享池 | 是（通过退货单）：`increase.refund_doc_ids.order_refund[] → cloud_stock_refund_orders[]`（含 steps） |
|  | 100 / 103 | 向上级补货 / 系统添加 | 账号向共享池补货成功 / 平台后台"入库"按钮操作 | 视场景：100 通常伴随补货资金流水；103 纯平台手工增加 |
| **③ 云库存周转（仓内账号间转移 / 活动池赠送，不真实出库）** | 101 | 上级给自己配货 | 上级账号 → 当前账号，仓内云仓货量转移 | 否（仍停在云仓） |
|  | 104 / 105 / 106 / 107 | 平台补货赠送 / 升级礼包赠送 / 取消自提 / 赠送方案赠送 | 共享池或个人账户因活动/配置获得赠送库存 | 否（纯数字账本，没真实物流动作；**本例 105 即此**） |
|  | 201 | 给下级配货 | 当前账号 → 下级账号，仓内云仓货量转移（**本例 AO.41 AO.97 即此**） | 否（仍停在云仓，实际发货要等下级真正买货/自提 200/203 时再出） |
|  | 202 | 下级向自己补货 | 下级从共享池或上级池账号拉补货量（**本例 sl.72 即此**） | 否（同上，仓内转移） |
|  | 204 | 系统扣减 | 平台后台因库存盘点 / 过期 / 特殊手工调整扣减（**本例 sl.323 1258 1356 1402 共 4 条**） | 否（纯系统调账） |
|  | 206 | 购买二二复制商品扣减 | 复制模式专属扣减（本例未出现） | 看场景：若下游链路触发 OE 生成则归实际出库，否则仍属云账 |

> 消费端一句话判定：**只要 changes_type 对应的 shipping_doc_ids.order_express / dispense_order 能在 `cloud_stock_shipping_orders / cloud_stock_dispense_orders` 中找到具体对象**，即可视为"已实际出库/正在走真实物流"；反之只有 AO / BO / Offer / 或 related_order_ids.fill_order 指向但没有 OE/DO，则属于"云库存内周转 / 挂账"。

##### 4. 从主订单 → 单据 → 流水主表 → 增减明细 → doc_ids 的完整关联链路（带 changes_type 条件）

```text
A. 定位主单据（两条路径，结果最终在 FOR+BO 桥接处合并）
路径 A（buying_order 路径）：qimall_order.id=47
   ↓ cloud_stock_buying_orders[] where .order_id = 47
   → BO（可能 1 行；若共享池购买则不一定有 BO 行，本例 order_id=47 BO 为空）

路径 B（fill_order_relation 桥 → 共享 FO 路径，本例 11 条全部走这条）：
   qimall_order.id=47
   ↓ cloud_stock_fill_order_relation[] where .order_id = 47
   → FOR.fill_order_id = 33
   ↓ cloud_stock_fill_orders[] where .id = 33
   → FO.33（共享池账户）

B. 定位 11 条 stock_log 主数据（3 处来源并集，带 changes_type 过滤条件）
   ↓ cloud_stock_stock_logs[]
     WHERE
       ( belong_to_type = 'fill_order' AND belong_to_id = 33 )   -- 路径 B 归属
       OR
       ( belong_to_type = 'buying_order' AND belong_to_id IN (路径 A 的 BO.id) )
   → 使用 stock_log.changes_type 区分：
        changes_type ∈ {100,101,102,103,104,105,106,107} → 增加类 → 看 increase_details
        changes_type ∈ {200,201,202,203,204,206,207}     → 扣减类 → 看 deduction_details
   → 使用 stock_log.source 区分：
        pool     → 归属共享池（对应 FO.33 这样的共享账户）
        personal → 归属用户个人账户（对应 BO 或 FO 的 personal 账户）

C. 关联库存增减明细（一对多；每个明细 1:1 反查主 sl 用 stock_log_id）
   增加明细：increase_details[i]
       JOIN 云库存增加表：qimall_addons_cloud_stock_goods_stock_log_increase
           WHERE increase.stock_log_id = cloud_stock_stock_logs[i].stock_log.id
           AND   increase.changes_type  = cloud_stock_stock_logs[i].stock_log.changes_type
           AND   increase.order_id      = cloud_stock_stock_logs[i].stock_log.order_id（回退）
       → 拿到 increase.refund_doc_ids { order_refund: [R] }
       ↓ cloud_stock_refund_orders[] where .id IN (R)   （拿到退货单 + 内联 steps）

   扣减明细：deduction_details[i]
       JOIN 云库存扣减表：qimall_addons_cloud_stock_goods_stock_log_deduction
           WHERE deduction.stock_log_id = cloud_stock_stock_logs[i].stock_log.id
           AND   deduction.changes_type  = cloud_stock_stock_logs[i].stock_log.changes_type
           AND   deduction.order_id      = cloud_stock_stock_logs[i].stock_log.order_id（回退）
       → 拿到 deduction.shipping_doc_ids { order_express:[E], agent_order:A, dispense_order:D, buying_order:B, fill_order:F }
       ↓ cloud_stock_shipping_orders[] where .id IN (E)     （实体发货单 OE，实际出库必看）
       ↓ cloud_stock_agent_orders[]    where .id = A        （配货单 AO → 201/104 周转）
       ↓ cloud_stock_dispense_orders[] where .id = D        （自提单 DO → 203 实际自提）
       ↓ cloud_stock_buying_orders[]   where .id = B        （BO → 200 实际买货）
       ↓ cloud_stock_fill_orders[]     where .id = F        （FO → 202 下级补货 周转）

D. 跨表反查回 qimall_order（每条库存动作最终都要能追到商城订单）
   OE → cloud_stock_shipping_orders[i].qimall_order_id → qimall_order.id
   AO → cloud_stock_agent_orders[i].order_id → qimall_order.id 或 BO/FO（BO/FO 再通过 order_id 继续追 qimall_order）
   BO → cloud_stock_buying_orders[i].order_id → qimall_order.id
   DO → cloud_stock_dispense_orders[i].order_id → qimall_order.id
   FO → 通过 FOR 桥 cloud_stock_fill_order_relation[where fill_order_id = FO.id].order_id → qimall_order.id
   Offer → cloud_stock_offer_orders[i].order_id → qimall_order.id
   RO → cloud_stock_refund_orders[i].order_id → qimall_order.id
```

##### 5. 以本订单实际 11 条 sl 为例的"逐条反查主单据"演示

```text
sl id=73 (changes_type=105 升级礼包赠送 / pool 增加)
  increase_details[*].stock_log_id = 73
  → 105 属于 ③ 云库存周转，通常无需真实物流单据，refund_doc_ids 为空
  → 通过 related_order_ids.fill_order = 33 → FO.33 → FOR(18) → QO.47

sl id=259 (changes_type=200 会员买货 / personal 扣减)
  deduction_details[*].stock_log_id = 259  AND changes_type = 200
  → ① 实际出库类
  → shipping_doc_ids.order_express = [77] → OE.77.qimall_order_id = 131（或子 QO）
  → related_order_ids.buying_order = BO.id → BO.order_id = 47（路径 A 买货单）

sl id=310 (changes_type=207 配货礼包 / pool 扣减)
  deduction_details[*].stock_log_id = 310  AND changes_type = 207
  → ① 实际出库类（配货链路）
  → shipping_doc_ids.order_express = [77] → OE.77
  → related_order_ids.offer_order = 33 → Offer.33.order_id = 47 → 反查回 QO.47

sl id=72 (changes_type=202 下级补货 / pool 扣减)
  deduction_details[*].stock_log_id = 72   AND changes_type = 202
  → ③ 云库存周转，未实际出库
  → shipping_doc_ids.fill_order = 33 → FO.33 → FOR(18) → QO.47

sl id=327 (changes_type=203 自提 / pool 扣减)
  deduction_details[*].stock_log_id = 327  AND changes_type = 203
  → ① 实际出库（到店自提）
  → shipping_doc_ids.dispense_order → DO.id → DO.order_id = 47
  → related_order_ids.dispense_order = DO.id（若 DO 存在）；否则回退 related_order_ids.fill_order=33

sl id=555/1434 (changes_type=201 给下级配货 ×2 / personal 扣减)
  deduction_details[*].stock_log_id = 555/1434  AND changes_type = 201
  → ③ 云库存周转（上级→下级账号内部转移）
  → shipping_doc_ids.agent_order = 41 / 97 → AO.41 / AO.97
  → related_order_ids.agent_order = 41 / 97 → AO → 下级账号侧订单（若下级再买货/自提，会走 200/203 真正出库）
  → AO 本身：通过 FOR/BO 桥回追主 QO（本例 AO 来源挂在 QO.47 的共享池路径上）

sl id=323/1258/1356/1402 (changes_type=204 系统扣减 ×4 / personal 扣减)
  deduction_details[*].stock_log_id = 323/1258/1356/1402  AND changes_type = 204
  → ③ 云库存周转（平台人工调账），无真实物流
  → shipping_doc_ids 键可能为空，或回退到 fill_order
  → related_order_ids.fill_order = 33 → FO.33 → FOR(18) → QO.47
```



---

## 3. 售后列表

### 请求

```
POST /open-api/v1/order/refund-list
```

### 请求参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| page | int | 否 | 1 | 页码，最小值1 |
| limit | int | 否 | 20 | 每页条数，最大值100 |
| order_id | int | 否 | - | 按订单ID过滤 |
| refund_status | int | 否 | - | 售后状态过滤 |
| type | int | 否 | - | 售后类型过滤：1=仅退款，2=退货退款，3=换货 |
| start_time | string | 否 | - | 更新时间起始(Y-m-d H:i:s) |
| end_time | string | 否 | - | 更新时间截止(Y-m-d H:i:s) |

### 请求示例

```bash
curl -X POST "http://api.ten.com/open-api/v1/order/refund-list" \
  -H "Host: api.ten.com" \
  -H "Content-Type: application/json" \
  -H "mall-id: 1" \
  -d '{"page":1,"limit":5}'
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| data.list | array | 售后列表 |
| data.list[].refund | object | 售后单信息（qimall_order_refund 全量字段，同详情refunds） |
| data.list[].steps | array | 售后步骤列表（qimall_order_refund_step 全量字段） |
| data.list[].detail | object | 关联订单明细（qimall_order_detail 全量字段，1:1） |
| data.list[].order | object | 关联订单主信息（qimall_order 全量字段，1:1） |
| data.pagination | object | 分页信息 |
| data.pagination.total | int | 总记录数 |
| data.pagination.page | int | 当前页码 |
| data.pagination.page_size | int | 每页条数 |

### 响应示例

> 以下示例基于真实返回（售后单 id=34）。注意 `steps[].content` 为 JSON 数组（自动解码）；refund 表含 goods_type / num / is_auto_refund 等字段。

```json
{
  "code": 0,
  "msg": "操作成功",
  "data": {
    "list": [
      {
        "refund": { "id": 34, "order_id": 2104, "type": 1, "refund_status": -2, "refund_price": "1197.84", "pic_list": [], "goods_type": 2, "num": 1, "is_auto_refund": 0, "step_status": 5, "...": "qimall_order_refund 全量字段" },
        "steps": [ { "id": 64, "order_refund_id": 34, "role": 1, "content": ["售后方式：仅退款", "发起了仅退款申请,等待商家处理", "选项：其他", "售后说明：操作流程错了！", [], "退款金额：1197.84"], "step_num": 1, "step_status": 5, "...": "qimall_order_refund_step 全量字段" } ],
        "detail": { "id": 2104, "goods_id": 29, "goods_name": "舒养包", "pic_url": "https://...", "...": "qimall_order_detail 全量字段" },
        "order": { "id": 2104, "order_no": "s20260723134430212623", "...": "qimall_order 全量字段" }
      }
    ],
    "pagination": { "total": 32, "page": 1, "page_size": 1 }
  }
}
```

---

## 4. 常量映射

### 请求

```
POST /open-api/v1/order/constants
```

### 请求参数

无请求参数。

### 请求示例

```bash
curl -X POST "http://api.ten.com/open-api/v1/order/constants" \
  -H "Host: api.ten.com" \
  -H "Content-Type: application/json" \
  -H "mall-id: 1"
```

### 响应参数

返回按表分组的枚举字段映射，每个字段包含 `desc`（描述）和 `map`（值-标签数组）。

| 字段 | 类型 | 说明 |
|------|------|------|
| data.order | object | 订单主表枚举字段映射 |
| data.order_detail | object | 订单明细枚举字段映射 |
| data.order_refund | object | 售后单枚举字段映射 |
| data.order_refund_step | object | 售后步骤枚举字段映射 |
| data.order_action | object | 操作日志枚举字段映射 |
| data.order_behavior_logs | object | 行为日志枚举字段映射 |
| data.order_express | object | 物流信息枚举字段映射 |
| data.cloud_stock_buying_order | object | 云库存买货单枚举映射 |
| data.cloud_stock_goods_stock_log | object | 云库存出入库流水枚举映射 |
| data.cloud_stock_deduction_detail | object | 云库存扣减明细枚举映射 |
| data.cloud_stock_increase_detail | object | 云库存增加明细枚举映射 |
| data.cloud_stock_fill_order_relation | object | 云库存补货关联桥枚举映射 |
| data.cloud_stock_fill_order | object | 云库存补货单枚举映射 |
| data.cloud_stock_agent_order | object | 云库存配货单枚举映射 |
| data.cloud_stock_dispense_order | object | 云库存自提单枚举映射 |
| data.cloud_stock_offer_order | object | 云库存报价单枚举映射 |
| data.cloud_stock_price_diff_order | object | 云库存差价单枚举映射 |
| data.order_stock_type | object | 订单出库类型枚举映射（值：0=未发货/无云库存数据、1=向云库存增加库存量、2=从云库存出库、3=从系统仓库出库、4=同时从云库存和系统仓库出库） |

每个枚举字段格式：

```json
{ "desc": "字段描述", "map": [ { "value": 0, "label": "标签文本" }, { "value": 1, "label": "标签文本" } ] }
```

### 各表枚举字段清单

**order（订单主表）**：

| 字段 | 描述 | 涉及Enum |
|------|------|---------|
| order_status | 订单状态 | OrderStatusEnum |
| pay_status | 支付状态 | OrderPayStatusEnum |
| shipping_status | 配送状态 | ShippingStatusEnum |
| shipping_type | 配送类型 | ShippingTypeEnum |
| payment_type | 支付方式 | PayTypeEnum |
| is_feedback | 售后状态 | OrderStatusEnum::getFeedbackMap |
| is_comment | 是否评价 | WhetherEnum |
| is_recycle | 是否回收站 | WhetherEnum |
| is_virtual | 是否虚拟商品 | WhetherEnum |
| is_new_user | 是否新顾客 | WhetherEnum |
| status | 状态 | StatusEnum |
| order_source | 订单来源 | OrderSourceEnum |

**order_detail（订单明细）**：

| 字段 | 描述 | 涉及Enum |
|------|------|---------|
| order_status | 订单状态 | OrderStatusEnum |
| shipping_status | 物流状态 | ShippingStatusEnum |
| is_feedback | 退款状态 | OrderStatusEnum::getFeedbackMap |
| is_evaluate | 是否评价 | WhetherEnum |
| is_virtual | 是否虚拟商品 | WhetherEnum |
| status | 状态 | StatusEnum |

**order_refund（售后单）**：

| 字段 | 描述 | 涉及Enum |
|------|------|---------|
| type | 售后类型 | RefundTypeEnum |
| refund_status | 售后状态 | RefundStatusEnum |
| reason | 售后原因 | RefundReasonEnum |
| is_refund | 是否打款 | WhetherEnum |
| goods_type | 商品类型（1实物/2虚） | RefundGoodsTypeEnum |
| status | 状态 | StatusEnum |

**order_refund_step（售后步骤）**：

| 字段 | 描述 | 涉及Enum |
|------|------|---------|
| role | 角色 | RefundStatusEnum::getRoleMap |
| step_status | 步骤状态（label 为 `标题：描述` 拼接） | RefundStatusEnum::getStepStatusText |
| status | 状态 | StatusEnum |

**order_action（操作日志）**：

| 字段 | 描述 | 涉及Enum |
|------|------|---------|
| order_status | 操作时订单状态 | OrderStatusEnum |
| status | 状态 | StatusEnum |

**order_behavior_logs（行为日志）**：

| 字段 | 描述 | 涉及Enum |
|------|------|---------|
| operator_user_type | 操作用户类型 | OrderBehaviorLogsEnum::getMap(1) |
| behavior | 行为类型 | OrderBehaviorLogsEnum::getMap(0) |
| status | 状态 | StatusEnum |

**order_express（物流信息）**：

| 字段 | 描述 | 涉及Enum |
|------|------|---------|
| shipping_type | 发货方式 | ShippingTypeEnum |
| status | 状态 | StatusEnum |

> **cloud_stock_* 分组**：10 个云库存分组的枚举字段清单与 desc 请直接调用 constants 接口获取，均来自 `addons/CloudStock/common/enums/CloudStockEnum.php`（如 stock_log 的 changes_type / changes_dir / order_type，agent_order 的 send_status / express_status / order_type 等）。

### 响应示例

```json
{
  "code": 0,
  "msg": "操作成功",
  "data": {
    "order": {
      "order_status": { "desc": "订单状态", "map": [ {"value":0,"label":"待付款"}, {"value":1,"label":"待发货"}, {"value":2,"label":"已发货"}, {"value":3,"label":"已收货"}, {"value":4,"label":"已完成"}, {"value":6,"label":"待自提"}, {"value":7,"label":"自提成功"}, {"value":-4,"label":"已关闭"}, {"value":999,"label":"全部"} ] },
      "pay_status": { "desc": "支付状态（0未/1已）", "map": [ {"value":0,"label":"未支付"}, {"value":1,"label":"已支付"} ] }
    },
    "order_refund": {
      "type": { "desc": "售后类型", "map": [ {"value":1,"label":"仅退款"}, {"value":2,"label":"退货退款"}, {"value":3,"label":"换货"} ] }
    },
    "order_behavior_logs": {
      "behavior": { "desc": "行为类型", "map": [ {"value":1,"label":"创建订单"}, {"value":2,"label":"取消订单"}, {"value":3,"label":"订单支付"}, {"value":16,"label":"撤销售后"} ] }
    },
    "order_stock_type": {
      "desc": "订单出库类型",
      "map": [ {"value":0,"label":"无云库存数据"}, {"value":1,"label":"向云库存增加库存量"}, {"value":2,"label":"从云库存出库"}, {"value":3,"label":"从系统仓库出库"}, {"value":4,"label":"同时从云库存、系统仓库出库"} ]
    },
    "cloud_stock_goods_stock_log": {
      "changes_type": { "desc": "变化类型", "map": [ {"value":100,"label":"向上级补货"}, {"value":200,"label":"会员买货"}, {"value":201,"label":"给下级配货"}, {"value":202,"label":"下级向自己补货"}, {"value":203,"label":"自提货到线下"}, {"value":204,"label":"系统扣减"} ] }
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
| 1 | 订单ID不能为空 | detail 接口 order_id <= 0 |
| 1 | 订单不存在 | detail 接口订单未找到 |

---

## 数据说明

### JSON 字段自动解码

接口返回中，数据库存储为 JSON 字符串的字段会自动解码为数组返回，包括但不限于：

| 表名 | 数据库字段 | comment |
|------|------|------|
| qimall_order | extra_data | 额外数据 |
| qimall_order_detail | extra_data | 额外数据 |
| qimall_order_detail | attr_groups_format | 格式化规格组 |
| qimall_order_refund | pic_list | 用户上传图片凭证 |
| qimall_order_refund | saler_address | 买家收货地址(json存储) |
| qimall_order_express | order_detail_ids | 产品列表 |
| qimall_order_express | nums | 发货数量 {detail_id: num}（解码后为对象） |
| qimall_order_marketing | give_currency | 赠送货币(json字符串保存) |
| qimall_order_marketing | deduct_currency | 减扣货币(json字符串保存) |
| qimall_order_behavior_logs | extra_info | |
| qimall_order_refund_step | content | 步骤内容（解码后为数组） |

### 金额单位

所有金额字段（pay_money、goods_price、refund_price、shipping_money、coupon_money、score_money、adjust_money、cost_price、give_balance、full_reduce_money、coupon_discount_money、member_price_deduct、give_digital、agent_deduct、deduct_self_zone、deduct_consume_zone、reality_refund_price、old_reality_refund_price、refund_balance_money、reduce_shipping_money 等）数据库类型均为 `decimal`，单位为**元**，保留2位小数，前端直接展示无需转换。

### 时间字段

所有时间字段（created_at、updated_at、pay_time 等）为 Unix 时间戳（秒），前端按需格式化。

### 排序规则

- 订单列表：`updated_at ASC, id ASC`（更新时间升序 + ID 升序，见 `OrderService::getList()`）
- 售后列表：`id DESC`（ID降序，最新售后优先）

### 分页限制

- page 最小值：1（小于1自动修正为1）
- limit 范围：1~100（超出100自动截断为100）

---

## 关联关系

```
qimall_order (订单主表)
  ├── qimall_order_detail (订单明细)         1:N  通过 order_id 关联
  │     └── qimall_order_marketing (营销)    1:1  通过 order_detail_id 关联
  ├── qimall_order_refund (售后单)           1:N  通过 order_id 关联
  │     └── qimall_order_refund_step (步骤)  1:N  通过 order_refund_id 关联
  ├── qimall_order_action (操作日志)         1:N  通过 order_id 关联
  ├── qimall_order_behavior_logs (行为日志)  1:N  通过 order_id 关联（表名硬编码）
  ├── qimall_order_express (物流信息)        1:N  通过 order_id 关联
  ├── qimall_order_extra (订单留言)          1:1  通过 order_id 关联
  └── qimall_order_invoice (发票信息)        1:1  通过 order_id 关联
```

> **特殊说明**：`qimall_order_behavior_logs` 表名不使用 `{{%}}` 前缀，直接硬编码为完整表名。