# DEV 环境登录 400（JWT 过大）缺陷修复实施记录（2026-08-19）

## 一、现象

DEV 外网环境（经 APISIX 网关）登录陈素梅账号报 `400 Request Header Or Cookie Too Large`（openresty/APISIX 返回，非应用错误）。本地直连 API 不出现。

## 二、根因

JWT token 过大：`auth.service.ts` 登录时将完整 `authUser` 塞进 token，其中 `permissions`（267 个权限字符串）+ `authorizedOrganizations`（13 个授权组织）使 token 长达 **10683 字符**，Authorization 头超出 APISIX 默认 header 大小限制。

## 三、修复（JWT 瘦身）

`apps/api/src/auth/auth.service.ts` 的 `login()`：JWT payload 只保留最小必要字段（id/username/orgId/orgName/deptId/staffId/positionId/positionName/roleName/currentOrgId/currentOrgName/isSuperAdmin/sid），去掉 `permissions` 与 `authorizedOrganizations`。

**安全性依据**（改动前核对）：
- `AuthGuard` 解码 JWT 后不直接用 payload，而是 `resolveSession(payload.sid, payload.id)` 经 Redis 会话 + 每次现查 `sessionData()` 组装完整用户（含 permissions/授权组织）挂到 `request.user`；
- 权限校验（PermissionGuard）、组织数据范围（DataScope 拦截器）均读取 `request.user`（现查结果），不依赖 JWT 内字段；
- 前端仅把 token 作为 Bearer 发送，无任何 JWT decode 依赖；
- 登录响应 `user`（完整 authUser）仍原样返回前端，前端功能不受影响。

## 四、验证

| 项 | 结果 |
|---|---|
| API typecheck | 无新增错误 |
| 实际 token 大小对比（陈素梅 payload 复算） | 10683 → 约 588 字符（-95%） |
| 权限/数据范围链路 | 不变（均由 resolveSession 现查） |

## 五、遗留

- APISIX/nginx 侧 header 限制建议同时调大（如 `large_client_header_buffers`/`http_header_max_size` ≥ 16k）作为兜底，但非必需（token 已瘦身）。
- 已签发的旧大 token 在登录过期后自然失效；重新登录即得小 token。

## 六、Git

- 分支：`refactor/0819-split-generic-pages`
- 提交号：待授权提交后回填。
