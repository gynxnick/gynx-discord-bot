import { z } from 'zod';
import {
  isUniqueViolation,
  type Db,
  type KnowledgeArticle,
  type Prisma,
  type TroubleshootingFlow,
  type TroubleshootingSession,
} from '@gynx/database';
import { conflict, forbidden, invalidState, notFound, validation } from '@gynx/shared';
import { audit } from '../core/audit';
import { can, requirePermission, requireRate } from '../core/authz';
import { getGuildConfig, requireModule } from '../core/config';
import type { Ctx } from '../core/context';
import { gameKeySchema, supportUrlOf } from './common';
import {
  flowDefinitionSchema,
  referencedArticleSlugs,
  slugSchema,
  validateFlowDefinition,
  type FlowDefinition,
  type FlowNode,
} from './flow-definition';

export const SESSION_IDLE_MS = 24 * 3_600_000;

export const flowInputSchema = z.object({
  slug: slugSchema,
  title: z.string().trim().min(3).max(100),
  game: gameKeySchema.nullish(),
  description: z.string().trim().min(5).max(300),
  definition: z.unknown(),
  published: z.boolean().default(false),
});
export type FlowInput = z.input<typeof flowInputSchema>;
export const flowUpdateSchema = flowInputSchema.partial();

/** Validate structure and that every referenced article exists in this guild. */
async function checkDefinition(db: Db, guildId: string, raw: unknown): Promise<FlowDefinition> {
  const v = validateFlowDefinition(raw);
  if (!v.ok || !v.definition) throw validation(`The flow is invalid: ${v.errors.slice(0, 5).join(' ')}`, { errors: v.errors });
  const slugs = referencedArticleSlugs(v.definition);
  if (slugs.length) {
    const found = await db.knowledgeArticle.findMany({ where: { guildId, slug: { in: slugs } }, select: { slug: true } });
    const missing = slugs.filter((s) => !found.some((f) => f.slug === s));
    if (missing.length) throw validation(`The flow links unknown articles: ${missing.join(', ')}`);
  }
  return v.definition;
}

