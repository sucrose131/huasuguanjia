-- 金额白名单数据范围列：仅自己经办 / 权限内全部
-- 业务规则（2026-09-03 确认）：
--   1. amount_scope=1（仅自己经办）：只能看见/修改自己创建单据(created_by=当前用户)的金额
--   2. amount_scope=2（权限内全部）：可看见/修改组织数据权限内所有单据的金额
-- 存量白名单默认仅自己经办：DEFAULT 1 使 ADD COLUMN 后存量行自动补 1，无需逐行 UPDATE。
-- 商品档案等主数据金额（成本/售价）不参与本范围分级，仍由查看能力整体控制。
ALTER TABLE `hspsi_sys_user_amount_access`
  ADD COLUMN `amount_scope` tinyint NOT NULL DEFAULT 1
    COMMENT '金额数据范围 1=仅自己经办 2=权限内全部',
  ADD CONSTRAINT `chk_user_amount_access_scope`
    CHECK (`amount_scope` IN (1, 2));
