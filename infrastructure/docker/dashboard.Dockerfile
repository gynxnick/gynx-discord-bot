# Dashboard image (Next.js standalone output).
#   docker build -f infrastructure/docker/dashboard.Dockerfile -t gynx-dashboard .

FROM node:24-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/bot/package.json apps/bot/
COPY apps/worker/package.json apps/worker/
COPY apps/dashboard/package.json apps/dashboard/
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY packages/permissions/package.json packages/permissions/
COPY packages/database/package.json packages/database/
COPY packages/services/package.json packages/services/
RUN pnpm install --frozen-lockfile --filter "@gynx/dashboard..." --filter @gynx/database
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @gynx/database generate && pnpm --filter @gynx/dashboard build

FROM base AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /app/apps/dashboard/.next/standalone ./
COPY --from=build /app/apps/dashboard/.next/static ./apps/dashboard/.next/static
COPY --from=build /app/apps/dashboard/public ./apps/dashboard/public
USER node
EXPOSE 3000
CMD ["node", "apps/dashboard/server.js"]