export async function createFlow(ctx: Ctx, raw: FlowInput): Promise<TroubleshootingFlow> {
  await requirePermission(ctx, 'troubleshooting.manage', 'troubleshooting.flow.create');
  const input = flowInputSchema.parse(raw);
  const definition = await checkDefinition(ctx.db, ctx.guildId, input.definition);
  try {
    return await ctx.db.$transaction(async (tx) => {
      const f = await tx.troubleshootingFlow.create({
        data: {
          guildId: ctx.guildId,
          slug: input.slug,
          title: input.title,
          game: input.game ?? null,
          description: input.description,
          definition: definition as Prisma.InputJsonValue,
          published: input.published,
        },
      });
      await audit(ctx, { action: 'troubleshooting.flow.create', targetType: 'TroubleshootingFlow', targetId: f.id, metadata: { slug: f.slug, nodes: Object.keys(definition.nodes).length } }, tx);
      return f;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict(`A flow with the slug "${input.slug}" already exists.`);
    throw e;
  }
}

export async function updateFlow(ctx: Ctx, id: string, raw: z.input<typeof flowUpdateSchema>): Promise<TroubleshootingFlow> {
  await requirePermission(ctx, 'troubleshooting.manage', 'troubleshooting.flow.update');
  const input = flowUpdateSchema.parse(raw);
  const existing = await ctx.db.troubleshootingFlow.findFirst({ where: { id, guildId: ctx.guildId } });
  if (!existing) throw notFound('Flow');
  const definition = input.definition !== undefined ? await checkDefinition(ctx.db, ctx.guildId, input.definition) : undefined;
  try {
    return await ctx.db.$transaction(async (tx) => {
      const f = await tx.troubleshootingFlow.update({
        where: { id: existing.id },
        data: {
          slug: input.slug,
          title: input.title,
          game: input.game === undefined ? undefined : (input.game ?? null),
          description: input.description,
          published: input.published,
          ...(definition ? { definition: definition as Prisma.InputJsonValue, version: { increment: 1 } } : {}),
        },
      });
      await audit(ctx, { action: 'troubleshooting.flow.update', targetType: 'TroubleshootingFlow', targetId: f.id, metadata: { slug: f.slug, version: f.version, fields: Object.keys(input) } }, tx);
      return f;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict(`A flow with the slug "${input.slug}" already exists.`);
    throw e;
  }
}

export async function deleteFlow(ctx: Ctx, id: string): Promise<void> {
  await requirePermission(ctx, 'troubleshooting.manage', 'troubleshooting.flow.delete');
  const f = await ctx.db.troubleshootingFlow.findFirst({ where: { id, guildId: ctx.guildId } });
  if (!f) throw notFound('Flow');
  await ctx.db.$transaction(async (tx) => {
    await tx.troubleshootingFlow.delete({ where: { id: f.id } });
    await audit(ctx, { action: 'troubleshooting.flow.delete', targetType: 'TroubleshootingFlow', targetId: f.id, metadata: { slug: f.slug } }, tx);
  });
}

/** Published flows for members; managers may include drafts. */
export async function listFlows(ctx: Ctx, opts: { game?: string; includeDrafts?: boolean } = {}): Promise<TroubleshootingFlow[]> {
  await requireModule(ctx, 'troubleshooting');
  const game = opts.game ? gameKeySchema.parse(opts.game) : undefined;
  const drafts = opts.includeDrafts && can(ctx, 'troubleshooting.manage');
  return ctx.db.troubleshootingFlow.findMany({
    where: { guildId: ctx.guildId, ...(drafts ? {} : { published: true }), ...(game ? { OR: [{ game }, { game: null }] } : {}) },
    orderBy: [{ game: 'asc' }, { title: 'asc' }],
    take: 25,
  });
}

/** Per-flow outcome counts for the dashboard. */
export async function flowStats(ctx: Ctx) {
  await requirePermission(ctx, 'troubleshooting.manage');
  const rows = await ctx.db.troubleshootingSession.groupBy({
    by: ['flowId', 'outcome'],
    where: { guildId: ctx.guildId },
    _count: { _all: true },
  });
  return rows.map((r) => ({ flowId: r.flowId, outcome: r.outcome, count: r._count._all }));
}

// ───────────────────────────── Sessions ─────────────────────────────

export interface ArticleRef {
  slug: string;
  title: string;
  summary: string;
  url: string | null;
}

export type StepView =
  | { kind: 'node'; sessionId: string; flowTitle: string; nodeId: string; prompt: string; options: Array<{ index: number; label: string }>; hint: ArticleRef | null }
  | { kind: 'resolved'; sessionId: string; flowTitle: string; article: ArticleRef | null; supportUrl: string | null }
  | { kind: 'escalated'; sessionId: string; flowTitle: string; article: ArticleRef | null; supportUrl: string | null };

const toRef = (a: KnowledgeArticle | null): ArticleRef | null =>
  a && a.published ? { slug: a.slug, title: a.title, summary: a.summary, url: a.url } : null;

async function articleRef(ctx: Ctx, slug: string | undefined): Promise<ArticleRef | null> {
  if (!slug) return null;
  return toRef(await ctx.db.knowledgeArticle.findFirst({ where: { guildId: ctx.guildId, slug } }));
}

function parseStored(flow: TroubleshootingFlow): FlowDefinition {
  const r = flowDefinitionSchema.safeParse(flow.definition);
  if (!r.success) throw invalidState('This troubleshooting flow is misconfigured. Please contact the support team.');
  return r.data;
}

const nodeView = (session: Pick<TroubleshootingSession, 'id'>, flow: TroubleshootingFlow, nodeId: string, node: FlowNode, hint: ArticleRef | null): StepView => ({
  kind: 'node',
  sessionId: session.id,
  flowTitle: flow.title,
  nodeId,
  prompt: node.prompt,
  options: node.options.map((o, index) => ({ index, label: o.label })),
  hint,
});

export async function startSession(ctx: Ctx, flowSlug: string): Promise<StepView> {
  await requireModule(ctx, 'troubleshooting');
  const slug = slugSchema.parse(flowSlug);
  await requireRate(ctx, 'troubleshooting.session', 10, 60);
  const flow = await ctx.db.troubleshootingFlow.findFirst({ where: { guildId: ctx.guildId, slug, published: true } });
  if (!flow) throw notFound('Troubleshooting flow');
  const def = parseStored(flow);
  const start = def.nodes[def.start];
  if (!start) throw invalidState('This troubleshooting flow is misconfigured. Please contact the support team.');

  const session = await ctx.db.$transaction(async (tx) => {
    // One active session per member per flow: restarting abandons the old one.
    await tx.troubleshootingSession.updateMany({
      where: { guildId: ctx.guildId, userId: ctx.actor.userId, flowId: flow.id, outcome: 'IN_PROGRESS' },
      data: { outcome: 'ABANDONED' },
    });
    return tx.troubleshootingSession.create({
      data: { guildId: ctx.guildId, userId: ctx.actor.userId, flowId: flow.id, currentNode: def.start, path: [] },
    });
  });
  return nodeView(session, flow, def.start, start, null);
}

async function loadOwnSession(ctx: Ctx, sessionId: string) {
  await requireModule(ctx, 'troubleshooting');
  const id = z.string().min(1).max(40).parse(sessionId);
  const s = await ctx.db.troubleshootingSession.findFirst({ where: { id, guildId: ctx.guildId }, include: { flow: true } });
  if (!s) throw notFound('Troubleshooting session');
  if (s.userId !== ctx.actor.userId) {
    await audit(ctx, { action: 'troubleshooting.session.advance', result: 'DENIED', targetType: 'TroubleshootingSession', targetId: s.id, metadata: { reason: 'not-owner' } });
    throw forbidden('Only the member who started this troubleshooting session can continue it. Run /troubleshoot to start your own.');
  }
  return s;
}

/**
 * Advance a session by picking an option on the current node. Only the owner
 * may advance. `expectedNode` (from the button) rejects stale clicks.
 */
export async function chooseOption(ctx: Ctx, sessionId: string, optionIndex: number, expectedNode?: string): Promise<StepView> {
  const idx = z.number().int().min(0).max(4).parse(optionIndex);
  const s = await loadOwnSession(ctx, sessionId);
  if (s.outcome !== 'IN_PROGRESS') throw invalidState('This troubleshooting session has ended. Run /troubleshoot to start again.');
  if (expectedNode !== undefined && expectedNode !== s.currentNode) throw invalidState('That step is no longer current — use the latest message.');

  const def = parseStored(s.flow);
  const node = def.nodes[s.currentNode];
  if (!node) {
    await ctx.db.troubleshootingSession.update({ where: { id: s.id }, data: { outcome: 'ABANDONED' } });
    throw invalidState('This flow was updated while you were using it. Please run /troubleshoot again.');
  }
  const option = node.options[idx];
  if (!option) throw validation('That option does not exist.');

  const nextNodeId = option.next;
  const outcome = nextNodeId ? 'IN_PROGRESS' : option.escalate ? 'ESCALATED' : 'RESOLVED';
  // Conditional update: two concurrent clicks cannot both advance from the same node.
  const res = await ctx.db.troubleshootingSession.updateMany({
    where: { id: s.id, currentNode: s.currentNode, outcome: 'IN_PROGRESS' },
    data: { currentNode: nextNodeId ?? s.currentNode, path: { push: `${s.currentNode}:${idx}` }, outcome },
  });
  if (res.count === 0) throw conflict('That step was already answered.');

  const article = await articleRef(ctx, option.articleSlug);
  if (nextNodeId) return nodeView(s, s.flow, nextNodeId, def.nodes[nextNodeId]!, article);
  const supportUrl = supportUrlOf(await getGuildConfig(ctx.db, ctx.guildId));
  return { kind: outcome === 'ESCALATED' ? 'escalated' : 'resolved', sessionId: s.id, flowTitle: s.flow.title, article, supportUrl };
}

/**
 * "Still stuck": mark the session ESCALATED and hand back the external support
 * link (tickets live outside this bot). Allowed while in progress or after a
 * resolution that did not help. Idempotent.
 */
export async function escalateSession(ctx: Ctx, sessionId: string): Promise<{ supportUrl: string | null }> {
  const s = await loadOwnSession(ctx, sessionId);
  if (s.outcome === 'ABANDONED') throw invalidState('This troubleshooting session has expired. Run /troubleshoot to start again.');
  if (s.outcome !== 'ESCALATED') {
    await ctx.db.troubleshootingSession.update({ where: { id: s.id }, data: { outcome: 'ESCALATED' } });
  }
  return { supportUrl: supportUrlOf(await getGuildConfig(ctx.db, ctx.guildId)) };
}

/** Worker: sessions idle for 24h are ABANDONED. */
export async function abandonIdleSessions(db: Db, guildId: string, now: Date): Promise<number> {
  const res = await db.troubleshootingSession.updateMany({
    where: { guildId, outcome: 'IN_PROGRESS', updatedAt: { lt: new Date(now.getTime() - SESSION_IDLE_MS) } },
    data: { outcome: 'ABANDONED' },
  });
  return res.count;
}
