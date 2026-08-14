import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  createApprovalRequest,
  validateApprovalRequest,
} from './docs-release-approval.mjs';
import {
  isCoverageApprovalRequest,
  validateCoverageImpactMap,
  validateCoverageLedger,
} from './docs-release-coverage-schema.mjs';
import { digest, sortedUnique, stableJson } from './docs-release-normalize.mjs';
import { isHumanOwnedBetaFile, normalizeRepoPath } from './docs-release-paths.mjs';
import { ReleaseSchemaError, validateImpactMap, validateLedger } from './docs-release-schema.mjs';
import { validateManifest } from './manifest.mjs';

export const MANUAL_OWNER_APPROVAL_SCHEMA = 'ak.docs.manual-owner-approval/v1';

const PREFIXED_SHA256 = /^sha256:[0-9a-f]{64}$/;
const RAW_SHA256 = /^[0-9a-f]{64}$/;
const REQUEST_ID = /^REQ-[0-9A-F]{16}$/;
const CLAIM_ID = /^CLM-[0-9A-F]{16}$/;
const FULL_SHA = /^[0-9a-f]{40}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_APPROVAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const OWNER_LABEL_MAX = 200;
const execFileAsync = promisify(execFile);

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

function equal(left, right) {
  return stableJson(left) === stableJson(right);
}

function rawDigest(value, label) {
  string(value, label, PREFIXED_SHA256);
  return value.slice('sha256:'.length);
}

function validateOwnerLabel(value) {
  string(value, 'manual-owner owner label');
  if (value !== value.trim() || value.length > OWNER_LABEL_MAX || /[\u0000-\u001f\u007f]/.test(value)) {
    fail('manual-owner owner label is invalid');
  }
  return value;
}

function validateArtifact(supplied, expectedPath, expectedDigest, label) {
  object(supplied, `supplied ${label}`);
  exactKeys(supplied, ['path', 'sha256', 'value'], `supplied ${label}`);
  if (normalizeRepoPath(supplied.path) !== expectedPath) fail(`${label} artifact path does not match the V0 request`);
  string(supplied.sha256, `${label} artifact digest`, RAW_SHA256);
  if (supplied.sha256 !== rawDigest(expectedDigest, `${label} request digest`)) {
    fail(`${label} artifact digest does not match the V0 request`);
  }
}

function validateValidityWindow(approval, nowValue) {
  const issuedAt = Date.parse(approval.issuedAt);
  const expiresAt = Date.parse(approval.expiresAt);
  const now = Date.parse(nowValue ?? new Date().toISOString());
  if ([issuedAt, expiresAt, now].some(Number.isNaN) || issuedAt >= expiresAt) {
    fail('manual-owner approval validity window is invalid');
  }
  if (expiresAt - issuedAt > MAX_APPROVAL_WINDOW_MS) {
    fail('manual-owner approval validity window exceeds seven days');
  }
  if (now < issuedAt || now >= expiresAt) fail('manual-owner approval is stale or not yet valid');
}

export function manualOwnerApprovalStatement(requestId) {
  string(requestId, 'manual-owner request ID', REQUEST_ID);
  return `approve ${requestId}`;
}

export async function resolveManualOwnerDocsBase(repoRoot, expectedSha) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }));
  } catch (error) {
    fail(`cannot resolve manual-owner docs base SHA: ${error.message}`);
  }
  const head = String(stdout).trim();
  string(head, 'manual-owner docs base SHA', FULL_SHA);
  if (expectedSha !== undefined && head !== expectedSha) {
    fail(`current docs HEAD ${head} does not match manual-owner docs base SHA ${expectedSha}`);
  }
  return head;
}

