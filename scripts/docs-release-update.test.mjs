import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  createApprovalRequest,
  validateApprovalBinding,
  validateApprovalRequest,
  validateDurableApprovalRecord,
} from './lib/docs-release-approval.mjs';
import { runCheck } from './check-docs-release-update.mjs';
import { runImpactMap } from './docs-impact-map.mjs';
import { runManualApproval } from './docs-release-manual-approval.mjs';
import { isCoverageApprovalRequest } from './lib/docs-release-coverage-schema.mjs';
import { createImpactMap } from './lib/docs-release-impact.mjs';
import { createReleaseLedger } from './lib/docs-release-ledger.mjs';
import {
  MANUAL_OWNER_APPROVAL_SCHEMA,
  createManualOwnerApprovalRecord,
  manualOwnerApprovalStatement,
  validateManualOwnerApprovalBinding,
  validateManualOwnerApprovalRecord,
} from './lib/docs-release-manual-approval.mjs';
import { digest, stableJson } from './lib/docs-release-normalize.mjs';
import {
  assertV0WriteScope,
  releaseOutputDir,
  v1WriteViolations,
  validateOwnerDirectedPaths,
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
const manualIssuedAt = '2026-08-03T10:00:00.000Z';
const manualExpiresAt = '2026-08-04T10:00:00.000Z';
const manualNonce = '987e4567-e89b-42d3-a456-426614174000';
const grokOwnerPaths = [
  'content/docs/beta/troubleshooting/grok-hooks.en.mdx',
  'content/docs/beta/troubleshooting/grok-hooks.vi.mdx',
];
let temporary;
let outputRoot;
let coverageSequence = 0;

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

async function ownerDirectedEvidence(ownerPaths = grokOwnerPaths) {
  const from = await fixtureSource('no-impact', 'from');
  const to = await fixtureSource('no-impact', 'to');
  const beforeDigest = `sha256:${'a'.repeat(64)}`;
  const afterDigest = `sha256:${'b'.repeat(64)}`;
  from.items = [{
    id: 'release-notes',
    kind: 'docs-bundle',
    claimType: 'fact',
    digest: beforeDigest,
    anchors: [{ path: 'release-notes.md', digest: beforeDigest, type: 'source' }],
    docs: [],
    aliases: [],
  }];
  to.items = [{
    id: 'release-notes',
    kind: 'docs-bundle',
    claimType: 'fact',
    digest: afterDigest,
    anchors: [{ path: 'release-notes.md', digest: afterDigest, type: 'source' }],
    docs: [],
    aliases: [],
  }];
  const ledger = createReleaseLedger(from, to, 'beta');
  const impactMap = createImpactMap(ledger, { repoRoot });
  const request = createApprovalRequest({ ledger, impactMap, target: to.version, ownerPaths });
  return { from, to, ledger, impactMap, request };
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
  const coverageGap = isCoverageApprovalRequest(request);
  const source = coverageGap
    ? { repository: request.source.repository, tag: request.source.tag, sha: request.source.sha }
    : { repository: expectedApprovalContext.sourceRepository, tag: request.source.to.ref, sha: request.source.to.resolvedCommit };
  const docs = coverageGap ? request.docs : {
    repository: expectedApprovalContext.docsRepository,
    baseSha: options.docsBaseSha ?? expectedApprovalContext.docsBaseSha,
    targetBranch: expectedApprovalContext.targetBranch,
  };
  const filenames = coverageGap
    ? { request: 'coverage-approval-request.json', ledger: 'coverage-source-ledger.json', impact: 'coverage-impact-map.json' }
    : { request: 'approval-request.json', ledger: 'source-ledger.json', impact: 'docs-impact-map.json' };
  const issue = coverageGap ? request.issue : {
    repository: docs.repository,
    number: 18,
    url: `https://github.com/${docs.repository}/issues/18`,
  };
  return {
    schemaVersion: 1,
    approvalId: `docs-approval/v1/${source.tag}/${nonce}`,
    subject: {
      channel: request.channel,
      sourceRepository: source.repository,
      sourceTag: source.tag,
      sourceSha: source.sha,
      docsRepository: docs.repository,
      docsBaseSha: docs.baseSha,
      targetBranch: docs.targetBranch,
    },
    evidence: {
      request: { requestId: request.requestId, path: `${prefix}/${filenames.request}`, sha256: raw(request.requestDigest) },
      ledger: { path: `${prefix}/${filenames.ledger}`, sha256: raw(request.ledgerDigest) },
      impactMap: { path: `${prefix}/${filenames.impact}`, sha256: raw(request.impactMapDigest) },
      ...(!coverageGap && request.source.to.manifestDigest ? {
        manifest: { path: `${prefix}/evidence/manifest.json`, sha256: raw(request.source.to.manifestDigest) },
      } : {}),
    },
    claimIds: request.claimIds,
    scope: { paths: request.paths, actions: ['modify'] },
    approver: { login: 'example-docs-owner', kind: 'User' },
    tracking: {
      issue: {
        repository: issue.repository,
        number: issue.number,
        url: issue.url,
      },
      approvalPullRequest: {
        repository: docs.repository,
        number: 101,
        url: `https://github.com/${docs.repository}/pull/101`,
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
  const context = isCoverageApprovalRequest(request) ? {
    sourceRepository: request.source.repository,
    docsRepository: request.docs.repository,
    docsBaseSha: request.docs.baseSha,
    targetBranch: request.docs.targetBranch,
  } : expectedApprovalContext;
  return {
    ...context,
    now: approvalNow,
    artifacts: suppliedArtifacts(request, ledger, impactMap, extras.manifest),
    ...(extras.usedNonces ? { usedNonces: extras.usedNonces } : {}),
  };
}

function manualApproval(request, ledger, impactMap, options = {}) {
  const statement = manualOwnerApprovalStatement(request.requestId);
  const docsBaseSha = isCoverageApprovalRequest(request)
    ? request.docs.baseSha
    : expectedApprovalContext.docsBaseSha;
  return createManualOwnerApprovalRecord({
    request,
    requestId: request.requestId,
    ownerLabel: options.ownerLabel ?? 'Release owner: Thieu Nguyen',
    approvalStatement: options.approvalStatement ?? statement,
    docsBaseSha: options.docsBaseSha ?? docsBaseSha,
    issuedAt: options.issuedAt ?? manualIssuedAt,
    expiresAt: options.expiresAt ?? manualExpiresAt,
    nonce: options.nonce ?? manualNonce,
    artifacts: suppliedArtifacts(request, ledger, impactMap, options.manifest),
    now: options.now ?? approvalNow,
  });
}

async function coverageWorkspace() {
  const fixtureRoot = join(fixtures, 'coverage-gap');
  coverageSequence += 1;
  const docsRoot = join(temporary, `coverage-docs-${coverageSequence}`);
  const sourceRoot = join(temporary, `coverage-source-${coverageSequence}`);
  await cp(join(fixtureRoot, 'docs'), docsRoot, { recursive: true });
  await cp(join(fixtureRoot, 'source'), sourceRoot, { recursive: true });
  await writeFile(join(docsRoot, '.gitignore'), 'plans/\ndocs-approvals/\n');
  await execFileAsync('git', ['init', '-b', 'dev'], { cwd: docsRoot });
  await execFileAsync('git', ['config', 'user.name', 'Coverage Fixture'], { cwd: docsRoot });
  await execFileAsync('git', ['config', 'user.email', 'coverage@example.test'], { cwd: docsRoot });
  await execFileAsync('git', ['add', '.'], { cwd: docsRoot });
  await execFileAsync('git', ['commit', '-m', 'fixture'], {
    cwd: docsRoot,
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: '2026-08-04T00:00:00Z',
      GIT_COMMITTER_DATE: '2026-08-04T00:00:00Z',
    },
  });
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: docsRoot });
  const docsBaseSha = stdout.trim();
  const evidenceDir = join(docsRoot, 'plans', 'releases', 'coverage-audit');
  await mkdir(evidenceDir, { recursive: true });
  const issueBodyPath = join(evidenceDir, 'issue-body.md');
  await cp(join(fixtureRoot, 'issue-body.md'), issueBodyPath);
  const template = await readFile(join(fixtureRoot, 'audit-source.template.json'), 'utf8');
  const auditSourcePath = join(evidenceDir, 'audit-source.json');
  await writeFile(auditSourcePath, template.replace('DOCS_BASE_SHA', docsBaseSha));
  return {
    docsRoot,
    sourceRoot,
    docsBaseSha,
    issueBodyPath,
    auditSourcePath,
    outputRoot: join(docsRoot, 'plans', 'releases'),
  };
}

async function checkoutFixture(name, tag) {
  const root = join(temporary, `checkout-${name}`);
  await cp(join(fixtures, name), root, { recursive: true });
  await execFileAsync('git', ['init', '-b', 'fixture'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'Checkout Fixture'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'checkout@example.test'], { cwd: root });
  await execFileAsync('git', ['add', '--all', '--force'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'fixture'], {
    cwd: root,
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: '2026-08-04T00:00:00Z',
      GIT_COMMITTER_DATE: '2026-08-04T00:00:00Z',
    },
  });
  await execFileAsync('git', ['tag', tag], { cwd: root });
  return root;
}

