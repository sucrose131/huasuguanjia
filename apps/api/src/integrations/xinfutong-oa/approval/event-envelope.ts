/**
 * 薪福通事件订阅入站报文（事件订阅概述）
 *
 * 连接测试事件 XFT00000 无签名，须立即返回成功报文体。
 * 正式事件对 eventId、prjCod、eventTime、eventCd 做 SM2 加签，
 * eventRcdInf 使用公钥前 32 hex 作为 SM4 密钥加密。
 */

export const EVENT_CODE_CONNECTIVITY_TEST = 'XFT00000';

export const OA_EVENT_ACK_SUCCESS = { rtnCod: '200', errMsg: '' } as const;

export class OaEventVerifyError extends Error {
  readonly rtnCod: string;
  readonly accountSetId?: bigint;

  constructor(message: string, rtnCod = '001', accountSetId?: bigint) {
    super(message);
    this.name = 'OaEventVerifyError';
    this.rtnCod = rtnCod;
    this.accountSetId = accountSetId;
  }
}

export interface OaEventAck {
  rtnCod: string;
  errMsg: string;
}

export interface OaEventEnvelope {
  eventId: string;
  eventRcdInf: string;
  prjCod?: string;
  eventTime: string;
  eventCd: string;
  businessKey?: string;
  appId: string;
  signature: string;
}

export function oaEventAck(rtnCod = '200', errMsg = ''): OaEventAck {
  return { rtnCod, errMsg };
}

export function isOaEventAck(data: unknown): data is OaEventAck {
  if (!data || typeof data !== 'object') return false;
  const keys = Object.keys(data);
  return (
    keys.length === 2 &&
    keys.includes('rtnCod') &&
    keys.includes('errMsg') &&
    typeof (data as OaEventAck).rtnCod === 'string' &&
    typeof (data as OaEventAck).errMsg === 'string'
  );
}

export function readEventId(rawPayload: unknown): string {
  if (!rawPayload || typeof rawPayload !== 'object') return '';
  const eventId = (rawPayload as Record<string, unknown>).eventId;
  return typeof eventId === 'string' ? eventId.trim() : '';
}

export function parseEventEnvelope(rawPayload: unknown): OaEventEnvelope {
  if (!rawPayload || typeof rawPayload !== 'object') {
    throw new OaEventVerifyError('事件报文必须是 JSON 对象');
  }
  const obj = rawPayload as Record<string, unknown>;
  const eventId = typeof obj.eventId === 'string' ? obj.eventId.trim() : '';
  const eventTime = typeof obj.eventTime === 'string' ? obj.eventTime : '';
  const eventRcdInf = typeof obj.eventRcdInf === 'string' ? obj.eventRcdInf : '';
  const signature = typeof obj.signature === 'string' ? obj.signature.trim() : '';
  const eventCd = readEventCd(obj.eventCd);
  if (!eventId) throw new OaEventVerifyError('事件报文缺少 eventId');
  if (!eventTime) throw new OaEventVerifyError('事件报文缺少 eventTime');
  if (!eventCd) throw new OaEventVerifyError('事件报文缺少 eventCd');
  if (!eventRcdInf) throw new OaEventVerifyError('事件报文缺少 eventRcdInf');
  if (!signature) throw new OaEventVerifyError('消息签名为空，请确认参数是否经过加签');
  const appId = typeof obj.appId === 'string' ? obj.appId.trim() : '';
  if (!appId) throw new OaEventVerifyError('事件报文缺少 appId');

  const prjCod = typeof obj.prjCod === 'string' && obj.prjCod ? obj.prjCod : undefined;
  const businessKey =
    typeof obj.businessKey === 'string' && obj.businessKey ? obj.businessKey : undefined;

  return {
    eventId,
    eventRcdInf,
    prjCod,
    eventTime,
    eventCd,
    businessKey,
    appId,
    signature,
  };
}

/**
 * 按薪福通 Java 示例拼接待验签字符串：
 * TreeMap 按 key 字母序序列化 eventCd（数字）、eventId、eventTime、可选 prjCod。
 * eventCd 优先取原始 JSON 中的数字原文，避免 JS Number 丢失 Long 精度。
 */
export function buildEventCallbackSignText(
  envelope: Pick<OaEventEnvelope, 'eventId' | 'eventTime' | 'eventCd' | 'prjCod'>,
  rawBody?: string,
): string {
  const eventCd = extractRawJsonNumber(rawBody, 'eventCd') ?? envelope.eventCd;
  if (!/^-?\d+$/.test(eventCd)) {
    throw new OaEventVerifyError('eventCd 必须为数字');
  }
  const parts = [
    `"eventCd":${eventCd}`,
    `"eventId":${JSON.stringify(envelope.eventId)}`,
    `"eventTime":${JSON.stringify(envelope.eventTime)}`,
  ];
  const prjCod = extractRawJsonString(rawBody, 'prjCod') ?? envelope.prjCod;
  if (prjCod) {
    parts.push(`"prjCod":${JSON.stringify(prjCod)}`);
  }
  return `{${parts.join(',')}}`;
}

function readEventCd(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : '';
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return value.trim();
  return '';
}

function extractRawJsonNumber(rawBody: string | undefined, key: string): string | undefined {
  if (!rawBody) return undefined;
  const matched = rawBody.match(new RegExp(`"${key}"\\s*:\\s*(-?\\d+)`));
  return matched?.[1];
}

function extractRawJsonString(rawBody: string | undefined, key: string): string | undefined {
  if (!rawBody) return undefined;
  const matched = rawBody.match(new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`));
  if (!matched) return undefined;
  try {
    return JSON.parse(`"${matched[1]}"`) as string;
  } catch {
    return matched[1];
  }
}
