import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { chmod, mkdir, mkdtemp, readFile, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  checkStablePromotion,
  inventoryDigest,
  promotionReceiptDigest,
} from './lib/stable-promotion.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..');
const promoteCli = join(here, 'promote-docs.mjs');
const stableBundle = join(projectRoot, 'fixtures', 'docs-bundle-stable');
const roots = [];
const RECEIPT = 'docs-promotions/v0.42.0.json';

function git(root, args, { allowFailure = false } = {}) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  if (!allowFailure) assert.equal(result.status, 0, result.stderr);
  return result;
}

async function write(root, path, body) {
  const absolute = join(root, path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, body);
}

function commit(root, message) {
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', message]);
  return git(root, ['rev-parse', 'HEAD']).stdout.trim();
}

async function makePromotedFixture() {
  const root = await mkdtemp(join(tmpdir(), 'stable-promotion-check-'));
  roots.push(root);
  git(root, ['init', '-q', '-b', 'dev']);
  git(root, ['config', 'user.email', 'fixture@example.test']);
  git(root, ['config', 'user.name', 'Fixture']);
  git(root, ['config', 'commit.gpgsign', 'false']);

  await write(root, 'content/docs/beta/index.mdx', '---\ntitle: Beta\n---\nBeta body.\n');
  await write(root, 'content/docs/beta/guides/example.mdx', '---\ntitle: Guide\n---\nGuide body.\n');
  await write(
    root,
    'content/docs/beta/reference/release-notes.mdx',
    '---\ntitle: Release notes\ndescription: Release notes for the beta channel (v0.42.0-beta.7).\ngenerated: true\n---\nBeta notes.\n',
  );
  await write(root, 'content/docs/stable/index.mdx', '---\ntitle: Old Stable\n---\nOld body.\n');
  await write(root, 'content/docs/stable/stale.mdx', 'stale\n');
  await write(
    root,
    'channels.json',
    `${JSON.stringify({
      stable: { version: '0.41.0', tag: 'v0.41.0', sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', syncedAt: '2026-07-01T00:00:00Z' },
      beta: { version: '0.42.0-beta.7', tag: 'v0.42.0-beta.7', sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', syncedAt: '2026-07-20T00:00:00Z' },
    }, null, 2)}\n`,
  );
  const base = commit(root, 'fixture base');
  git(root, ['tag', 'docs/v0.42.0-beta.7', base]);
  await write(root, 'README.md', '# Docs fixture\n');
  const receiptBase = commit(root, 'non-Stable work before promotion');

  const promoted = spawnSync(process.execPath, [
    promoteCli,
    '--bundle', stableBundle,
    '--beta-ref', 'refs/tags/docs/v0.42.0-beta.7',
    '--repoRoot', root,
  ], { cwd: projectRoot, encoding: 'utf8' });
  assert.equal(promoted.status, 0, promoted.stderr);
  const summary = JSON.parse(promoted.stdout);
  assert.equal(summary.receipt, RECEIPT);
  const promotionCommit = commit(root, 'promote stable');
  return { root, base, receiptBase, promotionCommit };
}

