-- 菜单级操作权限与用户人工多组织授权基线
--
-- 已确认业务口径：
-- 1. OA 只决定员工唯一固定所属组织；页面顶部不使用授权组织切换身份。
-- 2. 页面菜单本身代表“查看”权限；新增、编辑、删除及业务专用动作使用 type=3 按钮权限。
-- 3. 一个用户只能绑定一个角色；角色决定菜单和操作，用户授权组织决定可处理的数据范围。
-- 4. OA 同步只自动保留主组织；兼任组织和岗位所属组织不再自动扩大数据权限。
-- 5. 超级管理员后续手工增加的授权组织使用 created_by 记录管理员用户 ID，不能被本补丁删除。
-- 6. 金额白名单 hspsi_sys_user_amount_access 完全独立，本补丁不访问也不修改。
--
-- 本补丁只增加/调整权限基础数据和字典数据，不新增、删除或修改任何持久化表字段。

START TRANSACTION;

DROP TEMPORARY TABLE IF EXISTS tmp_permission_pages;
CREATE TEMPORARY TABLE tmp_permission_pages (
  page_code varchar(100) NOT NULL,
  permission_prefix varchar(100) NOT NULL,
  can_create tinyint NOT NULL DEFAULT 0,
  can_update tinyint NOT NULL DEFAULT 0,
  can_delete tinyint NOT NULL DEFAULT 0,
  can_status tinyint NOT NULL DEFAULT 0,
  can_export tinyint NOT NULL DEFAULT 0,
  PRIMARY KEY (page_code)
);

