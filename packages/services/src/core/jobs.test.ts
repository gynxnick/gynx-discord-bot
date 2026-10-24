import { describe, expect, it } from 'vitest';
import { Prisma, type Db } from '@gynx/database';
import { backoffMs, enqueueJob } from './jobs';

const uniqueViolation = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`dedupeKey`)', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target: ['dedupeKey'] },
  });

describe('enqueueJob', () => {
  it('returns the existing job when a concurrent worker inserted it first (P2002)', async () => {
    const existing = { id: 'job-1', dedupeKey: 'k' };
    const db = {
      scheduledJob: {
        upsert: async () => Promise.reject(uniqueViolation()),
        findUniqueOrThrow: async ({ where }: { where: { dedupeKey: string } }) =>
          where.dedupeKey === 'k' ? existing : Promise.reject(new Error('wrong key')),
      },
    } as unknown as Db;
    await expect(enqueueJob(db, { type: 't', dedupeKey: 'k', runAt: new Date() })).resolves.toBe(existing);
  });

  it('still surfaces other database errors', async () => {
    const db = {
      scheduledJob: { upsert: async () => Promise.reject(new Error('connection lost')) },
    } as unknown as Db;
    await expect(enqueueJob(db, { type: 't', dedupeKey: 'k', runAt: new Date() })).rejects.toThrow(
      'connection lost',
    );
  });
});

describe('backoffMs', () => {
  it('grows exponentially with jitter and is capped at one hour', () => {
    expect(backoffMs(1, () => 0)).toBe(15_000);
    expect(backoffMs(1, () => 1)).toBe(30_000);
    expect(backoffMs(3, () => 1)).toBe(120_000);
    expect(backoffMs(50, () => 1)).toBe(3_600_000);
  });
});
