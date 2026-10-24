# Deployment

## Discord application setup (once per environment)

Use **separate applications and guilds for development and production.**

1. Create an application at <https://discord.com/developers/applications>.
2. **Bot** tab: create the bot, copy the token → `DISCORD_BOT_TOKEN`. Enable the privileged intents **Server Members** and **Message Content**.
3. **OAuth2** tab: copy the client ID/secret → `DISCORD_OAUTH_CLIENT_ID` / `DISCORD_OAUTH_CLIENT_SECRET`. Add the redirect `https://<dashboard-host>/api/auth/callback` (dev: `http://localhost:3000/api/auth/callback`).
4. Invite the bot with scopes `bot applications.commands` and the permissions listed in [security.md](security.md#discord-configuration-least-privilege). Put the bot's role **below** all staff roles.
5. Copy the guild ID → `DISCORD_GUILD_ID` and the application ID → `DISCORD_APPLICATION_ID`.
6. Register slash commands: `pnpm commands:register` (guild-scoped, instant). Re-run after adding or changing commands.

## Local development

See [development.md](development.md). Quick version:

```bash
pnpm install
cp .env.example .env            # fill in values
docker compose up -d postgres redis
# DATABASE_URL=postgresql://gynx:gynx-dev-only@localhost:5432/gynx
pnpm db:migrate
pnpm commands:register
pnpm dev:bot & pnpm dev:worker & pnpm dev:dashboard
```

## Production topology

Deploy **four** containers from this repo (any container platform; no cloud-specific assumptions):

| Service | Image | Replicas | Notes |
|---|---|---|---|
| migrate | `infrastructure/docker/migrate.Dockerfile` | one-shot per release | `prisma migrate deploy`; must succeed before the others roll out |
| bot | `node.Dockerfile --build-arg APP=bot` | **exactly 1** | One gateway connection per token (no sharding needed at this guild size). Health `:8081/readyz` |
| worker | `node.Dockerfile --build-arg APP=worker` | 1–N | Safe to scale: jobs are claimed with `SKIP LOCKED`. Health `:8082/readyz` |
| dashboard | `dashboard.Dockerfile` | 1–N | Stateless (sessions in Postgres). Behind HTTPS. Health `/api/health/ready` |

Dependencies:
- **PostgreSQL 15+**, managed or properly secured: TLS required (`?sslmode=require`), private network only, a dedicated app user with no superuser rights, automated backups.
- **Redis** (optional): only for shared rate limits when running more than one dashboard or bot instance. Private network, `requirepass`/ACL, TLS if crossing hosts.

### Configuration
- Set every variable from `.env.example` through the platform's secret manager. Production refuses to start without required values, and `DASHBOARD_URL` must be `https://`.
- Use different `SESSION_SECRET`, `ENCRYPTION_KEY`, bot token and database for each environment.
- Guild settings (channels, roles, modules, thresholds, retention, support URL) are configured after first boot via `/config` or Dashboard → Settings.

### Networking
- Only the dashboard is exposed publicly, behind a TLS-terminating reverse proxy or load balancer (HTTP→HTTPS redirect, HSTS). Health ports 8081/8082 stay internal.
- Outbound: Discord (`discord.com`, `gateway.discord.gg`, `cdn.discordapp.com`), configured monitoring targets, `piston-meta.mojang.com`, `api.steampowered.com`, and authorized game endpoints.
- Inbound to Postgres/Redis only from the app network.

### Resources and restarts
- Starting points: bot 256–512 MB, worker 256 MB, dashboard 512 MB. Set memory limits and `restart: unless-stopped` (or the platform equivalent).
- All processes handle `SIGTERM` gracefully. Allow a 30 s termination grace period so in-flight jobs finish.

### Logs and alerting
- Logs are JSON on stdout (Pino) with `component`, `level`, `correlationId`; secrets are redacted. Ship them with your platform's collector.
- Alert on: readiness failing for more than 5 min, `level>=50` (error) spikes, dead-lettered jobs (`SELECT count(*) FROM "ScheduledJob" WHERE status='DEAD'`), and Discord `rate limited` warnings.

## Release procedure

1. CI green on `main` (lint, format, typecheck, tests, build, audit).
2. Build and tag the images (`git rev-parse --short HEAD`).
3. Run **migrate** against production and wait for success.
4. Roll out worker → dashboard → bot (bot last, so commands only change once services are ready).
5. If commands changed, run `pnpm commands:register` with production credentials.
6. Watch readiness and error logs for 15 minutes.

### Database migrations
- Create migrations only in development: `pnpm db:migrate:dev --name <change>`. Commit `packages/database/prisma/migrations/*`.
- Prefer **expand → migrate → contract**: add nullable columns or new tables first, deploy code that writes both, backfill, then remove old columns in a later release. That keeps every release rollback-safe.
- Never use `prisma db push` or `migrate reset` against production.

### Rollback
- **Code**: redeploy the previous image tags. Safe as long as the last migration was additive (expand step).
- **Schema**: Prisma has no automatic down-migrations. Write a forward "revert" migration, or restore from backup if data was transformed destructively.
- Scheduled jobs are durable and keyed by version, so rolling back doesn't duplicate announcements.

## Backups and restore

- **Backups**: enable managed PITR, or run `pg_dump -Fc "$DATABASE_URL" > gynx-$(date +%F).dump` nightly to encrypted off-site storage. Keep 30 daily and 12 monthly.
- **Restore test (monthly)**:
  1. `createdb gynx_restore && pg_restore -d gynx_restore --no-owner gynx-YYYY-MM-DD.dump`
  2. `DATABASE_URL=<restore url> pnpm --filter @gynx/database migrate:status` should report no drift.
  3. Spot-check row counts (`Guild`, `AbuseReport`, `SecurityAuditEvent`, `ScheduledJob`).
  4. Record the date and duration of the test.
- **Recovery**: stop bot and worker (to avoid duplicate scheduled sends) → restore → run migrate → start worker → dashboard → bot. Jobs left `RUNNING` are reclaimed automatically.
