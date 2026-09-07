import * as Vue from 'vue';
import {
  createRenderer,
  defineComponent,
  h,
  inject,
  nextTick,
  provide,
  reactive,
  ssrContextKey,
} from 'vue';
import { parse, compileScript, compileTemplate } from 'vue/compiler-sfc';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ReportPage from '../ReportPage.vue';

// Node 模式下 Vite 编译 SFC 为 SSR；用同一源模板编译客户端 render 供自定义渲染器执行。
const filename = new URL('../ReportPage.vue', import.meta.url);
const { descriptor } = parse(readFileSync(filename, 'utf8'));
const compiled = compileTemplate({
  source: descriptor.template!.content,
  filename: filename.pathname,
  id: 'report-test',
  compilerOptions: { bindingMetadata: compileScript(descriptor, { id: 'report-test' }).bindings },
});
const renderCode = compiled.code
  .replace(
    /import \{([^}]+)\} from "vue"/g,
    (_, names: string) => `const {${names.replace(/\bas\b/g, ':')}} = Vue`,
  )
  .replace('export function render', 'function render');
(ReportPage as any).render = new Function('Vue', `${renderCode}; return render;`)(Vue);

const mocks = vi.hoisted(() => ({ get: vi.fn(), auth: {} as any, route: {} as any }));
vi.mock('@/api', () => ({ api: { get: mocks.get } }));
vi.mock('@/stores/auth', () => ({ useAuthStore: () => mocks.auth }));
vi.mock('vue-router', () => ({ useRoute: () => mocks.route }));
vi.mock('@element-plus/icons-vue', () => ({
  Download: { render: () => null },
  Refresh: { render: () => null },
  Warning: { render: () => null },
}));

// 在 Node 中真正执行 ReportPage 的 setup、模板和导出事件，不依赖静态源码断言。
type Node = {
  type: string;
  text: string;
  children: Node[];
  parent?: Node;
  props: Record<string, any>;
};
const node = (type: string, text = ''): Node => ({ type, text, children: [], props: {} });
const renderer = createRenderer<Node, Node>({
  createElement: (type) => node(type),
  createText: (text) => node('text', text),
  createComment: (text) => node('comment', text),
  setText: (el, text) => {
    el.text = text;
  },
  setElementText: (el, text) => {
    el.text = text;
    el.children = [];
  },
  parentNode: (el) => el.parent ?? null,
  nextSibling: (el) => el.parent?.children[el.parent.children.indexOf(el) + 1] ?? null,
  insert: (el, parent, anchor) => {
    if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1);
    el.parent = parent;
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    if (index < 0) parent.children.push(el);
    else parent.children.splice(index, 0, el);
  },
  remove: (el) => {
    if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1);
  },
  patchProp: (el, key, _old, value) => {
    el.props[key] = value;
  },
});
const textOf = (el: Node): string =>
  el.type === 'comment' ? '' : el.text + el.children.map(textOf).join(' ');
const find = (el: Node, predicate: (el: Node) => boolean): Node | undefined =>
  predicate(el) ? el : el.children.map((child) => find(child, predicate)).find(Boolean);
const stub = defineComponent({
  setup:
    (_, { slots, attrs }) =>
    () =>
      h('stub', attrs, slots.default?.()),
});
const table = defineComponent({
  props: ['data'],
  setup(props, { slots }) {
    provide('reportRows', () => props.data);
    return () => h('table', slots.default?.());
  },
});
const column = defineComponent({
  props: ['label'],
  setup(props, { slots }) {
    const rows = inject<() => any[]>('reportRows')!;
    return () =>
      h('column', [props.label, ...rows().flatMap((row) => slots.default?.({ row }) ?? [])]);
  },
});

