import { ProvenanceError, record } from '../errors.js';
import type { NpmClient } from './client.js';
import type { Publisher, PublisherType, Release } from './types.js';

export function parsePublisher(
  input: string,
  type: PublisherType = 'user',
): Publisher {
  if (type !== 'user' && type !== 'scope')
    throw new ProvenanceError('INVALID_INPUT', 'Invalid publisher type', 400);

  const name = input.startsWith('@') ? input.slice(1) : input;
  if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(name))
    throw new ProvenanceError('INVALID_INPUT', 'Invalid publisher', 400);

  const resolvedType = input.startsWith('@') ? 'scope' : type;
  return { name, type: resolvedType, key: `${resolvedType}:${name}` };
}

export function validPackageName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name.length <= 214 &&
    /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name)
  );
}

export async function discoverPackages(
  client: NpmClient,
  publisher: Publisher,
  maxPackages: number,
): Promise<string[]> {
  const names = new Set<string>();
  let expected: number | undefined;

  for (let from = 0; ;) {
    const query = new URLSearchParams({
      text: `${publisher.type === 'scope' ? 'scope' : 'maintainer'}:${publisher.name}`,
      size: '250',
      from: String(from),
    });
    const data = record(await client.get(`/-/v1/search?${query}`));
    if (
      !Array.isArray(data.objects) ||
      !Number.isSafeInteger(data.total) ||
      data.total < 0
    )
      throw new ProvenanceError('UNAVAILABLE', 'Malformed search results');
    if (data.total > maxPackages)
      throw new ProvenanceError(
        'LIMIT_EXCEEDED',
        'Publisher exceeds scan limit',
        503,
      );
    if (expected !== undefined && expected !== data.total)
      throw new ProvenanceError(
        'UNAVAILABLE',
        'Search changed during pagination',
        503,
      );

    expected = data.total as number;
    for (const item of data.objects) {
      const pkg = record(record(item).package);
      if (!validPackageName(pkg.name))
        throw new ProvenanceError('UNAVAILABLE', 'Invalid search package');

      const member =
        publisher.type === 'scope'
          ? pkg.name.startsWith(`@${publisher.name}/`)
          : Array.isArray(pkg.maintainers) &&
            pkg.maintainers.some(
              (m: unknown) => record(m).username === publisher.name,
            );
      if (!member || names.has(pkg.name))
        throw new ProvenanceError(
          'UNAVAILABLE',
          'Inconsistent search results',
          503,
        );
      names.add(pkg.name);
    }
    from += data.objects.length;
    if (from === expected) return [...names];
    if (data.objects.length === 0 || from > expected)
      throw new ProvenanceError(
        'UNAVAILABLE',
        'Incomplete search results',
        503,
      );
  }
}

export async function latestRelease(
  client: NpmClient,
  name: string,
): Promise<Release> {
  if (!validPackageName(name))
    throw new ProvenanceError('INVALID_INPUT', 'Invalid package', 400);
  let raw: unknown;
  try {
    raw = await client.get(`/${encodeURIComponent(name)}/latest`);
  } catch (error) {
    if (error instanceof ProvenanceError && error.code === 'NOT_FOUND')
      throw new ProvenanceError(
        'UNAVAILABLE',
        'Package disappeared during scan',
        503,
      );
    throw error;
  }
  const data = record(raw);
  const dist = record(data.dist);
  if (
    data.name !== name ||
    typeof data.version !== 'string' ||
    !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
      data.version,
    ) ||
    data.version.length > 128
  )
    throw new ProvenanceError('UNAVAILABLE', 'Malformed release identity');
  const release: Release = { name, version: data.version };
  if (typeof dist.integrity === 'string') release.integrity = dist.integrity;
  if (dist.attestations !== undefined) {
    const att = record(dist.attestations);
    if (att.provenance !== undefined) {
      const prov = record(att.provenance);
      if (typeof att.url !== 'string' || typeof prov.predicateType !== 'string')
        throw new ProvenanceError(
          'UNAVAILABLE',
          'Malformed provenance metadata',
        );
      release.attestations = {
        url: att.url,
        predicateType: prov.predicateType,
      };
    }
  }
  return release;
}
