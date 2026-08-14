# OpenApi 商品接口文档

> 版本：v1 | 更新日期：2026-08-10 | 插件：OpenApi

## 概述

商品接口提供商品列表、商品详情和商品常量三个 POST 接口，用于第三方系统获取商城商品数据及解析字段枚举值。

- **基础路径**：`/open-api/v1/goods/`
- **请求方式**：POST（JSON body）
- **Content-Type**：`application/json`
- **免登录**：list、detail、constants 接口均免登录验证

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

## 1. 商品列表

### 请求

```
POST /open-api/v1/goods/list
```

### 请求参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| page | int | 否 | 1 | 页码，最小值1 |
| limit | int | 否 | 20 | 每页条数，最大值100 |
| keyword | string | 否 | - | 商品名称模糊搜索 |
| is_on_sale | int | 否 | - | 上架状态过滤：1=上架，0=下架 |
| cate_id | int | 否 | - | 分类ID过滤 |
| goods_ids | array | 否 | - | 商品ID数组批量查询，元素为正整数，如[1,29,45] |

### 请求示例

```bash
curl -X POST "http://api.ten.com/open-api/v1/goods/list" \
  -H "Host: api.ten.com" \
  -H "Content-Type: application/json" \
  -H "x-mall-sign: Mx7" \
  -d '{"page":1,"limit":2}'
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| data.list | array | 商品列表 |
| data.list[].goods | object | 商品主信息（qimall_goods 全量字段，同详情goods） |
| data.list[].goods_cate | array | 商品分类列表（qimall_goods_cate 全量字段，同详情goods_cate） |
| data.list[].qimall_goods_attr | array | SKU 规格列表（qimall_goods_attr 全量字段，同详情qimall_goods_attr） |
| data.list[].cloud_stock_gift_plan | array | 云库存赠送方案（同详情cloud_stock_gift_plan） |
| data.list[].cloud_stock_upgrade_bag | array | 云库存升级礼包（同详情cloud_stock_upgrade_bag） |
| data.pagination | object | 分页信息 |
| data.pagination.total | int | 总记录数 |
| data.pagination.page | int | 当前页码 |
| data.pagination.page_size | int | 每页条数 |

> **说明**：列表接口每个商品的数据结构与详情接口完全一致，包含完整的关联数据（分类、SKU、云库存方案/礼包）。

### goods 字段说明（qimall_goods 表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 商品ID |
| mall_id | int | 商城ID |
| mch_id | int | 商户ID |
| goods_name | string | 商品名称 |
| subtitle | string | 副标题 |
| price | decimal | 售价 |
| original_price | decimal | 原价（划线价仅展示） |
| cost_price | decimal | 成本价 |
| unit | string | 单位 |
| cover_pic | string | 封面图URL |
| bannar_pic | array | 轮播图列表（JSON自动解码） |
| video_url | string | 视频URL |
| video_cover_pic | string | 视频封面 |
| is_on_sale | int | 是否上架：1=上架，0=下架 |
| is_attr | int | 是否有多规格 |
| attr_groups | string | 规格组 |
| attr_groups_format | string | 规格组格式 |
| status | int | 状态：1=启用 |
| stock | int | 库存 |
| stock_warning | int | 库存预警值 |
| is_show_stock | int | 是否显示库存 |
| is_show_sales | int | 是否显示销量 |
| virtual_sales | int | 虚拟销量 |
| sales_num | int | 实际销量 |
| buy_num_limit | int | 限购数量，-1=不限 |
| freight_type | string | 物流方式【1快递发货 2上门自提】逗号分隔 |
| freight_rules_type | int | 运费规则类型 |
| freight_id | int | 运费模板ID |
| shipping_fee | decimal | 自定义运费金额 |
| free_shipping_num | int | 满件包邮 |
| free_shipping_money | decimal | 商品满额包邮 |
| goods_type | int | 商品类型：1=实物，2=虚拟 |
| detail | string | 商品详情（HTML） |
| is_area_limit | int | 是否区域限制 |
| area_limit | array | 限制区域（JSON自动解码） |
| services | string | 服务标签 |
| labels | string | 商品标签 |
| goods_source | string | 商品来源 |
| check_status | int | 审核状态 |
| check_remark | string | 审核备注 |
| sort | int | 排序值 |
| created_at | int | 创建时间戳 |
| updated_at | int | 更新时间戳 |
| is_show | int | 是否显示 |
| comment_score | decimal | 评分 |
| goods_no | string | 商品编号 |
| is_pay_limit | int | 是否限制支付方式 |
| pay_limit | object | 支付限制配置（JSON自动解码） |
| can_feedback | int | 是否可反馈 |
| goods_subtype | int | 商品子类型 |
| is_virtual_feedback | int | 是否虚拟反馈 |
| freight_compute_mode | int | 运费计算模式 |

### qimall_goods_attr 字段说明（qimall_goods_attr 表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | SKU ID |
| goods_id | int | 商品ID |
| name | string | 规格名称 |
| sign_id | string | 规格标识 |
| stock | int | 库存 |
| price | decimal | 价格 |
| original_price | decimal | 原价 |
| cost_price | decimal | 成本价 |
| goods_no | string | 商品编号 |
| weight | int | 重量（克） |
| pic_url | string | 规格图片URL |
| status | int | 状态：1=启用 |
| version | int | 版本号 |
| sort | int | 排序值 |
| created_at | int | 创建时间戳 |
| updated_at | int | 更新时间戳 |
| is_show | int | 是否显示 |
| is_show_code | int | 是否显示编码 |
| spec_no | string | 规格编码 |

### 响应示例

```json
{
  "code": 0,
  "msg": "操作成功",
  "data": {
    "list": [
      {
        "goods": {
          "id": 1,
          "mall_id": 1,
          "mch_id": 0,
          "goods_name": "尝鲜装",
          "subtitle": "1瓶",
          "price": 686,
          "original_price": 0,
          "cost_price": 0,
          "unit": "瓶",
          "cover_pic": "https://slqy.oss-cn-shenzhen.aliyuncs.com/images/1/2026/01/28/image_1769571945_L0MqaY1z.jpg",
          "bannar_pic": [{"id": 886, "pic_url": "https://slqy.oss-cn-shenzhen.aliyuncs.com/images/1/2026/01/28/image_1769571945_L0MqaY1z.jpg"}],
          "video_url": "",
          "video_cover_pic": "",
          "is_on_sale": 1,
          "is_attr": 0,
          "attr_groups": "",
          "attr_groups_format": "",
          "status": 1,
          "stock": 99840,
          "stock_warning": 1000,
          "is_show_stock": 1,
          "is_show_sales": 1,
          "virtual_sales": 0,
          "sales_num": 164,
          "buy_num_limit": -1,
          "freight_type": 1,
          "freight_rules_type": 1,
          "freight_id": 2,
          "shipping_fee": 0,
          "free_shipping_num": 6,
          "free_shipping_money": 0,
          "goods_type": 1,
          "detail": "<p><img src=\"https://assets.shifangqingyuan.com/images/1/2026/03/26/image_1774504259_FZMHakaz.jpg\"/></p>",
          "is_area_limit": 0,
          "area_limit": [],
          "services": "",
          "labels": "",
          "goods_source": "",
          "check_status": 0,
          "check_remark": "",
          "sort": 1,
          "created_at": 1765508237,
          "updated_at": 1784116682,
          "is_show": 1,
          "comment_score": 0.07,
          "goods_no": "",
          "is_pay_limit": 1,
          "pay_limit": {"WECHAT": 1, "SCORE": 0, "BALANCE": 5, "ALI": 2, "MIXED": 17, "MIXED_TYPE": 0, "MIXED_AMOUNT": "", "DIGITAL": 0, "JOINPAY": 7},
          "can_feedback": 1,
          "goods_subtype": 0,
          "is_virtual_feedback": 0,
          "freight_compute_mode": 0
        },
        "goods_cate": [
          {
            "id": 1,
            "mall_id": 1,
            "mch_id": 0,
            "parent_id": 0,
            "name": "优选专区",
            "pic": "https://slqy.oss-cn-shenzhen.aliyuncs.com/images/1/2025/12/12/image_1765507524_H1ZVK1HV.jpg",
            "big_pic": "",
            "advert_pic": "",
            "advert_url": "",
            "advert_open_type": "",
            "advert_params": null,
            "is_show": 1,
            "status": 1,
            "sort": 0,
            "created_at": 1765507648,
            "updated_at": 1776334387,
            "level": 1,
            "text_color": ""
          }
        ],
        "qimall_goods_attr": [
          {
            "id": 1,
            "goods_id": 1,
            "name": "",
            "sign_id": "",
            "stock": 99840,
            "price": 686,
            "original_price": 0,
            "cost_price": 0,
            "goods_no": "",
            "weight": 120,
            "pic_url": "https://slqy.oss-cn-shenzhen.aliyuncs.com/images/1/2026/01/28/image_1769571945_L0MqaY1z.jpg",
            "status": 1,
            "version": 0,
            "sort": 1,
            "created_at": 1765508237,
            "updated_at": 1785223310,
            "is_show": 1,
            "is_show_code": 0,
            "spec_no": ""
          }
        ],
        "cloud_stock_gift_plan": [],
        "cloud_stock_upgrade_bag": []
      },
      {
        "goods": {
          "id": 29,
          "mall_id": 1,
          "mch_id": 0,
          "goods_name": "舒养包",
          "subtitle": "2瓶",
          "price": 1198,
          "original_price": 0,
          "cost_price": 0,
          "unit": "",
          "cover_pic": "https://assets.shifangqingyuan.com/images/1/2026/03/26/image_1774493993_AnQbV8Wl.jpg",
          "bannar_pic": [{"id": 1265, "pic_url": "https://assets.shifangqingyuan.com/images/1/2026/03/26/image_1774493993_AnQbV8Wl.jpg"}],
          "video_url": "",
          "video_cover_pic": "",
          "is_on_sale": 1,
          "is_attr": 0,
          "attr_groups": "",
          "attr_groups_format": "",
          "status": 1,
          "stock": 99859,
          "stock_warning": 0,
          "is_show_stock": 1,
          "is_show_sales": 1,
          "virtual_sales": 0,
          "sales_num": 143,
          "buy_num_limit": -1,
          "freight_type": 1,
          "freight_rules_type": 1,
          "freight_id": 1,
          "shipping_fee": 0,
          "free_shipping_num": 0,
          "free_shipping_money": 0,
          "goods_type": 2,
          "detail": "<p><img src=\"https://assets.shifangqingyuan.com/images/1/2026/03/26/image_1774504259_FZMHakaz.jpg\"/></p>",
          "is_area_limit": 0,
          "area_limit": [],
          "services": "",
          "labels": "",
          "goods_source": "",
          "check_status": 0,
          "check_remark": "",
          "sort": 2,
          "created_at": 1774493244,
          "updated_at": 1785289483,
          "is_show": 1,
          "comment_score": 0.03,
          "goods_no": "",
          "is_pay_limit": 1,
          "pay_limit": {"WECHAT": 0, "SCORE": 0, "BALANCE": 5, "ALI": 0, "MIXED": 0, "MIXED_TYPE": 0, "MIXED_AMOUNT": "", "DIGITAL": 27, "JOINPAY": 0},
          "can_feedback": 0,
          "goods_subtype": 0,
          "is_virtual_feedback": 1,
          "freight_compute_mode": 0
        },
        "goods_cate": [
          {
            "id": 1,
            "mall_id": 1,
            "mch_id": 0,
            "parent_id": 0,
            "name": "优选专区",
            "pic": "https://slqy.oss-cn-shenzhen.aliyuncs.com/images/1/2025/12/12/image_1765507524_H1ZVK1HV.jpg",
            "big_pic": "",
            "advert_pic": "",
            "advert_url": "",
            "advert_open_type": "",
            "advert_params": null,
            "is_show": 1,
            "status": 1,
            "sort": 0,
            "created_at": 1765507648,
            "updated_at": 1776334387,
            "level": 1,
            "text_color": ""
          }
        ],
        "qimall_goods_attr": [
          {
            "id": 29,
            "goods_id": 29,
            "name": "",
            "sign_id": "",
            "stock": 99859,
            "price": 1198,
            "original_price": 0,
            "cost_price": 0,
            "goods_no": "",
            "weight": 0,
            "pic_url": "https://assets.shifangqingyuan.com/images/1/2026/03/26/image_1774493993_AnQbV8Wl.jpg",
            "status": 1,
            "version": 0,
            "sort": 2,
            "created_at": 1774493244,
            "updated_at": 1785289480,
            "is_show": 1,
            "is_show_code": 0,
            "spec_no": ""
          }
        ],
        "cloud_stock_gift_plan": [],
        "cloud_stock_upgrade_bag": [
          {
            "id": 3,
            "mall_id": 1,
            "name": "2瓶升级礼包",
            "level": 1,
            "goods_id": [29],
            "give_goods_num": [{"goods_id": 1, "num": 2}],
            "give_goods_id": [1],
            "is_enable": 1,
            "status": 1,
            "created_at": 1774493894,
            "updated_at": 1774493894,
            "level_reward": [{"level": 1, "name": "经销商", "indirect_over_reward": 0, "indirect_equal_reward": 0, "direct_over_reward": 0, "direct_equal_reward": 0}],
            "is_percent": 0
          }
        ]
      }
    ],
    "pagination": {
      "total": 20,
      "page": 1,
      "page_size": 2
    }
  }
}
```

---

## 2. 商品详情

### 请求

```
POST /open-api/v1/goods/detail
```

### 请求参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| goods_id | int | 是 | - | 商品ID |

### 请求示例

```bash
curl -X POST "http://api.ten.com/open-api/v1/goods/detail" \
  -H "Host: api.ten.com" \
  -H "Content-Type: application/json" \
  -H "x-mall-sign: Mx7" \
  -d '{"goods_id":29}'
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| data.goods | object | 商品主信息（qimall_goods 全量字段，同列表goods） |
| data.goods_cate | array | 商品分类列表（qimall_goods_cate 全量字段） |
| data.qimall_goods_attr | array | SKU 规格列表（qimall_goods_attr 全量字段，同列表qimall_goods_attr） |
| data.cloud_stock_gift_plan | array | 云库存赠送方案（qimall_addons_cloud_stock_gift_plan） |
| data.cloud_stock_upgrade_bag | array | 云库存升级礼包（qimall_addons_cloud_stock_upgrade_bag） |

