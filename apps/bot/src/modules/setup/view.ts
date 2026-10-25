import type {
  APIActionRowComponent,
  APIButtonComponent,
  APIEmbed,
  APIStringSelectComponent,
} from 'discord-api-types/v10';
import { brandEmbed, setup, support } from '@gynx/services';
import { EMBED_COLORS, discordTimestamp, truncate } from '@gynx/shared';

/**
 * Pure rendering for /setup: previews, controls and the status overview.
 * Everything here respects Discord's embed limits (field value 1024, 25 fields,
 * description 4096, 6000 characters per message across all embeds).
 */
const T = support.SetupUiText;

export const SETUP_PREFIX = 'setupwiz';
export const EMBED_TOTAL_LIMIT = 6000;
const FIELD_LIMIT = 1024;
const MAX_FIELDS = 25;

type Preview = setup.OperationPreview;
type Change = setup.PlannedChange;
type Finding = setup.Finding;

export const customId = (action: 'select' | 'confirm' | 'confirm2' | 'cancel', operationId: string) =>
  `${SETUP_PREFIX}:${action}:${operationId}`;

/**
 * Lines joined with newlines, cut to `max` characters with a "+N more" tail.
 * Always returns at least the "+N more" line when items exist.
 */
export function listValue(lines: readonly string[], max: number = FIELD_LIMIT): string {
  if (!lines.length) return T.noneValue();
  const out: string[] = [];
  let used = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = truncate(lines[i]!, Math.min(200, max));
    const rest = lines.length - i - 1;
    const tail = rest > 0 ? `\n${T.moreItems({ count: rest })}`.length : 0;
    const add = (out.length ? 1 : 0) + line.length;
    if (used + add + tail > max) {
      const more = T.moreItems({ count: lines.length - i });
      return out.length ? `${out.join('\n')}\n${more}` : truncate(more, max);
    }
    out.push(line);
    used += add;
  }
  return out.join('\n');
}

/** Characters Discord counts toward the 6000 per-message limit. */
export function embedLength(e: APIEmbed): number {
  return (
    (e.title?.length ?? 0) +
    (e.description?.length ?? 0) +
    (e.footer?.text.length ?? 0) +
    (e.author?.name.length ?? 0) +
    (e.fields ?? []).reduce((n, f) => n + f.name.length + f.value.length, 0)
  );
}

/** Last-resort guard: drop trailing fields (then embeds) until the message fits. */
export function fitEmbeds(embeds: APIEmbed[], limit = EMBED_TOTAL_LIMIT): APIEmbed[] {
  const out = embeds.map((e) => ({ ...e, fields: e.fields ? [...e.fields] : undefined }));
  const total = () => out.reduce((n, e) => n + embedLength(e), 0);
  while (total() > limit && out.length) {
    const last = out[out.length - 1]!;
    if (last.fields?.length) last.fields.pop();
    else if (last.description && last.description.length > 200)
      last.description = truncate(last.description, Math.max(1, last.description.length - (total() - limit)));
    else out.pop();
  }
  return out;
}

const tag = (c: { risk: string }) => (c.risk === 'disruptive' ? ` ⚠️ ${T.disruptiveTag()}` : '');
const ICON: Record<string, string> = {
  create: '➕',
  adopt: '🔗',
  update: '✏️',
  position: '↕️',
};
const iconFor = (kind: string) => ICON[kind.split('.')[1] ?? ''] ?? '•';
const line = (c: Change) => `${iconFor(c.kind)} ${c.description}${tag(c)}`;

/** Category display name for each blueprint channel/category key (with and without prefix). */
function categoryLookup(): Map<string, string> {
  const m = new Map<string, string>();
  for (const cat of setup.BLUEPRINT_CATEGORIES) {
    m.set(setup.categoryKey(cat.key), cat.name);
    m.set(cat.key, cat.name);
    for (const ch of cat.channels) m.set(setup.channelKey(ch.key), cat.name);
  }
  return m;
}

const FINDING_ORDER: Record<string, number> = { blocking: 0, warning: 1, info: 2 };
const FINDING_ICON: Record<string, string> = { blocking: '⛔', warning: '⚠️', info: 'ℹ️' };
export const sortFindings = (f: readonly Finding[]) =>
  [...f].sort((a, b) => (FINDING_ORDER[a.level] ?? 3) - (FINDING_ORDER[b.level] ?? 3));
const findingLine = (f: Finding) => `${FINDING_ICON[f.level] ?? '•'} ${f.message}`;

