import { z } from 'zod';

/**
 * Troubleshooting flow = a small decision tree stored in TroubleshootingFlow.definition.
 *
 *   { start: nodeId, nodes: { [id]: { prompt, options: [{ label, next?, articleSlug?, resolve?, escalate? }] } } }
 *
 * Option semantics:
 *  - `next`        → move to another node (an `articleSlug` may be shown alongside as a hint)
 *  - no `next`     → terminal: must `resolve`, `escalate`, or point at an `articleSlug`
 *                    (article-only terminals end the session as RESOLVED; the user can still
 *                    press "Still stuck" to escalate to support)
 */

export const MAX_FLOW_NODES = 50;
export const nodeIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,32}$/, 'Node ids: 1–32 letters, digits, - or _');
export const slugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase-kebab-case')
  .max(64);

export const flowOptionSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    next: nodeIdSchema.optional(),
    articleSlug: slugSchema.optional(),
    resolve: z.literal(true).optional(),
    escalate: z.literal(true).optional(),
  })
  .strict();

export const flowNodeSchema = z
  .object({
    prompt: z.string().trim().min(1).max(1000),
    options: z.array(flowOptionSchema).min(1).max(5),
  })
  .strict();

export const flowDefinitionSchema = z
  .object({
    start: nodeIdSchema,
    nodes: z.record(nodeIdSchema, flowNodeSchema),
  })
  .strict();

export type FlowOption = z.infer<typeof flowOptionSchema>;
export type FlowNode = z.infer<typeof flowNodeSchema>;
export type FlowDefinition = z.infer<typeof flowDefinitionSchema>;

export const isTerminal = (o: FlowOption) => o.next === undefined;

export interface FlowValidation {
  ok: boolean;
  errors: string[];
  definition?: FlowDefinition;
}

/**
 * Structural validation beyond the Zod shape:
 *  - ≤ 50 nodes, start exists, every `next` references an existing node
 *  - option is either a transition or a terminal (never both / never neither)
 *  - every node is reachable from start
 *  - every node can eventually reach an outcome (rejects cycles without an exit)
 */
export function validateFlowDefinition(raw: unknown): FlowValidation {
  const parsed = flowDefinitionSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join('.') || 'definition'}: ${i.message}`),
    };
  }
  const def = parsed.data;
  const ids = Object.keys(def.nodes);
  const errors: string[] = [];

  if (ids.length === 0) errors.push('The flow has no nodes.');
  if (ids.length > MAX_FLOW_NODES)
    errors.push(`A flow can have at most ${MAX_FLOW_NODES} nodes (has ${ids.length}).`);
  if (!def.nodes[def.start]) errors.push(`Start node "${def.start}" does not exist.`);

  for (const [id, node] of Object.entries(def.nodes)) {
    node.options.forEach((o, idx) => {
      const where = `Node "${id}" option ${idx + 1}`;
      if (o.next !== undefined) {
        if (!def.nodes[o.next]) errors.push(`${where} points to unknown node "${o.next}".`);
        if (o.resolve || o.escalate) errors.push(`${where} cannot both continue and end the flow.`);
      } else if (!o.resolve && !o.escalate && !o.articleSlug) {
        errors.push(`${where} must continue (next), resolve, escalate or link an article.`);
      }
      if (o.resolve && o.escalate) errors.push(`${where} cannot both resolve and escalate.`);
    });
  }
  if (errors.length > 0) return { ok: false, errors };

  // Reachability from start.
  const reachable = new Set<string>([def.start]);
  const queue = [def.start];
  while (queue.length) {
    const id = queue.shift()!;
    for (const o of def.nodes[id]!.options) {
      if (o.next && !reachable.has(o.next)) {
        reachable.add(o.next);
        queue.push(o.next);
      }
    }
  }
  for (const id of ids)
    if (!reachable.has(id)) errors.push(`Node "${id}" is unreachable from the start node.`);

  // Every node must be able to reach a terminal option (fixed point).
  const canExit = new Set<string>(ids.filter((id) => def.nodes[id]!.options.some(isTerminal)));
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of ids) {
      if (canExit.has(id)) continue;
      if (def.nodes[id]!.options.some((o) => o.next !== undefined && canExit.has(o.next))) {
        canExit.add(id);
        changed = true;
      }
    }
  }
  for (const id of ids)
    if (!canExit.has(id)) errors.push(`Node "${id}" can never reach an outcome (a cycle without an exit).`);

  return errors.length ? { ok: false, errors } : { ok: true, errors: [], definition: def };
}

/** Article slugs referenced anywhere in the flow. */
export function referencedArticleSlugs(def: FlowDefinition): string[] {
  const s = new Set<string>();
  for (const n of Object.values(def.nodes))
    for (const o of n.options) if (o.articleSlug) s.add(o.articleSlug);
  return [...s];
}
