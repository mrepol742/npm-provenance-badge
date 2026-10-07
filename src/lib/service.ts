import { ProvenanceError, positiveInteger } from './errors.js';
import { NpmClient, type RegistryOptions } from './npm/client.js';
import {
  discoverPackages,
  latestRelease,
  parsePublisher,
} from './npm/packages.js';
import type { PublisherType } from './npm/types.js';
import { checkRelease } from './provenance/checker.js';
import type { BundleVerifier, ProvenanceStats } from './provenance/types.js';
import type { Cache } from './cache/cache.js';
import { MemoryCache } from './cache/memory.js';

export interface ServiceOptions extends RegistryOptions {
  cache?: Cache<ProvenanceStats>;
  ttlMs?: number;
  concurrency?: number;
  maxPackages?: number;
  maxActiveScans?: number;
  verifier?: BundleVerifier;
  now?: () => number;
}

export function createProvenanceService(options: ServiceOptions = {}) {
  const client = new NpmClient(options);
  const cache =
    options.cache ??
    new MemoryCache<ProvenanceStats>(1000, options.now ?? Date.now);
  const ttl = positiveInteger(options.ttlMs ?? 1800000, 'ttlMs', 86400000);
  const concurrency = positiveInteger(
    options.concurrency ?? 5,
    'concurrency',
    20,
  );
  const maxPackages = positiveInteger(
    options.maxPackages ?? 1000,
    'maxPackages',
    10000,
  );
  const maxScans = positiveInteger(
    options.maxActiveScans ?? 2,
    'maxActiveScans',
    20,
  );
  const now = options.now ?? Date.now;
  const pending = new Map<string, Promise<ProvenanceStats>>();
  const failures = new MemoryCache<{
    code: ProvenanceError['code'];
    message: string;
    status: number;
  }>(1000, now);
  // Shared across scans: no more than concurrency active package checks.
  let activeChecks = 0;
  const waiters: (() => void)[] = [];

  async function limited<T>(work: () => Promise<T>): Promise<T> {
    if (activeChecks >= concurrency)
      await new Promise<void>((resolve) => waiters.push(resolve));
    else activeChecks++;
    try {
      return await work();
    } finally {
      const next = waiters.shift();
      if (next) next();
      else activeChecks--;
    }
  }

  async function stats(
    input: string,
    type: PublisherType = 'user',
  ): Promise<ProvenanceStats> {
    const publisher = parsePublisher(input, type);
    const key = `provenance:v1:${publisher.key}`;
    const hit = await cache.get(key);

    if (hit) return structuredClone(hit);
    const existing = pending.get(key);

    if (existing) return structuredClone(await existing);
    const failure = await failures.get(key);

    if (failure)
      throw new ProvenanceError(failure.code, failure.message, failure.status);
    // Cache adapters may yield; recheck after the final awaited lookup.
    const raced = pending.get(key);

    if (raced) return structuredClone(await raced);
    if (pending.size >= maxScans)
      throw new ProvenanceError('RATE_LIMITED', 'Scan capacity reached', 429);

    const scan = (async () => {
      try {
        const names = await discoverPackages(client, publisher, maxPackages);
        let cursor = 0;
        let enabled = 0;
        let failed: unknown;
        await Promise.all(
          Array.from(
            { length: Math.min(concurrency, names.length) },
            async () => {
              while (!failed) {
                const name = names[cursor++];
                if (!name) return;
                try {
                  if (
                    await limited(async () =>
                      checkRelease(
                        client,
                        await latestRelease(client, name),
                        options.verifier,
                      ),
                    )
                  )
                    enabled++;
                } catch (error) {
                  failed = error;
                }
              }
            },
          ),
        );

        if (failed) throw failed;
        const result: ProvenanceStats = {
          publisher:
            publisher.type === 'scope' ? `@${publisher.name}` : publisher.name,
          totalPackages: names.length,
          provenancePackages: enabled,
          withoutProvenance: names.length - enabled,
          coverage: names.length
            ? Math.round((enabled / names.length) * 10000) / 100
            : 0,
          checkedAt: new Date(now()).toISOString(),
        };
        await cache.set(key, result, ttl);
        return result;
      } catch (error) {
        if (error instanceof ProvenanceError)
          await failures.set(
            key,
            { code: error.code, message: error.message, status: error.status },
            15000,
          );
        throw error;
      } finally {
        pending.delete(key);
      }
    })();

    pending.set(key, scan);
    return structuredClone(await scan);
  }
  return { getProvenanceStats: stats };
}

const defaultService = createProvenanceService();
export const getProvenanceStats = defaultService.getProvenanceStats;
