# Development

## Prerequisites

- Node.js 22+ (`.nvmrc` pins 24), pnpm 9 (`corepack enable`).
- PostgreSQL for running the apps: `docker compose up -d postgres redis`, or any local Postgres.
- Integration tests need **no** local database. They start a throwaway PostgreSQL via `embedded-postgres` (real Postgres binaries, random port), or use `TEST_DATABASE_URL` if set (CI uses a service container).

## Commands

| Command                                           | What it does                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------- |
| `pnpm install`                                    | Install all workspace dependencies                                  |
| `pnpm dev:bot` / `dev:worker` / `dev:dashboard`   | Run a process with reload (reads `../../.env`)                      |
| `pnpm lint` / `pnpm format` / `pnpm format:check` | ESLint (flat config) / Prettier                                     |
| `pnpm typecheck`                                  | Prisma generate + `tsc --noEmit` in every package                   |
| `pnpm test`                                       | All tests (unit + integration)                                      |
| `pnpm test:unit` / `pnpm test:integration`        | One project only                                                    |
| `pnpm build`                                      | Build bot and worker (tsup bundles) and dashboard (Next standalone) |
| `pnpm db:migrate:dev --name x`                    | Create and apply a new migration (dev DB)                           |
| `pnpm db:migrate`                                 | Apply committed migrations (`migrate deploy`)                       |
| `pnpm commands:register`                          | Register guild slash commands                                       |
| `pnpm docs:permissions`                           | Regenerate the permission matrix in docs/permissions.md             |

## Layout

```text
apps/bot/src/framework     router, actor resolution, replies, command JSON
apps/bot/src/modules/<m>   one folder per feature module (commands, components, listeners)
apps/worker/src/framework  job runner (one-off + periodic)
apps/worker/src/jobs/<m>   job handlers + periodic tasks per module
apps/dashboard             Next.js app (UI + API routes)
packages/services/src/core shared service infrastructure
packages/services/src/<m>  domain logic per module
tests/integration          DB-backed tests + helpers
```

## Adding a feature (checklist)

1. **Schema**: edit `schema.prisma` → `pnpm db:migrate:dev --name <change>` → commit the migration.
2. **Permission**: add a key to `packages/permissions/src/keys.ts` (and presets) if needed. If you add a command, add its `COMMAND_POLICIES` entry, then run `pnpm docs:permissions`.
3. **Service** in `packages/services/src/<module>`: Zod schema, `requireModule`, `requirePermission` or an ownership check, transaction + `audit(..., tx)`, `enqueueJob` for Discord side effects.
4. **Bot**: a thin command or component in `apps/bot/src/modules/<module>`. Use `respond()` / `replyError()`; never ping by default.
5. **Worker**: an idempotent handler in `apps/worker/src/jobs/<module>.ts`.
6. **Tests**: unit tests for pure rules; integration tests for permissions, idempotency and security properties.
7. **Docs**: update `docs/commands.md` and anything else affected.

## Conventions

- TypeScript strict, ESM, `noUncheckedIndexedAccess`. No `any` in new code without a comment.
- Errors: throw `AppError` (`validation`, `forbidden`, `notFound`, `conflict`, `invalidState`, `rateLimited`). Messages must be safe to show users.
- Never log secrets or raw user content at info level. Pass objects to the logger (structured), not interpolated strings.
- customIds are `<prefix>:<action>:<args>` and never trusted: re-validate on submit.
- UTC everywhere; convert with `@gynx/shared` time helpers at the edges.
- Commit messages: imperative summary line, body explaining why.

## Windows notes

- `next build` creates the standalone server bundle (`output: 'standalone'`) only on Linux/macOS or when `DASHBOARD_STANDALONE=1` is set. On Windows, copying pnpm's symlinks needs Developer Mode or an admin shell. Docker builds (Linux) always produce it.
- The integration-test Postgres is initialised as UTF-8 regardless of the host code page.

## Testing notes

- `tests/integration/helpers.ts` provides `freshGuild()` (an isolated guild per test), `ctxAs(guildId, perms)`, `testDeps()` and `fakeDiscord()`, which records every side effect for assertions.
- Worker tests drive `JobRunner.tick(now)` directly, so you can control time and run the runner twice to prove idempotency.
- The first integration run downloads nothing extra: Postgres binaries come from the `@embedded-postgres/*` npm package.
