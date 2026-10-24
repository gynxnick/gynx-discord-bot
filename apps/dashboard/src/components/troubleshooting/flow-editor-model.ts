/**
 * Structured flow editor model ↔ stored flow definition, plus client-side
 * validation that mirrors `validateFlowDefinition` in
 * packages/services/src/troubleshooting/flow-definition.ts (the service stays
 * authoritative and is called again on save). Pure; safe on the client.
 */

export const MAX_FLOW_NODES = 50;
export const MAX_OPTIONS = 5;
export const NODE_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type TargetType = 'next' | 'article' | 'resolve' | 'escalate';

export const TARGET_LABELS: Record<TargetType, string> = {
  next: 'Go to node',
  article: 'Show article (ends flow)',
  resolve: 'Resolve',
  escalate: 'Escalate to support',
};

export interface EditorOption {
  label: string;
  target: TargetType;
  /** Used when target = 'next'. */
  next: string;
  /** Used when target = 'article'. */
  articleSlug: string;
}

export interface EditorNode {
  id: string;
  prompt: string;
  options: EditorOption[];
}

export interface EditorFlow {
  start: string;
  nodes: EditorNode[];
}

export interface DefOption {
  label: string;
  next?: string;
  articleSlug?: string;
  resolve?: true;
  escalate?: true;
}
export interface DefNode {
  prompt: string;
  options: DefOption[];
}
export interface FlowDefinitionShape {
  start: string;
  nodes: Record<string, DefNode>;
}

export const emptyOption = (target: TargetType = 'resolve'): EditorOption => ({
  label: '',
  target,
  next: '',
  articleSlug: '',
});
export const emptyNode = (id: string): EditorNode => ({ id, prompt: '', options: [emptyOption()] });
export const emptyFlow = (): EditorFlow => ({ start: 'start', nodes: [emptyNode('start')] });

/** Editor state → definition JSON (exactly one target per option). */
export function toDefinition(flow: EditorFlow): FlowDefinitionShape {
  const nodes: Record<string, DefNode> = {};
  for (const n of flow.nodes) {
    nodes[n.id.trim()] = {
      prompt: n.prompt.trim(),
      options: n.options.map((o): DefOption => {
        const label = o.label.trim();
        switch (o.target) {
          case 'next':
            return { label, next: o.next.trim() };
          case 'article':
            return { label, articleSlug: o.articleSlug.trim() };
          case 'resolve':
            return { label, resolve: true };
          case 'escalate':
            return { label, escalate: true };
        }
      }),
    };
  }
  return { start: flow.start.trim(), nodes };
}

