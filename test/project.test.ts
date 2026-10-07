import { describe, expect, it, vi } from 'vitest';
import {
  createProvenanceService,
  createApp,
  MemoryCache,
  renderBadge,
  renderSvg,
  automaticColor,
  ProvenanceError,
} from '../src/index.js';
import { NpmClient } from '../src/lib/npm/client.js';
import { checkRelease, packageUrl } from '../src/lib/provenance/checker.js';
import { latestRelease } from '../src/lib/npm/packages.js';
import type { Release } from '../src/lib/npm/types.js';

const predicateType = 'https://slsa.dev/provenance/v1';
const integrity = `sha512-${Buffer.alloc(64, 7).toString('base64')}`;

function release(name = 'example', provenance = true): Release {
  return {
    name,
    version: '2.0.0',
    integrity,
    ...(provenance
      ? {
          attestations: {
            url: `https://registry.npmjs.org/-/npm/v1/attestations/${name}@2.0.0`,
            predicateType,
          },
        }
      : {}),
  };
}

function attestation(rel: Release = release()) {
  const statement = {
    _type: 'https://in-toto.io/Statement/v1',
    predicateType,
    predicate: {},
    subject: [
      {
        name: packageUrl(rel),
        digest: { sha512: Buffer.alloc(64, 7).toString('hex') },
      },
    ],
  };

  return {
    attestations: [
      {
        predicateType,
        bundle: {
          mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
          dsseEnvelope: {
            payloadType: 'application/vnd.in-toto+json',
            payload: Buffer.from(JSON.stringify(statement)).toString('base64'),
            signatures: [{ sig: 'fake' }],
          },
          verificationMaterial: {
            certificate: { rawBytes: 'fake' },
            tlogEntries: [],
          },
        },
      },
    ],
  };
}
function mockRegistry(flags: boolean[], scope = false) {
  const names = flags.map((_, i) => (scope ? `@team/pkg-${i}` : `pkg-${i}`));
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/-/v1/search')
      return Response.json({
        total: names.length,
        objects: names.map((name) => ({
          package: { name, maintainers: [{ username: 'alice' }] },
        })),
      });
    if (url.pathname.startsWith('/-/npm/v1/attestations/')) {
      const name = decodeURIComponent(
        url.pathname.slice('/-/npm/v1/attestations/'.length),
      ).replace(/@2\.0\.0$/, '');
      return Response.json(attestation(release(name)));
    }
    const name = decodeURIComponent(
      url.pathname.slice(1).replace(/\/latest$/, ''),
    );
    const r = release(name, flags[names.indexOf(name)]);
    return Response.json({
      name,
      version: r.version,
      dist: {
        integrity,
        ...(r.attestations
          ? {
              attestations: {
                url: r.attestations.url,
                provenance: { predicateType },
              },
            }
          : {}),
      },
    });
  });
  return fetcher;
}
const verified = vi.fn(async () => {});
describe('coverage service', () => {
  it.each([[true, true, true], [true, false, true], [false, false, false], []])(
    'calculates exact coverage for %j',
    async (...flags: boolean[]) => {
      const result = await createProvenanceService({
        fetch: mockRegistry(flags),
        verifier: verified,
      }).getProvenanceStats('alice');
      expect(result.totalPackages).toBe(flags.length);
      expect(result.provenancePackages).toBe(flags.filter(Boolean).length);
      expect(result.withoutProvenance).toBe(flags.filter((x) => !x).length);
      expect(result.coverage).toBe(
        flags.length
          ? Math.round((flags.filter(Boolean).length / flags.length) * 10000) /
              100
          : 0,
      );
      expect(JSON.stringify(result)).not.toContain('pkg-');
    },
  );
  it('supports scopes and isolates scope and user cache keys', async () => {
    const fetcher = mockRegistry([true], true);
    const service = createProvenanceService({
      fetch: fetcher,
      verifier: verified,
    });
    expect((await service.getProvenanceStats('team', 'scope')).publisher).toBe(
      '@team',
    );
    expect((await service.getProvenanceStats('@team')).totalPackages).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('does not guess nonexistence from zero search results', async () => {
    expect(
      (
        await createProvenanceService({
          fetch: mockRegistry([]),
        }).getProvenanceStats('nonexistent')
      ).totalPackages,
    ).toBe(0);
  });
  it('maps an explicit 404', async () => {
    const service = createProvenanceService({
      fetch: vi.fn(async () => new Response(null, { status: 404 })),
    });
    await expect(service.getProvenanceStats('alice')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
  it('fails a partial scan and negative caches failures without claiming absence', async () => {
    const fetcher = mockRegistry([true, false]);
    const verifier = vi.fn(async () => {
      throw new Error('invalid signature');
    });
    const service = createProvenanceService({ fetch: fetcher, verifier });
    await expect(service.getProvenanceStats('alice')).rejects.toMatchObject({
      code: 'VERIFICATION_FAILED',
    });
    const calls = fetcher.mock.calls.length;
    await expect(service.getProvenanceStats('alice')).rejects.toMatchObject({
      code: 'VERIFICATION_FAILED',
      status: 502,
    });
    expect(fetcher).toHaveBeenCalledTimes(calls);
  });
  it('coalesces cache misses and serves cache hits', async () => {
    const fetcher = mockRegistry([true]);
    const service = createProvenanceService({
      fetch: fetcher,
      verifier: verified,
    });
    await Promise.all([
      service.getProvenanceStats('alice'),
      service.getProvenanceStats('alice'),
    ]);
    const result = await service.getProvenanceStats('alice');
    result.totalPackages = 999;
    expect((await service.getProvenanceStats('alice')).totalPackages).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('refreshes after TTL expiration', async () => {
    let now = 0;
    const fetcher = mockRegistry([false]);
    const cache = new MemoryCache<any>(10, () => now);
    const service = createProvenanceService({
      fetch: fetcher,
      cache,
      ttlMs: 100,
    });
    await service.getProvenanceStats('alice');
    now = 101;
    await service.getProvenanceStats('alice');
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('bounds concurrent checks and rejects excess scans', async () => {
    let active = 0;
    let peak = 0;
    const upstream = mockRegistry(Array(12).fill(true));
    const fetcher: typeof fetch = async (...args) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      try {
        return await upstream(...args);
      } finally {
        active--;
      }
    };
    await createProvenanceService({
      fetch: fetcher,
      verifier: verified,
      concurrency: 3,
    }).getProvenanceStats('alice');
    expect(peak).toBeLessThanOrEqual(3);
    let unlock!: () => void;
    const gate = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const service = createProvenanceService({
      fetch: async () => {
        await gate;
        return Response.json({ total: 0, objects: [] });
      },
      maxActiveScans: 1,
    });
    const scan = service.getProvenanceStats('alice');
    await Promise.resolve();
    await Promise.resolve();
    await expect(service.getProvenanceStats('bob')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    unlock();
    await scan;
  });
  it('rejects truncation, inconsistent membership and malformed metadata', async () => {
    for (const payload of [
      {},
      { total: 1, objects: [] },
      { total: 1, objects: [{ package: { name: 'wrong', maintainers: [] } }] },
    ]) {
      await expect(
        createProvenanceService({
          fetch: async () => Response.json(payload),
        }).getProvenanceStats('alice'),
      ).rejects.toBeInstanceOf(ProvenanceError);
    }
  });
});
describe('provenance verification', () => {
  it.each([false, true])(
    'checks latest release only, regardless of older provenance (%s)',
    async (latest) => {
      const fetcher = mockRegistry([latest]);
      const stats = await createProvenanceService({
        fetch: fetcher,
        verifier: verified,
      }).getProvenanceStats('alice');
      expect(stats.provenancePackages).toBe(Number(latest));
      expect(
        fetcher.mock.calls.some(([url]) =>
          String(url).endsWith('/pkg-0/latest'),
        ),
      ).toBe(true);
      expect(
        fetcher.mock.calls.some(([url]) => String(url).includes('1.0.0')),
      ).toBe(false);
    },
  );
  it('verifies the bundle after binding the exact identity and digest', async () => {
    const verifier = vi.fn(async () => {});
    expect(
      await checkRelease(
        new NpmClient({ fetch: async () => Response.json(attestation()) }),
        release(),
        verifier,
      ),
    ).toBe(true);
    expect(verifier).toHaveBeenCalledOnce();
  });
  it.each([
    'subject',
    'digest',
    'predicate',
    'certificate',
    'publish-only',
    'signature',
  ])('rejects invalid %s evidence', async (kind) => {
    const data = attestation();
    const bundle = data.attestations[0]!.bundle;
    const statement = JSON.parse(
      Buffer.from(bundle.dsseEnvelope.payload, 'base64').toString(),
    );
    if (kind === 'subject') statement.subject[0].name = 'pkg:npm/wrong@2.0.0';
    if (kind === 'digest') statement.subject[0].digest.sha512 = 'bad';
    if (kind === 'predicate') statement.predicateType = 'other';
    if (kind === 'certificate')
      bundle.verificationMaterial.certificate.rawBytes = '';
    if (kind === 'publish-only')
      data.attestations[0]!.predicateType = 'npm-publish';
    bundle.dsseEnvelope.payload = Buffer.from(
      JSON.stringify(statement),
    ).toString('base64');
    const verifier = async () => {
      if (kind === 'signature' || kind === 'certificate')
        throw new Error('bad');
    };
    await expect(
      checkRelease(
        new NpmClient({ fetch: async () => Response.json(data) }),
        release(),
        verifier,
      ),
    ).rejects.toMatchObject({ code: 'VERIFICATION_FAILED' });
  });
  it('blocks SSRF without making a request', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const rel = release();
    rel.attestations!.url = 'http://127.0.0.1/private';
    await expect(
      checkRelease(new NpmClient({ fetch: fetcher }), rel, verified),
    ).rejects.toMatchObject({ code: 'VERIFICATION_FAILED' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects malformed latest metadata', async () => {
    await expect(
      latestRelease(
        new NpmClient({
          fetch: async () =>
            Response.json({ name: 'example', version: '2.0.0' }),
        }),
        'example',
      ),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });
});
describe('network resilience', () => {
  it('times out npm requests', async () => {
    const fetcher: typeof fetch = async (_url, init) =>
      new Promise((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () =>
          reject(new Error('timeout')),
        );
      });
    await expect(
      new NpmClient({ fetch: fetcher, timeoutMs: 5 }).get('/example/latest'),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });
  it('handles upstream rate limits and oversized responses', async () => {
    await expect(
      new NpmClient({
        fetch: async () => new Response(null, { status: 429 }),
      }).get('/x'),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    await expect(
      new NpmClient({
        fetch: async () => new Response('a'.repeat(100)),
        maxResponseBytes: 10,
      }).get('/x'),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
  });
});
const stats = {
  publisher: 'alice',
  totalPackages: 17,
  provenancePackages: 12,
  withoutProvenance: 5,
  coverage: 70.59,
  checkedAt: '2026-10-07T00:00:00.000Z',
};
describe('badges and HTTP', () => {
  it.each([
    ['count', '12 packages'],
    ['ratio', '12 / 17'],
    ['percentage', '71%'],
  ] as const)('renders %s badge', (display, value) => {
    expect(renderBadge(stats, display)).toContain(value);
  });
  it.each([
    [100, '#4c1'],
    [99, '#97ca00'],
    [75, '#97ca00'],
    [74, '#dfb317'],
    [50, '#dfb317'],
    [49, '#fe7d37'],
    [1, '#fe7d37'],
    [0, '#e05d44'],
  ] as const)('colors %s coverage', (coverage, color) => {
    expect(automaticColor(coverage)).toBe(color);
  });
  it('escapes SVG text and attribute injection', () => {
    const svg = renderSvg('<script>"&\'', '" onload="evil');
    expect(svg).not.toContain('<script>');
    expect(svg).not.toContain(' onload="evil');
    expect(svg).toContain('&lt;script&gt;&quot;&amp;&apos;');
  });
  it('zero packages has an undefined percentage', () => {
    expect(
      renderBadge(
        { ...stats, totalPackages: 0, provenancePackages: 0, coverage: 0 },
        'percentage',
      ),
    ).toContain('n/a');
  });
  it('serves aggregate JSON and custom colors', async () => {
    const app = createApp({
      service: { getProvenanceStats: async () => stats },
    });
    const json = await app(new Request('http://local/api/provenance/alice'));
    expect(await json.json()).toEqual(stats);
    const svg = await app(new Request('http://local/badge/alice?color=blue'));
    expect(svg.headers.get('content-type')).toContain('image/svg+xml');
    expect(await svg.text()).toContain('#007ec6');
  });
  it.each([
    ['NOT_FOUND', 'user not found', 404],
    ['UNAVAILABLE', 'unavailable', 503],
    ['VERIFICATION_FAILED', 'error', 502],
  ] as const)('returns safe %s SVG and JSON', async (code, value, status) => {
    const app = createApp({
      service: {
        getProvenanceStats: async () => {
          throw new ProvenanceError(code, 'Safe error', status);
        },
      },
    });
    const svg = await app(new Request('http://local/badge/alice'));
    expect(svg.status).toBe(200);
    expect(await svg.text()).toContain(value);
    expect(svg.headers.get('cache-control')).toBe('no-store');
    const api = await app(new Request('http://local/api/provenance/alice'));
    expect(api.status).toBe(status);
    expect(await api.json()).toMatchObject({ error: { code } });
  });
  it('rejects malicious query and publisher input', async () => {
    const app = createApp({
      service: createProvenanceService({ fetch: mockRegistry([]) }),
    });
    for (const path of [
      'alice?color=%22onload=evil',
      'alice?display=foo',
      'alice?color=constructor',
      'alice?type=bad',
      'alice?color=blue&color=red',
      '%3Cscript%3E',
      'a'.repeat(100),
      '%ZZ',
    ]) {
      const response = await app(
        new Request(`http://local/api/provenance/${path}`),
      );
      expect(response.status).toBe(400);
    }
  });
  it('rate limits requests and resets the window', async () => {
    let now = 0;
    const app = createApp({
      service: { getProvenanceStats: async () => stats },
      requestsPerMinute: 1,
      now: () => now,
    });
    await app(new Request('http://local/api/provenance/alice'), 'ip');
    expect(
      (await app(new Request('http://local/api/provenance/alice'), 'ip'))
        .status,
    ).toBe(429);
    now = 60001;
    expect(
      (await app(new Request('http://local/api/provenance/alice'), 'ip'))
        .status,
    ).toBe(200);
  });
});

it('supports configured color thresholds and fractional coverage', async () => {
  expect(automaticColor(0.5)).toBe('#fe7d37');
  const app = createApp({
    service: { getProvenanceStats: async () => stats },
    colorThresholds: [{ minimum: 0, color: '#123456' }],
  });
  const response = await app(new Request('http://local/badge/alice'));
  expect(await response.text()).toContain('#123456');
});
