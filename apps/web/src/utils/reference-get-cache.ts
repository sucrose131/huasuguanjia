type GetRequest = (url: string, config?: Record<string, any>) => Promise<unknown>;

export function isReferenceDataUrl(url: string) {
  return (
    /^\/dictionaries\/[^/]+$/.test(url) ||
    /^\/base-data\/[^/]+\/options$/.test(url) ||
    url === '/purchase/receiver-options'
  );
}

function stableParams(params: unknown): string {
  if (!params || typeof params !== 'object') return '';
  return JSON.stringify(
    Object.entries(params as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}

/** 为只读参考数据合并并缓存相同 GET；clear 在业务写操作前调用。 */
export function createReferenceGetCache(rawGet: GetRequest, getScope: () => string) {
  const cache = new Map<string, Promise<unknown>>();

  return {
    get(url: string, config?: Record<string, any>) {
      if (!isReferenceDataUrl(url)) return rawGet(url, config);
      const key = `${getScope()}|${url}|${stableParams(config?.params)}`;
      const cached = cache.get(key);
      if (cached) return cached;
      const request = rawGet(url, config).catch((error) => {
        cache.delete(key);
        throw error;
      });
      cache.set(key, request);
      return request;
    },
    clear() {
      cache.clear();
    },
  };
}

/** 在已经取得完整详情后，把同一详情交给即将挂载的表单消费一次，避免再次发网络请求。 */
export function createDetailHandoff(getScope: () => string, now: () => number = Date.now) {
  const pending = new Map<string, { detail: unknown; expiresAt: number }>();
  const keyOf = (url: string) => `${getScope()}|${url}`;

  return {
    prime(url: string, detail: unknown) {
      if (pending.size >= 50) pending.delete(pending.keys().next().value!);
      pending.set(keyOf(url), { detail, expiresAt: now() + 15_000 });
    },
    take(url: string) {
      const key = keyOf(url);
      if (!pending.has(key)) return { found: false as const, detail: undefined };
      const entry = pending.get(key)!;
      pending.delete(key);
      if (entry.expiresAt < now()) return { found: false as const, detail: undefined };
      return { found: true as const, detail: entry.detail };
    },
    clear() {
      pending.clear();
    },
  };
}
