import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { AuthRequest } from '../auth/auth.types';
import { runWithDataScope } from './data-scope.context';

@Injectable()
export class DataScopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    if (!request.user) return next.handle();
    return new Observable((subscriber) =>
      runWithDataScope(request.user, () => next.handle().subscribe(subscriber)),
    );
  }
}
