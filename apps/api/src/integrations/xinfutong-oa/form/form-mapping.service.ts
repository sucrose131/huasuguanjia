import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { OA_FORM_MAPPINGS } from './form-mapping.constants';
import type { OaFormMapping, OaFormFieldMapping } from './form-mapping.constants';

/**
 * OA 表单映射读取服务（DB 承载，账套维度）
 *
 * 从 hspsi_oa_form_template + hspsi_oa_form_field_mapping 读取按
 * (business_type, account_set_id) 维度的表单映射，重建与 OA_FORM_MAPPINGS
 * 等价的结构（含 FinTable 子元素 child 标识）。
 *
 * - child 标识从 template.form_config 推导（方案 A，不改表）：
 *   解析 componentType === 'FinTable' 的 children 的 uniqueName 集合。
 * - 进程内缓存按 (business_type, account_set_id) 缓存，模板重新填充后需 invalidate。
 * - 兜底：DB 无映射且为账套1 时降级到 OA_FORM_MAPPINGS 常量（仅账套1）；
 *   其余账套无映射时直接报错，不静默降级。
 */
@Injectable()
export class OaFormMappingService {
  private static readonly logger = new Logger(OaFormMappingService.name);
  private readonly cache = new Map<string, OaFormMapping>();

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private key(businessType: string, accountSetId: bigint) {
    return `${businessType}:${accountSetId}`;
  }

  /** 清除缓存（表单映射重新填充后调用） */
  invalidate() {
    this.cache.clear();
  }

  async getMapping(businessType: string, accountSetId: bigint): Promise<OaFormMapping> {
    const cacheKey = this.key(businessType, accountSetId);
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const rows = await this.prisma.hspsi_oa_form_field_mapping.findMany({
      where: { business_type: businessType, account_set_id: accountSetId, deleted_at: null },
      orderBy: { sort_order: 'asc' },
    });
    if (!rows.length) {
      // 账套1 兜底到常量（常量即账套1 映射）；其他账套不降级
      const fallback = OA_FORM_MAPPINGS[businessType as keyof typeof OA_FORM_MAPPINGS];
      if (accountSetId === 1n && fallback) {
        OaFormMappingService.logger.warn(
          `表单映射 DB 缺失，账套1 降级到常量：${businessType}`,
        );
        this.cache.set(cacheKey, fallback);
        return fallback;
      }
      throw new Error(`该账套未配置OA审批表单：${businessType}（account_set_id=${accountSetId}）`);
    }

    const template = await this.prisma.hspsi_oa_form_template.findFirst({
      where: { id: rows[0]!.template_id, deleted_at: null },
    });
    if (!template) {
      throw new Error(`表单模板不存在：${businessType}（template_id=${rows[0]!.template_id}）`);
    }

    const childSet = collectFinTableChildUniqueNames(template.form_config);
    const fields: Record<string, OaFormFieldMapping> = {};
    for (const row of rows) {
      fields[row.local_field] = {
        componentType: row.component_type,
        uniqueName: row.unique_name,
        child: childSet.has(row.unique_name),
      };
    }

    const mapping: OaFormMapping = {
      businessType,
      formKey: template.form_key,
      formId: template.form_id,
      fields,
    };
    this.cache.set(cacheKey, mapping);
    return mapping;
  }
}

/** 解析 form_config JSON，收集所有 FinTable 子控件的 uniqueName 集合 */
export function collectFinTableChildUniqueNames(formConfigJson: string): Set<string> {
  const childSet = new Set<string>();
  let config: unknown;
  try {
    config = JSON.parse(formConfigJson);
  } catch {
    return childSet;
  }
  walkControls(config, childSet);
  return childSet;
}

function walkControls(config: unknown, childSet: Set<string>) {
  if (!Array.isArray(config)) return;
  for (const control of config) {
    if (!control || typeof control !== 'object') continue;
    const props = (control as { props?: Record<string, unknown> }).props ?? {};
    const children = props.children;
    if (Array.isArray(children)) {
      // 该控件为容器（FinTable 等），children 均为子元素
      for (const child of children) {
        if (!child || typeof child !== 'object') continue;
        const childProps = (child as { props?: Record<string, unknown> }).props ?? {};
        const un = childProps.uniqueName;
        if (typeof un === 'string' && un) childSet.add(un);
      }
      walkControls(children, childSet);
    }
  }
}
