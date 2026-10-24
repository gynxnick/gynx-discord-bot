import { createServer, type Server } from 'node:http';
import type { Logger } from '@gynx/config';

export type ReadinessCheck = () => Promise<boolean>;

/**
 * Minimal health endpoint for container orchestration:
 *  - GET /livez  → 200 while the process event loop is alive (liveness)
 *  - GET /readyz → 200 only when every dependency check passes (readiness)
 * Responses never include error details.
 */
export function startHealthServer(port: number, checks: Record<string, ReadinessCheck>, log: Logger): Server {
  const server = createServer(async (req, res) => {
    if (req.url === '/livez') {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ok"}');
      return;
    }
    if (req.url === '/readyz') {
      const results: Record<string, boolean> = {};
      await Promise.all(
        Object.entries(checks).map(async ([name, check]) => {
          try {
            results[name] = await Promise.race([
              check(),
              new Promise<boolean>((r) => setTimeout(() => r(false), 3000)),
            ]);
          } catch {
            results[name] = false;
          }
        }),
      );
      const ok = Object.values(results).every(Boolean);
      res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' }).end(JSON.stringify({ status: ok ? 'ready' : 'not_ready', checks: results }));
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(port, () => log.info({ port }, 'health server listening'));
  return server;
}
