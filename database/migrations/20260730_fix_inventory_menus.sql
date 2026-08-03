-- 将运行中旧版十项库存菜单同步为需求文档规定的九项。
START TRANSACTION;

SET @inventory_parent := (SELECT id FROM hspsi_sys_menu WHERE code = 'inventory' AND deleted_at IS NULL LIMIT 1);

UPDATE hspsi_sys_menu SET name = '库存查询', sort = 1, route = '/inventory/stocks', updated_at = NOW() WHERE parent_id = @inventory_parent AND code = 'inventory:stocks';
UPDATE hspsi_sys_menu SET name = '库存调拨单', sort = 2, route = '/inventory/transfers', updated_at = NOW() WHERE parent_id = @inventory_parent AND code = 'inventory:transfers';
UPDATE hspsi_sys_menu SET name = '库存调整记录', sort = 3, route = '/inventory/adjustments', updated_at = NOW() WHERE parent_id = @inventory_parent AND code = 'inventory:adjustments';
UPDATE hspsi_sys_menu SET name = '报损单', sort = 4, route = '/inventory/losses', updated_at = NOW() WHERE parent_id = @inventory_parent AND code = 'inventory:losses';
UPDATE hspsi_sys_menu SET name = '报亏出库单', sort = 5, route = '/inventory/loss-outputs', updated_at = NOW() WHERE parent_id = @inventory_parent AND code = 'inventory:loss-outputs';
UPDATE hspsi_sys_menu SET name = '报溢单', sort = 6, route = '/inventory/overflows', updated_at = NOW() WHERE parent_id = @inventory_parent AND code = 'inventory:overflows';
UPDATE hspsi_sys_menu SET name = '库存盘点', sort = 7, route = '/inventory/checks', updated_at = NOW() WHERE parent_id = @inventory_parent AND code = 'inventory:checks';
UPDATE hspsi_sys_menu SET name = '库存预警', sort = 8, route = '/inventory/quantity-alerts', updated_at = NOW() WHERE parent_id = @inventory_parent AND code = 'inventory:quantity-alerts';
UPDATE hspsi_sys_menu SET name = '效期预警', sort = 9, route = '/inventory/expiry-alerts', updated_at = NOW() WHERE parent_id = @inventory_parent AND code = 'inventory:expiry-alerts';

DELETE FROM hspsi_sys_role_menu WHERE menu_id IN (SELECT id FROM hspsi_sys_menu WHERE parent_id = @inventory_parent AND code = 'inventory:ledger');
DELETE FROM hspsi_sys_menu WHERE parent_id = @inventory_parent AND code = 'inventory:ledger';

COMMIT;
