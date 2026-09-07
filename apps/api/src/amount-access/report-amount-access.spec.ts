import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { AmountAccessInterceptor } from './amount-access.interceptor';
import { AmountAccessService } from './amount-access.service';

const payload = {
  items: [
    {
      createdBy: '61',
      orgId: '2',
      quantity: 7,
      amount: 123.45,
      paidAmount: 12,
      payAmountDone: 12,
      details: [{ unitPrice: 9 }],
      inventoryValue: 100,
    },
  ],
  total: 1,
};

async function read(level: string, scope: string | undefined, report: boolean, exempt = false) {
  const service = new AmountAccessService({} as never);
  vi.spyOn(service, 'forUser').mockResolvedValue({
    level,
    amountScope: scope,
    canViewAmount: level !== 'none',
    canEditAmount: level === 'edit',
  } as any);
  const interceptor = new AmountAccessInterceptor(service, {
    getAllAndOverride: (key: string) => key === 'amount_scope_exempt' && exempt,
  } as never);
  return firstValueFrom(
    await interceptor.intercept(
      {
        switchToHttp: () => ({
          getRequest: () => ({
            method: 'GET',
            user: { id: '61' },
            query: report ? { amountContext: 'report' } : {},
          }),
        }),
        getHandler: () => 'handler',
        getClass: () => 'controller',
      } as never,
      { handle: () => of(payload) },
    ),
  );
}

describe('报表读取后端金额规则', () => {
  it.each([
    ['none', 'own'],
    ['none', 'all'],
    ['view', 'own'],
    ['edit', 'own'],
    ['view', undefined],
  ])('%s/%s：本人金额、嵌套单价、库存金额及别名全部置空，非金额不变', async (level, scope) => {
    const result: any = await read(level!, scope, true);
    expect(result).toEqual({
      items: [
        {
          ...payload.items[0],
          amount: null,
          paidAmount: null,
          payAmountDone: null,
          inventoryValue: null,
          details: [{ unitPrice: null }],
        },
      ],
      total: 1,
    });
  });
  it.each(['view', 'edit'])('%s/all：保留金额和原组织范围的返回结果', async (level) => {
    expect(await read(level, 'all', true)).toEqual(payload);
  });
  it('报表规则优先于库存查询 scopeExempt', async () => {
    expect(((await read('edit', 'own', true, true)) as any).items[0].inventoryValue).toBeNull();
  });
  it('不改变正常业务接口自己的单据金额及库存豁免', async () => {
    expect(await read('edit', 'own', false)).toEqual(payload);
    expect(await read('view', 'own', false, true)).toEqual(payload);
  });
});
