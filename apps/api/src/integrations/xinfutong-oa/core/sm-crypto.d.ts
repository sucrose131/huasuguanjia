/**
 * sm-crypto 类型声明（该库未提供官方类型定义）
 */

declare module 'sm-crypto' {
  export const sm2: {
    /**
     * 生成密钥对
     */
    generateKeyPairHex(): {
      privateKey: string;
      publicKey: string;
    };
    /**
     * 计算公钥
     */
    getPublicKeyFromPrivateKey(privateKey: string): string;
    /**
     * 签名
     * @param msg 消息（hex 字符串）
     * @param privateKey 私钥（hex 字符串）
     * @param options hash-是否先做 SM3 摘要（默认 false），userId-用户 ID（默认 '1234567812345678'）
     * @returns 签名值（hex，R||S 裸拼接 128 字符）
     */
    doSignature(
      msg: string,
      privateKey: string,
      options?: { hash?: boolean; userId?: string; der?: boolean },
    ): string;
    /**
     * 验签
     */
    doVerifySignature(
      msg: string,
      signHex: string,
      publicKey: string,
      options?: { hash?: boolean; userId?: string; der?: boolean },
    ): boolean;
  };

  export const sm3: {
    /**
     * 计算 SM3 摘要
     * @param data 字符串或 Buffer
     * @returns hex 摘要值（64 字符）
     */
    (data: string | Buffer): string;
  };

  export const sm4: {
    /**
     * SM4 加密
     * @param data 明文（字符串）
     * @param key 密钥（hex 字符串，32 字符 = 16 字节）
     * @param options mode-加密模式（ecb/cbc），output-输出格式（array/base64）
     * @returns hex 密文
     */
    encrypt(
      data: string,
      key: string,
      options?: { mode?: 'ecb' | 'cbc'; iv?: string; output?: 'array' | 'base64' },
    ): string;
    /**
     * SM4 解密
     * @param data 密文（hex 字符串）
     * @param key 密钥（hex 字符串）
     * @param options mode-解密模式
     * @returns 明文字符串
     */
    decrypt(
      data: string,
      key: string,
      options?: { mode?: 'ecb' | 'cbc'; iv?: string },
    ): string;
  };
}
