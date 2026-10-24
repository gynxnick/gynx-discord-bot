import type { Db, ScheduledJob } from '@gynx/database';
import { enqueueJob, getGuildConfig, status, type MessageBody } from '@gynx/services';
import type { WorkerCtx, WorkerModule } from '../framework/types';

/** Max DMs sent by one job; the rest are handled by follow-up jobs. */
export const DM_CHUNK_SIZE = 200;

export interface StatusJobsOptions {
  /** Override check adapters (tests use fakes so nothing touches the network). */
  adapters?: status.AdapterRegistry;
  checkOptions?: status.CheckOptions;
  dmChunkSize?: number;
}

type DmPayload =
  | { kind: 'incident'; incidentId: string; updateId: string; after?: string }
  | { kind: 'maintenance'; windowId: string; phase: status.MaintenancePhase; after?: string };

const str = (payload: unknown, key: string): string => {
  const v = (payload as Record<string, unknown> | null)?.[key];
  return typeof v === 'string' ? v : '';
};

const refSelect = { select: { slug: true, name: true, public: true } } as const;

async function enqueueDmChunk(db: Db, guildId: string, p: DmPayload, runAt: Date) {
  const ref = p.kind === 'incident' ? p.updateId : `${p.windowId}:${p.phase}`;
  await enqueueJob(db, {
    type: 'status.subscribers.notify',
    dedupeKey: `status.subscribers.notify:${p.kind}:${ref}:${p.after ?? 'start'}`,
    runAt,
    guildId,
    payload: p as unknown as Record<string, unknown>,
  });
}

async function postMaintenance(
  w: WorkerCtx,
  guildId: string,
  window: Parameters<typeof status.toPublicMaintenance>[0],
  phase: status.MaintenancePhase,
) {
  const cfg = await getGuildConfig(w.deps.db, guildId);
  if (!cfg.statusChannelId) {
    w.log.warn({ guildId }, 'no status channel configured; maintenance notice skipped');
    return;
  }
  await w.deps.discord.sendMessage(cfg.statusChannelId, {
    embeds: [status.maintenanceEmbed(status.toPublicMaintenance(window), phase)],
  });
}

