import ExcelJS from 'exceljs';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import {
  InventoryStockExportService,
  type PreparedInventoryStockExport,
} from './inventory-stock-export.service';

const stockRows = [
  {
    id: '1-2-3-B001',
    goodsCode: '000123',
    goodsName: '测试商品',
    skuSpec: '10kg/袋',
    orgName: '华数生物',
    warehouseName: '原料仓',
    inventoryQty: 10,
    inputQty: 12,
    outputQty: 2,
    unitCost: 12.3456,
    inventoryAmount: 123.45,
    inventoryStatus: '有库存',
  },
];

const baseData = {
  organizationName: '华数生物',
  warehouseName: '原料仓',
  keyword: 'G001',
  batchNo: 'B001',
  inStockOnly: true,
  total: stockRows.length,
  where: { org_id: 1n },
};

function serviceWith(amountAccess: Record<string, any> = {}) {
  return new InventoryStockExportService(
    {
      stockExportData: vi.fn().mockResolvedValue(baseData),
      stockExportRows: vi.fn().mockResolvedValue(stockRows),
    } as never,
    { forUser: vi.fn().mockResolvedValue(amountAccess) } as never,
    { hspsi_sys_oper_log: { create: vi.fn() } } as never,
  );
}

async function writeWorkbook(data: PreparedInventoryStockExport) {
  const service = serviceWith();
  const stream = new PassThrough();
  const chunks: Uint8Array[] = [];
  stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  await service.write(data, stream);
  const workbook = new ExcelJS.Workbook();
  const content = Buffer.concat(chunks) as unknown as Parameters<typeof workbook.xlsx.load>[0];
  await workbook.xlsx.load(content);
  return workbook;
}

describe('InventoryStockExportService amount scope', () => {
  it.each([
    [{ canViewAmount: false, canEditAmount: false, amountScope: 'own' }, false],
    [{ canViewAmount: true, canEditAmount: false, amountScope: 'own' }, false],
    [{ canViewAmount: true, canEditAmount: true, amountScope: 'own' }, false],
    [{ canViewAmount: true, canEditAmount: false, amountScope: 'all' }, true],
    [{ canViewAmount: true, canEditAmount: true, amountScope: 'all' }, true],
  ])('applies all-scope-only rule to every fresh export request', async (access, expected) => {
    const service = serviceWith(access);

    await expect(service.prepare({ orgId: '1' }, '248')).resolves.toMatchObject({
      amountVisible: expected,
      organizationName: '华数生物',
    });
  });
});

describe('InventoryStockExportService workbook', () => {
  const prepared = (amountVisible: boolean): PreparedInventoryStockExport => ({
    ...baseData,
    amountVisible,
    exportedAt: new Date('2026-09-09T02:00:00.000Z'),
    fileName: '库存查询.xlsx',
  });

  it('writes a single visible sheet with exact masked amount text and text identifiers', async () => {
    const workbook = await writeWorkbook(prepared(false));
    expect(workbook.worksheets).toHaveLength(1);
    const sheet = workbook.getWorksheet('库存查询')!;
    expect(sheet.state).toBe('visible');
    expect(sheet.columns.every((column) => !column.hidden)).toBe(true);
    expect(sheet.getRow(6).values).toEqual([
      undefined,
      '序号',
      'ID',
      '商品编码',
      '商品名称',
      '规格',
      '组织',
      '所在仓库',
      '即时结存',
      '累计入库',
      '累计出库',
      '单位成本',
      '库存金额',
      '库存状态',
    ]);
    expect(sheet.getCell('B7').value).toBe('1-2-3-B001');
    expect(sheet.getCell('C7').value).toBe('000123');
    expect(sheet.getCell('K7').value).toBe('¥****');
    expect(sheet.getCell('L7').value).toBe('¥****');

    const values: unknown[] = [];
    sheet.eachRow((row) => row.eachCell((cell) => values.push(cell.value)));
    expect(values).not.toContain(12.3456);
    expect(values).not.toContain(123.45);
    expect(values.some((value) => typeof value === 'object' && value !== null)).toBe(false);
  });

  it('keeps authorized amounts numeric with the agreed precision', async () => {
    const sheet = (await writeWorkbook(prepared(true))).getWorksheet('库存查询')!;
    expect(sheet.getCell('K7').value).toBe(12.3456);
    expect(sheet.getCell('K7').numFmt).toBe('"¥"#,##0.0000');
    expect(sheet.getCell('L7').value).toBe(123.45);
    expect(sheet.getCell('L7').numFmt).toBe('"¥"#,##0.00');
  });
});
