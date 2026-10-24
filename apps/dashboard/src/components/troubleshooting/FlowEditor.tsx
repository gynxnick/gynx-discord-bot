'use client';

import { useMemo, useState } from 'react';
import { useSession } from '@/components/layout/SessionProvider';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Alert } from '@/components/ui/Feedback';
import { Field, Input, Select, Textarea, type SelectOption } from '@/components/ui/Form';
import { Switch } from '@/components/ui/Switch';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/api-client';
import {
  emptyFlow,
  emptyNode,
  emptyOption,
  fromDefinition,
  MAX_FLOW_NODES,
  MAX_OPTIONS,
  nextNodeId,
  removeNode,
  renameReferences,
  stableStringify,
  TARGET_LABELS,
  toDefinition,
  validateEditorFlow,
  type EditorFlow,
  type EditorOption,
  type FlowDefinitionShape,
  type TargetType,
} from './flow-editor-model';
import { FlowOutline } from './FlowOutline';
import { slugify } from './forms';

export interface FlowRow {
  id: string;
  slug: string;
  title: string;
  game: string | null;
  description: string;
  published: boolean;
  version: number;
  definition: unknown;
  updatedAt: string;
  stats: { started: number; inProgress: number; resolved: number; escalated: number; abandoned: number };
}

interface Meta {
  title: string;
  slug: string;
  game: string;
  description: string;
  published: boolean;
}

