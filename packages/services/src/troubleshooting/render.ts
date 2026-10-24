import type { APIActionRowComponent, APIButtonComponent, APIComponentInMessageActionRow, APIEmbed } from 'discord-api-types/v10';
import type { KnowledgeArticle, TroubleshootingFlow } from '@gynx/database';
import { EMBED_COLORS, truncate } from '@gynx/shared';
import { brandEmbed } from '../core/render';
import type { Finding } from './analyzers';
import type { SearchHit } from './articles';
import { supportText } from './common';
import { UPLOAD_WARNING, type DiagnosisOutcome } from './diagnostics';
import type { ArticleRef, StepView } from './flows';

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
const button = (custom_id: string, label: string, style: 1 | 2 | 3 | 4 = 2): APIButtonComponent => ({ type: 2, style, label: truncate(label, 80), custom_id });

export function supportRow(supportUrl: string | null, extra: APIButtonComponent[] = []): Row[] {
  const buttons = [...extra, ...(supportUrl ? [linkButton('Contact support', supportUrl)] : [])].slice(0, 5);
  return buttons.length ? [{ type: 1, components: buttons }] : [];
}

export function articleEmbed(a: KnowledgeArticle, supportUrl: string | null): APIEmbed {
  const votes = a.helpfulYes + a.helpfulNo;
  return brandEmbed({
    title: a.title,
    url: a.url ?? undefined,
    description: truncate(`${a.body}\n\n${supportText(supportUrl)}`, 4000),
    footer: votes > 0 ? `${Math.round((a.helpfulYes / votes) * 100)}% found this helpful · general guidance, not a guarantee` : 'General guidance — your setup may differ',
  });
}

export function articleComponents(a: KnowledgeArticle, supportUrl: string | null): Row[] {
  const row: APIButtonComponent[] = [button(`tskb:vote:${a.id}:y`, 'This helped', 3), button(`tskb:vote:${a.id}:n`, 'Still stuck', 2)];
  if (a.url) row.push(linkButton('Open full article', a.url));
  return supportRow(supportUrl, row);
}

export function searchResultsEmbed(query: string, hits: SearchHit[], total: number): APIEmbed {
  if (hits.length === 0) {
    return brandEmbed({
      title: 'Knowledge base',
      description: `No articles matched **${truncate(query, 80)}**. Try fewer or different words, use \`/troubleshoot\` for a guided check, or contact the support team.`,
      color: EMBED_COLORS.neutral,
    });
  }
  return brandEmbed({
    title: `Knowledge base · ${total} result${total === 1 ? '' : 's'}`,
    description: hits
      .map((h, i) => `**${i + 1}. ${h.article.url ? `[${h.article.title}](${h.article.url})` : h.article.title}**\n${truncate(h.article.summary, 200)}`)
      .join('\n\n'),
    footer: 'Press a button to read an article here.',
  });
}

export function searchResultsComponents(hits: SearchHit[]): Row[] {
  if (!hits.length) return [];
  return [{ type: 1, components: hits.slice(0, 5).map((h, i) => button(`tskb:view:${h.article.slug}`, `${i + 1}. ${h.article.title}`, 2)) }];
}

export function flowPickerEmbed(flows: TroubleshootingFlow[]): APIEmbed {
  if (!flows.length) {
    return brandEmbed({
      title: 'Troubleshooting',
      description: 'No guided troubleshooting is available for that game yet. Try `/knowledge-search` or `/diagnose` with your log file.',
      color: EMBED_COLORS.neutral,
    });
  }
  return brandEmbed({
    title: 'Guided troubleshooting',
    description: 'Pick the problem that matches yours. Only you can see and answer these steps.',
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
          placeholder: 'Choose a problem…',
          min_values: 1,
          max_values: 1,
          options: flows.slice(0, 25).map((f) => ({ label: truncate(f.title, 100), value: f.slug, description: truncate(f.description, 100) })),
        },
      ],
    },
  ];
}

const articleLine = (a: ArticleRef) => `**${a.url ? `[${a.title}](${a.url})` : a.title}**\n${truncate(a.summary, 300)}`;

