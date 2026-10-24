import { z } from 'zod';
import { can, getGuildConfig, status } from '@gynx/services';
import { validation } from '@gynx/shared';
import { defineRoute } from '../settings/define-route';
import { fromLocalInput, toServiceView } from './views';

/**
 * Status & incidents API. Services re-check every permission; routes with an
 * any-of requirement declare `dashboard.access` and let the service enforce it.
 */

const id = (params: Record<string, string>) => params.id ?? '';

// ── Services ─────────────────────────────────────────────────────────────────

/** GET /api/status/services — services (target only with status.manage). Any of status.manage / incidents.view / incidents.manage. */
export const listServicesRoute = defineRoute({ permission: 'dashboard.access' }, async ({ ctx }) => {
  const rows = await status.listServices(ctx);
  const seeTarget = can(ctx, 'status.manage');
  return { services: rows.map((s) => toServiceView(s, seeTarget)) };
});

/** POST /api/status/services (status.manage; allowPrivate additionally needs settings.manage — enforced by the service). */
export const createServiceRoute = defineRoute(
  { permission: 'status.manage', schema: status.createServiceSchema },
  async ({ ctx, input }) => toServiceView(await status.createService(ctx, input), true),
);

/** PATCH /api/status/services/:id (status.manage). */
export const updateServiceRoute = defineRoute(
  { permission: 'status.manage', schema: status.updateServiceSchema },
  async ({ ctx, input, params }) => toServiceView(await status.updateService(ctx, id(params), input), true),
);

/** DELETE /api/status/services/:id (status.manage). */
export const deleteServiceRoute = defineRoute({ permission: 'status.manage' }, async ({ ctx, params }) => {
  await status.deleteService(ctx, id(params));
  return { ok: true };
});

/** POST /api/status/services/:id/state { state } — MANUAL services only. Any of status.manage / incidents.manage. */
export const setServiceStateRoute = defineRoute(
  { permission: 'dashboard.access', mutation: true, schema: status.setStateSchema },
  async ({ ctx, input, params }) =>
    toServiceView(await status.setManualState(ctx, id(params), input), can(ctx, 'status.manage')),
);

// ── Incidents ────────────────────────────────────────────────────────────────

/** Query-string variant of the staff list schema ("active=true"). */
export const incidentListQuerySchema = status.staffIncidentListSchema.extend({
  active: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

/** GET /api/status/incidents — any of incidents.view / incidents.manage. */
export const listIncidentsRoute = defineRoute(
  { permission: 'dashboard.access', schema: incidentListQuerySchema },
  async ({ ctx, input }) => status.listIncidents(ctx, input),
);

/** POST /api/status/incidents (incidents.manage). */
export const createIncidentRoute = defineRoute(
  { permission: 'incidents.manage', schema: status.createIncidentSchema },
  async ({ ctx, input }) => status.createIncident(ctx, input),
);

/** GET /api/status/incidents/:id — any of incidents.view / incidents.manage. */
export const getIncidentRoute = defineRoute({ permission: 'dashboard.access' }, async ({ ctx, params }) =>
  status.getIncident(ctx, id(params)),
);

/** PATCH /api/status/incidents/:id { title?, serviceSlugs?, regions? } (incidents.manage). */
export const editIncidentRoute = defineRoute(
  { permission: 'incidents.manage', schema: status.editIncidentSchema },
  async ({ ctx, input, params }) => status.editIncident(ctx, id(params), input),
);

/** POST /api/status/incidents/:id/updates { status, message, resolutionSummary?, severity? } (incidents.manage). */
export const addIncidentUpdateRoute = defineRoute(
  { permission: 'incidents.manage', schema: status.incidentUpdateSchema },
  async ({ ctx, input, params }) => {
    if (input.status === 'RESOLVED' && !input.resolutionSummary) {
      throw validation('A resolution summary is required to resolve an incident.');
    }
    const { incident, update } = await status.addIncidentUpdate(ctx, id(params), input);
    return { incident, update };
  },
);

// ── Maintenance ──────────────────────────────────────────────────────────────

const localDateTime = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}$/, 'Use the date and time picker (YYYY-MM-DD HH:MM).');
const maintenanceFields = {
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(3).max(2000),
  /** Wall-clock time in the guild time zone. */
  startsLocal: localDateTime,
  endsLocal: localDateTime,
  serviceSlugs: z.array(z.string().trim().toLowerCase().max(40)).max(25).default([]),
};
export const maintenanceCreateBody = z.object(maintenanceFields);
export const maintenanceUpdateBody = z.object(maintenanceFields).partial();

async function toUtc(
  ctx: Parameters<typeof status.createMaintenance>[0],
  local: string | undefined,
  field: string,
): Promise<Date | undefined> {
  if (local === undefined) return undefined;
  const { timezone } = await getGuildConfig(ctx.db, ctx.guildId);
  const d = fromLocalInput(local, timezone);
  if (!d) throw validation(`The ${field} time is not a valid date.`);
  return d;
}

/** GET /api/status/maintenance — any of incidents.view / incidents.manage. */
export const listMaintenanceRoute = defineRoute(
  { permission: 'dashboard.access', schema: status.listMaintenanceSchema },
  async ({ ctx, input }) => status.listMaintenance(ctx, input),
);

/** POST /api/status/maintenance (incidents.manage). Times are guild-local and converted here. */
export const createMaintenanceRoute = defineRoute(
  { permission: 'incidents.manage', schema: maintenanceCreateBody },
  async ({ ctx, input }) => {
    const startsAt = (await toUtc(ctx, input.startsLocal, 'start'))!;
    const endsAt = (await toUtc(ctx, input.endsLocal, 'end'))!;
    return status.createMaintenance(ctx, {
      title: input.title,
      description: input.description,
      serviceSlugs: input.serviceSlugs,
      startsAt,
      endsAt,
    });
  },
);

/** PATCH /api/status/maintenance/:id (incidents.manage). In-progress windows may only change text and end time (service rule). */
export const updateMaintenanceRoute = defineRoute(
  { permission: 'incidents.manage', schema: maintenanceUpdateBody },
  async ({ ctx, input, params }) => {
    const startsAt = await toUtc(ctx, input.startsLocal, 'start');
    const endsAt = await toUtc(ctx, input.endsLocal, 'end');
    return status.updateMaintenance(ctx, id(params), {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.serviceSlugs !== undefined ? { serviceSlugs: input.serviceSlugs } : {}),
      ...(startsAt ? { startsAt } : {}),
      ...(endsAt ? { endsAt } : {}),
    });
  },
);

/** POST /api/status/maintenance/:id/cancel — scheduled windows only (incidents.manage). */
export const cancelMaintenanceRoute = defineRoute(
  { permission: 'incidents.manage' },
  async ({ ctx, params }) => status.cancelMaintenance(ctx, id(params)),
);

/** POST /api/status/maintenance/:id/end — end an in-progress window now (incidents.manage). */
export const endMaintenanceRoute = defineRoute({ permission: 'incidents.manage' }, async ({ ctx, params }) =>
  status.endMaintenanceNow(ctx, id(params)),
);
