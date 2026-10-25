import { afterAll, describe, expect, it } from 'vitest';
import type { WorkerEnv } from '@gynx/config';
import { engagement } from '@gynx/services';
import { JobRunner } from '../../apps/worker/src/framework/runner';
import { engagementJobs } from '../../apps/worker/src/jobs/engagement';
import { ctxAs, drainJobs, freshGuild, silentLog, snowflake, testDb, testDeps } from './helpers';

const { suggestionFromMessage, submitSuggestionFromMessage } = engagement;

describe('suggestionFromMessage', () => {
  it('uses the first line as the title and the whole message as the body', () => {
    const r = suggestionFromMessage(
      'Add Rust servers in Europe\nLatency from the EU is high on the US nodes.',
    );
    expect(r.title).toBe('Add Rust servers in Europe');
    expect(r.body).toContain('Latency from the EU');
  });

  it('strips markdown from the title and cuts long titles at a word boundary', () => {
    expect(suggestionFromMessage('## **Better** backups please, daily').title).toBe(
      'Better backups please, daily',
    );
    const long = suggestionFromMessage(`${'word '.repeat(40)}end`).title;
    expect(long.length).toBeLessThanOrEqual(100);
    expect(long.endsWith('…')).toBe(true);
    expect(long).not.toMatch(/wor…$/); // no half words
  });
});

async function setup(threads = true) {
  const guildId = await freshGuild();
  const channelId = snowflake();
  await testDb().guildConfig.update({
    where: { guildId },
    data: { suggestionChannelId: channelId, suggestionThreads: threads },
  });
  const deps = testDeps();
  const runner = new JobRunner(
    {
      deps,
      env: { DISCORD_GUILD_ID: guildId, DASHBOARD_URL: 'https://dash.test' } as WorkerEnv,
      log: silentLog,
      workerId: 't',
    },
    [engagementJobs],
  );
  return { guildId, channelId, deps, runner };
}

describe('suggestions channel', () => {
  afterAll(async () => {
    await testDb().$disconnect();
  });

  it('turns a typed message into a suggestion card with a discussion thread', async () => {
    const { guildId, channelId, deps, runner } = await setup(true);
    const member = ctxAs(guildId, [], { deps });
    const s = await submitSuggestionFromMessage(
      member,
      'Add a Palworld modded tier\nWould love official support for mods on Palworld servers.',
    );
    expect(s.title).toBe('Add a Palworld modded tier');

    await drainJobs(runner);
    const card = deps.discord.sent.filter((m) => m.channelId === channelId);
    expect(card).toHaveLength(1);
    expect(JSON.stringify(card[0]!.body)).toContain('Add a Palworld modded tier');

    expect(deps.discord.threads).toHaveLength(1);
    expect(deps.discord.threads[0]!.name).toBe(`💬 ${s.ref}: Add a Palworld modded tier`);
    const saved = await testDb().suggestion.findUniqueOrThrow({ where: { id: s.id } });
    expect(saved.messageId).toBeTruthy();
    expect(saved.threadId).toBeTruthy();

    await drainJobs(runner); // idempotent: no second card or thread
    expect(deps.discord.sent.filter((m) => m.channelId === channelId)).toHaveLength(1);
    expect(deps.discord.threads).toHaveLength(1);
  });

  it('skips the thread when discussion threads are switched off', async () => {
    const { guildId, deps, runner } = await setup(false);
    await submitSuggestionFromMessage(
      ctxAs(guildId, [], { deps }),
      'Weekly community game night\nA scheduled event each week on a rotating game.',
    );
    await drainJobs(runner);
    expect(deps.discord.threads).toHaveLength(0);
  });

  it('a missing thread permission never blocks the card', async () => {
    const { guildId, channelId, deps, runner } = await setup(true);
    deps.discord.startThread = async () => Promise.reject(new Error('Missing Permissions'));
    await submitSuggestionFromMessage(
      ctxAs(guildId, [], { deps }),
      'Discord status widget\nShow live server status in a Discord widget on the website.',
    );
    await drainJobs(runner);
    expect(deps.discord.sent.filter((m) => m.channelId === channelId)).toHaveLength(1);
  });

  it('rejects empty, too-short and too-long messages with friendly reasons', async () => {
    const { guildId, deps } = await setup();
    const member = ctxAs(guildId, [], { deps });
    await expect(submitSuggestionFromMessage(member, '   ')).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(submitSuggestionFromMessage(member, 'x'.repeat(2001))).rejects.toThrow(/too long/);
    await expect(submitSuggestionFromMessage(member, 'More RAM')).rejects.toThrow();
  });

  it('keeps the same duplicate check and rate limit as /suggest', async () => {
    const { guildId, deps } = await setup();
    const member = ctxAs(guildId, [], { deps });
    const text = 'Add automatic daily backups\nBackups every night kept for a week for every server.';
    await submitSuggestionFromMessage(member, text);
    await expect(submitSuggestionFromMessage(ctxAs(guildId, [], { deps }), text)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
});