export function FlowEditor({
  flow,
  games,
  articleSlugs,
  onClose,
  onSaved,
}: {
  flow: FlowRow | null;
  games: SelectOption[];
  articleSlugs: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { api } = useSession();
  const toast = useToast();

  const initial = useMemo(
    () => (flow ? fromDefinition(flow.definition) : { flow: emptyFlow(), warnings: [] }),
    [flow],
  );
  const initialJson = useMemo(() => stableStringify(flow?.definition ?? null), [flow]);

  const [meta, setMeta] = useState<Meta>({
    title: flow?.title ?? '',
    slug: flow?.slug ?? '',
    game: flow?.game ?? '',
    description: flow?.description ?? '',
    published: flow?.published ?? false,
  });
  const [slugTouched, setSlugTouched] = useState(Boolean(flow));
  const [tree, setTree] = useState<EditorFlow>(initial.flow);
  const [warnings, setWarnings] = useState<string[]>(initial.warnings);
  const [mode, setMode] = useState<'structured' | 'json'>('structured');
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  // Node id at focus time, used to re-point references on blur.
  const [editingId, setEditingId] = useState<{ index: number; from: string } | null>(null);
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const clientErrors = useMemo(() => (mode === 'structured' ? validateEditorFlow(tree) : []), [mode, tree]);
  const parsedJson = useMemo((): { def: FlowDefinitionShape | null; error: string | null } => {
    if (mode !== 'json') return { def: null, error: null };
    try {
      const raw = JSON.parse(jsonText) as unknown;
      return { def: toDefinition(fromDefinition(raw).flow), error: null };
    } catch (e) {
      return { def: null, error: (e as Error).message };
    }
  }, [mode, jsonText]);
  const outlineDef = mode === 'structured' ? toDefinition(tree) : parsedJson.def;

  const updateNode = (i: number, patch: Partial<EditorFlow['nodes'][number]>) =>
    setTree((t) => ({ ...t, nodes: t.nodes.map((n, idx) => (idx === i ? { ...n, ...patch } : n)) }));
  const updateOption = (i: number, j: number, patch: Partial<EditorOption>) =>
    setTree((t) => ({
      ...t,
      nodes: t.nodes.map((n, idx) =>
        idx === i ? { ...n, options: n.options.map((o, k) => (k === j ? { ...o, ...patch } : o)) } : n,
      ),
    }));

  const toJson = () => {
    setJsonText(JSON.stringify(toDefinition(tree), null, 2));
    setJsonError(null);
    setMode('json');
  };
  const toStructured = () => {
    try {
      const r = fromDefinition(JSON.parse(jsonText) as unknown);
      setTree(r.flow);
      setWarnings(r.warnings);
      setJsonError(null);
      setMode('structured');
    } catch (e) {
      setJsonError(`The JSON could not be parsed: ${(e as Error).message}`);
    }
  };

  /** The definition to send, or null when the JSON view cannot be parsed. */
  const currentDefinition = (): unknown | null => {
    if (mode === 'structured') return toDefinition(tree);
    try {
      return JSON.parse(jsonText) as unknown;
    } catch (e) {
      setJsonError(`The JSON could not be parsed: ${(e as Error).message}`);
      return null;
    }
  };

  const save = async () => {
    setServerErrors([]);
    setFieldErrors({});
    const errs: Record<string, string> = {};
    if (meta.title.trim().length < 3 || meta.title.trim().length > 100)
      errs.title = 'Title must be 3–100 characters.';
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(meta.slug.trim()) || meta.slug.trim().length > 64)
      errs.slug = 'Use lowercase-kebab-case, up to 64 characters.';
    if (meta.description.trim().length < 5 || meta.description.trim().length > 300)
      errs.description = 'Description must be 5–300 characters.';
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      return;
    }
    const definition = currentDefinition();
    if (definition === null) return;

    setSaving(true);
    try {
      // Authoritative structural check by the service; its messages are shown verbatim.
      const v = await api<{ ok: boolean; errors: string[] }>('/api/troubleshooting/flows/validate', {
        method: 'POST',
        body: { definition },
      });
      if (!v.ok) {
        setServerErrors(v.errors);
        toast.error('The flow is not valid', 'Fix the listed problems and save again.');
        return;
      }
      const definitionChanged = !flow || stableStringify(definition) !== initialJson;
      const body = {
        title: meta.title.trim(),
        slug: meta.slug.trim(),
        game: meta.game || null,
        description: meta.description.trim(),
        published: meta.published,
        ...(definitionChanged ? { definition } : {}),
      };
      if (flow)
        await api(`/api/troubleshooting/flows/${encodeURIComponent(flow.id)}`, { method: 'PATCH', body });
      else await api('/api/troubleshooting/flows', { method: 'POST', body });
      toast.success(
        flow ? 'Flow saved' : 'Flow created',
        definitionChanged && flow ? 'The decision tree changed, so the version was increased.' : body.title,
      );
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.issues.length) setFieldErrors(err.fieldErrors());
      setServerErrors([(err as Error).message]);
      toast.error('Could not save flow', (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const nodeIds = tree.nodes.map((n) => n.id.trim()).filter(Boolean);
  const nodeOptions = nodeIds.map((id) => ({ value: id, label: id }));
  const articleOptions = (current: string) => {
    const list = current && !articleSlugs.includes(current) ? [current, ...articleSlugs] : articleSlugs;
    return list.map((s) => ({ value: s, label: articleSlugs.includes(s) ? s : `${s} (not found)` }));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" onClick={onClose} disabled={saving}>
          ← Back to flows
        </Button>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={saving} loadingLabel="Saving…">
            {flow ? 'Save flow' : 'Create flow'}
          </Button>
        </div>
      </div>

      {serverErrors.length > 0 && (
        <Alert tone="danger" title="The server rejected this flow">
          <ul className="list-disc space-y-0.5 pl-5">
            {serverErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </Alert>
      )}

      <Card>
        <CardHeader
          title="Details"
          description={
            flow
              ? `Version ${flow.version} · editing the decision tree increases the version.`
              : 'Members start published flows with /troubleshoot.'
          }
        />
        <CardBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="fl-title" label="Title" required error={fieldErrors.title}>
              {(p) => (
                <Input
                  {...p}
                  value={meta.title}
                  maxLength={100}
                  onChange={(e) => {
                    const title = e.target.value;
                    setMeta((m) => ({ ...m, title, slug: slugTouched ? m.slug : slugify(title) }));
                  }}
                />
              )}
            </Field>
            <Field id="fl-slug" label="Slug" required error={fieldErrors.slug}>
              {(p) => (
                <Input
                  {...p}
                  className="font-mono"
                  value={meta.slug}
                  maxLength={64}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setMeta((m) => ({ ...m, slug: e.target.value }));
                  }}
                />
              )}
            </Field>
            <Field id="fl-game" label="Game" error={fieldErrors.game}>
              {(p) => (
                <Select
                  {...p}
                  value={meta.game}
                  onChange={(e) => setMeta((m) => ({ ...m, game: e.target.value }))}
                  placeholder="General (all games)"
                  options={games}
                />
              )}
            </Field>
            <div className="flex items-end pb-1">
              <Switch
                id="fl-published"
                checked={meta.published}
                onChange={(v) => setMeta((m) => ({ ...m, published: v }))}
                label="Published"
                description="Only published flows can be started by members."
              />
            </div>
          </div>
          <Field
            id="fl-desc"
            label="Description"
            required
            help="Shown when members pick a flow (5–300 characters)."
            error={fieldErrors.description}
          >
            {(p) => (
              <Textarea
                {...p}
                rows={2}
                maxLength={300}
                value={meta.description}
                onChange={(e) => setMeta((m) => ({ ...m, description: e.target.value }))}
              />
            )}
          </Field>
        </CardBody>
      </Card>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card>
            <CardHeader
              title="Decision tree"
              description={`Up to ${MAX_FLOW_NODES} nodes, each with 1–${MAX_OPTIONS} options. Every option has exactly one target.`}
              actions={
                <div
                  role="group"
                  aria-label="Editor view"
                  className="flex rounded border border-border-strong"
                >
                  <button
                    type="button"
                    aria-pressed={mode === 'structured'}
                    onClick={() => (mode === 'json' ? toStructured() : undefined)}
                    className={`px-2.5 py-1 text-xs ${mode === 'structured' ? 'bg-surface-hover text-fg' : 'text-fg-muted hover:text-fg'}`}
                  >
                    Structured
                  </button>
                  <button
                    type="button"
                    aria-pressed={mode === 'json'}
                    onClick={() => (mode === 'structured' ? toJson() : undefined)}
                    className={`border-l border-border-strong px-2.5 py-1 text-xs ${mode === 'json' ? 'bg-surface-hover text-fg' : 'text-fg-muted hover:text-fg'}`}
                  >
                    JSON
                  </button>
                </div>
              }
            />
            <CardBody className="space-y-4">
              {warnings.length > 0 && mode === 'structured' && (
                <Alert tone="warning" title="Some details cannot be shown in the structured editor">
                  <ul className="list-disc space-y-0.5 pl-5">
                    {warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                  <p className="mt-1">Use the JSON view to keep them, or save to remove them.</p>
                </Alert>
              )}

              {mode === 'json' ? (
                <Field
                  id="fl-json"
                  label="Definition (JSON)"
                  help='{ "start": "nodeId", "nodes": { "nodeId": { "prompt": "…", "options": [{ "label": "…", "next" | "articleSlug" | "resolve": true | "escalate": true }] } } }'
                  error={jsonError ?? parsedJson.error}
                >
                  {(p) => (
                    <Textarea
                      {...p}
                      className="font-mono text-xs"
                      rows={24}
                      spellCheck={false}
                      value={jsonText}
                      onChange={(e) => setJsonText(e.target.value)}
                    />
                  )}
                </Field>
              ) : (
                <>
                  <Field id="fl-start" label="Start node" required>
                    {(p) => (
                      <Select
                        {...p}
                        className="sm:w-64"
                        value={tree.start}
                        onChange={(e) => setTree((t) => ({ ...t, start: e.target.value }))}
                        placeholder="Choose…"
                        options={nodeOptions}
                      />
                    )}
                  </Field>

                  <ol className="space-y-4">
                    {tree.nodes.map((node, i) => (
                      <li key={i} className="rounded-md border border-border bg-surface-raised/40 p-3">
                        <div className="flex flex-wrap items-end gap-3">
                          <Field id={`fl-n${i}-id`} label="Node id" className="w-full sm:w-48">
                            {(p) => (
                              <Input
                                {...p}
                                className="font-mono"
                                value={node.id}
                                maxLength={32}
                                onFocus={() => setEditingId({ index: i, from: node.id.trim() })}
                                onChange={(e) => updateNode(i, { id: e.target.value })}
                                onBlur={() => {
                                  if (editingId && editingId.index === i)
                                    setTree((t) => renameReferences(t, i, editingId.from));
                                  setEditingId(null);
                                }}
                              />
                            )}
                          </Field>
                          {tree.start === node.id.trim() && (
                            <span className="mb-2 rounded border border-accent/40 bg-accent-soft px-1.5 py-0.5 text-xs text-accent">
                              Start
                            </span>
                          )}
                          <div className="ml-auto">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-danger"
                              disabled={tree.nodes.length <= 1}
                              onClick={() => setTree((t) => removeNode(t, i))}
                              aria-label={`Remove node ${node.id}`}
                            >
                              Remove node
                            </Button>
                          </div>
                        </div>
                        <Field id={`fl-n${i}-prompt`} label="Prompt" className="mt-3">
                          {(p) => (
                            <Textarea
                              {...p}
                              rows={2}
                              maxLength={1000}
                              value={node.prompt}
                              onChange={(e) => updateNode(i, { prompt: e.target.value })}
                            />
                          )}
                        </Field>

                        <fieldset className="mt-3 space-y-2">
                          <legend className="mb-1 text-sm font-medium text-fg">Options</legend>
                          {node.options.map((opt, j) => (
                            <div
                              key={j}
                              className="grid gap-2 rounded border border-border p-2 sm:grid-cols-[1fr_12rem_12rem_auto] sm:items-end"
                            >
                              <Field id={`fl-n${i}-o${j}-label`} label={`Option ${j + 1} label`}>
                                {(p) => (
                                  <Input
                                    {...p}
                                    value={opt.label}
                                    maxLength={80}
                                    onChange={(e) => updateOption(i, j, { label: e.target.value })}
                                  />
                                )}
                              </Field>
                              <Field id={`fl-n${i}-o${j}-target`} label="Target">
                                {(p) => (
                                  <Select
                                    {...p}
                                    value={opt.target}
                                    onChange={(e) =>
                                      updateOption(i, j, { target: e.target.value as TargetType })
                                    }
                                    options={(Object.keys(TARGET_LABELS) as TargetType[]).map((t) => ({
                                      value: t,
                                      label: TARGET_LABELS[t],
                                    }))}
                                  />
                                )}
                              </Field>
                              {opt.target === 'next' ? (
                                <Field id={`fl-n${i}-o${j}-next`} label="Node">
                                  {(p) => (
                                    <Select
                                      {...p}
                                      value={opt.next}
                                      onChange={(e) => updateOption(i, j, { next: e.target.value })}
                                      placeholder="Choose node…"
                                      options={nodeOptions.filter((n) => n.value !== node.id.trim())}
                                    />
                                  )}
                                </Field>
                              ) : opt.target === 'article' ? (
                                <Field id={`fl-n${i}-o${j}-article`} label="Article">
                                  {(p) => (
                                    <Select
                                      {...p}
                                      value={opt.articleSlug}
                                      onChange={(e) => updateOption(i, j, { articleSlug: e.target.value })}
                                      placeholder="Choose article…"
                                      options={articleOptions(opt.articleSlug)}
                                    />
                                  )}
                                </Field>
                              ) : (
                                <p className="pb-2 text-xs text-fg-muted">
                                  {opt.target === 'resolve'
                                    ? 'Ends the flow as resolved.'
                                    : 'Ends the flow and links to support.'}
                                </p>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={node.options.length <= 1}
                                onClick={() =>
                                  updateNode(i, { options: node.options.filter((_, k) => k !== j) })
                                }
                                aria-label={`Remove option ${j + 1} of node ${node.id}`}
                              >
                                Remove
                              </Button>
                            </div>
                          ))}
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={node.options.length >= MAX_OPTIONS}
                            onClick={() => updateNode(i, { options: [...node.options, emptyOption()] })}
                          >
                            Add option
                          </Button>
                        </fieldset>
                      </li>
                    ))}
                  </ol>
                  <Button
                    variant="secondary"
                    disabled={tree.nodes.length >= MAX_FLOW_NODES}
                    onClick={() =>
                      setTree((t) => ({
                        ...t,
                        nodes: [...t.nodes, emptyNode(nextNodeId(t.nodes.map((n) => n.id)))],
                      }))
                    }
                  >
                    Add node
                  </Button>
                </>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Checks"
              description="Live checks in this browser. The server validates again on save."
            />
            <CardBody>
              {mode === 'json' ? (
                <p className="text-sm text-fg-muted">
                  {parsedJson.error
                    ? 'The JSON cannot be parsed yet.'
                    : 'Checks run on save in JSON view. Switch to Structured to see them live.'}
                </p>
              ) : clientErrors.length === 0 ? (
                <p className="text-sm text-success" role="status">
                  No problems found.
                </p>
              ) : (
                <ul className="list-disc space-y-1 pl-5 text-sm text-warning" aria-live="polite">
                  {clientErrors.slice(0, 20).map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                  {clientErrors.length > 20 && <li>…and {clientErrors.length - 20} more.</li>}
                </ul>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title="Outline"
              description="How members move through the flow, from the start node."
            />
            <CardBody className="max-h-[32rem] overflow-auto">
              <FlowOutline definition={outlineDef} />
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
