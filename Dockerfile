# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY api/package.json api/
COPY api/prisma api/prisma
COPY api/prisma.config.ts api/
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN pnpm install --frozen-lockfile --filter @wikideck/api...
COPY packages/shared packages/shared
COPY api api
WORKDIR /repo/api
RUN pnpm exec prisma generate && pnpm build

FROM node:22-alpine AS run
ENV NODE_ENV=production PORT=3001 HOSTNAME=0.0.0.0
WORKDIR /repo
COPY --from=build --chown=node:node /repo/api/.next/standalone ./
COPY --from=build --chown=node:node /repo/api/.next/static ./api/.next/static
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/health >/dev/null || exit 1
CMD ["node", "api/server.js"]
