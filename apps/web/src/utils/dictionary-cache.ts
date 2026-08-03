import { api } from '@/api';

export type DictionaryOption = { value: string | number; label: string };

const cache = new Map<string, Promise<DictionaryOption[]>>();

export function loadDictionary(code: string) {
  if (!cache.has(code)) {
    const request = (api.get(`/dictionaries/${code}`) as Promise<DictionaryOption[]>).catch(() => {
      cache.delete(code);
      return [];
    });
    cache.set(code, request);
  }
  return cache.get(code)!;
}
