import { describe, expect, it } from 'vitest';
import { campaignOptions, linkDraftToPayload, trackedLinkUrl } from './link-utils';

describe('trackedLinkUrl', () => {
  it('joins the dashboard URL and slug', () => {
    expect(trackedLinkUrl('https://dash.gynx.gg/', 'Ab12Cd34')).toBe('https://dash.gynx.gg/r/Ab12Cd34');
    expect(trackedLinkUrl('https://dash.gynx.gg', 'Ab12Cd34')).toBe('https://dash.gynx.gg/r/Ab12Cd34');
    expect(trackedLinkUrl(undefined, 'Ab12Cd34')).toBe('/r/Ab12Cd34');
  });
});

describe('linkDraftToPayload', () => {
  it('omits blank optional fields', () => {
    expect(linkDraftToPayload({ targetUrl: ' https://gynx.gg ', campaign: ' ', announcementId: '' })).toEqual(
      { targetUrl: 'https://gynx.gg' },
    );
    expect(
      linkDraftToPayload({ targetUrl: 'https://gynx.gg', campaign: ' spring ', announcementId: 'a1' }),
    ).toEqual({ targetUrl: 'https://gynx.gg', campaign: 'spring', announcementId: 'a1' });
  });
});

describe('campaignOptions', () => {
  it('dedupes, trims and sorts', () => {
    expect(campaignOptions(['b', null, ' a ', 'b', '', undefined])).toEqual(['a', 'b']);
  });
});
