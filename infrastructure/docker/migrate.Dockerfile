# One-shot migration runner: applies committed Prisma migrations, then exits.
#   docker build -f infrastructure/docker/migrate.Dockerfile -t gynx-migrate .
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/database/package.json packages/database/
RUN pnpm install --frozen-lockfile --filter @gynx/database
COPY packages/database packages/database
USER node
WORKDIR /app/packages/database
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]