### goods_cate 字段说明（qimall_goods_cate 表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 分类ID |
| mall_id | int | 商城ID |
| mch_id | int | 商户ID |
| parent_id | int | 父分类ID |
| name | string | 分类名称 |
| pic | string | 分类图片 |
| big_pic | string | 大图 |
| advert_pic | string | 广告图 |
| advert_url | string | 广告链接 |
| advert_open_type | string | 广告打开方式 |
| advert_params | mixed | 广告参数 |
| is_show | int | 是否显示 |
| status | int | 状态 |
| sort | int | 排序值 |
| level | int | 层级 |
| text_color | string | 文字颜色 |
| created_at | int | 创建时间戳 |
| updated_at | int | 更新时间戳 |

### cloud_stock_gift_plan 字段说明（qimall_addons_cloud_stock_gift_plan 表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 方案ID |
| mall_id | int | 商城ID |
| goods_id | array | 关联商品ID（JSON自动解码，如 `[1,2]`；兼容旧格式单个整数） |
| give_goods_num | array | 赠送商品数量（JSON自动解码，如 `[{"goods_id":5,"num":2}]`；兼容旧格式单个整数） |
| give_goods_id | string | 赠送商品ID（数据库原始字符串，如 `"[1,5]"` 或 `"1"`） |
| gift_condition_level | string | 赠送条件-上级代理等级 |
| gift_condition_self_level | string | 赠送条件-自身代理等级 |
| is_gift_goods_quantity | int | 是否按商品数量计算赠送：0=固定数量，1=按购买数量倍数 |
| status | int | 状态：1=启用，0=禁用，-1=删除 |
| created_at | int | 创建时间戳 |
| updated_at | int | 更新时间戳 |

