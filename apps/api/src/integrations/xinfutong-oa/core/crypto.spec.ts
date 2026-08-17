import { sm2 } from 'sm-crypto';
import { describe, expect, it } from 'vitest';
import { sm2Sign, sm2Verify, sm4Decrypt, sm4Encrypt } from './crypto';

describe('xinfutong OA crypto', () => {
  it('verifies an SM2 signature produced by sm2Sign', () => {
    const pair = sm2.generateKeyPairHex();
    const msg = '{"eventCd":9999,"eventId":"XFTOAFPS","eventTime":"2021-08-27T12:00:00","prjCod":"XFT00001"}';
    const signature = sm2Sign(msg, pair.privateKey);
    expect(sm2Verify(msg, signature, pair.publicKey)).toBe(true);
    expect(sm2Verify(msg + 'x', signature, pair.publicKey)).toBe(false);
  });

  it('decrypts eventRcdInf with the first 32 hex of the public key', () => {
    const pair = sm2.generateKeyPairHex();
    const plain = '{"procStatus":"PASSED"}';
    const cipher = sm4Encrypt(plain, pair.publicKey);
    expect(sm4Decrypt(cipher, pair.publicKey)).toBe(plain);
  });
});
