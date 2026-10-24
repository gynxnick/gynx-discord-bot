/**
 * Integration-test database bootstrap.
 *
 * - If TEST_DATABASE_URL is set (e.g. CI service container), it is used directly.
 * - Otherwise a throwaway PostgreSQL is started with `embedded-postgres`
 *   (real Postgres binaries, no Docker needed).
 *
 * Migrations are applied with `prisma migrate deploy`, so every test run also
 * verifies that the committed migrations build the schema from empty.
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import type { TestProject } from 'vitest/node';

/** Ask the OS for a free port so parallel test runs never collide. */
function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', rej);
    srv.listen(0, () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => res(port));
    });
  });
}
let stop: (() => Promise<void>) | undefined;

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  let url = process.env.TEST_DATABASE_URL;

  if (!url) {
    const { default: EmbeddedPostgres } = await import('embedded-postgres');
    const PORT = await freePort();
    const dir = mkdtempSync(join(tmpdir(), 'gynx-pg-'));
    const pg = new EmbeddedPostgres({
      databaseDir: dir,
      user: 'gynx',
      password: 'gynx-test-only',
      port: PORT,
      persistent: false,
      onLog: () => {},
      onError: () => {},
    });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('gynx_test');
    url = `postgresql://gynx:gynx-test-only@localhost:${PORT}/gynx_test`;
    stop = async () => {
      await pg.stop();
      rmSync(dir, { recursive: true, force: true });
    };
  }

  const dbPkg = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../packages/database');
  execSync('pnpm exec prisma migrate deploy', {
    cwd: dbPkg,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });

  project.provide('databaseUrl', url);

  return async () => {
    await stop?.();
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}
