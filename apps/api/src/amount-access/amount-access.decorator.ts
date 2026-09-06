import { SetMetadata } from '@nestjs/common';

export const REQUIRE_AMOUNT_EDIT_KEY = 'require_amount_edit';
export const RequireAmountEdit = () => SetMetadata(REQUIRE_AMOUNT_EDIT_KEY, true);

/**
 * 标记控制器/处理器为"金额主数据、无经办归属语义"（如商品档案），
 * 该端点的响应不参与 amount_scope=own 的按记录脱敏（仍受无查看权全局置空约束）。
 */
export const AMOUNT_SCOPE_EXEMPT_KEY = 'amount_scope_exempt';
export const AmountScopeExempt = () => SetMetadata(AMOUNT_SCOPE_EXEMPT_KEY, true);

/**
 * 标记处理器响应中的金额为"库存成本快照"（如盘点单明细的成本单价、盘点衍生的
 * 报亏/报盈入库成本价）：不随单据 created_by 归属放行，仅"可查看 + 权限内全部"
 * （amount_scope=all）用户可见，own 范围一律脱敏。用于封堵通过单据详情反推库存价值的旁路。
 */
export const AMOUNT_ALL_SCOPE_ONLY_KEY = 'amount_all_scope_only';
export const AmountAllScopeOnly = () => SetMetadata(AMOUNT_ALL_SCOPE_ONLY_KEY, true);
