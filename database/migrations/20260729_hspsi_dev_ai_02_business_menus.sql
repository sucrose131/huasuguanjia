-- hspsi-dev-ai-02 menu alignment for the implemented business modules.
-- Idempotent: menu codes are checked before insertion and grants are inserted with INSERT IGNORE.

INSERT INTO hspsi_sys_menu(parent_id,path,name,code,icon,route,component,redirect,type,status,sort,remark,created_by,updated_by)
SELECT 0,'/','库存管理','inventory','TakeawayBox',NULL,NULL,NULL,0,1,50,'库存业务菜单',1,1
WHERE NOT EXISTS (SELECT 1 FROM hspsi_sys_menu WHERE code='inventory' AND deleted_at IS NULL);
SET @inventory_menu_id=(SELECT id FROM hspsi_sys_menu WHERE code='inventory' AND deleted_at IS NULL ORDER BY id LIMIT 1);
INSERT INTO hspsi_sys_menu(parent_id,path,name,code,route,type,status,sort,remark,created_by,updated_by)
SELECT @inventory_menu_id,CAST(@inventory_menu_id AS CHAR),x.name,x.code,x.route,1,1,x.sort,'库存业务菜单',1,1 FROM (
 SELECT '库存查询' name,'inventory:stocks' code,'/inventory/stocks' route,1 sort UNION ALL
 SELECT '库存调拨单','inventory:transfers','/inventory/transfers',2 UNION ALL
 SELECT '库存调整记录','inventory:adjustments','/inventory/adjustments',3 UNION ALL
 SELECT '报损单','inventory:losses','/inventory/losses',4 UNION ALL
 SELECT '报亏出库单','inventory:loss-outputs','/inventory/loss-outputs',5 UNION ALL
 SELECT '报溢单','inventory:overflows','/inventory/overflows',6 UNION ALL
 SELECT '库存盘点','inventory:checks','/inventory/checks',7 UNION ALL
 SELECT '库存预警','inventory:quantity-alerts','/inventory/quantity-alerts',8 UNION ALL
 SELECT '效期预警','inventory:expiry-alerts','/inventory/expiry-alerts',9
) x WHERE NOT EXISTS (SELECT 1 FROM hspsi_sys_menu m WHERE m.code=x.code AND m.deleted_at IS NULL);

INSERT INTO hspsi_sys_menu(parent_id,path,name,code,icon,route,component,redirect,type,status,sort,remark,created_by,updated_by)
SELECT 0,'/','生产管理','production','Goods',NULL,NULL,NULL,0,1,60,'生产业务菜单',1,1
WHERE NOT EXISTS (SELECT 1 FROM hspsi_sys_menu WHERE code='production' AND deleted_at IS NULL);
SET @production_menu_id=(SELECT id FROM hspsi_sys_menu WHERE code='production' AND deleted_at IS NULL ORDER BY id LIMIT 1);
INSERT INTO hspsi_sys_menu(parent_id,path,name,code,route,type,status,sort,remark,created_by,updated_by)
SELECT @production_menu_id,CAST(@production_menu_id AS CHAR),x.name,x.code,x.route,1,1,x.sort,'生产业务菜单',1,1 FROM (
 SELECT 'BOM编排' name,'production:boms' code,'/production/boms' route,1 sort UNION ALL
 SELECT '生产计划单','production:plans','/production/plans',2 UNION ALL SELECT '生产出库单','production:outputs','/production/outputs',3 UNION ALL
 SELECT '成品入库单','production:inputs','/production/inputs',4 UNION ALL SELECT '缺料清单','production:shortages','/production/shortages',5
) x WHERE NOT EXISTS (SELECT 1 FROM hspsi_sys_menu m WHERE m.code=x.code AND m.deleted_at IS NULL);

