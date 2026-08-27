import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  checkKitDocsCi,
  parseNameStatus,
  selectKitDocsCiMode,
} from './check-kit-docs-ci.mjs';

const roots = [];
const MANIFEST = 'docs-reconciliations/stable-kit-v2.14.0.json';
const RELEASE_NOTES = 'content/docs/stable/reference/release-notes.mdx';

function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function write(root, path, body) {
  const absolute = join(root, path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, body);
}

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'kit-docs-ci-'));
  roots.push(root);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'fixture@example.test']);
  git(root, ['config', 'user.name', 'Fixture']);
  await write(root, MANIFEST, '{}\n');
  await write(root, 'channels.json', '{"stable":{"version":"1.0.0"}}\n');
  await write(root, RELEASE_NOTES, '# Release 1\n');
  await write(root, 'content/docs/stable/guides/example.mdx', '# Stable\n');
  await write(root, 'README.md', '# Fixture\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'fixture']);
  return { root, base: git(root, ['rev-parse', 'HEAD']) };
}

function commitChanges(root, message) {
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', message]);
}

async function route(fixture) {
  const calls = [];
  const result = await checkKitDocsCi({
    root: fixture.root,
    base: fixture.base,
    runValidation: async (selection) => calls.push(selection),
  });
  assert.equal(calls.length, 1);
  return { result, call: calls[0] };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test('NUL name-status parsing preserves rename endpoints and unusual path characters', () => {
  const rows = parseNameStatus(Buffer.from('R100\0old name\0new\nname\0M\0plain path\0'));
  assert.deepEqual(rows, [
    { status: 'R100', oldPath: 'old name', path: 'new\nname' },
    { status: 'M', path: 'plain path' },
  ]);
  assert.throws(() => parseNameStatus(Buffer.from('M\0unterminated')), /not NUL terminated/);
  assert.throws(() => parseNameStatus(Buffer.from('U\0conflicted\0')), /unsupported Git diff status/);
});

test('no Stable diff runs historical evidence validation', async () => {
  const fixture = await makeFixture();
  await write(fixture.root, 'README.md', '# Non-Stable change\n');
  commitChanges(fixture.root, 'non-stable change');
  const { result, call } = await route(fixture);
  assert.equal(result.mode, 'history');
  assert.equal(call.mode, 'history');
});

test('future promotion-shaped Stable diff runs historical validation', async () => {
  const fixture = await makeFixture();
  await write(fixture.root, 'content/docs/stable/guides/example.mdx', '# Future Stable\n');
  await write(fixture.root, 'channels.json', '{"stable":{"version":"2.0.0"}}\n');
  await write(fixture.root, RELEASE_NOTES, '# Release 2\n');
  commitChanges(fixture.root, 'future promotion');
  const { result, call } = await route(fixture);
  assert.equal(result.mode, 'history');
  assert.equal(call.mode, 'history');
});

test('arbitrary Stable edit without manifest and promotion anchors fails', async () => {
  const fixture = await makeFixture();
  await write(fixture.root, 'content/docs/stable/guides/example.mdx', '# Arbitrary edit\n');
  commitChanges(fixture.root, 'arbitrary stable edit');
  let called = false;
  await assert.rejects(() => checkKitDocsCi({
    root: fixture.root,
    base: fixture.base,
    runValidation: async () => { called = true; },
  }), /Stable changed without reconciliation evidence or both promotion anchors/);
  assert.equal(called, false);
});

test('current reconciliation-shaped exact diff runs check-diff with the resolved base', async () => {
  const fixture = await makeFixture();
  await write(fixture.root, 'content/docs/stable/guides/example.mdx', '# Reconciled\n');
  await write(fixture.root, MANIFEST, '{"reconciled":true}\n');
  commitChanges(fixture.root, 'reconcile stable');
  const { result, call } = await route(fixture);
  assert.equal(result.mode, 'diff');
  assert.equal(call.mode, 'diff');
  assert.equal(call.base, fixture.base);
});

test('deleted reconciliation manifest always fails before validation', async () => {
  const fixture = await makeFixture();
  await unlink(join(fixture.root, MANIFEST));
  commitChanges(fixture.root, 'delete reconciliation manifest');
  let called = false;
  await assert.rejects(() => checkKitDocsCi({
    root: fixture.root,
    base: fixture.base,
    runValidation: async () => { called = true; },
  }), /manifest was deleted or renamed away/);
  assert.equal(called, false);
});

test('a Stable rename is a Stable diff and cannot bypass promotion routing', () => {
  assert.throws(() => selectKitDocsCiMode([
    { status: 'R100', oldPath: 'content/docs/stable/guides/old.mdx', path: 'guides/old.mdx' },
  ]), /Stable changed without reconciliation evidence/);
});
