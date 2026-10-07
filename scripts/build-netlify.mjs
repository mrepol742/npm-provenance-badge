import { build } from 'esbuild';

// Inline Sigstore and its mixed CommonJS/ESM dependency graph. In particular,
// @npmcli/agent must not require the ESM-only proxy agents at runtime.
await build({
  entryPoints: ['src/api/app.ts'],
  outfile: '.netlify/bundle/app.mjs',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  banner: {
    js: "import { createRequire as __createNodeRequire } from 'node:module'; const require = __createNodeRequire(import.meta.url);",
  },
  logLevel: 'info',
});