### cloud_stock_upgrade_bag 字段说明（qimall_addons_cloud_stock_upgrade_bag 表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 礼包ID |
| mall_id | int | 商城ID |
| name | string | 升级礼包名称 |
| level | int | 升级等级权重 |
| goods_id | array | 关联商品ID（JSON自动解码，如 `[2,5]`；兼容旧格式单个整数） |
| give_goods_num | array | 赠送商品数量（JSON自动解码，如 `[{"goods_id":5,"num":2}]`；兼容旧格式单个整数） |
| give_goods_id | array | 赠送商品ID（JSON自动解码；兼容旧格式单个整数） |
| is_enable | int | 是否启用：1=启用，0=禁用 |
| level_reward | array | 奖励设置（JSON自动解码，按等级配置直推/间推奖励金额，结构见下方） |
| is_percent | int | 奖励计算方式：0=固定金额，1=百分比 |
| status | int | 状态：1=启用，0=禁用，-1=删除 |
| created_at | int | 创建时间戳 |
| updated_at | int | 更新时间戳 |

#### level_reward 数组元素结构

| 字段 | 类型 | 说明 |
|------|------|------|
| level | int | 代理等级权重 |
| name | string | 代理等级名称 |
| direct_over_reward | decimal | 直推超越奖励（元） |
| direct_equal_reward | decimal | 直推平级奖励（元） |
| indirect_over_reward | decimal | 间推超越奖励（元） |
| indirect_equal_reward | decimal | 间推平级奖励（元） |

