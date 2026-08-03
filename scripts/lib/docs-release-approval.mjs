import {
  APPROVAL_REQUEST_SCHEMA,
  ReleaseSchemaError,
  validateImpactMap,
  validateLedger,
  validateProvenanceSummary,
} from './docs-release-schema.mjs';
import {
  isCoverageApprovalRequest,
  validateCoverageApprovalRequest,
  validateCoverageImpactMap,
  validateCoverageLedger,
} from './docs-release-coverage-schema.mjs';
import { digest, sortedUnique, stableJson, withoutKey } from './docs-release-normalize.mjs';
import { isHumanOwnedBetaFile, normalizeRepoPath, validateTargetName } from './docs-release-paths.mjs';
import { validateManifest } from './manifest.mjs';

const PREFIXED_SHA256 = /^sha256:[0-9a-f]{64}$/;
const RAW_SHA256 = /^[0-9a-f]{64}$/;
const CLAIM_ID = /^CLM-[0-9A-F]{16}$/;
const FULL_SHA = /^[0-9a-f]{40}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const APPROVAL_ID = /^docs-approval\/v1\/([A-Za-z0-9._-]+)\/([0-9a-f-]{36})$/;
const MAX_APPROVAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function equal(left, right) {
  return stableJson(left) === stableJson(right);
}

function fail(message) {
  throw new ReleaseSchemaError(message);
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}

function exactKeys(value, allowed, label) {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length) fail(`${label} has unsupported fields: ${extras.sort().join(', ')}`);
}

function string(value, label, pattern) {
  if (typeof value !== 'string' || !value.length || (pattern && !pattern.test(value))) fail(`${label} is invalid`);
  return value;
}

function rawDigest(value, label) {
  string(value, label, PREFIXED_SHA256);
  return value.slice('sha256:'.length);
}

function validateEvidencePath(path, label) {
  const normalized = normalizeRepoPath(path);
  if (
    normalized.startsWith('content/docs/stable/')
    || normalized.startsWith('.github/')
    || normalized.startsWith('docs-approvals/')
    || normalized.split('/').includes('reference-derived')
    || normalized.split('/').includes('.generated')
  ) fail(`${label} is outside the allowed evidence path scope`);
  return normalized;
}

function validateArtifact(artifact, label, requestId) {
  object(artifact, label);
  const allowed = requestId ? ['requestId', 'path', 'sha256'] : ['path', 'sha256'];
  exactKeys(artifact, allowed, label);
  if (requestId) string(artifact.requestId, `${label}.requestId`, /^REQ-[0-9A-F]{16}$/);
  validateEvidencePath(string(artifact.path, `${label}.path`), `${label}.path`);
  string(artifact.sha256, `${label}.sha256`, RAW_SHA256);
  return artifact;
}

function validateGitHubRecord(record, label, docsRepository, kind) {
  object(record, label);
  exactKeys(record, ['repository', 'number', 'url'], label);
  if (record.repository !== docsRepository) fail(`${label}.repository must match subject.docsRepository`);
  if (!Number.isInteger(record.number) || record.number < 1) fail(`${label}.number is invalid`);
  const expected = `https://github.com/${record.repository}/${kind}/${record.number}`;
  if (record.url !== expected) fail(`${label}.url does not match repository and number`);
}

function expectedOption(options, key, pattern) {
  return string(options[key], `expected ${key}`, pattern);
}

function validateSuppliedArtifact(expected, supplied, expectedDigest, label) {
  object(supplied, `supplied ${label}`);
  exactKeys(supplied, ['path', 'sha256', 'value'], `supplied ${label}`);
  if (supplied.path !== expected.path) fail(`${label} artifact path does not match supplied file`);
  if (supplied.sha256 !== expected.sha256) fail(`${label} artifact digest does not match supplied file`);
  if (expected.sha256 !== expectedDigest) fail(`${label} digest does not match the V0 request`);
}

export function createApprovalRequest({ ledger, impactMap, target }) {
  validateLedger(ledger);
  validateImpactMap(impactMap);
  if (impactMap.ledgerDigest !== digest(ledger) || impactMap.channel !== ledger.channel) {
    fail('impact map is not bound to this ledger');
  }
  const actionableClaims = ledger.claims.filter((claim) => !['no-change', 'blocked'].includes(claim.classification));
  const blockedClaimIds = ledger.claims.filter((claim) => claim.classification === 'blocked').map((claim) => claim.id);
  const paths = impactMap.pages
    .filter((page) => !['no-change', 'blocked'].includes(page.classification) && page.path)
    .map((page) => page.path);
  const status = actionableClaims.length === 0
    ? (blockedClaimIds.length ? 'blocked' : 'no-op')
    : 'approval-required';
  const base = {
    schemaVersion: APPROVAL_REQUEST_SCHEMA,
    requestId: `REQ-${digest({ target, ledger: digest(ledger), impactMap: digest(impactMap) }).slice(7, 23).toUpperCase()}`,
    status,
    channel: ledger.channel,
    target,
    source: { from: ledger.from, to: ledger.to },
    ledgerDigest: digest(ledger),
    impactMapDigest: digest(impactMap),
    claimIds: actionableClaims.map((claim) => claim.id).sort(),
    blockedClaimIds: blockedClaimIds.sort(),
    paths: sortedUnique(paths),
  };
  return { ...base, requestDigest: digest(base) };
}

