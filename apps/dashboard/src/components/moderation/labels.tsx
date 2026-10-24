import { StatusBadge, type BadgeTone } from '@/components/ui/Badge';

/** Client-safe labels for moderation enums (mirrors @gynx/services moderation.ACTION_LABELS). */
export const ACTION_TYPES = [
  'WARN',
  'TIMEOUT',
  'UNTIMEOUT',
  'KICK',
  'BAN',
  'UNBAN',
  'MESSAGE_DELETE',
] as const;
export const ACTION_STATUSES = ['APPLIED', 'FAILED', 'EXPIRED', 'REVERSED'] as const;
export const AUTOMOD_RULES = [
  'DUPLICATE',
  'MENTIONS',
  'BURST',
  'INVITE',
  'BLOCKED_DOMAIN',
  'PHISHING',
  'BLOCKED_PHRASE',
  'RAID',
] as const;

export const ACTION_LABEL: Record<string, string> = {
  WARN: 'Warning',
  TIMEOUT: 'Timeout',
  UNTIMEOUT: 'Timeout removed',
  KICK: 'Kick',
  BAN: 'Ban',
  UNBAN: 'Unban',
  MESSAGE_DELETE: 'Message deleted',
};
const ACTION_TONE: Record<string, BadgeTone> = {
  WARN: 'warning',
  TIMEOUT: 'warning',
  UNTIMEOUT: 'success',
  KICK: 'danger',
  BAN: 'danger',
  UNBAN: 'success',
  MESSAGE_DELETE: 'neutral',
};

export const RECORD_STATUS_LABEL: Record<string, string> = {
  APPLIED: 'Applied',
  FAILED: 'Failed',
  EXPIRED: 'Expired',
  REVERSED: 'Reversed',
};
const RECORD_STATUS_TONE: Record<string, BadgeTone> = {
  APPLIED: 'accent',
  FAILED: 'danger',
  EXPIRED: 'neutral',
  REVERSED: 'neutral',
};

export const RULE_LABEL: Record<string, string> = {
  DUPLICATE: 'Duplicate messages',
  MENTIONS: 'Mass mentions',
  BURST: 'Message burst',
  INVITE: 'Invite link',
  BLOCKED_DOMAIN: 'Blocked domain',
  PHISHING: 'Phishing',
  BLOCKED_PHRASE: 'Blocked phrase',
  RAID: 'Raid',
};

export const APPEAL_STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pending',
  ACCEPTED: 'Accepted',
  DENIED: 'Denied',
};
const APPEAL_TONE: Record<string, BadgeTone> = { PENDING: 'accent', ACCEPTED: 'success', DENIED: 'neutral' };

export const ActionTypeBadge = ({ type }: { type: string }) => (
  <StatusBadge status={type} label={ACTION_LABEL[type]} tone={ACTION_TONE[type]} />
);
export const RecordStatusBadge = ({ status }: { status: string }) => (
  <StatusBadge status={status} label={RECORD_STATUS_LABEL[status]} tone={RECORD_STATUS_TONE[status]} />
);
export const AppealStatusBadge = ({ status }: { status: string }) => (
  <StatusBadge status={status} label={APPEAL_STATUS_LABEL[status]} tone={APPEAL_TONE[status]} />
);

/** "automod" / "system" pseudo-moderators get readable names; Discord IDs render monospace. */
export function ModeratorName({ id }: { id: string }) {
  if (id === 'automod') return <span>Automod</span>;
  if (id === 'system') return <span>GYNX System</span>;
  return <span className="font-mono text-xs">{id}</span>;
}

/** "1h 30m" style duration from seconds. */
export function formatSeconds(total: number | null): string {
  if (!total) return '—';
  const d = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`].filter(Boolean).join(' ') || `${total}s`;
}
