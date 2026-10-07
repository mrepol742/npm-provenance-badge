import { ProvenanceError, positiveInteger } from '../lib/errors.js';
import { createProvenanceService } from '../lib/service.js';
import { customColor, type ColorThreshold } from '../lib/badge/colors.js';
import { renderBadge, renderSvg, type Display } from '../lib/badge/render.js';
import type { PublisherType } from '../lib/npm/types.js';

export interface AppOptions {
  colorThresholds?: readonly ColorThreshold[];
  service?: ReturnType<typeof createProvenanceService>;
  requestsPerMinute?: number;
  maxClients?: number;
  now?: () => number;
}

export function createApp(options: AppOptions = {}) {
  const service = options.service ?? createProvenanceService();
  const now = options.now ?? Date.now;
  const limit = positiveInteger(
    options.requestsPerMinute ?? 120,
    'requestsPerMinute',
  );
  const maxClients = positiveInteger(options.maxClients ?? 10000, 'maxClients');
  const clients = new Map<string, { count: number; expires: number }>();

  // clientId must come from the socket or a separately authenticated proxy adapter.
  return async function handle(
    request: Request,
    clientId = 'library',
  ): Promise<Response> {
    const url = new URL(request.url);
    const badge = url.pathname.startsWith('/badge/');
    const headers = {
      'x-content-type-options': 'nosniff',
      'content-security-policy':
        "default-src 'none'; style-src 'unsafe-inline'",
      'cache-control': 'no-store',
    };
    
    try {
      let client = clients.get(clientId);
      if (!client || client.expires <= now()) {
        if (clients.size >= maxClients)
          for (const [key, value] of clients)
            if (value.expires <= now()) clients.delete(key);
        if (!clients.has(clientId) && clients.size >= maxClients)
          throw new ProvenanceError(
            'RATE_LIMITED',
            'Client capacity reached',
            429,
          );
        client = { count: 0, expires: now() + 60000 };
        clients.set(clientId, client);
      }
      if (++client.count > limit)
        throw new ProvenanceError('RATE_LIMITED', 'Too many requests', 429);
      if (request.method !== 'GET' && request.method !== 'HEAD')
        return new Response(null, {
          status: 405,
          headers: { ...headers, allow: 'GET, HEAD' },
        });
      const match = /^\/(badge|api\/provenance)\/([^/]+)$/.exec(url.pathname);
      if (!match)
        return Response.json(
          { error: { code: 'NOT_FOUND', message: 'Route not found' } },
          { status: 404, headers },
        );
      if (url.href.length > 1024)
        throw new ProvenanceError('INVALID_INPUT', 'URL too long', 400);
      for (const key of url.searchParams.keys())
        if (
          !['type', 'display', 'color'].includes(key) ||
          url.searchParams.getAll(key).length !== 1
        )
          throw new ProvenanceError(
            'INVALID_INPUT',
            'Invalid query parameter',
            400,
          );
      const type = url.searchParams.get('type') ?? 'user';
      const display = url.searchParams.get('display') ?? 'ratio';
      if (
        !['user', 'scope'].includes(type) ||
        !['ratio', 'count', 'percentage'].includes(display)
      )
        throw new ProvenanceError(
          'INVALID_INPUT',
          'Invalid type or display',
          400,
        );
      const rawColor = url.searchParams.get('color');
      const color = rawColor === null ? undefined : customColor(rawColor);
      if (rawColor !== null && !color)
        throw new ProvenanceError('INVALID_INPUT', 'Invalid badge color', 400);
      let publisher: string;
      try {
        publisher = decodeURIComponent(match[2]!);
      } catch {
        throw new ProvenanceError(
          'INVALID_INPUT',
          'Invalid path encoding',
          400,
        );
      }
      const stats = await service.getProvenanceStats(
        publisher,
        type as PublisherType,
      );
      const successHeaders = {
        ...headers,
        'cache-control': 'public, max-age=300',
        'content-type': badge
          ? 'image/svg+xml; charset=utf-8'
          : 'application/json; charset=utf-8',
      };
      
      return new Response(
        request.method === 'HEAD'
          ? null
          : badge
            ? renderBadge(
                stats,
                display as Display,
                color,
                options.colorThresholds,
              )
            : JSON.stringify(stats),
        { headers: successHeaders },
      );
    } catch (error) {
      const known =
        error instanceof ProvenanceError
          ? error
          : new ProvenanceError(
              'VERIFICATION_FAILED',
              'Unexpected verification error',
              500,
            );
      const extra = known.status === 429 ? { 'retry-after': '60' } : {};
      if (badge) {
        const value =
          known.code === 'NOT_FOUND'
            ? 'user not found'
            : ['UNAVAILABLE', 'RATE_LIMITED', 'LIMIT_EXCEEDED'].includes(
                  known.code,
                )
              ? 'unavailable'
              : 'error';
        return new Response(
          request.method === 'HEAD' ? null : renderSvg(value, '#9f9f9f'),
          {
            headers: {
              ...headers,
              ...extra,
              'content-type': 'image/svg+xml; charset=utf-8',
            },
          },
        );
      }
      
      return new Response(
        request.method === 'HEAD'
          ? null
          : JSON.stringify({
              error: { code: known.code, message: known.message },
            }),
        {
          status: known.status,
          headers: {
            ...headers,
            ...extra,
            'content-type': 'application/json; charset=utf-8',
          },
        },
      );
    }
  };
}
