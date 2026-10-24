# Security

Security is a core feature of this project. This document covers the threat model, the controls in place, and the operational procedures.

## Assets

| Asset                                      | Where                         | Protection                                                                                          |
| ------------------------------------------ | ----------------------------- | --------------------------------------------------------------------------------------------------- |
| Discord bot token                          | env `DISCORD_BOT_TOKEN`       | Secret manager / env only; never logged (Pino redaction + free-text redaction); rotate on suspicion |
| OAuth client secret                        | env                           | Used only server-side in the token exchange                                                         |
| Session tokens                             | browser cookie `gynx_session` | Random 256-bit, HttpOnly, Secure (prod), SameSite=Lax; only the SHA-256 is stored                   |
| Integration secrets (AI, status providers) | `IntegrationConfig.secretEnc` | AES-256-GCM with `ENCRYPTION_KEY`; never returned to the UI after save                              |
| Abuse reports, moderator notes, audit log  | DB                            | Permission-gated, retention-limited, reporter identity hidden from view-only staff                  |
| Member activity                            | DB (counts only)              | No message content stored; retention-limited                                                        |

## Threat model and controls

| Threat                                                              | Controls                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Privilege escalation via Discord roles                              | Central permission keys with deny-wins evaluation. Grants require `permissions.manage` and holding the key yourself. Self-roles are allowlisted and checked for dangerous permission bits and hierarchy. The partner role is checked for privileged bits before granting. Moderation hierarchy checks.                                                                                                                                                                                                          |
| Bypassing the UI to call APIs                                       | Every service re-checks permissions and object ownership. Dashboard route handlers go through `apiRoute()`. Bot commands go through the router policy and then the service.                                                                                                                                                                                                                                                                                                                                     |
| CSRF on dashboard mutations                                         | Per-session CSRF token header, plus Origin/Referer must match `DASHBOARD_URL`. SameSite=Lax cookies.                                                                                                                                                                                                                                                                                                                                                                                                            |
| OAuth attacks                                                       | `state` and PKCE (S256) stored in a short-lived signed HttpOnly cookie and compared in constant time. `identify` scope only. The access token is discarded right after the identity lookup. Guild membership and `dashboard.access` are required.                                                                                                                                                                                                                                                               |
| Session theft / staleness                                           | Only the token hash is stored. TTL (default 12 h). Server-side revocation on logout. Permissions refresh every 5 minutes, and the session is revoked if the member leaves or loses access.                                                                                                                                                                                                                                                                                                                      |
| SSRF / network scanning (`/portcheck`, game queries, health checks) | `resolveSafeTarget`: hostname validation, blocked names (`localhost`, `*.internal`, metadata), every resolved address checked against private, loopback, link-local, CGNAT, multicast, reserved, IPv4-mapped and NAT64 ranges. The connection is pinned to the validated IP (no DNS rebinding). Authorized-suffix allowlist (`PORTCHECK_ALLOWED_SUFFIXES`). Strict timeouts and per-user rate limits. Private monitoring targets need explicit `allowPrivate`, which requires `settings.manage` and is audited. |
| Malicious uploads (`/diagnose`)                                     | Only `.txt`/`.log`, max 1 MB, Discord CDN URLs only, binary rejection, streamed size cap, processed in memory, never executed, redacted before analysis. Only redacted findings are kept, with an expiry.                                                                                                                                                                                                                                                                                                       |
| Secret leakage in logs, transcripts, reports                        | Pino path redaction (tokens, cookies, authorization, codes). `redactSecrets` on stored free text (Discord tokens, JWTs, cloud keys, private keys, `key=value` credentials incl. `rcon.password`, URL credentials, webhooks, emails, IPs). `redactObject` on all audit metadata.                                                                                                                                                                                                                                 |
| Spam and abuse of bot features                                      | Global and per-command rate limits. Report duplicate suppression and an open-report cap. Automod with escalating, never-ban actions. Mass mentions need `announcements.mass_mention` plus an explicit confirmation. Bot messages default to `allowed_mentions: none`.                                                                                                                                                                                                                                           |
| Unfair giveaways / vote stuffing                                    | DB unique constraints per user. Crypto-secure Fisher–Yates draw. Entrant-set SHA-256 and algorithm stored per draw. Rerolls require a reason and are audited.                                                                                                                                                                                                                                                                                                                                                   |
| Publishing sensitive allegations                                    | Reports and evidence go only to the private `securityChannelId` and the dashboard. Reporter identity is omitted from notifications. Reports never trigger automatic punishment.                                                                                                                                                                                                                                                                                                                                 |
| Exposing infrastructure details                                     | Public status output is a projection without targets, ports, IPs or error text. Health-check errors are stored as sanitised categories only.                                                                                                                                                                                                                                                                                                                                                                    |
| XSS / injection in the dashboard                                    | React escaping, strict CSP, Zod validation on every input, Prisma parameterised queries (raw SQL uses tagged templates only).                                                                                                                                                                                                                                                                                                                                                                                   |

