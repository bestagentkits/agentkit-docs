import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  createApprovalRequest,
  validateApprovalBinding,
  validateApprovalRequest,
  validateDurableApprovalRecord,
} from './lib/docs-release-approval.mjs';
import { runCheck } from './check-docs-release-update.mjs';
import { createImpactMap } from './lib/docs-release-impact.mjs';
import { createReleaseLedger } from './lib/docs-release-ledger.mjs';
import { digest, stableJson } from './lib/docs-release-normalize.mjs';
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
const expectedApprovalContext = {
  sourceRepository: 'example/agentkit',
  docsRepository: 'example/agentkit-docs',
  docsBaseSha: '2'.repeat(40),
  targetBranch: 'dev',
};
const approvalNow = '2026-08-03T12:00:00.000Z';
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

async function bundleChangedEvidence() {
  const from = await fixtureSource('changed', 'from');
  const descriptorTo = await fixtureSource('changed', 'to');
  const manifestPath = join(fixtures, 'malicious-bundle', 'manifest.json');
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const to = {
    ...descriptorTo,
    ref: manifest.tag,
    resolvedCommit: manifest.sha,
    version: manifest.version,
    generatedAt: manifest.generatedAt,
    provenance: {
      type: 'bundle',
      digest: digest({ manifest, items: descriptorTo.items }),
      manifestDigest: digest(manifestBytes),
      manifest,
    },
  };
  const ledger = createReleaseLedger(from, to, 'beta');
  const impactMap = createImpactMap(ledger, { repoRoot });
  const request = createApprovalRequest({ ledger, impactMap, target: to.version });
  return { ledger, impactMap, request, manifest };
}

function raw(prefixed) {
  return prefixed.slice('sha256:'.length);
}

function durableApproval(request, options = {}) {
  const nonce = options.nonce ?? '123e4567-e89b-42d3-a456-426614174000';
  const prefix = `plans/releases/${request.target}`;
  return {
    schemaVersion: 1,
    approvalId: `docs-approval/v1/${request.source.to.ref}/${nonce}`,
    subject: {
      channel: request.channel,
      sourceRepository: expectedApprovalContext.sourceRepository,
      sourceTag: request.source.to.ref,
      sourceSha: request.source.to.resolvedCommit,
      docsRepository: expectedApprovalContext.docsRepository,
      docsBaseSha: expectedApprovalContext.docsBaseSha,
      targetBranch: expectedApprovalContext.targetBranch,
    },
    evidence: {
      request: { requestId: request.requestId, path: `${prefix}/approval-request.json`, sha256: raw(request.requestDigest) },
      ledger: { path: `${prefix}/source-ledger.json`, sha256: raw(request.ledgerDigest) },
      impactMap: { path: `${prefix}/docs-impact-map.json`, sha256: raw(request.impactMapDigest) },
      ...(request.source.to.manifestDigest ? {
        manifest: { path: `${prefix}/evidence/manifest.json`, sha256: raw(request.source.to.manifestDigest) },
      } : {}),
    },
    claimIds: request.claimIds,
    scope: { paths: request.paths, actions: ['modify'] },
    approver: { login: 'example-docs-owner', kind: 'User' },
    tracking: {
      issue: {
        repository: expectedApprovalContext.docsRepository,
        number: 18,
        url: `https://github.com/${expectedApprovalContext.docsRepository}/issues/18`,
      },
      approvalPullRequest: {
        repository: expectedApprovalContext.docsRepository,
        number: 101,
        url: `https://github.com/${expectedApprovalContext.docsRepository}/pull/101`,
      },
    },
    issuedAt: '2026-08-03T10:00:00.000Z',
    expiresAt: '2026-08-04T10:00:00.000Z',
    nonce,
  };
}

function suppliedArtifacts(request, ledger, impactMap, manifest) {
  const approval = durableApproval(request);
  return {
    request: { path: approval.evidence.request.path, sha256: approval.evidence.request.sha256, value: request },
    ledger: { ...approval.evidence.ledger, value: ledger },
    impactMap: { ...approval.evidence.impactMap, value: impactMap },
    ...(manifest ? { manifest: { ...approval.evidence.manifest, value: manifest } } : {}),
  };
}

