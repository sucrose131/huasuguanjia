import { sm2 } from 'sm-crypto';
import { describe, expect, it } from 'vitest';
import { sm2Sign, sm4Encrypt } from '../core/crypto';
import { XinfutongOaApprovalCallbackService } from './approval-callback.service';
import {
  buildEventCallbackSignText,
  oaEventAck,
  readEventId,
} from './event-envelope';

describe('event envelope helpers', () => {
  it('reads connectivity test event id', () => {
    expect(readEventId({ eventId: 'XFT00000' })).toBe('XFT00000');
    expect(readEventId({ procStatus: 'PASSED' })).toBe('');
  });

  it('builds FastJSON TreeMap sign text in alphabetical key order', () => {
    expect(
      buildEventCallbackSignText({
        eventId: 'XFTOAFPS',
        eventTime: '2021-08-27T12:00:00',
        eventCd: '9999',
        prjCod: 'XFT00001',
      }),
    ).toBe(
      '{"eventCd":9999,"eventId":"XFTOAFPS","eventTime":"2021-08-27T12:00:00","prjCod":"XFT00001"}',
    );
  });

  it('keeps eventCd Long digits from the raw JSON body', () => {
    const raw =
      '{"eventId":"XFTOAFPS","eventTime":"2021-08-27T12:00:00","eventCd":380026368575668225,"prjCod":"XFT00001"}';
    const parsed = JSON.parse(raw) as { eventCd: number };
    expect(String(parsed.eventCd)).not.toBe('380026368575668225');
    expect(
      buildEventCallbackSignText(
        {
          eventId: 'XFTOAFPS',
          eventTime: '2021-08-27T12:00:00',
          eventCd: String(parsed.eventCd),
          prjCod: 'XFT00001',
        },
        raw,
      ),
    ).toContain('"eventCd":380026368575668225');
  });

  it('omits prjCod when the platform event does not include it', () => {
    expect(
      buildEventCallbackSignText({
        eventId: 'XFT00000',
        eventTime: '2021-08-27T12:00:00',
        eventCd: '1',
      }),
    ).toBe('{"eventCd":1,"eventId":"XFT00000","eventTime":"2021-08-27T12:00:00"}');
  });

  it('returns the documented success ack', () => {
    expect(oaEventAck()).toEqual({ rtnCod: '200', errMsg: '' });
  });
});

describe('XinfutongOaApprovalCallbackService event verify', () => {
  it('verifies SM2 signature and decrypts SM4 eventRcdInf', () => {
    const pair = sm2.generateKeyPairHex();
    const inner = {
      prjCod: 'XFT00001',
      procStatus: 'PASSED',
      busKey: 'CON_1',
      procInstId: '35678907',
      procKey: 'FORM_1',
    };
    const envelope = {
      eventId: 'XFTOAFPS',
      eventRcdInf: sm4Encrypt(JSON.stringify(inner), pair.publicKey),
      prjCod: 'XFT00001',
      eventTime: '2021-08-27T12:00:00',
      eventCd: 9999,
      businessKey: 'CON_1',
      appId: 'APP_1',
      signature: '',
    };
    envelope.signature = sm2Sign(
      buildEventCallbackSignText({
        eventId: envelope.eventId,
        eventTime: envelope.eventTime,
        eventCd: String(envelope.eventCd),
        prjCod: envelope.prjCod,
      }),
      pair.privateKey,
    );
    const rawBody = JSON.stringify(envelope);
    const service = new XinfutongOaApprovalCallbackService(
      {} as never,
      { get: () => pair.publicKey } as never,
    );

    expect(service.verifyAndDecryptEvent(envelope, rawBody)).toEqual(inner);
  });

  it('rejects an invalid signature', () => {
    const pair = sm2.generateKeyPairHex();
    const service = new XinfutongOaApprovalCallbackService(
      {} as never,
      { get: () => pair.publicKey } as never,
    );
    expect(() =>
      service.verifyAndDecryptEvent({
        eventId: 'XFTOAFPS',
        eventRcdInf: 'ab',
        eventTime: '2021-08-27T12:00:00',
        eventCd: 1,
        signature: 'b'.repeat(128),
      }),
    ).toThrow('验签失败');
  });
});
