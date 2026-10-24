/** Defensive view model for DiagnosticRecord.findings JSON. Pure. */

export interface FindingView {
  id: string;
  title: string;
  confidence: 'likely' | 'possible';
  explanation: string;
  /** Redacted at analysis time; removed by retention purge. */
  evidence: string | null;
  articleSlug: string | null;
}

const s = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');

export function parseFindings(raw: unknown): FindingView[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 50).flatMap((f): FindingView[] => {
    if (!f || typeof f !== 'object') return [];
    const o = f as Record<string, unknown>;
    const title = s(o.title, 200);
    if (!title) return [];
    return [
      {
        id: s(o.id, 64),
        title,
        confidence: o.confidence === 'likely' ? 'likely' : 'possible',
        explanation: s(o.explanation, 2000),
        evidence: typeof o.evidence === 'string' && o.evidence ? o.evidence.slice(0, 1500) : null,
        articleSlug: typeof o.articleSlug === 'string' && o.articleSlug ? o.articleSlug.slice(0, 64) : null,
      },
    ];
  });
}

/** Excerpts are shown only while the record is neither purged nor past its expiry. */
export function excerptVisible(
  r: { purgedAt: Date | string | null; expiresAt: Date | string; redactedExcerpt: string | null },
  now: Date,
): boolean {
  if (r.purgedAt || !r.redactedExcerpt) return false;
  return new Date(r.expiresAt).getTime() > now.getTime();
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