INSERT INTO hspsi_sys_menu(parent_id,path,name,code,icon,route,component,redirect,type,status,sort,remark,created_by,updated_by)
SELECT 0,'/','销售管理','sales','ShoppingCart',NULL,NULL,NULL,0,1,70,'销售业务菜单',1,1
WHERE NOT EXISTS (SELECT 1 FROM hspsi_sys_menu WHERE code='sales' AND deleted_at IS NULL);
SET @sales_menu_id=(SELECT id FROM hspsi_sys_menu WHERE code='sales' AND deleted_at IS NULL ORDER BY id LIMIT 1);
INSERT INTO hspsi_sys_menu(parent_id,path,name,code,route,type,status,sort,remark,created_by,updated_by)
SELECT @sales_menu_id,CAST(@sales_menu_id AS CHAR),x.name,x.code,x.route,1,1,x.sort,'销售业务菜单',1,1 FROM (
 SELECT '销售订单' name,'sales:orders' code,'/sales/orders' route,1 sort UNION ALL SELECT '销售出库单','sales:outputs','/sales/outputs',2 UNION ALL
 SELECT '销售退货单','sales:returns','/sales/returns',3 UNION ALL SELECT '销售收款','sales:payments','/sales/payments',4 UNION ALL
 SELECT '销售退款','sales:refunds','/sales/refunds',5 UNION ALL SELECT '折价销售单','sales:discount-orders','/sales/discount-orders',6 UNION ALL
 SELECT '售后记录','sales:services','/sales/services',7
) x WHERE NOT EXISTS (SELECT 1 FROM hspsi_sys_menu m WHERE m.code=x.code AND m.deleted_at IS NULL);

INSERT INTO hspsi_sys_menu(parent_id,path,name,code,icon,route,component,redirect,type,status,sort,remark,created_by,updated_by)
SELECT 0,'/','领用管理','requisitions','TakeawayBox',NULL,NULL,NULL,0,1,80,'领用业务菜单',1,1
WHERE NOT EXISTS (SELECT 1 FROM hspsi_sys_menu WHERE code='requisitions' AND deleted_at IS NULL);
SET @requisitions_menu_id=(SELECT id FROM hspsi_sys_menu WHERE code='requisitions' AND deleted_at IS NULL ORDER BY id LIMIT 1);
INSERT INTO hspsi_sys_menu(parent_id,path,name,code,route,type,status,sort,remark,created_by,updated_by)
SELECT @requisitions_menu_id,CAST(@requisitions_menu_id AS CHAR),x.name,x.code,x.route,1,1,x.sort,'领用业务菜单',1,1 FROM (
 SELECT '领用申请单' name,'requisitions:applications' code,'/requisitions/applications' route,1 sort UNION ALL
 SELECT '领用出库单','requisitions:outputs','/requisitions/outputs',2 UNION ALL SELECT '领用退回单','requisitions:returns','/requisitions/returns',3
) x WHERE NOT EXISTS (SELECT 1 FROM hspsi_sys_menu m WHERE m.code=x.code AND m.deleted_at IS NULL);

INSERT IGNORE INTO hspsi_sys_role_menu(role_id,menu_id)
SELECT ur.role_id,m.id FROM hspsi_sys_user u
JOIN hspsi_sys_user_role ur ON ur.user_id=u.id
JOIN hspsi_sys_menu m ON m.deleted_at IS NULL AND (m.code IN ('inventory','production','sales','requisitions') OR m.code LIKE 'inventory:%' OR m.code LIKE 'production:%' OR m.code LIKE 'sales:%' OR m.code LIKE 'requisitions:%')
WHERE u.username='admin' AND u.deleted_at IS NULL;

-- Normalize the renamed base/purchase routes used by the current Vue router.
UPDATE hspsi_sys_menu SET route='/base/vendors',updated_by=1 WHERE code IN ('vendors:view','master-data:vendors');
UPDATE hspsi_sys_menu SET route='/base/customers',updated_by=1 WHERE code IN ('customers:view','master-data:customers');
UPDATE hspsi_sys_menu SET route='/base/organizations',updated_by=1 WHERE code IN ('organizations:view','master-data:organizations');
UPDATE hspsi_sys_menu SET route='/base/warehouses',updated_by=1 WHERE code IN ('warehouses:view','master-data:warehouses');
UPDATE hspsi_sys_menu SET route='/base/units',updated_by=1 WHERE code IN ('units:view','master-data:units');
UPDATE hspsi_sys_menu SET route='/goods/properties',updated_by=1 WHERE code IN ('attributes:view','goods:properties');
UPDATE hspsi_sys_menu SET route='/purchase/applications',updated_by=1 WHERE code IN ('purchase_approves:view','purchase:applications');
