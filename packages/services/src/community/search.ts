/** Pure FAQ search ranking (no I/O). */

export interface SearchableFaq {
  id: string;
  question: string;
  answer: string;
  keywords: readonly string[];
  views: number;
}

export const SCORE = { keyword: 100, question: 10, answer: 1 } as const;

/** Lower-case word tokens (≥2 chars), deduplicated, max 10. */
export function tokenize(query: string): string[] {
  const words = query
    .toLowerCase()
    .normalize('NFKC')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2);
  return [...new Set(words)].slice(0, 10);
}

/**
 * Score an entry: every token that hits a keyword is worth more than any
 * number of question hits, which in turn outweigh answer hits.
 * Returns 0 when nothing matches.
 */
export function scoreFaq(entry: SearchableFaq, tokens: readonly string[]): number {
  if (tokens.length === 0) return 0;
  const keywords = entry.keywords.map((k) => k.toLowerCase());
  const question = entry.question.toLowerCase();
  const answer = entry.answer.toLowerCase();
  let keywordHits = 0;
  let questionHits = 0;
  let answerHits = 0;
  for (const t of tokens) {
    if (keywords.some((k) => k === t || k.includes(t))) keywordHits++;
    if (question.includes(t)) questionHits++;
    if (answer.includes(t)) answerHits++;
  }
  // Tier weights are chosen so a lower tier can never outrank a higher one (≤10 tokens).
  return keywordHits * SCORE.keyword * 100 + questionHits * SCORE.question * 10 + answerHits * SCORE.answer;
}

/** Rank entries by score (desc), then views (desc), then id for stability. Non-matches are dropped. */
export function rankFaqEntries<T extends SearchableFaq>(entries: readonly T[], query: string): T[] {
  const tokens = tokenize(query);
  return entries
    .map((e) => ({ e, s: scoreFaq(e, tokens) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || b.e.views - a.e.views || a.e.id.localeCompare(b.e.id))
    .map((x) => x.e);
}