#### give_goods_num 数组元素结构

| 字段 | 类型 | 说明 |
|------|------|------|
| goods_id | int | 赠送商品ID |
| num | int | 赠送数量 |

### 响应示例

```json
{
  "code": 0,
  "msg": "操作成功",
  "data": {
    "goods": {
      "id": 1,
      "mall_id": 1,
      "mch_id": 0,
      "goods_name": "尝鲜装",
      "subtitle": "1瓶",
      "price": 686,
      "original_price": 0,
      "cost_price": 0,
      "unit": "瓶",
      "cover_pic": "https://slqy.oss-cn-shenzhen.aliyuncs.com/images/...",
      "bannar_pic": [{"id": 886, "pic_url": "https://..."}],
      "video_url": "",
      "video_cover_pic": "",
      "is_on_sale": 1,
      "is_attr": 0,
      "attr_groups": "",
      "attr_groups_format": "",
      "status": 1,
      "stock": 99840,
      "stock_warning": 1000,
      "is_show_stock": 1,
      "is_show_sales": 1,
      "virtual_sales": 0,
      "sales_num": 164,
      "buy_num_limit": -1,
      "freight_type": 1,
      "freight_rules_type": 1,
      "freight_id": 2,
      "shipping_fee": 0,
      "free_shipping_num": 6,
      "free_shipping_money": 0,
      "goods_type": 1,
      "detail": "<p>...</p>",
      "is_area_limit": 0,
      "area_limit": [],
      "services": "",
      "labels": "",
      "goods_source": "",
      "check_status": 0,
      "check_remark": "",
      "sort": 1,
      "created_at": 1765508237,
      "updated_at": 1784116682,
      "is_show": 1,
      "comment_score": 0.07,
      "goods_no": "",
      "is_pay_limit": 1,
      "pay_limit": {"WECHAT": 1, "SCORE": 0, "BALANCE": 5, "ALI": 2, "MIXED": 17, "MIXED_TYPE": 0, "MIXED_AMOUNT": "", "DIGITAL": 0, "JOINPAY": 7},
      "can_feedback": 1,
      "goods_subtype": 0,
      "is_virtual_feedback": 0,
      "freight_compute_mode": 0
    },
    "goods_cate": [
      {
        "id": 1,
        "mall_id": 1,
        "mch_id": 0,
        "parent_id": 0,
        "name": "优选专区",
        "pic": "https://slqy.oss-cn-shenzhen.aliyuncs.com/images/...",
        "big_pic": "",
        "advert_pic": "",
        "advert_url": "",
        "advert_open_type": "",
        "advert_params": null,
        "is_show": 1,
        "status": 1,
        "sort": 0,
        "created_at": 1765507648,
        "updated_at": 1776334387,
        "level": 1,
        "text_color": ""
      }
    ],
    "qimall_goods_attr": [
      {
        "id": 1,
        "goods_id": 1,
        "name": "",
        "sign_id": "",
        "stock": 99840,
        "price": 686,
        "original_price": 0,
        "cost_price": 0,
        "goods_no": "",
        "weight": 120,
        "pic_url": "https://slqy.oss-cn-shenzhen.aliyuncs.com/images/...",
        "status": 1,
        "version": 0,
        "sort": 1,
        "created_at": 1765508237,
        "updated_at": 1785223310,
        "is_show": 1,
        "is_show_code": 0,
        "spec_no": ""
      }
    ],
    "cloud_stock_gift_plan": [],
    "cloud_stock_upgrade_bag": []
  }
}
```