function validateReleaseApprovalRequest(request) {
  if (!request || request.schemaVersion !== APPROVAL_REQUEST_SCHEMA) fail('unsupported approval-request schema');
  const allowed = ['schemaVersion', 'requestId', 'status', 'channel', 'target', 'source', 'ledgerDigest', 'impactMapDigest', 'claimIds', 'blockedClaimIds', 'paths', 'requestDigest'];
  exactKeys(request, allowed, 'approval request');
  if (!['approval-required', 'no-op', 'blocked'].includes(request.status)) fail('approval request status is invalid');
  if (!['beta', 'stable'].includes(request.channel)) fail('approval request channel is invalid');
  string(request.requestId, 'approval request ID', /^REQ-[0-9A-F]{16}$/);
  validateTargetName(request.target);
  validateProvenanceSummary(request.source?.from, 'approval request source.from');
  validateProvenanceSummary(request.source?.to, 'approval request source.to');
  if (!PREFIXED_SHA256.test(request.ledgerDigest) || !PREFIXED_SHA256.test(request.impactMapDigest)) fail('approval request evidence digest is invalid');
  for (const field of ['claimIds', 'blockedClaimIds', 'paths']) {
    if (!Array.isArray(request[field])) fail(`approval request ${field} must be an array`);
    if (!equal(request[field], sortedUnique(request[field]))) fail(`approval request ${field} must be sorted and unique`);
  }
  if (![...request.claimIds, ...request.blockedClaimIds].every((id) => CLAIM_ID.test(id))) fail('approval request claim ID is invalid');
  if (request.claimIds.some((id) => request.blockedClaimIds.includes(id))) fail('approval request claim sets overlap');
  if (request.status === 'approval-required' && request.claimIds.length === 0) fail('approval-required request has no actionable claims');
  if (request.status !== 'approval-required' && request.claimIds.length !== 0) fail('non-actionable request contains actionable claims');
  if (request.status === 'no-op' && request.blockedClaimIds.length !== 0) fail('no-op request contains blocked claims');
  if (request.requestDigest !== digest(withoutKey(request, 'requestDigest'))) fail('approval request digest is forged or stale');
  for (const path of request.paths) normalizeRepoPath(path);
  return request;
}

export function validateApprovalRequest(request) {
  return isCoverageApprovalRequest(request)
    ? validateCoverageApprovalRequest(request)
    : validateReleaseApprovalRequest(request);
}