-- “查看”由现有 type=2 页面菜单承担；下列标记只生成页面实际存在的其他通用操作。
INSERT INTO tmp_permission_pages (
  page_code, permission_prefix, can_create, can_update, can_delete, can_status, can_export
) VALUES
  ('dashboard:1:view', 'dashboard:overview', 0, 0, 0, 0, 0),
  ('dashboard:2:view', 'dashboard:todos', 0, 0, 0, 0, 0),
  ('dashboard:3:view', 'dashboard:messages', 0, 0, 0, 0, 0),
  ('dashboard:4:view', 'dashboard:shortcuts', 0, 0, 0, 0, 0),

  ('master-data:vendors', 'master-data:vendors', 1, 1, 1, 1, 0),
  ('master-data:customers', 'master-data:customers', 1, 1, 1, 1, 0),
  ('master-data:companies', 'master-data:companies', 1, 1, 1, 1, 0),
  ('master-data:departments', 'master-data:departments', 1, 1, 1, 1, 0),
  ('master-data:positions', 'master-data:positions', 1, 1, 1, 1, 0),
  ('master-data:employees', 'master-data:employees', 1, 1, 1, 1, 0),
  ('master-data:warehouses', 'master-data:warehouses', 1, 1, 1, 1, 0),
  ('master-data:units', 'master-data:units', 1, 1, 1, 1, 0),

  ('goods:products', 'goods:products', 1, 1, 1, 1, 0),
  ('goods:categories', 'goods:categories', 1, 1, 1, 1, 0),
  ('goods:properties', 'goods:properties', 0, 0, 0, 0, 0),

  ('purchase:applications', 'purchase:applications', 1, 1, 1, 0, 0),
  ('purchase:orders', 'purchase:orders', 1, 1, 1, 0, 0),
  ('purchase:receipts', 'purchase:receipts', 1, 1, 1, 0, 0),
  ('purchase:returns', 'purchase:returns', 1, 1, 1, 0, 0),
  ('purchase:payments', 'purchase:payments', 1, 1, 1, 0, 0),
  ('purchase:refunds', 'purchase:refunds', 0, 0, 0, 0, 0),

  ('inventory:stocks', 'inventory:stocks', 0, 0, 0, 0, 0),
  ('inventory:general-inputs', 'inventory:general-inputs', 1, 0, 0, 0, 0),
  ('inventory:general-outputs', 'inventory:general-outputs', 1, 0, 0, 0, 0),
  ('inventory:transfers', 'inventory:transfers', 1, 1, 1, 0, 0),
  ('inventory:adjustments', 'inventory:adjustments', 1, 1, 1, 0, 0),
  ('inventory:losses', 'inventory:losses', 1, 1, 1, 0, 0),
  ('inventory:loss-outputs', 'inventory:loss-outputs', 1, 1, 1, 0, 0),
  ('inventory:overflows', 'inventory:overflows', 1, 1, 1, 0, 0),
  ('inventory:checks', 'inventory:checks', 1, 1, 1, 0, 0),
  ('inventory:quantity-alerts', 'inventory:quantity-alerts', 0, 1, 0, 0, 0),
  ('inventory:expiry-alerts', 'inventory:expiry-alerts', 0, 0, 0, 0, 0),

  ('production:plans', 'production:plans', 1, 1, 1, 0, 1),
  ('production:outputs', 'production:outputs', 1, 1, 1, 0, 0),
  ('production:inputs', 'production:inputs', 1, 0, 1, 0, 0),
  ('production:boms', 'production:boms', 1, 1, 1, 1, 0),

  ('sales:orders', 'sales:orders', 1, 1, 1, 0, 0),
  ('sales:outputs', 'sales:outputs', 1, 1, 1, 0, 0),
  ('sales:returns', 'sales:returns', 1, 1, 1, 0, 0),
  ('sales:payments', 'sales:payments', 1, 0, 1, 0, 0),
  ('sales:refunds', 'sales:refunds', 1, 0, 1, 0, 0),
  ('sales:discount-orders', 'sales:discount-orders', 1, 1, 1, 0, 0),
  ('sales:services', 'sales:services', 1, 1, 1, 0, 0),

  ('requisitions:applications', 'requisitions:applications', 1, 1, 1, 0, 0),
  ('requisitions:outputs', 'requisitions:outputs', 1, 1, 1, 0, 0),
  ('requisitions:returns', 'requisitions:returns', 1, 1, 1, 0, 0),

  ('reports:1:view', 'reports:1', 0, 0, 0, 0, 1),
  ('reports:2:view', 'reports:2', 0, 0, 0, 0, 1),
  ('reports:3:view', 'reports:3', 0, 0, 0, 0, 1),
  ('reports:4:view', 'reports:4', 0, 0, 0, 0, 1),
  ('reports:5:view', 'reports:5', 0, 0, 0, 0, 1),
  ('reports:6:view', 'reports:6', 0, 0, 0, 0, 1),
  ('reports:7:view', 'reports:7', 0, 0, 0, 0, 1),
  ('reports:8:view', 'reports:8', 0, 0, 0, 0, 1),
  ('reports:9:view', 'reports:9', 0, 0, 0, 0, 1),
  ('reports:10:view', 'reports:10', 0, 0, 0, 0, 1),
  ('reports:11:view', 'reports:11', 0, 0, 0, 0, 1),
  ('reports:12:view', 'reports:12', 0, 0, 0, 0, 1),
  ('reports:13:view', 'reports:13', 0, 0, 0, 0, 1),
  ('reports:14:view', 'reports:14', 0, 0, 0, 0, 1),
  ('reports:15:view', 'reports:15', 0, 0, 0, 0, 1),
  ('reports:16:view', 'reports:16', 0, 0, 0, 0, 1),
  ('reports:17:view', 'reports:17', 0, 0, 0, 0, 1),
  ('reports:18:view', 'reports:18', 0, 0, 0, 0, 1),
  ('reports:19:view', 'reports:19', 0, 0, 0, 0, 1),
  ('reports:20:view', 'reports:20', 0, 0, 0, 0, 1),
  ('reports:21:view', 'reports:21', 0, 0, 0, 0, 1),

  ('system:1:view', 'system:roles', 1, 1, 0, 0, 0),
  ('system:2:view', 'system:users', 1, 1, 0, 0, 0),
  ('system:3:view', 'system:config', 1, 1, 1, 0, 0),
  ('system:4:view', 'system:tasks', 1, 1, 1, 0, 0);

