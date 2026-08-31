<!--
 * @Author: KasperFan && kasperfan@outlook.com
 * @Date: 2026-08-27 18:55:51
 * @LastEditTime: 2026-08-27 18:58:56
 * @FilePath: /hspsi/README.md
 * @describes: This file is created for learning Code.
 * Copyright (c) 2026 by KasperFan in WFU, All Rights Reserved. 
-->
# 华溯管家

华溯管家是基于 Vue、NestJS、MySQL 与 Redis 的业务管理系统。项目采用 pnpm workspace 管理前端、后端和共享包。

## Docker 部署（推荐）

完整说明见 [deploy/docker/README.md](deploy/docker/README.md)。

连接现有指定数据库 `hspsi-dev-ai-02` 的最短启动步骤：

```bash
cp deploy/docker/.env.example .env.docker
# 编辑 .env.docker，填写数据库密码和 JWT 密钥
docker compose --env-file .env.docker up -d --build
```

默认访问地址：`http://127.0.0.1:8080`。

## 本地开发启动

环境要求：Node.js 20+、pnpm 11.9、MySQL 8、Redis 7。

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example apps/api/.env
# 编辑 apps/api/.env，数据库名必须为 hspsi-dev-ai-02
pnpm db:generate
pnpm dev
```

本地开发默认地址：

- Web：`http://127.0.0.1:5173`
- API：`http://127.0.0.1:8000/api`
- 健康检查：`http://127.0.0.1:8000/api/health`

## 构建与检查

```bash
pnpm typecheck
pnpm test
pnpm build
```

## 数据库约束

- 当前项目唯一指定业务数据库为 `hspsi-dev`；
- 禁止连接历史数据库进行开发、验证或部署；
- 正式部署前必须备份数据库；
- 不要将 `.env.docker`、数据库快照或真实密钥提交到 Git。
