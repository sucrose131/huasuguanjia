import { describe, expect, it, vi } from 'vitest';
import {
  createDetailHandoff,
  createReferenceGetCache,
  isReferenceDataUrl,
} from './reference-get-cache';

describe('reference get cache', () => {
  it('只缓存字典和基础资料选项，不缓存业务列表与详情', () => {
    expect(isReferenceDataUrl('/dictionaries/purchase_status')).toBe(true);
    expect(isReferenceDataUrl('/base-data/organizations/options')).toBe(true);
    expect(isReferenceDataUrl('/purchase/receiver-options')).toBe(true);
    expect(isReferenceDataUrl('/purchase/orders')).toBe(false);
    expect(isReferenceDataUrl('/purchase/orders/1')).toBe(false);
    expect(isReferenceDataUrl('/inventory/stocks')).toBe(false);
  });

  it('合并同一身份和参数的请求，参数变化、身份变化或清空后重新请求', async () => {
    const rawGet = vi.fn(async (url: string) => [url]);
    let scope = 'user-a';
    const cache = createReferenceGetCache(rawGet, () => scope);

    await Promise.all([
      cache.get('/base-data/organizations/options', { params: { status: 1, page: 1 } }),
      cache.get('/base-data/organizations/options', { params: { page: 1, status: 1 } }),
    ]);
    expect(rawGet).toHaveBeenCalledTimes(1);

    await cache.get('/base-data/organizations/options', { params: { page: 2, status: 1 } });
    expect(rawGet).toHaveBeenCalledTimes(2);

    scope = 'user-b';
    await cache.get('/base-data/organizations/options', { params: { page: 1, status: 1 } });
    expect(rawGet).toHaveBeenCalledTimes(3);

    cache.clear();
    await cache.get('/base-data/organizations/options', { params: { page: 1, status: 1 } });
    expect(rawGet).toHaveBeenCalledTimes(4);
  });

  it('失败请求不留在缓存中', async () => {
    const rawGet = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue([]);
    const cache = createReferenceGetCache(rawGet, () => 'user-a');

    await expect(cache.get('/dictionaries/status')).rejects.toThrow('network');
    await expect(cache.get('/dictionaries/status')).resolves.toEqual([]);
    expect(rawGet).toHaveBeenCalledTimes(2);
  });

  it('完整详情只交给同一身份下的下一次读取消费', () => {
    let timestamp = 1_000;
    let scope = 'user-a';
    const handoff = createDetailHandoff(() => scope, () => timestamp);
    const detail = { id: '1', details: [{ id: '2' }] };
    handoff.prime('/sales/orders/1', detail);

    expect(handoff.take('/sales/orders/2').found).toBe(false);
    scope = 'user-b';
    expect(handoff.take('/sales/orders/1').found).toBe(false);
    scope = 'user-a';
    expect(handoff.take('/sales/orders/1')).toEqual({ found: true, detail });
    expect(handoff.take('/sales/orders/1').found).toBe(false);

    handoff.prime('/sales/orders/1', detail);
    timestamp += 15_001;
    expect(handoff.take('/sales/orders/1').found).toBe(false);
  });
});
