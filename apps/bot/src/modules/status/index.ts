import { SlashCommandBuilder, type AutocompleteInteraction, type ButtonInteraction } from 'discord.js';
import type { APIActionRowComponent, APIComponentInMessageActionRow } from 'discord.js';
import { CoreText, brandEmbed, status } from '@gynx/services';
import { respond, replySuccess } from '../../framework/reply';
import type { BotModule, HandlerCtx } from '../../framework/types';

/**
 * Member-facing status commands. Everything rendered here comes from the
 * public projections in `status.*` — monitoring internals never reach Discord.
 */

const RESOLVED_PAGE_SIZE = 5;

const severityChoices = status.INCIDENT_SEVERITIES.map((s) => ({ name: status.SEVERITY_LABEL[s], value: s }));
const periodChoices = [
  { name: 'Last 24 hours', value: 1 },
  { name: 'Last 7 days', value: 7 },
  { name: 'Last 30 days', value: 30 },
  { name: 'Last 90 days', value: 90 },
];

const statusCmd = new SlashCommandBuilder()
  .setName('status')
  .setDescription('Show the current status of GYNX.GG services');

const uptimeCmd = new SlashCommandBuilder()
  .setName('uptime')
  .setDescription('Show measured uptime for GYNX.GG services')
  .addStringOption((o) =>
    o.setName('service').setDescription('A specific service (default: all)').setAutocomplete(true),
  )
  .addIntegerOption((o) =>
    o
      .setName('period')
      .setDescription('Time period (default: 30 days)')
      .addChoices(...periodChoices),
  );

const incidentsCmd = new SlashCommandBuilder()
  .setName('incidents')
  .setDescription('Show active and recently resolved incidents');

