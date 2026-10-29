import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, 'sync-release.mjs');
const bundle = join(here, '..', 'fixtures', 'docs-bundle-beta');
const FROM_TAG = 'v0.42.0-beta.6';
const TO_TAG = 'v0.42.0-beta.7';
const sha = (c) => c.repeat(64);
const ASSETS = [
  { name: 'ak-gui_0.42.0-beta.7_darwin_amd64.zip', size: 10, sha256: sha('a') },
  { name: 'ak-gui_0.42.0-beta.7_darwin_arm64.zip', size: 11, sha256: sha('b') },
  { name: 'ak-gui_0.42.0-beta.7_linux_amd64.AppImage', size: 12, sha256: sha('c') },
  { name: 'ak-gui_0.42.0-beta.7_windows_amd64.zip', size: 13, sha256: sha('d') },
];

let repoRoot;

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'sync-release-'));
  await mkdir(join(repoRoot, 'content', 'docs', 'beta', 'desktop-app'), { recursive: true });
  await writeFile(join(repoRoot, 'channels.json'), JSON.stringify({ beta: { tag: FROM_TAG, version: FROM_TAG.slice(1) } }) + '\n');
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

function sync(desktopAssets) {
  return spawnSync(
    process.execPath,
    [script, '--bundle', bundle, '--repoRoot', repoRoot, '--desktopAssets', desktopAssets],
    { encoding: 'utf8' },
  );
}

async function betaTag() {
  return JSON.parse(await readFile(join(repoRoot, 'channels.json'), 'utf8')).beta.tag;
}

test('a failed Desktop metadata load leaves channels.json on the previous tag, so a retry records the evidence', async () => {
  const failed = sync(join(repoRoot, 'missing-assets.json'));
  assert.equal(failed.status, 1, failed.stderr);
  assert.equal(await betaTag(), FROM_TAG);

  const assetsPath = join(repoRoot, 'assets.json');
  await writeFile(assetsPath, JSON.stringify(ASSETS));
  const retried = sync(assetsPath);
  assert.equal(retried.status, 0, retried.stderr);
  assert.equal(await betaTag(), TO_TAG);
  const evidence = JSON.parse(await readFile(join(repoRoot, 'release-evidence', 'desktop', `${TO_TAG}.json`), 'utf8'));
  assert.deepEqual(evidence, { schemaVersion: 1, tag: TO_TAG, fromTag: FROM_TAG, assets: ASSETS });
});

test('Desktop assets for another version are rejected before channels.json changes', async () => {
  const assetsPath = join(repoRoot, 'assets.json');
  await writeFile(assetsPath, JSON.stringify(ASSETS.map((a) => ({ ...a, name: a.name.replace('beta.7', 'beta.6') }))));
  const res = sync(assetsPath);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /version\/size mismatch/);
  assert.equal(await betaTag(), FROM_TAG);
});
