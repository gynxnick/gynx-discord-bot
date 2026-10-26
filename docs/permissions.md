# Permissions

Authorization is centralised in `@gynx/permissions` and enforced **server-side in every service function**. Hiding a Discord command or a dashboard button is a convenience, never a control.

## Model

- **Permission keys** (`packages/permissions/src/keys.ts`) are the only thing code checks, e.g. `incidents.manage`.
- **Grants** live in the `StaffPermission` table, per guild. A grant maps a subject (a Discord **role** or an individual **user**) to a key, a wildcard (`moderation.*`), or a **preset** (`SUPPORT_STAFF`, …), with effect `ALLOW` or `DENY`.
- No role IDs are hard-coded anywhere. Admins map roles to presets or keys in **Dashboard → Settings → Permissions**.

### Evaluation rules (`resolvePermissions`)

1. The Discord **guild owner** has every permission and cannot be denied.
2. Union all `ALLOW` grants for the member's roles and their user ID.
3. Any matching `DENY` removes the key. **Deny always wins.**
4. Unknown keys are ignored (fail closed). A member with no grants has no staff permissions (least privilege).

Permissions are resolved per interaction (bot) and refreshed every 5 minutes per dashboard session. Losing `dashboard.access`, or leaving the guild, revokes the session.

### Anti-escalation

- Changing grants requires `permissions.manage`, and you can only grant or deny keys you hold yourself.
- Privileged keys (🔒 below) can never be granted to the configured partner role.
- Self-assignable roles are validated against an allowlist. Roles with moderation or admin Discord permissions, managed roles, roles mapped to staff grants, and roles at or above the bot cannot be made self-assignable. The allowlist is re-checked at toggle time.
- Partner approval grants only `GuildConfig.partnerRoleId`, after the worker verifies that role has no privileged Discord permission bits.
- Moderation actions validate role hierarchy: you can't act on yourself, the owner, equal or higher roles, or roles above the bot.

### Recommended setup

| Discord role                  | Grant                                         |
| ----------------------------- | --------------------------------------------- |
| Owners / founders             | (guild owner is automatic) or `OWNER`         |
| Admins                        | `ADMINISTRATOR`                               |
| Senior staff                  | `SENIOR_STAFF`                                |
| Support team                  | `SUPPORT_STAFF`                               |
| Moderators                    | `MODERATOR`                                   |
| Marketing                     | `MARKETING_STAFF`                             |
| Analysts / leadership viewers | `ANALYST`                                     |
| Members                       | nothing (self-service commands need no grant) |

Use `DENY` for exceptions, e.g. a moderator who should not ban: `USER <id> moderation.ban DENY`.

## Generated reference

Regenerate with `pnpm docs:permissions` after changing keys, presets or command policies.

<!-- generated:start -->

### Permission keys by preset

| Key                             | Description                                                                  | Own | Adm | Snr | Sup | Mod | Mkt | Ana |
| ------------------------------- | ---------------------------------------------------------------------------- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `dashboard.access`              | Sign in to the web dashboard                                                 |  ✓  |  ✓  |  ✓  |  ✓  |  ✓  |  ✓  |  ✓  |
| `support.duty`                  | Go on and off support duty (shown on the public support status panel)        |  ✓  |  ✓  |  ✓  |  ✓  |     |     |     |
| `support.duty.manage`           | Approve public duty names and end other staff duty sessions                  |  ✓  |  ✓  |  ✓  |     |     |     |     |
| `incidents.view`                | View incidents and monitoring internals                                      |  ✓  |  ✓  |  ✓  |  ✓  |     |     |     |
| `incidents.manage`              | Create and update incidents and maintenance windows                          |  ✓  |  ✓  |  ✓  |     |     |     |     |
| `status.manage`                 | Configure monitored services, endpoints and thresholds                       |  ✓  |  ✓  |     |     |     |     |     |
| `updates.manage`                | Configure the GitHub update feed (tracked repositories, webhook deliveries)  |  ✓  |  ✓  |     |     |     |     |     |
| `moderation.execute`            | Warn, timeout and kick members                                               |  ✓  |  ✓  |  ✓  |     |  ✓  |     |     |
| `moderation.ban` 🔒             | Ban and unban members                                                        |  ✓  |  ✓  |  ✓  |     |     |     |     |
| `moderation.audit.view`         | View moderation records and moderator notes                                  |  ✓  |  ✓  |  ✓  |     |  ✓  |     |     |
| `automod.manage`                | Configure automod thresholds, blocked terms and domains                      |  ✓  |  ✓  |     |     |     |     |     |
| `security.reports.view`         | View abuse and security reports                                              |  ✓  |  ✓  |  ✓  |     |  ✓  |     |     |
| `security.reports.manage` 🔒    | Triage, investigate and resolve reports                                      |  ✓  |  ✓  |  ✓  |     |     |     |     |
| `audit.view` 🔒                 | View the security audit log                                                  |  ✓  |  ✓  |  ✓  |     |     |     |     |
| `community.manage`              | Edit welcome flow, self-roles, FAQs and guides                               |  ✓  |  ✓  |     |     |     |     |     |
| `suggestions.manage`            | Respond to and moderate suggestions                                          |  ✓  |  ✓  |  ✓  |     |  ✓  |     |     |
| `troubleshooting.manage`        | Edit knowledge base and troubleshooting flows                                |  ✓  |  ✓  |  ✓  |  ✓  |     |     |     |
| `events.manage`                 | Create and manage events                                                     |  ✓  |  ✓  |     |     |     |  ✓  |     |
| `polls.manage`                  | Create and close polls                                                       |  ✓  |  ✓  |     |     |     |  ✓  |     |
| `giveaways.manage`              | Create, end and reroll giveaways                                             |  ✓  |  ✓  |     |     |     |  ✓  |     |
| `announcements.create`          | Draft announcements                                                          |  ✓  |  ✓  |     |     |     |  ✓  |     |
| `announcements.publish`         | Publish and schedule announcements                                           |  ✓  |  ✓  |     |     |     |  ✓  |     |
| `announcements.mass_mention` 🔒 | Use @everyone/@here and role mentions in announcements                       |  ✓  |  ✓  |     |     |     |     |     |
| `referrals.view`                | View referral analytics                                                      |  ✓  |  ✓  |     |     |     |  ✓  |  ✓  |
| `referrals.manage`              | Create tracked invites and review attribution disputes                       |  ✓  |  ✓  |     |     |     |  ✓  |     |
| `partners.review`               | Review partner applications and campaigns                                    |  ✓  |  ✓  |     |     |     |  ✓  |     |
| `analytics.view`                | View analytics dashboards and weekly reports                                 |  ✓  |  ✓  |  ✓  |     |     |  ✓  |  ✓  |
| `analytics.export`              | Export analytics reports                                                     |  ✓  |  ✓  |     |     |     |     |  ✓  |
| `settings.manage` 🔒            | Change module, channel and integration settings                              |  ✓  |  ✓  |     |     |     |     |     |
| `permissions.manage` 🔒         | Change staff permissions                                                     |  ✓  |  ✓  |     |     |     |     |     |
| `setup.manage` 🔒               | Run the Discord server setup wizard (create roles, channels and permissions) |  ✓  |  ✓  |     |     |     |     |     |

