# Bot and worker image. Build with:
#   docker build -f infrastructure/docker/node.Dockerfile --build-arg APP=bot -t gynx-bot .
#   docker build -f infrastructure/docker/node.Dockerfile --build-arg APP=worker -t gynx-worker .
# Workspace packages are bundled into dist/ by tsup; npm dependencies stay in node_modules.

FROM node:24-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

FROM base AS build
ARG APP
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/bot/package.json apps/bot/
COPY apps/worker/package.json apps/worker/
COPY apps/dashboard/package.json apps/dashboard/
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY packages/permissions/package.json packages/permissions/
COPY packages/database/package.json packages/database/
COPY packages/services/package.json packages/services/
RUN pnpm install --frozen-lockfile --filter "@gynx/${APP}..." --filter @gynx/database
COPY . .
RUN pnpm --filter @gynx/database generate && pnpm --filter "@gynx/${APP}" build

FROM base AS runtime
ARG APP
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/${APP}/node_modules ./apps/${APP}/node_modules
COPY --from=build /app/apps/${APP}/dist ./apps/${APP}/dist
COPY --from=build /app/apps/${APP}/package.json ./apps/${APP}/package.json
USER node
WORKDIR /app/apps/${APP}
CMD ["node", "--enable-source-maps", "dist/index.js"]
