import { describe, expect, it } from 'vitest';
import type { DiscordPort } from '@gynx/services';
import { authorizeMember } from './session-store';

const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

function deps(discord: Partial<DiscordPort>) {
  return { db: {} as never, discord: discord as DiscordPort };
}

describe('authorizeMember: why membership could not be checked', () => {
  const guildId = '123456789012345678';
  const userId = '223456789012345678';

  it('reports a rejected bot token', async () => {
    const r = await authorizeMember(
      deps({
        getGuild: () => Promise.reject(httpError(401)),
        getMember: () => Promise.reject(httpError(401)),
      }),
      guildId,
      userId,
      'nick',
    );
    expect(r).toEqual({ ok: false, reason: 'unavailable', detail: 'bot_token' });
  });

  it('reports that the bot is not in the server (403 Missing Access)', async () => {
    const r = await authorizeMember(
      deps({ getGuild: async () => null, getMember: () => Promise.reject(httpError(403)) }),
      guildId,
      userId,
      'nick',
    );
    expect(r).toEqual({ ok: false, reason: 'unavailable', detail: 'bot_missing' });
  });

  it('reports that the bot is not in the server when the guild lookup returns nothing', async () => {
    const r = await authorizeMember(
      deps({ getGuild: async () => null, getMember: async () => null }),
      guildId,
      userId,
      'nick',
    );
    expect(r).toEqual({ ok: false, reason: 'unavailable', detail: 'bot_missing' });
  });

  it('keeps a generic message when Discord is down', async () => {
    const r = await authorizeMember(
      deps({ getGuild: () => Promise.reject(new Error('ECONNRESET')), getMember: async () => null }),
      guildId,
      userId,
      'nick',
    );
    expect(r).toEqual({ ok: false, reason: 'unavailable' });
  });
});