DROP TEMPORARY TABLE IF EXISTS tmp_permission_blueprint;
CREATE TEMPORARY TABLE tmp_permission_blueprint (
  page_code varchar(100) NOT NULL,
  permission_code varchar(100) NOT NULL,
  action_key varchar(40) NOT NULL,
  action_name varchar(50) NOT NULL,
  sort int unsigned NOT NULL,
  PRIMARY KEY (permission_code)
);

INSERT INTO tmp_permission_blueprint
SELECT page_code, concat(permission_prefix, ':create'), 'create', '新增', 20
FROM tmp_permission_pages WHERE can_create = 1;

INSERT INTO tmp_permission_blueprint
SELECT page_code, concat(permission_prefix, ':update'), 'update', '编辑', 30
FROM tmp_permission_pages WHERE can_update = 1;

INSERT INTO tmp_permission_blueprint
SELECT page_code, concat(permission_prefix, ':delete'), 'delete', '删除', 40
FROM tmp_permission_pages WHERE can_delete = 1;

INSERT INTO tmp_permission_blueprint
SELECT page_code, concat(permission_prefix, ':status'), 'status', '启用/停用', 50
FROM tmp_permission_pages WHERE can_status = 1;

INSERT INTO tmp_permission_blueprint
SELECT page_code, concat(permission_prefix, ':export'), 'export', '导出', 60
FROM tmp_permission_pages WHERE can_export = 1;

-- 各业务菜单实际存在的专用操作。
INSERT INTO tmp_permission_blueprint
  (page_code, permission_code, action_key, action_name, sort)
