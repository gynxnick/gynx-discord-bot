import type { Db, Prisma, PrismaClient } from '@gynx/database';
import { addDaysToKey } from './metrics';

/**
 * Privacy-preserving activity collection: only (date, channel) and (date, user)
 * message *counts* are stored — never message content, timestamps or IDs.
 */
export interface ActivityBatch {
  channels: Array<{ date: string; channelId: string; count: number }>;
  users: Array<{ date: string; userId: string; count: number }>;
}

const CHUNK = 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^\d{1,25}$/;

function aggregate(rows: Array<{ date: string; id: string; count: number }>) {
  const m = new Map<string, { date: string; id: string; count: number }>();
  for (const r of rows) {
    if (!(Number.isInteger(r.count) && r.count > 0 && DATE_RE.test(r.date) && ID_RE.test(r.id))) continue;
    const k = `${r.date}|${r.id}`;
    const e = m.get(k);
    if (e) e.count += r.count;
    else m.set(k, { ...r });
  }
  return [...m.values()];
}

/**
 * Add buffered counts in one transaction using INSERT … ON CONFLICT DO UPDATE
 * (messageCount = messageCount + EXCLUDED.messageCount), so concurrent flushes and
 * repeated flushes accumulate correctly.
 */
export async function flushActivity(db: PrismaClient, guildId: string, batch: ActivityBatch): Promise<{ channels: number; users: number }> {
  // Aggregate duplicates first: one INSERT cannot touch the same conflict row twice.
  const channels = aggregate(batch.channels.map((r) => ({ date: r.date, id: r.channelId, count: r.count }))).map((r) => ({ date: r.date, channelId: r.id, count: r.count }));
  const users = aggregate(batch.users.map((r) => ({ date: r.date, id: r.userId, count: r.count }))).map((r) => ({ date: r.date, userId: r.id, count: r.count }));
  if (channels.length === 0 && users.length === 0) return { channels: 0, users: 0 };

  const statements: Prisma.PrismaPromise<number>[] = [];
  for (let i = 0; i < channels.length; i += CHUNK) {
    const part = channels.slice(i, i + CHUNK);
    statements.push(db.$executeRaw`
      INSERT INTO "ChannelActivityDaily" ("guildId", "date", "channelId", "messageCount")
      SELECT ${guildId}, t.d, t.c, t.n
      FROM unnest(${part.map((r) => r.date)}::text[], ${part.map((r) => r.channelId)}::text[], ${part.map((r) => r.count)}::int[]) AS t(d, c, n)
      ON CONFLICT ("guildId", "date", "channelId")
      DO UPDATE SET "messageCount" = "ChannelActivityDaily"."messageCount" + EXCLUDED."messageCount"`);
  }
  for (let i = 0; i < users.length; i += CHUNK) {
    const part = users.slice(i, i + CHUNK);
    statements.push(db.$executeRaw`
      INSERT INTO "UserActivityDaily" ("guildId", "date", "userId", "messageCount")
      SELECT ${guildId}, t.d, t.u, t.n
      FROM unnest(${part.map((r) => r.date)}::text[], ${part.map((r) => r.userId)}::text[], ${part.map((r) => r.count)}::int[]) AS t(d, u, n)
      ON CONFLICT ("guildId", "date", "userId")
      DO UPDATE SET "messageCount" = "UserActivityDaily"."messageCount" + EXCLUDED."messageCount"`);
  }
  await db.$transaction(statements);
  return { channels: channels.length, users: users.length };
}

/** Record the latest member-count snapshot (from the gateway's guild.memberCount). */
export async function recordMemberCount(db: Db, guildId: string, memberCount: number, at: Date): Promise<void> {
  if (!Number.isInteger(memberCount) || memberCount < 0) return;
  await db.guild.updateMany({ where: { id: guildId }, data: { memberCount, memberCountAt: at } });
}

/** Retention: drop per-day activity rows older than `retentionDays` (date keys compare lexically). */
export async function purgeExpiredActivity(db: Db, guildId: string, todayKey: string, retentionDays: number): Promise<number> {
  const cutoff = addDaysToKey(todayKey, -Math.max(1, retentionDays));
  const [a, b] = await Promise.all([
    db.channelActivityDaily.deleteMany({ where: { guildId, date: { lt: cutoff } } }),
    db.userActivityDaily.deleteMany({ where: { guildId, date: { lt: cutoff } } }),
  ]);
  return a.count + b.count;
}
