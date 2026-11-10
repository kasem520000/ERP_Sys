# syntax=docker/dockerfile:1
# Dev-stack image (docker-compose.yml services `api` + `worker`).
# PHASE-002: runtime entry is `tsx` — apps consume workspace TS source via
# transpilation (ADR-0002 consumption model; the tsc "build" is a strict type
# gate). Production bundling/slimming lands with the deployment phases
# (PHASE-014+).
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
RUN pnpm --filter @erp/api build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
RUN corepack enable
WORKDIR /repo
COPY --from=build /repo ./
EXPOSE 3001
CMD ["pnpm", "--filter", "@erp/api", "start"]