VALUES
  ('dashboard:3:view', 'dashboard:messages:read', 'read', '标记已读', 70),

  ('purchase:applications', 'purchase:applications:submit', 'submit', '提交审批', 70),
  ('purchase:applications', 'purchase:applications:approve', 'approve', '审核', 80),
  ('purchase:applications', 'purchase:applications:generate-order', 'generate-order', '生成采购订单', 90),
  ('purchase:orders', 'purchase:orders:start', 'start', '开始采购', 70),
  ('purchase:orders', 'purchase:orders:generate-receipt', 'generate-receipt', '生成入库单', 80),
  ('purchase:orders', 'purchase:orders:cancel-pending', 'cancel-pending', '退回未到货数量', 90),
  ('purchase:receipts', 'purchase:receipts:confirm', 'confirm', '确认入库', 70),
  ('purchase:receipts', 'purchase:receipts:cancel', 'cancel', '取消入库', 80),
  ('purchase:receipts', 'purchase:receipts:return', 'return', '执行退货', 90),
  ('purchase:returns', 'purchase:returns:submit', 'submit', '提交审批', 70),
  ('purchase:returns', 'purchase:returns:approve', 'approve', '审核', 80),
  ('purchase:refunds', 'purchase:refunds:record', 'record', '登记退款', 70),
  ('purchase:refunds', 'purchase:refunds:void-record', 'void-record', '作废退款记录', 80),
  ('purchase:refunds', 'purchase:refunds:close', 'close', '关闭退款任务', 90),

  ('inventory:transfers', 'inventory:transfers:submit', 'submit', '提交审批', 70),
  ('inventory:transfers', 'inventory:transfers:approve', 'approve', '审核', 80),
  ('inventory:adjustments', 'inventory:adjustments:submit', 'submit', '提交审批', 70),
  ('inventory:adjustments', 'inventory:adjustments:approve', 'approve', '审核', 80),
  ('inventory:losses', 'inventory:losses:submit', 'submit', '提交审批', 70),
  ('inventory:losses', 'inventory:losses:approve', 'approve', '审核', 80),
  ('inventory:loss-outputs', 'inventory:loss-outputs:approve', 'approve', '审核', 70),
  ('inventory:loss-outputs', 'inventory:loss-outputs:confirm', 'confirm', '确认出库', 80),
  ('inventory:overflows', 'inventory:overflows:submit', 'submit', '提交审批', 70),
  ('inventory:overflows', 'inventory:overflows:approve', 'approve', '审核', 80),
  ('inventory:overflows', 'inventory:overflows:confirm', 'confirm', '确认入库', 90),
  ('inventory:checks', 'inventory:checks:approve', 'approve', '审核盘点', 70),
  ('inventory:general-inputs', 'inventory:general-inputs:configure-initial', 'configure-initial', '配置初期入库', 70),

  ('production:plans', 'production:plans:approve', 'approve', '审核', 70),
  ('production:plans', 'production:plans:recheck', 'recheck', '重新检查缺料', 80),
  ('production:plans', 'production:plans:restart', 'restart', '重新启动', 90),
  ('production:plans', 'production:plans:terminate', 'terminate', '终止计划', 100),
  ('production:outputs', 'production:outputs:confirm', 'confirm', '确认出库', 70),
  ('production:outputs', 'production:outputs:create-material-return', 'create-material-return', '创建退料单', 80),
  ('production:outputs', 'production:outputs:confirm-material-return', 'confirm-material-return', '确认退料', 90),
  ('production:outputs', 'production:outputs:void-material-return', 'void-material-return', '作废退料', 100),
  ('production:outputs', 'production:outputs:reverse-material-return', 'reverse-material-return', '冲销退料', 110),

  ('sales:orders', 'sales:orders:approve', 'approve', '审核', 70),
  ('sales:orders', 'sales:orders:analyze', 'analyze', '订单分析', 80),
  ('sales:outputs', 'sales:outputs:confirm', 'confirm', '确认出库', 70),
  ('sales:outputs', 'sales:outputs:undo-confirm', 'undo-confirm', '撤销出库', 80),
  ('sales:returns', 'sales:returns:confirm', 'confirm', '确认退货入库', 70),
  ('sales:returns', 'sales:returns:undo-confirm', 'undo-confirm', '撤销退货入库', 80),
  ('sales:discount-orders', 'sales:discount-orders:approve', 'approve', '审核', 70),
  ('sales:services', 'sales:services:process', 'process', '完成售后处理', 70),
  ('sales:services', 'sales:services:progress-create', 'progress-create', '新增处理进展', 80),
  ('sales:services', 'sales:services:progress-update', 'progress-update', '编辑处理进展', 90),
  ('sales:services', 'sales:services:progress-delete', 'progress-delete', '删除处理进展', 100),

  ('requisitions:applications', 'requisitions:applications:submit', 'submit', '提交OA审批', 70),
  ('requisitions:applications', 'requisitions:applications:approve', 'approve', '审核', 80),
  ('requisitions:outputs', 'requisitions:outputs:confirm', 'confirm', '确认领用出库', 70),
  ('requisitions:outputs', 'requisitions:outputs:undo-confirm', 'undo-confirm', '撤销领用出库', 80),
  ('requisitions:returns', 'requisitions:returns:confirm', 'confirm', '确认领用退回', 70),
  ('requisitions:returns', 'requisitions:returns:undo-confirm', 'undo-confirm', '撤销领用退回', 80),

  ('system:2:view', 'system:users:authorize-role', 'authorize-role', '角色授权', 70),
  ('system:2:view', 'system:users:configure-amount', 'configure-amount', '配置金额权限', 80),
  ('system:4:view', 'system:tasks:run', 'run', '立即执行', 70);

-- 新增尚不存在的菜单级操作权限。
INSERT INTO hspsi_sys_menu (
  parent_id, path, name, code, icon, route, component, redirect,
  type, status, sort, remark, created_by, updated_by, created_at, updated_at, deleted_at
)
SELECT
  page.id,
  concat(page.path, ',', page.id),
  concat(page.name, '-', blueprint.action_name),
  blueprint.permission_code,
  NULL,
  NULL,
  NULL,
  NULL,
  3,
  1,
  blueprint.sort,
  '菜单级操作权限；页面菜单本身代表查看权限',
  0,
  0,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  NULL
FROM tmp_permission_blueprint blueprint
JOIN hspsi_sys_menu page
  ON page.code = blueprint.page_code
  AND page.deleted_at IS NULL
  AND page.type = 2
