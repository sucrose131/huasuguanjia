import { sm2 as sm2Lib, sm3 as sm3Lib, sm4 as sm4Lib } from 'sm-crypto';

/**
 * 薪福通国密算法封装
 *
 * 对应 PHP 版 GetOADataCommand 中的国密实现：
 * - SM3 摘要（GB/T 32905-2016）
 * - SM4-ECB 对称加解密（GB/T 32907-2016）
 * - SM2 非对称签名 sm3withsm2（GB/T 32918.2-2016）
 *
 * 底层依赖 sm-crypto 库，用户 ID 固定为国密标准 "1234567812345678"。
 */

/** 签名算法标识（固定，对应 PHP 版 VERIFY_ALGORITHM） */
export const VERIFY_ALGORITHM = 'sm3withsm2';

/** SM2 国密标准默认用户 ID */
export const SM2_USER_ID = '1234567812345678';

/**
 * 规整私钥 hex 为 32 字节（64 hex 字符）
 *
 * 对应 PHP 版 normalizePrivateKeyHex：去除前导零并规整为 32 字节，
 * 模拟 Java BigInteger 的行为。
 *
 * @param hexPrivateKey hex 私钥
 * @returns 32 字节 hex（64 字符）
 */
function normalizePrivateKeyHex(hexPrivateKey: string): string {
  const hex = hexPrivateKey.toLowerCase().trim();
  const buf = Buffer.from(hex, 'hex');
  if (buf.length === 0) {
    throw new Error('SM2 私钥 hex 解码失败，请检查 authoritySecret 配置');
  }
  // 去除前导零
  let start = 0;
  while (start < buf.length - 1 && buf[start] === 0) {
    start++;
  }
  const trimmed = buf.subarray(start);
  if (trimmed.length > 32) {
    return trimmed.subarray(trimmed.length - 32).toString('hex');
  }
  if (trimmed.length < 32) {
    return Buffer.concat([Buffer.alloc(32 - trimmed.length, 0), trimmed]).toString('hex');
  }
  return trimmed.toString('hex');
}

/**
 * 计算 SM3 摘要
 *
 * 对应 PHP 版 sm3Digest：返回 hex 摘要值（64 字符）
 *
 * @param data 原始数据（字符串或 Buffer）
 * @returns 16 进制摘要值（64 字符）
 */
export function sm3Digest(data: string | Buffer): string {
  return sm3Lib(typeof data === 'string' ? Buffer.from(data, 'utf8') : data);
}

/**
 * 获取 SM4 加密密钥（16 字节，由 authoritySecret 前 32 位 hex）
 *
 * 对应 PHP 版 getSm4Key：取 authoritySecret 前 32 hex（16 字节）作为密钥
 *
 * @param authoritySecret 授权密钥（完整 hex 字符串）
 * @returns 16 字节 hex 密钥（32 字符）
 */
export function getSm4Key(authoritySecret: string): string {
  const hexKey = authoritySecret.trim().slice(0, 32);
  if (hexKey.length !== 32) {
    throw new Error('SM4 密钥格式不正确，需要 32 位 hex 字符串（16 字节）');
  }
  return hexKey;
}

/**
 * SM4-ECB 加密（PKCS5Padding）
 *
 * 对应 PHP 版 sm4Encrypt：返回 16 进制密文
 *
 * @param plainText 明文
 * @param authoritySecret 授权密钥（取前 32 hex 作 SM4 密钥）
 * @returns 16 进制密文
 */
export function sm4Encrypt(plainText: string, authoritySecret: string): string {
  const key = getSm4Key(authoritySecret);
  return sm4Lib.encrypt(plainText, key, { mode: 'ecb' });
}

/**
 * SM4-ECB 解密（PKCS5Padding）
 *
 * 对应 PHP 版 sm4Decrypt：输入 16 进制密文，返回明文
 *
 * @param cipherTextHex 16 进制密文
 * @param authoritySecret 授权密钥（取前 32 hex 作 SM4 密钥）
 * @returns 明文
 */
export function sm4Decrypt(cipherTextHex: string, authoritySecret: string): string {
  const key = getSm4Key(authoritySecret);
  return sm4Lib.decrypt(cipherTextHex, key, { mode: 'ecb' });
}

/**
 * 加密请求体并包装为 secretMsg 结构
 *
 * 对应 PHP 版 encryptBody：
 *   sendBody = {"secretMsg":"<sm4加密后的hex>"}
 *
 * @param rawBody 原始请求体
 * @param authoritySecret 授权密钥
 * @returns 包装后的 JSON 字符串
 */
export function encryptBody(rawBody: string, authoritySecret: string): string {
  const secretMsg = sm4Encrypt(rawBody, authoritySecret);
  return JSON.stringify({ secretMsg });
}

/**
 * 解密响应体（兼容直接密文或 secretMsg 结构）
 *
 * 对应 PHP 版 decryptBody：
 *   - 若响应体为 {"secretMsg":"..."}，则取 secretMsg 解密
 *   - 否则视为直接密文进行解密
 *
 * @param responseBody 响应体
 * @param authoritySecret 授权密钥
 * @returns 解密后的明文
 */
export function decryptBody(responseBody: string, authoritySecret: string): string {
  try {
    const decoded = JSON.parse(responseBody) as { secretMsg?: string };
    if (decoded && typeof decoded.secretMsg === 'string') {
      return sm4Decrypt(decoded.secretMsg, authoritySecret);
    }
  } catch {
    // 非 JSON，按直接密文处理
  }
  return sm4Decrypt(responseBody, authoritySecret);
}

/**
 * 使用 SM2 算法（sm3withsm2）对字符串进行签名
 *
 * 对应 PHP 版 sm2Sign：
 *   1. 从私钥推导公钥（d * G）
 *   2. 计算预处理值 Z = SM3(ENTL || ID || a || b || Gx || Gy || PubX || PubY)
 *   3. e = SM3(Z || M)
 *   4. r = (e + x1) mod n，其中 (x1,y1) = k * G
 *   5. s = ((1+d)^-1 * (k - r*d)) mod n
 *   6. 输出 R || S（各 32 字节，共 128 hex 字符）
 *
 * sm-crypto 的 doSignature 在 hash=true + userId 时会自动完成上述流程，
 * 与 Java BouncyCastle 实现完全一致。
 *
 * @param signStr 待签名字符串
 * @param authoritySecret 授权密钥（完整 hex 作为 SM2 私钥）
 * @returns 16 进制签名值（R||S 格式，128 字符）
 */
export function sm2Sign(signStr: string, authoritySecret: string): string {
  const privateKey = normalizePrivateKeyHex(authoritySecret);
  // sm-crypto 的 doSignature 会对字符串参数自动做 utf8ToHex，
  // 因此直接传原始字符串，不要预先转 hex（否则会被二次编码）
  return sm2Lib.doSignature(signStr, privateKey, {
    hash: true,
    userId: SM2_USER_ID,
  });
}
