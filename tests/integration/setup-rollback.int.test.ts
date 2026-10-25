import { afterAll, describe, expect, it } from 'vitest';
import { setup } from '@gynx/services';
import { ALL_CHANNELS, apply, harness, manifest, rollback } from './fake-admin-port';
import { testDb } from './helpers';

describe('server setup rollback', () => {
  afterAll(async () => {
    await testDb().$disconnect();
  });

  it('deletes only what the operation created, keeps adopted/pre-existing and channels with member messages', async () => {
    const h = await harness();
    const unrelated = h.guild.addRole('Gamers');
    const adoptedCat = h.guild.addChannel('SUPPORT CENTER', 4);
    const adoptedKb = h.guild.addChannel('📚・knowledge-base', 0, { parentId: adoptedCat.id });
    const adoptedRole = h.guild.addRole('Partner');
    const { preview: applied } = await apply(h);

    // A member talks in a channel the setup created.
    const general = h.guild.channelByName('💬・general')!;
    h.guild.postMemberMessage(general.id);

    const { preview, summary } = await rollback(h);
    expect(preview.type).toBe('ROLLBACK');
    expect(preview.plan.findings).toContainEqual(
      expect.objectContaining({ code: 'contains-member-messages', key: 'channel:general' }),
    );
    expect(summary.failed).toBe(0);

    // Created roles gone; adopted + unrelated roles kept.
    for (const r of setup.BLUEPRINT_ROLES.filter((x) => x.key !== 'partner')) {
      expect(h.guild.roleByName(r.name), r.name).toBeUndefined();
    }
    expect(h.guild.roleByName('Partner')!.id).toBe(adoptedRole.id);
    expect(h.guild.roleByName('Gamers')!.id).toBe(unrelated.id);

    // Created channels gone except the one with member messages (and its category).
    expect(h.guild.channels.find((c) => c.id === general.id)).toBeDefined();
    expect(h.guild.channelByName('COMMUNITY')).toBeDefined();
    expect(h.guild.channels.find((c) => c.id === adoptedCat.id)).toBeDefined();
    expect(h.guild.channels.find((c) => c.id === adoptedKb.id)).toBeDefined();
    for (const ch of ALL_CHANNELS.filter((c) => !['general', 'knowledge-base'].includes(c.key))) {
      expect(h.guild.channelByName(ch.name), ch.name).toBeUndefined();
    }
    expect(h.guild.channelByName('STAFF HQ — PRIVATE')).toBeUndefined();

    // Bindings restored, grants and template removed.
    const cfg = await h.db.guildConfig.findUniqueOrThrow({ where: { guildId: h.guildId } });
    expect(cfg.modLogChannelId).toBeNull();
    expect(cfg.supportStatusChannelId).toBeNull();
    const welcome = await h.db.welcomeConfig.findUniqueOrThrow({ where: { guildId: h.guildId } });
    expect(welcome.verificationEnabled).toBe(false);
    expect(await h.db.staffPermission.count({ where: { guildId: h.guildId } })).toBe(0);
    expect(await h.db.announcementTemplate.count({ where: { guildId: h.guildId } })).toBe(0);

    // Manifest: only the kept created resources remain; changes marked ROLLED_BACK.
    const keys = (await manifest(h)).map((r) => r.blueprintKey).sort();
    expect(keys).toEqual(['category:community', 'channel:general']);
    const target = await h.db.setupChange.findMany({ where: { operationId: applied.operationId } });
    expect(target.find((c) => c.blueprintKey === 'role:support' && c.kind === 'role.create')!.status).toBe(
      'ROLLED_BACK',
    );
    expect(
      target.find((c) => c.blueprintKey === 'channel:general' && c.kind === 'channel.create')!.status,
    ).toBe('APPLIED');
    const own = await h.db.setupChange.findMany({ where: { operationId: preview.operationId } });
    expect(own.find((c) => c.blueprintKey === 'channel:general')).toMatchObject({
      status: 'SKIPPED',
      error: expect.stringMatching(/member messages/),
    });
    const gs = await h.db.guildSetup.findUniqueOrThrow({ where: { guildId: h.guildId } });
    expect(gs.status).toBe('PARTIAL');
  });

  it('restores updated settings and overwrites from a REPAIR', async () => {
    const h = await harness();
    await apply(h);
    const ch = h.guild.channelByName('🔧・troubleshooting')!;
    ch.name = 'tshoot';
    const { preview: repair } = await apply(h, 'REPAIR');
    expect(h.guild.channels.find((c) => c.id === ch.id)!.name).toBe('🔧・troubleshooting');
    const { summary } = await rollback(h, repair.operationId);
    expect(summary.status).toBe('SUCCEEDED');
    expect(h.guild.channels.find((c) => c.id === ch.id)!.name).toBe('tshoot');
    // The rest of the server is untouched by rolling back the repair.
    expect(h.guild.channelByName('💬・general')).toBeDefined();
  });

  it('a rollback preview goes stale when the target changes; nothing to roll back is NOT_FOUND', async () => {
    const h = await harness();
    await expect(setup.previewRollback(h.admin)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await apply(h);
    const p1 = await setup.previewRollback(h.admin);
    const p2 = await setup.previewRollback(h.admin);
    await setup.confirmOperation(h.admin, p2.operationId, { acceptDisruptive: true });
    await setup.executeSetupOperation(h.deps, p2.operationId, { sleep: async () => undefined });
    await expect(
      setup.confirmOperation(h.admin, p1.operationId, { acceptDisruptive: true }),
    ).resolves.toMatchObject({
      status: 'STALE',
    });
  });
});
