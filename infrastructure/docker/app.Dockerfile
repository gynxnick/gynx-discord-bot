# One image for every process (bot, worker, dashboard, migrations).
# The whole workspace is installed and built once; each service in
# infrastructure/deployment/docker-compose.prod.yml runs a different command.
#
#   docker build -f infrastructure/docker/app.Dockerfile -t gynx-app .

FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# pnpm via corepack, cached in a world-readable location so the non-root
# runtime user never needs to download anything.
ENV COREPACK_HOME=/usr/local/share/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate && chmod -R a+rX /usr/local/share/corepack

WORKDIR /app

# Dependency layer: only manifests, so code changes don't reinstall packages.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/bot/package.json apps/bot/
COPY apps/worker/package.json apps/worker/
COPY apps/dashboard/package.json apps/dashboard/
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY packages/permissions/package.json packages/permissions/
COPY packages/database/package.json packages/database/
COPY packages/services/package.json packages/services/
COPY packages/database/prisma packages/database/prisma
RUN pnpm install --frozen-lockfile

COPY . .
# Next.js builds are memory hungry; cap the heap so small VPSes (2 GB + swap) succeed.
RUN NODE_OPTIONS=--max-old-space-size=1536 pnpm build \
  && chown -R node:node /app/apps/dashboard/.next

ENV NODE_ENV=production
USER node
# Each compose service sets its own command.
CMD ["node", "--enable-source-maps", "apps/bot/dist/index.js"]
