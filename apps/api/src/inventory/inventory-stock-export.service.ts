import { Inject, Injectable, Logger } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { Writable } from 'node:stream';
import { AmountAccessService } from '../amount-access/amount-access.service';
import { PrismaService } from '../database/prisma.service';
import { InventoryService, type InventoryStockExportData } from './inventory.service';

type Body = Record<string, any>;

export type PreparedInventoryStockExport = InventoryStockExportData & {
  amountVisible: boolean;
  exportedAt: Date;
  fileName: string;
};

const MASKED_AMOUNT = '¥****';
const COLUMNS = [
  { header: '序号', width: 9 },
  { header: 'ID', width: 38 },
  { header: '商品编码', width: 18 },
  { header: '商品名称', width: 28 },
  { header: '规格', width: 24 },
  { header: '组织', width: 24 },
  { header: '所在仓库', width: 22 },
  { header: '即时结存', width: 14 },
  { header: '累计入库', width: 14 },
  { header: '累计出库', width: 14 },
  { header: '单位成本', width: 16 },
  { header: '库存金额', width: 18 },
  { header: '库存状态', width: 13 },
] as const;

function shanghaiDateTime(value: Date) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
    .format(value)
    .replaceAll('/', '-');
}

function fileTimestamp(value: Date) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}${part('month')}${part('day')}_${part('hour')}${part('minute')}${part('second')}`;
}

function safeFilePart(value: string) {
  return value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 40) || '未命名';
}

@Injectable()
export class InventoryStockExportService {
  private readonly logger = new Logger(InventoryStockExportService.name);

  constructor(
    @Inject(InventoryService) private readonly inventory: InventoryService,
    @Inject(AmountAccessService) private readonly amountAccess: AmountAccessService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async prepare(query: Body, userId: string): Promise<PreparedInventoryStockExport> {
    // 金额授权在每次导出请求中直接读取数据库，不复用页面状态或历史导出结果。
    const [data, access] = await Promise.all([
      this.inventory.stockExportData(query),
      this.amountAccess.forUser(userId),
    ]);
    const exportedAt = new Date();
    return {
      ...data,
      amountVisible: access.canViewAmount && access.amountScope === 'all',
      exportedAt,
      fileName: `库存查询_${safeFilePart(data.organizationName)}_${safeFilePart(data.warehouseName)}_${fileTimestamp(exportedAt)}.xlsx`,
    };
  }

  async write(data: PreparedInventoryStockExport, destination: Writable) {
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: destination,
      useSharedStrings: false,
      useStyles: true,
    });
    workbook.creator = 'HSPSI';
    workbook.created = data.exportedAt;
    workbook.modified = data.exportedAt;
    const sheet = workbook.addWorksheet('库存查询', {
      views: [{ state: 'frozen', ySplit: 6 }],
      properties: { defaultRowHeight: 20 },
    });
    sheet.columns = COLUMNS.map((column) => ({ width: column.width }));

    sheet.mergeCells('A1:M1');
    const title = sheet.getCell('A1');
    title.value = '库存查询导出';
    title.font = { bold: true, size: 16, color: { argb: 'FF17365D' } };
    title.alignment = { vertical: 'middle', horizontal: 'center' };
    sheet.getRow(1).height = 28;

    sheet.mergeCells('A2:M2');
    sheet.getCell('A2').value = `组织：${data.organizationName}    仓库：${data.warehouseName}`;
    sheet.mergeCells('A3:M3');
    sheet.getCell('A3').value = [
      `商品条件：${data.keyword || '全部'}`,
      `批号：${data.batchNo || '全部'}`,
      `仅显示有库存：${data.inStockOnly ? '是' : '否'}`,
    ].join('    ');
    sheet.mergeCells('A4:M4');
    sheet.getCell('A4').value =
      `导出时间：${shanghaiDateTime(data.exportedAt)}（Asia/Shanghai）    数据条数：${data.items.length}`;
    for (const rowNumber of [2, 3, 4]) {
      const cell = sheet.getCell(`A${rowNumber}`);
      cell.font = { size: 10, color: { argb: 'FF475467' } };
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
    }
    sheet.addRow([]).commit();

    const header = sheet.addRow(COLUMNS.map((column) => column.header));
    header.height = 24;
    header.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD9E2F3' } },
        left: { style: 'thin', color: { argb: 'FFD9E2F3' } },
        bottom: { style: 'thin', color: { argb: 'FFD9E2F3' } },
        right: { style: 'thin', color: { argb: 'FFD9E2F3' } },
      };
    });
    header.commit();
    sheet.autoFilter = { from: 'A6', to: 'M6' };

    data.items.forEach((item, index) => {
      const row = sheet.addRow([
        index + 1,
        String(item.id ?? ''),
        String(item.goodsCode ?? ''),
        String(item.goodsName ?? ''),
        String(item.skuSpec ?? ''),
        String(item.orgName ?? ''),
        String(item.warehouseName ?? ''),
        Number(item.inventoryQty ?? 0),
        Number(item.inputQty ?? 0),
        Number(item.outputQty ?? 0),
        data.amountVisible ? Number(item.unitCost ?? 0) : MASKED_AMOUNT,
        data.amountVisible ? Number(item.inventoryAmount ?? 0) : MASKED_AMOUNT,
        String(item.inventoryStatus ?? ''),
      ]);
      row.eachCell((cell, columnNumber) => {
        cell.border = {
          top: { style: 'hair', color: { argb: 'FFE4E7EC' } },
          left: { style: 'hair', color: { argb: 'FFE4E7EC' } },
          bottom: { style: 'hair', color: { argb: 'FFE4E7EC' } },
          right: { style: 'hair', color: { argb: 'FFE4E7EC' } },
        };
        cell.alignment = {
          vertical: 'middle',
          horizontal: columnNumber >= 8 && columnNumber <= 12 ? 'right' : 'left',
        };
      });
      // ID、商品编码及所有外部文本都按字符串写入，不创建公式或隐藏数据。
      row.getCell(2).numFmt = '@';
      row.getCell(3).numFmt = '@';
      row.getCell(8).numFmt = '#,##0.####';
      row.getCell(9).numFmt = '#,##0.####';
      row.getCell(10).numFmt = '#,##0.####';
      if (data.amountVisible) {
        row.getCell(11).numFmt = '"¥"#,##0.0000';
        row.getCell(12).numFmt = '"¥"#,##0.00';
      } else {
        row.getCell(11).numFmt = '@';
        row.getCell(12).numFmt = '@';
      }
      row.commit();
    });

    await workbook.commit();
  }

  async recordAudit(data: PreparedInventoryStockExport, userId: string) {
    try {
      await this.prisma.hspsi_sys_oper_log.create({
        data: {
          method: 'GET',
          router: '/inventory/stocks/export',
          url: '/inventory/stocks/export',
          service_name: 'inventory',
          request_data: JSON.stringify({
            organizationName: data.organizationName,
            warehouseName: data.warehouseName,
            keyword: data.keyword,
            batchNo: data.batchNo,
            inStockOnly: data.inStockOnly,
          }),
          response_code: '200',
          response_data: JSON.stringify({
            fileName: data.fileName,
            rowCount: data.items.length,
            amountVisible: data.amountVisible,
          }),
          created_by: Number(userId),
          updated_by: Number(userId),
        },
      });
    } catch (error) {
      this.logger.error(
        `库存查询导出审计日志写入失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
