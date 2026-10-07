import { ProvenanceError, positiveInteger } from '../errors.js';

export interface RegistryOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export class NpmClient {
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;

  constructor(options: RegistryOptions = {}) {
    this.fetcher = options.fetch ?? fetch;
    this.timeoutMs = positiveInteger(
      options.timeoutMs ?? 10000,
      'timeoutMs',
      120000,
    );
    this.maxBytes = positiveInteger(
      options.maxResponseBytes ?? 8 * 1024 * 1024,
      'maxResponseBytes',
      32 * 1024 * 1024,
    );
  }

  async get(path: string): Promise<unknown> {
    const url = new URL(path, 'https://registry.npmjs.org');

    if (
      url.origin !== 'https://registry.npmjs.org' ||
      url.username ||
      url.password
    )
      throw new ProvenanceError('INVALID_INPUT', 'Registry URL rejected', 400);

    try {
      const response = await this.fetcher(url, {
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'error',
        headers: {
          accept: 'application/json',
          'user-agent': 'npm-provenance-stats/0.1.0',
        },
      });

      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 404)
          throw new ProvenanceError('NOT_FOUND', 'npm resource not found', 404);
        throw new ProvenanceError(
          'UNAVAILABLE',
          'npm temporarily unavailable',
          503,
        );
      }

      const reader = response.body?.getReader();
      if (!reader)
        throw new ProvenanceError('UNAVAILABLE', 'Empty npm response', 503);

      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.byteLength;
          if (size > this.maxBytes)
            throw new ProvenanceError(
              'LIMIT_EXCEEDED',
              'npm response too large',
              503,
            );
          chunks.push(next.value);
        }
      } finally {
        await reader.cancel();
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch (error) {
      if (error instanceof ProvenanceError) throw error;
      throw new ProvenanceError(
        'UNAVAILABLE',
        'npm request failed or timed out',
        503,
      );
    }
  }
}
