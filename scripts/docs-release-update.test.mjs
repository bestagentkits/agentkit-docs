import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  createApprovalArtifact,
  createApprovalRequest,
  validateApprovalBinding,
  validateApprovalRequest,
} from './lib/docs-release-approval.mjs';
import { runCheck } from './check-docs-release-update.mjs';
import { createImpactMap } from './lib/docs-release-impact.mjs';
import { createReleaseLedger } from './lib/docs-release-ledger.mjs';
import { stableJson } from './lib/docs-release-normalize.mjs';
import {
  assertV0WriteScope,
  releaseOutputDir,
  v1WriteViolations,
} from './lib/docs-release-paths.mjs';
import { writeV0Reports } from './lib/docs-release-reports.mjs';
import { validateLedger, validateReleaseSource } from './lib/docs-release-schema.mjs';
import { loadReleaseSource } from './lib/docs-release-source.mjs';

const execFileAsync = promisify(execFile);
const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const fixtures = join(repoRoot, 'fixtures', 'docs-release-update');
let temporary;
let outputRoot;

async function json(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function fixtureSource(group, side) {
  const expected = await json(join(fixtures, group, `${side}.json`));
  return loadReleaseSource(join(fixtures, group, `${side}.json`), {
    channel: expected.channel,
    ref: expected.ref,
  });
}

async function changedEvidence() {
  const from = await fixtureSource('changed', 'from');
  const to = await fixtureSource('changed', 'to');
  const ledger = createReleaseLedger(from, to, 'beta');
  const impactMap = createImpactMap(ledger, { repoRoot });
  return { from, to, ledger, impactMap, request: createApprovalRequest({ ledger, impactMap, target: to.version }) };
}

async function snapshot(path) {
  const entries = await readdir(path, { recursive: true, withFileTypes: true });
  const files = {};
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const full = join(entry.parentPath ?? entry.path, entry.name);
    files[full.slice(path.length)] = await readFile(full, 'utf8');
  }
  return files;
}

beforeEach(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'docs-release-update-'));
  outputRoot = join(temporary, 'plans', 'releases');
  await mkdir(outputRoot, { recursive: true });
});

afterEach(async () => {
  await rm(temporary, { recursive: true, force: true });
});

test('changed sources produce stable IDs and all actionable classifications', async () => {
  const { ledger, impactMap } = await changedEvidence();
  assert.equal(ledger.status, 'changed');
  assert.deepEqual(
    [...new Set(ledger.claims.map((claim) => claim.classification))].sort(),
    ['new', 'no-change', 'remove', 'update'],
  );
  assert.ok(ledger.claims.every((claim) => /^CLM-[0-9A-F]{16}$/.test(claim.id)));
  assert.ok(ledger.claims.filter((claim) => claim.classification !== 'no-change').every((claim) => claim.anchors.length));
  assert.ok(impactMap.pages.some((page) => page.classification === 'mirror'));
  assert.ok(impactMap.pages.some((page) => page.classification === 'new'));
  assert.ok(impactMap.pages.some((page) => page.classification === 'remove'));
  assert.ok(impactMap.pages.some((page) => page.classification === 'update'));
});

test('V0 writes only normalized temporary evidence and is byte-equivalent on rerun', async () => {
  const { ledger, impactMap } = await changedEvidence();
  const first = await writeV0Reports({ ledger, impactMap, outputRoot, target: 'v0.42.0-beta.2' });
  const before = await snapshot(first.outputDir);
  await writeV0Reports({ ledger, impactMap, outputRoot, target: 'v0.42.0-beta.2' });
  const after = await snapshot(first.outputDir);
  assert.deepEqual(after, before);
  assert.deepEqual(Object.keys(after).sort(), [
    '/approval-request.json',
    '/delta-from-0.41.0-beta.1.md',
    '/docs-impact-map.json',
    '/docs-impact-map.md',
    '/source-ledger.json',
    '/source-ledger.md',
    '/unresolved-evidence.md',
  ]);
  assert.equal((await json(join(first.outputDir, 'approval-request.json'))).status, 'approval-required');
});

