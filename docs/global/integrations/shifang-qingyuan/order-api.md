# OpenApi 订单接口文档

> 版本：v1 | 更新日期：2026-08-10 | 插件：OpenApi

## 概述

订单接口提供订单列表、订单详情、售后列表和常量映射四个 POST 接口，用于第三方系统获取商城订单及售后数据。

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
| pay_status | int | 否 | - | 支付状态过滤 |
| shipping_status | int | 否 | - | 配送状态过滤 |
| start_time | string | 否 | - | 更新时间起始(Y-m-d H:i:s) |
| end_time | string | 否 | - | 更新时间截止(Y-m-d H:i:s) |

### 请求示例

```bash
curl -X POST "http://api.ten.com/open-api/v1/order/list" \
  -H "Host: api.ten.com" \
  -H "Content-Type: application/json" \
  -H "mall-id: 1" \
  -d '{"page":1,"limit":5}'
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| data.list | array | 订单列表 |
| data.list[].order | object | 订单主信息（qimall_order 全量字段） |
| data.list[].details | array | 订单明细列表（qimall_order_detail 全量字段） |
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
| is_feedback | int | 售后状态 | qimall_order | is_feedback | 订单维权状态:0:未维权；1：维权中；2：维权完成 |
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
| order_status | int | 订单状态 | qimall_order_detail | order_status | 订单状态【0待付款 1待发货 2已发货 3已收货 4已完成 -1申请维权 -2维权中 -3维权完成 -4已关闭 -5撤销维权】 |
| shipping_status | int | 物流状态 | qimall_order_detail | shipping_status | 物流状态【1已发货 0待发货】 |
| is_feedback | int | 退款状态 | qimall_order_detail | is_feedback | 订单维权状态【0未维权 1维权中 2维权完成】 |
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

### 响应示例

```json
{
  "code": 0,
  "msg": "操作成功",
  "data": {
    "list": [
      {
        "order": {
          "id": 1,
          "mall_id": 1,
          "order_no": "202608090001",
          "user_id": 10,
          "pay_money": 199.00,
          "goods_price": 199.00,
          "order_status": 1,
          "pay_status": 1,
          "shipping_status": 0,
          "created_at": 1723161600,
          "...": "其余全量字段"
        },
        "details": [
          {
            "id": 1,
            "order_id": 1,
            "goods_id": 5,
            "goods_name": "商品名称",
            "goods_attr_name": "规格A",
            "price": 199.00,
            "num": 1,
            "pic_url": "https://...",
            "...": "其余全量字段"
          }
        ]
      }
    ],
    "pagination": {
      "total": 100,
      "page": 1,
      "page_size": 5
    }
  }
}
```

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
| data.details | array | 订单明细列表（含嵌套marketing） |
| data.refunds | array | 售后单列表（含嵌套steps） |
| data.actions | array | 操作日志列表 |
| data.behavior_logs | array | 行为日志列表 |
| data.express | array | 物流信息列表 |
| data.extra | object/null | 订单留言（1:1，无则为null） |
| data.invoice | object/null | 发票信息（1:1，无则为null） |

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
| order_no | string | 售后单号 | qimall_order_refund | order_no | 维权单号 |
| type | int | 售后类型：1=仅退款，2=退货退款，3=换货 | qimall_order_refund | type | 维权类型：1=仅退款，2=退货退款，3=换货 |
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
| step_status | int | 售后步骤状态 | qimall_order_refund | step_status | 维权步骤状态，对应qimall_order_refund_step.step_status最新状态 |
| refund_status | int | 售后状态 | qimall_order_refund | refund_status | 维权状态 |
| status | int | 状态 | qimall_order_refund | status | 状态【1启用 0禁用 -1删除】 |
| created_at | int | 创建时间戳 | qimall_order_refund | created_at | 创建时间 |
| updated_at | int | 修改时间戳 | qimall_order_refund | updated_at | 修改时间 |
| goods_type | int | 商品类型 | qimall_order_refund | goods_type | 商品类型 |
| refund_remark | string | 退款备注 | qimall_order_refund | refund_remark | 后台同意时，填写的退款备注 |
| old_reality_refund_price | decimal | 原实际退款金额 | qimall_order_refund | old_reality_refund_price | 原来实际退款金额 |
| num | int | 数量 | qimall_order_refund | num | 售后数量 |
| order_source | string | 订单来源 | qimall_order_refund | order_source | 订单来源 |
| is_auto_refund | int | 是否自动退款 | qimall_order_refund | is_auto_refund | 是否自动退款 |

### refunds[].steps 字段说明（qimall_order_refund_step 表，1:N嵌套）

| 字段 | 类型 | 说明 | 表名 | 数据库字段 | comment |
|------|------|------|------|------|------|
| id | int | ID | qimall_order_refund_step | id | |
| order_refund_id | int | 售后表ID | qimall_order_refund_step | order_refund_id | 维权表id |
| role | int | 角色：1=买家，2=商家 | qimall_order_refund_step | role | 角色【1买家 2商家】 |
| content | string | 内容 | qimall_order_refund_step | content | 内容 |
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
| nums | array | 发货数量（JSON自动解码） | qimall_order_express | nums | 发货数量 {detail_id: num} |
| source_table | string | 来源表 | qimall_order_express | source_table | 来源表 |
| source_table_id | int | 来源表ID | qimall_order_express | source_table_id | 主键ID |
| edit_num | int | 修改次数 | qimall_order_express | edit_num | 修改次数 |

### extra 字段说明（qimall_order_extra 表，1:1）

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

### 响应示例

```json
{
  "code": 0,
  "msg": "操作成功",
  "data": {
    "order": { "id": 1, "mall_id": 1, "order_no": "202608090001", "...": "qimall_order 全量字段" },
    "details": [
      { "id": 1, "order_id": 1, "goods_name": "商品名称",
        "marketing": { "id": 1, "order_detail_id": 1, "give_score": 10, "...": "qimall_order_marketing 全量字段" },
        "...": "qimall_order_detail 全量字段" }
    ],
    "refunds": [
      { "id": 1, "order_id": 1, "type": 1, "refund_status": 1,
        "steps": [ { "id": 1, "order_refund_id": 1, "role": 1, "content": "买家申请退款", "...": "qimall_order_refund_step 全量字段" } ],
        "...": "qimall_order_refund 全量字段" }
    ],
    "actions": [ { "id": 1, "order_id": 1, "action": "订单创建", "...": "qimall_order_action 全量字段" } ],
    "behavior_logs": [ { "id": 1, "order_id": 1, "behavior": 1, "desc": "创建订单", "extra_info": {}, "...": "qimall_order_behavior_logs 全量字段" } ],
    "express": [ { "id": 1, "order_id": 1, "express_name": "顺丰速运", "express_no": "SF123456", "order_detail_ids": [1,2], "nums": [1,1], "...": "qimall_order_express 全量字段" } ],
    "extra": { "id": 1, "order_id": 1, "message": "请尽快发货", "...": "qimall_order_extra 全量字段" },
    "invoice": { "id": 1, "order_id": 1, "type": 1, "head_name": "公司名称", "...": "qimall_order_invoice 全量字段" }
  }
}
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