export function validateManualOwnerApprovalRecord(approval, options = {}) {
  object(approval, 'manual-owner approval');
  if (approval.schemaVersion !== MANUAL_OWNER_APPROVAL_SCHEMA) {
    fail('unsupported manual-owner approval schema');
  }
  exactKeys(approval, [
    'schemaVersion', 'approvalMode', 'request', 'docsBaseSha', 'claimIds', 'scope',
    'owner', 'approvalStatement', 'issuedAt', 'expiresAt', 'nonce',
  ], 'manual-owner approval');
  if (approval.approvalMode !== 'manual-owner') fail('manual-owner approval mode is invalid');

  const request = object(approval.request, 'manual-owner approval request');
  exactKeys(request, ['id', 'digest', 'ledgerDigest', 'impactMapDigest'], 'manual-owner approval request');
  string(request.id, 'manual-owner request ID', REQUEST_ID);
  for (const field of ['digest', 'ledgerDigest', 'impactMapDigest']) {
    string(request[field], `manual-owner request ${field}`, PREFIXED_SHA256);
  }
  string(approval.docsBaseSha, 'manual-owner docs base SHA', FULL_SHA);

  if (!Array.isArray(approval.claimIds) || !approval.claimIds.length || !equal(approval.claimIds, sortedUnique(approval.claimIds))) {
    fail('manual-owner claim IDs must be non-empty, sorted, and unique');
  }
  if (!approval.claimIds.every((claimId) => CLAIM_ID.test(claimId))) fail('manual-owner claim IDs contain an invalid ID');

  const scope = object(approval.scope, 'manual-owner scope');
  exactKeys(scope, ['paths', 'actions'], 'manual-owner scope');
  if (!Array.isArray(scope.paths) || !scope.paths.length || !equal(scope.paths, sortedUnique(scope.paths))) {
    fail('manual-owner approval paths must be non-empty, sorted, and unique');
  }
  for (const path of scope.paths) {
    normalizeRepoPath(path);
    if (!isHumanOwnedBetaFile(path)) fail('manual-owner approval paths contain a non-prose Beta path');
  }
  if (!equal(scope.actions, ['modify'])) fail('manual-owner scope actions must be exactly ["modify"]');

  const owner = object(approval.owner, 'manual-owner owner');
  exactKeys(owner, ['label'], 'manual-owner owner');
  validateOwnerLabel(owner.label);
  const expectedStatement = manualOwnerApprovalStatement(request.id);
  if (approval.approvalStatement !== expectedStatement) fail('manual-owner exact approval statement is invalid');

  string(approval.issuedAt, 'manual-owner issuedAt');
  string(approval.expiresAt, 'manual-owner expiresAt');
  string(approval.nonce, 'manual-owner nonce', UUID_V4);
  validateValidityWindow(approval, options.now);
  if (options.usedNonces?.has(approval.nonce)) fail('manual-owner approval nonce was already used (replay rejected)');
  return approval;
}

function validateBoundArtifacts(request, options) {
  const artifacts = object(options.artifacts, 'supplied artifacts');
  exactKeys(artifacts, ['request', 'ledger', 'impactMap', 'manifest'], 'supplied artifacts');
  const prefix = `plans/releases/${request.target}/`;
  const coverage = isCoverageApprovalRequest(request);
  const filenames = coverage
    ? { request: 'coverage-approval-request.json', ledger: 'coverage-source-ledger.json', impactMap: 'coverage-impact-map.json' }
    : { request: 'approval-request.json', ledger: 'source-ledger.json', impactMap: 'docs-impact-map.json' };

  validateArtifact(artifacts.request, `${prefix}${filenames.request}`, request.requestDigest, 'request');
  validateArtifact(artifacts.ledger, `${prefix}${filenames.ledger}`, request.ledgerDigest, 'ledger');
  validateArtifact(artifacts.impactMap, `${prefix}${filenames.impactMap}`, request.impactMapDigest, 'impact map');
  if (!equal(artifacts.request.value, request)) fail('supplied request artifact does not match the validated request');

  if (coverage) {
    validateCoverageLedger(artifacts.ledger.value);
    validateCoverageImpactMap(artifacts.impactMap.value);
    const ledger = artifacts.ledger.value;
    const impactMap = artifacts.impactMap.value;
    for (const field of ['audit', 'source', 'docs', 'issue']) {
      if (!equal(ledger[field], request[field])) fail(`coverage ledger ${field} does not match request`);
    }
    if (ledger.auditSourceDigest !== request.auditSourceDigest || ledger.sourceClaimsDigest !== request.sourceClaimsDigest) {
      fail('coverage source or claim digest does not match request');
    }
    if (!equal(impactMap.audit, request.audit) || !equal(impactMap.docs, request.docs) || impactMap.issueBodyDigest !== request.issue.bodySnapshot.digest) {
      fail('coverage impact context does not match request');
    }
    const routes = impactMap.pages.map((page) => ({ path: page.path, digest: page.routeDigest }));
    if (!equal(routes, request.routeDigests)) fail('coverage route digests do not match request');
  } else {
    validateLedger(artifacts.ledger.value);
    validateImpactMap(artifacts.impactMap.value);
    if (!equal({ from: artifacts.ledger.value.from, to: artifacts.ledger.value.to }, request.source)) {
      fail('supplied ledger source does not match the request');
    }
    const expectedRequest = createApprovalRequest({
      ledger: artifacts.ledger.value,
      impactMap: artifacts.impactMap.value,
      target: request.target,
      ownerPaths: request.ownerDirectedPaths ?? [],
    });
    if (!equal(expectedRequest, request)) {
      fail('approval request scope is not derived from the bound impact map and owner-directed paths');
    }
  }
  if (digest(artifacts.ledger.value) !== request.ledgerDigest) fail('supplied ledger is not bound to the request');
  if (digest(artifacts.impactMap.value) !== request.impactMapDigest || artifacts.impactMap.value.ledgerDigest !== request.ledgerDigest) {
    fail('supplied impact map is not bound to the request and ledger');
  }

  const manifestDigest = coverage ? undefined : request.source.to.manifestDigest;
  if (manifestDigest) {
    if (!artifacts.manifest) fail('bundle manual-owner approval requires a supplied manifest');
    validateArtifact(artifacts.manifest, `${prefix}evidence/manifest.json`, manifestDigest, 'manifest');
    validateManifest(artifacts.manifest.value, { expectedChannel: request.channel });
    if (artifacts.manifest.value.tag !== request.source.to.ref || artifacts.manifest.value.sha !== request.source.to.resolvedCommit) {
      fail('supplied manifest source does not match request');
    }
  } else if (artifacts.manifest !== undefined) {
    fail('non-bundle manual-owner approval must not contain manifest evidence');
  }
}

