import type {
  APIActionRowComponent,
  APIButtonComponent,
  APIComponentInMessageActionRow,
  APIEmbed,
} from 'discord-api-types/v10';
import type { KnowledgeArticle, TroubleshootingFlow } from '@gynx/database';
import { EMBED_COLORS, truncate } from '@gynx/shared';
import { brandEmbed } from '../core/render';
import type { Finding } from './analyzers';
import type { SearchHit } from './articles';
import { supportText } from './common';
import type { DiagnosisOutcome } from './diagnostics';
import type { ArticleRef, StepView } from './flows';
import { TroubleshootingText as T } from './texts';

/**
 * Component customIds (prefixes owned by this module):
 *   tshoot:flow                         select a flow
 *   tshoot:opt:<sessionId>:<node>:<i>   choose an option
 *   tshoot:esc:<sessionId>              still stuck → support
 *   tskb:view:<slug> · tskb:vote:<id>:y|n
 *   tsdiag:fb:<recordId>:y|n
 */
type Row = APIActionRowComponent<APIComponentInMessageActionRow>;

const linkButton = (label: string, url: string): APIButtonComponent => ({ type: 2, style: 5, label, url });
const button = (custom_id: string, label: string, style: 1 | 2 | 3 | 4 = 2): APIButtonComponent => ({
  type: 2,
  style,
  label: truncate(label, 80),
  custom_id,
});

export function supportRow(supportUrl: string | null, extra: APIButtonComponent[] = []): Row[] {
  const buttons = [...extra, ...(supportUrl ? [linkButton(T.contactSupportButton(), supportUrl)] : [])].slice(
    0,
    5,
  );
  return buttons.length ? [{ type: 1, components: buttons }] : [];
}

export function articleEmbed(a: KnowledgeArticle, supportUrl: string | null): APIEmbed {
  const votes = a.helpfulYes + a.helpfulNo;
  return brandEmbed({
    title: a.title,
    url: a.url ?? undefined,
    description: truncate(`${a.body}\n\n${supportText(supportUrl)}`, 4000),
    footer:
      votes > 0
        ? T.articleFooterRated({ percent: Math.round((a.helpfulYes / votes) * 100) })
        : T.articleFooterUnrated(),
  });
}

export function articleComponents(a: KnowledgeArticle, supportUrl: string | null): Row[] {
  const row: APIButtonComponent[] = [
    button(`tskb:vote:${a.id}:y`, T.helpedButton(), 3),
    button(`tskb:vote:${a.id}:n`, T.stillStuckButton(), 2),
  ];
  if (a.url) row.push(linkButton(T.openArticleButton(), a.url));
  return supportRow(supportUrl, row);
}

export function searchResultsEmbed(query: string, hits: SearchHit[], total: number): APIEmbed {
  if (hits.length === 0) {
    return brandEmbed({
      title: T.searchTitle(),
      description: T.searchNoResults({ query: truncate(query, 80) }),
      color: EMBED_COLORS.neutral,
    });
  }
  return brandEmbed({
    title: T.searchResultsTitle({ count: total, plural: total === 1 ? '' : 's' }),
    description: hits
      .map(
        (h, i) =>
          `**${i + 1}. ${h.article.url ? `[${h.article.title}](${h.article.url})` : h.article.title}**\n${truncate(h.article.summary, 200)}`,
      )
      .join('\n\n'),
    footer: T.searchResultsFooter(),
  });
}

export function searchResultsComponents(hits: SearchHit[]): Row[] {
  if (!hits.length) return [];
  return [
    {
      type: 1,
      components: hits
        .slice(0, 5)
        .map((h, i) => button(`tskb:view:${h.article.slug}`, `${i + 1}. ${h.article.title}`, 2)),
    },
  ];
}

export function flowPickerEmbed(flows: TroubleshootingFlow[]): APIEmbed {
  if (!flows.length) {
    return brandEmbed({
      title: T.noFlowsTitle(),
      description: T.noFlowsDescription(),
      color: EMBED_COLORS.neutral,
    });
  }
  return brandEmbed({
    title: T.flowPickerTitle(),
    description: T.flowPickerDescription(),
    fields: flows.slice(0, 10).map((f) => ({ name: f.title, value: truncate(f.description, 200) })),
  });
}

export function flowPickerComponents(flows: TroubleshootingFlow[]): Row[] {
  if (!flows.length) return [];
  return [
    {
      type: 1,
      components: [
        {
          type: 3,
          custom_id: 'tshoot:flow',
          placeholder: T.flowPickerPlaceholder(),
          min_values: 1,
          max_values: 1,
          options: flows.slice(0, 25).map((f) => ({
            label: truncate(f.title, 100),
            value: f.slug,
            description: truncate(f.description, 100),
          })),
        },
      ],
    },
  ];
}

