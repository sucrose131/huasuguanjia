# 华溯管家 Docker 部署说明

## 1. 部署结构

系统采用两个容器角色，并依赖两个外部服务：

- `web`：Nginx 承载 Vue 静态文件，并将同域 `/api` 请求反向代理到后端；
- `api`：NestJS API，容器内监听 `8000`，映射到宿主机 `8001`；
- 外部 MySQL：由本编排之外的实例提供；
- 外部 Redis：版本 8 及以上，由本编排之外的实例提供。

MySQL 与 Redis 均不在本编排内创建容器，部署前请确认两者已就绪且对 Docker 网络可达。

## 2. 环境要求

- Docker Engine 24+；
- Docker Compose v2；
- 至少 2 核 CPU、4 GB 内存；
- 外部 MySQL 8.x，允许 Docker 网络访问 3306 端口；
- 外部 Redis 8+，允许 Docker 网络访问 6379 端口；

生产环境建议在本编排外层配置 HTTPS 网关或负载均衡器，仅对外开放 Web 端口（`8088`）；`api` 的 `8001` 端口已映射到宿主机，供调试与直连使用，生产环境建议通过防火墙限制外部访问。

> 端口说明：宿主机 `8080`/`8000`/`80` 通常已被其他服务占用，本编排固定使用 `8088`（web）和 `8001`（api）。如需修改，编辑 [compose.yaml](../../compose.yaml) 的 `ports` 段，并同步更新 `.env` 中的 `WEB_ORIGIN`。

## 3. 部署步骤

复制环境变量模板：

```bash
cp deploy/docker/.env.example .env
```

编辑 `.env`：

1. 将 `DATABASE_URL` 的密码替换为实际密码，确认 URL 最后的数据库名为 `hspsi-dev`；
2. 配置 `REDIS_URL` 指向外部 Redis 8+ 实例；
3. 生成并替换 `JWT_ACCESS_SECRET`；
4. 若访问端口不是 `8080`，同步修改 `APP_PORT` 和 `WEB_ORIGIN`。

当 MySQL 或 Redis 位于 Docker 宿主机时，主机名必须使用 `host.docker.internal`，不能使用 `127.0.0.1`：

```text
mysql://用户名:URL编码后的密码@host.docker.internal:3306/hspsi-dev
redis://host.docker.internal:6379/10
```

如 Redis 需要密码或指定 db，使用 `redis://[:password@]host:port[/db]` 格式。

启动：

```bash
docker compose up -d --build
```

访问：

- 系统：`http://服务器IP:8088`
- 健康检查：`http://服务器IP:8088/api/health`
- API 直连：`http://服务器IP:8001/api/health`

## 4. 常用运维命令

查看服务：

```bash
docker compose ps
```

查看日志：

```bash
docker compose logs -f --tail=200 web api
```

停止服务：

```bash
docker compose down
```

更新代码后重新构建：

```bash
docker compose up -d --build
```

仅重启 API：

```bash
docker compose restart api
```

## 5. 数据备份与恢复原则

- Redis 与 MySQL 的数据均由外部实例管理，备份与恢复在外部实例上进行；
- 不要将真实数据库密码、JWT 密钥或数据库快照提交到 Git；
- 删除 Docker 数据卷会永久删除容器内数据，正常停止或升级禁止执行 `docker compose down -v`；
- 当前项目没有可安全替代完整快照的 Prisma migration 历史，禁止在生产环境盲目执行 `prisma db push`。

## 6. 启动验收

```bash
curl -fsS http://127.0.0.1:8080/api/health
```

正常返回中应包含：

```json
{ "status": "up", "mysql": "up", "redis": "up" }
```

随后使用浏览器登录并抽查：基础资料、采购管理、生产管理、库存管理、销售管理、领用管理。若健康检查失败，先查看 `api` 日志，重点核对 `DATABASE_URL`、`REDIS_URL`、MySQL/Redis 网络可达性。