WHERE NOT EXISTS (
  SELECT 1
  FROM hspsi_sys_menu existing
  WHERE existing.code = blueprint.permission_code
    AND existing.deleted_at IS NULL
);

-- 重复执行时校正权限名称、父级和状态，但不改变主键，不破坏角色关系。
UPDATE hspsi_sys_menu permission
JOIN tmp_permission_blueprint blueprint
  ON blueprint.permission_code = permission.code
JOIN hspsi_sys_menu page
  ON page.code = blueprint.page_code
  AND page.deleted_at IS NULL
  AND page.type = 2
SET permission.parent_id = page.id,
    permission.path = concat(page.path, ',', page.id),
    permission.name = concat(page.name, '-', blueprint.action_name),
    permission.type = 3,
    permission.status = 1,
    permission.sort = blueprint.sort,
    permission.remark = '菜单级操作权限；页面菜单本身代表查看权限',
    permission.updated_by = 0,
    permission.updated_at = CURRENT_TIMESTAMP,
    permission.deleted_at = NULL
WHERE permission.deleted_at IS NULL;

-- 超级管理员始终拥有全部新增操作权限。
INSERT IGNORE INTO hspsi_sys_role_menu (role_id, menu_id)
SELECT role.id, permission.id
FROM hspsi_sys_role role
JOIN hspsi_sys_menu permission
  ON permission.type = 3
  AND permission.status = 1
  AND permission.deleted_at IS NULL
JOIN tmp_permission_blueprint blueprint
  ON blueprint.permission_code = permission.code
WHERE role.code = 'admin'
  AND role.status = 1
  AND role.deleted_at IS NULL;

-- 所有OA员工的基础申请人角色继续允许创建、修改、删除草稿并提交本人采购/领用申请。
-- 不自动授予审核、生成采购订单或其他跨组织操作。
INSERT IGNORE INTO hspsi_sys_role_menu (role_id, menu_id)
SELECT role.id, permission.id
FROM hspsi_sys_role role
JOIN hspsi_sys_menu permission
  ON permission.code IN (
    'purchase:applications:create',
    'purchase:applications:update',
    'purchase:applications:delete',
    'purchase:applications:submit',
    'requisitions:applications:create',
    'requisitions:applications:update',
    'requisitions:applications:delete',
    'requisitions:applications:submit'
  )
  AND permission.type = 3
  AND permission.status = 1
  AND permission.deleted_at IS NULL
WHERE role.code = 'oa-staff-applicant'
  AND role.status = 1
  AND role.deleted_at IS NULL;

-- 将旧系统管理全局操作权限安全映射到角色已拥有的具体系统页面。
INSERT IGNORE INTO hspsi_sys_role_menu (role_id, menu_id)
SELECT legacy_role.role_id, permission.id
FROM hspsi_sys_role_menu legacy_role
JOIN hspsi_sys_menu legacy_permission
  ON legacy_permission.id = legacy_role.menu_id
  AND legacy_permission.deleted_at IS NULL
JOIN hspsi_sys_role_menu selected_page
  ON selected_page.role_id = legacy_role.role_id
JOIN hspsi_sys_menu page
  ON page.id = selected_page.menu_id
  AND page.deleted_at IS NULL
  AND page.type = 2
  AND page.code IN ('system:1:view', 'system:2:view', 'system:3:view', 'system:4:view')
JOIN tmp_permission_blueprint blueprint
  ON blueprint.page_code = page.code
  AND (
    (legacy_permission.code = 'system:create' AND blueprint.action_key = 'create')
    OR (legacy_permission.code = 'system:update' AND blueprint.action_key IN (
      'update', 'authorize-role', 'configure-amount', 'run'
    ))
    OR (legacy_permission.code = 'system:delete' AND blueprint.action_key = 'delete')
  )
JOIN hspsi_sys_menu permission
  ON permission.code = blueprint.permission_code
  AND permission.type = 3
  AND permission.status = 1
  AND permission.deleted_at IS NULL;

