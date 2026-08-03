# 华溯管家 Docker 部署说明

## 1. 部署结构

系统采用四个运行角色：

- `web`：Nginx 承载 Vue 静态文件，并将同域 `/api` 请求反向代理到后端；
- `api`：NestJS API，容器内监听 `8000`；
- `redis`：Redis 7，启用 AOF 持久化；
- `mysql`：默认不由本项目创建，直接连接指定数据库 `hspsi-dev-ai-02`。如需 MySQL 一并容器化，使用叠加编排文件。

所有业务数据库连接必须指向 `hspsi-dev-ai-02`，不得替换为历史数据库名称。

## 2. 环境要求

- Docker Engine 24+；
- Docker Compose v2；
- 至少 2 核 CPU、4 GB 内存；
- 若连接宿主机 MySQL，必须允许 Docker 网络访问 MySQL 3306 端口；
- 部署前备份 `hspsi-dev-ai-02`。

生产环境建议在本编排外层配置 HTTPS 网关或负载均衡器，并仅对外开放 Web 端口。

## 3. 推荐部署：复用现有 MySQL

该方式保留当前数据库中的真实业务数据，风险最低。

```bash
cp deploy/docker/.env.example .env.docker
```

编辑 `.env.docker`：

1. 将 `DATABASE_URL` 的密码替换为实际密码；
2. 确认 URL 最后的数据库名为 `hspsi-dev-ai-02`；
3. 生成并替换 `JWT_ACCESS_SECRET`；
4. 若访问端口不是 `8080`，同步修改 `APP_PORT` 和 `WEB_ORIGIN`。

当 MySQL 位于 Docker 宿主机时使用：

```text
mysql://用户名:URL编码后的密码@host.docker.internal:3306/hspsi-dev-ai-02
```

启动：

```bash
docker compose --env-file .env.docker up -d --build
```

访问：

- 系统：`http://服务器IP:8080`
- 健康检查：`http://服务器IP:8080/api/health`

## 4. 可选部署：MySQL 也运行在 Docker

先从当前指定数据库导出完整快照。不要使用旧库 SQL，也不要使用仓库中历史基线文件代替当前快照。

```bash
mysqldump \
  -h 127.0.0.1 -P 3306 -u root -p \
  --single-transaction --routines --triggers \
  --default-character-set=utf8mb4 \
  hspsi-dev-ai-02 \
  > deploy/docker/initdb/01_hspsi-dev-ai-02.sql
```

确认 `.env.docker` 中已设置 `MYSQL_ROOT_PASSWORD`、`MYSQL_USER`、`MYSQL_PASSWORD`，然后启动：

```bash
docker compose \
  -f compose.yaml \
  -f compose.mysql.yaml \
  --env-file .env.docker \
  up -d --build
```

初始化 SQL 仅在 `mysql_data` 数据卷第一次创建时执行。已有数据卷不会重复导入，升级时也不要通过删除数据卷来更新数据库。

## 5. 常用运维命令

查看服务：

```bash
docker compose --env-file .env.docker ps
```

查看日志：

```bash
docker compose --env-file .env.docker logs -f --tail=200 web api redis
```

停止服务但保留数据：

```bash
docker compose --env-file .env.docker down
```

更新代码后重新构建：

```bash
docker compose --env-file .env.docker up -d --build
```

仅重启 API：

```bash
docker compose --env-file .env.docker restart api
```

## 6. 数据备份与恢复原则

- 数据库备份对象只能是 `hspsi-dev-ai-02`；
- Redis 数据位于 Docker 卷 `redis_data`，MySQL 容器方式的数据位于 `mysql_data`；
- 不要将真实数据库密码、JWT 密钥或数据库快照提交到 Git；
- `deploy/docker/initdb/*.sql` 已被 Git 忽略；
- 删除 Docker 数据卷会永久删除容器内数据，正常停止或升级禁止执行 `docker compose down -v`；
- 当前项目没有可安全替代完整快照的 Prisma migration 历史，禁止在生产环境盲目执行 `prisma db push`。

## 7. 启动验收

```bash
curl -fsS http://127.0.0.1:8080/api/health
```

正常返回中应包含：

```json
{ "status": "up", "mysql": "up", "redis": "up" }
```

随后使用浏览器登录并抽查：基础资料、采购管理、生产管理、库存管理、销售管理、领用管理。若健康检查失败，先查看 `api` 日志，重点核对 `DATABASE_URL`、MySQL 网络权限和 Redis 状态。
