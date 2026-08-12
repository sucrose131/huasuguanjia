---
title: "薪福通企业应用开发中心"
url: https://xft.cmbchina.com/open/#/doc/open-document?id=10692&mid=12265
date: 2026/8/7 13:36:35
site_name: "薪福通企业应用开发中心"
source: url
---

# 薪福通企业应用开发中心

实现事件时，请先仔细阅读开发指导“[事件订阅概述](https://xft.cmbchina.com/open/#/doc/open-document?id=10692&mid=10686)”，以确保事件能够正常消费

开发文档OA审批事件OA审批流程结束事件

OA审批流程结束事件

更新时间: 2023-07-20 20:21:20

## 基本信息

事件名称: OA审批流程结束事件  
事件编号: XFTOAFPS

## 事件描述

当流程完结，流程状态为终态时，订阅了该事件的客户可以接收到流程完结通知

## 触发情况

当流程完结，流程状态为终态时，触发该事件

## 事件报文说明

| 字段 | 字段类型 | 是否必填 | 字段描述 | 备注 |
| --- | --- | --- | --- | --- |
| prjCod | String | 是 | 企业号 |  |
| procStatus | String | 是 | 流程状态 | PASSED：已通过;REJECTED：已驳回;CANCELED：已取消;DELETED：已删除 |
| busKey | String | 是 | 业务编号 |  |
| procInstId | String | 是 | 审批编号 |  |
| procKey | String | 是 | 流程Key |  |

## 事件报文示例

```
{  
    "prjCod": "XFT00001",  
    "procStatus": "PASSED",  
    "busKey": "CON_XFA11608_20220830000000000185",  
    "procInstId": "35678907",  
    "procKey": "FORM_20220830000000000185"  
}  
```