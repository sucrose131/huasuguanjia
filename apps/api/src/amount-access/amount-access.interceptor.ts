import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { Reflector } from '@nestjs/core';
import type { AuthUser } from '../auth/auth.types';
import { GLOBAL_AMOUNT_FIELDS } from './amount-field-registry';
import { AmountAccessService } from './amount-access.service';
import { REQUIRE_AMOUNT_EDIT_KEY } from './amount-access.decorator';

type AuthenticatedRequest = {
  user?: AuthUser;
};

@Injectable()
export class AmountAccessInterceptor implements NestInterceptor {
  constructor(
    @Inject(AmountAccessService) private readonly amountAccess: AmountAccessService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = request.user?.id;
    if (!userId) return next.handle();

    const access = await this.amountAccess.forUser(userId);
    const requiresEdit = this.reflector.getAllAndOverride<boolean>(REQUIRE_AMOUNT_EDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (requiresEdit)
      await this.amountAccess.assertCanEdit(userId);

    if (access.canViewAmount) return next.handle();
    return next.handle().pipe(
      map((value) => this.amountAccess.maskFields(value, GLOBAL_AMOUNT_FIELDS)),
    );
  }
}
