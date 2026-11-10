# syntax=docker/dockerfile:1
# PHASE-001 dev-stack image (docker-compose.yml service `web`).
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/desktop apps/desktop
COPY apps/mobile apps/mobile
COPY packages/domain-core/package.json packages/domain-core/
COPY packages/contracts/package.json packages/contracts/
COPY packages/config/package.json packages/config/
COPY packages/ui packages/ui
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @erp/web build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo ./
EXPOSE 3000
CMD ["pnpm", "--filter", "@erp/web", "start"]
