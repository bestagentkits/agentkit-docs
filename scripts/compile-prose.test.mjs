import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  compileProseFromJson,
  exportMissingProseJson,
  parseProseMarkdown,
  renderProseMarkdown,
  validateProseOverlay,
} from './lib/prose-json.mjs';

let repoRoot;

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'prose-json-'));
  await mkdir(join(repoRoot, 'reference-prose-json'), { recursive: true });
  await mkdir(join(repoRoot, 'reference-prose'), { recursive: true });
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

test('renderProseMarkdown matches the overlay contract', () => {
  const md = renderProseMarkdown({
    overview: 'Run health checks.',
    whenToUse: 'After install.',
    notes: 'Read-only by default.',
  });
  assert.match(md, /^Run health checks\.\n\n\*\*When to use it:\*\* After install\./);
  assert.match(md, /Read-only by default\.\n$/);
});

test('validateProseOverlay rejects generated-section leaks', () => {
  const errors = validateProseOverlay({
    overview: '### Flags\n-h, --help',
    whenToUse: 'Always.',
  });
  assert.ok(errors.some((e) => e.includes('### headings')));
});

test('validateProseOverlay rejects embedded When to use it label', () => {
  const errors = validateProseOverlay({
    overview: 'Ok.',
    whenToUse: '**When to use it:** never paste the label',
  });
  assert.ok(errors.some((e) => e.includes('must not include')));
});

test('parseProseMarkdown round-trips render output', () => {
  const overlay = {
    overview: '`ak doctor` checks your install.',
    whenToUse: 'After upgrade.',
    notes: 'Use `--json` in CI.',
  };
  assert.deepEqual(parseProseMarkdown(renderProseMarkdown(overlay)), overlay);
});

test('compileProseFromJson writes markdown from JSON', async () => {
  await writeFile(
    join(repoRoot, 'reference-prose-json', 'ak_demo.json'),
    JSON.stringify({ overview: 'Demo overview.', whenToUse: 'When demoing.' }) + '\n',
  );

  const { written, errors } = await compileProseFromJson({ repoRoot });
  assert.equal(errors.length, 0);
  assert.equal(written, 1);

  const md = await readFile(join(repoRoot, 'reference-prose', 'ak_demo.md'), 'utf8');
  assert.match(md, /Demo overview\./);
  assert.match(md, /\*\*When to use it:\*\* When demoing\./);
});

test('compileProseFromJson --check fails on stale markdown', async () => {
  await writeFile(
    join(repoRoot, 'reference-prose-json', 'ak_demo.json'),
    JSON.stringify({ overview: 'Fresh.', whenToUse: 'Now.' }) + '\n',
  );
  await writeFile(join(repoRoot, 'reference-prose', 'ak_demo.md'), 'stale\n');

  const { errors } = await compileProseFromJson({ repoRoot, check: true });
  assert.ok(errors.some((e) => e.includes('stale')));
});

test('exportMissingProseJson bootstraps JSON from markdown', async () => {
  await writeFile(
    join(repoRoot, 'reference-prose', 'ak_demo.md'),
    renderProseMarkdown({ overview: 'From md.', whenToUse: 'Legacy path.' }),
  );

  const n = await exportMissingProseJson({ repoRoot });
  assert.equal(n, 1);

  const json = JSON.parse(await readFile(join(repoRoot, 'reference-prose-json', 'ak_demo.json'), 'utf8'));
  assert.equal(json.overview, 'From md.');
  assert.equal(json.whenToUse, 'Legacy path.');
});
