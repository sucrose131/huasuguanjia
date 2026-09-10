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
  const emptyModel = { findFirst: vi.fn().mockResolvedValue(null) };
  const prisma = {
    hspsi_purchase_approve: emptyModel,
    hspsi_purchase_order: emptyModel,
    hspsi_purchase_order_input: emptyModel,
    hspsi_purchase_order_input_exit: emptyModel,
    hspsi_purchase_order_payment: emptyModel,
    hspsi_purchase_refund: emptyModel,
    hspsi_purchase_refund_flow: emptyModel,
  };
  const service = new BusinessNumberService(redis as never, prisma as never, config as never);
  return { service, redis, prisma, evalCommand };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('BusinessNumberService', () => {
  it('uses the Shanghai business date and a four-digit purchase sequence', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-03T16:00:01.000Z'));
    const { service, evalCommand } = createService();
    evalCommand.mockResolvedValueOnce(42);

    await expect(service.generate(BUSINESS_PREFIX.PURCHASE_ORDER)).resolves.toBe('PO202608040042');
    expect(evalCommand).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('INCR', KEYS[1])"),
      1,
      'hspsi:production:business-no:PO:20260804',
      expect.any(String),
      '0',
      '0',
    );
  });

  it('uses an independent daily Redis key for each purchase document type', async () => {
    const { service, evalCommand } = createService();
    evalCommand.mockResolvedValueOnce(7).mockResolvedValueOnce(7);

    const purchaseNo = await service.generate(BUSINESS_PREFIX.PURCHASE_APPLICATION);
    const orderNo = await service.generate(BUSINESS_PREFIX.PURCHASE_ORDER);

    expect(purchaseNo).toMatch(/^PA\d{8}0007$/);
    expect(orderNo).toMatch(/^PO\d{8}0007$/);
    expect(evalCommand.mock.calls[0]![2]).not.toBe(evalCommand.mock.calls[1]![2]);
  });

  it('keeps concurrent purchase allocations unique', async () => {
    const { service, evalCommand } = createService();
    let sequence = 0;
    evalCommand.mockImplementation(async () => {
      sequence += 1;
      return sequence;
    });

    const numbers = await Promise.all(
      Array.from({ length: 50 }, () => service.generate(BUSINESS_PREFIX.PURCHASE_ORDER)),
    );

    expect(new Set(numbers)).toHaveLength(50);
    expect(numbers.every((number) => /^PO\d{8}\d{4}$/.test(number))).toBe(true);
  });

  it('keeps the existing six-digit shared sequence for non-purchase modules', async () => {
    const { service, evalCommand } = createService();
    evalCommand.mockResolvedValueOnce(8);

    await expect(service.generate(BUSINESS_PREFIX.SALES_ORDER)).resolves.toMatch(/^SO\d{8}000008$/);
    expect(evalCommand.mock.calls[0]![2]).toMatch(/business-no:\d{8}$/);
  });

  it('starts after an existing purchase sequence when the Redis key is new', async () => {
    const { service, prisma, evalCommand } = createService();
    prisma.hspsi_purchase_order.findFirst.mockResolvedValueOnce({
      po_no: 'PO202608090027',
    });
    evalCommand.mockResolvedValueOnce(28);

    await expect(service.generate(BUSINESS_PREFIX.PURCHASE_ORDER)).resolves.toMatch(
      /^PO\d{8}0028$/,
    );
    expect(evalCommand.mock.calls[0]!.at(-1)).toBe('27');
  });

  it('passes the in-database maximum as the Redis floor so imports cannot collide', async () => {
    const { service, prisma, evalCommand } = createService();
    prisma.hspsi_purchase_order.findFirst.mockResolvedValueOnce({
      po_no: 'PO202609030042',
    });
    evalCommand.mockResolvedValueOnce(43);

    await expect(service.generate(BUSINESS_PREFIX.PURCHASE_ORDER)).resolves.toMatch(
      /^PO\d{8}0043$/,
    );
    // ARGV[2]=initialSequence 与 ARGV[3]=dbMax 均为库内最大号 42；脚本会在 Redis 计数落后时先抬升
    expect(evalCommand.mock.calls[0]![4]).toBe('42');
    expect(evalCommand.mock.calls[0]![5]).toBe('42');
    expect(String(evalCommand.mock.calls[0]![0])).toContain('dbMax');
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

  it('rejects the ten-thousandth daily purchase number', async () => {
    const { service, evalCommand } = createService();
    evalCommand.mockResolvedValueOnce(10_000);

    await expect(service.generate(BUSINESS_PREFIX.PURCHASE_ORDER)).rejects.toThrow(
      '当日该采购类型单号数量已超过 9999 条',
    );
  });
});