export function stepEmbed(v: StepView): APIEmbed {
  if (v.kind === 'node') {
    return brandEmbed({
      title: v.flowTitle,
      description: `${v.prompt}${v.hint ? `\n\n📄 Related: ${articleLine(v.hint)}` : ''}`,
    });
  }
  if (v.kind === 'resolved') {
    return brandEmbed({
      title: v.article ? 'This should help' : 'Glad that’s sorted!',
      color: EMBED_COLORS.success,
      description: v.article
        ? `${articleLine(v.article)}\n\nIf this does not solve it, press **Still stuck**.`
        : 'Great — you are all set. If the problem comes back, run `/troubleshoot` again.',
    });
  }
  return brandEmbed({
    title: 'Let’s get you to the support team',
    color: EMBED_COLORS.warning,
    description: `${v.article ? `${articleLine(v.article)}\n\n` : ''}${supportText(v.supportUrl)}\nPlease include the game, what you tried in this guide, and any error messages.`,
  });
}

export function stepComponents(v: StepView): Row[] {
  if (v.kind === 'node') {
    return [{ type: 1, components: v.options.map((o) => button(`tshoot:opt:${v.sessionId}:${v.nodeId}:${o.index}`, o.label, 2)) }];
  }
  const articleBtn: APIButtonComponent[] = v.article ? [button(`tskb:view:${v.article.slug}`, 'Read article', 1)] : [];
  if (v.kind === 'resolved') return [{ type: 1, components: [...articleBtn, button(`tshoot:esc:${v.sessionId}`, 'Still stuck', 2)] }];
  return supportRow(v.supportUrl, articleBtn);
}

export const escalatedEmbed = (supportUrl: string | null): APIEmbed =>
  brandEmbed({
    title: 'Let’s get you to the support team',
    color: EMBED_COLORS.warning,
    description: `${supportText(supportUrl)}\nPlease include the game, what you already tried, and any error messages. Never share passwords.`,
  });

const utcLabel = (d: Date) => `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/** Shown before/alongside every upload. */
export const uploadWarningEmbed = (): APIEmbed =>
  brandEmbed({ title: 'Before you upload a log', description: UPLOAD_WARNING, color: EMBED_COLORS.warning });

const confidenceLabel =(c: Finding['confidence']) => (c === 'likely' ? 'Likely cause' : 'Possible cause');

export function diagnosisEmbed(o: DiagnosisOutcome, fileName: string): APIEmbed {
  if (o.findings.length === 0) {
    return brandEmbed({
      title: 'No known issue detected',
      color: EMBED_COLORS.neutral,
      description:
        `I checked **${truncate(fileName, 80)}** against known ${o.game === 'unknown' ? '' : `${o.game} `}problems and did not find a match. ` +
        'That does not mean the log is fine — it may be an issue I do not recognise yet.\n\n' +
        'Try `/troubleshoot` or `/knowledge-search`, or press **Still stuck** to contact the support team.',
      footer: `${UPLOAD_WARNING} Stored summary expires ${utcLabel(o.expiresAt)}.`,
    });
  }
  return brandEmbed({
    title: `Log analysis · ${o.findings.length} finding${o.findings.length === 1 ? '' : 's'}`,
    description: `Results for **${truncate(fileName, 80)}**. These are likely causes based on known log patterns — not a confirmed diagnosis.`,
    fields: o.findings.slice(0, 8).map((f) => ({
      name: `${confidenceLabel(f.confidence)}: ${f.title}`,
      value: truncate(`${f.explanation}\n\`\`\`\n${f.evidence.replace(/`/g, "'")}\n\`\`\``, 1024),
    })),
    footer: `${UPLOAD_WARNING} Stored summary expires ${utcLabel(o.expiresAt)}.`,
  });
}

export function diagnosisComponents(o: DiagnosisOutcome): Row[] {
  const slugs = [...new Set(o.findings.map((f) => f.articleSlug).filter((s): s is string => !!s))].slice(0, 3);
  const rows: Row[] = [{ type: 1, components: [button(`tsdiag:fb:${o.recordId}:y`, 'This helped', 3), button(`tsdiag:fb:${o.recordId}:n`, 'Still stuck', 2)] }];
  if (slugs.length) rows.push({ type: 1, components: slugs.map((s) => button(`tskb:view:${s}`, `Guide: ${s.replace(/-/g, ' ')}`, 1)) });
  return rows;
}
