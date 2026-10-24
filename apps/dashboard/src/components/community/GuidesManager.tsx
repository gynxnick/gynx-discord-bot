'use client';

import { useState, type FormEvent } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/Feedback';
import { Field, Input, Textarea } from '@/components/ui/Form';
import { Switch } from '@/components/ui/Switch';
import { Table, type Column } from '@/components/ui/Table';
import { httpsProblem } from './form-utils';
import { guideToPayload, type GuideDraft } from './guide-payload';
import { useApiAction } from './useApiAction';

export interface GuideRow {
  id: string;
  title: string;
  slug: string;
  category: string;
  game: string | null;
  summary: string;
  url: string;
  published: boolean;
  views: number;
  helpfulYes: number;
  helpfulNo: number;
  updatedAtLabel: string;
}

const blank = (): GuideDraft => ({
  title: '',
  slug: '',
  category: '',
  game: '',
  summary: '',
  url: '',
  published: false,
});

export function GuidesManager({
  rows,
  categories,
  games,
}: {
  rows: GuideRow[];
  categories: string[];
  games: string[];
}) {
  const { run, pending, fieldErrors, setFieldErrors } = useApiAction();
  const [editing, setEditing] = useState<GuideRow | 'new' | null>(null);
  const [d, setD] = useState<GuideDraft>(blank);
  const [deleting, setDeleting] = useState<GuideRow | null>(null);
  const set = <K extends keyof GuideDraft>(k: K, v: GuideDraft[K]) => setD((x) => ({ ...x, [k]: v }));

  const open = (g: GuideRow | 'new') => {
    setFieldErrors({});
    setEditing(g);
    setD(
      g === 'new'
        ? blank()
        : {
            title: g.title,
            slug: g.slug,
            category: g.category,
            game: g.game ?? '',
            summary: g.summary,
            url: g.url,
            published: g.published,
          },
    );
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (!d.title.trim()) local.title = 'Add a title.';
    if (!d.category.trim()) local.category = 'Add a category.';
    if (!d.summary.trim()) local.summary = 'Add a short summary.';
    const urlProblem = httpsProblem(d.url);
    if (urlProblem) local.url = urlProblem;
    if (Object.keys(local).length) {
      setFieldErrors(local);
      return;
    }
    const body = guideToPayload(d);
    const res =
      editing === 'new'
        ? await run('/api/community/guides', 'POST', body, {
            success: 'Guide created',
            errorTitle: 'Could not save guide',
          })
        : await run(`/api/community/guides/${encodeURIComponent((editing as GuideRow).id)}`, 'PATCH', body, {
            success: 'Guide saved',
            errorTitle: 'Could not save guide',
          });
    if (res) setEditing(null);
  };

  const togglePublished = (g: GuideRow) =>
    run(
      `/api/community/guides/${encodeURIComponent(g.id)}`,
      'PATCH',
      { published: !g.published },
      {
        success: g.published ? 'Guide unpublished' : 'Guide published',
        errorTitle: 'Could not update guide',
      },
    );

  const remove = async () => {
    if (!deleting) return;
    const res = await run(`/api/community/guides/${encodeURIComponent(deleting.id)}`, 'DELETE', undefined, {
      success: 'Guide deleted',
      errorTitle: 'Could not delete guide',
    });
    if (res) setDeleting(null);
  };

  const columns: Column<GuideRow>[] = [
    {
      key: 'title',
      header: 'Guide',
      cell: (g) => (
        <div className="min-w-[12rem]">
          <button
            type="button"
            className="text-left font-medium text-fg hover:text-accent"
            onClick={() => open(g)}
          >
            {g.title}
          </button>
          <p className="text-xs text-fg-muted">
            <span className="font-mono">{g.slug}</span>
          </p>
        </div>
      ),
    },
    { key: 'category', header: 'Category', cell: (g) => g.category },
    {
      key: 'game',
      header: 'Game',
      hideOnMobile: true,
      cell: (g) => <span className="text-fg-muted">{g.game ?? '—'}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (g) => (g.published ? <Badge tone="success">Published</Badge> : <Badge>Draft</Badge>),
    },
    {
      key: 'views',
      header: 'Views',
      align: 'right',
      cell: (g) => <span className="tabular-nums">{g.views.toLocaleString('en-US')}</span>,
    },
    {
      key: 'helpful',
      header: 'Helpful',
      align: 'right',
      hideOnMobile: true,
      cell: (g) => (
        <span className="whitespace-nowrap tabular-nums text-fg-muted">
          {g.helpfulYes} / {g.helpfulNo}
        </span>
      ),
    },
    {
      key: 'updated',
      header: 'Updated',
      hideOnMobile: true,
      cell: (g) => <span className="whitespace-nowrap text-fg-muted">{g.updatedAtLabel}</span>,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (g) => (
        <div className="flex justify-end gap-1">
          <a
            href={g.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="inline-flex h-8 items-center px-2 text-xs"
            aria-label={`Open ${g.title} in a new tab`}
          >
            Open
          </a>
          <Button size="sm" variant="ghost" onClick={() => open(g)} aria-label={`Edit ${g.title}`}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void togglePublished(g)}
            disabled={pending}
            aria-label={`${g.published ? 'Unpublish' : 'Publish'} ${g.title}`}
          >
            {g.published ? 'Unpublish' : 'Publish'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDeleting(g)} aria-label={`Delete ${g.title}`}>
            Delete
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Card>
      <CardHeader
        title="Guides"
        description="Helpful = yes / no votes from members. Views are counted at most once per member per 10 minutes."
        actions={
          <Button size="sm" onClick={() => open('new')}>
            New guide
          </Button>
        }
      />
      <Table
        columns={columns}
        rows={rows}
        rowKey={(g) => g.id}
        caption="Guides"
        empty={
          <EmptyState
            title="No guides yet"
            description="Link setup guides and tutorials members can browse with /guides."
          />
        }
      />

      <datalist id="guide-categories">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <datalist id="guide-games">
        {games.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'New guide' : 'Edit guide'}
        size="lg"
        dismissible={!pending}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form="guide-form" loading={pending} loadingLabel="Saving…">
              Save guide
            </Button>
          </>
        }
      >
        <form id="guide-form" onSubmit={save} className="space-y-4" noValidate>
          <Field id="g-title" label="Title" required error={fieldErrors.title}>
            {(p) => (
              <Input {...p} value={d.title} onChange={(e) => set('title', e.target.value)} maxLength={120} />
            )}
          </Field>
          <Field
            id="g-slug"
            label="Slug"
            help="Lowercase letters, numbers and dashes. Leave empty to derive from the title."
            error={fieldErrors.slug}
          >
            {(p) => (
              <Input {...p} value={d.slug} onChange={(e) => set('slug', e.target.value)} maxLength={60} />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="g-category" label="Category" required error={fieldErrors.category}>
              {(p) => (
                <Input
                  {...p}
                  list="guide-categories"
                  value={d.category}
                  onChange={(e) => set('category', e.target.value)}
                  maxLength={30}
                  placeholder="Setup"
                />
              )}
            </Field>
            <Field id="g-game" label="Game" help="Optional" error={fieldErrors.game}>
              {(p) => (
                <Input
                  {...p}
                  list="guide-games"
                  value={d.game}
                  onChange={(e) => set('game', e.target.value)}
                  maxLength={30}
                  placeholder="Minecraft"
                />
              )}
            </Field>
          </div>
          <Field id="g-summary" label="Summary" required error={fieldErrors.summary}>
            {(p) => (
              <Textarea
                {...p}
                rows={3}
                value={d.summary}
                onChange={(e) => set('summary', e.target.value)}
                maxLength={500}
              />
            )}
          </Field>
          <Field id="g-url" label="URL" required help="https:// only" error={fieldErrors.url}>
            {(p) => (
              <Input
                {...p}
                type="url"
                inputMode="url"
                placeholder="https://"
                value={d.url}
                onChange={(e) => set('url', e.target.value)}
                maxLength={500}
              />
            )}
          </Field>
          <Switch
            id="g-published"
            checked={d.published}
            onChange={(v) => set('published', v)}
            label="Published"
            description="Drafts are never shown to members."
          />
        </form>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onCancel={() => setDeleting(null)}
        onConfirm={remove}
        loading={pending}
        title="Delete guide?"
        description={
          deleting ? `"${deleting.title}" and its statistics will be permanently removed.` : undefined
        }
        confirmLabel="Delete guide"
      />
    </Card>
  );
}
