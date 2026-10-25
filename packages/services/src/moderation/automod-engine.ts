import { domainToASCII, domainToUnicode } from 'node:url';
import type { AutomodConfig, AutomodRule } from '@gynx/database';
import { normaliseForCompare } from '@gynx/shared';
import { ModerationText as T } from './texts';

/**
 * Pure automod engine: no I/O, no Discord, deterministic for a given input.
 * The bot feeds it the message plus a small in-memory history of the author's
 * recent messages (see `AutomodHistory`).
 */
export type AutomodEngineConfig = Pick<
  AutomodConfig,
  | 'enabled'
  | 'duplicateThreshold'
  | 'duplicateWindowSeconds'
  | 'maxMentions'
  | 'burstThreshold'
  | 'burstWindowSeconds'
  | 'blockInvites'
  | 'allowedInviteCodes'
  | 'blockedDomains'
  | 'allowedDomains'
  | 'blockedPhrases'
  | 'phishingDetection'
  | 'newAccountDays'
  | 'exemptRoleIds'
  | 'exemptChannelIds'
>;

export interface AutomodMessage {
  authorId: string;
  channelId: string;
  content: string;
  /** Unique user + role mentions resolved by Discord. @everyone/@here attempts are counted from content. */
  mentionCount: number;
  roleIds: readonly string[];
  accountCreatedAt: Date;
  memberJoinedAt: Date | null;
  timestamp: Date;
}

export interface HistoryEntry {
  /** Normalised content (see normaliseMessage) — raw text is never retained. */
  content: string;
  channelId: string;
  timestamp: Date;
}

export type AutomodSeverity = 'low' | 'medium' | 'high';

export interface AutomodHit {
  rule: Exclude<AutomodRule, 'RAID'>;
  severity: AutomodSeverity;
  /** Short, human-readable; never echoes message content. */
  reason: string;
}

const DAY_MS = 86_400_000;
/** Members who joined less than this long ago are treated like new accounts for link rules. */
const RECENT_JOIN_MS = DAY_MS;

// ─────────────────────────────────────────────────────────────────────────────
// Text normalisation
// ─────────────────────────────────────────────────────────────────────────────

// Zero-width space/joiners, word joiner, BOM, soft hyphen (built from code points to keep the source ASCII).
const COMBINING_MARKS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, 'g');
const ZERO_WIDTH = new RegExp(
  `[${String.fromCharCode(0x200b)}-${String.fromCharCode(0x200d)}${String.fromCharCode(0x2060, 0xfeff, 0xad)}]`,
  'g',
);

/** Normalised form used for duplicate detection (falls back to trimmed lowercase for emoji-only text). */
export function normaliseMessage(content: string): string {
  const n = normaliseForCompare(content.replace(ZERO_WIDTH, ''));
  return n || content.replace(ZERO_WIDTH, '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Undo common link obfuscation: hxxp, [.], (.), {dot}, zero-width characters, full-width forms. */
export function deobfuscate(content: string): string {
  return content
    .normalize('NFKC')
    .replace(ZERO_WIDTH, '')
    .replace(/h[x*]{2}p(s?)/gi, 'http$1')
    .replace(/\s*(?:\[\s*(?:\.|dot)\s*\]|\(\s*(?:\.|dot)\s*\)|\{\s*(?:\.|dot)\s*\})\s*/gi, '.')
    .replace(/\[\s*:\s*\]/g, ':')
    .replace(/\[\s*\/\s*\]/g, '/');
}

const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
};

/** Phrase-matching normalisation: case, diacritics, basic leetspeak, punctuation → single spaces, padded. */
export function normaliseForPhrases(input: string): string {
  const s = input
    .replace(ZERO_WIDTH, '')
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[!|](?=[a-z0-9])/g, 'i') // "!" / "|" only count as "i" inside a word
    .replace(/[013457@$]/g, (c) => LEET[c] ?? c)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return ` ${s} `;
}

// ─────────────────────────────────────────────────────────────────────────────
// Link / host extraction
// ─────────────────────────────────────────────────────────────────────────────