const reportKeys = [
  'products',
  'vendors',
  'customers',
  'purchase-detail',
  'purchase-summary',
  'production-detail',
  'production-summary',
  'sales-detail',
  'discount-detail',
  'sales-summary',
  'requisition-detail',
  'requisition-summary',
  'inbound-detail',
  'outbound-detail',
  'loss-detail',
  'overflow-detail',
  'inventory-summary',
  'check-summary',
  'batch-inbound',
  'purchase-payment',
  'purchase-payable',
];
const moneyKeys = new Set([
  'purchase-detail',
  'purchase-summary',
  'sales-detail',
  'discount-detail',
  'sales-summary',
  'loss-detail',
  'overflow-detail',
  'inventory-summary',
  'purchase-payment',
  'purchase-payable',
]);
const accesses = [
  { level: 'none', canViewAmount: false, canEditAmount: false, amountScope: 'own' },
  { level: 'view', canViewAmount: true, canEditAmount: false, amountScope: 'own' },
  { level: 'edit', canViewAmount: true, canEditAmount: true, amountScope: 'own' },
  { level: 'view', canViewAmount: true, canEditAmount: false, amountScope: 'all' },
  { level: 'edit', canViewAmount: true, canEditAmount: true, amountScope: 'all' },
];
const fixture = () => ({
  id: 'ROW1',
  createdBy: '61',
  createdByName: '测试经办人',
  date: new Date().toISOString().slice(0, 10),
  orderNo: 'TEST-ORDER',
  name: '测试资料',
  goodsName: '测试商品',
  warehouseName: '测试仓库',
  vendorName: '测试供应商',
  customerName: '测试客户',
  deptName: '测试部门',
  statusName: '已完成',
  amount: 123.45,
  totalAmount: 123.45,
  actualAmount: 123.45,
  discountAmount: 12.34,
  paidAmount: 23.45,
  inventoryAmount: 123.45,
  quantity: 7,
  planQty: 7,
  inventoryQty: 7,
  inputQty: 7,
});
const settle = async () => {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
    await nextTick();
  }
};
let app: ReturnType<typeof renderer.createApp> | undefined;
let exported: Blob | undefined;
async function open(key: string, access: (typeof accesses)[number]) {
  mocks.auth = reactive({
    amountAccess: { ...access },
    user: { id: '61', authorizedOrganizations: [{ id: '2' }] },
    token: 'test',
  });
  mocks.route = reactive({ params: { report: key } });
  mocks.get
    .mockReset()
    .mockImplementation(async (url: string) =>
      url.startsWith('/dictionaries/')
        ? [{ value: 1, label: '启用' }]
        : { items: [fixture()], total: 1 },
    );
  exported = undefined;
  vi.stubGlobal('document', { createElement: () => ({ click: vi.fn() }) });
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    exported = blob as Blob;
    return 'blob:test';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const root = node('root');
  app = renderer.createApp(ReportPage);
  app.provide(ssrContextKey, {});
  for (const name of ['el-button', 'el-date-picker', 'el-tag', 'el-icon'])
    app.component(name, stub);
  app.component('el-table', table);
  app.component('el-table-column', column);
  app.mount(root);
  await settle();
  return root;
}
afterEach(() => {
  app?.unmount();
  app = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('逐张报表：实际页面渲染、合计、CSV与请求上下文', () => {
  it('清单覆盖路由中的全部21张报表', () => {
    const source = readFileSync(new URL('../../router.ts', import.meta.url), 'utf8');
    const routes = source.match(/reports\/:report\(([^)]+)\)/)![1]!.split('|');
    expect(reportKeys).toEqual(routes);
  });
  for (const key of reportKeys) {
    it.each(accesses)(`${key} — $level/$amountScope`, async (access) => {
      const root = await open(key, access);
      const text = textOf(root);
      expect(text).not.toContain('报表加载失败');
      const count = ['sales-detail', 'inbound-detail'].includes(key)
        ? 2
        : ['requisition-detail', 'outbound-detail'].includes(key)
          ? 3
          : 1;
      expect(text).toContain(`${count} 条真实数据`);
      const allowed = access.canViewAmount && access.amountScope === 'all';
      if (moneyKeys.has(key)) {
        expect(text.includes('¥ ****')).toBe(!allowed);
        if (allowed) expect(text).toMatch(/¥\d/);
        else expect(text).not.toMatch(/¥\d/);
      }
      for (const [url, config] of mocks.get.mock.calls) {
        if (!String(url).startsWith('/dictionaries/'))
          expect(config.params.amountContext).toBe('report');
      }
      const button = find(
        root,
        (el) => typeof el.props.onClick === 'function' && textOf(el).includes('导出'),
      )!;
      button.props.onClick();
      const csv = await exported!.text();
      if (moneyKeys.has(key)) {
        expect(csv.includes('¥ ****')).toBe(!allowed);
        if (!allowed) {
          expect(csv).not.toContain('123.45');
          expect(csv).not.toContain('12.34');
        }
      }
    });
  }
  it('同一页面授权收紧后立即掩码并清空缓存重新读取', async () => {
    const root = await open('purchase-detail', accesses[4]!);
    expect(textOf(root)).toContain('¥123.45');
    const calls = mocks.get.mock.calls.length;
    mocks.auth.amountAccess.amountScope = 'own';
    await settle();
    expect(textOf(root)).not.toContain('¥123.45');
    expect(textOf(root)).toContain('¥ ****');
    expect(mocks.get.mock.calls.length).toBeGreaterThan(calls);
  });
});
