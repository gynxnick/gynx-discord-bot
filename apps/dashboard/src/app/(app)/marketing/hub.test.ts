import { describe, expect, it } from 'vitest';
import { firstAccessibleMarketingHref, marketingChildren, marketingPermissionKeys } from './hub';

const first = (...keys: string[]) => firstAccessibleMarketingHref(new Set(keys));

describe('marketing hub redirect', () => {
  it('picks the first accessible sub-page in nav order', () => {
    expect(first('announcements.publish', 'partners.review')).toBe('/marketing/announcements');
    expect(first('events.manage', 'polls.manage')).toBe('/marketing/events');
    expect(first('polls.manage', 'giveaways.manage')).toBe('/marketing/polls');
    expect(first('giveaways.manage')).toBe('/marketing/giveaways');
    expect(first('referrals.manage')).toBe('/marketing/links');
    expect(first('partners.review')).toBe('/marketing/links');
    expect(first('referrals.view')).toBe('/marketing/referrals');
  });

  it('returns null without any marketing permission', () => {
    expect(first()).toBeNull();
    expect(first('dashboard.access', 'settings.manage')).toBeNull();
  });

  it('gates the hub on the union of all sub-page permissions', () => {
    const keys = marketingPermissionKeys();
    for (const k of [
      'announcements.create',
      'announcements.publish',
      'events.manage',
      'polls.manage',
      'giveaways.manage',
      'referrals.view',
      'referrals.manage',
      'partners.review',
    ]) {
      expect(keys).toContain(k);
    }
    expect(marketingChildren().length).toBeGreaterThan(0);
  });

  it('only considers the given children', () => {
    const children = [
      { label: 'Partners', href: '/marketing/partners', anyOf: ['partners.review'] as const },
    ];
    expect(firstAccessibleMarketingHref(new Set(['partners.review']), children)).toBe('/marketing/partners');
  });
});
