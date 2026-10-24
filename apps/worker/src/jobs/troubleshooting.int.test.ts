import { randomInt } from 'node:crypto';
import { ensureGuild } from '@gynx/database';
import { afterAll, describe, expect, it } from 'vitest';
import type { WorkerEnv } from '@gynx/config';
import { troubleshooting } from '@gynx/services';
import { ctxAs, silentLog, snowflake, testDb, testDeps } from '../../../../tests/integration/helpers';
import type { WorkerCtx } from '../framework/types';
import { troubleshootingJobs } from './troubleshooting';

/** helpers.snowflake() is only unique per worker; a random guild id keeps parallel test files from colliding. */
async function freshGuild(): Promise<string> {
  const id = `9${String(randomInt(1e9)).padStart(9, '0')}${String(randomInt(1e9)).padStart(9, '0')}`;
  await ensureGuild(testDb(), id, `Test Guild ${id}`);
  return id;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('troubleshooting worker retention', () => {
  afterAll(async () => {
    await testDb().$disconnect();
  });

  it('purges expired diagnostic excerpts, deletes them 30 days later, and abandons idle sessions (idempotent)', async () => {
    const guildId = await freshGuild();
    const db = testDb();
    const now = new Date('2026-03-01T12:00:00Z');
    const findings = [
      {
        id: 'mc-eula',
        title: 'EULA',
        confidence: 'likely',
        explanation: 'x',
        evidence: 'You need to agree to the EULA',
      },
    ];
    const base = {
      guildId,
      userId: snowflake(),
      game: 'minecraft',
      fileName: 'latest.log',
      fileSize: 100,
      findings,
      redactedExcerpt: 'redacted log excerpt',
    };

    const fresh = await db.diagnosticRecord.create({
      data: { ...base, expiresAt: new Date(now.getTime() + HOUR) },
    });
    const expired = await db.diagnosticRecord.create({
      data: { ...base, expiresAt: new Date(now.getTime() - HOUR) },
    });
    const ancient = await db.diagnosticRecord.create({
      data: { ...base, expiresAt: new Date(now.getTime() - 31 * DAY) },
    });

    const staff = ctxAs(guildId, ['troubleshooting.manage']);
    await troubleshooting.seedDefaultContent(staff);
    const member = ctxAs(guildId);
    const idle = await troubleshooting.startSession(member, 'rust-cant-find-server');
    const active = await troubleshooting.startSession(member, 'gmod-missing-content');
    await db.$executeRaw`UPDATE "TroubleshootingSession" SET "updatedAt" = NOW() - INTERVAL '3 days' WHERE "id" = ${idle.sessionId}`;

    const w = {
      deps: testDeps(),
      env: { DISCORD_GUILD_ID: guildId } as WorkerEnv,
      log: silentLog,
      workerId: 't',
    } as WorkerCtx;
    const task = troubleshootingJobs.periodic!.find((t) => t.name === 'troubleshooting.retention')!;
    await task.run(w, now);
    await task.run(w, now); // idempotent

    const f = await db.diagnosticRecord.findUniqueOrThrow({ where: { id: fresh.id } });
    expect(f.redactedExcerpt).toBe('redacted log excerpt');
    expect(f.purgedAt).toBeNull();

    const e = await db.diagnosticRecord.findUniqueOrThrow({ where: { id: expired.id } });
    expect(e.redactedExcerpt).toBeNull();
    expect(e.purgedAt?.toISOString()).toBe(now.toISOString());
    expect(e.findings).toEqual([{ id: 'mc-eula', title: 'EULA', confidence: 'likely', explanation: 'x' }]); // evidence stripped

    expect(await db.diagnosticRecord.findUnique({ where: { id: ancient.id } })).toBeNull();

    // Session idleness uses real updatedAt timestamps, so evaluate against the real clock.
    await task.run(w, new Date());
    expect(
      (await db.troubleshootingSession.findUniqueOrThrow({ where: { id: idle.sessionId } })).outcome,
    ).toBe('ABANDONED');
    expect(
      (await db.troubleshootingSession.findUniqueOrThrow({ where: { id: active.sessionId } })).outcome,
    ).toBe('IN_PROGRESS');
    await expect(troubleshooting.chooseOption(member, idle.sessionId, 0)).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
  });
});