const subscribeCmd = new SlashCommandBuilder()
  .setName('subscribe-status')
  .setDescription('Get a DM when incidents or maintenance affect GYNX.GG services')
  .addSubcommand((s) =>
    s
      .setName('add')
      .setDescription('Subscribe to status notifications')
      .addStringOption((o) =>
        o
          .setName('service')
          .setDescription('Service to follow (default: all services)')
          .setAutocomplete(true),
      )
      .addStringOption((o) =>
        o
          .setName('min_severity')
          .setDescription('Only notify for incidents at least this severe (default: Minor)')
          .addChoices(...severityChoices),
      )
      .addBooleanOption((o) =>
        o.setName('maintenance').setDescription('Also notify about scheduled maintenance (default: yes)'),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('remove')
      .setDescription('Unsubscribe from status notifications')
      .addStringOption((o) =>
        o
          .setName('service')
          .setDescription('Service to stop following (default: everything)')
          .setAutocomplete(true),
      ),
  )
  .addSubcommand((s) => s.setName('list').setDescription('Show your status subscriptions'));

async function serviceAutocomplete(i: AutocompleteInteraction, h: HandlerCtx, includeAll: boolean) {
  const focused = String(i.options.getFocused() ?? '');
  const services = await status.searchPublicServices(h.ctx.db, h.ctx.guildId, focused, includeAll ? 24 : 25);
  const choices = services.map((s) => ({ name: s.name.slice(0, 100), value: s.slug }));
  const allLabel = status.StatusText.allServices();
  const query = focused.toLowerCase();
  if (includeAll && (!focused || 'all services'.includes(query) || allLabel.toLowerCase().includes(query)))
    choices.unshift({ name: allLabel.slice(0, 100), value: 'all' });
  await i.respond(choices.slice(0, 25));
}

async function incidentsView(h: HandlerCtx, cursor: string | undefined, page: number) {
  const [active, resolved] = await Promise.all([
    page === 0 ? status.listActiveIncidents(h.ctx.db, h.ctx.guildId) : Promise.resolve([]),
    status.getIncidentHistory(h.ctx.db, h.ctx.guildId, {
      status: 'resolved',
      limit: RESOLVED_PAGE_SIZE,
      cursor,
    }),
  ]);
  const buttons: APIComponentInMessageActionRow[] = [];
  if (page > 0)
    buttons.push({
      type: 2,
      style: 2,
      label: status.StatusText.buttonNewest(),
      custom_id: 'statusui:inc:-:0',
    });
  if (resolved.nextCursor)
    buttons.push({
      type: 2,
      style: 1,
      label: status.StatusText.buttonOlder(),
      custom_id: `statusui:inc:${resolved.nextCursor}:${page + 1}`,
    });
  const components: APIActionRowComponent<APIComponentInMessageActionRow>[] = buttons.length
    ? [{ type: 1, components: buttons }]
    : [];
  return { embeds: [status.incidentsListEmbed(active, resolved.items, page)], components };
}

const subLabel = (slug: string, names: Map<string, string>) =>
  slug === status.ALL_SERVICES ? status.StatusText.allServices() : (names.get(slug) ?? slug);

export const statusModule: BotModule = {
  name: 'status',
  commands: [
    {
      module: 'status',
      data: statusCmd.toJSON(),
      async execute(i, h) {
        const s = await status.getPublicStatus(h.ctx.db, h.ctx.guildId, h.ctx.now());
        await respond(i, {
          embeds: [status.statusPageEmbed(s)],
          components: status.statusButtons(),
          ephemeral: false,
        });
      },
    },
    {
      module: 'status',
      data: uptimeCmd.toJSON(),
      async autocomplete(i, h) {
        await serviceAutocomplete(i, h, false);
      },
      async execute(i, h) {
        const days = i.options.getInteger('period') ?? 30;
        const slug = i.options.getString('service') ?? undefined;
        const rows = await status.getUptime(h.ctx.db, h.ctx.guildId, { slug, days }, h.ctx.now());
        await respond(i, { embeds: [status.uptimeEmbed(rows, days)] });
      },
    },
    {
      module: 'status',
      data: incidentsCmd.toJSON(),
      async execute(i, h) {
        await respond(i, await incidentsView(h, undefined, 0));
      },
    },
    {
      module: 'status',
      data: subscribeCmd.toJSON(),
      async autocomplete(i, h) {
        await serviceAutocomplete(i, h, true);
      },
      async execute(i, h) {
        const sub = i.options.getSubcommand(true);
        if (sub === 'add') {
          const s = await status.subscribe(h.ctx, {
            service: i.options.getString('service') ?? 'all',
            minSeverity: (i.options.getString('min_severity') ??
              'MINOR') as (typeof status.INCIDENT_SEVERITIES)[number],
            maintenance: i.options.getBoolean('maintenance') ?? true,
          });
          const services = await status.listPublicServices(h.ctx.db, h.ctx.guildId);
          const names = new Map(services.map((x) => [x.slug, x.name]));
          const vars = {
            severity: status.severityLabel(s.minSeverity),
            service: subLabel(s.serviceSlug, names),
          };
          await replySuccess(
            i,
            status.StatusText.subscribedTitle(),
            s.maintenance
              ? status.StatusText.subscribedBodyMaintenance(vars)
              : status.StatusText.subscribedBody(vars),
          );
          return;
        }
        if (sub === 'remove') {
          const service = i.options.getString('service') ?? 'everything';
          const n = await status.unsubscribe(h.ctx, service);
          await replySuccess(
            i,
            n ? status.StatusText.unsubscribedTitle() : status.StatusText.nothingToRemoveTitle(),
            n === 1
              ? status.StatusText.unsubscribedOne({ count: n })
              : n
                ? status.StatusText.unsubscribedMany({ count: n })
                : status.StatusText.nothingToRemoveBody(),
          );
          return;
        }
        const subs = await status.listMySubscriptions(h.ctx);
        const services = await status.listPublicServices(h.ctx.db, h.ctx.guildId);
        const names = new Map(services.map((x) => [x.slug, x.name]));
        const lines = subs.map((s) => {
          const vars = {
            service: subLabel(s.serviceSlug, names),
            severity: status.severityLabel(s.minSeverity),
          };
          return s.maintenance
            ? status.StatusText.subscriptionLineMaintenance(vars)
            : status.StatusText.subscriptionLine(vars);
        });
        await respond(i, {
          embeds: [
            brandEmbed({
              title: status.StatusText.subscriptionsTitle(),
              description: lines.join('\n') || status.StatusText.subscriptionsEmpty(),
            }),
          ],
        });
      },
    },
  ],
  components: [
    {
      prefix: 'statusui',
      module: 'status',
      async handle(i, args, h) {
        const [action, ...rest] = args;
        if (!i.isButton()) {
          await respond(i, { content: CoreText.controlExpired() });
          return;
        }
        if (action === 'sub') {
          await status.subscribe(h.ctx, { service: 'all' });
          await replySuccess(i, status.StatusText.subscribedTitle(), status.StatusText.quickSubscribedBody());
          return;
        }
        if (action === 'unsub') {
          const n = await status.unsubscribe(h.ctx, 'everything');
          await replySuccess(
            i,
            n ? status.StatusText.unsubscribedTitle() : status.StatusText.notSubscribedTitle(),
            n ? status.StatusText.quickUnsubscribedBody() : status.StatusText.notSubscribedBody(),
          );
          return;
        }
        if (action === 'history') {
          await respond(i, await incidentsView(h, undefined, 0));
          return;
        }
        if (action === 'inc') {
          const [cursor, pageRaw] = rest;
          const page = Math.max(0, Math.min(1000, Number(pageRaw) || 0));
          const view = await incidentsView(h, cursor && cursor !== '-' ? cursor : undefined, page);
          await (i as ButtonInteraction).update({ ...view, allowedMentions: { parse: [] } });
          return;
        }
        await respond(i, { content: CoreText.controlExpired() });
      },
    },
  ],
  events: [],
};
