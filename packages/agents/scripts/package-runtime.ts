/**
 * Builds the AgentCore Runtime code package (direct code deployment, NODE_22, arm64):
 *   main.js       esbuild CommonJS bundle of src/main.ts (ADOT only instruments CommonJS)
 *   node_modules  ADOT auto-instrumentation (for the `opentelemetry-instrument` entry point prefix), plus
 *                 the Fastify plugins bedrock-agentcore loads via createRequire(), which esbuild can't bundle
 * Usage: tsx scripts/package-runtime.ts <outDir>
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const VENDORED = [
  '@aws/aws-distro-opentelemetry-node-autoinstrumentation@0.13.0',
  '@fastify/sse@0.4.0',
  '@fastify/websocket@11.3.4',
];

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(process.argv[2] ?? join(root, 'dist/runtime'));
mkdirSync(outDir, { recursive: true });

const result = await build({
  entryPoints: [join(root, 'src/main.ts')],
  outfile: join(outDir, 'main.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: 'inline',
  // Resolved at runtime from the vendored node_modules (installed with ADOT) so both share one OTel API.
  external: ['@opentelemetry/api', '@fastify/sse', '@fastify/websocket'],
  logLevel: 'warning',
  // Some ESM dependencies read import.meta.url; give the CommonJS bundle an equivalent.
  define: { 'import.meta.url': 'importMetaUrl' },
  banner: { js: "const importMetaUrl = require('url').pathToFileURL(__filename).href;" },
});
if (result.errors.length) process.exit(1);

// Vendored packages are installed once per version set into a cache, then copied into each package.
const cache = join(root, '.adot-cache', VENDORED.join('+').replace(/[@/]/g, '_'));
if (!existsSync(join(cache, 'node_modules'))) {
  rmSync(cache, { recursive: true, force: true });
  mkdirSync(cache, { recursive: true });
  writeFileSync(join(cache, 'package.json'), JSON.stringify({ private: true }));
  execFileSync(
    'npm',
    ['install', '--omit=dev', '--no-audit', '--no-fund', '--os=linux', '--cpu=arm64', ...VENDORED],
    { cwd: cache, stdio: 'inherit' },
  );
}
rmSync(join(outDir, 'node_modules'), { recursive: true, force: true });
cpSync(join(cache, 'node_modules'), join(outDir, 'node_modules'), { recursive: true });
writeFileSync(join(outDir, 'package.json'), JSON.stringify({ name: 'dinner-weekly-agent', private: true }, null, 2));
console.log(`Runtime package written to ${outDir}`);