---

## 3. 商品常量

### 请求

```
POST /open-api/v1/goods/constants
```

### 请求参数

无（无需请求体，仅需认证头）

### 请求示例

```bash
curl -X POST "http://api.ten.com/open-api/v1/goods/constants" \
  -H "Host: api.ten.com" \
  -H "Content-Type: application/json" \
  -H "x-mall-sign: Mx7"
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| data.goods | object | 商品表（qimall_goods）字段常量映射 |
| data.goods_attr | object | 商品SKU表（qimall_goods_attr）字段常量映射 |
| data.goods_cate | object | 商品分类表（qimall_goods_cate）字段常量映射 |
| data.cloud_stock_gift_plan | object | 云库存赠送方案表常量映射 |
| data.cloud_stock_upgrade_bag | object | 云库存升级礼包表常量映射 |

每个表分组下，各字段结构为：

| 字段 | 类型 | 说明 |
|------|------|------|
| desc | string | 字段中文描述 |
| map | array | 枚举值映射，格式 `[{value, label}]` |

### goods 常量字段

| 字段名 | desc | map 值 |
|--------|------|--------|
| is_on_sale | 上架状态 | `[{1,"上架"},{0,"下架"}]` |
| is_attr | 是否多规格 | `[{1,"是"},{0,"否"}]` |
| goods_type | 商品类型 | `[{1,"实物商品"},{2,"虚拟商品"},{3,"预约商品"}]` |
| status | 记录状态 | `[{1,"启用"},{0,"禁用"}]` |
| check_status | 审核状态 | `[{0,"未审核"},{1,"审核通过"},{2,"审核拒绝"}]` |
| goods_subtype | 商品子类型 | `[{0,"普通商品"},{1,"处方药商品"}]` |
| is_show | 是否在主商城显示 | `[{1,"是"},{0,"否"}]` |
| can_feedback | 是否可售后 | `[{1,"是"},{0,"否"}]` |
| is_virtual_feedback | 是否虚拟反馈 | `[{1,"是"},{0,"否"}]` |
| is_area_limit | 是否区域限制 | `[{1,"是"},{0,"否"}]` |
| is_pay_limit | 是否限制支付方式 | `[{1,"是"},{0,"否"}]` |
| is_show_stock | 是否显示库存 | `[{1,"是"},{0,"否"}]` |
| is_show_sales | 是否显示销量 | `[{1,"是"},{0,"否"}]` |
| freight_type | 运费类型 | `[{1,"固定运费"},{2,"运费模板"}]` |

### goods_attr 常量字段

| 字段名 | desc | map 值 |
|--------|------|--------|
| status | 记录状态 | `[{1,"启用"},{0,"禁用"}]` |
| is_show | 是否显示 | `[{1,"是"},{0,"否"}]` |

### goods_cate 常量字段

| 字段名 | desc | map 值 |
|--------|------|--------|
| is_show | 是否显示 | `[{1,"是"},{0,"否"}]` |
| status | 记录状态 | `[{1,"启用"},{0,"禁用"}]` |

### cloud_stock_gift_plan 常量字段

| 字段名 | desc | map 值 |
|--------|------|--------|
| is_gift_goods_quantity | 是否按商品数量计算赠送 | `[{0,"固定数量"},{1,"按购买数量倍数"}]` |
| status | 记录状态 | `[{1,"启用"},{0,"禁用"}]` |

### cloud_stock_upgrade_bag 常量字段

| 字段名 | desc | map 值 |
|--------|------|--------|
| is_enable | 是否启用 | `[{1,"是"},{0,"否"}]` |
| is_percent | 奖励计算方式 | `[{0,"固定金额"},{1,"百分比"}]` |
| status | 记录状态 | `[{1,"启用"},{0,"禁用"}]` |

### 响应示例

```json
{
  "code": 0,
  "msg": "操作成功",
  "data": {
    "goods": {
      "is_on_sale": {
        "desc": "上架状态",
        "map": [
          {"value": 1, "label": "上架"},
          {"value": 0, "label": "下架"}
        ]
      },
      "is_attr": {
        "desc": "是否多规格",
        "map": [
          {"value": 1, "label": "是"},
          {"value": 0, "label": "否"}
        ]
      },
      "goods_type": {
        "desc": "商品类型",
        "map": [
          {"value": 1, "label": "实物商品"},
          {"value": 2, "label": "虚拟商品"},
          {"value": 3, "label": "预约商品"}
        ]
      },
      "status": {
        "desc": "记录状态",
        "map": [
          {"value": 1, "label": "启用"},
          {"value": 0, "label": "禁用"}
        ]
      },
      "check_status": {
        "desc": "审核状态",
        "map": [
          {"value": 0, "label": "未审核"},
          {"value": 1, "label": "审核通过"},
          {"value": 2, "label": "审核拒绝"}
        ]
      },
      "goods_subtype": {
        "desc": "商品子类型",
        "map": [
          {"value": 0, "label": "普通商品"},
          {"value": 1, "label": "处方药商品"}
        ]
      },
      "is_show": {
        "desc": "是否在主商城显示",
        "map": [
          {"value": 1, "label": "是"},
          {"value": 0, "label": "否"}
        ]
      },
      "can_feedback": {
        "desc": "是否可售后",
        "map": [
          {"value": 1, "label": "是"},
          {"value": 0, "label": "否"}
        ]
      },
      "is_virtual_feedback": {
        "desc": "是否虚拟反馈",
        "map": [
          {"value": 1, "label": "是"},
          {"value": 0, "label": "否"}
        ]
      },
      "is_area_limit": {
        "desc": "是否区域限制",
        "map": [
          {"value": 1, "label": "是"},
          {"value": 0, "label": "否"}
        ]
      },
      "is_pay_limit": {
        "desc": "是否限制支付方式",
        "map": [
          {"value": 1, "label": "是"},
          {"value": 0, "label": "否"}
        ]
      },
      "is_show_stock": {
        "desc": "是否显示库存",
        "map": [
          {"value": 1, "label": "是"},
          {"value": 0, "label": "否"}
        ]
      },
      "is_show_sales": {
        "desc": "是否显示销量",
        "map": [
          {"value": 1, "label": "是"},
          {"value": 0, "label": "否"}
        ]
      },
      "freight_type": {
        "desc": "运费类型",
        "map": [
          {"value": 1, "label": "固定运费"},
          {"value": 2, "label": "运费模板"}
        ]
      }
    },
    "goods_attr": {
      "status": {
        "desc": "记录状态",
        "map": [
          {"value": 1, "label": "启用"},
          {"value": 0, "label": "禁用"}
        ]
      },
      "is_show": {
        "desc": "是否显示",
        "map": [
          {"value": 1, "label": "是"},
          {"value": 0, "label": "否"}
        ]
      }
    },
    "goods_cate": {
      "is_show": {
        "desc": "是否显示",
        "map": [
          {"value": 1, "label": "是"},
          {"value": 0, "label": "否"}
        ]
      },
      "status": {
        "desc": "记录状态",
        "map": [
          {"value": 1, "label": "启用"},
          {"value": 0, "label": "禁用"}
        ]
      }
    },
    "cloud_stock_gift_plan": {
      "is_gift_goods_quantity": {
        "desc": "是否按商品数量计算赠送",
        "map": [
          {"value": 0, "label": "固定数量"},
          {"value": 1, "label": "按购买数量倍数"}
        ]
      },
      "status": {
        "desc": "记录状态",
        "map": [
          {"value": 1, "label": "启用"},
          {"value": 0, "label": "禁用"}
        ]
      }
    },
    "cloud_stock_upgrade_bag": {
      "is_enable": {
        "desc": "是否启用",
        "map": [
          {"value": 1, "label": "是"},
          {"value": 0, "label": "否"}
        ]
      },
      "is_percent": {
        "desc": "奖励计算方式",
        "map": [
          {"value": 0, "label": "固定金额"},
          {"value": 1, "label": "百分比"}
        ]
      },
      "status": {
        "desc": "记录状态",
        "map": [
          {"value": 1, "label": "启用"},
          {"value": 0, "label": "禁用"}
        ]
      }
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
| 1 | 商品ID不能为空 | detail 接口 goods_id <= 0 |
| 1 | 商品不存在 | detail 接口商品未找到或已下架 |

---

## 数据说明

### JSON 字段自动解码

接口返回中，数据库存储为 JSON 字符串的字段会自动解码为数组/对象返回，包括但不限于：

| 字段 | 解码前示例 | 解码后示例 |
|------|-----------|-----------|
| bannar_pic | `"[{\"id\":886,...}]"` | `[{"id":886,...}]` |
| area_limit | `"[]"` | `[]` |
| pay_limit | `"{\"WECHAT\":1,...}"` | `{"WECHAT":1,...}` |
| advert_params | `"null"` 或 JSON字符串 | 数组或 null |

### 金额单位

所有金额字段（price、original_price、cost_price、shipping_fee、free_shipping_money 等）数据库类型均为 `decimal(10,2)`，单位为**元**，保留2位小数，前端直接展示无需转换。

### 排序规则

列表接口默认排序：`sort ASC, id DESC`（排序值升序，ID降序）。

### 分页限制

- page 最小值：1（小于1自动修正为1）
- limit 范围：1~100（超出100自动截断为100）

---

## 关联关系

```
qimall_goods (SPU)
  ├── qimall_goods_attr (SKU)          1:N  通过 goods_id 关联
  ├── qimall_goods_cate_relate         N:N  中间表
  │     └── qimall_goods_cate               通过 cate_id 关联
  ├── qimall_addons_cloud_stock_gift_plan  N:N  goods_id JSON数组匹配
  └── qimall_addons_cloud_stock_upgrade_bag N:N  goods_id JSON数组匹配