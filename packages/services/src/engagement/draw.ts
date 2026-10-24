import { secureSample, sha256 } from '@gynx/shared';

/** Identifier stored on every draw so the method can be verified later. */
export const DRAW_ALGORITHM = 'crypto.randomInt-fisher-yates-v1';

/** Canonical entrant ordering: lexicographic by user id, de-duplicated. */
export const canonicalEntrants = (ids: readonly string[]): string[] => [...new Set(ids)].sort();

/** sha256 of the canonical entrant ids joined by ',' — commits the draw to the exact pool. */
export const entrantsHash = (ids: readonly string[]): string => sha256(canonicalEntrants(ids).join(','));

export interface DrawResult {
  winnerIds: string[];
  /** Canonical pool actually drawn from (entrants minus excluded). */
  pool: string[];
  entrantCount: number;
  entrantsHash: string;
  algorithm: string;
}

/**
 * Draw `count` distinct winners from `entrantIds` excluding `excludeIds` (previous winners on
 * a reroll). The pool is canonicalised before sampling so the recorded hash describes exactly
 * what was sampled. `rng` is injectable for deterministic tests; production uses crypto.randomInt.
 * With fewer eligible entrants than `count`, everyone in the pool wins.
 */
export function drawWinners(
  entrantIds: readonly string[],
  count: number,
  excludeIds: readonly string[] = [],
  rng?: (max: number) => number,
): DrawResult {
  const excluded = new Set(excludeIds);
  const pool = canonicalEntrants(entrantIds).filter((id) => !excluded.has(id));
  const winnerIds = rng ? secureSample(pool, count, rng) : secureSample(pool, count);
  return { winnerIds, pool, entrantCount: pool.length, entrantsHash: entrantsHash(pool), algorithm: DRAW_ALGORITHM };
}

export interface DrawRecordLike {
  winnerIds: readonly string[];
  entrantCount: number;
  entrantsHash: string;
  algorithm: string;
}

export interface DrawVerification {
  hashMatches: boolean;
  countMatches: boolean;
  winnersAreEntrants: boolean;
  winnersDistinct: boolean;
  knownAlgorithm: boolean;
  valid: boolean;
}

/**
 * Audit check: recompute the entrant hash from `entrantIds` (the pool the draw used) and
 * confirm the recorded winners are distinct members of it.
 */
export function verifyDraw(draw: DrawRecordLike, entrantIds: readonly string[]): DrawVerification {
  const pool = canonicalEntrants(entrantIds);
  const set = new Set(pool);
  const hashMatches = entrantsHash(pool) === draw.entrantsHash;
  const countMatches = pool.length === draw.entrantCount;
  const winnersAreEntrants = draw.winnerIds.every((w) => set.has(w));
  const winnersDistinct = new Set(draw.winnerIds).size === draw.winnerIds.length;
  const knownAlgorithm = draw.algorithm === DRAW_ALGORITHM;
  return { hashMatches, countMatches, winnersAreEntrants, winnersDistinct, knownAlgorithm, valid: hashMatches && countMatches && winnersAreEntrants && winnersDistinct && knownAlgorithm };
}
