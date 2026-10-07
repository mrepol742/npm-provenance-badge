import { build } from 'esbuild';
import process from 'node:process';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const directory = await mkdtemp(join(tmpdir(), 'provenance-netlify-'));
try {
  const output = join(directory, 'provenance.mjs');
  // Model Netlify's final esbuild pass, with no project node_modules nearby.
  const artifact = await build({
    entryPoints: ['netlify/functions/provenance.mts'],
    outfile: output,
    platform: 'node',
    target: 'node24',
    format: 'esm',
    bundle: true,
    metafile: true,
  });
  const code = String.raw`
    import assert from 'node:assert/strict';
    globalThis.fetch = async () => Response.json({ total: 0, objects: [] });
    const { default: handler, config } = await import(${JSON.stringify(pathToFileURL(output).href)});
    assert.deepEqual(config.path, ['/badge/:publisher', '/api/provenance/:publisher']);
    const svg = await handler(new Request('https://example.test/badge/example?display=ratio'), { ip: '127.0.0.1' });
    assert.equal(svg.status, 200);
    assert.match(svg.headers.get('content-type'), /image\/svg\+xml/);
    assert.ok((await svg.text()).includes('0 / 0'));
    assert.equal(svg.headers.get('Netlify-Vary'), 'query');
    const json = await handler(new Request('https://example.test/api/provenance/example'), { ip: '127.0.0.1' });
    assert.equal((await json.json()).totalPackages, 0);
    console.log('Isolated Netlify function passed with require(esm) disabled');
  `;
  await promisify(execFile)(
    process.execPath,
    ['--no-experimental-require-module', '--input-type=module', '-e', code],
    { cwd: directory, timeout: 15000 },
  );
  const externals = Object.values(artifact.metafile.outputs)
    .flatMap((item) => item.imports)
    .filter((item) => item.external);
  // Required runtime imports must be built-ins. Proxy negotiation has an
  // optional dynamic kerberos native addon, unused by this service.
  const { isBuiltin } = await import('node:module');
  if (
    externals.some(
      (item) =>
        !isBuiltin(item.path) &&
        !(item.kind === 'dynamic-import' && item.path === 'kerberos'),
    )
  )
    throw new Error('Unexpected external npm dependency');
  process.stdout.write(
    'Isolated Netlify function passed with require(esm) disabled\n',
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