## Discord configuration (least privilege)

**Gateway intents:** `Guilds`, `GuildMembers` (privileged, for onboarding, raid detection and attribution), `GuildMessages`, `MessageContent` (privileged, for automod), `GuildModeration`, `GuildInvites` (referral attribution), `GuildMessageReactions`.

**Bot permissions** to grant on invite: View Channels, Send Messages, Embed Links, Attach Files, Read Message History, Manage Messages (automod deletes), Moderate Members (timeouts), Kick Members, Ban Members, Manage Roles (self-roles, verification, partner role; keep the bot's role _below_ staff roles), Create Instant Invite and Manage Server (invite tracking reads guild invites). Do **not** grant Administrator.

The bot rejects interactions from any guild other than `DISCORD_GUILD_ID`, and from DMs.

## Data retention (per guild, configurable in the dashboard)

| Data                                       | Default                                            | Enforced by                         |
| ------------------------------------------ | -------------------------------------------------- | ----------------------------------- |
| Closed abuse reports + notes               | 365 days                                           | `security.retention`                |
| Audit events                               | 730 days                                           | `security.retention`                |
| Diagnostic excerpts                        | 24 hours (findings summary deleted after +30 days) | `troubleshooting` retention task    |
| Health checks                              | 30 days                                            | `status` retention task             |
| Message activity counts, join/leave events | 120 days                                           | community/analytics retention tasks |
| Finished jobs / dead letters               | 7 / 30 days                                        | `core.housekeeping`                 |
| Expired / revoked dashboard sessions       | on expiry                                          | `core.housekeeping`                 |

## Operational procedures

### Credential rotation

1. **Bot token**: Developer Portal → Bot → Reset Token → update the secret store → restart bot, worker and dashboard. Old token is invalid immediately.
2. **OAuth client secret**: reset in the portal → update → restart the dashboard. Existing sessions stay valid (they don't depend on the secret).
3. **SESSION_SECRET**: rotate and restart the dashboard. In-flight OAuth logins fail (users retry). To force logout of everyone, run `UPDATE "DashboardSession" SET "revokedAt" = now();`.
4. **ENCRYPTION_KEY**: re-encrypt `IntegrationConfig.secretEnc` values (decrypt with the old key, encrypt with the new key) in a maintenance window, or re-enter integration secrets in the dashboard after rotation.
5. **Database password**: create a new user/password, update `DATABASE_URL`, restart, then drop the old credential.

### Incident response

1. **Contain**: rotate the affected credential. Disable the affected module (`/config module disable`, or Dashboard → Settings). Revoke dashboard sessions if staff accounts are involved.
2. **Investigate**: Dashboard → Security → Audit log (filter by actor/action); structured logs by `correlationId`.
3. **Recover**: restore from backup if data was tampered with (see deployment.md). Re-enable modules.
4. **Review**: document root cause and follow-ups. Notify affected members if personal data was exposed, as legally required.

### Dependency hygiene

`pnpm audit --prod --audit-level high` runs in CI and fails the build on new high-severity advisories. Dependencies are pinned through `pnpm-lock.yaml`. Upgrade intentionally, not with floating `latest`.

**Overrides** (`package.json` → `pnpm.overrides`): `postcss` is forced to `^8.5.23` because Next.js 15 pins a vulnerable 8.4.x. It only processes our own stylesheets at build time.

**Accepted advisories** (`pnpm.auditConfig.ignoreGhsas`), reviewed 2026-10-24. Revisit whenever Prisma or Zod is upgraded:

| Advisory            | Package                                                 | Why it is not exploitable here                                                                                                                                                                           | Exit plan                                                                 |
| ------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| GHSA-ggr8-5vv4-36mx | `deepmerge-ts` < 8 (via the Prisma CLI's config loader) | Only merges Prisma's own static configuration; no untrusted input ever reaches it                                                                                                                        | Removed when upgrading to a Prisma release that depends on deepmerge-ts 8 |
| GHSA-mrhx-c7xc-m3w5 | `zod` < 4.6.6                                           | Memory exhaustion needs a huge array in validated input. Dashboard API bodies are capped at 64 KB (`MAX_BODY_BYTES`), array schemas on user input carry `.max()`, and Discord bounds all bot input sizes | Migrate to Zod 4 (API changes across all schemas)                         |
