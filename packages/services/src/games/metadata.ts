import { readBodyCapped } from './http';
import { getGame } from './registry';
import { GamesText } from './texts';

/**
 * Public game metadata from fixed, no-auth sources only:
 *  - Mojang version manifest (Minecraft latest release/snapshot)
 *  - Steam ISteamNews/GetNewsForApp (latest news/patch post; no API key)
 *
 * URLs are hard-coded; nothing user-controlled ever reaches `fetch`. Responses
 * are cached in memory for 10 minutes. On any failure we say so honestly
 * rather than guessing a version.
 */

export const MOJANG_MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
export const steamNewsUrl = (appId: number) =>
  `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appId}&count=1&maxlength=300`;
export const steamStoreUrl = (appId: number) => `https://store.steampowered.com/app/${appId}/`;
export { VERSION_UNAVAILABLE } from './texts';

const ALLOWED_HOSTS = new Set(['piston-meta.mojang.com', 'api.steampowered.com']);
const CACHE_TTL_MS = 10 * 60_000;
const FETCH_TIMEOUT_MS = 5000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

export interface MetadataDeps {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const cache = new Map<string, { at: number; value: unknown }>();

export function clearMetadataCache(): void {
  cache.clear();
}

async function fetchJson(url: string, deps: MetadataDeps): Promise<unknown> {
  const host = new URL(url).hostname;
  if (!ALLOWED_HOSTS.has(host)) throw new Error('metadata host not allowed');
  const now = deps.now ?? Date.now;
  const hit = cache.get(url);
  if (hit && now() - hit.at < CACHE_TTL_MS) return hit.value;

  const res = await (deps.fetchImpl ?? fetch)(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { accept: 'application/json', 'user-agent': 'GYNX-Discord-Bot/1.0' },
  });
  if (!res.ok) throw new Error(`metadata http ${res.status}`);
  const body = await readBodyCapped(res, MAX_BODY_BYTES);
  if (!body) throw new Error('metadata too large');
  const value = JSON.parse(body.toString('utf8')) as unknown;
  cache.set(url, { at: now(), value });
  return value;
}

export interface SteamNewsItem {
  title: string;
  url: string | null;
  date: Date;
  feedLabel: string | null;
}

export type VersionInfo =
  | { available: true; kind: 'minecraft'; release: string; snapshot: string | null; releaseTime: Date | null }
  | { available: true; kind: 'steam-news'; news: SteamNewsItem; storeUrl: string }
  | { available: false; message: string };

export async function getMinecraftLatest(deps: MetadataDeps = {}): Promise<VersionInfo> {
  try {
    const data = (await fetchJson(MOJANG_MANIFEST_URL, deps)) as {
      latest?: { release?: unknown; snapshot?: unknown };
      versions?: Array<{ id?: unknown; releaseTime?: unknown }>;
    };
    const release = typeof data.latest?.release === 'string' ? data.latest.release : null;
    if (!release) return { available: false, message: GamesText.versionUnavailable() };
    const snapshot = typeof data.latest?.snapshot === 'string' ? data.latest.snapshot : null;
    const entry = Array.isArray(data.versions) ? data.versions.find((v) => v.id === release) : undefined;
    const releaseTime =
      typeof entry?.releaseTime === 'string' && !Number.isNaN(Date.parse(entry.releaseTime))
        ? new Date(entry.releaseTime)
        : null;
    return {
      available: true,
      kind: 'minecraft',
      release: release.slice(0, 40),
      snapshot: snapshot?.slice(0, 40) ?? null,
      releaseTime,
    };
  } catch {
    return { available: false, message: GamesText.versionUnavailable() };
  }
}

export async function getSteamNews(appId: number, deps: MetadataDeps = {}): Promise<SteamNewsItem | null> {
  try {
    const data = (await fetchJson(steamNewsUrl(appId), deps)) as {
      appnews?: {
        newsitems?: Array<{ title?: unknown; url?: unknown; date?: unknown; feedlabel?: unknown }>;
      };
    };
    const item = data.appnews?.newsitems?.[0];
    if (!item || typeof item.title !== 'string' || typeof item.date !== 'number') return null;
    const url = typeof item.url === 'string' && /^https:\/\//i.test(item.url) ? item.url : null;
    return {
      title: item.title.slice(0, 200),
      url,
      date: new Date(item.date * 1000),
      feedLabel: typeof item.feedlabel === 'string' ? item.feedlabel.slice(0, 60) : null,
    };
  } catch {
    return null;
  }
}

/** Latest version for any supported game: Mojang for Minecraft, latest Steam news post otherwise. */
export async function getLatestVersion(gameId: string, deps: MetadataDeps = {}): Promise<VersionInfo> {
  const game = getGame(gameId);
  if (game.id === 'minecraft') return getMinecraftLatest(deps);
  if (!game.steamAppId) return { available: false, message: GamesText.versionUnavailable() };
  const news = await getSteamNews(game.steamAppId, deps);
  if (!news) return { available: false, message: GamesText.versionUnavailable() };
  return { available: true, kind: 'steam-news', news, storeUrl: steamStoreUrl(game.steamAppId) };
}
