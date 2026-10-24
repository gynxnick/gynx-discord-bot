import { afterAll, describe, expect, it } from 'vitest';
import type { WorkerEnv } from '@gynx/config';
import type { ScheduledJob } from '@gynx/database';
import { marketing } from '@gynx/services';
import {
  ctxAs,
  fakeDiscord,
  freshGuild,
  silentLog,
  snowflake,
  testDb,
  testDeps,
} from '../../../../tests/integration/helpers';
import type { WorkerCtx } from '../framework/types';
import { marketingJobs, refreshEngagement } from './marketing';

const PUBLISHER = ['announcements.create', 'announcements.publish', 'announcements.mass_mention'] as const;

function workerFor(guildId: string, deps = testDeps()): WorkerCtx & { deps: ReturnType<typeof testDeps> } {
  return {
    deps,
    env: {
      DISCORD_GUILD_ID: guildId,
      DASHBOARD_URL: 'https://dash.test',
      DISCORD_BOT_TOKEN: 'x'.repeat(70),
    } as WorkerEnv,
    log: silentLog,
    workerId: 't',
  };
}

/** Run the handler for a persisted job exactly like the runner would (without claiming other tests' jobs). */
async function run(w: WorkerCtx, dedupeKey: string): Promise<ScheduledJob> {
  const job = await testDb().scheduledJob.findUniqueOrThrow({ where: { dedupeKey } });
  await marketingJobs.handlers![job.type]!(job, w);
  return job;
}

async function scheduledAnnouncement(
  guildId: string,
  w: WorkerCtx,
  extra: Partial<marketing.CreateAnnouncementInput> = {},
) {
  const staff = ctxAs(guildId, [...PUBLISHER], { deps: w.deps });
  const a = await marketing.createAnnouncement(staff, {
    title: 'Launch',
    body: 'New game!',
    channelId: snowflake(),
    ...extra,
  });
  const when = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ');
  const s = await marketing.scheduleAnnouncement(
    staff,
    a.id,
    { when, timezone: 'UTC' },
    { confirmMentions: true },
  );
  return { staff, a: s };
}

