import type { Metadata } from 'next';
import { games, troubleshooting } from '@gynx/services';
import { isAppError } from '@gynx/shared';
import type { FlowRow } from '@/components/troubleshooting/FlowEditor';
import { FlowManager } from '@/components/troubleshooting/FlowManager';
import { Alert, PermissionDenied } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/PageHeader';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'Troubleshooting flows' };

type Ctx = Parameters<typeof troubleshooting.listArticles>[0];

/** All article slugs (drafts included) for the flow editor's article picker. */
async function allArticleSlugs(ctx: Ctx): Promise<string[]> {
  const slugs: string[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 10; i++) {
    const page = await troubleshooting.listArticles(ctx, { limit: 100, cursor });
    slugs.push(...page.items.map((a) => a.slug));
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return slugs.sort();
}

export default async function FlowsPage() {
  const page = await requirePagePermission('troubleshooting.manage', 'troubleshooting.flows');
  if (!page.ok) return <PermissionDenied permission={page.permission} />;

  const header = (
    <PageHeader
      title="Troubleshooting flows"
      description="Guided decision trees members run with /troubleshoot. Each answer moves to another step, shows an article, resolves, or hands over to the support team."
      breadcrumbs={[{ label: 'Troubleshooting', href: '/troubleshooting' }, { label: 'Flows' }]}
    />
  );

  let flows;
  let stats;
  let slugs: string[];
  try {
    [flows, stats, slugs] = await Promise.all([
      troubleshooting.listFlows(page.ctx, { includeDrafts: true }),
      troubleshooting.flowStats(page.ctx),
      allArticleSlugs(page.ctx),
    ]);
  } catch (e) {
    if (!isAppError(e)) throw e;
    return (
      <>
        {header}
        <Alert tone="warning" title="Flows are unavailable">
          {e.message}
        </Alert>
      </>
    );
  }

  const rows: FlowRow[] = flows.map((f) => {
    const s = { started: 0, inProgress: 0, resolved: 0, escalated: 0, abandoned: 0 };
    for (const r of stats) {
      if (r.flowId !== f.id) continue;
      s.started += r.count;
      if (r.outcome === 'IN_PROGRESS') s.inProgress += r.count;
      else if (r.outcome === 'RESOLVED') s.resolved += r.count;
      else if (r.outcome === 'ESCALATED') s.escalated += r.count;
      else if (r.outcome === 'ABANDONED') s.abandoned += r.count;
    }
    return {
      id: f.id,
      slug: f.slug,
      title: f.title,
      game: f.game,
      description: f.description,
      published: f.published,
      version: f.version,
      definition: f.definition,
      updatedAt: f.updatedAt.toISOString(),
      stats: s,
    };
  });

  return (
    <>
      {header}
      <FlowManager
        flows={rows}
        games={games.gameChoices().map((g) => ({ value: g.value, label: g.name }))}
        articleSlugs={slugs}
        timezone={page.timezone}
        limitReached={rows.length >= 25}
      />
    </>
  );
}
