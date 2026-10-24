/**
 * Cursor pagination over URL search params. Services return `nextCursor`
 * (id of the last row). To support "Previous" we keep a bounded trail of the
 * cursors that led to the current page in `trail` (comma-separated).
 */

export type SearchParams = Record<string, string | string[] | undefined>;

const MAX_TRAIL = 30;
const CURSOR_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function firstParam(sp: SearchParams, key: string): string | undefined {
  const v = sp[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s === undefined || s === '' ? undefined : s;
}

export function readCursor(sp: SearchParams): { cursor?: string; trail: string[] } {
  const cursor = firstParam(sp, 'cursor');
  const trail = (firstParam(sp, 'trail') ?? '')
    .split(',')
    .filter((c) => CURSOR_RE.test(c))
    .slice(-MAX_TRAIL);
  return { cursor: cursor && CURSOR_RE.test(cursor) ? cursor : undefined, trail };
}

function buildHref(pathname: string, sp: SearchParams, patch: Record<string, string | undefined>): string {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const s = Array.isArray(v) ? v[0] : v;
    if (s !== undefined && s !== '' && !(k in patch)) out.set(k, s);
  }
  for (const [k, v] of Object.entries(patch)) if (v !== undefined && v !== '') out.set(k, v);
  const qs = out.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/** Links for the previous/next page, or null when unavailable. */
export function pageLinks(
  pathname: string,
  sp: SearchParams,
  nextCursor: string | null,
): { prev: string | null; next: string | null } {
  const { cursor, trail } = readCursor(sp);
  // '-' marks "the first page" (no cursor) inside the trail.
  const next = nextCursor
    ? buildHref(pathname, sp, {
        cursor: nextCursor,
        trail: [...trail, cursor ?? '-'].slice(-MAX_TRAIL).join(','),
      })
    : null;
  let prev: string | null = null;
  if (cursor) {
    const prevCursor = trail[trail.length - 1];
    const prevTrail = trail.slice(0, -1);
    prev = buildHref(pathname, sp, {
      cursor: prevCursor && prevCursor !== '-' ? prevCursor : undefined,
      trail: prevTrail.length ? prevTrail.join(',') : undefined,
    });
  }
  return { prev, next };
}

/** Replace/remove params (e.g. for filter or sort links); always resets pagination. */
export function hrefWith(
  pathname: string,
  sp: SearchParams,
  patch: Record<string, string | undefined>,
): string {
  return buildHref(pathname, sp, { cursor: undefined, trail: undefined, ...patch });
}
