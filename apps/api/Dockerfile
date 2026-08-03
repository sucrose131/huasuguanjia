FROM node:20-bookworm-slim AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.9.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --frozen-lockfile

COPY apps/api apps/api
COPY packages/contracts packages/contracts
RUN pnpm --filter @hspsi/api prisma:generate \
  && pnpm --filter @hspsi/api build

FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV API_PORT=8000
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma

USER node
WORKDIR /app/apps/api
EXPOSE 8000

CMD ["node", "dist/main.js"]
