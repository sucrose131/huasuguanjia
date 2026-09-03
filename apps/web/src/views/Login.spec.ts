import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const login = readFileSync(new URL('./Login.vue', import.meta.url), 'utf8');

describe('Login operation guides', () => {
  it('loads login-page guides and previews the pdf in a dialog', () => {
    expect(login).toContain("api.get('/public/operation-guides')");
    expect(login).toContain('/api/public/operation-guides/file?value=${encodeURIComponent(value)}');
    expect(login).toContain('openOperationGuide');
    expect(login).toContain('v-for="guide in guides"');
    expect(login).toContain('el-dialog');
    expect(login).toContain('guide-preview-frame');
    expect(login).not.toContain('window.open');
  });
});