-- 旧四条全局操作权限暂时保留，保证前端和后端正式切换前现有系统管理不被中断。
-- 全面启用菜单级接口鉴权后再通过单独Patch停用，不能在数据库阶段提前破坏现有功能。
UPDATE hspsi_sys_menu
SET remark = '旧版系统管理全局操作权限；菜单级权限逻辑启用前兼容保留',
    updated_by = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE code IN ('system:view', 'system:create', 'system:update', 'system:delete')
  AND type = 3
  AND deleted_at IS NULL;

-- OA 只自动授予员工的固定主组织；跨组织范围必须由超级管理员在进销存手工授权。
UPDATE hspsi_sys_dictionary_category
SET remark = 'OA同步只将员工主组织写入固定组织范围；额外组织由超级管理员在进销存手工授权',
    updated_by = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE dict_catg_code = 'oa_org_authorization_rule'
  AND deleted_at IS NULL;

UPDATE hspsi_sys_dictionary dictionary_item
JOIN hspsi_sys_dictionary_category category
  ON category.dict_catg_id = dictionary_item.dict_catg_id
SET dictionary_item.remark = 'OA主组织自动成为用户默认数据范围；不能取消',
    dictionary_item.updated_by = 0,
    dictionary_item.updated_at = CURRENT_TIMESTAMP,
    dictionary_item.deleted_at = NULL
WHERE category.dict_catg_code = 'oa_org_authorization_rule'
  AND category.deleted_at IS NULL
  AND dictionary_item.dict_value = 'PRIMARY_ORG';

UPDATE hspsi_sys_dictionary dictionary_item
JOIN hspsi_sys_dictionary_category category
  ON category.dict_catg_id = dictionary_item.dict_catg_id
SET dictionary_item.remark = '已停用：跨组织访问范围改由超级管理员在进销存手工授权',
    dictionary_item.updated_by = 0,
    dictionary_item.updated_at = CURRENT_TIMESTAMP,
    dictionary_item.deleted_at = COALESCE(dictionary_item.deleted_at, CURRENT_TIMESTAMP)
WHERE category.dict_catg_code = 'oa_org_authorization_rule'
  AND category.deleted_at IS NULL
  AND dictionary_item.dict_value IN ('SECONDARY_ORG', 'POSITION_ORG');

-- 一个用户只能拥有一个本地角色；OA岗位只提供默认角色映射，超级管理员可在本地人工覆盖。
UPDATE hspsi_sys_dictionary_category
SET remark = 'dict_name=OA岗位outer_ref_id，dict_value=本地角色code；一个岗位仅映射一个默认角色，用户始终只能拥有一个本地角色',
    updated_by = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE dict_catg_code = 'oa_position_role_mapping'
  AND deleted_at IS NULL;

-- 清理历史OA自动生成的非主组织范围；人工授权(created_by<>0)不处理。
DELETE authorized_org
FROM hspsi_sys_user_authorized_org authorized_org
JOIN hspsi_sys_user user_row
  ON user_row.id = authorized_org.user_id
WHERE authorized_org.created_by = 0
  AND authorized_org.org_id <> user_row.org_id
  AND EXISTS (
    SELECT 1
    FROM hspsi_sys_user_oa_staff identity_link
    WHERE identity_link.user_id = user_row.id
  );

-- 确保每个有效OA账号至少拥有自己的固定所属组织。
INSERT IGNORE INTO hspsi_sys_user_authorized_org (user_id, org_id, created_by, created_at)
SELECT DISTINCT user_row.id, user_row.org_id, 0, CURRENT_TIMESTAMP
FROM hspsi_sys_user user_row
JOIN hspsi_sys_user_oa_staff identity_link
  ON identity_link.user_id = user_row.id
JOIN hspsi_basic_organization organization
  ON organization.org_id = user_row.org_id
  AND organization.operation_status = 1
  AND organization.deleted_at IS NULL
WHERE user_row.status = 1
  AND user_row.deleted_at IS NULL
  AND user_row.org_id IS NOT NULL;

DROP TEMPORARY TABLE IF EXISTS tmp_permission_blueprint;
DROP TEMPORARY TABLE IF EXISTS tmp_permission_pages;

COMMIT;
