# GYNX.GG Discord Bot

> **Source-available, not open source.** This code is published for transparency and security review only. Running, hosting, copying, modifying or redistributing it requires written permission from GYNX.GG. See [LICENSE](LICENSE). Report vulnerabilities privately: see [SECURITY.md](SECURITY.md).

The community, status, security and analytics platform for the **GYNX.GG** Discord server: a Discord bot, a background worker, and a staff web dashboard, sharing one typed service layer and PostgreSQL database.

> **Out of scope by design:** game-server panel functions, server control, billing and payments, and **support ticketing**. Support runs on GYNX's external support system; the bot links to it (`supportUrl`) wherever a member needs a human.

## Features

| Module               | What it does                                                                                                                                                                           | Key commands                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Status & incidents   | Read-only HTTP/TCP/Statuspage monitoring (SSRF-safe), failure/recovery thresholds, deduplicated alerts with cooldowns, incident lifecycle, maintenance windows, member subscriptions   | `/status` `/uptime` `/incidents` `/subscribe-status`                     |
| Community            | Welcome flow, rules acknowledgement, verification, anti-raid detection, safe self-assignable roles, searchable FAQ and guides                                                          | `/help` `/faq` `/guides` `/rules` `/roles`                               |
| Moderation           | Warnings, timeouts, kicks, (temp) bans with hierarchy checks; automod for spam, mentions, bursts, invites, blocked domains/phrases, phishing; escalation that never auto-bans; appeals | `/warn` `/warnings` `/timeout` `/kick` `/ban` `/appeal`                  |
| Security             | Private abuse reports with duplicate suppression, staff triage workflow, reporter privacy, full security audit log                                                                     | `/report-abuse` `/audit-log`                                             |
| Troubleshooting      | Curated knowledge base, guided decision-tree flows, Minecraft crash-log analysis with automatic secret/IP redaction (uploads never stored)                                             | `/troubleshoot` `/diagnose` `/knowledge-search`                          |
| Game utilities       | Minecraft, Rust, Palworld, Valheim, Garry's Mod: public info, latest versions, live player counts and port checks for authorized GYNX endpoints only                                   | `/gameinfo` `/version` `/playercount` `/minecraft` `/steam` `/portcheck` |
| Engagement           | Events with RSVP, capacity and waitlists; polls (single/multi, anonymous); suggestions board; giveaways with cryptographically secure, auditable draws                                 | `/event` `/poll` `/suggest` `/giveaway`                                  |
| Announcements        | Drafts, templates, previews, scheduled publishing in the guild time zone, at-most-once delivery, mass-mention confirmation, tracked links                                              | `/announce` `/schedule-announcement`                                     |
| Referrals & partners | Tracked invites with honest attribution (confirmed / ambiguous / unknown), abuse flags, leaderboards, partner applications and campaigns                                               | `/referral` `/partners`                                                  |
| Analytics            | Observed activity, growth, moderation, infrastructure and marketing metrics with period comparisons; automated weekly CEO report                                                       | `/analytics` `/staff-stats`                                              |
| Administration       | Per-guild configuration, module toggles, channels, roles, retention                                                                                                                    | `/config`                                                                |

The **dashboard** (Discord OAuth2, staff only) covers configuration, permissions, incidents and monitoring, moderation records and automod, abuse reports, the audit log, knowledge base and flows, announcements, events, polls, giveaways, referrals, partners, analytics and reports, plus dead-letter job recovery.

Full command reference: [docs/commands.md](docs/commands.md).

## Quick start (development)

Requirements: Node.js 22+ (24 recommended), pnpm 9 (`corepack enable`), Docker (or any PostgreSQL 15+).

```bash
pnpm install
cp .env.example .env                   # fill in Discord app + secrets (see docs/deployment.md)
docker compose up -d postgres redis
# in .env: DATABASE_URL=postgresql://gynx:gynx-dev-only@localhost:5432/gynx
pnpm db:migrate                        # apply migrations
pnpm commands:register                 # register slash commands in your dev guild
pnpm dev:bot                           # terminal 1
pnpm dev:worker                        # terminal 2
pnpm dev:dashboard                     # terminal 3 → http://localhost:3000
```

Then in Discord, as the server owner:

1. Run `/config view`, then set channels with `/config channel set`: for example kind _Status board_ → `#status`, _Security (private)_ → `#staff-security`, _CEO reports (private)_ → `#leadership`.
2. Run `/config support-url set url:https://…` to point at your support system.
3. In the dashboard, open **Settings → Permissions** and map your staff roles to presets (`SUPPORT_STAFF`, `MODERATOR`, …).
4. Open **Status → Services** and add the public services to monitor.
5. Open **Troubleshooting → Knowledge base → Load default GYNX content**.

## Checks

```bash
pnpm lint            # ESLint
pnpm format:check    # Prettier
pnpm typecheck       # tsc in every package
pnpm test            # unit + integration (integration starts a throwaway Postgres automatically)
pnpm build           # bot, worker (tsup) and dashboard (Next.js)
```

## Repository layout

```text
apps/bot          Discord gateway process: commands, components, listeners
apps/worker       Background jobs and periodic tasks (Postgres-backed queue)
apps/dashboard    Next.js staff dashboard + API routes
packages/services Business logic for every module (Discord-agnostic)
packages/database Prisma schema, migrations, client
packages/permissions  Permission keys, presets, command policies
packages/shared   Errors, redaction, crypto, SSRF guard, time zones, pagination
packages/config   Env validation, logger
infrastructure    Dockerfiles
docs              Architecture, commands, permissions, security, deployment, development
tests             Integration tests and helpers
```

## Documentation

- [Architecture](docs/architecture.md): processes, module boundaries, job queue, metric definitions
- [Commands](docs/commands.md): every slash command and option
- [Permissions](docs/permissions.md): the permission model and generated matrix
- [Security](docs/security.md): threat model, retention, credential rotation, incident response
- [Deployment](docs/deployment.md): Discord setup, production topology, releases, migrations, backups
- [Development](docs/development.md): conventions, adding features, testing
- [Release checklist](docs/release-checklist.md): first-release setup and known limitations

## License

GYNX.GG Source-Available License: you may read the code; you may not use it. See [LICENSE](LICENSE).