```json
{
  "code": 0,
  "msg": "操作成功",
  "data": {
    "list": [
      {
        "refund": { "id": 1, "order_id": 1, "type": 1, "refund_status": 1, "pic_list": [], "...": "qimall_order_refund 全量字段" },
        "steps": [ { "id": 1, "order_refund_id": 1, "role": 1, "content": "买家申请退款", "...": "qimall_order_refund_step 全量字段" } ],
        "detail": { "id": 1, "goods_name": "商品名称", "pic_url": "https://...", "...": "qimall_order_detail 全量字段" },
        "order": { "id": 1, "order_no": "202608090001", "...": "qimall_order 全量字段" }
      }
    ],
    "pagination": { "total": 50, "page": 1, "page_size": 5 }
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

每个枚举字段格式：

```json
{ "desc": "字段描述", "map": [ { "value": 0, "label": "标签文本" }, { "value": 1, "label": "标签文本" } ] }
```

### 各表枚举字段清单

**order（订单主表）**：

| 字段 | 描述 | 涉及Enum |
|------|------|---------|
| order_status | 订单状态 | OrderStatusEnum |
| pay_status | 支付状态 | WhetherEnum |
| shipping_status | 配送状态 | ShippingStatusEnum |
| shipping_type | 配送类型 | ShippingTypeEnum |
| payment_type | 支付方式 | PayTypeEnum |
| status | 状态 | StatusEnum |
| is_comment | 是否评价 | WhetherEnum |
| is_recycle | 是否回收站 | WhetherEnum |
| is_virtual | 是否虚拟商品 | WhetherEnum |
| is_new_user | 是否新顾客 | WhetherEnum |
| is_bill | 是否开票 | WhetherEnum |
| is_print | 是否打印 | WhetherEnum |
| order_source | 订单来源 | OrderSourceEnum |

**order_detail（订单明细）**：

| 字段 | 描述 | 涉及Enum |
|------|------|---------|
| order_status | 订单状态 | OrderStatusEnum |
| shipping_status | 物流状态 | ShippingStatusEnum |
| is_feedback | 退款状态 | WhetherEnum |
| is_evaluate | 是否评价 | WhetherEnum |
| is_virtual | 是否虚拟商品 | WhetherEnum |
| status | 状态 | StatusEnum |
| order_source | 订单来源 | OrderSourceEnum |

**order_refund（售后单）**：

| 字段 | 描述 | 涉及Enum |
|------|------|---------|
| type | 售后类型 | RefundTypeEnum |
| refund_status | 售后状态 | RefundStatusEnum |
| is_refund | 是否打款 | WhetherEnum |
| status | 状态 | StatusEnum |
| is_auto_refund | 是否自动退款 | WhetherEnum |

**order_refund_step（售后步骤）**：

| 字段 | 描述 | 涉及Enum |
|------|------|---------|
| role | 角色 | - |
| step_status | 步骤状态 | - |
| status | 状态 | StatusEnum |

**order_action（操作日志）**：

| 字段 | 描述 | 涉及Enum |
|------|------|---------|
| status | 状态 | StatusEnum |

**order_behavior_logs（行为日志）**：

| 字段 | 描述 | 涉及Enum |
|------|------|---------|
| behavior | 行为类型 | OrderBehaviorLogsEnum |
| operator_user_type | 操作用户类型 | - |
| status | 状态 | StatusEnum |

**order_express（物流信息）**：

| 字段 | 描述 | 涉及Enum |
|------|------|---------|
| shipping_type | 发货方式 | ShippingTypeEnum |
| status | 状态 | StatusEnum |

### 响应示例

```json
{
  "code": 0,
  "msg": "操作成功",
  "data": {
    "order": {
      "order_status": { "desc": "订单状态", "map": [ {"value":0,"label":"待付款"}, {"value":1,"label":"待发货"}, {"value":2,"label":"已发货"}, {"value":3,"label":"已收货"}, {"value":4,"label":"已完成"}, {"value":6,"label":"待自提"}, {"value":7,"label":"自提成功"}, {"value":-4,"label":"已关闭"}, {"value":999,"label":"全部"} ] },
      "pay_status": { "desc": "支付状态", "map": [ {"value":0,"label":"未支付"}, {"value":1,"label":"已支付"} ] }
    },
    "order_refund": {
      "type": { "desc": "售后类型", "map": [ {"value":1,"label":"仅退款"}, {"value":2,"label":"退货退款"}, {"value":3,"label":"换货"} ] }
    },
    "order_behavior_logs": {
      "behavior": { "desc": "行为类型", "map": [ {"value":1,"label":"创建订单"}, {"value":2,"label":"取消订单"}, {"value":3,"label":"订单支付"}, {"value":16,"label":"撤销售后"} ] }
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
| qimall_order_express | nums | 发货数量 {detail_id: num} |
| qimall_order_marketing | give_currency | 赠送货币(json字符串保存) |
| qimall_order_marketing | deduct_currency | 减扣货币(json字符串保存) |
| qimall_order_behavior_logs | extra_info | |

### 金额单位

所有金额字段（pay_money、goods_price、refund_price 等）单位均为**元**，与商品接口（分）不同，订单金额直接以元为单位存储。

### 时间字段

所有时间字段（created_at、updated_at、pay_time 等）为 Unix 时间戳（秒），前端按需格式化。

### 排序规则

- 订单列表：`id DESC`（ID降序，最新订单优先）
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