describe('marketing worker: announcements', () => {
  afterAll(async () => {
    await testDb().$disconnect();
  });

  it('after an edit only the new version is delivered, exactly once even when run twice', async () => {
    const guildId = await freshGuild();
    const w = workerFor(guildId);
    const { staff, a } = await scheduledAnnouncement(guildId, w, { mention: 'EVERYONE' });
    const edited = await marketing.updateAnnouncement(staff, a.id, { body: 'New game, now with mods!' });

    // The superseded job (if it somehow ran) does nothing.
    await run(w, marketing.announcementJobKey(a.id, a.version));
    expect(w.deps.discord.sent).toHaveLength(0);

    await run(w, marketing.announcementJobKey(a.id, edited.version));
    await run(w, marketing.announcementJobKey(a.id, edited.version));
    expect(
      await marketing.deliverAnnouncement(w.deps, { announcementId: a.id, version: edited.version }),
    ).toBe('skipped');
    expect(w.deps.discord.sent).toHaveLength(1);
    const sent = w.deps.discord.sent[0]!;
    expect(sent.channelId).toBe(a.channelId);
    expect(sent.body.content).toBe('@everyone');
    expect(sent.body.allowed_mentions).toEqual({ parse: ['everyone'] });
    expect(sent.body.embeds?.[0]?.description).toBe('New game, now with mods!');

    const final = await testDb().announcement.findUniqueOrThrow({
      where: { id: a.id },
      include: { deliveries: true },
    });
    expect(final.status).toBe('PUBLISHED');
    expect(final.deliveries).toHaveLength(1);
    expect(final.deliveries[0]).toMatchObject({ success: true, idempotencyKey: `${a.id}:${edited.version}` });
    expect(final.deliveries[0]!.messageId).toBeTruthy();
  });

  it('does not re-send when a previous attempt crashed mid-send (pending delivery row)', async () => {
    const guildId = await freshGuild();
    const w = workerFor(guildId);
    const { a } = await scheduledAnnouncement(guildId, w);
    // Simulate: attempt 1 set PUBLISHING and inserted the delivery row, then the process died.
    await testDb().announcement.update({ where: { id: a.id }, data: { status: 'PUBLISHING' } });
    await testDb().announcementDelivery.create({
      data: {
        announcementId: a.id,
        idempotencyKey: `${a.id}:${a.version}`,
        channelId: a.channelId,
        success: false,
      },
    });

    await run(w, marketing.announcementJobKey(a.id, a.version));
    expect(w.deps.discord.sent).toHaveLength(0);
    const after = await testDb().announcement.findUniqueOrThrow({
      where: { id: a.id },
      include: { deliveries: true },
    });
    expect(after.status).toBe('FAILED');
    expect(after.deliveries[0]!.error).toMatch(/not re-sent/);

    // Manual retry after checking the channel publishes a NEW version.
    const staff = ctxAs(guildId, [...PUBLISHER], { deps: w.deps });
    const retried = await marketing.publishAnnouncement(staff, a.id);
    await run(w, marketing.announcementJobKey(a.id, retried.version));
    expect(w.deps.discord.sent).toHaveLength(1);
  });

  it('records send failures without retrying the post', async () => {
    const guildId = await freshGuild();
    const w = workerFor(guildId);
    const { a } = await scheduledAnnouncement(guildId, w);
    w.deps.discord.failNextSend = new Error('Missing Access');
    await run(w, marketing.announcementJobKey(a.id, a.version));
    await run(w, marketing.announcementJobKey(a.id, a.version));
    expect(w.deps.discord.sent).toHaveLength(0);
    const after = await testDb().announcement.findUniqueOrThrow({
      where: { id: a.id },
      include: { deliveries: true },
    });
    expect(after.status).toBe('FAILED');
    expect(after.deliveries[0]!.error).toContain('Missing Access');
  });

  it('cancelling before publish prevents delivery', async () => {
    const guildId = await freshGuild();
    const w = workerFor(guildId);
    const { staff, a } = await scheduledAnnouncement(guildId, w);
    await marketing.cancelAnnouncement(staff, a.id);
    const job = await testDb().scheduledJob.findUniqueOrThrow({
      where: { dedupeKey: marketing.announcementJobKey(a.id, a.version) },
    });
    expect(job.status).toBe('CANCELLED');
    await run(w, job.dedupeKey); // even if a worker had already claimed it
    expect(w.deps.discord.sent).toHaveLength(0);
    expect((await testDb().announcement.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('CANCELLED');
  });

  it('refreshes reaction counts for recently published announcements', async () => {
    const guildId = await freshGuild();
    const w = workerFor(guildId);
    const { a } = await scheduledAnnouncement(guildId, w);
    await run(w, marketing.announcementJobKey(a.id, a.version));
    const updated = await refreshEngagement(w, new Date(), async () => 7);
    expect(updated).toBe(1);
    const stats = await marketing.getAnnouncementAnalytics(ctxAs(guildId, ['announcements.create']), a.id);
    expect(stats.reactions).toBe(7);
    expect(stats.impressions).toBeNull();
    // Outside the 14-day window nothing is fetched.
    expect(await refreshEngagement(w, new Date(Date.now() + 15 * 86_400_000), async () => 99)).toBe(0);
  });
});

describe('marketing worker: partners', () => {
  const answers = {
    about: 'We run a small modding collective.',
    proposal: 'Cross-promote GYNX hosting to our members.',
  };

  async function approved(guildId: string, w: WorkerCtx) {
    const applicant = ctxAs(guildId, [], { deps: w.deps });
    const app = await marketing.submitPartnerApplication(applicant, { category: 'OTHER', answers });
    const reviewer = ctxAs(guildId, ['partners.review'], { deps: w.deps });
    await marketing.decidePartnerApplication(reviewer, app.id, {
      decision: 'APPROVED',
      decisionNote: 'Welcome!',
      internalNotes: 'SECRET-INTERNAL-NOTE',
    });
    return { app, applicant };
  }

  it('notifies the review channel, then DMs once and grants a safe partner role', async () => {
    const guildId = await freshGuild();
    const reviewChannel = snowflake();
    const partnerRoleId = snowflake();
    await testDb().guildConfig.update({
      where: { guildId },
      data: { partnerReviewChannelId: reviewChannel, partnerRoleId },
    });
    const discord = fakeDiscord({
      listRoles: async () => [
        { id: partnerRoleId, name: 'Partner', position: 3, managed: false, permissions: String(1n << 10n) },
      ],
    });
    const w = workerFor(guildId, testDeps({ discord }));

    const applicant = ctxAs(guildId, [], { deps: w.deps });
    const app = await marketing.submitPartnerApplication(applicant, { category: 'OTHER', answers });
    await run(w, `marketing.partner.notify:${app.id}`);
    expect(discord.sent).toHaveLength(1);
    expect(discord.sent[0]!.channelId).toBe(reviewChannel);
    expect(JSON.stringify(discord.sent[0]!.body)).toContain(app.ref);

    const reviewer = ctxAs(guildId, ['partners.review'], { deps: w.deps });
    await marketing.decidePartnerApplication(reviewer, app.id, {
      decision: 'APPROVED',
      decisionNote: 'Welcome!',
      internalNotes: 'SECRET-INTERNAL-NOTE',
    });
    await run(w, `marketing.partner.decision:${app.id}`);
    await run(w, `marketing.partner.decision:${app.id}`); // retry-safe

    expect(discord.roleChanges).toEqual([
      { op: 'add', userId: applicant.actor.userId, roleId: partnerRoleId },
    ]);
    expect(discord.dms).toHaveLength(1);
    expect(JSON.stringify(discord.dms[0]!.body)).toContain('Welcome!');
    expect(JSON.stringify(discord.dms[0]!.body)).not.toContain('SECRET-INTERNAL-NOTE');
    expect((await testDb().partnerApplication.findUniqueOrThrow({ where: { id: app.id } })).roleGranted).toBe(
      true,
    );
  });

  it('refuses to grant a partner role that carries privileged permissions', async () => {
    const guildId = await freshGuild();
    const partnerRoleId = snowflake();
    await testDb().guildConfig.update({ where: { guildId }, data: { partnerRoleId } });
    const discord = fakeDiscord({
      listRoles: async () => [
        {
          id: partnerRoleId,
          name: 'Partner',
          position: 3,
          managed: false,
          permissions: String((1n << 10n) | (1n << 17n)),
        },
      ], // MentionEveryone
    });
    const w = workerFor(guildId, testDeps({ discord }));
    const { app } = await approved(guildId, w);
    await run(w, `marketing.partner.decision:${app.id}`);

    expect(discord.roleChanges).toHaveLength(0);
    expect(discord.dms).toHaveLength(1); // the applicant is still told the outcome
    expect((await testDb().partnerApplication.findUniqueOrThrow({ where: { id: app.id } })).roleGranted).toBe(
      false,
    );
    const refused = await testDb().securityAuditEvent.findFirst({
      where: { guildId, action: 'partners.role.refused', result: 'DENIED' },
    });
    expect(refused?.metadata).toMatchObject({
      reason: 'privileged-permissions',
      privileged: ['MentionEveryone'],
    });

    // Administrator is refused too.
    expect(marketing.privilegedDiscordPermissions(String(1n << 3n))).toEqual(['Administrator']);
  });
});
