import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { serialize } from './serialize';

function isExternalEventAck(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const keys = Object.keys(data);
  return (
    keys.length === 2 &&
    keys.includes('rtnCod') &&
    keys.includes('errMsg') &&
    typeof (data as { rtnCod: unknown }).rtnCod === 'string' &&
    typeof (data as { errMsg: unknown }).errMsg === 'string'
  );
}

@Injectable()
export class ApiInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((data) => (isExternalEventAck(data) ? data : { code: 'OK', data: serialize(data) })),
    );
  }
}
