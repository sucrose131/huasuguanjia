import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { HuasuHomeConferenceOrderSyncService } from '../integrations/huasu-home/sync/conference-order-sync.service';
import { HuasuHomeInstallmentOrderSyncService } from '../integrations/huasu-home/sync/installment-order-sync.service';
import { HuasuHomeOrderSyncService } from '../integrations/huasu-home/sync/order-sync.service';
import { HuasuHomeProductSyncService } from '../integrations/huasu-home/sync/product-sync.service';
import { HuasuHomeUserSyncService } from '../integrations/huasu-home/sync/user-sync.service';
import { ShifangQingyuanGoodsSyncService } from '../integrations/shifang-qingyuan/sync/goods-sync.service';
import { ShifangQingyuanOrderSyncService } from '../integrations/shifang-qingyuan/sync/order-sync.service';
import { ShifangQingyuanUserSyncService } from '../integrations/shifang-qingyuan/sync/user-sync.service';
import { XinfutongOaOrgSyncJob } from '../integrations/xinfutong-oa/sync/org-sync-job.service';
import { LAST_MESSAGE_MAX, SCHEDULED_TASK_CODE } from './scheduled-task.constants';

export class ScheduledTaskBusyError extends Error {
  constructor(message = '上一轮未结束，已跳过') {
    super(message);
    this.name = 'ScheduledTaskBusyError';
  }
}

@Injectable()
export class ScheduledTaskHandlers {
  constructor(
    @Inject(HuasuHomeUserSyncService) private readonly huasuUsers: HuasuHomeUserSyncService,
    @Inject(HuasuHomeProductSyncService) private readonly huasuProducts: HuasuHomeProductSyncService,
    @Inject(HuasuHomeOrderSyncService) private readonly huasuOrders: HuasuHomeOrderSyncService,
    @Inject(HuasuHomeConferenceOrderSyncService)
    private readonly huasuConference: HuasuHomeConferenceOrderSyncService,
    @Inject(HuasuHomeInstallmentOrderSyncService)
    private readonly huasuInstallment: HuasuHomeInstallmentOrderSyncService,
    @Inject(ShifangQingyuanUserSyncService) private readonly shifangUsers: ShifangQingyuanUserSyncService,
    @Inject(ShifangQingyuanGoodsSyncService)
    private readonly shifangGoods: ShifangQingyuanGoodsSyncService,
    @Inject(ShifangQingyuanOrderSyncService)
    private readonly shifangOrders: ShifangQingyuanOrderSyncService,
    @Inject(XinfutongOaOrgSyncJob) private readonly oaOrg: XinfutongOaOrgSyncJob,
  ) {}

  async execute(taskCode: string): Promise<string> {
    try {
      switch (taskCode) {
        case SCHEDULED_TASK_CODE.HUASU_USERS:
          return await this.syncHuasuUsers();
        case SCHEDULED_TASK_CODE.HUASU_PRODUCTS:
          return await this.syncHuasuProducts();
        case SCHEDULED_TASK_CODE.HUASU_ORDERS:
          return await this.syncHuasuOrders();
        case SCHEDULED_TASK_CODE.SHIFANG_USERS:
          return await this.syncShifangUsers();
        case SCHEDULED_TASK_CODE.SHIFANG_GOODS:
          return await this.syncShifangGoods();
        case SCHEDULED_TASK_CODE.SHIFANG_ORDERS:
          return await this.syncShifangOrders();
        case SCHEDULED_TASK_CODE.OA_ORG:
          return await this.oaOrg.syncAll();
        default:
          throw new Error(`未注册的任务类型：${taskCode}`);
      }
    } catch (error) {
      if (isBusyError(error)) {
        throw new ScheduledTaskBusyError();
      }
      throw error;
    }
  }

  private async syncHuasuUsers(): Promise<string> {
    const stats = await this.huasuUsers.syncUsers({ operatorId: 0n });
    if (!stats) throw new ScheduledTaskBusyError();
    return `拉取${stats.fetched} 新增${stats.created} 更新${stats.updated} 失败${stats.failed}`;
  }

  private async syncHuasuProducts(): Promise<string> {
    const stats = await this.huasuProducts.syncProducts('0');
    return (
      `单品${stats.products.created}/${stats.products.updated} ` +
      `套餐${stats.packages.created}/${stats.packages.updated} ` +
      `映射${stats.mappings.upserted}`
    );
  }

  private async syncHuasuOrders(): Promise<string> {
    const sale = await this.huasuOrders.syncOrders('0');
    const conference = await this.huasuConference.syncConferenceOrders('0');
    const installment = await this.huasuInstallment.syncInstallmentOrders('0');
    return (
      `销售${sale.fetched}/${sale.created}/${sale.updated} ` +
      `会议${conference.fetched}/${conference.created}/${conference.updated} ` +
      `分期${installment.fetched}/${installment.created}/${installment.updated}`
    );
  }

  private async syncShifangUsers(): Promise<string> {
    const stats = await this.shifangUsers.syncUsers({ operatorId: 0n });
    if (!stats) throw new ScheduledTaskBusyError();
    return `拉取${stats.fetched} 新增${stats.created} 更新${stats.updated} 失败${stats.failed}`;
  }

  private async syncShifangGoods(): Promise<string> {
    const stats = await this.shifangGoods.syncGoods('0');
    return (
      `商品${stats.goods.created}/${stats.goods.updated} ` +
      `仅映射${stats.goods.mappingOnly} 跳过${stats.goods.skipped} ` +
      `SKU${stats.skus.created}/${stats.skus.updated} ` +
      `映射${stats.mappings.upserted} 转换规则${stats.conversionRules.upserted}`
    );
  }

  private async syncShifangOrders(): Promise<string> {
    const stats = await this.shifangOrders.syncOrders('0');
    return (
      `拉取${stats.fetched} 新增${stats.created} 更新${stats.updated} ` +
      `跳过${stats.skipped} 失败${stats.failed} ` +
      `收款${stats.payments} 出库${stats.outputs} 退货${stats.exits} 售后${stats.events}`
    );
  }
}

export function truncateMessage(value: string): string {
  const text = value.trim();
  if (text.length <= LAST_MESSAGE_MAX) return text;
  return `${text.slice(0, LAST_MESSAGE_MAX - 1)}…`;
}

export function isBusyError(error: unknown): boolean {
  if (error instanceof ScheduledTaskBusyError) return true;
  if (error instanceof BadRequestException) {
    const response = error.getResponse();
    const message =
      typeof response === 'string'
        ? response
        : typeof response === 'object' && response && 'message' in response
          ? String((response as { message: unknown }).message)
          : error.message;
    return message.includes('仍在进行');
  }
  return false;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}
