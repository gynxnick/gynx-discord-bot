import { afterAll, describe, expect, it } from 'vitest';
import { CoreText, listTexts, resetText, setText, withGuildText } from '@gynx/services';
import { ctxAs, freshGuild, testDb } from './helpers';

describe('editable bot text', () => {
  afterAll(async () => {
    await testDb().$disconnect();
  });

  it('only settings.manage can list or change text', async () => {
    const guildId = await freshGuild();
    await expect(listTexts(ctxAs(guildId, ['community.manage']))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      setText(ctxAs(guildId, ['community.manage']), { key: 'core.errorTitle', value: 'x' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('saves an override, uses it in that server only, audits it, and resets', async () => {
    const guildId = await freshGuild();
    const other = await freshGuild();
    const admin = ctxAs(guildId, ['settings.manage']);

    const saved = await setText(admin, { key: 'core.errorTitle', value: 'Uh oh' });
    expect(saved.override).toBe('Uh oh');
    expect(await withGuildText(testDb(), guildId, async () => CoreText.errorTitle())).toBe('Uh oh');
    expect(await withGuildText(testDb(), other, async () => CoreText.errorTitle())).toBe(
      'Something went wrong',
    );

    const audited = await testDb().securityAuditEvent.findFirst({
      where: { guildId, action: 'text.update' },
    });
    expect(audited?.targetId).toBe('core.errorTitle');

    await resetText(admin, 'core.errorTitle');
    expect(await withGuildText(testDb(), guildId, async () => CoreText.errorTitle())).toBe(
      'Something went wrong',
    );
  });

  it('lists every text with its default and current override', async () => {
    const guildId = await freshGuild();
    const admin = ctxAs(guildId, ['settings.manage']);
    await setText(admin, { key: 'core.rateLimited', value: 'Slow down! {seconds}s' });
    const all = await listTexts(admin);
    const entry = all.find((e) => e.key === 'core.rateLimited')!;
    expect(entry.default).toContain('{seconds}');
    expect(entry.override).toBe('Slow down! {seconds}s');
    expect(entry.vars).toEqual(['seconds']);
    expect(all.length).toBeGreaterThan(5);
  });

  it('saving the default wording removes the override instead of storing a copy', async () => {
    const guildId = await freshGuild();
    const admin = ctxAs(guildId, ['settings.manage']);
    await setText(admin, { key: 'core.forbidden', value: 'Nope.' });
    const back = await setText(admin, {
      key: 'core.forbidden',
      value: 'You do not have permission to do that.',
    });
    expect(back.override).toBeNull();
    expect(await testDb().textOverride.count({ where: { guildId } })).toBe(0);
  });

  it('rejects unknown keys and invalid placeholders', async () => {
    const guildId = await freshGuild();
    const admin = ctxAs(guildId, ['settings.manage']);
    await expect(setText(admin, { key: 'core.nope', value: 'x' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(setText(admin, { key: 'core.rateLimited', value: 'wait {minutes}' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });
});
