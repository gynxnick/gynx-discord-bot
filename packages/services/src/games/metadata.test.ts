import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MOJANG_MANIFEST_URL,
  clearMetadataCache,
  getLatestVersion,
  getSteamNews,
  steamNewsUrl,
} from './metadata';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => clearMetadataCache());

describe('public game metadata', () => {
  it('reads latest Minecraft release/snapshot from the Mojang manifest and caches for 10 minutes', async () => {
    let t = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe(MOJANG_MANIFEST_URL);
      return json({
        latest: { release: '1.21.4', snapshot: '25w02a' },
        versions: [{ id: '1.21.4', releaseTime: '2024-12-03T10:12:57+00:00' }],
      });
    }) as unknown as typeof fetch;
    const deps = { fetchImpl, now: () => t };
    const v = await getLatestVersion('minecraft', deps);
    expect(v).toMatchObject({ available: true, kind: 'minecraft', release: '1.21.4', snapshot: '25w02a' });
    await getLatestVersion('minecraft', deps);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    t = 11 * 60_000;
    await getLatestVersion('minecraft', deps);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('uses the keyless Steam news endpoint for Steam games', async () => {
    const spy = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe(steamNewsUrl(892970));
      return json({
        appnews: {
          newsitems: [
            {
              title: 'Patch 0.219.16',
              url: 'https://store.steampowered.com/news/app/892970/view/1',
              date: 1730000000,
              feedlabel: 'Community Announcements',
            },
          ],
        },
      });
    });
    const fetchImpl = spy as unknown as typeof fetch;
    const v = await getLatestVersion('valheim', { fetchImpl });
    expect(v).toMatchObject({ available: true, kind: 'steam-news', news: { title: 'Patch 0.219.16' } });
    expect(String(spy.mock.calls[0]![0])).toContain('api.steampowered.com');
  });

  it('says honestly that version info is unavailable on failure', async () => {
    const failing = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    expect(await getLatestVersion('minecraft', { fetchImpl: failing })).toEqual({
      available: false,
      message: expect.stringMatching(/currently unavailable/),
    });
    expect(
      await getLatestVersion('rust', { fetchImpl: (async () => json({}, 500)) as unknown as typeof fetch }),
    ).toMatchObject({ available: false });
    expect(
      await getSteamNews(4000, {
        fetchImpl: (async () => json({ appnews: { newsitems: [] } })) as unknown as typeof fetch,
      }),
    ).toBeNull();
  });

  it('drops non-https news links', async () => {
    const fetchImpl = (async () =>
      json({
        appnews: { newsitems: [{ title: 'x', url: 'javascript:alert(1)', date: 1 }] },
      })) as unknown as typeof fetch;
    expect((await getSteamNews(252490, { fetchImpl }))?.url).toBeNull();
  });
});
