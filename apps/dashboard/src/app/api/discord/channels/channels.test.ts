import { describe, expect, it } from 'vitest';
import type { DiscordPort } from '@gynx/services';
import { clearChannelCache, listGuildChannels, sortChannels } from './channels';

describe('sortChannels', () => {
  it('keeps text/announcement/category channels, grouped under their category', () => {
    const out = sortChannels([
      { id: '1', name: 'zeta', type: 0, parentId: '10' },
      { id: '2', name: 'Voice', type: 2, parentId: null },
      { id: '10', name: 'Staff', type: 4, parentId: null },
      { id: '3', name: 'alpha', type: 5, parentId: '10' },
      { id: '4', name: 'rules', type: 0, parentId: null },
      { id: '11', name: 'Community', type: 4, parentId: null },
      { id: '5', name: 'general', type: 0, parentId: '11' },
      { id: '6', name: 'forum', type: 15, parentId: '11' },
      { id: '7', name: 'orphan', type: 0, parentId: '999' },
    ]);
    expect(out.map((c) => c.name)).toEqual([
      'orphan',
      'rules',
      'Community',
      'general',
      'Staff',
      'alpha',
      'zeta',
    ]);
    expect(out.find((c) => c.id === '3')?.type).toBe('announcement');
    expect(out.find((c) => c.id === '10')?.type).toBe('category');
  });
});

describe('listGuildChannels', () => {
  it('caches per guild for 60 seconds', async () => {
    clearChannelCache();
    let calls = 0;
    const discord = {
      listChannels: async () => (calls++, [{ id: '1', name: 'general', type: 0, parentId: null }]),
    } as unknown as DiscordPort;
    await listGuildChannels(discord, 'g', 0);
    await listGuildChannels(discord, 'g', 59_000);
    expect(calls).toBe(1);
    await listGuildChannels(discord, 'g', 61_000);
    expect(calls).toBe(2);
  });

  it('maps Discord failures to a safe integration error', async () => {
    clearChannelCache();
    const discord = {
      listChannels: async () => {
        throw new Error('secret upstream detail');
      },
    } as unknown as DiscordPort;
    await expect(listGuildChannels(discord, 'g2')).rejects.toMatchObject({
      code: 'INTEGRATION',
      message: expect.not.stringContaining('secret'),
    });
  });
});
