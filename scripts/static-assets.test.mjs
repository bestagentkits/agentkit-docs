import assert from 'node:assert/strict';
import { mkdtemp, mkdir, open, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { inspectStaticAssets, MEBIBYTE } from './lib/static-assets.mjs';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'ak-docs-assets-'));
  await mkdir(join(directory, 'api'), { recursive: true });
  await writeFile(join(directory, 'api', 'search'), '{}');
  return directory;
}

async function sparseFile(filepath, size) {
  const file = await open(filepath, 'w');
  await file.truncate(size);
  await file.close();
}

test('inspectStaticAssets accepts output within limits', async (t) => {
  const directory = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'index.html'), '<h1>AgentKit</h1>');

  const result = await inspectStaticAssets(directory);

  assert.equal(result.files.length, 2);
  assert.equal(result.searchOverBudget, false);
  assert.equal(result.oversized.length, 0);
  assert.equal(result.tooManyFiles, false);
});

test('inspectStaticAssets reports search budget and Cloudflare limit breaches', async (t) => {
  const directory = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  await sparseFile(join(directory, 'api', 'search'), 23 * MEBIBYTE);
  await sparseFile(join(directory, 'oversized.bin'), 26 * MEBIBYTE);

  const result = await inspectStaticAssets(directory);

  assert.equal(result.searchOverBudget, true);
  assert.deepEqual(result.oversized.map((file) => file.path), ['oversized.bin']);
});

test('inspectStaticAssets uses the configured Paid Workers file limit', async (t) => {
  const directory = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'index.html'), 'AgentKit');

  const result = await inspectStaticAssets(directory, { maxFiles: 1 });

  assert.equal(result.tooManyFiles, true);
});
