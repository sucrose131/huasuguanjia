import { SetMetadata } from '@nestjs/common';

export const REQUIRE_AMOUNT_EDIT_KEY = 'require_amount_edit';
export const RequireAmountEdit = () => SetMetadata(REQUIRE_AMOUNT_EDIT_KEY, true);

/**
 * 标记控制器/处理器为"金额主数据、无经办归属语义"（如商品档案），
 * 该端点的响应不参与 amount_scope=own 的按记录脱敏（仍受无查看权全局置空约束）。
 */
export const AMOUNT_SCOPE_EXEMPT_KEY = 'amount_scope_exempt';
export const AmountScopeExempt = () => SetMetadata(AMOUNT_SCOPE_EXEMPT_KEY, true);
