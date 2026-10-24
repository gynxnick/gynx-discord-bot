import { Prisma, PrismaClient } from '@prisma/client';

export * from '@prisma/client';

/** Either the root client or an interactive-transaction client. */
export type Db = PrismaClient | Prisma.TransactionClient;

let singleton: PrismaClient | undefined;

/** Lazily-created shared client. Processes call `disconnectDb()` on graceful shutdown. */
export function getDb(): PrismaClient {
  if (!singleton) {
    singleton = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }
  return singleton;
}

export function createDb(url?: string): PrismaClient {
  return new PrismaClient(url ? { datasources: { db: { url } } } : undefined);
}

export async function disconnectDb(): Promise<void> {
  if (singleton) {
    await singleton.$disconnect();
    singleton = undefined;
  }
}

/**
 * Atomically increment and return a per-guild sequence (INSERT … ON CONFLICT DO UPDATE).
 * Used for human-readable references like T-0042.
 */
export async function nextSequence(db: Db, guildId: string, name: string): Promise<number> {
  const row = await db.guildCounter.upsert({
    where: { guildId_name: { guildId, name } },
    create: { guildId, name, value: 1 },
    update: { value: { increment: 1 } },
    select: { value: true },
  });
  return row.value;
}

/** Ensure the Guild + default config rows exist (idempotent). */
export async function ensureGuild(db: Db, guildId: string, name = 'Unknown guild'): Promise<void> {
  await db.guild.upsert({ where: { id: guildId }, create: { id: guildId, name }, update: {} });
  await db.guildConfig.upsert({ where: { guildId }, create: { guildId }, update: {} });
  await db.welcomeConfig.upsert({ where: { guildId }, create: { guildId }, update: {} });
  await db.automodConfig.upsert({ where: { guildId }, create: { guildId }, update: {} });
}

export const isUniqueViolation = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

export const isNotFoundError = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025';
