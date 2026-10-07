# npm-provenance-stats ![https://npm-provenance-badge.netlify.app/badge/mrepol742](https://npm-provenance-badge.netlify.app/badge/mrepol742)

A TypeScript library and dynamic SVG badge service for npm provenance coverage.
It measures adoption; public responses never list individual packages.

```md
![npm provenance](https://npm-provinance-badge.melvinjonesrepol.com/badge/mrepol742)
```

`npm provenance | 12 / 17` means that 12 of the 17 public packages discovered
for this maintainer have cryptographically verified build provenance on their
npm `latest` release. Replace `npm-provinance-badge.melvinjonesrepol.com` with your deployment URL.

## What is measured

[npm provenance](https://docs.npmjs.com/generating-provenance-statements/) is a
signed statement linking an artifact to its source and build. It does not prove
that code is safe. This project uses actual npm attestations and Sigstore
verification, never repository fields, GitHub Actions usage or publisher claims.

Before implementation, we researched npm's current registry and verifier and
inspected live release manifests and attestation bundles. The full detection
algorithm, evidence, sources and policy boundaries are in
[the research document](docs/provenance-research.md).

A release counts only when all of these checks pass:

1. Its fresh version manifest advertises SLSA v1 or v0.2 provenance in
   `dist.attestations.provenance`.
2. The registry attestation endpoint contains a matching certificate-backed
   DSSE provenance bundle.
3. Its signed in-toto subject matches the exact npm package URL and SHA-512
   integrity digest from that manifest.
4. The official `sigstore` library verifies the signature, trusted certificate,
   certificate transparency and signature transparency evidence.

This is **cryptographic verification**, not just metadata detection. Registry
ECDSA signatures and npm publish attestations alone do not count. The service
binds to registry integrity metadata; it does not independently download/hash
package tarballs, verify the separate registry publish attestation, assert an
expected source repository identity or duplicate npm's CI policy checks.

“Latest” means **`dist-tags.latest`**, npm's default installation release. It
can differ from the newest publication, highest semver or a prerelease.
Provenance on an older release does not count if `latest` lacks it. Conversely,
older unsigned releases do not penalize a package whose `latest` has provenance.
Release fetching and checking are separate to support future historical analysis.

```text
coverage = verified packages / discovered packages × 100
withoutProvenance = totalPackages − provenancePackages
```

JSON coverage is rounded to two decimals; the percentage badge rounds to a whole
number. For zero discovered packages, JSON reports coverage `0`, ratio is `0 / 0`
and the percentage badge is `n/a` with a neutral color.

## Discovery and its limits

User mode uses paginated public npm search, `maintainer:USERNAME`. This means
**current maintainer membership**, not every package ever published by that
person, nor necessarily releases published personally by that user. Scope mode
uses `scope:NAME` and exact namespace membership. It includes only public packages
and does not assert that a scope is an npm organization.

npm's public search index can lag or omit packages. No complete, atomic,
anonymous publisher-history API is documented. Results are deduplicated,
membership-checked and paginated; changing totals, duplicate results or
incomplete pages fail the scan. A configurable cap (1,000 packages by default)
rejects oversized scans instead of silently truncating their denominator.

**Empty and nonexistent accounts/scopes cannot reliably be distinguished by
public search.** Both return zero discovered packages. An explicit upstream 404
produces `user not found`; a package disappearing during a scan makes the scan
unavailable. This limitation is deliberate, not a guessed existence heuristic.

## HTTP API

| Endpoint                         | Output                |
| -------------------------------- | --------------------- |
| `GET /badge/:publisher`          | SVG, ratio by default |
| `GET /api/provenance/:publisher` | Aggregate JSON        |

Use `/badge/hallofcodes?type=scope` for a scope. The same `type=scope` works on the
JSON API. `/badge/@hallofcodes` and URL-encoded `%40hallofcodes` are also accepted.
The explicit query format avoids URL path ambiguity.

```md
![npm provenance](https://npm-provinance-badge.melvinjonesrepol.com/badge/mrepol742)
![npm provenance count](https://npm-provinance-badge.melvinjonesrepol.com/badge/mrepol742?display=count)
![npm provenance percentage](https://npm-provinance-badge.melvinjonesrepol.com/badge/mrepol742?display=percentage)
![scope provenance](https://npm-provinance-badge.melvinjonesrepol.com/badge/hallofcodes?type=scope)
![blue provenance](https://npm-provinance-badge.melvinjonesrepol.com/badge/mrepol742?color=blue)
```

| `display`         | Example       |
| ----------------- | ------------- |
| `ratio` (default) | `12 / 17`     |
| `count`           | `12 packages` |
| `percentage`      | `71%`         |

Automatic colors use centralized thresholds in `src/lib/badge/colors.ts`:
100% bright green; 75–99% green; 50–74% yellow; greater than 0% and below 50% orange; 0% red.
Thresholds use the exact package ratio, not the rounded coverage or badge label.
`color=blue` overrides them; other supported names are `brightgreen`, `green`,
`yellow`, `orange`, `red`, `grey`, `gray`, `purple`. Six-digit hex without `#`
is also accepted, for example `color=007ec6`. Custom descending thresholds can be
passed as `createApp({ colorThresholds: [{ minimum: 80, color: '#4c1' },
{ minimum: 0, color: '#e05d44' }] })` or as the fourth `renderBadge` argument.

```json
{
  "publisher": "mrepol742",
  "totalPackages": 17,
  "provenancePackages": 12,
  "withoutProvenance": 5,
  "coverage": 70.59,
  "checkedAt": "2026-10-07T00:00:00.000Z"
}
```

The numbers above are illustrative. No detailed package endpoint is exposed.
`HEAD` is supported. Invalid queries yield JSON HTTP 400. Upstream failures yield
503, explicit not-found errors 404, failed verification 502, and rate limits
429 with `Retry-After`. JSON errors have this shape:

```json
{ "error": { "code": "UNAVAILABLE", "message": "npm temporarily unavailable" } }
```

Badge errors remain valid HTTP 200 SVG with `user not found`, `unavailable` or
`error`, and `Cache-Control: no-store`. Advertised but unverifiable provenance
fails the scan instead of counting as absence. Partial failures never produce
an apparently complete adoption score.

## Library

The package is ready for publication under `npm-provenance-stats`; verify name
availability before a first release. After publication:

```bash
npm install npm-provenance-stats
```

```ts
import { getProvenanceStats } from 'npm-provenance-stats';

const stats = await getProvenanceStats('mrepol742');
console.log(stats);
const scopeStats = await getProvenanceStats('hallofcodes', 'scope');
```

For configuration, create and reuse a service instance:

```ts
import { createProvenanceService } from 'npm-provenance-stats';

const service = createProvenanceService({
  ttlMs: 30 * 60 * 1000,
  concurrency: 5,
  maxPackages: 1000,
  maxActiveScans: 2,
  timeoutMs: 10_000,
});
const stats = await service.getProvenanceStats('mrepol742');
```

`createApp({ service })` returns a framework-independent
`(request: Request, clientId?: string) => Promise<Response>` handler.
`checkedAt` is included in both library and API results.

## Cache and request budgets

The default bounded memory cache stores up to 1,000 aggregate results for 30
minutes. Keys include schema version, publisher type and normalized name.
Concurrent misses for the same publisher share a scan. Results are cloned to
prevent callers mutating cached values. Failed scans are cached for 15 seconds
to reduce repeated upstream failures; they are never cached as success.

At most five package checks run simultaneously **across all scans in one
service instance**. Only two publisher scans may run at once; excess work is
rejected, not queued indefinitely. HTTP requests are rate limited per socket IP
(default 120/minute), with a bounded client table. Successful HTTP responses have
a five-minute public cache lifetime; GitHub's image proxy may cache longer.

Implement the exported async `Cache<ProvenanceStats>` interface to replace memory
storage with Redis, KV or Upstash:

```ts
interface Cache<T> {
  get(key: string): Promise<T | undefined>;
  set(key: string, value: T, ttlMs: number): Promise<void>;
}
```

A distributed adapter must enforce expiry and serialize values correctly.
Memory caches, in-flight deduplication, rate limits and concurrency budgets are
per process. Multi-instance deployments need shared caching and edge rate limits;
this project does not claim distributed locking.

## Development

Requires Node.js `^22.22.2 || ^24.15.0 || >=26.0.0` (Sigstore's runtime range).

```bash
npm ci
npm run dev
npm run lint
npm run typecheck
npm test
npm run build
npm start
```

Tests mock npm responses and the Sigstore verification boundary. They exercise
positive aggregation, verification delegation and fail-closed behavior. They do not depend on live npm or Sigstore services.
CI runs the five requested checks on Node 22, 24 and 26.

## Netlify deployment

The repository includes a Netlify Node Function and `netlify.toml`. Import the
repository into Netlify; its build command is `npm run build:netlify`, its publish
directory is `public`, and its function directory is `netlify/functions`.
Set `AWS_LAMBDA_JS_RUNTIME=nodejs24.x` in Netlify's environment settings and
redeploy. The build uses Node 24. The routes remain `/badge/:publisher` and
`/api/provenance/:publisher`.

The Netlify build first bundles the app, Sigstore, its proxy dependencies and
its JSON trust seeds into `.netlify/bundle/app.mjs`. A Node `createRequire` shim
supports built-in CommonJS imports. Do not externalize `sigstore` in
`netlify.toml`: the unbundled dependency graph currently requires ESM-only proxy
agents from CommonJS. AWS Lambda disables `require(esm)` by default, which causes
`ERR_REQUIRE_ESM` during function startup. This packaging avoids that dependency
on experimental runtime flags; `NODE_OPTIONS=--experimental-require-module` is
not required. See [Lambda's runtime documentation](https://docs.aws.amazon.com/lambda/latest/dg/lambda-nodejs.html).

Run `npm run check:netlify` before deployment. It builds the function into an
isolated temporary directory, starts Node with `require(esm)` disabled, mocks
npm search, and exercises both public routes. It also rejects required external npm
imports in the generated artifact (the optional Kerberos proxy addon is unused). No live upstream is used by this check.

On warm instances, the aggregate memory cache is reused. Successful responses
also use Netlify's durable CDN cache for 30 minutes, with query-aware variation;
errors remain uncached. Sigstore's writable trust cache uses `/tmp`.

Netlify synchronous functions have a 60-second execution limit. Large cold scans
can exceed it. For those publishers, add shared aggregate storage and a
background refresh worker before relying on this deployment for production.
Memory concurrency and rate limits remain per instance. Use Netlify's edge rate
limiting for protection across instances. See
[Netlify function configuration](https://docs.netlify.com/build/functions/configuration/).

## Deployment

Build with `npm ci && npm run build`, then run `npm start` behind an HTTPS reverse
proxy with edge rate limiting. Alternatively build the included container:

```bash
docker build -t npm-provenance-stats .
docker run --rm -p 3000:3000 npm-provenance-stats
```

| Environment variable  | Default            |
| --------------------- | ------------------ |
| `HOST`                | `0.0.0.0`          |
| `PORT`                | `3000`             |
| `CACHE_TTL_MS`        | `1800000`          |
| `CONCURRENCY`         | `5` (max 20)       |
| `MAX_PACKAGES`        | `1000` (max 10000) |
| `MAX_ACTIVE_SCANS`    | `2` (max 20)       |
| `REQUESTS_PER_MINUTE` | `120`              |

Allow outbound HTTPS to npm and Sigstore's public TUF trust distribution. The
Sigstore verifier reuses authenticated trust material for 15 minutes and maintains
its trust metadata cache on disk; provide a
writable home/cache directory. Trust-root outages fail verification closed.
No npm token is needed. HTTPS termination belongs to the deployment proxy.

The native adapter uses socket IPs and ignores forwarded headers. Behind a
proxy, requests share its IP budget; apply client rate limits at the edge or
provide a custom trusted adapter passing an authenticated client ID to the
handler. Never trust arbitrary `X-Forwarded-For` headers.

## Security

Publisher/query lengths and syntax are restricted; scope and user caches are
separate. XML text and attributes are escaped. Registry requests use a fixed
HTTPS origin, reject redirects and accept only an exact release attestation
path. Remote metadata cannot supply arbitrary network destinations. Request
budgets, response size limits, timeouts and bounded caches reduce npm API abuse.
No package scripts execute and no tarballs are installed. Sigstore controls its
own trusted-root endpoints; attestation payloads cannot configure them.

For a security issue, contact repository maintainers privately using the hosting
platform's security reporting feature when available; do not include secrets in
public issues. See [SECURITY.md](SECURITY.md).

## Contributing and publishing

See [CONTRIBUTING.md](CONTRIBUTING.md). Changes to provenance semantics should
include official sources and adversarial tests. MIT licensed.

`publishConfig` requests public access and provenance. No release workflow or
automatic publishing is included. To enable trusted publishing later, configure
this package's npm trusted publisher with the exact repository/workflow/environment
and add a dedicated reviewed release workflow using a current supported Node/npm,
`id-token: write`, and `npm publish`. Follow
[npm's trusted publishing guide](https://docs.npmjs.com/trusted-publishers/).
