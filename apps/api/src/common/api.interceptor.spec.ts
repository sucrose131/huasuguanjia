import { of, firstValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { ApiInterceptor } from './api.interceptor';

describe('ApiInterceptor', () => {
  it('keeps OA event ack bodies unwrapped', async () => {
    const interceptor = new ApiInterceptor();
    const ack = { rtnCod: '200', errMsg: '' };
    const result = await firstValueFrom(
      interceptor.intercept({} as never, { handle: () => of(ack) }),
    );
    expect(result).toEqual(ack);
  });

  it('wraps ordinary API results', async () => {
    const interceptor = new ApiInterceptor();
    const result = await firstValueFrom(
      interceptor.intercept({} as never, { handle: () => of({ id: 1 }) }),
    );
    expect(result).toEqual({ code: 'OK', data: { id: 1 } });
  });
});
