import { z } from 'zod';
import type { GuildConfig } from '@gynx/database';

/** Game key used by KB articles/flows/diagnostics (registry ids, or 'general'). */
export const gameKeySchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9-]{1,32}$/, 'Invalid game key');

/** Only expose https support links (they become Discord link buttons). */
export function supportUrlOf(cfg: Pick<GuildConfig, 'supportUrl'>): string | null {
  const u = cfg.supportUrl?.trim();
  if (!u) return null;
  try {
    return new URL(u).protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

/** Escalation copy. Tickets live in an external system — we only ever link to it. */
export function supportText(url: string | null): string {
  return url
    ? `Still stuck? Contact the support team: ${url}`
    : 'Still stuck? Please contact the support team.';
}