export function validateManualOwnerApprovalBinding(request, approval, options = {}) {
  validateApprovalRequest(request);
  validateManualOwnerApprovalRecord(approval, options);
  if (request.status !== 'approval-required') fail(`request status ${request.status} cannot authorize V1`);
  if (request.channel !== 'beta') fail('V1 authoring is Beta-only');
  if (!request.paths.every(isHumanOwnedBetaFile)) fail('V1 request contains a non-prose Beta path');
  string(options.docsBaseSha, 'expected docsBaseSha', FULL_SHA);
  if (options.targetBranch !== undefined && options.targetBranch !== 'dev') fail('expected targetBranch must be dev');
  if (approval.docsBaseSha !== options.docsBaseSha) fail('manual-owner docs base SHA does not match expected docs base SHA');
  if (approval.request.id !== request.requestId) fail('manual-owner request ID does not match request');
  if (approval.request.digest !== request.requestDigest) fail('manual-owner request digest does not match request');
  if (approval.request.ledgerDigest !== request.ledgerDigest) fail('manual-owner ledger digest does not match request');
  if (approval.request.impactMapDigest !== request.impactMapDigest) fail('manual-owner impact map digest does not match request');
  if (!equal(approval.claimIds, request.claimIds)) fail('manual-owner claim IDs do not match request');
  if (!equal(approval.scope.paths, request.paths)) fail('manual-owner approval paths do not match request');
  validateBoundArtifacts(request, options);
  return approval;
}

export function createManualOwnerApprovalRecord({
  request,
  requestId,
  ownerLabel,
  approvalStatement,
  docsBaseSha,
  issuedAt,
  expiresAt,
  nonce,
  artifacts,
  now,
}) {
  validateApprovalRequest(request);
  if (requestId !== request.requestId) fail('manual-owner request ID does not match the supplied request');
  const approval = {
    schemaVersion: MANUAL_OWNER_APPROVAL_SCHEMA,
    approvalMode: 'manual-owner',
    request: {
      id: request.requestId,
      digest: request.requestDigest,
      ledgerDigest: request.ledgerDigest,
      impactMapDigest: request.impactMapDigest,
    },
    docsBaseSha,
    claimIds: [...request.claimIds],
    scope: { paths: [...request.paths], actions: ['modify'] },
    owner: { label: ownerLabel },
    approvalStatement,
    issuedAt,
    expiresAt,
    nonce,
  };
  validateManualOwnerApprovalBinding(request, approval, {
    docsBaseSha,
    now,
    artifacts,
  });
  return approval;
}