test('no-impact evidence produces an explicit no-op handoff', async () => {
  const from = await fixtureSource('no-impact', 'from');
  const to = await fixtureSource('no-impact', 'to');
  const ledger = createReleaseLedger(from, to, 'beta');
  const map = createImpactMap(ledger, { repoRoot });
  const request = createApprovalRequest({ ledger, impactMap: map, target: to.version });
  assert.equal(ledger.status, 'no-op');
  assert.equal(map.status, 'no-op');
  assert.equal(request.status, 'no-op');
  assert.deepEqual(request.paths, []);
});

test('partial evidence blocks only its claim and leaves unrelated pages actionable', async () => {
  const from = await fixtureSource('partial', 'from');
  const to = await fixtureSource('partial', 'to');
  const ledger = createReleaseLedger(from, to, 'beta');
  const map = createImpactMap(ledger, { repoRoot });
  assert.equal(ledger.status, 'changed');
  const safetyClaim = ledger.claims.find((claim) => claim.entityId === 'shell');
  assert.equal(safetyClaim.classification, 'blocked');
  assert.ok(safetyClaim.blockedReasons.some((reason) => reason.includes('test evidence missing')));
  assert.equal(ledger.claims.find((claim) => claim.entityId === 'planner').classification, 'update');
  assert.equal(map.pages.find((page) => page.path?.includes('guides/updating')).classification, 'blocked');
  assert.equal(map.pages.find((page) => page.path?.includes('agents/index')).classification, 'update');
});

test('alias collisions block both identities instead of guessing', async () => {
  const from = await fixtureSource('alias-collision', 'from');
  const to = await fixtureSource('alias-collision', 'to');
  const ledger = createReleaseLedger(from, to, 'beta');
  assert.equal(ledger.status, 'blocked');
  assert.equal(ledger.claims.length, 2);
  assert.ok(ledger.claims.every((claim) => claim.classification === 'blocked'));
  assert.ok(ledger.claims.every((claim) => claim.blockedReasons.includes('alias resolves to multiple entities')));
});

test('immutable refs and bundle provenance mismatches fail closed', async () => {
  const source = await fixtureSource('changed', 'from');
  assert.throws(() => validateReleaseSource({ ...source, ref: 'dev' }, { channel: 'beta' }), /floating ref/);
  await assert.rejects(
    () => loadReleaseSource(join(fixtures, 'conflicting-bundle'), { channel: 'beta', ref: 'v0.42.0-beta.9' }),
    /provenance mismatch/,
  );
  await assert.rejects(
    () => loadReleaseSource(join(fixtures, 'conflicting-bundle'), { channel: 'stable', ref: 'v0.42.0-beta.8' }),
    /channel mismatch/,
  );
});

test('tar.gz bundles are read without extraction and preserve normalized provenance', async () => {
  const bundleDir = join(fixtures, 'malicious-bundle');
  const tarPath = join(temporary, 'docs-bundle.tar.gz');
  await execFileAsync('tar', [
    '--format', 'ustar', '-czf', tarPath, '-C', bundleDir,
    'manifest.json', 'release-notes.md', 'reference',
  ]);
  const expected = { channel: 'beta', ref: 'v0.42.0-beta.9' };
  const directory = await loadReleaseSource(bundleDir, expected);
  const archive = await loadReleaseSource(tarPath, expected);
  assert.equal(archive.provenance.digest, directory.provenance.digest);
  assert.equal(archive.provenance.manifestDigest, directory.provenance.manifestDigest);
  assert.deepEqual(archive.items, directory.items);
});