function previewTitle(type: Preview['type']): string {
  if (type === 'REPAIR') return T.previewTitleRepair();
  if (type === 'UPDATE') return T.previewTitleUpdate();
  if (type === 'ROLLBACK') return T.previewTitleRollback();
  return T.previewTitleStart();
}

/** Preview embeds: summary, roles, channels by category, permissions, messages, findings. */
export function renderPreview(
  preview: Preview,
  opts: { readOnly?: boolean; notice?: string } = {},
): APIEmbed[] {
  const { plan, summary } = preview;
  const changes = plan.changes;
  const of = (...kinds: string[]) => changes.filter((c) => kinds.includes(c.kind));

  const intro = [
    opts.notice,
    changes.length ? T.summaryLine({ ...summary, inPlace: plan.inPlace.length }) : T.nothingToDo(),
    plan.blocked ? T.blockedNotice() : undefined,
    !plan.blocked && preview.requiresDisruptiveConsent
      ? T.disruptiveNotice({ count: summary.disruptive })
      : undefined,
    opts.readOnly ? T.readOnlyNotice() : undefined,
  ].filter(Boolean);

  const roles = of('role.create', 'role.adopt', 'role.update', 'role.position');
  const overwrites = of('overwrite.set').length;
  const grants = of('grant.set').length;
  const messages = of('message.deploy');
  const bindings = of('binding.set').length;
  const templates = of('template.create').length;

  const summaryFields: Array<{ name: string; value: string; inline?: boolean }> = [
    { name: T.rolesField(), value: listValue(roles.map(line), 700) },
    { name: T.permissionsField(), value: T.permissionsValue({ overwrites, grants }), inline: true },
    { name: T.configField(), value: T.configValue({ bindings, templates }), inline: true },
    { name: T.messagesField(), value: listValue(messages.map(line), 400) },
  ];
  const embeds: APIEmbed[] = [
    brandEmbed({
      title: previewTitle(preview.type),
      description: truncate(intro.join('\n\n'), 1200),
      color: plan.blocked
        ? EMBED_COLORS.danger
        : preview.requiresDisruptiveConsent
          ? EMBED_COLORS.warning
          : EMBED_COLORS.primary,
      fields: summaryFields,
      footer: `v${preview.blueprintVersion} · ${preview.operationId}`,
    }),
  ];

  // Channels grouped by category, in blueprint order; budget shared across categories.
  const lookup = categoryLookup();
  const groups = new Map<string, string[]>();
  for (const c of of('channel.create', 'channel.adopt', 'channel.update')) {
    const parent = c.kind === 'channel.create' && c.parentKey ? c.parentKey : c.key;
    const cat = lookup.get(parent) ?? lookup.get(c.key) ?? T.otherCategory();
    groups.set(cat, [...(groups.get(cat) ?? []), line(c)]);
  }
  if (groups.size) {
    const order = setup.BLUEPRINT_CATEGORIES.map((c) => c.name);
    const rank = (name: string) => (order.includes(name) ? order.indexOf(name) : order.length);
    const entries = [...groups.entries()].sort((x, y) => rank(x[0]) - rank(y[0]));
    const shown = entries.slice(0, MAX_FIELDS - 1);
    const budget = Math.min(FIELD_LIMIT, Math.max(120, Math.floor(1800 / shown.length)));
    const fields = shown.map(([name, lines]) => ({
      name: truncate(name, 100),
      value: listValue(lines, budget),
    }));
    if (entries.length > shown.length) {
      const hidden = entries.slice(shown.length).reduce((n, [, l]) => n + l.length, 0);
      fields.push({ name: T.otherCategory(), value: T.moreItems({ count: hidden }) });
    }
    embeds.push(brandEmbed({ title: T.channelsTitle(), fields }));
  }

  const findings = sortFindings(plan.findings);
  if (findings.length || plan.missingBotPermissions.length) {
    const fields = plan.missingBotPermissions.length
      ? [{ name: T.missingPermsField(), value: listValue(plan.missingBotPermissions, 300) }]
      : [];
    embeds.push(
      brandEmbed({
        title: T.findingsTitle(),
        description: findings.length ? listValue(findings.map(findingLine), 1000) : undefined,
        color: findings.some((f) => f.level === 'blocking') ? EMBED_COLORS.danger : EMBED_COLORS.warning,
        fields,
      }),
    );
  }
  return fitEmbeds(embeds);
}