Legend: Own = OWNER, Adm = ADMINISTRATOR, Snr = SENIOR_STAFF, Sup = SUPPORT_STAFF, Mod = MODERATOR, Mkt = MARKETING_STAFF, Ana = ANALYST. 🔒 = privileged (never grantable to the partner role).

### Slash command requirements

| Command                  | Required permission     | Discord default visibility | Rate limit (per user) |
| ------------------------ | ----------------------- | -------------------------- | --------------------- |
| `/about`                 | any member*             | everyone                   | 10 / 60s              |
| `/analytics`             | `analytics.view`        | ManageGuild                | —                     |
| `/announce`              | `announcements.publish` | ManageGuild                | —                     |
| `/appeal`                | any member*             | everyone                   | 2 / 3600s             |
| `/audit-log`             | `audit.view`            | ManageGuild                | —                     |
| `/ban`                   | `moderation.ban`        | BanMembers                 | —                     |
| `/config`                | `settings.manage`       | ManageGuild                | —                     |
| `/diagnose`              | any member*             | everyone                   | 3 / 300s              |
| `/duty`                  | `support.duty`          | ManageMessages             | 10 / 60s              |
| `/event`                 | any member*             | everyone                   | 10 / 60s              |
| `/faq`                   | any member*             | everyone                   | 15 / 60s              |
| `/gameinfo`              | any member*             | everyone                   | 10 / 60s              |
| `/giveaway`              | `giveaways.manage`      | ManageGuild                | —                     |
| `/guides`                | any member*             | everyone                   | 15 / 60s              |
| `/help`                  | any member*             | everyone                   | 10 / 60s              |
| `/incidents`             | any member*             | everyone                   | 10 / 60s              |
| `/kick`                  | `moderation.execute`    | KickMembers                | —                     |
| `/knowledge-search`      | any member*             | everyone                   | 15 / 60s              |
| `/minecraft`             | any member*             | everyone                   | 5 / 60s               |
| `/partners`              | any member*             | everyone                   | 3 / 600s              |
| `/playercount`           | any member*             | everyone                   | 5 / 60s               |
| `/poll`                  | `polls.manage`          | ManageMessages             | —                     |
| `/portcheck`             | any member*             | everyone                   | 3 / 300s              |
| `/referral`              | any member*             | everyone                   | 5 / 60s               |
| `/report-abuse`          | any member*             | everyone                   | 3 / 3600s             |
| `/role-panel`            | `community.manage`      | ManageGuild                | —                     |
| `/roles`                 | any member*             | everyone                   | 10 / 60s              |
| `/rules`                 | any member*             | everyone                   | 10 / 60s              |
| `/schedule-announcement` | `announcements.publish` | ManageGuild                | —                     |
| `/setup`                 | `setup.manage`          | ManageGuild                | 10 / 60s              |
| `/staff-stats`           | `analytics.view`        | ManageGuild                | —                     |
| `/status`                | any member*             | everyone                   | 10 / 60s              |
| `/steam`                 | any member*             | everyone                   | 5 / 60s               |
| `/subscribe-status`      | any member*             | everyone                   | 5 / 60s               |
| `/suggest`               | any member*             | everyone                   | 3 / 3600s             |
| `/timeout`               | `moderation.execute`    | ModerateMembers            | —                     |
| `/troubleshoot`          | any member*             | everyone                   | 10 / 60s              |
| `/uptime`                | any member*             | everyone                   | 10 / 60s              |
| `/version`               | any member*             | everyone                   | 10 / 60s              |
| `/warn`                  | `moderation.execute`    | ModerateMembers            | —                     |
| `/warnings`              | `moderation.audit.view` | ModerateMembers            | —                     |

\* Object-level checks still apply inside the service (e.g. only your own records; staff-only subcommands).
<!-- generated:end -->