test('release text remains inert data and is not copied into reports', async () => {
  const source = await loadReleaseSource(join(fixtures, 'malicious-bundle'), {
    channel: 'beta',
    ref: 'v0.42.0-beta.9',
  });
  const ledger = createReleaseLedger(source, source, 'beta');
  const map = createImpactMap(ledger, { repoRoot });
  const result = await writeV0Reports({ ledger, impactMap: map, outputRoot, target: source.version });
  const files = await snapshot(result.outputDir);
  assert.ok(!Object.values(files).some((contents) => contents.includes('touch SHOULD_NOT_EXIST')));
  assert.ok(!Object.values(files).some((contents) => contents.includes('curl example.invalid')));
});

test('approval binds refs, evidence digests, claims, paths, identity, window, and nonce', async () => {
  const { request } = await changedEvidence();
  const approval = createApprovalArtifact(request, {
    approver: 'docs-owner@example.test',
    issueOrPr: 'issue:#18',
    issuedAt: '2026-08-03T10:00:00.000Z',
    expiresAt: '2026-08-04T10:00:00.000Z',
    nonce: 'release-approval-0001',
  });
  assert.equal(validateApprovalBinding(request, approval, { now: '2026-08-03T12:00:00.000Z' }), approval);
  assert.ok(request.source.to.provenanceDigest);
  assert.ok(request.claimIds.length > 0);
  assert.ok(request.paths.length > 0);
});

test('forged, stale, replayed, and path-expanded approvals are rejected', async () => {
  const { request } = await changedEvidence();
  const base = createApprovalArtifact(request, {
    approver: 'docs-owner@example.test',
    issueOrPr: 'pr:#123',
    issuedAt: '2026-08-03T10:00:00.000Z',
    expiresAt: '2026-08-04T10:00:00.000Z',
    nonce: 'release-approval-0002',
  });
  const forgedMutation = await json(join(fixtures, 'approval-mutations', 'forged.json'));
  assert.throws(() => validateApprovalBinding(request, { ...base, ...forgedMutation }, { now: '2026-08-03T12:00:00.000Z' }), /ledgerDigest/);
  const staleMutation = await json(join(fixtures, 'approval-mutations', 'stale.json'));
  assert.throws(() => validateApprovalBinding(request, { ...base, ...staleMutation }, { now: '2026-08-03T12:00:00.000Z' }), /stale/);
  assert.throws(() => validateApprovalBinding(request, base, { now: '2026-08-03T12:00:00.000Z', usedNonces: new Set([base.nonce]) }), /replay/);
  const expansion = await json(join(fixtures, 'approval-mutations', 'path-expanded.json'));
  assert.throws(() => validateApprovalBinding(request, { ...base, paths: [...base.paths, expansion.extraPath] }, { now: '2026-08-03T12:00:00.000Z' }), /paths/);
  assert.throws(() => validateApprovalRequest({ ...request, paths: [...request.paths, expansion.extraPath] }), /sorted and unique|forged or stale/);
});

test('V0 and V1 write-scope guards reject traversal, public, Stable, generated, reference, workflow, add, and expansion paths', async () => {
  const v0Allowed = await json(join(fixtures, 'changes', 'v0-allowed.json'));
  const v0Public = await json(join(fixtures, 'changes', 'v0-public-write.json'));
  assert.deepEqual(assertV0WriteScope(v0Allowed, 'plans/releases/v0.42.0-beta.2'), []);
  assert.equal(assertV0WriteScope(v0Public, 'plans/releases/v0.42.0-beta.2').length, 1);
  assert.throws(() => releaseOutputDir(outputRoot, '../content'), /unsafe release target/);
  const { request } = await changedEvidence();
  const valid = request.paths.map((path) => ({ status: 'M', path }));
  assert.deepEqual(v1WriteViolations(valid, request.paths), []);
  const forbidden = await json(join(fixtures, 'changes', 'v1-forbidden.json'));
  assert.equal(v1WriteViolations(forbidden, request.paths).length, forbidden.length);
  assert.equal(v1WriteViolations([{ status: 'M', path: 'content/docs/beta/getting-started/quickstart.en.mdx' }], request.paths).length, 1);
  assert.equal(v1WriteViolations([{ status: 'M', path: 'content/docs/beta/guides/../guides/updating.en.mdx' }], request.paths).length, 1);
});

