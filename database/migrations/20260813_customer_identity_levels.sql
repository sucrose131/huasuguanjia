-- 华溯之家用户同步：客户身份 JSON 字段
-- 对应 docs/global/integrations/huasu-home/用户同步.md
-- levels 仅存身份描述（百岁加 / 省级合伙人 / 推广身份），不存外部 ID

ALTER TABLE `hspsi_basic_customer`
  ADD COLUMN `levels` json DEFAULT NULL COMMENT '用户身份描述JSON：百岁加会员/省级合伙人/推广身份' AFTER `remark`;
