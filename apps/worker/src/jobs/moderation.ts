import { DiscordAPIError, REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import { getGuildConfig, makeCtx, moderation, systemActor } from '@gynx/services';
import type { WorkerCtx, WorkerModule } from '../framework/types';

type Payload = { actionId?: string; appealId?: string };
const payload = (p: unknown) => (p ?? {}) as Payload;

/** Unban via REST (DiscordPort has no unban). A missing ban (404 / Unknown Ban) counts as done. */
export type WorkerUnban = (w: WorkerCtx, guildId: string, userId: string, reason: string) => Promise<void>;

let rest: { token: string; client: REST } | undefined;
export const restUnban: WorkerUnban = async (w, guildId, userId, reason) => {
  if (!rest || rest.token !== w.env.DISCORD_BOT_TOKEN) {
    rest = {
      token: w.env.DISCORD_BOT_TOKEN,
      client: new REST({ version: '10', timeout: 15_000, retries: 3 }).setToken(w.env.DISCORD_BOT_TOKEN),
    };
  }
  try {
    await rest.client.delete(Routes.guildBan(guildId, userId), { reason });
  } catch (e) {
    if (e instanceof DiscordAPIError && (e.status === 404 || e.code === 10026)) return; // already unbanned
    throw e;
  }
};

export function createModerationJobs(opts: { unban?: WorkerUnban } = {}): WorkerModule {
  const unban = opts.unban ?? restUnban;
  return {
    name: 'moderation',
    handlers: {
      /**
       * Post the modlog embed. Idempotency: the job's dedupeKey (`moderation.modlog:<actionId>`)
       * guarantees one job per action; no extra state is stored.
       */
      async 'moderation.modlog'(job, w) {
        const a = await w.deps.db.moderationAction.findUnique({
          where: { id: payload(job.payload).actionId ?? '' },
        });
        if (!a) return;
        const cfg = await getGuildConfig(w.deps.db, a.guildId);
        if (!cfg.modLogChannelId) {
          w.log.warn(
            { guildId: a.guildId },
            'no modlog channel configured; action visible in dashboard only',
          );
          return;
        }
        await w.deps.discord.sendMessage(cfg.modLogChannelId, { embeds: [moderation.modlogEmbed(a)] });
      },

      /** Expire a temp ban (REST unban + UNBAN record by 'system') or a timeout (status only). Idempotent. */
      async 'moderation.expire'(job, w) {
        const id = payload(job.payload).actionId ?? '';
        const a = await w.deps.db.moderationAction.findUnique({ where: { id }, select: { guildId: true } });
        if (!a) return;
        const ctx = makeCtx(w.deps, a.guildId, systemActor('worker'), `job:${job.id}`);
        await moderation.expireAction(ctx, id, (guildId, userId, reason) =>
          unban(w, guildId, userId, reason),
        );
      },

      /** New appeal → staff review card with Accept/Deny buttons in the modlog channel. */
      async 'moderation.appeal-notify'(job, w) {
        const appeal = await w.deps.db.moderationAppeal.findUnique({
          where: { id: payload(job.payload).appealId ?? '' },
          include: { action: true },
        });
        if (!appeal || appeal.status !== 'PENDING') return;
        const cfg = await getGuildConfig(w.deps.db, appeal.guildId);
        if (!cfg.modLogChannelId) {
          w.log.warn(
            { guildId: appeal.guildId },
            'no modlog channel configured; appeal visible in dashboard only',
          );
          return;
        }
        const { action, ...row } = appeal;
        await w.deps.discord.sendMessage(cfg.modLogChannelId, {
          embeds: [moderation.appealStaffEmbed(row, action)],
          components: moderation.appealReviewButtons(appeal.id),
        });
      },

      /** DM the appellant with the decision. DMs closed is fine (no retry). */
      async 'moderation.appeal-decision-dm'(job, w) {
        const appeal = await w.deps.db.moderationAppeal.findUnique({
          where: { id: payload(job.payload).appealId ?? '' },
          include: { action: { select: { ref: true } } },
        });
        if (!appeal || appeal.status === 'PENDING') return;
        const cfg = await getGuildConfig(w.deps.db, appeal.guildId);
        const guild = await w.deps.db.guild.findUnique({
          where: { id: appeal.guildId },
          select: { name: true },
        });
        const { action, ...row } = appeal;
        const sent = await w.deps.discord.sendDm(appeal.userId, {
          embeds: [
            moderation.appealDecisionEmbed(
              row,
              action?.ref ?? null,
              guild?.name ?? 'GYNX.GG',
              cfg.supportUrl,
            ),
          ],
        });
        if (!sent) w.log.info({ appealId: appeal.id }, 'appellant has DMs closed');
      },
    },
    periodic: [
      {
        name: 'moderation.warnings-expire',
        intervalMs: 60 * 60_000,
        async run(w, now) {
          const expired = await moderation.expireWarnings(w.deps.db, now);
          if (expired) w.log.info({ expired }, 'warnings expired');
        },
      },
    ],
  };
}

export const moderationJobs: WorkerModule = createModerationJobs();