/** Factory so tests can inject fake adapters; production uses `statusJobs`. */
export function createStatusJobs(opts: StatusJobsOptions = {}): WorkerModule {
  const chunk = opts.dmChunkSize ?? DM_CHUNK_SIZE;

  return {
    name: 'status',
    handlers: {
      /** Post a state-change alert. Pings the alert role only for OUTAGE, and only that role. */
      async 'status.alert'(job: ScheduledJob, w) {
        const svc = await w.deps.db.monitoredService.findUnique({
          where: { id: str(job.payload, 'serviceId') },
        });
        if (!svc || !svc.public) return; // private services are dashboard-only
        if (svc.state !== str(job.payload, 'state')) return; // stale: the service moved on; a newer alert covers it
        const cfg = await getGuildConfig(w.deps.db, svc.guildId);
        if (!cfg.statusChannelId) {
          w.log.warn({ guildId: svc.guildId }, 'no status channel configured; alert skipped');
          return;
        }
        const from = (str(job.payload, 'from') || null) as status.PublicService['state'] | null;
        const body: MessageBody = { embeds: [status.alertEmbed(status.toPublicService(svc), from)] };
        if (svc.state === 'OUTAGE' && cfg.statusAlertRoleId) {
          body.content = `<@&${cfg.statusAlertRoleId}>`;
          body.allowed_mentions = { parse: [], roles: [cfg.statusAlertRoleId] };
        }
        await w.deps.discord.sendMessage(cfg.statusChannelId, body);
      },

      /** Post (first time) or edit (later) the incident message, add an update line, then fan out DMs. */
      async 'status.incident.notify'(job, w) {
        const { db, discord } = w.deps;
        const upd = await db.incidentUpdate.findUnique({ where: { id: str(job.payload, 'updateId') } });
        if (!upd || upd.notifiedAt) return;
        const incident = await db.incident.findUnique({
          where: { id: upd.incidentId },
          include: { services: refSelect, updates: { orderBy: { createdAt: 'desc' }, take: 10 } },
        });
        if (!incident) return;
        const pub = status.toPublicIncident(incident);
        const cfg = await getGuildConfig(db, incident.guildId);

        if (cfg.incidentChannelId) {
          const channelId = cfg.incidentChannelId;
          const embed = status.incidentEmbed(pub);
          let messageId = incident.channelId === channelId ? incident.messageId : null;
          let edited = false;
          if (messageId) {
            try {
              await discord.editMessage(channelId, messageId, { embeds: [embed] });
              edited = true;
            } catch (err) {
              w.log.warn(
                { err, incidentId: incident.id },
                'incident message could not be edited; posting a new one',
              );
              messageId = null;
            }
          }
          if (!messageId) {
            const msg = await discord.sendMessage(channelId, { embeds: [embed] });
            // Persist immediately so a retry edits instead of posting a duplicate.
            await db.incident.update({ where: { id: incident.id }, data: { channelId, messageId: msg.id } });
            messageId = msg.id;
          }
          if (edited) {
            await discord.sendMessage(channelId, {
              embeds: [status.incidentUpdateEmbed(pub, upd)],
              message_reference: { message_id: messageId, fail_if_not_exists: false },
            });
          }
        } else {
          w.log.warn(
            { guildId: incident.guildId },
            'no incident channel configured; incident visible via /status and dashboard only',
          );
        }

        await db.$transaction(async (tx) => {
          await tx.incidentUpdate.update({ where: { id: upd.id }, data: { notifiedAt: w.deps.now() } });
          await enqueueDmChunk(
            tx,
            incident.guildId,
            { kind: 'incident', incidentId: incident.id, updateId: upd.id },
            w.deps.now(),
          );
        });
      },

      /** DM one chunk of subscribers; enqueue the next chunk if there are more. DM failures are ignored. */
      async 'status.subscribers.notify'(job, w) {
        const { db, discord } = w.deps;
        const p = job.payload as unknown as DmPayload;
        let guildId: string;
        let recipients: string[];
        let body: MessageBody;

        if (p.kind === 'incident') {
          const incident = await db.incident.findUnique({
            where: { id: p.incidentId },
            include: { services: refSelect },
          });
          const upd = await db.incidentUpdate.findUnique({ where: { id: p.updateId } });
          if (!incident || !upd) return;
          const pub = status.toPublicIncident(incident);
          guildId = incident.guildId;
          recipients = await status.incidentRecipients(db, guildId, {
            severity: incident.severity,
            slugs: pub.services.map((s) => s.slug),
            afterUserId: p.after,
            limit: chunk + 1,
          });
          body = { embeds: [status.incidentDmEmbed(pub, upd)] };
        } else if (p.kind === 'maintenance') {
          const win = await db.maintenanceWindow.findUnique({
            where: { id: p.windowId },
            include: { services: refSelect },
          });
          if (!win) return;
          if (win.status === 'CANCELLED' && p.phase !== 'cancelled') return;
          const pub = status.toPublicMaintenance(win);
          guildId = win.guildId;
          recipients = await status.maintenanceRecipients(db, guildId, {
            slugs: pub.services.map((s) => s.slug),
            afterUserId: p.after,
            limit: chunk + 1,
          });
          body = { embeds: [status.maintenanceEmbed(pub, p.phase)] };
        } else {
          return;
        }

        const batch = recipients.slice(0, chunk);
        for (const userId of batch) {
          try {
            await discord.sendDm(userId, body);
          } catch (err) {
            w.log.debug({ err, userId }, 'status DM failed (ignored)');
          }
        }
        if (recipients.length > chunk && batch.length) {
          await enqueueDmChunk(db, guildId, { ...p, after: batch[batch.length - 1] }, w.deps.now());
        }
      },

      async 'status.maintenance.announce'(job, w) {
        const { db } = w.deps;
        const win = await db.maintenanceWindow.findUnique({
          where: { id: str(job.payload, 'windowId') },
          include: { services: refSelect },
        });
        if (!win || win.status === 'CANCELLED' || win.status === 'COMPLETED') return;
        const rescheduled = (job.payload as { rescheduled?: boolean }).rescheduled === true;
        if (!rescheduled && win.announcedAt) return;
        const phase: status.MaintenancePhase = rescheduled ? 'rescheduled' : 'scheduled';
        await postMaintenance(w, win.guildId, win, phase);
        await db.$transaction(async (tx) => {
          if (!win.announcedAt)
            await tx.maintenanceWindow.update({ where: { id: win.id }, data: { announcedAt: w.deps.now() } });
          await enqueueDmChunk(
            tx,
            win.guildId,
            { kind: 'maintenance', windowId: win.id, phase },
            w.deps.now(),
          );
        });
      },

      async 'status.maintenance.start'(job, w) {
        const win = await status.beginMaintenance(w.deps.db, str(job.payload, 'windowId'), w.deps.now());
        if (!win || win.startNotifiedAt) return;
        await postMaintenance(w, win.guildId, win, 'started');
        await w.deps.db.maintenanceWindow.update({
          where: { id: win.id },
          data: { startNotifiedAt: w.deps.now() },
        });
      },

      async 'status.maintenance.end'(job, w) {
        const res = await status.finishMaintenance(w.deps.db, str(job.payload, 'windowId'), w.deps.now());
        if (!res || !res.notify) return;
        await postMaintenance(w, res.window.guildId, res.window, 'completed');
        await w.deps.db.maintenanceWindow.update({
          where: { id: res.window.id },
          data: { endNotifiedAt: w.deps.now() },
        });
      },

      /** Only enqueued when the cancelled window had been announced. endNotifiedAt marks the notice as sent. */
      async 'status.maintenance.cancelled'(job, w) {
        const { db } = w.deps;
        const win = await db.maintenanceWindow.findUnique({
          where: { id: str(job.payload, 'windowId') },
          include: { services: refSelect },
        });
        if (!win || win.status !== 'CANCELLED' || !win.announcedAt || win.endNotifiedAt) return;
        await postMaintenance(w, win.guildId, win, 'cancelled');
        await db.$transaction(async (tx) => {
          await tx.maintenanceWindow.update({ where: { id: win.id }, data: { endNotifiedAt: w.deps.now() } });
          await enqueueDmChunk(
            tx,
            win.guildId,
            { kind: 'maintenance', windowId: win.id, phase: 'cancelled' },
            w.deps.now(),
          );
        });
      },
    },
    periodic: [
      {
        name: 'status.checks',
        intervalMs: (w) => Math.max(15, w.env.STATUS_CHECK_INTERVAL_SECONDS ?? 60) * 1000,
        async run(w, now) {
          const summary = await status.runStatusChecks(w.deps, w.env.DISCORD_GUILD_ID, now, {
            adapters: opts.adapters,
            checkOptions: opts.checkOptions,
            concurrency: 5,
          });
          if (summary.checked || summary.errors) w.log.debug({ ...summary }, 'status checks run');
        },
      },
      {
        name: 'status.retention',
        intervalMs: 6 * 60 * 60_000,
        async run(w, now) {
          const deleted = await status.purgeOldHealthChecks(w.deps.db, w.env.DISCORD_GUILD_ID, now);
          w.log.info({ deleted }, 'health check retention applied');
        },
      },
    ],
  };
}

export const statusJobs: WorkerModule = createStatusJobs();
