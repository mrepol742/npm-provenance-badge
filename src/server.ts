import { createServer } from 'node:http';
import { createApp } from './api/app.js';
import { createProvenanceService } from './lib/service.js';
import { positiveInteger } from './lib/errors.js';
const numeric = (key: string, fallback: number) =>
  positiveInteger(Number(process.env[key] ?? fallback), key, 86400000);
const app = createApp({
  service: createProvenanceService({
    ttlMs: numeric('CACHE_TTL_MS', 1800000),
    concurrency: numeric('CONCURRENCY', 5),
    maxPackages: numeric('MAX_PACKAGES', 1000),
    maxActiveScans: numeric('MAX_ACTIVE_SCANS', 2),
  }),
  requestsPerMinute: numeric('REQUESTS_PER_MINUTE', 120),
});
const server = createServer(
  { maxHeaderSize: 8192, requestTimeout: 15000, headersTimeout: 10000 },
  async (req, res) => {
    try {
      // Use a fixed base; never trust Host or forwarded IP headers.
      const request = new Request(new URL(req.url ?? '/', 'http://localhost'), {
        method: req.method ?? 'GET',
      });
      const response = await app(
        request,
        req.socket.remoteAddress ?? 'unknown',
      );
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      res.writeHead(500, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      res.end('{"error":{"code":"INTERNAL_ERROR","message":"Request failed"}}');
    }
  },
);
server.maxRequestsPerSocket = 1000;
server.listen(numeric('PORT', 3000), process.env.HOST ?? '0.0.0.0');
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.on(signal, () => {
    server.close();
    server.closeIdleConnections();
    setTimeout(() => process.exit(0), 10000).unref();
  });