async function mutateReceipt(root, mutate, { recompute = true } = {}) {
  const path = join(root, RECEIPT);
  const receipt = JSON.parse(await readFile(path, 'utf8'));
  mutate(receipt);
  if (recompute) receipt.receiptDigest = promotionReceiptDigest(receipt);
  await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test('valid whole-copy promotion receipt validates exact historical input and committed output', async () => {
  const fixture = await makePromotedFixture();
  const result = await checkStablePromotion({ root: fixture.root, base: fixture.base });
  assert.equal(result.receiptPath, RECEIPT);
  assert.equal(result.receipt.betaRef, 'refs/tags/docs/v0.42.0-beta.7');
  assert.equal(result.receipt.baseDocsCommit, fixture.receiptBase);
  assert.notEqual(result.receipt.baseDocsCommit, fixture.base, 'CI base may predate the promotion base');
  assert.ok(result.stablePaths > 0);
  assert.ok(result.changedStablePaths > 0);
});

test('extra Stable file fails exact postimage validation', async () => {
  const fixture = await makePromotedFixture();
  await write(fixture.root, 'content/docs/stable/extra.mdx', 'extra\n');
  commit(fixture.root, 'add extra stable file');
  await assert.rejects(
    () => checkStablePromotion({ root: fixture.root, base: fixture.base }),
    /current Stable tree does not equal the receipt postimage inventory/,
  );
});

test('missing Stable file fails exact postimage validation', async () => {
  const fixture = await makePromotedFixture();
  await unlink(join(fixture.root, 'content/docs/stable/guides/example.mdx'));
  commit(fixture.root, 'remove stable file');
  await assert.rejects(
    () => checkStablePromotion({ root: fixture.root, base: fixture.base }),
    /current Stable tree does not equal the receipt postimage inventory/,
  );
});

test('altered Stable bytes fail exact postimage validation', async () => {
  const fixture = await makePromotedFixture();
  await write(fixture.root, 'content/docs/stable/index.mdx', 'altered\n');
  commit(fixture.root, 'alter stable file');
  await assert.rejects(
    () => checkStablePromotion({ root: fixture.root, base: fixture.base }),
    /current Stable tree does not equal the receipt postimage inventory/,
  );
});

test('missing Beta ref fails even when receipt digest is recomputed', async () => {
  const fixture = await makePromotedFixture();
  await mutateReceipt(fixture.root, (receipt) => { receipt.betaRef = 'refs/tags/docs/v0.42.0-beta.7-missing'; });
  commit(fixture.root, 'tamper beta ref');
  await assert.rejects(
    () => checkStablePromotion({ root: fixture.root, base: fixture.base }),
    /receipt verified Beta binding is invalid/,
  );
});

test('wrong promotedFrom proof fails even when receipt digest is recomputed', async () => {
  const fixture = await makePromotedFixture();
  await mutateReceipt(fixture.root, (receipt) => {
    receipt.promotedFrom = 'v0.42.0-beta.9';
    receipt.betaChannelsTagProof = 'v0.42.0-beta.9';
  });
  commit(fixture.root, 'tamper promotedFrom');
  await assert.rejects(
    () => checkStablePromotion({ root: fixture.root, base: fixture.base }),
    /receipt verified Beta binding is invalid/,
  );
});

test('missing receipt fails', async () => {
  const fixture = await makePromotedFixture();
  await unlink(join(fixture.root, RECEIPT));
  commit(fixture.root, 'remove new receipt');
  await assert.rejects(
    () => checkStablePromotion({ root: fixture.root, base: fixture.base }),
    /one added receipt and two added evidence files are required/,
  );
});

test('deleted historical receipt fails', async () => {
  const fixture = await makePromotedFixture();
  await unlink(join(fixture.root, RECEIPT));
  commit(fixture.root, 'delete receipt');
  await assert.rejects(
    () => checkStablePromotion({ root: fixture.root, base: fixture.promotionCommit }),
    /deleted, renamed, copied, or type-changed/,
  );
});

test('renamed historical receipt fails in the standalone checker', async () => {
  const fixture = await makePromotedFixture();
  await rename(join(fixture.root, RECEIPT), join(fixture.root, 'moved-receipt.json'));
  commit(fixture.root, 'rename receipt away');
  await assert.rejects(
    () => checkStablePromotion({ root: fixture.root, base: fixture.promotionCommit }),
    /deleted, renamed, copied, or type-changed/,
  );
});

test('type-changed historical receipt fails in the standalone checker', async (t) => {
  if (process.platform === 'win32') return t.skip('symlink fixture is POSIX-only');
  const fixture = await makePromotedFixture();
  await unlink(join(fixture.root, RECEIPT));
  await symlink('../README.md', join(fixture.root, RECEIPT));
  commit(fixture.root, 'type change receipt');
  await assert.rejects(
    () => checkStablePromotion({ root: fixture.root, base: fixture.promotionCommit }),
    /deleted, renamed, copied, or type-changed/,
  );
});

test('receipt-only follow-up fails even if provenance and digest are resealed', async () => {
  const fixture = await makePromotedFixture();
  await mutateReceipt(fixture.root, (receipt) => { receipt.evidence.manifest.sha256 = 'f'.repeat(64); });
  commit(fixture.root, 'receipt-only follow-up');
  await assert.rejects(
    () => checkStablePromotion({ root: fixture.root, base: fixture.promotionCommit }),
    /add-only and require Git status A/,
  );
});

test('receipt rejects an impossible generatedAt date after resealing', async () => {
  const fixture = await makePromotedFixture();
  await mutateReceipt(fixture.root, (receipt) => { receipt.generatedAt = '2026-02-30T00:00:00Z'; });
  commit(fixture.root, 'invalid generatedAt');
  await assert.rejects(
    () => checkStablePromotion({ root: fixture.root, base: fixture.base }),
    /receipt release identity is invalid/,
  );
});

test('release-note postimage mode must preserve the Beta source mode', async () => {
  const fixture = await makePromotedFixture();
  const notesPath = 'reference/release-notes.mdx';
  await chmod(join(fixture.root, 'content/docs/stable', notesPath), 0o755);
  await mutateReceipt(fixture.root, (receipt) => {
    const row = receipt.stablePostimageInventory.find((item) => item.path === notesPath);
    row.mode = '100755';
    receipt.stablePostimageInventoryDigest = inventoryDigest(receipt.stablePostimageInventory);
  });
  commit(fixture.root, 'tamper release notes mode');
  await assert.rejects(
    () => checkStablePromotion({ root: fixture.root, base: fixture.base }),
    /not the deterministically rederived output/,
  );
});

test('tampered receipt fails its canonical digest', async () => {
  const fixture = await makePromotedFixture();
  await mutateReceipt(fixture.root, (receipt) => { receipt.releaseNotesOutputSha256 = '0'.repeat(64); }, { recompute: false });
  commit(fixture.root, 'tamper receipt');
  await assert.rejects(
    () => checkStablePromotion({ root: fixture.root, base: fixture.base }),
    /receipt canonical digest mismatch/,
  );
});

test('Stable symlink cannot enter the committed postimage', async (t) => {
  if (process.platform === 'win32') return t.skip('symlink fixture is POSIX-only');
  const fixture = await makePromotedFixture();
  const result = git(fixture.root, ['symbolic-ref', '--short', 'HEAD']);
  assert.equal(result.status, 0);
  const linkResult = spawnSync('ln', ['-s', 'index.mdx', join(fixture.root, 'content/docs/stable/link.mdx')]);
  assert.equal(linkResult.status, 0, linkResult.stderr?.toString());
  commit(fixture.root, 'add stable symlink');
  await assert.rejects(
    () => checkStablePromotion({ root: fixture.root, base: fixture.base }),
    /non-regular Git entry is not allowed/,
  );
});
