import { z } from 'zod';

export const paginationSchema = z.object({
  cursor: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type PaginationInput = z.infer<typeof paginationSchema>;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Cursor pagination helper: query `limit + 1` rows ordered by a stable key,
 * then pass them here. The cursor is the id of the last returned item.
 */
export function toPage<T extends { id: string }>(rows: T[], limit: number): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null };
}

/** Prisma args for cursor pagination (stable `id` tiebreak expected in orderBy). */
export function cursorArgs(p: PaginationInput): { take: number; skip?: number; cursor?: { id: string } } {
  return p.cursor ? { take: p.limit + 1, skip: 1, cursor: { id: p.cursor } } : { take: p.limit + 1 };
}
