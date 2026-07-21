#!/usr/bin/env node
// Fail-closed guard: the generated public CLI reference must not carry
// internal-only references (ADR numbers, private source-repo URLs, private
// repo-relative docs paths). Fixing these belongs upstream in the CLI's help
// text; failing here keeps a stale/leaky projection from shipping.
//
//   node scripts/check-reference-hygiene.mjs
import { readdir, readFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { docsDir } from './lib/paths.mjs';
import { findReferenceLeaks } from './lib/reference-hygiene.mjs';

async function referencePages(root) {
  const out = [];
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true, recursive: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const dir = e.parentPath ?? e.path;
    // Only the generated reference tree (…/reference/…), Markdown pages.
    if (e.isFile() && e.name.endsWith('.mdx') && dir.split(sep).includes('reference')) {
      out.push(join(dir, e.name));
    }
  }
  return out;
}

const files = await referencePages(docsDir);
const findings = [];
for (const file of files) {
  const leaks = findReferenceLeaks(await readFile(file, 'utf8'));
  for (const leak of leaks) findings.push({ file: file.slice(docsDir.length + 1), leak });
}

if (findings.length) {
  console.error(`check-reference-hygiene: ${findings.length} internal reference(s) leaked into the public reference:`);
  for (const f of findings) console.error(`  ✗ ${f.file}: ${f.leak}`);
  console.error('Fix upstream in the CLI help text (or add a tracked allowlist entry), then regenerate.');
  process.exit(1);
}
console.error(`check-reference-hygiene: ${files.length} reference pages clean.`);
