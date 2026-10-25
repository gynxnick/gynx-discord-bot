/**
 * Deep-convert a value into plain JSON data: bigint → decimal string,
 * Date → ISO string, undefined object fields dropped. Used for API responses
 * and server→client props of the setup pages so a stray bigint in an engine
 * result can never break JSON.stringify or reach the browser as a BigInt.
 */
export type JsonSafe<T> = T extends bigint
  ? string
  : T extends Date
    ? string
    : T extends ReadonlyArray<infer U>
      ? JsonSafe<U>[]
      : T extends object
        ? { [K in keyof T]: JsonSafe<T[K]> }
        : T;

export function toJsonSafe<T>(value: T): JsonSafe<T> {
  return convert(value) as JsonSafe<T>;
}

function convert(v: unknown): unknown {
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(convert);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined) out[k] = convert(x);
    return out;
  }
  return v;
}
