'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useSession } from '@/components/layout/SessionProvider';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/Feedback';
import type { SelectOption } from '@/components/ui/Form';
import { Table, type Column } from '@/components/ui/Table';
import { useToast } from '@/components/ui/Toast';
import { formatDateTime, formatNumber } from '@/lib/format';
import { FlowEditor, type FlowRow } from './FlowEditor';

export function FlowManager({
  flows,
  games,
  articleSlugs,
  timezone,
  limitReached,
}: {
  flows: FlowRow[];
  games: SelectOption[];
  articleSlugs: string[];
  timezone: string;
  limitReached: boolean;
}) {
  const { api } = useSession();
  const toast = useToast();
  const router = useRouter();
  const [editing, setEditing] = useState<FlowRow | 'new' | null>(null);
  const [deleting, setDeleting] = useState<FlowRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const gameLabel = (g: string | null) => (g ? (games.find((x) => x.value === g)?.label ?? g) : 'General');

  const togglePublished = async (f: FlowRow) => {
    setBusy(f.id);
    try {
      await api(`/api/troubleshooting/flows/${encodeURIComponent(f.id)}`, {
        method: 'PATCH',
        body: { published: !f.published },
      });
      toast.success(f.published ? 'Flow unpublished' : 'Flow published', f.title);
      router.refresh();
    } catch (e) {
      toast.error('Could not update flow', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const doDelete = async () => {
    if (!deleting) return;
    setBusy(deleting.id);
    try {
      await api(`/api/troubleshooting/flows/${encodeURIComponent(deleting.id)}`, { method: 'DELETE' });
      toast.success('Flow deleted', deleting.title);
      setDeleting(null);
      router.refresh();
    } catch (e) {
      toast.error('Could not delete flow', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (editing) {
    return (
      <FlowEditor
        key={editing === 'new' ? 'new' : editing.id}
        flow={editing === 'new' ? null : editing}
        games={games}
        articleSlugs={articleSlugs}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          router.refresh();
        }}
      />
    );
  }

  const columns: Column<FlowRow>[] = [
    {
      key: 'title',
      header: 'Title',
      cell: (f) => (
        <div className="min-w-[12rem]">
          <button
            type="button"
            className="text-left font-medium text-accent hover:underline"
            onClick={() => setEditing(f)}
          >
            {f.title}
          </button>
          <p className="font-mono text-xs text-fg-muted">{f.slug}</p>
        </div>
      ),
    },
    { key: 'game', header: 'Game', cell: (f) => gameLabel(f.game) },
    {
      key: 'published',
      header: 'Status',
      cell: (f) =>
        f.published ? (
          <Badge tone="success" dot>
            Published
          </Badge>
        ) : (
          <Badge dot>Draft</Badge>
        ),
    },
    { key: 'version', header: 'Version', align: 'right', hideOnMobile: true, cell: (f) => `v${f.version}` },
    { key: 'started', header: 'Started', align: 'right', cell: (f) => formatNumber(f.stats.started) },
    { key: 'resolved', header: 'Resolved', align: 'right', cell: (f) => formatNumber(f.stats.resolved) },
    { key: 'escalated', header: 'Escalated', align: 'right', cell: (f) => formatNumber(f.stats.escalated) },
    {
      key: 'abandoned',
      header: 'Abandoned',
      align: 'right',
      hideOnMobile: true,
      cell: (f) => formatNumber(f.stats.abandoned),
    },
    {
      key: 'updated',
      header: 'Updated',
      hideOnMobile: true,
      cell: (f) => (
        <span className="whitespace-nowrap text-fg-muted">{formatDateTime(f.updatedAt, timezone)}</span>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (f) => (
        <span className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => setEditing(f)} aria-label={`Edit ${f.title}`}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            loading={busy === f.id && !deleting}
            onClick={() => void togglePublished(f)}
            aria-label={`${f.published ? 'Unpublish' : 'Publish'} ${f.title}`}
          >
            {f.published ? 'Unpublish' : 'Publish'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-danger"
            onClick={() => setDeleting(f)}
            aria-label={`Delete ${f.title}`}
          >
            Delete
          </Button>
        </span>
      ),
    },
  ];

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <p className="text-xs text-fg-muted">
          Session counts include every run; &ldquo;Started&rdquo; also counts runs still in progress.{' '}
          {limitReached && 'Showing the first 25 flows.'}
        </p>
        <Button size="sm" onClick={() => setEditing('new')}>
          New flow
        </Button>
      </div>
      <Table
        columns={columns}
        rows={flows}
        rowKey={(f) => f.id}
        caption="Troubleshooting flows"
        empty={
          <EmptyState
            title="No flows yet"
            description="Create a decision tree, or load the default GYNX content from the knowledge base page."
          />
        }
      />
      <ConfirmDialog
        open={deleting !== null}
        onCancel={() => setDeleting(null)}
        onConfirm={doDelete}
        loading={busy !== null && deleting !== null}
        title="Delete flow?"
        confirmLabel="Delete flow"
        description={
          deleting
            ? `“${deleting.title}” and its session history will be removed permanently. Members with an open session will no longer be able to continue it.`
            : undefined
        }
      />
    </Card>
  );
}