const SCHEME_URL = /\bhttps?:\/\/([^\s/?#<>"'`|\\]+)/giu;
const BARE_HOST =
  /(?<![\p{L}\p{N}_@.-])((?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+(?:xn--[a-z0-9-]{2,59}|\p{L}{2,63}))\.*(?![\p{L}\p{N}_-])/giu;

function cleanHost(raw: string): string | null {
  let h = raw;
  const at = h.lastIndexOf('@');
  if (at >= 0) h = h.slice(at + 1);
  h = h.replace(/:\d*$/, '').replace(/\.+$/, '').toLowerCase();
  if (!h || !h.includes('.')) return null;
  const ascii = domainToASCII(h);
  return ascii || null;
}

/** All hostnames in the text (ASCII/punycode form, lowercased, trailing dots removed). */
export function extractHosts(content: string): string[] {
  const text = deobfuscate(content);
  const hosts = new Set<string>();
  for (const m of text.matchAll(SCHEME_URL)) {
    const h = cleanHost(m[1] ?? '');
    if (h) hosts.add(h);
  }
  // Bare domains are scanned outside full URLs so path segments (e.g. /file.html) are not mistaken for hosts.
  for (const m of text.replace(/\bhttps?:\/\/\S+/giu, ' ').matchAll(BARE_HOST)) {
    const h = cleanHost(m[1] ?? '');
    if (h) hosts.add(h);
  }
  return [...hosts];
}

const hostMatches = (host: string, domain: string) => {
  const d = domain.toLowerCase().replace(/\.+$/, '');
  return host === d || host.endsWith(`.${d}`);
};

const INVITE_RE = /(?:discord(?:app)?\.com\/invite|discord\.gg)\/([a-z0-9-]{2,32})/gi;

/** Discord invite codes in the text (after deobfuscation and collapsing whitespace around . and /). */
export function extractInviteCodes(content: string): string[] {
  const compact = deobfuscate(content).replace(/\s*([./])\s*/g, '$1');
  return [...new Set([...compact.matchAll(INVITE_RE)].map((m) => m[1]!))];
}

// ─────────────────────────────────────────────────────────────────────────────
// Phishing heuristics
// ─────────────────────────────────────────────────────────────────────────────

/** Official domains are never phishing (subdomains included). */
const LEGIT_BRAND_DOMAINS = [
  'discord.com',
  'discord.gg',
  'discordapp.com',
  'discordapp.net',
  'discord.media',
  'discord.dev',
  'discord.new',
  'discord.gift',
  'discordstatus.com',
  'steamcommunity.com',
  'steampowered.com',
  'steamstatic.com',
  'steamgames.com',
  'steamusercontent.com',
  'steamchina.com',
];
const BRANDS = ['discord', 'steamcommunity', 'steampowered'];
const BRAND_WORDS = ['discord', 'steam'];
const HOST_SCAM_WORDS = ['nitro', 'gift', 'free', 'promo', 'airdrop', 'giveaway', 'reward', 'claim'];

/** Map common Unicode confusables (Cyrillic/Greek) to Latin. */
const CONFUSABLES: Record<string, string> = {
  а: 'a',
  е: 'e',
  о: 'o',
  р: 'p',
  с: 'c',
  у: 'y',
  х: 'x',
  і: 'i',
  ј: 'j',
  ԁ: 'd',
  ѕ: 's',
  ɡ: 'g',
  ı: 'i',
  ⅼ: 'l',
  ο: 'o',
  ρ: 'p',
  α: 'a',
  ν: 'v',
  м: 'm',
  т: 't',
  к: 'k',
  ӏ: 'l',
  ԛ: 'q',
  ԝ: 'w',
  ɑ: 'a',
};

/** Visual skeleton: confusables → Latin, digits → letters, rn→m, cl→d, vv→w, l→i, separators removed. */
export function skeleton(label: string): string {
  return [...label.toLowerCase()]
    .map((c) => CONFUSABLES[c] ?? c)
    .join('')
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .replace(/[0]/g, 'o')
    .replace(/[3]/g, 'e')
    .replace(/[4@]/g, 'a')
    .replace(/[5$]/g, 's')
    .replace(/[-_.]/g, '')
    .replace(/rn/g, 'm')
    .replace(/vv/g, 'w')
    .replace(/cl/g, 'd')
    .replace(/[1l|!]/g, 'i');
}

const BRAND_SKELETONS = BRANDS.map((b) => ({ brand: b, skel: skeleton(b) }));

const GIFT_WORDING =
  /\b(?:free\s+(?:discord\s+)?nitro|nitro\s+(?:for\s+free|gift|giveaway|generator)|(?:discord|steam|nitro)\s+gift|gift\s+(?:card|nitro)|free\s+steam|free\s+skins?|steam\s+(?:giveaway|airdrop))\b/;
const CLAIM_WORDING =
  /\b(?:claim|redeem|grab)\b.{0,40}\b(?:nitro|gift|reward|skins?|prize)\b|\b(?:first|only)\s+\d+\s+(?:users|people|members)\b|\b(?:expires?|limited)\s+(?:soon|today|time)\b/;

export interface PhishingAssessment {
  strong: string[];
  weak: string[];
}

/**
 * Conservative phishing heuristic. A message is phishing when it contains at
 * least one link AND either one STRONG signal or two distinct WEAK signals
 * (one weak signal suffices for new accounts / brand-new members).
 *
 * STRONG:
 *  - typosquat of discord / steamcommunity / steampowered (e.g. `dlscord`, `discorcl`,
 *    `steamcommunlty`, `dis-cord`, Cyrillic/punycode `xn--` lookalikes) on a non-official host
 *  - official brand name combined with a scam word in the host (`discord-nitro`, `steam-gift`)
 *  - `free-nitro` / `nitro-gift` style hosts
 * WEAK (each kind counted once):
 *  - non-official host containing "discord"/"steam" (e.g. `discordjs.guide` — legitimate on its own)
 *  - host containing a scam word (nitro, gift, free, promo, airdrop, …)
 *  - punycode host that does not resolve to a known brand lookalike
 *  - gift wording ("free nitro", "steam gift", …)
 *  - urgency/claim wording ("claim your reward", "first 100 users")
 *  - @everyone/@here attempt together with a link
 */
export function assessPhishing(content: string, hosts: readonly string[]): PhishingAssessment {
  const strong = new Set<string>();
  const weak = new Set<string>();
  for (const host of hosts) {
    if (LEGIT_BRAND_DOMAINS.some((d) => hostMatches(host, d))) continue;
    const unicode = host.includes('xn--') ? domainToUnicode(host) || host : host;
    const labels = unicode.split('.');
    const registrable = labels.slice(0, -1).join('.'); // drop TLD
    const skel = skeleton(registrable);
    const asciiReg = host.split('.').slice(0, -1).join('.');
    const hasBrandWord = BRAND_WORDS.some((b) => asciiReg.includes(b));
    const hasScamWord = HOST_SCAM_WORDS.some((w) => asciiReg.includes(w));

    for (const { brand, skel: bs } of BRAND_SKELETONS) {
      if (skel.includes(bs) && !asciiReg.includes(brand)) strong.add('brand-lookalike');
    }
    if (hasBrandWord && hasScamWord) strong.add('brand-scam-host');
    if (/(?:free|gift)[-.]?nitro|nitro[-.]?(?:gift|free)/.test(asciiReg)) strong.add('nitro-host');
    if (hasBrandWord) weak.add('brand-in-host');
    if (hasScamWord) weak.add('scam-word-in-host');
    if (host.includes('xn--') && !strong.has('brand-lookalike')) weak.add('punycode-host');
  }
  const text = normaliseForCompare(deobfuscate(content));
  if (GIFT_WORDING.test(text)) weak.add('gift-wording');
  if (CLAIM_WORDING.test(text)) weak.add('claim-wording');
  if (hosts.length > 0 && /@(?:everyone|here)\b/i.test(content)) weak.add('mass-mention-with-link');
  return { strong: [...strong], weak: [...weak] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Evaluation
// ─────────────────────────────────────────────────────────────────────────────

export function isNewcomer(
  cfg: Pick<AutomodEngineConfig, 'newAccountDays'>,
  msg: Pick<AutomodMessage, 'accountCreatedAt' | 'memberJoinedAt' | 'timestamp'>,
): boolean {
  const now = msg.timestamp.getTime();
  if (cfg.newAccountDays > 0 && now - msg.accountCreatedAt.getTime() < cfg.newAccountDays * DAY_MS)
    return true;
  return msg.memberJoinedAt !== null && now - msg.memberJoinedAt.getTime() < RECENT_JOIN_MS;
}

export function isExempt(
  cfg: Pick<AutomodEngineConfig, 'exemptChannelIds' | 'exemptRoleIds'>,
  msg: Pick<AutomodMessage, 'channelId' | 'roleIds'>,
): boolean {
  return (
    cfg.exemptChannelIds.includes(msg.channelId) || msg.roleIds.some((r) => cfg.exemptRoleIds.includes(r))
  );
}

const countMassMentions = (content: string) => (content.match(/@(?:everyone|here)\b/gi) ?? []).length;

/**
 * Evaluate one message. Rules are checked in priority order and the first hit
 * is returned: PHISHING, BLOCKED_DOMAIN, INVITE, MENTIONS, BLOCKED_PHRASE, DUPLICATE, BURST.
 * `history` = the author's recent messages, excluding `msg` itself.
 */
export function evaluateMessage(
  cfg: AutomodEngineConfig,
  msg: AutomodMessage,
  history: readonly HistoryEntry[],
): AutomodHit | null {
  if (!cfg.enabled || isExempt(cfg, msg)) return null;
  const newcomer = isNewcomer(cfg, msg);
  const hosts = extractHosts(msg.content);

  if (cfg.phishingDetection && hosts.length > 0) {
    const p = assessPhishing(msg.content, hosts);
    if (p.strong.length > 0 || p.weak.length >= (newcomer ? 1 : 2)) {
      return {
        rule: 'PHISHING',
        severity: 'high',
        reason: T.automodReasonPhishing(),
      };
    }
  }

  if (cfg.blockedDomains.length > 0) {
    const blocked = hosts.find(
      (h) =>
        cfg.blockedDomains.some((d) => hostMatches(h, d)) &&
        !cfg.allowedDomains.some((d) => hostMatches(h, d)),
    );
    if (blocked)
      return {
        rule: 'BLOCKED_DOMAIN',
        severity: 'medium',
        reason: T.automodReasonBlockedDomain({ domain: blocked }),
      };
  }

  if (cfg.blockInvites || newcomer) {
    const codes = extractInviteCodes(msg.content).filter((c) => !cfg.allowedInviteCodes.includes(c));
    if (codes.length > 0) {
      return {
        rule: 'INVITE',
        severity: 'medium',
        reason: newcomer && !cfg.blockInvites ? T.automodReasonInviteNewAccount() : T.automodReasonInvite(),
      };
    }
  }

  const mentions = msg.mentionCount + countMassMentions(msg.content);
  if (mentions > cfg.maxMentions) {
    return { rule: 'MENTIONS', severity: 'high', reason: T.automodReasonMentions({ count: mentions }) };
  }

  if (cfg.blockedPhrases.length > 0) {
    const text = normaliseForPhrases(msg.content);
    const hit = cfg.blockedPhrases.some((p) => {
      const np = normaliseForPhrases(p).trim();
      return np.length > 0 && text.includes(` ${np} `);
    });
    if (hit)
      return {
        rule: 'BLOCKED_PHRASE',
        severity: 'medium',
        reason: T.automodReasonBlockedPhrase(),
      };
  }

  const now = msg.timestamp.getTime();
  const norm = normaliseMessage(msg.content);
  if (norm) {
    const since = now - cfg.duplicateWindowSeconds * 1000;
    const dupes =
      history.filter((h) => h.timestamp.getTime() >= since && normaliseMessage(h.content) === norm).length +
      1;
    if (dupes >= cfg.duplicateThreshold) {
      return {
        rule: 'DUPLICATE',
        severity: 'low',
        reason: T.automodReasonDuplicate({ count: dupes }),
      };
    }
  }

  const burstSince = now - cfg.burstWindowSeconds * 1000;
  const burst = history.filter((h) => h.timestamp.getTime() >= burstSince).length + 1;
  if (burst >= cfg.burstThreshold) {
    return {
      rule: 'BURST',
      severity: 'low',
      reason: T.automodReasonBurst({ count: burst, seconds: cfg.burstWindowSeconds }),
    };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bounded per-user sliding window (kept in bot memory only)
// ─────────────────────────────────────────────────────────────────────────────

export interface AutomodHistoryOptions {
  maxPerUser?: number;
  idleMs?: number;
  maxUsers?: number;
}

/**
 * Bounded in-memory history: at most `maxPerUser` entries per user, users idle
 * for `idleMs` are evicted, and at most `maxUsers` users are tracked (least
 * recently active evicted first). Stores only normalised, truncated content.
 */
export class AutomodHistory {
  private readonly users = new Map<string, { entries: HistoryEntry[]; lastSeen: number }>();
  private lastSweep = 0;
  readonly maxPerUser: number;
  readonly idleMs: number;
  readonly maxUsers: number;

  constructor(opts: AutomodHistoryOptions = {}) {
    this.maxPerUser = opts.maxPerUser ?? 20;
    this.idleMs = opts.idleMs ?? 5 * 60_000;
    this.maxUsers = opts.maxUsers ?? 5_000;
  }

  get size(): number {
    return this.users.size;
  }

  get(userId: string, now: Date): HistoryEntry[] {
    const u = this.users.get(userId);
    if (!u) return [];
    if (now.getTime() - u.lastSeen > this.idleMs) {
      this.users.delete(userId);
      return [];
    }
    return [...u.entries];
  }

  push(userId: string, channelId: string, content: string, timestamp: Date): void {
    const now = timestamp.getTime();
    if (now - this.lastSweep > 60_000) this.sweep(timestamp);
    const existing = this.users.get(userId);
    const entries = existing && now - existing.lastSeen <= this.idleMs ? existing.entries : [];
    entries.push({ content: normaliseMessage(content).slice(0, 500), channelId, timestamp });
    if (entries.length > this.maxPerUser) entries.splice(0, entries.length - this.maxPerUser);
    this.users.delete(userId); // re-insert to keep Map order = recency
    this.users.set(userId, { entries, lastSeen: now });
    while (this.users.size > this.maxUsers) {
      const oldest = this.users.keys().next().value;
      if (oldest === undefined) break;
      this.users.delete(oldest);
    }
  }

  clear(userId: string): void {
    this.users.delete(userId);
  }

  sweep(now: Date): void {
    this.lastSweep = now.getTime();
    for (const [id, u] of this.users) if (now.getTime() - u.lastSeen > this.idleMs) this.users.delete(id);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Escalation policies (pure)
// ─────────────────────────────────────────────────────────────────────────────

export type AutomodDecisionAction = 'DELETE' | 'WARN' | 'TIMEOUT';

export interface AutomodDecision {
  action: AutomodDecisionAction;
  strikes: number;
  /** For TIMEOUT. */
  durationMs: number | null;
}

/** Strike-based automod escalation. Never bans: the strongest automatic action is a timeout. */
export function decideAutomodAction(
  strikes: number,
  cfg: Pick<AutomodConfig, 'warnAtStrikes' | 'timeoutAtStrikes' | 'timeoutMinutes'>,
): AutomodDecision {
  if (strikes >= cfg.timeoutAtStrikes)
    return { action: 'TIMEOUT', strikes, durationMs: cfg.timeoutMinutes * 60_000 };
  if (strikes >= cfg.warnAtStrikes) return { action: 'WARN', strikes, durationMs: null };
  return { action: 'DELETE', strikes, durationMs: null };
}

export interface EscalationSuggestion {
  action: 'WARN' | 'TIMEOUT' | 'KICK' | 'BAN_REVIEW';
  durationMs: number | null;
  summary: string;
}

/**
 * Advisory policy for moderators, based on ACTIVE warnings. Displayed by
 * /warn and /warnings; never applied automatically.
 *   active < warnAtStrikes                      → another warning is proportionate
 *   warnAtStrikes ≤ active < timeoutAtStrikes   → timeout (timeoutMinutes)
 *   timeoutAtStrikes ≤ active < 2×timeoutAt…    → longer timeout (24h) or kick
 *   active ≥ 2×timeoutAtStrikes                 → consider a ban (senior review)
 */
export function suggestEscalation(
  activeWarnings: number,
  cfg: Pick<AutomodConfig, 'warnAtStrikes' | 'timeoutAtStrikes' | 'timeoutMinutes'>,
): EscalationSuggestion {
  if (activeWarnings >= cfg.timeoutAtStrikes * 2) {
    return {
      action: 'BAN_REVIEW',
      durationMs: null,
      summary: T.escalationBan({ count: activeWarnings }),
    };
  }
  if (activeWarnings >= cfg.timeoutAtStrikes) {
    return {
      action: 'KICK',
      durationMs: 24 * 3_600_000,
      summary: T.escalationKick({ count: activeWarnings }),
    };
  }
  if (activeWarnings >= cfg.warnAtStrikes) {
    return {
      action: 'TIMEOUT',
      durationMs: cfg.timeoutMinutes * 60_000,
      summary: T.escalationTimeout({ count: activeWarnings, minutes: cfg.timeoutMinutes }),
    };
  }
  return {
    action: 'WARN',
    durationMs: null,
    summary: T.escalationWarn({ count: activeWarnings }),
  };
}
