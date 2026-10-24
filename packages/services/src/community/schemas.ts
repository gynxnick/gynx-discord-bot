import { z } from 'zod';

export const snowflakeSchema = z.string().regex(/^\d{17,20}$/, 'Must be a Discord ID');

export const httpsUrlSchema = z
  .string()
  .trim()
  .max(500)
  .url()
  .refine((u) => /^https:\/\//i.test(u), 'Links must use https://');

export const linkSchema = z.object({
  label: z.string().trim().min(1).max(80),
  url: httpsUrlSchema,
});
export const linksSchema = z.array(linkSchema).max(5).default([]);
export type FaqLink = z.infer<typeof linkSchema>;

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and dashes')
  .max(60);

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export const SELF_ROLE_GROUPS = ['games', 'community', 'notifications'] as const;
export type SelfRoleGroup = (typeof SELF_ROLE_GROUPS)[number];

/** Parse stored `links` JSON defensively (only well-formed https links survive). */
export function parseLinks(raw: unknown): FaqLink[] {
  const r = z.array(linkSchema).safeParse(raw);
  return r.success ? r.data : [];
}

/** 1-based offset pagination for ranked results. */
export const pageSchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(25).default(5),
});

export interface OffsetPage<T> {
  items: T[];
  total: number;
  page: number;
  pageCount: number;
}

export function toOffsetPage<T>(all: readonly T[], page: number, pageSize: number): OffsetPage<T> {
  const pageCount = Math.max(1, Math.ceil(all.length / pageSize));
  const p = Math.min(page, pageCount);
  return { items: all.slice((p - 1) * pageSize, p * pageSize), total: all.length, page: p, pageCount };
}
