# Release checklist and known limitations

## Before the first production release

### Single VPS

The installer covers most of this list: see [deployment.md → Single-VPS install](deployment.md#single-vps-install-recommended).

### Accounts and infrastructure (cannot be done from the repo)

- [ ] Create a **GitHub repository** (private) and push: `git remote add origin <url> && git push -u origin main`. CI (`.github/workflows/ci.yml`) runs on push and pull requests.
- [ ] Create **separate Discord applications** for development and production ([deployment.md](deployment.md#discord-application-setup-once-per-environment)). Enable the _Server Members_ and _Message Content_ privileged intents.
- [ ] Provision **PostgreSQL 15+** (TLS, private network, automated backups) and optionally **Redis**.
- [ ] Set all secrets from `.env.example` in the platform's secret manager (fresh `SESSION_SECRET`, `ENCRYPTION_KEY` per environment).
- [ ] Register the OAuth redirect `https://<dashboard-host>/api/auth/callback`.
- [ ] Put the dashboard behind HTTPS.

### First boot

- [ ] Run migrations (`migrate` image or `pnpm db:migrate`), then start worker → dashboard → bot.
- [ ] `pnpm commands:register` with production credentials.
- [ ] Invite the bot with the permissions in [security.md](security.md#discord-configuration-least-privilege). Place its role **below** staff roles and **above** self-assignable, verified and partner roles.
- [ ] As server owner: Dashboard → Settings → **Permissions**: map staff roles to presets.
- [ ] Dashboard → Settings → **General**: time zone, channels (live status board, status alerts, incidents, security, moderation log, reports, announcements, suggestions, events, partner review), roles (status alerts, partner, escalation), **support URL**.
- [ ] Create a read-only `#status` channel (members can view, only the bot can post) and set it as the **Live status board**. The bot posts one message there and keeps it updated automatically.
- [ ] Status → **Services**: add public services. Set `PORTCHECK_ALLOWED_SUFFIXES` (e.g. `gynx.gg`) to enable `/playercount`, `/minecraft` and `/portcheck`.
- [ ] Troubleshooting → **Load default GYNX content**, then review the articles.
- [ ] Community: welcome message, rules, verification role (gate channels on it in Discord), self-roles.
- [ ] Post a role panel in a read-only `#roles` channel (Community → Self-roles → **Post a panel**, or `/role-panel create`). It updates itself when you change the self-role list.
- [ ] Make a `#suggestions` channel and set it with `/config channel set` → **Suggestions**. Members just type there; each message becomes a voting card with a discussion thread. Give the bot **Manage Messages** and **Create Public Threads** there. A slowmode (e.g. 30 s) helps.
- [ ] Optional: reword anything the bot says in **Settings → Bot text**.
- [ ] Confirm the weekly report schedule (Analytics → Weekly reports → Schedules).

### Verification

- [ ] `pnpm install --frozen-lockfile && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build`
- [ ] Readiness: bot `:8081/readyz`, worker `:8082/readyz`, dashboard `/api/health/ready`
- [ ] Do a test restore of a backup ([deployment.md](deployment.md#backups-and-restore)).

## Known limitations

These are deliberate scope decisions or platform constraints, not defects.

**Platform / Discord**

- Discord exposes no message views or impressions. Engagement metrics are observed message counts, reactions, button use and tracked-link clicks only.
- Invite attribution is only `CONFIRMED` when exactly one tracked invite's use count changes. Vanity URLs, expired invites, or a missing _Manage Server_ permission produce `UNKNOWN`. The bot never guesses.
- `/portcheck` tests TCP reachability from the bot's network only. UDP game ports can't be verified this way.
- Palworld has no reliable public query protocol. Live data is shown only if the server answers Source A2S on its query port. Minecraft SRV records and split A2S packets are not followed.
- Steam provides no version number API: `/version` shows the latest official news post for Steam games.

**Product decisions**

- **No ticketing**: support runs on the external system. Escalations link to `supportUrl`.
- Accepting a timeout/ban **appeal** does not reverse it on Discord automatically. The dashboard tells staff to do it manually. There are no `/unban` or `/untimeout` commands, and the dashboard can't unban, because it has no gateway connection. Temporary bans and timeouts expire automatically through the worker.
- Ban appeals happen through the external support system (banned users can't run commands). The ban DM links to it.
- The **AI troubleshooting provider** is an interface with a no-op implementation. Provider settings can be stored (secret encrypted, write-only), but no AI requests are made in this release.
- Status uptime counts every check, including those during maintenance windows. Private (non-public) services have no uptime figures and never trigger public alerts or auto-incidents.
- Incident descriptions can't be edited after creation; changes are posted as updates. Resolved incidents are final.
- In-progress maintenance can't be cancelled, only ended early.

**Delivery guarantees** (documented trade-offs)

- Mass-notification paths are **at most once**: announcements (a pending delivery is never re-sent automatically; it goes to FAILED for a manual retry), giveaway winner announcements, and partner decision DMs.
- Other posts (status alerts, incident updates, report notifications, DM chunks) are **at least once**. A worker crash after Discord accepted a message but before the job completed can repost once. Incident messages are edited in place, so they never duplicate.
- Message-activity counters are flushed every 60 s. Up to about a minute of counts can be lost on an unclean bot shutdown.

**Dashboard**

- Staff stats show user IDs, not display names (no member lookup per row).
- Announcement previews show image URLs as placeholders, because the CSP blocks external images.
- Some list views filter within one page of results (past events, FAQ search in the dashboard, flows list capped at 25).
- The mass-mention warning can't show how many members a role has (the REST port has no member-count-by-role call).

**Tooling**

- The production image has not yet been built and run on a real Linux server from this repository's CI. The first `install.sh` run on the VPS is that test; watch `gynx logs` during it.
- Prisma is pinned to 6.x. Moving to Prisma 7 requires `prisma.config.ts` and driver adapters (planned upgrade, not urgent).
- The "one pending appeal per action" rule is enforced with a transaction-scoped advisory lock, not a partial unique index (Prisma can't express partial indexes without migration drift).

## Release procedure

See [deployment.md → Release procedure](deployment.md#release-procedure).
