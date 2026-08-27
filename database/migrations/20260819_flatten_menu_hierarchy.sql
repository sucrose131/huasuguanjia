-- 菜单层级拍平：消除「目录套目录」结构，菜单严格按「目录(type=1) → 页面(type=2) → 操作(type=3)」三层。
-- 1) master-data:organizations 二级目录拍平为 master-data 下平铺页面
-- 2) reports:directory:* 二级目录拍平为 reports 下平铺页面
-- 3) 补齐被拍平后缺失的顶层目录授权（幂等）

-- ===== 1. master-data:organizations(60) 拍平 =====
UPDATE `hspsi_sys_menu`
SET `parent_id` = 1
WHERE `parent_id` = 60 AND `type` = 2;

DELETE FROM `hspsi_sys_role_menu` WHERE `menu_id` = 60;
DELETE FROM `hspsi_sys_menu` WHERE `id` = 60;

-- ===== 2. reports:directory:*(109~115) 拍平 =====
UPDATE `hspsi_sys_menu`
SET `parent_id` = 71
WHERE `parent_id` IN (109, 110, 111, 112, 113, 114, 115) AND `type` = 2;

DELETE FROM `hspsi_sys_role_menu` WHERE `menu_id` IN (109, 110, 111, 112, 113, 114, 115);
DELETE FROM `hspsi_sys_menu` WHERE `id` IN (109, 110, 111, 112, 113, 114, 115);

-- ===== 3. 补顶层目录授权（角色拥有页面但缺顶层目录时补齐，保证页面不孤立） =====
-- 3.1 reports 顶层(71)
INSERT IGNORE INTO `hspsi_sys_role_menu` (`role_id`, `menu_id`)
SELECT DISTINCT rm.role_id, 71
FROM `hspsi_sys_role_menu` rm
JOIN `hspsi_sys_menu` m ON m.id = rm.menu_id
WHERE m.parent_id = 71 AND m.type = 2
  AND NOT EXISTS (
    SELECT 1 FROM `hspsi_sys_role_menu` x WHERE x.role_id = rm.role_id AND x.menu_id = 71
  );

-- 3.2 master-data 顶层(1)
INSERT IGNORE INTO `hspsi_sys_role_menu` (`role_id`, `menu_id`)
SELECT DISTINCT rm.role_id, 1
FROM `hspsi_sys_role_menu` rm
JOIN `hspsi_sys_menu` m ON m.id = rm.menu_id
WHERE m.parent_id = 1 AND m.type = 2
  AND NOT EXISTS (
    SELECT 1 FROM `hspsi_sys_role_menu` x WHERE x.role_id = rm.role_id AND x.menu_id = 1
  );
