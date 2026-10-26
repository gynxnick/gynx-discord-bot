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

## Single-VPS install (recommended)

For one dedicated server (Ubuntu 22.04/24.04 or Debian 12, 2 GB RAM, 20 GB disk), the installer sets up everything: Docker, PostgreSQL, Redis, the bot, the worker, the dashboard, and HTTPS through Caddy with automatic Let's Encrypt certificates.

1. Point a DNS **A record** for the dashboard (e.g. `dash.gynx.gg`) at the server.
2. Put the code on the server, e.g. `git clone <your private repo> /opt/gynx` (or copy it: on Windows, `git archive --format=tar.gz -o gynx.tar.gz HEAD`, then `scp` it over and extract into `/opt/gynx`).
3. Run it:
   ```bash
   cd /opt/gynx
   sudo ./infrastructure/deployment/install.sh
   ```
   It asks for the Discord application ID, bot token, OAuth client ID/secret, server ID, dashboard domain and a Let's Encrypt email, then checks them live with Discord before building: the token and OAuth secret must be valid, both privileged intents enabled, and the bot already in your server (it pauses with the invite link until it is). It generates the database password, session secret, encryption key and GitHub webhook secret (for the [update feed](updates.md)), and stores everything in `/etc/gynx/gynx.env` (root-only). Re-running it keeps existing secrets.
4. Follow the printed steps: add the OAuth redirect, enable the two privileged intents, and invite the bot using the printed link (exact permissions, no Administrator).
5. Optional: the installer ends with the GitHub webhook settings (payload URL and secret) for the [update feed](updates.md). Show them again with `sudo gynx github-webhook`.

It also enables the `ufw` firewall (SSH, 80, 443 only; pass `--no-firewall` to skip), adds a 2 GB swap file on servers under 3 GB RAM, installs nightly database backups to `/var/backups/gynx` (kept 14 days), and installs the `gynx` command:

| Command                        | What it does                                                        |
| ------------------------------ | ------------------------------------------------------------------- |
| `gynx status`                  | Service health and the dashboard URL                                |
| `gynx logs [bot\|worker\|...]` | Follow logs                                                         |
| `gynx update`                  | `git pull`, backup, rebuild, migrate, restart, re-register commands |
| `gynx backup` / `gynx restore` | Database dump / restore (restore takes a safety backup first)       |
| `gynx config` → `gynx restart` | Edit settings in `/etc/gynx/gynx.env` and apply them                |
| `gynx set DISCORD_BOT_TOKEN`   | Change one setting (secrets hidden) and apply it immediately        |
| `gynx register-commands`       | Re-register slash commands                                          |
| `gynx github-webhook`          | Show the GitHub webhook settings (creates the secret if missing)    |
| `gynx psql`                    | Database shell                                                      |

Copy backups off the server regularly (e.g. `rsync` from `/var/backups/gynx`); a backup on the same disk doesn't protect against losing the server.

## Production topology (other platforms)

All processes run from **one image**, `infrastructure/docker/app.Dockerfile`, with different commands (see `infrastructure/deployment/docker-compose.prod.yml` for the exact ones):

| Service   | Command                                          | Replicas             | Notes                                                                                           |
| --------- | ------------------------------------------------ | -------------------- | ----------------------------------------------------------------------------------------------- |
| migrate   | `prisma migrate deploy` (in `packages/database`) | one-shot per release | Must succeed before the others roll out                                                         |
| bot       | `node apps/bot/dist/index.js`                    | **exactly 1**        | One gateway connection per token (no sharding needed at this guild size). Health `:8081/readyz` |
| worker    | `node apps/worker/dist/index.js`                 | 1–N                  | Safe to scale: jobs are claimed with `SKIP LOCKED`. Health `:8082/readyz`                       |
| dashboard | `next start -p 3000` (in `apps/dashboard`)       | 1–N                  | Stateless (sessions in Postgres). Behind HTTPS. Health `/api/health/ready`                      |

Dependencies:

- **PostgreSQL 15+**, managed or properly secured: TLS required (`?sslmode=require`), private network only, a dedicated app user with no superuser rights, automated backups.
- **Redis** (optional): only for shared rate limits when running more than one dashboard or bot instance. Private network, `requirepass`/ACL, TLS if crossing hosts.

### Configuration

- Set every variable from `.env.example` through the platform's secret manager. Production refuses to start without required values, and `DASHBOARD_URL` must be `https://`.
- Use different `SESSION_SECRET`, `ENCRYPTION_KEY`, bot token and database for each environment.
- `GITHUB_WEBHOOK_SECRET` (dashboard, optional) enables `POST /api/webhooks/github` for the [update feed](updates.md); without it the endpoint answers 503. Generate with `openssl rand -hex 32`. The reverse proxy must pass that path through (it is unauthenticated by session and verified by HMAC signature instead).
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
2. Build and tag the image (`git rev-parse --short HEAD`). On the single-VPS install, `gynx update` does steps 2–5.
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
