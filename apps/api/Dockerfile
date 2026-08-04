FROM node:22-bookworm-slim AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.9.0 --activate \
  && pnpm config set registry https://registry.npmmirror.com

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile

COPY apps/api apps/api
RUN pnpm --filter @hspsi/api prisma:generate \
  && pnpm --filter @hspsi/api build

# 仅安装生产依赖，剥离 devDependencies
RUN CI=true pnpm --filter @hspsi/api install --prod --no-frozen-lockfile

FROM node:22-bookworm-slim AS runtime

# 安装 OpenSSL 1.1 兼容库（Prisma 5.22 引擎依赖）
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates wget gnupg \
  && echo "deb http://archive.debian.org/debian bullseye main" > /etc/apt/sources.list.d/bullseye.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends libssl1.1 \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV API_PORT=8000
WORKDIR /app

COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=node:node /app/apps/api/prisma ./apps/api/prisma

USER node
WORKDIR /app/apps/api
EXPOSE 8000

CMD ["node", "dist/main.js"]
