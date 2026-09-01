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
const RECEIPT = 'docs-promotions/v2.0.0.json';
const EVIDENCE_MANIFEST = 'release-evidence/stable-promotions/v2.0.0/manifest.json';
const EVIDENCE_NOTES = 'release-evidence/stable-promotions/v2.0.0/release-notes.md';
const EXCEPTION = 'stable-docs-exceptions/example-guide.json';

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

test('future promotion-shaped Stable diff routes its exact receipt to promotion validation', async () => {
  const fixture = await makeFixture();
  await write(fixture.root, 'content/docs/stable/guides/example.mdx', '# Future Stable\n');
  await write(fixture.root, 'channels.json', '{"stable":{"version":"2.0.0"}}\n');
  await write(fixture.root, RELEASE_NOTES, '# Release 2\n');
  await write(fixture.root, RECEIPT, '{"promotion":true}\n');
  await write(fixture.root, EVIDENCE_MANIFEST, '{"stableEvidence":true}\n');
  await write(fixture.root, EVIDENCE_NOTES, '# Reviewed stable source\n');
  commitChanges(fixture.root, 'future promotion');
  const { result, call } = await route(fixture);
  assert.equal(result.mode, 'promotion');
  assert.equal(call.mode, 'promotion');
  assert.equal(call.receiptPath, RECEIPT);
});

test('Stable authored docs diff routes its exact exception receipt to exception validation', async () => {
  const fixture = await makeFixture();
  await write(fixture.root, 'content/docs/stable/guides/example.mdx', '# Stable exception\n');
  await write(fixture.root, EXCEPTION, '{"exception":true}\n');
  commitChanges(fixture.root, 'stable docs exception');
  const { result, call } = await route(fixture);
  assert.equal(result.mode, 'exception');
  assert.equal(call.mode, 'exception');
  assert.equal(call.receiptPath, EXCEPTION);
});

test('arbitrary Stable edit without reconciliation or receipt fails', async () => {
  const fixture = await makeFixture();
  await write(fixture.root, 'content/docs/stable/guides/example.mdx', '# Arbitrary edit\n');
  commitChanges(fixture.root, 'arbitrary stable edit');
  let called = false;
  await assert.rejects(() => checkKitDocsCi({
    root: fixture.root,
    base: fixture.base,
    runValidation: async () => { called = true; },
  }), /without reconciliation evidence, a docs exception receipt/);
  assert.equal(called, false);
});

test('arbitrary Stable edit plus channels and release notes still fails without a receipt', async () => {
  const fixture = await makeFixture();
  await write(fixture.root, 'content/docs/stable/guides/example.mdx', '# Arbitrary edit\n');
  await write(fixture.root, 'channels.json', '{"stable":{"version":"2.0.0"}}\n');
  await write(fixture.root, RELEASE_NOTES, '# Arbitrary notes\n');
  commitChanges(fixture.root, 'arbitrary anchors');
  await assert.rejects(
    () => checkKitDocsCi({ root: fixture.root, base: fixture.base, runValidation: async () => {} }),
    /without reconciliation evidence, a docs exception receipt/,
  );
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

test('receipt change without Stable diff fails instead of using history validation', async () => {
  const fixture = await makeFixture();
  await write(fixture.root, RECEIPT, '{"orphanPromotion":true}\n');
  commitChanges(fixture.root, 'orphan receipt');
  await assert.rejects(
    () => checkKitDocsCi({ root: fixture.root, base: fixture.base, runValidation: async () => {} }),
    /Stable transaction receipt\/evidence changed without a Stable diff/,
  );
});

test('Stable docs exception receipts accept only one add-only normalized JSON path', () => {
  for (const row of [
    { status: 'M', path: EXCEPTION },
    { status: 'D', path: EXCEPTION },
    { status: 'R100', oldPath: EXCEPTION, path: 'stable-docs-exceptions/renamed.json' },
    { status: 'A', path: 'stable-docs-exceptions/NON_NORMAL.json' },
  ]) {
    assert.throws(() => selectKitDocsCiMode([row]), /exception receipts are add-only/);
  }
  assert.throws(() => selectKitDocsCiMode([
    { status: 'M', path: 'content/docs/stable/guides/example.mdx' },
    { status: 'A', path: EXCEPTION },
    { status: 'A', path: 'stable-docs-exceptions/other.json' },
  ]), /exactly one add-only receipt/);
});

test('promotion receipts accept only base-relative Git status A', () => {
  for (const row of [
    { status: 'M', path: RECEIPT },
    { status: 'D', path: RECEIPT },
    { status: 'R100', oldPath: RECEIPT, path: 'docs-promotions/v2.0.1.json' },
    { status: 'C100', oldPath: 'fixture.json', path: RECEIPT },
  ]) {
    assert.throws(() => selectKitDocsCiMode([row]), /add-only and require Git status A/);
  }
});

test('reconciliation route rejects a simultaneous promotion receipt', () => {
  assert.throws(() => selectKitDocsCiMode([
    { status: 'M', path: 'content/docs/stable/guides/example.mdx' },
    { status: 'M', path: MANIFEST },
    { status: 'A', path: RECEIPT },
  ]), /reconciliation and another Stable transaction cannot share/);
});

test('Stable docs exception rejects promotion and reconciliation transactions', () => {
  assert.throws(() => selectKitDocsCiMode([
    { status: 'M', path: 'content/docs/stable/guides/example.mdx' },
    { status: 'A', path: EXCEPTION },
    { status: 'A', path: RECEIPT },
  ]), /exception and promotion transaction changes cannot share/);
  assert.throws(() => selectKitDocsCiMode([
    { status: 'M', path: 'content/docs/stable/guides/example.mdx' },
    { status: 'A', path: EXCEPTION },
    { status: 'M', path: MANIFEST },
  ]), /reconciliation and another Stable transaction cannot share/);
});

test('copying from Stable to an unrelated destination is not a Stable diff', () => {
  const route = selectKitDocsCiMode([
    { status: 'C100', oldPath: 'content/docs/stable/guides/example.mdx', path: 'copied-example.mdx' },
  ]);
  assert.equal(route.mode, 'history');
});

test('a Stable rename is a Stable diff and cannot bypass promotion routing', () => {
  assert.throws(() => selectKitDocsCiMode([
    { status: 'R100', oldPath: 'content/docs/stable/guides/old.mdx', path: 'guides/old.mdx' },
  ]), /Stable changed without reconciliation evidence/);
});
