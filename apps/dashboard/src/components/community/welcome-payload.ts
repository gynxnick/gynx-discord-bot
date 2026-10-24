/** Welcome form state (strings for inputs) ↔ API payload (pure; unit tested). */

export interface WelcomeDraft {
  enabled: boolean;
  channelId: string;
  title: string;
  message: string;
  rulesText: string;
  requireRulesAck: boolean;
  verificationEnabled: boolean;
  verifiedRoleId: string;
  minAccountAgeDays: string;
  raidJoinThreshold: string;
  raidWindowSeconds: string;
  raidAction: 'ALERT' | 'REQUIRE_VERIFICATION';
  docsUrl: string;
  supportUrl: string;
  dmOnJoin: boolean;
}

export interface WelcomeRecord {
  enabled: boolean;
  channelId: string | null;
  title: string;
  message: string;
  rulesText: string;
  requireRulesAck: boolean;
  verificationEnabled: boolean;
  verifiedRoleId: string | null;
  minAccountAgeDays: number;
  raidJoinThreshold: number;
  raidWindowSeconds: number;
  raidAction: 'ALERT' | 'REQUIRE_VERIFICATION';
  docsUrl: string | null;
  supportUrl: string | null;
  dmOnJoin: boolean;
}

export function welcomeToDraft(w: WelcomeRecord): WelcomeDraft {
  return {
    enabled: w.enabled,
    channelId: w.channelId ?? '',
    title: w.title,
    message: w.message,
    rulesText: w.rulesText,
    requireRulesAck: w.requireRulesAck,
    verificationEnabled: w.verificationEnabled,
    verifiedRoleId: w.verifiedRoleId ?? '',
    minAccountAgeDays: String(w.minAccountAgeDays),
    raidJoinThreshold: String(w.raidJoinThreshold),
    raidWindowSeconds: String(w.raidWindowSeconds),
    raidAction: w.raidAction,
    docsUrl: w.docsUrl ?? '',
    supportUrl: w.supportUrl ?? '',
    dmOnJoin: w.dmOnJoin,
  };
}

const num = (v: string): number => (v.trim() === '' ? NaN : Number(v));

/** Full update payload; blank optional strings become null, numbers are parsed (invalid → NaN so the server reports it). */
export function welcomeToPayload(d: WelcomeDraft): WelcomeRecord {
  const blank = (v: string) => (v.trim() ? v.trim() : null);
  return {
    enabled: d.enabled,
    channelId: blank(d.channelId),
    title: d.title.trim(),
    message: d.message.trim(),
    rulesText: d.rulesText.trim(),
    requireRulesAck: d.requireRulesAck,
    verificationEnabled: d.verificationEnabled,
    verifiedRoleId: blank(d.verifiedRoleId),
    minAccountAgeDays: num(d.minAccountAgeDays),
    raidJoinThreshold: num(d.raidJoinThreshold),
    raidWindowSeconds: num(d.raidWindowSeconds),
    raidAction: d.raidAction,
    docsUrl: blank(d.docsUrl),
    supportUrl: blank(d.supportUrl),
    dmOnJoin: d.dmOnJoin,
  };
}
