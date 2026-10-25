import {
  MessageFlags,
  SlashCommandBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { CoreText, setup, support, type Ctx } from '@gynx/services';
import { AppError, truncate } from '@gynx/shared';
import { respond } from '../../framework/reply';
import type { BotModule, ComponentHandler, SlashCommand } from '../../framework/types';
import {
  SETUP_PREFIX,
  buildComponentSelect,
  buildControls,
  buildDisruptiveConfirm,
  renderOverview,
  renderPreview,
} from './view';

/**
 * /setup: guided provisioning of the server from the official blueprint.
 * Administrators only (COMMAND_POLICIES: setup.manage); every service call
 * re-checks `setup.manage` and the operation's guild/status, so customIds are
 * never trusted. Only the admin who opened a preview may use its controls.
 */
const T = support.SetupUiText;
const NO_PINGS = { parse: [] as never[] };
type PlanType = 'START' | 'REPAIR' | 'UPDATE';

const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Set up the server from the GYNX blueprint (administrators)')
  .addSubcommand((s) => s.setName('start').setDescription('Preview and apply the server setup'))
  .addSubcommand((s) =>
    s.setName('preview').setDescription('Show what setup would change, without changing anything'),
  )
  .addSubcommand((s) =>
    s.setName('status').setDescription('Setup progress and anything that needs attention'),
  )
  .addSubcommand((s) => s.setName('repair').setDescription('Restore missing or renamed setup resources'))
  .addSubcommand((s) => s.setName('update').setDescription('Apply a newer version of the blueprint'))
  .addSubcommand((s) =>
    s
      .setName('rollback')
      .setDescription('Undo a setup operation (default: the most recent one)')
      .addStringOption((o) =>
        o.setName('operation').setDescription('Operation to undo').setAutocomplete(true).setMaxLength(64),
      ),
  );

/** Preview message (embeds + controls). `withSelect` adds the component picker (not for rollback/stale). */
function previewMessage(
  p: setup.OperationPreview,
  opts: { withSelect?: boolean; selected?: string[]; notice?: string },
) {
  return {
    embeds: renderPreview(p, { notice: opts.notice }),
    components: [
      ...(opts.withSelect ? [buildComponentSelect(p.operationId, opts.selected)] : []),
      buildControls(p),
    ],
    allowedMentions: NO_PINGS,
  };
}

async function deferEphemeral(i: ChatInputCommandInteraction) {
  await i.deferReply({ flags: MessageFlags.Ephemeral });
}

const command: SlashCommand = {
  module: 'core',
  data: data.toJSON(),
  async autocomplete(i, h) {
    try {
      const q = i.options.getFocused().toLowerCase();
      const page = await setup.listOperations(h.ctx, { limit: 25 });
      await i.respond(
        page.items
          .filter((o) => o.type !== 'ROLLBACK' && o.status !== 'PREVIEWED' && o.status !== 'CANCELLED')
          .map((o) => ({
            name: truncate(
              `${o.type} · ${o.status} · ${o.startedAt.slice(0, 16).replace('T', ' ')} · ${o.id}`,
              100,
            ),
            value: o.id,
          }))
          .filter((c) => c.name.toLowerCase().includes(q))
          .slice(0, 25),
      );
    } catch {
      await i.respond([]);
    }
  },
  async execute(i, h) {
    const sub = i.options.getSubcommand(true);
    await deferEphemeral(i);

    if (sub === 'status') {
      await respond(i, { embeds: renderOverview(await setup.getSetupOverview(h.ctx)) });
      return;
    }
    if (sub === 'preview') {
      const p = await setup.previewOperation(h.ctx, { type: 'START' });
      await respond(i, { embeds: renderPreview(p, { readOnly: true }) });
      return;
    }
    if (sub === 'rollback') {
      const p = await setup.previewRollback(h.ctx, i.options.getString('operation') ?? undefined);
      await respond(i, previewMessage(p, {}));
      return;
    }
    const type: PlanType = sub === 'repair' ? 'REPAIR' : sub === 'update' ? 'UPDATE' : 'START';
    const p = await setup.previewOperation(h.ctx, { type });
    await respond(i, previewMessage(p, { withSelect: true }));
  },
};

/** Loads the operation (service checks permission + guild) and ensures the presser opened it. */
async function ownOperation(ctx: Ctx, operationId: string) {
  const op = await setup.getOperation(ctx, operationId);
  if (op.initiatedByUserId !== ctx.actor.userId) throw new AppError('FORBIDDEN', T.notYourPreview());
  return op;
}

async function confirm(
  i: ButtonInteraction,
  ctx: Ctx,
  operationId: string,
  acceptDisruptive: boolean,
): Promise<void> {
  const r = await setup.confirmOperation(ctx, operationId, { acceptDisruptive });
  if (r.status === 'STALE') {
    await i.editReply(previewMessage(r.preview, { notice: T.staleNotice() }));
    return;
  }
  await i.editReply({
    content: T.started({ id: r.operationId }),
    embeds: [],
    components: [],
    allowedMentions: NO_PINGS,
  });
}

const components: ComponentHandler = {
  prefix: SETUP_PREFIX,
  module: 'core',
  async handle(i, args, h) {
    const [action, operationId] = args;
    if (!operationId || !(i.isButton() || i.isStringSelectMenu()))
      throw new AppError('NOT_FOUND', CoreText.controlExpired());
    // Cheap checks first so their errors arrive as a fresh ephemeral reply.
    const op = await ownOperation(h.ctx, operationId);

    if (action === 'select' && i.isStringSelectMenu()) {
      if (op.type === 'ROLLBACK') throw new AppError('NOT_FOUND', CoreText.controlExpired());
      const selection = pickSelection(i);
      await i.deferUpdate();
      await setup.cancelOperation(h.ctx, operationId).catch(() => undefined); // superseded preview
      const p = await setup.previewOperation(h.ctx, { type: op.type, selection });
      await i.editReply(previewMessage(p, { withSelect: true, selected: selection }));
      return;
    }

    if (action === 'confirm' && i.isButton()) {
      const p = op.preview;
      if (p.plan.blocked) throw new AppError('INVALID_STATE', T.blockedConfirm());
      if (p.requiresDisruptiveConsent) {
        await i.update({ ...buildDisruptiveConfirm(p), allowedMentions: NO_PINGS });
        return;
      }
      await i.deferUpdate();
      await confirm(i, h.ctx, operationId, false);
      return;
    }

    if (action === 'confirm2' && i.isButton()) {
      await i.deferUpdate();
      await confirm(i, h.ctx, operationId, true);
      return;
    }

    if (action === 'cancel' && i.isButton()) {
      await setup.cancelOperation(h.ctx, operationId);
      await i.update({ content: T.cancelled(), embeds: [], components: [], allowedMentions: NO_PINGS });
      return;
    }

    throw new AppError('NOT_FOUND', CoreText.controlExpired());
  },
};

/** Selected component keys, limited to known components (never trust submitted values). */
function pickSelection(i: StringSelectMenuInteraction): setup.ComponentKey[] {
  const known = new Set<string>(setup.COMPONENT_KEYS);
  const picked = i.values.filter((v): v is setup.ComponentKey => known.has(v));
  if (!picked.length) throw new AppError('VALIDATION', CoreText.controlExpired());
  return picked;
}

export const setupModule: BotModule = {
  name: 'setup',
  commands: [command],
  components: [components],
};
