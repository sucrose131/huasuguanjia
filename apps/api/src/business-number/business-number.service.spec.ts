import { ServiceUnavailableException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUSINESS_PREFIX } from './business-number.constants';
import { BusinessNumberService } from './business-number.service';

function createService(environment = 'production') {
  const evalCommand = vi.fn().mockResolvedValue(1);
  const redis = {
    ensureConnected: vi.fn().mockResolvedValue(undefined),
    client: { eval: evalCommand },
  };
  const config = { get: vi.fn().mockReturnValue(environment) };
  const service = new BusinessNumberService(redis as never, config as never);
  return { service, redis, evalCommand };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('BusinessNumberService', () => {
  it('uses the Shanghai business date and a six-digit shared sequence', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-03T16:00:01.000Z'));
    const { service, evalCommand } = createService();
    evalCommand.mockResolvedValueOnce(42);

    await expect(service.generate(BUSINESS_PREFIX.PURCHASE_ORDER)).resolves.toBe(
      'PO20260804000042',
    );
    expect(evalCommand).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('INCR', KEYS[1])"),
      1,
      'hspsi:production:business-no:20260804',
      expect.any(String),
    );
  });

  it('shares the same daily Redis key across business prefixes', async () => {
    const { service, evalCommand } = createService();
    evalCommand.mockResolvedValueOnce(7).mockResolvedValueOnce(8);

    const purchaseNo = await service.generate(BUSINESS_PREFIX.PURCHASE_APPLICATION);
    const salesNo = await service.generate(BUSINESS_PREFIX.SALES_ORDER);

    expect(purchaseNo.slice(-6)).toBe('000007');
    expect(salesNo.slice(-6)).toBe('000008');
    expect(evalCommand.mock.calls[0]![2]).toBe(evalCommand.mock.calls[1]![2]);
  });

  it('keeps concurrent allocations unique', async () => {
    const { service, evalCommand } = createService();
    let sequence = 0;
    evalCommand.mockImplementation(async () => {
      sequence += 1;
      return sequence;
    });

    const numbers = await Promise.all(
      Array.from({ length: 50 }, () => service.generate(BUSINESS_PREFIX.SALES_ORDER)),
    );

    expect(new Set(numbers)).toHaveLength(50);
    expect(numbers.every((number) => /^SO\d{8}\d{6}$/.test(number))).toBe(true);
  });

  it('retries three times and fails closed when Redis is unavailable', async () => {
    const { service, redis } = createService();
    redis.ensureConnected.mockRejectedValue(new Error('redis unavailable'));
    (service as unknown as { delay: () => Promise<void> }).delay = vi
      .fn()
      .mockResolvedValue(undefined);

    await expect(service.generate(BUSINESS_PREFIX.PURCHASE_ORDER)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(redis.ensureConnected).toHaveBeenCalledTimes(3);
  });

  it('rejects the one-millionth daily number', async () => {
    const { service, evalCommand } = createService();
    evalCommand.mockResolvedValueOnce(1_000_000);

    await expect(service.generate(BUSINESS_PREFIX.PURCHASE_ORDER)).rejects.toThrow(
      '当日业务单号数量已超过 999999 条',
    );
  });
});
