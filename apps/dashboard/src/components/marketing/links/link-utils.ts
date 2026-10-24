/** Pure helpers for tracked links (no React; shared by the API handlers and the page; unit tested). */

/** Public redirect URL for a tracked link: `${DASHBOARD_URL}/r/<slug>`. */
export function trackedLinkUrl(dashboardUrl: string | null | undefined, slug: string): string {
  const base = (dashboardUrl ?? '').trim().replace(/\/+$/, '');
  return `${base}/r/${encodeURIComponent(slug)}`;
}

export interface LinkDraft {
  targetUrl: string;
  campaign: string;
  announcementId: string;
}

/** Create-form → API body (blank optional fields are omitted). */
export function linkDraftToPayload(d: LinkDraft): {
  targetUrl: string;
  campaign?: string;
  announcementId?: string;
} {
  const campaign = d.campaign.trim();
  return {
    targetUrl: d.targetUrl.trim(),
    ...(campaign ? { campaign } : {}),
    ...(d.announcementId ? { announcementId: d.announcementId } : {}),
  };
}

/** Distinct, sorted campaign names (for the filter). */
export function campaignOptions(campaigns: ReadonlyArray<string | null | undefined>): string[] {
  return [...new Set(campaigns.filter((c): c is string => Boolean(c && c.trim())).map((c) => c.trim()))].sort(
    (a, b) => a.localeCompare(b),
  );
}
