import { describe, expect, it, vi } from 'vitest';
import { createRequestId } from './random-id';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('createRequestId', () => {
  it('uses the native randomUUID implementation when available', () => {
    const randomUUID = vi.fn(
      () =>
        '123e4567-e89b-42d3-a456-426614174000' as `${string}-${string}-${string}-${string}-${string}`,
    );
    expect(createRequestId({ randomUUID })).toBe('123e4567-e89b-42d3-a456-426614174000');
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it('creates a v4 UUID with getRandomValues when randomUUID is unavailable', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.fill(1);
      return bytes;
    });
    expect(createRequestId({ getRandomValues } as never)).toMatch(UUID_PATTERN);
  });

  it('still returns a valid request id when Web Crypto is unavailable', () => {
    expect(createRequestId(undefined)).toMatch(UUID_PATTERN);
  });
});
