-- 工作台、报表中心、系统管理实施基础
-- 菜单类型统一为：1=目录，2=菜单，3=按钮。

UPDATE hspsi_sys_menu
SET type = CASE
  WHEN parent_id = 0 THEN 1
  WHEN route IS NOT NULL AND route <> '' THEN 2
  ELSE type
END
WHERE deleted_at IS NULL;

ALTER TABLE hspsi_sys_menu
  MODIFY COLUMN type TINYINT NOT NULL DEFAULT 1 COMMENT '菜单类型 1=目录 2=菜单 3=按钮';

-- 具体菜单和管理员授权由可重复执行的 apps/api/src/scripts/seed-current-menus.ts 写入。
