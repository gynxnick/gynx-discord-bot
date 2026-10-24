import { describe, expect, it } from 'vitest';
import {
  decidePartnerApplication,
  listCampaignsQuerySchema,
  listPartnerCampaigns,
  updateCampaignBodySchema,
  updatePartnerCampaign,
} from './partners';
import {
  getReferralLeaderboard,
  leaderboardQuerySchema,
  listReferralAttributions,
  reviewAttribution,
} from './referrals';

describe('marketing referral/partner route definitions', () => {
  it('declare the permissions the services require', () => {
    // Read routes accept either referral permission (the services allow both).
    expect(getReferralLeaderboard.opts.permission).toEqual(['referrals.view', 'referrals.manage']);
    expect(listReferralAttributions.opts.permission).toEqual(['referrals.view', 'referrals.manage']);
    expect(reviewAttribution.opts).toMatchObject({ permission: 'referrals.manage', mutation: true });
    expect(decidePartnerApplication.opts).toMatchObject({ permission: 'partners.review', mutation: true });
    expect(updatePartnerCampaign.opts).toMatchObject({ permission: 'partners.review', mutation: true });
    expect(listPartnerCampaigns.opts.permission).toBe('partners.review');
  });

  it('parse query strings', () => {
    expect(leaderboardQuerySchema.parse({})).toEqual({ period: '30' });
    expect(leaderboardQuerySchema.parse({ period: 'all' })).toEqual({ period: 'all' });
    expect(() => leaderboardQuerySchema.parse({ period: '90' })).toThrow();
    expect(listCampaignsQuerySchema.parse({ active: 'false', limit: '10' })).toMatchObject({
      active: false,
      limit: 10,
    });
    expect(listCampaignsQuerySchema.parse({})).not.toHaveProperty('active', true);
    expect(listReferralAttributions.opts.schema!.parse({ confidence: 'UNKNOWN', limit: '5' })).toMatchObject({
      confidence: 'UNKNOWN',
      limit: 5,
    });
  });

  it('accepts wall-clock or null end dates and rejects unknown fields', () => {
    expect(updateCampaignBodySchema.parse({ endsAt: '2026-12-01T18:00' })).toEqual({
      endsAt: '2026-12-01T18:00',
    });
    expect(updateCampaignBodySchema.parse({ endsAt: null, canAnnounce: false })).toEqual({
      endsAt: null,
      canAnnounce: false,
    });
    expect(() => updateCampaignBodySchema.parse({ partnerId: '123' })).toThrow();
  });
});
