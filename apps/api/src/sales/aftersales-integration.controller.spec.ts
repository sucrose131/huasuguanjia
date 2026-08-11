import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AftersalesIntegrationController } from './aftersales-integration.controller';

describe('AftersalesIntegrationController', () => {
  it('accepts the configured webhook token and forwards the payload', async () => {
    const receiveExternalAfterSales = vi.fn().mockResolvedValue({ id: '1' });
    const controller = new AftersalesIntegrationController(
      { receiveExternalAfterSales } as never,
      { get: vi.fn().mockReturnValue('a-secure-webhook-token') } as never,
    );
    const body = { externalRequestId: 'HS-1' };

    await controller.receiveHuashuHome(
      { 'x-hspsi-webhook-token': 'a-secure-webhook-token' },
      body,
    );

    expect(receiveExternalAfterSales).toHaveBeenCalledWith('huashu_home', body);
  });

  it('rejects an invalid token', () => {
    const controller = new AftersalesIntegrationController(
      { receiveExternalAfterSales: vi.fn() } as never,
      { get: vi.fn().mockReturnValue('expected-token') } as never,
    );

    expect(() =>
      controller.receiveHuashuHome(
        { 'x-hspsi-webhook-token': 'wrong-token' },
        { externalRequestId: 'HS-1' },
      ),
    ).toThrow(UnauthorizedException);
  });

  it('fails closed when the webhook token is not configured', () => {
    const controller = new AftersalesIntegrationController(
      { receiveExternalAfterSales: vi.fn() } as never,
      { get: vi.fn().mockReturnValue(undefined) } as never,
    );

    expect(() =>
      controller.receiveHuashuHome({}, { externalRequestId: 'HS-1' }),
    ).toThrow(ServiceUnavailableException);
  });
});
