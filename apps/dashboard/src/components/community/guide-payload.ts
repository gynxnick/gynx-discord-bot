/** Guide form state → API payload (pure; unit tested). */

export interface GuideDraft {
  title: string;
  slug: string;
  category: string;
  game: string;
  summary: string;
  url: string;
  published: boolean;
}

export function guideToPayload(d: GuideDraft) {
  return {
    title: d.title.trim(),
    // Blank slug → omitted so the service derives it from the title.
    ...(d.slug.trim() ? { slug: d.slug.trim().toLowerCase() } : {}),
    category: d.category.trim(),
    game: d.game.trim() || null,
    summary: d.summary.trim(),
    url: d.url.trim(),
    published: d.published,
  };
}
