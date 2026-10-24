import { getDb } from '@gynx/database';

export const dynamic = 'force-dynamic';

/** Readiness: 200 only when the database answers within 3s. Never returns error details. */
export async function GET(): Promise<Response> {
  let db = false;
  try {
    db = await Promise.race([
      getDb().$queryRaw`SELECT 1`.then(() => true),
      new Promise<boolean>((r) => setTimeout(() => r(false), 3000)),
    ]);
  } catch {
    db = false;
  }
  return Response.json(
    { status: db ? 'ready' : 'not_ready', checks: { database: db } },
    { status: db ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  );
}