function bindingOptions(request, ledger, impactMap, extras = {}) {
  return {
    ...expectedApprovalContext,
    now: approvalNow,
    artifacts: suppliedArtifacts(request, ledger, impactMap, extras.manifest),
    ...(extras.usedNonces ? { usedNonces: extras.usedNonces } : {}),
  };
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

test('durable approval binds request, source, evidence, scope, reviewer, tracking, window, and nonce', async () => {
  const { request, ledger, impactMap } = await changedEvidence();
  const approval = durableApproval(request);
  assert.equal(validateDurableApprovalRecord(approval, { now: approvalNow }), approval);
  assert.equal(validateApprovalBinding(request, approval, bindingOptions(request, ledger, impactMap)), approval);
  assert.ok(request.source.to.provenanceDigest);
  assert.ok(request.claimIds.length > 0);
  assert.ok(request.paths.length > 0);
});

test('old flat approval and prefixed durable digests are rejected', async () => {
  const { request, ledger, impactMap } = await changedEvidence();
  const oldFlat = {
    schemaVersion: 'ak.docs.release-approval/v1',
    requestId: request.requestId,
    requestDigest: request.requestDigest,
    ledgerDigest: request.ledgerDigest,
    impactMapDigest: request.impactMapDigest,
    claimIds: request.claimIds,
    paths: request.paths,
  };
  assert.throws(() => validateApprovalBinding(request, oldFlat, bindingOptions(request, ledger, impactMap)), /durable approval schema/);
  const prefixed = structuredClone(durableApproval(request));
  prefixed.evidence.ledger.sha256 = request.ledgerDigest;
  assert.throws(() => validateApprovalBinding(request, prefixed, bindingOptions(request, ledger, impactMap)), /evidence\.ledger\.sha256/);
});

test('request, ledger, source subject, action, and path mutations fail closed', async () => {
  const { request, ledger, impactMap } = await changedEvidence();
  const approval = durableApproval(request);
  const requestMutation = structuredClone(bindingOptions(request, ledger, impactMap));
  requestMutation.artifacts.request.sha256 = 'f'.repeat(64);
  assert.throws(() => validateApprovalBinding(request, approval, requestMutation), /request artifact digest/);
  const ledgerMutation = structuredClone(bindingOptions(request, ledger, impactMap));
  ledgerMutation.artifacts.ledger.sha256 = 'e'.repeat(64);
  assert.throws(() => validateApprovalBinding(request, approval, ledgerMutation), /ledger artifact digest/);

  const sourceMismatch = structuredClone(approval);
  sourceMismatch.subject.sourceRepository = 'example/other-agentkit';
  assert.throws(() => validateApprovalBinding(request, sourceMismatch, bindingOptions(request, ledger, impactMap)), /source repository/);
  const docsMismatch = structuredClone(approval);
  docsMismatch.subject.docsBaseSha = '3'.repeat(40);
  assert.throws(() => validateApprovalBinding(request, docsMismatch, bindingOptions(request, ledger, impactMap)), /docs base SHA/);
  const actionExpansion = structuredClone(approval);
  actionExpansion.scope.actions = ['modify', 'create'];
  assert.throws(() => validateApprovalBinding(request, actionExpansion, bindingOptions(request, ledger, impactMap)), /scope\.actions/);
  const pathExpansion = structuredClone(approval);
  pathExpansion.scope.paths.push('content/docs/beta/getting-started/quickstart.en.mdx');
  pathExpansion.scope.paths.sort();
  assert.throws(() => validateApprovalBinding(request, pathExpansion, bindingOptions(request, ledger, impactMap)), /approval paths/);
});

test('bundle manifest digest and source identity mutations fail closed', async () => {
  const { request, ledger, impactMap, manifest } = await bundleChangedEvidence();
  const approval = durableApproval(request);
  const options = bindingOptions(request, ledger, impactMap, { manifest });
  assert.equal(validateApprovalBinding(request, approval, options), approval);

  const digestMutation = structuredClone(options);
  digestMutation.artifacts.manifest.sha256 = 'a'.repeat(64);
  assert.throws(() => validateApprovalBinding(request, approval, digestMutation), /manifest artifact digest/);
  const manifestMutation = structuredClone(options);
  manifestMutation.artifacts.manifest.value.sha = '8'.repeat(40);
  assert.throws(() => validateApprovalBinding(request, approval, manifestMutation), /manifest source/);
});

test('approval ID, stale window, and replayed nonce fail closed', async () => {
  const { request, ledger, impactMap } = await changedEvidence();
  const approval = durableApproval(request);
  const tagMismatch = structuredClone(approval);
  tagMismatch.approvalId = tagMismatch.approvalId.replace(request.source.to.ref, 'v9.9.9-beta.9');
  assert.throws(() => validateApprovalBinding(request, tagMismatch, bindingOptions(request, ledger, impactMap)), /approvalId tag/);
  const nonceMismatch = structuredClone(approval);
  nonceMismatch.approvalId = nonceMismatch.approvalId.replace(approval.nonce, '123e4567-e89b-42d3-a456-426614174001');
  assert.throws(() => validateApprovalBinding(request, nonceMismatch, bindingOptions(request, ledger, impactMap)), /approvalId nonce/);
  assert.throws(
    () => validateApprovalBinding(request, approval, { ...bindingOptions(request, ledger, impactMap), now: '2026-08-05T00:00:00.000Z' }),
    /stale/,
  );
  assert.throws(
    () => validateApprovalBinding(request, approval, bindingOptions(request, ledger, impactMap, { usedNonces: new Set([approval.nonce]) })),
    /replay/,
  );
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
  const ledgerPath = join(v0.outputDir, 'source-ledger.json');
  const impactMapPath = join(v0.outputDir, 'docs-impact-map.json');
  const request = await json(requestPath);
  const approval = durableApproval(request);
  const approvalDir = join(temporary, 'docs-approvals');
  await mkdir(approvalDir);
  const approvalPath = join(approvalDir, `${request.source.to.ref}-${approval.nonce}.json`);
  const changesPath = join(temporary, 'changes.json');
  await writeFile(approvalPath, stableJson(approval));
  await writeFile(changesPath, stableJson(request.paths.map((path) => ({ status: 'M', path }))));
  const v1 = await runCheck({
    '--mode': 'v1',
    '--repo-root': temporary,
    '--request': requestPath,
    '--ledger': ledgerPath,
    '--impact-map': impactMapPath,
    '--approval': approvalPath,
    '--changes': changesPath,
    '--source-repository': expectedApprovalContext.sourceRepository,
    '--docs-repository': expectedApprovalContext.docsRepository,
    '--docs-base-sha': expectedApprovalContext.docsBaseSha,
    '--target-branch': expectedApprovalContext.targetBranch,
    '--now': approvalNow,
  });
  assert.equal(v1.status, 'approved');
  assert.equal(v1.requestDigest, request.requestDigest);
  await assert.rejects(
    () => runCheck({
      '--mode': 'v1',
      '--request': requestPath,
      '--ledger': ledgerPath,
      '--impact-map': impactMapPath,
      '--approval': approvalPath,
      '--changes': changesPath,
      '--now': approvalNow,
    }),
    /missing required argument --repo-root/,
  );
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