export function validateDurableApprovalRecord(approval, options = {}) {
  object(approval, 'durable approval');
  if (approval.schemaVersion !== 1) fail('unsupported durable approval schema');
  exactKeys(approval, ['schemaVersion', 'approvalId', 'subject', 'evidence', 'claimIds', 'scope', 'approver', 'tracking', 'issuedAt', 'expiresAt', 'nonce'], 'durable approval');

  const id = string(approval.approvalId, 'approvalId', APPROVAL_ID).match(APPROVAL_ID);
  string(approval.nonce, 'nonce', UUID_V4);
  if (id[2] !== approval.nonce) fail('approvalId nonce does not match nonce');

  const subject = object(approval.subject, 'subject');
  exactKeys(subject, ['channel', 'sourceRepository', 'sourceTag', 'sourceSha', 'docsRepository', 'docsBaseSha', 'targetBranch'], 'subject');
  if (!['beta', 'stable'].includes(subject.channel)) fail('subject.channel is invalid');
  string(subject.sourceRepository, 'subject.sourceRepository', REPOSITORY);
  string(subject.sourceTag, 'subject.sourceTag', /^v\d+\.\d+\.\d+(?:-beta\.\d+)?$/);
  string(subject.sourceSha, 'subject.sourceSha', FULL_SHA);
  string(subject.docsRepository, 'subject.docsRepository', REPOSITORY);
  string(subject.docsBaseSha, 'subject.docsBaseSha', FULL_SHA);
  if (subject.targetBranch !== 'dev') fail('subject.targetBranch must be dev');
  if (id[1] !== subject.sourceTag) fail('approvalId tag does not match subject.sourceTag');

  const evidence = object(approval.evidence, 'evidence');
  exactKeys(evidence, ['request', 'ledger', 'manifest', 'impactMap'], 'evidence');
  for (const required of ['request', 'ledger', 'impactMap']) {
    if (!evidence[required]) fail(`evidence.${required} is required`);
  }
  validateArtifact(evidence.request, 'evidence.request', true);
  validateArtifact(evidence.ledger, 'evidence.ledger');
  validateArtifact(evidence.impactMap, 'evidence.impactMap');
  if (evidence.manifest !== undefined) validateArtifact(evidence.manifest, 'evidence.manifest');

  if (!Array.isArray(approval.claimIds) || !approval.claimIds.length || !equal(approval.claimIds, sortedUnique(approval.claimIds))) fail('claimIds must be non-empty, sorted, and unique');
  if (!approval.claimIds.every((claim) => CLAIM_ID.test(claim))) fail('claimIds contain an invalid claim ID');

  const scope = object(approval.scope, 'scope');
  exactKeys(scope, ['paths', 'actions'], 'scope');
  if (!Array.isArray(scope.paths) || !scope.paths.length || !equal(scope.paths, sortedUnique(scope.paths))) fail('scope.paths must be non-empty, sorted, and unique');
  for (const path of scope.paths) validateEvidencePath(path, 'scope path');
  if (!equal(scope.actions, ['modify'])) fail('scope.actions must be exactly ["modify"]');

  const approver = object(approval.approver, 'approver');
  exactKeys(approver, ['login', 'kind'], 'approver');
  string(approver.login, 'approver.login', LOGIN);
  if (!['User', 'Team'].includes(approver.kind)) fail('approver.kind is invalid');

  const tracking = object(approval.tracking, 'tracking');
  exactKeys(tracking, ['issue', 'approvalPullRequest'], 'tracking');
  validateGitHubRecord(tracking.issue, 'tracking.issue', subject.docsRepository, 'issues');
  validateGitHubRecord(tracking.approvalPullRequest, 'tracking.approvalPullRequest', subject.docsRepository, 'pull');

  const issuedAt = Date.parse(approval.issuedAt);
  const expiresAt = Date.parse(approval.expiresAt);
  const now = Date.parse(options.now ?? new Date().toISOString());
  if ([issuedAt, expiresAt, now].some(Number.isNaN) || issuedAt >= expiresAt) fail('approval validity window is invalid');
  if (expiresAt - issuedAt > MAX_APPROVAL_WINDOW_MS) fail('approval validity window exceeds seven days');
  if (now < issuedAt || now >= expiresAt) fail('approval is stale or not yet valid');
  if (options.usedNonces?.has(approval.nonce)) fail('approval nonce was already used (replay rejected)');
  return approval;
}

