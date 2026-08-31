import {
  constants,
  createPublicKey,
  publicEncrypt,
  randomBytes,
  type KeyObject,
} from 'crypto';

/**
 * 华溯之家签名/加密封装
 *
 * 对应 docs/integrations/huasu-home/请求规则.md：
 * 1. 请求参数 Key 按 ASCII 升序排序
 * 2. 排序后参数 json_encode(256) → 前拼时间戳，后拼随机串 → 待签名串
 * 3. 使用公钥对待签名串加密生成签名（OPENSSL_PKCS1_PADDING）
 * 4. 对签名进行 base64_encode
 *
 * 备注：公钥与私钥由接收方（华溯之家）生成，公钥提供给调用方（我方）。
 */

/**
 * 将对象按 Key ASCII 升序排序后序列化为 JSON 字符串
 *
 * 对应 PHP: ksort($params, SORT_STRING) + json_encode($params, JSON_UNESCAPED_UNICODE)
 *
 * 注：
 * - 256 = JSON_UNESCAPED_UNICODE，Node.js JSON.stringify 默认即不转义中文，行为一致
 * - PHP json_encode 默认会将 "/" 转义为 "\/"，Node.js 不会；若联调发现签名不一致，
 *   需在此处追加 .replace(/\//g, '\\/') 以对齐 PHP 行为
 */
export function buildSortedJson(params: Record<string, unknown>): string {
  const sortedKeys = Object.keys(params).sort();
  const sorted: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    sorted[key] = params[key];
  }
  return JSON.stringify(sorted);
}

/** 生成 32 位随机串（X-Nonce） */
export function generateNonce(): string {
  return randomBytes(16).toString('hex');
}

/**
 * 加载公钥为 KeyObject
 *
 * 兼容三种输入：
 * - 已是 PEM（含 -----BEGIN-----）
 * - PKCS#8 裸 base64
 * - PKCS#1 裸 base64
 */
export function loadPublicKey(publicKey: string): KeyObject {
  const trimmed = publicKey.trim();
  if (trimmed.includes('-----BEGIN')) {
    return createPublicKey(trimmed);
  }
  const der = Buffer.from(trimmed.replace(/\s+/g, ''), 'base64');
  // 先按 PKCS#8（SPKI）尝试，失败再按 PKCS#1（RSA PUBLIC KEY）尝试
  try {
    return createPublicKey({ key: der, format: 'der', type: 'spki' });
  } catch {
    return createPublicKey({ key: der, format: 'der', type: 'pkcs1' });
  }
}

/**
 * 使用公钥对待签名串进行加密生成签名（RSA_PKCS1_PADDING）并 base64 编码
 *
 * 对应 PHP: openssl_public_encrypt($data, $encrypted, $publicKey, OPENSSL_PKCS1_PADDING)
 *         + base64_encode($encrypted)
 *
 * 注意：
 * 1. 这是「公钥加密」方式的签名，非标准私钥签名
 * 2. RSA_PKCS1_PADDING 公钥加密有长度限制：明文长度 <= 密钥字节数 - 11
 *    （2048 位密钥最大 245 字节），参数过长会抛错
 */
export function signWithPublicKey(signStr: string, key: KeyObject): string {
  const encrypted = publicEncrypt(
    {
      key,
      padding: constants.RSA_PKCS1_PADDING,
    },
    Buffer.from(signStr, 'utf8'),
  );
  return encrypted.toString('base64');
}
