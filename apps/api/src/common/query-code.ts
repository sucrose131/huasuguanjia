import { pinyin } from 'pinyin-pro';

const QUERY_CODE_MAX_LENGTH = 30;

/**
 * 由商品名称生成速查码：汉字取拼音首字母（大写），字母转大写，数字保留，其余跳过。
 */
export function buildQueryCodeFromName(name: string): string {
  const source = String(name ?? '').trim();
  if (!source) return '';

  const initials = pinyin(source, {
    pattern: 'first',
    toneType: 'none',
    type: 'array',
    nonZh: 'consecutive',
  });

  let result = '';
  for (const part of initials) {
    const token = String(part ?? '');
    for (const char of token) {
      if (/[A-Za-z]/.test(char)) {
        result += char.toUpperCase();
      } else if (/[0-9]/.test(char)) {
        result += char;
      }
      if (result.length >= QUERY_CODE_MAX_LENGTH) {
        return result.slice(0, QUERY_CODE_MAX_LENGTH);
      }
    }
  }

  return result;
}