export function validateApprovalBinding(request, approval, options = {}) {
  validateApprovalRequest(request);
  validateDurableApprovalRecord(approval, options);
  const coverageGap = isCoverageApprovalRequest(request);
  if (request.status !== 'approval-required') fail(`request status ${request.status} cannot authorize V1`);
  if (request.channel !== 'beta' || approval.subject.channel !== 'beta') fail('V1 authoring is Beta-only');
  if (approval.subject.targetBranch !== 'dev') fail('V1 authoring targets dev only');

  const sourceRepository = expectedOption(options, 'sourceRepository', REPOSITORY);
  const docsRepository = expectedOption(options, 'docsRepository', REPOSITORY);
  const docsBaseSha = expectedOption(options, 'docsBaseSha', FULL_SHA);
  const targetBranch = expectedOption(options, 'targetBranch');
  if (targetBranch !== 'dev') fail('expected targetBranch must be dev');

  const subject = approval.subject;
  if (subject.sourceRepository !== sourceRepository) fail('approval source repository does not match expected source repository');
  if (subject.docsRepository !== docsRepository) fail('approval docs repository does not match expected docs repository');
  if (subject.docsBaseSha !== docsBaseSha) fail('approval docs base SHA does not match expected docs base SHA');
  if (subject.targetBranch !== targetBranch) fail('approval target branch does not match expected target branch');
  if (subject.channel !== request.channel) fail('approval channel does not match request');
  const requestSource = coverageGap
    ? { repository: request.source.repository, tag: request.source.tag, sha: request.source.sha }
    : { repository: sourceRepository, tag: request.source.to.ref, sha: request.source.to.resolvedCommit };
  if (requestSource.repository !== sourceRepository) fail('request source repository does not match expected source repository');
  if (subject.sourceTag !== requestSource.tag || subject.sourceSha !== requestSource.sha) fail('approval source tag or SHA does not match request');
  if (coverageGap) {
    if (request.docs.repository !== docsRepository || request.docs.baseSha !== docsBaseSha || request.docs.targetBranch !== targetBranch) fail('coverage request docs subject does not match expected docs context');
    if (!equal(approval.tracking.issue, {
      repository: request.issue.repository,
      number: request.issue.number,
      url: request.issue.url,
    })) fail('approval tracking issue does not match coverage request issue snapshot');
  }

  if (approval.evidence.request.requestId !== request.requestId) fail('approval request ID does not match request');
  if (!equal(approval.claimIds, request.claimIds)) fail('approval claim IDs do not match request');
  if (!equal(approval.scope.paths, request.paths)) fail('approval paths do not match request');
  if (!request.paths.every(isHumanOwnedBetaFile)) fail('V1 request contains a non-prose Beta path');

  const expectedPrefix = `plans/releases/${request.target}/`;
  const filenames = coverageGap
    ? [['request', 'coverage-approval-request.json'], ['ledger', 'coverage-source-ledger.json'], ['impactMap', 'coverage-impact-map.json']]
    : [['request', 'approval-request.json'], ['ledger', 'source-ledger.json'], ['impactMap', 'docs-impact-map.json']];
  for (const [kind, filename] of filenames) {
    if (approval.evidence[kind].path !== `${expectedPrefix}${filename}`) fail(`evidence.${kind}.path does not match the V0 artifact path`);
  }

  const artifacts = object(options.artifacts, 'supplied artifacts');
  exactKeys(artifacts, ['request', 'ledger', 'impactMap', 'manifest'], 'supplied artifacts');
  validateSuppliedArtifact(approval.evidence.request, artifacts.request, rawDigest(request.requestDigest, 'request.requestDigest'), 'request');
  validateSuppliedArtifact(approval.evidence.ledger, artifacts.ledger, rawDigest(request.ledgerDigest, 'request.ledgerDigest'), 'ledger');
  validateSuppliedArtifact(approval.evidence.impactMap, artifacts.impactMap, rawDigest(request.impactMapDigest, 'request.impactMapDigest'), 'impact map');
  if (!equal(artifacts.request.value, request)) fail('supplied request artifact does not match the validated request');
  if (coverageGap) {
    validateCoverageLedger(artifacts.ledger.value);
    validateCoverageImpactMap(artifacts.impactMap.value);
    const ledger = artifacts.ledger.value;
    const impact = artifacts.impactMap.value;
    for (const field of ['audit', 'source', 'docs', 'issue']) if (!equal(ledger[field], request[field])) fail(`coverage ledger ${field} does not match request`);
    if (ledger.auditSourceDigest !== request.auditSourceDigest || ledger.sourceClaimsDigest !== request.sourceClaimsDigest) fail('coverage source or claim digest does not match request');
    if (!equal(impact.audit, request.audit) || !equal(impact.docs, request.docs) || impact.issueBodyDigest !== request.issue.bodySnapshot.digest) fail('coverage impact context does not match request');
    const routes = impact.pages.map((page) => ({ path: page.path, digest: page.routeDigest }));
    if (!equal(routes, request.routeDigests)) fail('coverage route digests do not match request');
  } else {
    validateLedger(artifacts.ledger.value);
    validateImpactMap(artifacts.impactMap.value);
    if (!equal({ from: artifacts.ledger.value.from, to: artifacts.ledger.value.to }, request.source)) fail('supplied ledger source does not match the request');
  }
  if (digest(artifacts.ledger.value) !== request.ledgerDigest) fail('supplied ledger is not bound to the request');
  if (digest(artifacts.impactMap.value) !== request.impactMapDigest || artifacts.impactMap.value.ledgerDigest !== request.ledgerDigest) fail('supplied impact map is not bound to the request and ledger');

  const manifestDigest = coverageGap ? undefined : request.source.to.manifestDigest;
  if (manifestDigest) {
    if (!approval.evidence.manifest || !artifacts.manifest) fail('bundle approval requires manifest evidence and a supplied manifest');
    if (approval.evidence.manifest.path !== `${expectedPrefix}evidence/manifest.json`) fail('evidence.manifest.path does not match the V0 artifact path');
    validateSuppliedArtifact(approval.evidence.manifest, artifacts.manifest, rawDigest(manifestDigest, 'request source manifestDigest'), 'manifest');
    validateManifest(artifacts.manifest.value, { expectedChannel: request.channel });
    if (artifacts.manifest.value.tag !== subject.sourceTag || artifacts.manifest.value.sha !== subject.sourceSha) fail('supplied manifest source does not match approval subject');
  } else if (approval.evidence.manifest !== undefined || artifacts.manifest !== undefined) {
    fail('non-bundle approval must not contain manifest evidence');
  }
  return approval;
}
