# Architecture

## Overview

```text
                ┌──────────────┐  gateway (WS)   ┌──────────────┐
  Discord  ◀──▶ │  apps/bot    │ ───────────────▶│              │
                │  interactions│                 │              │
                │  + listeners │                 │  PostgreSQL  │
                └──────┬───────┘                 │  (Prisma)    │
                       │ @gynx/services          │              │
                ┌──────▼───────┐   REST only     │  ScheduledJob│
  Discord  ◀─── │ apps/worker  │ ◀── claims ──── │  = job queue │
                │ jobs+periodic│                 │              │
                └──────────────┘                 │              │
                ┌──────────────┐   REST (read)   │              │
  Browser  ◀──▶ │apps/dashboard│ ───────────────▶│              │
  (staff)       │ Next.js + API│                 └──────────────┘
                └──────────────┘        Redis (optional): shared rate limits
```

Three processes share one database and one service layer:

| Process | Responsibility | Talks to Discord via |
|---|---|---|
| `apps/bot` | Slash commands, buttons/selects/modals, gateway listeners (joins, messages for automod and activity counts, invites) | discord.js gateway + REST |
| `apps/worker` | Scheduled and background work: notifications, scheduled announcements, giveaway/poll endings, reminders, status checks, rollups, weekly reports, retention | `@discordjs/rest` only (no gateway) |
| `apps/dashboard` | Staff web UI and typed API routes (Discord OAuth2) | REST, read-mostly (members, roles, channels) |

Out of scope by design: game-server panel functions, billing, server control, and **support ticketing** (handled by an external support system; flows that escalate link to `GuildConfig.supportUrl`).

## Packages

| Package | Contents |
|---|---|
| `@gynx/config` | Zod-validated environment schemas per process (`loadEnv` fails fast and never echoes values). Pino logger with structural secret redaction. |
| `@gynx/shared` | `AppError` taxonomy, free-text secret redaction, AES-256-GCM secret envelope, SSRF guard (`resolveSafeTarget`), time-zone and scheduling helpers, cursor pagination, rate-limiter interface, brand tokens, text utilities, `secureSample`. Pure, no I/O except DNS in the SSRF guard. |
| `@gynx/permissions` | Permission keys, role presets, deny-wins evaluation, anti-escalation, central slash-command policy map. |
| `@gynx/database` | Prisma schema, migrations, client singleton, `nextSequence` (atomic human-readable refs), `ensureGuild`. |
| `@gynx/services` | All business logic. `core/` (context, authz, audit, config, job queue, Discord port, embeds, permissions, health, signed links) plus one folder per domain, exported as namespaces (`security.submitReport`, `status.getPublicStatus`, …). |

### Module boundaries

- **Services are Discord-agnostic.** They take a `Ctx` (db, logger, clock, rate limiter, optional `DiscordPort`, and the resolved `Actor`), validate input with Zod, enforce permissions, write audit events in the same transaction, and enqueue jobs for side effects.
- **Bot handlers are thin**: parse the interaction, call a service, render the reply. Gateway-only actions (e.g. applying a ban) follow *prepare → act → record*: the service validates and authorizes, the bot performs the Discord call, then the service records the outcome.
- **Worker handlers** call services with a system actor and use `DiscordPort` for delivery.
- **The dashboard** never queries the database from the browser. Server components and route handlers call services through `apiRoute()`, which handles session, CSRF, validation, permissions, rate limiting and error mapping.

## Request flow (bot)

1. `InteractionRouter` rejects interactions from other guilds or DMs.
2. The member is resolved into an `Actor` (`resolveActor`: roles → `StaffPermission` grants → permission set).
3. A global per-user rate limit applies, then the command's `COMMAND_POLICIES` entry: module enabled → per-command rate limit → required permission (denials audited).
4. The handler calls the service, which **re-checks** permissions and object-level access.
5. Errors: `AppError` messages are user-safe; anything else becomes a generic message with a correlation ID, and the full error is logged.

## Background jobs

`ScheduledJob` is a durable, idempotent queue in PostgreSQL:

- **Enqueue** by `dedupeKey` (unique), e.g. `announcement:<id>:v3`, `security.report.notify:<id>`. Re-enqueueing is a no-op, so retried callers can't duplicate work.
- **Claim** with `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)`, so concurrent workers never take the same job. Jobs stuck in `RUNNING` (crashed worker) are reclaimed after 10 minutes.
- **Retry**: retryable failures back off exponentially with jitter (30 s base, 1 h cap). Permanent failures (`VALIDATION`, `FORBIDDEN`, `INVALID_STATE`, `NOT_FOUND`) and exhausted retries go to `DEAD`, the dead-letter state, shown in Dashboard → Settings → Jobs with a manual retry.
- **Periodic tasks** are enqueued as `periodic:<name>:<bucket>`, where `bucket = floor(now / interval)`. Every worker instance may enqueue the bucket, but only one runs it. Tested with two concurrent runners.
- **Handlers are idempotent**: each checks persisted state before acting (e.g. `reporterNotifiedAt`, `resultsPublishedAt`, the announcement version), because a job can run twice if a worker dies after the side effect.

**Why not BullMQ?** Scheduled items must be editable and cancellable (announcements, maintenance windows) and auditable in the same database as the data they act on. A Postgres queue gives transactional enqueue (job and data commit together) and needs no extra infrastructure. Redis is optional and is only used for cross-instance rate limiting. If Redis is down, the rate limiter fails open; authorization never depends on Redis.

## Data model highlights

- Everything is scoped by `guildId`, so development and production guilds are isolated in the same schema.
- Human-readable references (`R-0001`, `INC-0001`, `M-0001`, `P-0001`) come from `GuildCounter` via an atomic upsert.
- All timestamps are stored in UTC (`timestamp(3)`). Raw SQL must convert explicitly (`::timestamptz AT TIME ZONE 'UTC'`); see `core/jobs.ts`.
- Unique constraints enforce one vote per poll ballot, one suggestion vote, one giveaway entry and one RSVP per user, plus delivery idempotency keys and one generated report per period.
- Privacy: raw diagnostic uploads are never stored (only redacted findings with an expiry). Message activity is stored as counts only, never content. Abuse-report descriptions are redacted on ingest.

## Metrics

Metric definitions live in code next to their calculators (`packages/services/src/analytics`) and are labelled in reports:

- Activity metrics are **observed message activity** only. Discord provides no views or impressions, and the bot never claims them.
- Unavailable data is reported as *Not available — reason*, never as zero.
- Period comparisons use equal-length previous periods; deltas against missing or zero baselines show `n/a`.
- Uptime % = successful checks / total checks in the window. With no checks it shows "no data", never 100%.
- Referral attribution is `CONFIRMED` only when exactly one tracked invite's use count changed. `AMBIGUOUS` and `UNKNOWN` joins are shown as such.

## Reliability

- Health endpoints: bot `:8081`, worker `:8082`, dashboard `/api/health/live|ready`. Liveness (`/livez`) is separate from readiness (`/readyz`, which checks the DB and the gateway or job loop).
- Graceful shutdown: stop the job loop and wait for in-flight jobs, close the gateway, disconnect Redis and Prisma.
- Discord rate limits are handled by `@discordjs/rest` (per-route buckets, `retry_after`) and logged.
- Optional integrations (AI provider, external status pages, Steam/Mojang version lookups) fail in isolation with honest "unavailable" output.