export interface FromDefinitionResult {
  flow: EditorFlow;
  /** Information the structured editor cannot represent (dropped on save from this view). */
  warnings: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Definition JSON → editor state. Tolerates partial/invalid input (shows what it can). */
export function fromDefinition(raw: unknown): FromDefinitionResult {
  const warnings: string[] = [];
  if (!isObj(raw))
    return { flow: emptyFlow(), warnings: ['The definition is not an object; starting from an empty flow.'] };
  const rawNodes = isObj(raw.nodes) ? raw.nodes : {};
  const nodes: EditorNode[] = Object.entries(rawNodes).map(([id, n]) => {
    const node = isObj(n) ? n : {};
    const opts = Array.isArray(node.options) ? node.options : [];
    return {
      id,
      prompt: str(node.prompt),
      options: opts.map((o, idx): EditorOption => {
        const opt = isObj(o) ? o : {};
        const base = { label: str(opt.label), next: str(opt.next), articleSlug: str(opt.articleSlug) };
        const where = `Node "${id}" option ${idx + 1}`;
        if (typeof opt.next === 'string') {
          if (opt.articleSlug)
            warnings.push(
              `${where}: the article hint "${str(opt.articleSlug)}" is not supported in the structured editor and will be removed.`,
            );
          return { ...base, target: 'next', articleSlug: '' };
        }
        if (opt.escalate === true) {
          if (opt.articleSlug)
            warnings.push(
              `${where}: the article "${str(opt.articleSlug)}" shown with the escalation will be removed.`,
            );
          return { ...base, target: 'escalate', next: '', articleSlug: '' };
        }
        if (opt.resolve === true) {
          if (opt.articleSlug)
            warnings.push(
              `${where}: the article "${str(opt.articleSlug)}" shown with the resolution will be removed.`,
            );
          return { ...base, target: 'resolve', next: '', articleSlug: '' };
        }
        if (typeof opt.articleSlug === 'string') return { ...base, target: 'article', next: '' };
        return { ...base, target: 'resolve', next: '', articleSlug: '' };
      }),
    };
  });
  const start = str(raw.start) || nodes[0]?.id || 'start';
  return { flow: { start, nodes: nodes.length ? nodes : [emptyNode(start)] }, warnings };
}

/**
 * Client-side mirror of the service validation. Messages use the same wording
 * as `validateFlowDefinition` for the structural rules.
 */
export function validateEditorFlow(flow: EditorFlow): string[] {
  const errors: string[] = [];
  const ids = flow.nodes.map((n) => n.id.trim());

  // Shape (Zod in the service).
  if (!NODE_ID_RE.test(flow.start.trim())) errors.push('start: Node ids: 1–32 letters, digits, - or _');
  const seen = new Set<string>();
  flow.nodes.forEach((n, i) => {
    const id = ids[i]!;
    if (!NODE_ID_RE.test(id)) errors.push(`Node ${i + 1}: Node ids: 1–32 letters, digits, - or _`);
    else if (seen.has(id)) errors.push(`Node id "${id}" is used more than once.`);
    seen.add(id);
    const prompt = n.prompt.trim();
    if (prompt.length < 1) errors.push(`Node "${id}": the prompt is required.`);
    if (prompt.length > 1000) errors.push(`Node "${id}": the prompt must be at most 1000 characters.`);
    if (n.options.length < 1) errors.push(`Node "${id}": add at least one option.`);
    if (n.options.length > MAX_OPTIONS) errors.push(`Node "${id}": at most ${MAX_OPTIONS} options.`);
    n.options.forEach((o, idx) => {
      const where = `Node "${id}" option ${idx + 1}`;
      const label = o.label.trim();
      if (label.length < 1) errors.push(`${where}: the label is required.`);
      if (label.length > 80) errors.push(`${where}: the label must be at most 80 characters.`);
      if (o.target === 'next' && !NODE_ID_RE.test(o.next.trim()))
        errors.push(`${where}: choose the node to go to.`);
      if (
        o.target === 'article' &&
        (!SLUG_RE.test(o.articleSlug.trim()) || o.articleSlug.trim().length > 64)
      ) {
        errors.push(`${where}: enter an article slug (lowercase-kebab-case).`);
      }
    });
  });
  if (errors.length) return errors;
  return validateDefinitionStructure(toDefinition(flow));
}

/** Structural rules — same algorithm and messages as the service. */
export function validateDefinitionStructure(def: FlowDefinitionShape): string[] {
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
  if (errors.length > 0) return errors;

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

  const canExit = new Set<string>(
    ids.filter((id) => def.nodes[id]!.options.some((o) => o.next === undefined)),
  );
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
  return errors;
}

export interface OutlineLine {
  depth: number;
  /** Option label that led here (empty for the start node). */
  via: string;
  kind: 'node' | 'repeat' | 'missing' | 'article' | 'resolve' | 'escalate';
  text: string;
}

/** Indented read-only outline from the start node. Revisited nodes are referenced, not expanded. */
export function buildOutline(def: FlowDefinitionShape, maxLines = 400): OutlineLine[] {
  const out: OutlineLine[] = [];
  const expanded = new Set<string>();
  const walk = (id: string, depth: number, via: string) => {
    if (out.length >= maxLines) return;
    const node = def.nodes[id];
    if (!node) {
      out.push({ depth, via, kind: 'missing', text: `Missing node "${id}"` });
      return;
    }
    if (expanded.has(id)) {
      out.push({ depth, via, kind: 'repeat', text: `→ ${id} (see above)` });
      return;
    }
    expanded.add(id);
    out.push({ depth, via, kind: 'node', text: `${id}: ${node.prompt}` });
    for (const o of node.options) {
      if (out.length >= maxLines) return;
      if (o.next !== undefined) walk(o.next, depth + 1, o.label);
      else if (o.escalate)
        out.push({ depth: depth + 1, via: o.label, kind: 'escalate', text: 'Escalate to support' });
      else if (o.resolve) out.push({ depth: depth + 1, via: o.label, kind: 'resolve', text: 'Resolved' });
      else
        out.push({
          depth: depth + 1,
          via: o.label,
          kind: 'article',
          text: `Article: ${o.articleSlug ?? ''}`,
        });
    }
  };
  walk(def.start, 0, '');
  return out;
}

/**
 * Rename node at `index` from `from` to its current id, re-pointing the start
 * node and every "go to node" option that referenced `from`. No-op when the
 * new id is invalid or already used by another node.
 */
export function renameReferences(flow: EditorFlow, index: number, from: string): EditorFlow {
  const to = flow.nodes[index]?.id.trim() ?? '';
  if (!to || to === from || !NODE_ID_RE.test(to)) return flow;
  if (flow.nodes.some((n, i) => i !== index && n.id.trim() === to)) return flow;
  return {
    start: flow.start === from ? to : flow.start,
    nodes: flow.nodes.map((n) => ({
      ...n,
      options: n.options.map((o) => (o.target === 'next' && o.next === from ? { ...o, next: to } : o)),
    })),
  };
}

/** Remove a node; options that pointed to it are cleared so validation flags them. */
export function removeNode(flow: EditorFlow, index: number): EditorFlow {
  const removed = flow.nodes[index]?.id;
  const nodes = flow.nodes
    .filter((_, i) => i !== index)
    .map((n) => ({
      ...n,
      options: n.options.map((o) => (o.target === 'next' && o.next === removed ? { ...o, next: '' } : o)),
    }));
  return { start: flow.start === removed ? (nodes[0]?.id ?? '') : flow.start, nodes };
}

/** Suggest an unused node id like "step-3". */
export function nextNodeId(existing: readonly string[]): string {
  const set = new Set(existing);
  for (let i = existing.length + 1; ; i++) if (!set.has(`step-${i}`)) return `step-${i}`;
}

/** JSON with sorted object keys, for change detection independent of key order. */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}