test('V0 rejects a symlinked release target', async () => {
  const outside = join(temporary, 'outside');
  await mkdir(outside);
  await symlink(outside, join(outputRoot, 'v0.42.0-beta.2'));
  const { ledger, impactMap } = await changedEvidence();
  await assert.rejects(
    () => writeV0Reports({ ledger, impactMap, outputRoot, target: 'v0.42.0-beta.2' }),
    /symlink output path rejected/,
  );
});

test('schemas reject duplicate claims and unsupported versions', async () => {
  const { ledger, impactMap } = await changedEvidence();
  assert.throws(() => validateLedger({ ...ledger, schemaVersion: 'ak.docs.release-ledger/v2' }), /unsupported/);
  assert.throws(() => validateLedger({ ...ledger, claims: [ledger.claims[0], ledger.claims[0]] }), /duplicate/);
  assert.throws(
    () => createApprovalRequest({ ledger, impactMap: { ...impactMap, ledgerDigest: 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' }, target: 'v0.42.0-beta.2' }),
    /not bound/,
  );
});

test('orchestrator CLI emits deterministic V0 and validates an approved V1 batch', async () => {
  const fromPath = join(fixtures, 'changed', 'from.json');
  const toPath = join(fixtures, 'changed', 'to.json');
  const args = {
    '--mode': 'v0',
    '--from-ref': 'v0.41.0-beta.1',
    '--to-ref': 'v0.42.0-beta.2',
    '--from-source': fromPath,
    '--to-source': toPath,
    '--channel': 'beta',
    '--repo-root': repoRoot,
    '--output-root': outputRoot,
    '--target': 'v0.42.0-beta.2',
  };
  const v0 = await runCheck(args);
  assert.equal(v0.status, 'approval-required');
  const requestPath = join(v0.outputDir, 'approval-request.json');
  const request = await json(requestPath);
  const approval = createApprovalArtifact(request, {
    approver: 'docs-owner@example.test',
    issueOrPr: 'issue:#18',
    issuedAt: '2026-08-03T10:00:00.000Z',
    expiresAt: '2026-08-04T10:00:00.000Z',
    nonce: 'release-approval-0003',
  });
  const approvalPath = join(temporary, 'approval.json');
  const changesPath = join(temporary, 'changes.json');
  await writeFile(approvalPath, stableJson(approval));
  await writeFile(changesPath, stableJson(request.paths.map((path) => ({ status: 'M', path }))));
  const v1 = await runCheck({
    '--mode': 'v1',
    '--request': requestPath,
    '--approval': approvalPath,
    '--changes': changesPath,
    '--now': '2026-08-03T12:00:00.000Z',
  });
  assert.equal(v1.status, 'approved');
  assert.equal(v1.requestDigest, request.requestDigest);
});

test('public CLI works without importing project code through a build step', async () => {
  const target = 'v0.42.0-beta.3';
  const { stdout } = await execFileAsync(process.execPath, [
    join(repoRoot, 'scripts', 'docs-release-diff.mjs'),
    '--from-ref', 'v0.42.0-beta.2',
    '--to-ref', 'v0.42.0-beta.3',
    '--from-source', join(fixtures, 'no-impact', 'from.json'),
    '--to-source', join(fixtures, 'no-impact', 'to.json'),
    '--channel', 'beta',
    '--output-root', outputRoot,
    '--target', target,
  ]);
  const result = JSON.parse(stdout);
  assert.equal(result.status, 'no-op');
  assert.ok(result.files.includes('source-ledger.json'));
});
