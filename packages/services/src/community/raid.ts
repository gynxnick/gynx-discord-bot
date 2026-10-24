/** Pure anti-raid helpers (no I/O) so the rules are unit-testable. */

export interface RaidDetection {
  isRaid: boolean;
  /** Joins inside the window `(now - windowSeconds, now]`. */
  joinsInWindow: number;
  windowStart: Date;
}

/**
 * A raid is `threshold` or more joins within the trailing `windowSeconds`.
 * Timestamps in the future (clock skew) or outside the window are ignored.
 */
export function detectRaid(
  recentJoinTimestamps: readonly Date[],
  now: Date,
  threshold: number,
  windowSeconds: number,
): RaidDetection {
  const end = now.getTime();
  const start = end - windowSeconds * 1000;
  let joinsInWindow = 0;
  for (const t of recentJoinTimestamps) {
    const ms = t.getTime();
    if (ms > start && ms <= end) joinsInWindow++;
  }
  return { isRaid: threshold > 0 && joinsInWindow >= threshold, joinsInWindow, windowStart: new Date(start) };
}

const DAY_MS = 86_400_000;

export function accountAgeDays(accountCreatedAt: Date, now: Date): number {
  return Math.max(0, (now.getTime() - accountCreatedAt.getTime()) / DAY_MS);
}

/** New-account check. `minAccountAgeDays` 0 disables the check. */
export function isNewAccount(accountCreatedAt: Date, now: Date, minAccountAgeDays: number): boolean {
  if (minAccountAgeDays <= 0) return false;
  return accountAgeDays(accountCreatedAt, now) < minAccountAgeDays;
}

/** Window bucket used to dedupe raid alerts: one alert per guild per window bucket. */
export function raidBucket(now: Date, windowSeconds: number): number {
  return Math.floor(now.getTime() / (Math.max(1, windowSeconds) * 1000));
}

export const raidAlertDedupeKey = (guildId: string, bucket: number) =>
  `community.raid-alert:${guildId}:${bucket}`;
