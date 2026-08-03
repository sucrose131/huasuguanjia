# 2026-07-30 全链路迁移执行说明

本目录中的 `20260730_01_` 至 `20260730_06_` 是一组有顺序依赖的增量迁移，不能按旧文件名或任意顺序执行。

## 执行前

1. 确认目标库已经完成项目所采用的 2026-07-29 基线。`20260729_*` 中存在覆盖相同字段的历史脚本，禁止对未知数据库批量执行全部脚本。
2. 使用 `INFORMATION_SCHEMA.COLUMNS` 和 `INFORMATION_SCHEMA.TABLES` 核对目标结构；如果本组迁移新增的字段或表已经存在，先确认该迁移是否已执行，不要直接重跑。
3. 停止写入目标库的 API，并完成可恢复的全库备份。
4. 记录执行时间、目标库和已执行文件。本组脚本包含非幂等 `ALTER TABLE`，中断后应先检查实际结构，再决定续跑位置。

## 固定顺序

1. `20260730_01_external_posting_version.sql`
2. `20260730_02_inventory_business_chain.sql`
3. `20260730_03_requisition_business_chain.sql`
4. `20260730_04_document_trace.sql`
5. `20260730_05_inventory_dictionary_alignment.sql`
6. `20260730_06_trace_after_business_chain.sql`

若目录中存在 `20260730_07_concurrency_integrity.sql`，必须最后执行。

## 执行后

- 重新生成 Prisma Client，并执行 API/Web 类型检查和生产构建。
- 核对 `hspsi_business_document_relation`、签名/归还属性、库存业务阶段字段和过账版本字段。
- 核对 `draw_type`、`inventory_business_mode`、`production_outbound_status`、`production_shortage_status` 的字典值未发生变化。
- 执行业务链冒烟测试，确认重复审批/确认不会重复生成单据或重复过账。