const articleLine = (a: ArticleRef) =>
  `**${a.url ? `[${a.title}](${a.url})` : a.title}**\n${truncate(a.summary, 300)}`;

export function stepEmbed(v: StepView): APIEmbed {
  if (v.kind === 'node') {
    return brandEmbed({
      title: v.flowTitle,
      description: `${v.prompt}${v.hint ? `\n\n${T.stepRelated({ article: articleLine(v.hint) })}` : ''}`,
    });
  }
  if (v.kind === 'resolved') {
    return brandEmbed({
      title: v.article ? T.resolvedWithArticleTitle() : T.resolvedTitle(),
      color: EMBED_COLORS.success,
      description: v.article
        ? T.resolvedWithArticle({ article: articleLine(v.article) })
        : T.resolvedDescription(),
    });
  }
  return brandEmbed({
    title: T.escalatedTitle(),
    color: EMBED_COLORS.warning,
    description: `${v.article ? `${articleLine(v.article)}\n\n` : ''}${supportText(v.supportUrl)}\n${T.escalatedFlowHint()}`,
  });
}

export function stepComponents(v: StepView): Row[] {
  if (v.kind === 'node') {
    return [
      {
        type: 1,
        components: v.options.map((o) =>
          button(`tshoot:opt:${v.sessionId}:${v.nodeId}:${o.index}`, o.label, 2),
        ),
      },
    ];
  }
  const articleBtn: APIButtonComponent[] = v.article
    ? [button(`tskb:view:${v.article.slug}`, T.readArticleButton(), 1)]
    : [];
  if (v.kind === 'resolved')
    return [
      { type: 1, components: [...articleBtn, button(`tshoot:esc:${v.sessionId}`, T.stillStuckButton(), 2)] },
    ];
  return supportRow(v.supportUrl, articleBtn);
}

export const escalatedEmbed = (supportUrl: string | null): APIEmbed =>
  brandEmbed({
    title: T.escalatedTitle(),
    color: EMBED_COLORS.warning,
    description: `${supportText(supportUrl)}\n${T.escalatedHint()}`,
  });

const utcLabel = (d: Date) => `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/** Shown before/alongside every upload. */
export const uploadWarningEmbed = (): APIEmbed =>
  brandEmbed({ title: T.uploadWarningTitle(), description: T.uploadWarning(), color: EMBED_COLORS.warning });

const diagnosisFooter = (o: DiagnosisOutcome) =>
  T.diagnosisFooter({ warning: T.uploadWarning(), time: utcLabel(o.expiresAt) });

const confidenceLabel = (c: Finding['confidence']) => (c === 'likely' ? T.likelyCause() : T.possibleCause());

export function diagnosisEmbed(o: DiagnosisOutcome, fileName: string): APIEmbed {
  if (o.findings.length === 0) {
    return brandEmbed({
      title: T.noIssueTitle(),
      color: EMBED_COLORS.neutral,
      description: T.noIssueDescription({
        file: truncate(fileName, 80),
        game: o.game === 'unknown' ? '' : `${o.game} `,
      }),
      footer: diagnosisFooter(o),
    });
  }
  return brandEmbed({
    title: T.diagnosisTitle({ count: o.findings.length, plural: o.findings.length === 1 ? '' : 's' }),
    description: T.diagnosisDescription({ file: truncate(fileName, 80) }),
    fields: o.findings.slice(0, 8).map((f) => ({
      name: `${confidenceLabel(f.confidence)}: ${f.title}`,
      value: truncate(`${f.explanation}\n\`\`\`\n${f.evidence.replace(/`/g, "'")}\n\`\`\``, 1024),
    })),
    footer: diagnosisFooter(o),
  });
}

export function diagnosisComponents(o: DiagnosisOutcome): Row[] {
  const slugs = [...new Set(o.findings.map((f) => f.articleSlug).filter((s): s is string => !!s))].slice(
    0,
    3,
  );
  const rows: Row[] = [
    {
      type: 1,
      components: [
        button(`tsdiag:fb:${o.recordId}:y`, T.helpedButton(), 3),
        button(`tsdiag:fb:${o.recordId}:n`, T.stillStuckButton(), 2),
      ],
    },
  ];
  if (slugs.length)
    rows.push({
      type: 1,
      components: slugs.map((s) =>
        button(`tskb:view:${s}`, T.guideButton({ guide: s.replace(/-/g, ' ') }), 1),
      ),
    });
  return rows;
}
