# 系统错误日志（Winston + 进程级兜底）实施记录（2026-08-25）

## 需求背景

记录系统级错误信息（非业务逻辑错误）：未捕获异常、未处理的 Promise 拒绝、5xx、DB/Redis/外部依赖故障、应用启动失败等。业务逻辑错误（4xx 预期错误）不进入错误日志。

## 实现内容

### 1. 依赖

- 新增 `winston@^3.19.0`、`winston-daily-rotate-file@^5.0.0`（两者均自带类型声明，无需 @types）。

### 2. Logger 桥接（`apps/api/src/common/logger/winston-logger.ts`）

- 实现 Nest `LoggerService` 桥接到 winston，`main.ts` 通过 `app.useLogger(systemLogger)` **全局替换默认 Logger**：既有全部 `Logger` 调用点无需改动自动接入；
- 级别映射：Nest `log→info`、`warn→warn`、`error→error`、`debug→debug`、`verbose→verbose`、`fatal→error`；
- 按 Nest 调用约定解析 `error(msg, stack?, context?)` 的上下文（context）与堆栈（stack/Error），写入结构化字段；**审核修复**：`parseArgs` 提取堆栈的条件由 `rest.length > 1` 改为 `> 0`，否则 `error(msg, Error, 'Context')` / `error(msg, Error)` 的堆栈会被静默丢弃（影响进程兜底三处与 scheduled-task/integration-logger 等既有调用）；
- 输出三路：
  - 控制台：开发环境彩色可读文本，生产环境 JSON；
  - `logs/error-%DATE%.log`：仅 error 级；
  - `logs/combined-%DATE%.log`：全量；
- 滚动策略：按天（`datePattern: 'YYYY-MM-DD'`）+ 单文件超 **20MB** 触发额外滚动（`maxSize: '20m'`）+ 保留 30 天（`maxFiles: '30d'`）；
- 文件不带 ANSI 颜色码、UTF-8 正常；日志目录 `apps/api/logs/`（`*.log` 与目录均已加入 .gitignore）。

### 3. 进程级兜底（`apps/api/src/main.ts`）

- `process.on('uncaughtException')`：记 error（含堆栈）后延迟 500ms 退出，交由进程管理器（PM2/systemd 等）重启；
- `process.on('unhandledRejection')`：记 error，不退出；
- `bootstrap().catch`：应用启动失败记 error 并退出；
- 启动改为 `bufferLogs: true` + `flushLogs()`，Nest 内部日志（路由映射等）也经 winston 输出。

### 4. 全局异常过滤器增强（`apps/api/src/common/http-exception.filter.ts`）

- 500/未捕获异常：请求上下文（method + url + userId）放 message，堆栈通过第二参传入适配器写入结构化字段（生产 JSON 中为独立 `stack`/`error` 字段），不再拼进 message 文本；
- 业务 4xx（BadRequest/404/403 等预期错误）不记录，仍走原有 JSON 响应。

### 5. 日志边界

| 类别 | 举例 | 处理 |
| --- | --- | --- |
| 系统错误（非预期） | 未捕获异常、Promise 拒绝、5xx、DB/Redis/外部依赖故障、启动失败 | ERROR 级 → 控制台 + `error-*.log`（含请求上下文与堆栈） |
| 业务逻辑错误（预期） | 参数校验、权限、单据状态不符等 4xx | 正常响应，不进 ERROR 日志 |

## 验证结果

- 独立驱动 `WinstonLogger`：控制台彩色、error 文件仅含 error 级、combined 含全量；UTF-8 无乱码、文件无 ANSI 码；
- 实际启动 API：`app.useLogger` 生效，Nest 路由映射等内部日志以 winston 格式写入 combined，`/api/health` 正常（验证后进程已停止）；
- **审核修复后复测**：`error('未捕获异常…', new Error('boom'), 'System')` 与 `error('任务队列排空失败', new Error(...))` 两种调用（带/不带第三个 context）在开发文本输出中均显示完整堆栈，生产 JSON 输出包含独立 `"stack"` 与 `"error": {name,message}` 字段（ELK/Loki 可按字段切分）；
- `HttpExceptionFilter` 500 路径：请求上下文进 message（`[POST /api/… user=42] 请求处理失败`），堆栈经适配器写结构化字段；400 业务错误确认不记录；
- `tsc --noEmit` 无新增类型错误。

## 影响范围

- 新增文件：`apps/api/src/common/logger/winston-logger.ts`；
- 修改文件：`apps/api/src/main.ts`、`apps/api/src/common/http-exception.filter.ts`、`apps/api/package.json`、`pnpm-lock.yaml`、根 `.gitignore`；
- 运行期：日志输出从控制台扩展为控制台 + `apps/api/logs/` 下按日滚动文件；既有 `Logger` 调用（含采购入库通知失败、OA 审批消息通知失败等）自动接入 winston；
- 不涉及业务数据表与接口契约变更。

## 遗留问题 / 待确认

- 生产部署侧如需对接 ELK/Loki/云日志，当前生产 JSON 格式可直接采集；按请求维度串联（requestId）可作为后续增强；
- `maxSize`/`maxFiles` 目前写死，如需可抽为环境变量（`LOG_MAX_SIZE` / `LOG_MAX_FILES`）。

## Git 提交号

待授权后提交（未提交）。
