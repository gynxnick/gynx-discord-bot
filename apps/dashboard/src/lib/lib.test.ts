import { describe, expect, it } from 'vitest';
import { buildCsp, createNonce } from './csp';
import { avatarUrl } from './discord';
import { activeChildHref, visibleNav } from './nav';
import { hrefWith, pageLinks } from './pagination';

describe('pagination links', () => {
  it('walks forward and back through cursors while keeping filters', () => {
    const p1 = pageLinks('/r', { status: 'NEW' }, 'c1');
    expect(p1.prev).toBeNull();
    expect(p1.next).toBe('/r?status=NEW&cursor=c1&trail=-');

    const sp2 = Object.fromEntries(new URL(`https://x${p1.next}`).searchParams);
    const p2 = pageLinks('/r', sp2, 'c2');
    expect(p2.next).toBe('/r?status=NEW&cursor=c2&trail=-%2Cc1');
    expect(p2.prev).toBe('/r?status=NEW');

    const sp3 = Object.fromEntries(new URL(`https://x${p2.next}`).searchParams);
    expect(pageLinks('/r', sp3, null)).toEqual({ prev: '/r?status=NEW&cursor=c1&trail=-', next: null });
  });

  it('drops malformed cursors and resets pagination on filter change', () => {
    expect(pageLinks('/r', { cursor: 'bad cursor!' }, null).prev).toBeNull();
    expect(hrefWith('/r', { cursor: 'c1', trail: '-', status: 'NEW' }, { status: 'DEAD' })).toBe(
      '/r?status=DEAD',
    );
  });
});

describe('navigation', () => {
  it('hides sections and children without permission', () => {
    const nav = visibleNav(new Set(['dashboard.access', 'audit.view']));
    expect(nav.map((n) => n.label)).toEqual(['Overview', 'Security']);
    const sec = nav.find((n) => n.label === 'Security')!;
    expect(sec.children?.map((c) => c.href)).toEqual(['/security/audit']);
    expect(sec.href).toBe('/security/audit');
  });

  it('picks the most specific active child', () => {
    const children = [
      { label: 'General', href: '/settings', anyOf: [] },
      { label: 'Jobs', href: '/settings/jobs', anyOf: [] },
    ];
    expect(activeChildHref('/settings/jobs', children)).toBe('/settings/jobs');
    expect(activeChildHref('/settings', children)).toBe('/settings');
  });
});

describe('CSP', () => {
  it('builds a strict nonce policy', () => {
    const nonce = createNonce();
    const csp = buildCsp(nonce, { dev: false });
    expect(csp).toContain(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self' https://discord.com");
    expect(csp).toContain("img-src 'self' https://cdn.discordapp.com data:");
    expect(csp).not.toContain('unsafe-eval');
    expect(buildCsp(nonce, { dev: true })).toContain("'unsafe-eval'");
    expect(createNonce()).not.toBe(nonce);
  });
});

describe('avatarUrl', () => {
  it('only builds CDN URLs from well-formed hashes', () => {
    expect(avatarUrl('123456789012345678', 'a_0123456789abcdef0123456789abcdef')).toBe(
      'https://cdn.discordapp.com/avatars/123456789012345678/a_0123456789abcdef0123456789abcdef.png?size=64',
    );
    expect(avatarUrl('123456789012345678', '../../evil')).toBeNull();
    expect(avatarUrl('123456789012345678', null)).toBeNull();
  });
});
