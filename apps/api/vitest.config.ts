import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 外置 macOS 文件系统可能生成 AppleDouble `._*` 元数据文件，不能作为测试源码解析。
    exclude: ['**/node_modules/**', '**/dist/**', '**/._*'],
  },
});
