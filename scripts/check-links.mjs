#!/usr/bin/env node
// Internal link checker for the static export. Walks out/**/*.html, extracts
// internal links, and verifies each resolves to a generated file. External links
// (http/https/mailto) are intentionally skipped so CI never flakes on a
// third-party host being slow or down.
//
//   node scripts/check-links.mjs [--out out]
import { parseArgs } from 'node:util';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { repoRoot } from './lib/paths.mjs';

const SKIP = /^(https?:|mailto:|tel:|data:|#|\/\/)/;

async function htmlFiles(outDir) {
  const entries = await readdir(outDir, { withFileTypes: true, recursive: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.html'))
    .map((e) => join(e.parentPath ?? e.path, e.name));
}

function extractHrefs(html) {
  const hrefs = new Set();
  for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    hrefs.add(m[1].replace(/&amp;/g, '&'));
  }
  return [...hrefs];
}

// hideLocale: default-locale — prefixless en paths map to the /en/… static tree.
const EN_INTERNAL_PREFIX = '/en';
const RESERVED_PREFIXES = ['/vi', '/en', '/api', '/_next', '/icon.svg', '/og', '/llms'];

function internalCandidates(sitePath) {
  const clean = sitePath.split('#')[0].split('?')[0];
  const candidates = [clean];
  if (
    clean !== '/' &&
    !RESERVED_PREFIXES.some((p) => clean === p || clean.startsWith(`${p}/`))
  ) {
    candidates.push(`${EN_INTERNAL_PREFIX}${clean}`);
  }
  if (clean === '/') {
    candidates.push(`${EN_INTERNAL_PREFIX}.html`, `${EN_INTERNAL_PREFIX}/`);
  }
  return candidates;
}

// A site path resolves if any of these exist: the literal file (assets), or
// path.html / path/index.html (Next static export emits page.html for /page).
// Trying all three — rather than branching on a file extension — avoids
// misclassifying a route segment that merely contains a dot (e.g. /docs/v1.2.3).
function resolves(outDir, sitePath) {
  for (const candidate of internalCandidates(sitePath)) {
    if (candidate === '' || candidate === '/') {
      if (existsSync(join(outDir, 'index.html'))) return true;
      continue;
    }
    const base = join(outDir, candidate);
    if (
      existsSync(base) ||
      existsSync(`${base}.html`) ||
      existsSync(join(base, 'index.html'))
    ) {
      return true;
    }
  }
  return false;
}

async function main() {
  const { values } = parseArgs({ options: { out: { type: 'string', default: 'out' } } });
  const outDir = resolve(repoRoot, values.out);
  if (!existsSync(outDir)) {
    throw new Error(`build output not found at ${outDir} — run \`pnpm build\` first`);
  }

  const files = await htmlFiles(outDir);
  const broken = [];
  let checked = 0;
  for (const file of files) {
    const html = await readFile(file, 'utf8');
    for (const href of extractHrefs(html)) {
      if (SKIP.test(href) || !href.startsWith('/')) continue;
      checked++;
      if (!resolves(outDir, href)) {
        broken.push({ file: file.slice(outDir.length + 1), href });
      }
    }
  }

  if (broken.length) {
    console.error(`check-links: ${broken.length} broken internal link(s):`);
    for (const b of broken) console.error(`  ✗ ${b.href}  (in ${b.file})`);
    process.exit(1);
  }
  console.error(`check-links: ${checked} internal links across ${files.length} pages OK.`);
}

main().catch((err) => {
  console.error(`check-links failed: ${err.message}`);
  process.exit(1);
});
