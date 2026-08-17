import { SetMetadata } from '@nestjs/common';

export const REQUIRE_AMOUNT_EDIT_KEY = 'require_amount_edit';
export const RequireAmountEdit = () => SetMetadata(REQUIRE_AMOUNT_EDIT_KEY, true);