/** Multi-select of setup components (min 1). `selected` empty/undefined = everything selected. */
export function buildComponentSelect(
  operationId: string,
  selected?: readonly string[],
): APIActionRowComponent<APIStringSelectComponent> {
  const options = setup.COMPONENTS.slice(0, 25);
  const all = !selected?.length;
  return {
    type: 1,
    components: [
      {
        type: 3,
        custom_id: customId('select', operationId),
        placeholder: truncate(T.selectPlaceholder(), 150),
        min_values: 1,
        max_values: options.length,
        options: options.map((c) => ({
          label: truncate(c.label, 100),
          value: c.key,
          default: all || selected.includes(c.key),
        })),
      },
    ],
  };
}

/** Confirm (unless blocked) and Cancel buttons. */
export function buildControls(preview: Preview): APIActionRowComponent<APIButtonComponent> {
  const buttons: APIButtonComponent[] = [];
  if (!preview.plan.blocked && preview.plan.changes.length)
    buttons.push({
      type: 2,
      style: 3,
      label: truncate(T.confirmButton(), 80),
      custom_id: customId('confirm', preview.operationId),
    });
  buttons.push({
    type: 2,
    style: 2,
    label: truncate(T.cancelButton(), 80),
    custom_id: customId('cancel', preview.operationId),
  });
  return { type: 1, components: buttons };
}

/** Second confirmation for disruptive changes. */
export function buildDisruptiveConfirm(preview: Preview): {
  content: string;
  components: APIActionRowComponent<APIButtonComponent>[];
} {
  return {
    content: T.disruptivePrompt({ count: preview.summary.disruptive }),
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 4,
            label: truncate(T.confirmDisruptiveButton(), 80),
            custom_id: customId('confirm2', preview.operationId),
          },
          {
            type: 2,
            style: 2,
            label: truncate(T.cancelButton(), 80),
            custom_id: customId('cancel', preview.operationId),
          },
        ],
      },
    ],
  };
}

const stateLabel = (s: string) =>
  s === 'missing'
    ? T.stateMissing()
    : s === 'renamed'
      ? T.stateRenamed()
      : s === 'deployed'
        ? T.stateDeployed()
        : s === 'not-configured'
          ? T.stateNotConfigured()
          : s;

/** /setup status overview. */
export function renderOverview(o: setup.SetupOverview): APIEmbed[] {
  const attention = <R extends { state: string }>(items: readonly R[]) =>
    items.filter((r) => r.state === 'missing' || r.state === 'renamed');
  const roles = attention(o.roles).map((r) => `• ${r.name} (${stateLabel(r.state)})`);
  const channels = attention(o.channels).map((c) => `• ${c.name} · ${c.category} (${stateLabel(c.state)})`);
  const panels = o.panels.map(
    (p) =>
      `${p.state === 'deployed' ? '✅' : p.state === 'missing' ? '❌' : '➖'} ${p.key} (${stateLabel(p.state)})${p.channelId ? ` · <#${p.channelId}>` : ''}`,
  );
  const good = T.allGood();
  const lines = [
    T.statusLine({
      percent: Math.round(o.completionPercent),
      status: o.status,
      deployed: o.deployedBlueprintVersion ?? T.notDeployed(),
      latest: o.blueprintVersion,
    }),
    o.lastVerifiedAt
      ? T.lastVerified({ time: discordTimestamp(new Date(o.lastVerifiedAt), 'R') })
      : undefined,
  ].filter(Boolean);
  const fields = [
    { name: T.rolesAttention(), value: roles.length ? listValue(roles, 700) : good },
    { name: T.channelsAttention(), value: channels.length ? listValue(channels, 900) : good },
    { name: T.panelsField(), value: listValue(panels, 600) },
    {
      name: T.permissionFindingsField(),
      value: o.permissionFindings.length
        ? listValue(sortFindings(o.permissionFindings).map(findingLine), 900)
        : good,
    },
    {
      name: T.outstandingField(),
      value: o.outstanding.length ? listValue(sortFindings(o.outstanding).map(findingLine), 900) : good,
    },
  ];
  if (o.lastOperation)
    fields.push({
      name: T.lastOperationField(),
      value: T.lastOperationValue({
        type: o.lastOperation.type,
        status: o.lastOperation.status,
        started: discordTimestamp(new Date(o.lastOperation.startedAt), 'R'),
      }),
    });
  return fitEmbeds([
    brandEmbed({
      title: T.statusTitle(),
      description: lines.join('\n'),
      color:
        o.status === 'COMPLETE'
          ? EMBED_COLORS.success
          : o.status === 'FAILED'
            ? EMBED_COLORS.danger
            : EMBED_COLORS.primary,
      fields,
    }),
  ]);
}