async function initializeDocsRepo(root, paths, extraPaths = []) {
  await writeFile(join(root, '.gitignore'), 'plans/\ndocs-approvals/\n');
  for (const path of [...paths, ...extraPaths]) {
    const absolute = join(root, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, `before ${path}\n`);
  }
  await execFileAsync('git', ['init', '-b', 'dev'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'V1 Fixture'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'v1@example.test'], { cwd: root });
  await execFileAsync('git', ['add', '--all'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'fixture'], {
    cwd: root,
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: '2026-08-04T00:00:00Z',
      GIT_COMMITTER_DATE: '2026-08-04T00:00:00Z',
    },
  });
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root });
  return stdout.trim();
}

async function modifyDocsPaths(root, paths) {
  for (const path of paths) await writeFile(join(root, path), `after ${path}\n`);
}

async function runCoverageGap(workspace) {
  const result = await runCheck({
    '--mode': 'coverage-gap',
    '--audit-source': workspace.auditSourcePath,
    '--source-root': workspace.sourceRoot,
    '--repo-root': workspace.docsRoot,
    '--output-root': workspace.outputRoot,
    '--target': 'coverage-audit',
  });
  return {
    ...result,
    request: await json(join(result.outputDir, 'coverage-approval-request.json')),
    ledger: await json(join(result.outputDir, 'coverage-source-ledger.json')),
    impactMap: await json(join(result.outputDir, 'coverage-impact-map.json')),
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

test('owner-directed paths bind an unrouted release claim to an exact approval scope', async () => {
  const { ledger, impactMap, request } = await ownerDirectedEvidence();
  const withoutOwnerScope = createApprovalRequest({
    ledger,
    impactMap,
    target: request.target,
  });
  assert.equal(impactMap.status, 'blocked');
  assert.deepEqual(impactMap.pages.map((page) => page.path), [null]);
  assert.deepEqual(withoutOwnerScope.paths, []);
  assert.deepEqual(request.ownerDirectedPaths, grokOwnerPaths);
  assert.deepEqual(request.paths, grokOwnerPaths);
  assert.notEqual(request.requestId, withoutOwnerScope.requestId);
  assert.notEqual(request.requestDigest, withoutOwnerScope.requestDigest);
  assert.equal(validateApprovalRequest(request), request);

  const approval = manualApproval(request, ledger, impactMap);
  assert.equal(validateManualOwnerApprovalBinding(
    request,
    approval,
    bindingOptions(request, ledger, impactMap),
  ), approval);
  assert.deepEqual(v1WriteViolations(
    request.paths.map((path) => ({ status: 'M', path })),
    request.paths,
  ), []);
  assert.equal(v1WriteViolations([
    { status: 'M', path: 'content/docs/beta/troubleshooting/configuration.en.mdx' },
  ], request.paths).length, 1);

  const forged = structuredClone(request);
  forged.ownerDirectedPaths.push('content/docs/beta/troubleshooting/configuration.en.mdx');
  forged.ownerDirectedPaths.sort();
  delete forged.requestDigest;
  forged.requestDigest = digest(forged);
  assert.throws(() => validateApprovalRequest(forged), /included in paths/);

  const staleIdentity = structuredClone(request);
  const expandedPath = 'content/docs/beta/troubleshooting/configuration.en.mdx';
  const expandedPair = 'content/docs/beta/troubleshooting/configuration.vi.mdx';
  staleIdentity.ownerDirectedPaths.push(expandedPath, expandedPair);
  staleIdentity.ownerDirectedPaths.sort();
  staleIdentity.paths.push(expandedPath, expandedPair);
  staleIdentity.paths.sort();
  delete staleIdentity.requestDigest;
  staleIdentity.requestDigest = digest(staleIdentity);
  assert.throws(() => validateApprovalRequest(staleIdentity), /request ID is forged or stale/);

  const directExpansion = structuredClone(request);
  directExpansion.paths.push(expandedPath);
  directExpansion.paths.sort();
  delete directExpansion.requestDigest;
  directExpansion.requestDigest = digest(directExpansion);
  assert.throws(() => validateApprovalRequest(directExpansion), /request ID is forged or stale/);
});

test('owner-directed path input is normalized and fails closed outside modify-only Beta scope', async () => {
  assert.deepEqual(validateOwnerDirectedPaths([
    grokOwnerPaths[1],
    grokOwnerPaths[0],
    grokOwnerPaths[1],
  ], repoRoot), grokOwnerPaths);
  const cliOwnerPaths = [
    'content/docs/beta/reference/cli/activity/list.en.mdx',
    'content/docs/beta/reference/cli/activity/list.vi.mdx',
  ];
  assert.deepEqual(validateOwnerDirectedPaths(cliOwnerPaths, repoRoot), cliOwnerPaths);
  for (const [value, expected] of [
    [{ paths: grokOwnerPaths }, /non-empty JSON array/],
    [[], /non-empty JSON array/],
    [[grokOwnerPaths[0]], /requires paired path/],
    [['content/docs/stable/troubleshooting/grok-hooks.en.mdx'], /human-owned Beta/],
    [['content/docs/beta/reference/release-notes.mdx'], /human-owned Beta/],
    [['content/docs/beta/troubleshooting/missing.en.mdx'], /does not exist/],
  ]) {
    assert.throws(() => validateOwnerDirectedPaths(value, repoRoot), expected);
  }

  const symlinkRoot = join(temporary, 'owner-symlink-root');
  const symlinkDir = join(symlinkRoot, 'content', 'docs', 'beta', 'troubleshooting');
  await mkdir(symlinkDir, { recursive: true });
  await symlink(
    join(repoRoot, grokOwnerPaths[0]),
    join(symlinkDir, 'grok-hooks.en.mdx'),
  );
  assert.throws(
    () => validateOwnerDirectedPaths([grokOwnerPaths[0]], symlinkRoot),
    /must not traverse a symlink/,
  );

  const from = await fixtureSource('no-impact', 'from');
  const to = await fixtureSource('no-impact', 'to');
  const ledger = createReleaseLedger(from, to, 'beta');
  const impactMap = createImpactMap(ledger, { repoRoot });
  assert.throws(
    () => createApprovalRequest({ ledger, impactMap, target: to.version, ownerPaths: grokOwnerPaths }),
    /actionable release claim/,
  );
  await assert.rejects(
    () => ownerDirectedEvidence([grokOwnerPaths[0]]),
    /requires paired path/,
  );
});

test('V0 CLI binds owner-directed paths and remains byte-equivalent on rerun', async () => {
  const ownerPathsPath = join(temporary, 'owner-paths.json');
  await writeFile(ownerPathsPath, stableJson([
    grokOwnerPaths[1],
    grokOwnerPaths[0],
    grokOwnerPaths[1],
  ]));
  const args = {
    '--mode': 'v0',
    '--from-ref': 'v0.41.0-beta.1',
    '--to-ref': 'v0.42.0-beta.2',
    '--from-source': join(fixtures, 'changed', 'from.json'),
    '--to-source': join(fixtures, 'changed', 'to.json'),
    '--channel': 'beta',
    '--repo-root': repoRoot,
    '--output-root': outputRoot,
    '--target': 'owner-directed-v0',
    '--owner-paths': ownerPathsPath,
  };
  const first = await runCheck(args);
  const before = await snapshot(first.outputDir);
  const second = await runCheck(args);
  assert.deepEqual(await snapshot(second.outputDir), before);
  const request = await json(join(first.outputDir, 'approval-request.json'));
  assert.deepEqual(request.ownerDirectedPaths, grokOwnerPaths);
  assert.ok(grokOwnerPaths.every((path) => request.paths.includes(path)));

  await writeFile(ownerPathsPath, stableJson({ paths: grokOwnerPaths }));
  await assert.rejects(() => runCheck(args), /non-empty JSON array/);
});

test('impact-map CLI accepts the same owner-directed path contract', async () => {
  const { ledger } = await ownerDirectedEvidence();
  const ledgerPath = join(temporary, 'owner-impact-ledger.json');
  await writeFile(ledgerPath, stableJson(ledger));
  const result = await runImpactMap({
    ledger: ledgerPath,
    repoRoot,
    outputRoot,
    target: 'owner-impact-map',
    ownerPaths: grokOwnerPaths,
  });
  assert.deepEqual(result.request.ownerDirectedPaths, grokOwnerPaths);
  assert.deepEqual(result.request.paths, grokOwnerPaths);
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

test('ordinary V0 keeps the v2.7 to v2.8 issue-18 snapshot as a release no-op', async () => {
  const from = await fixtureSource('issue18-snapshot', 'from');
  const to = await fixtureSource('issue18-snapshot', 'to');
  const ledger = createReleaseLedger(from, to, 'beta');
  const impactMap = createImpactMap(ledger, { repoRoot });
  const request = createApprovalRequest({ ledger, impactMap, target: 'issue-18' });
  assert.equal(ledger.status, 'no-op');
  assert.ok(ledger.claims.every((claim) => claim.classification === 'no-change'));
  assert.equal(impactMap.status, 'no-op');
  assert.equal(request.status, 'no-op');
  assert.deepEqual(request.claimIds, []);
  assert.deepEqual(request.paths, []);
});

test('coverage-gap V0 is deterministic and separates covered, partial, missing, and blocked claims', async () => {
  const workspace = await coverageWorkspace();
  const first = await runCoverageGap(workspace);
  const before = await snapshot(first.outputDir);
  const second = await runCoverageGap(workspace);
  assert.deepEqual(await snapshot(second.outputDir), before);
  assert.deepEqual(Object.keys(before).sort(), [
    '/audit-source.json',
    '/coverage-approval-request.json',
    '/coverage-impact-map.json',
    '/coverage-impact-map.md',
    '/coverage-source-ledger.json',
    '/coverage-source-ledger.md',
    '/coverage-unresolved-evidence.md',
    '/issue-body.md',
  ]);
  const bySource = Object.fromEntries(first.ledger.claims.map((claim) => [claim.sourceId, claim]));
  assert.equal(bySource['issue18.covered-preservation'].classification, 'no-change');
  assert.equal(bySource['issue18.partial-preservation'].classification, 'update');
  assert.equal(bySource['issue18.missing-recovery'].classification, 'new');
  assert.equal(bySource['issue18.blocked-without-test'].classification, 'blocked');
  assert.match(bySource['issue18.blocked-without-test'].blockedReasons.join(' '), /test anchor missing/);
  assert.equal(first.request.status, 'approval-required');
  assert.equal(first.request.claimIds.length, 2);
  assert.deepEqual(first.request.paths, [
    'content/docs/beta/guides/coverage-missing.en.mdx',
    'content/docs/beta/guides/coverage-partial.en.mdx',
  ]);
  assert.equal(first.impactMap.pages.find((page) => page.path.includes('covered')).classification, 'no-change');
  assert.equal(first.impactMap.pages.find((page) => page.path.includes('blocked')).classification, 'blocked');
  assert.ok(first.request.routeDigests.every((route) => route.digest.startsWith('sha256:')));
});

test('coverage-gap V0 rejects issue, source, route, dirty checkout, floating ref, and path escape mutations', async () => {
  let workspace = await coverageWorkspace();
  await writeFile(workspace.issueBodyPath, 'mutated issue\n');
  await assert.rejects(() => runCoverageGap(workspace), /issue body snapshot digest mismatch/);

  workspace = await coverageWorkspace();
  await writeFile(join(workspace.sourceRoot, 'behavior.go'), 'mutated source\n');
  await assert.rejects(() => runCoverageGap(workspace), /source\/test hash mismatch/);

  workspace = await coverageWorkspace();
  const descriptor = await json(workspace.auditSourcePath);
  descriptor.claims[0].coverage[0].routeDigest = `sha256:${'f'.repeat(64)}`;
  await writeFile(workspace.auditSourcePath, stableJson(descriptor));
  await assert.rejects(() => runCoverageGap(workspace), /current-doc route digest mismatch/);

  workspace = await coverageWorkspace();
  await writeFile(join(workspace.docsRoot, 'content/docs/beta/guides/coverage-covered.en.mdx'), 'dirty\n');
  await assert.rejects(() => runCoverageGap(workspace), /docs checkout is dirty/);

  workspace = await coverageWorkspace();
  const floating = await json(workspace.auditSourcePath);
  floating.source.tag = 'dev';
  await writeFile(workspace.auditSourcePath, stableJson(floating));
  await assert.rejects(() => runCoverageGap(workspace), /full commit SHA or release tag/);

  workspace = await coverageWorkspace();
  await execFileAsync('git', ['init', '-b', 'dev'], { cwd: workspace.sourceRoot });
  await execFileAsync('git', ['config', 'user.name', 'Coverage Source'], { cwd: workspace.sourceRoot });
  await execFileAsync('git', ['config', 'user.email', 'source@example.test'], { cwd: workspace.sourceRoot });
  await execFileAsync('git', ['add', '.'], { cwd: workspace.sourceRoot });
  await execFileAsync('git', ['commit', '-m', 'source fixture'], {
    cwd: workspace.sourceRoot,
    env: { ...process.env, GIT_AUTHOR_DATE: '2026-08-04T00:00:00Z', GIT_COMMITTER_DATE: '2026-08-04T00:00:00Z' },
  });
  await execFileAsync('git', ['tag', 'v2.8.0-beta.2'], { cwd: workspace.sourceRoot });
  const sourceHead = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: workspace.sourceRoot })).stdout.trim();
  const checkout = await json(workspace.auditSourcePath);
  checkout.source.sha = sourceHead;
  checkout.source.provenance = 'checkout';
  await writeFile(workspace.auditSourcePath, stableJson(checkout));
  await runCoverageGap(workspace);
  await writeFile(join(workspace.sourceRoot, 'dirty.txt'), 'dirty\n');
  await assert.rejects(() => runCoverageGap(workspace), /source checkout is dirty/);

  workspace = await coverageWorkspace();
  const outside = join(temporary, 'outside-source.go');
  await writeFile(outside, 'outside\n');
  await symlink(outside, join(workspace.sourceRoot, 'escape.go'));
  const escaped = await json(workspace.auditSourcePath);
  escaped.claims[0].anchors[0].path = 'escape.go';
  escaped.claims[0].anchors[0].digest = digest(await readFile(outside));
  await writeFile(workspace.auditSourcePath, stableJson(escaped));
  await assert.rejects(() => runCoverageGap(workspace), /unsafe path|outside/);
});

test('coverage descriptor statements remain inert data', async () => {
  const workspace = await coverageWorkspace();
  const marker = join(temporary, 'SHOULD_NOT_EXIST');
  const descriptor = await json(workspace.auditSourcePath);
  descriptor.claims[0].statement = `touch ${marker}`;
  descriptor.claims[0].statementDigest = digest(descriptor.claims[0].statement);
  await writeFile(workspace.auditSourcePath, stableJson(descriptor));
  const result = await runCoverageGap(workspace);
  await assert.rejects(() => readFile(marker), /ENOENT/);
  for (const name of result.files) {
    const contents = await readFile(join(result.outputDir, name), 'utf8');
    assert.doesNotMatch(contents, /SHOULD_NOT_EXIST/);
  }
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

test('unrouted claims of one family collapse into one blocked impact identity', async () => {
  const before = `sha256:${'a'.repeat(64)}`;
  const after = `sha256:${'b'.repeat(64)}`;
  const from = await fixtureSource('no-impact', 'from');
  const to = await fixtureSource('no-impact', 'to');
  from.items = ['shell', 'powershell'].map((id) => ({
    id,
    kind: 'installer',
    claimType: 'fact',
    digest: before,
    anchors: [{ path: `${id}.sh`, digest: before, type: 'source' }],
    docs: [],
    aliases: [],
  }));
  to.items = ['shell', 'powershell'].map((id) => ({
    id,
    kind: 'installer',
    claimType: 'fact',
    digest: after,
    anchors: [{ path: `${id}.sh`, digest: after, type: 'source' }],
    docs: [],
    aliases: [],
  }));
  const ledger = createReleaseLedger(from, to, 'beta');
  const map = createImpactMap(ledger, { repoRoot });
  assert.equal(map.pages.length, 1);
  assert.equal(map.pages[0].path, null);
  assert.equal(map.pages[0].family, 'installer');
  assert.equal(map.pages[0].classification, 'blocked');
  assert.equal(map.pages[0].proposedClassification, 'update');
  assert.equal(map.pages[0].claimIds.length, 2);
  assert.deepEqual(map.pages[0].reasons, ['no exact docs path supplied by source evidence']);
});

test('checkout IDs normalize source-safe paths and preserve already-valid identities', async () => {
  const tag = 'v2.8.0-beta.4';
  const root = await checkoutFixture('checkout-id-paths', tag);
  const first = await loadReleaseSource(root, { channel: 'beta', ref: tag });
  const second = await loadReleaseSource(root, { channel: 'beta', ref: tag });
  assert.deepEqual(second, first);
  assert.deepEqual(first.items.map(({ kind, id }) => `${kind}:${id}`), [
    'hook:claude/hooks/__tests__/block-unsafe-git-and-lifecycle-commands.test',
    'hook:hooks/__tests__/safe_name.test',
    'hook:hooks/already-valid',
    'hook:hooks/platform-pair.cmd',
    'hook:hooks/platform-pair.sh',
    'hook:hooks/release-guard-safe.test',
    'hook:hooks/scope+name@v1.test',
    'kit:kits/core/skills/name_with_underscores/SKILL',
  ]);
  assert.equal(first.items.find((item) => item.id === 'hooks/already-valid').anchors[0].path, 'hooks/already-valid.cjs');
  assert.equal(first.items.find((item) => item.id === 'hooks/__tests__/safe_name.test').anchors[0].path, 'hooks/__tests__/safe_name.test.cjs');
});

test('checkout ID normalization collisions fail closed', async () => {
  const tag = 'v2.8.0-beta.4';
  const root = await checkoutFixture('checkout-id-collision', tag);
  await assert.rejects(
    () => loadReleaseSource(root, { channel: 'beta', ref: tag }),
    /source\.items contains duplicate kind\/id pairs/,
  );
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

test('manual-owner approval is versioned, exact, and cannot satisfy the organization adapter', async () => {
  const { request, ledger, impactMap } = await changedEvidence();
  const approval = manualApproval(request, ledger, impactMap);
  assert.equal(approval.schemaVersion, MANUAL_OWNER_APPROVAL_SCHEMA);
  assert.equal(approval.approvalMode, 'manual-owner');
  assert.equal(approval.request.id, request.requestId);
  assert.equal(approval.request.digest, request.requestDigest);
  assert.equal(approval.request.ledgerDigest, request.ledgerDigest);
  assert.equal(approval.request.impactMapDigest, request.impactMapDigest);
  assert.deepEqual(approval.claimIds, request.claimIds);
  assert.deepEqual(approval.scope, { actions: ['modify'], paths: request.paths });
  assert.deepEqual(approval.owner, { label: 'Release owner: Thieu Nguyen' });
  assert.equal(validateManualOwnerApprovalRecord(approval, { now: approvalNow }), approval);
  assert.equal(validateManualOwnerApprovalBinding(
    request,
    approval,
    bindingOptions(request, ledger, impactMap),
  ), approval);
  assert.throws(
    () => validateDurableApprovalRecord(approval, { now: approvalNow }),
    /durable approval schema/,
  );
});

test('manual-owner approval rejects loose assent, forgery, stale refs, expansion, and replay', async () => {
  const { request, ledger, impactMap } = await changedEvidence();
  const options = bindingOptions(request, ledger, impactMap);
  const approval = manualApproval(request, ledger, impactMap);

  for (const looseStatement of [
    'looks good',
    `Approve ${request.requestId}`,
    `approve  ${request.requestId}`,
    `approve ${request.requestId}.`,
  ]) {
    assert.throws(
      () => manualApproval(request, ledger, impactMap, { approvalStatement: looseStatement }),
      /exact approval statement/,
    );
  }
  assert.throws(
    () => manualApproval(request, ledger, impactMap, { ownerLabel: '   ' }),
    /owner label/,
  );

  const mutations = [
    ['request ID|exact approval statement', (value) => { value.request.id = 'REQ-FFFFFFFFFFFFFFFF'; }],
    ['request digest', (value) => { value.request.digest = `sha256:${'f'.repeat(64)}`; }],
    ['ledger digest', (value) => { value.request.ledgerDigest = `sha256:${'e'.repeat(64)}`; }],
    ['impact map digest', (value) => { value.request.impactMapDigest = `sha256:${'d'.repeat(64)}`; }],
    ['docs base SHA', (value) => { value.docsBaseSha = '3'.repeat(40); }],
    ['claim IDs', (value) => { value.claimIds.push('CLM-FFFFFFFFFFFFFFFF'); value.claimIds.sort(); }],
    ['approval paths', (value) => { value.scope.paths.push('content/docs/beta/getting-started/quickstart.en.mdx'); value.scope.paths.sort(); }],
    ['scope actions', (value) => { value.scope.actions = ['modify', 'create']; }],
    ['exact approval statement', (value) => { value.approvalStatement = 'approved'; }],
  ];
  for (const [expected, mutate] of mutations) {
    const forged = structuredClone(approval);
    mutate(forged);
    assert.throws(
      () => validateManualOwnerApprovalBinding(request, forged, options),
      new RegExp(expected),
    );
  }

  assert.throws(
    () => validateManualOwnerApprovalBinding(request, approval, { ...options, now: '2026-08-05T00:00:00.000Z' }),
    /stale/,
  );
  assert.throws(
    () => validateManualOwnerApprovalBinding(request, approval, { ...options, usedNonces: new Set([approval.nonce]) }),
    /replay/,
  );
  assert.throws(
    () => manualApproval(request, ledger, impactMap, { nonce: '987e4567-e89b-12d3-a456-426614174000' }),
    /nonce/,
  );
  assert.throws(
    () => manualApproval(request, ledger, impactMap, { expiresAt: '2026-08-11T10:00:00.000Z' }),
    /seven days/,
  );
  const artifactForgery = structuredClone(options);
  artifactForgery.artifacts.ledger.sha256 = 'c'.repeat(64);
  assert.throws(
    () => validateManualOwnerApprovalBinding(request, approval, artifactForgery),
    /ledger artifact digest/,
  );
  const staleRefRequest = structuredClone(request);
  staleRefRequest.source.to.resolvedCommit = '9'.repeat(40);
  delete staleRefRequest.requestDigest;
  staleRefRequest.requestDigest = digest(staleRefRequest);
  assert.throws(
    () => validateManualOwnerApprovalBinding(staleRefRequest, approval, options),
    /request digest/,
  );
});

test('manual-owner approval supports coverage requests without GitHub approver or approval-PR identity', async () => {
  const workspace = await coverageWorkspace();
  const { request, ledger, impactMap } = await runCoverageGap(workspace);
  const approval = manualApproval(request, ledger, impactMap);
  assert.equal(validateManualOwnerApprovalBinding(
    request,
    approval,
    bindingOptions(request, ledger, impactMap),
  ), approval);
  assert.equal('approver' in approval, false);
  assert.equal('tracking' in approval, false);
});

test('coverage durable approval binds audit, issue snapshot, source claims, route digests, claims, and paths', async () => {
  const workspace = await coverageWorkspace();
  const { request, ledger, impactMap } = await runCoverageGap(workspace);
  const approval = durableApproval(request);
  const options = bindingOptions(request, ledger, impactMap);
  assert.equal(validateApprovalBinding(request, approval, options), approval);

  const claimExpansion = structuredClone(approval);
  claimExpansion.claimIds.push('CLM-FFFFFFFFFFFFFFFF');
  claimExpansion.claimIds.sort();
  assert.throws(() => validateApprovalBinding(request, claimExpansion, options), /claim IDs/);
  const pathExpansion = structuredClone(approval);
  pathExpansion.scope.paths.push('content/docs/beta/guides/coverage-covered.en.mdx');
  pathExpansion.scope.paths.sort();
  assert.throws(() => validateApprovalBinding(request, pathExpansion, options), /approval paths/);
  const actionExpansion = structuredClone(approval);
  actionExpansion.scope.actions = ['modify', 'create'];
  assert.throws(() => validateApprovalBinding(request, actionExpansion, options), /scope\.actions/);
  const issueMutation = structuredClone(request);
  issueMutation.issue.bodySnapshot.digest = `sha256:${'f'.repeat(64)}`;
  issueMutation.requestDigest = digest({ ...issueMutation, requestDigest: undefined });
  assert.throws(() => validateApprovalBinding(issueMutation, approval, options), /forged or stale|artifact digest|request/);
  const routeMutation = structuredClone(request);
  routeMutation.routeDigests[0].digest = `sha256:${'e'.repeat(64)}`;
  assert.throws(() => validateApprovalBinding(routeMutation, approval, options), /forged or stale/);
  const ledgerMutation = structuredClone(options);
  ledgerMutation.artifacts.ledger.value.claims[0].anchors[0].digest = `sha256:${'d'.repeat(64)}`;
  assert.throws(() => validateApprovalBinding(request, approval, ledgerMutation), /sourceClaimsDigest|ledger|digest/);
  assert.throws(
    () => validateApprovalBinding(request, approval, { ...options, now: '2026-08-05T00:00:00.000Z' }),
    /stale/,
  );
  assert.throws(
    () => validateApprovalBinding(request, approval, { ...options, usedNonces: new Set([approval.nonce]) }),
    /replay/,
  );
});

test('coverage V1 verifies physical issue, source, and exact docs base without creating public content', async () => {
  let workspace = await coverageWorkspace();
  let evidence = await runCoverageGap(workspace);
  let approval = durableApproval(evidence.request);
  let approvalDir = join(workspace.docsRoot, 'docs-approvals');
  await mkdir(approvalDir);
  let approvalPath = join(approvalDir, `${evidence.request.source.tag}-${approval.nonce}.json`);
  let changesPath = join(temporary, 'coverage-changes.json');
  await writeFile(approvalPath, stableJson(approval));
  await writeFile(changesPath, stableJson([]));
  const v1Args = {
    '--mode': 'v1',
    '--repo-root': workspace.docsRoot,
    '--source-root': workspace.sourceRoot,
    '--issue-body': workspace.issueBodyPath,
    '--request': join(evidence.outputDir, 'coverage-approval-request.json'),
    '--ledger': join(evidence.outputDir, 'coverage-source-ledger.json'),
    '--impact-map': join(evidence.outputDir, 'coverage-impact-map.json'),
    '--approval': approvalPath,
    '--changes': changesPath,
    '--source-repository': evidence.request.source.repository,
    '--docs-repository': evidence.request.docs.repository,
    '--docs-base-sha': evidence.request.docs.baseSha,
    '--target-branch': 'dev',
    '--now': approvalNow,
  };
  assert.equal((await runCheck(v1Args)).status, 'approved');
  await writeFile(workspace.issueBodyPath, 'mutated after V0\n');
  await assert.rejects(() => runCheck(v1Args), /issue body snapshot path or digest mismatch/);

  workspace = await coverageWorkspace();
  evidence = await runCoverageGap(workspace);
  approval = durableApproval(evidence.request);
  approvalDir = join(workspace.docsRoot, 'docs-approvals');
  await mkdir(approvalDir);
  approvalPath = join(approvalDir, `${evidence.request.source.tag}-${approval.nonce}.json`);
  changesPath = join(temporary, 'coverage-changes-after-base.json');
  await writeFile(approvalPath, stableJson(approval));
  await writeFile(changesPath, stableJson([]));
  const coveredPath = 'content/docs/beta/guides/coverage-covered.en.mdx';
  await writeFile(join(workspace.docsRoot, coveredPath), 'changed base route\n');
  await writeFile(changesPath, stableJson([{ status: 'M', path: coveredPath }]));
  const mutatedArgs = {
    ...v1Args,
    '--repo-root': workspace.docsRoot,
    '--source-root': workspace.sourceRoot,
    '--issue-body': workspace.issueBodyPath,
    '--request': join(evidence.outputDir, 'coverage-approval-request.json'),
    '--ledger': join(evidence.outputDir, 'coverage-source-ledger.json'),
    '--impact-map': join(evidence.outputDir, 'coverage-impact-map.json'),
    '--approval': approvalPath,
    '--changes': changesPath,
    '--docs-base-sha': evidence.request.docs.baseSha,
  };
  await assert.rejects(() => runCheck(mutatedArgs), /not bound by approval/);
  await execFileAsync('git', ['add', 'content/docs/beta/guides/coverage-covered.en.mdx'], { cwd: workspace.docsRoot });
  await execFileAsync('git', ['commit', '-m', 'mutate route'], {
    cwd: workspace.docsRoot,
    env: { ...process.env, GIT_AUTHOR_DATE: '2026-08-04T01:00:00Z', GIT_COMMITTER_DATE: '2026-08-04T01:00:00Z' },
  });
  await assert.rejects(() => runCheck(mutatedArgs), /does not match V1 docs base SHA/);
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
  assert.match(
    v1WriteViolations([{ status: 'M', path: grokOwnerPaths[0] }], grokOwnerPaths)[0],
    /requires paired path/,
  );
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

test('orchestrator CLI binds V1 approval to the actual Git diff and base HEAD', async () => {
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
  const unapprovedPath = 'content/docs/beta/troubleshooting/configuration.en.mdx';
  const docsBaseSha = await initializeDocsRepo(temporary, request.paths, [unapprovedPath]);
  const approval = durableApproval(request, { docsBaseSha });
  const approvalDir = join(temporary, 'docs-approvals');
  await mkdir(approvalDir);
  const approvalPath = join(approvalDir, `${request.source.to.ref}-${approval.nonce}.json`);
  const changesPath = join(temporary, 'changes.json');
  await writeFile(approvalPath, stableJson(approval));
  await modifyDocsPaths(temporary, request.paths);
  await writeFile(changesPath, stableJson(request.paths.map((path) => ({ status: 'M', path }))));
  const v1Args = {
    '--mode': 'v1',
    '--repo-root': temporary,
    '--request': requestPath,
    '--ledger': ledgerPath,
    '--impact-map': impactMapPath,
    '--approval': approvalPath,
    '--changes': changesPath,
    '--source-repository': expectedApprovalContext.sourceRepository,
    '--docs-repository': expectedApprovalContext.docsRepository,
    '--docs-base-sha': docsBaseSha,
    '--target-branch': expectedApprovalContext.targetBranch,
    '--now': approvalNow,
  };
  const v1 = await runCheck(v1Args);
  assert.equal(v1.status, 'approved');
  assert.equal(v1.requestDigest, request.requestDigest);

  await writeFile(join(temporary, unapprovedPath), 'unapproved mutation\n');
  await assert.rejects(() => runCheck(v1Args), /does not match the current Git diff/);
  await writeFile(join(temporary, unapprovedPath), `before ${unapprovedPath}\n`);
  await execFileAsync('git', ['add', '--all'], { cwd: temporary });
  await execFileAsync('git', ['commit', '-m', 'advance docs head'], {
    cwd: temporary,
    env: { ...process.env, GIT_AUTHOR_DATE: '2026-08-04T01:00:00Z', GIT_COMMITTER_DATE: '2026-08-04T01:00:00Z' },
  });
  await assert.rejects(() => runCheck(v1Args), /does not match V1 docs base SHA/);

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

test('manual-owner CLI creates only the exact local record and V1 requires explicit manual mode', async () => {
  const { ledger, impactMap, request } = await ownerDirectedEvidence();
  const unapprovedPath = 'content/docs/beta/troubleshooting/configuration.en.mdx';
  const docsBaseSha = await initializeDocsRepo(temporary, request.paths, [unapprovedPath]);
  const written = await writeV0Reports({
    ledger,
    impactMap,
    outputRoot,
    target: request.target,
    ownerPaths: request.ownerDirectedPaths,
  });
  const requestPath = join(written.outputDir, 'approval-request.json');
  const ledgerPath = join(written.outputDir, 'source-ledger.json');
  const impactMapPath = join(written.outputDir, 'docs-impact-map.json');
  const statement = manualOwnerApprovalStatement(request.requestId);
  const createArgs = [
    join(repoRoot, 'scripts', 'docs-release-manual-approval.mjs'),
    '--mode', 'create',
    '--repo-root', temporary,
    '--request', requestPath,
    '--ledger', ledgerPath,
    '--impact-map', impactMapPath,
    '--request-id', request.requestId,
    '--owner-label', 'Release owner: Thieu Nguyen',
    '--approval-statement', statement,
    '--issued-at', manualIssuedAt,
    '--expires-at', manualExpiresAt,
    '--nonce', manualNonce,
    '--now', approvalNow,
  ];
  const first = JSON.parse((await execFileAsync(process.execPath, createArgs)).stdout);
  const approvalPath = join(written.outputDir, 'manual-owner-approval.json');
  assert.equal(first.mode, 'create');
  assert.equal(first.approvalMode, 'manual-owner');
  assert.equal(first.path, `plans/releases/${request.target}/manual-owner-approval.json`);
  assert.equal(first.requestId, request.requestId);
  const createdApproval = await json(approvalPath);
  assert.equal(createdApproval.docsBaseSha, docsBaseSha);
  assert.equal(await readFile(approvalPath, 'utf8'), stableJson(createdApproval));
  const before = await readFile(approvalPath);
  await execFileAsync(process.execPath, createArgs);
  assert.deepEqual(await readFile(approvalPath), before);
  await assert.rejects(
    () => execFileAsync(process.execPath, createArgs.map((value) => (
      value === request.requestId ? 'REQ-FFFFFFFFFFFFFFFF' : value
    ))),
    /request ID does not match/,
  );

  const changesPath = join(temporary, 'manual-owner-changes.json');
  await modifyDocsPaths(temporary, request.paths);
  await writeFile(changesPath, stableJson(request.paths.map((path) => ({ status: 'M', path }))));
  const usedNoncesPath = join(temporary, 'used-nonces.json');
  await writeFile(usedNoncesPath, stableJson({ nonces: [] }));
  const v1Args = {
    '--mode': 'v1',
    '--repo-root': temporary,
    '--request': requestPath,
    '--ledger': ledgerPath,
    '--impact-map': impactMapPath,
    '--approval': approvalPath,
    '--changes': changesPath,
    '--source-repository': expectedApprovalContext.sourceRepository,
    '--docs-repository': expectedApprovalContext.docsRepository,
    '--docs-base-sha': docsBaseSha,
    '--target-branch': expectedApprovalContext.targetBranch,
    '--now': approvalNow,
    '--used-nonces': usedNoncesPath,
  };
  await assert.rejects(
    () => runManualApproval({ ...v1Args, '--used-nonces': undefined }),
    /missing required argument --used-nonces/,
  );
  const approved = await runManualApproval(v1Args);
  assert.equal(approved.status, 'approved');
  assert.equal(approved.approvalMode, 'manual-owner');
  await writeFile(join(temporary, unapprovedPath), 'unapproved mutation\n');
  await assert.rejects(
    () => runManualApproval(v1Args),
    /does not match the current Git diff/,
  );
  await writeFile(join(temporary, unapprovedPath), `before ${unapprovedPath}\n`);
  await assert.rejects(
    () => runCheck(v1Args),
    /durable approval schema/,
  );

  await writeFile(usedNoncesPath, stableJson({ nonces: [manualNonce] }));
  await assert.rejects(
    () => runManualApproval({ ...v1Args, '--used-nonces': usedNoncesPath }),
    /replay/,
  );

  const wrongDir = join(temporary, 'docs-approvals');
  await mkdir(wrongDir);
  const wrongPath = join(wrongDir, 'manual-owner-approval.json');
  await writeFile(wrongPath, before);
  await writeFile(usedNoncesPath, stableJson({ nonces: [] }));
  await assert.rejects(
    () => runManualApproval({ ...v1Args, '--approval': wrongPath }),
    /manual-owner approval must be read from plans\/releases/,
  );

  await rm(approvalPath);
  const outsideApproval = join(temporary, 'outside-manual-owner-approval.json');
  await writeFile(outsideApproval, before);
  await symlink(outsideApproval, approvalPath);
  await assert.rejects(
    () => execFileAsync(process.execPath, createArgs),
    /symlink output path rejected/,
  );
});

test('public CLI prints help', async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    join(repoRoot, 'scripts', 'check-docs-release-update.mjs'),
    '--help',
  ]);
  assert.match(stdout, /Usage:/);
  assert.match(stdout, /--mode v0/);
  assert.match(stdout, /coverage-gap/);
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

test('public coverage-gap CLI emits only versioned temporary evidence', async () => {
  const workspace = await coverageWorkspace();
  const { stdout } = await execFileAsync(process.execPath, [
    join(repoRoot, 'scripts', 'check-docs-release-update.mjs'),
    '--mode', 'coverage-gap',
    '--audit-source', workspace.auditSourcePath,
    '--source-root', workspace.sourceRoot,
    '--repo-root', workspace.docsRoot,
    '--output-root', workspace.outputRoot,
    '--target', 'coverage-audit',
  ]);
  const result = JSON.parse(stdout);
  assert.equal(result.mode, 'coverage-gap');
  assert.equal(result.status, 'approval-required');
  assert.ok(result.files.includes('coverage-source-ledger.json'));
  assert.ok(result.files.includes('coverage-approval-request.json'));
});
