import type { DiscordPort } from '@gynx/services';
import { AppError } from '@gynx/shared';

/** Discord channel types the pickers offer (GUILD_TEXT, GUILD_CATEGORY, GUILD_ANNOUNCEMENT). */
export const CHANNEL_TYPE = { text: 0, category: 4, announcement: 5 } as const;
export type ChannelKindName = keyof typeof CHANNEL_TYPE;

export interface ChannelOption {
  id: string;
  name: string;
  type: ChannelKindName;
  parentId: string | null;
}

interface RawChannel {
  id: string;
  name: string;
  type: number;
  parentId: string | null;
}

const BY_NUMBER = new Map<number, ChannelKindName>(
  Object.entries(CHANNEL_TYPE).map(([k, v]) => [v, k as ChannelKindName]),
);
const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });

/**
 * Keep text/announcement/category channels and order them the way Discord
 * groups them: uncategorised channels first, then each category followed by
 * its channels (alphabetical within a group, categories alphabetical).
 */
export function sortChannels(raw: readonly RawChannel[]): ChannelOption[] {
  const kept: ChannelOption[] = [];
  for (const c of raw) {
    const type = BY_NUMBER.get(c.type);
    if (type) kept.push({ id: c.id, name: c.name, type, parentId: type === 'category' ? null : c.parentId });
  }
  const categories = kept.filter((c) => c.type === 'category').sort(byName);
  const catIds = new Set(categories.map((c) => c.id));
  const children = kept.filter((c) => c.type !== 'category');
  const out = children.filter((c) => !c.parentId || !catIds.has(c.parentId)).sort(byName);
  for (const cat of categories) {
    out.push(cat, ...children.filter((c) => c.parentId === cat.id).sort(byName));
  }
  return out;
}

const TTL_MS = 60_000;
const g = globalThis as typeof globalThis & {
  __gynxChannelCache?: Map<string, { at: number; data: ChannelOption[] }>;
};
const cache = (g.__gynxChannelCache ??= new Map());

/** Guild channels for pickers, cached in memory for 60s per guild. Throws INTEGRATION if Discord is unavailable. */
export async function listGuildChannels(
  discord: DiscordPort | undefined,
  guildId: string,
  now: number = Date.now(),
): Promise<ChannelOption[]> {
  const hit = cache.get(guildId);
  if (hit && now - hit.at < TTL_MS) return hit.data;
  if (!discord) throw new AppError('INTEGRATION', 'Discord is not configured for the dashboard.');
  let raw;
  try {
    raw = await discord.listChannels(guildId);
  } catch (err) {
    throw new AppError('INTEGRATION', 'Could not load channels from Discord. Try again shortly.', undefined, {
      cause: err,
    });
  }
  const data = sortChannels(raw);
  cache.set(guildId, { at: now, data });
  return data;
}

/** Test hook. */
export function clearChannelCache(): void {
  cache.clear();
}
