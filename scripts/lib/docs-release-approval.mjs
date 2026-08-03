import {
  APPROVAL_REQUEST_SCHEMA,
  APPROVAL_SCHEMA,
  ReleaseSchemaError,
  validateImpactMap,
  validateLedger,
  validateProvenanceSummary,
} from './docs-release-schema.mjs';
import { digest, sortedUnique, stableJson, withoutKey } from './docs-release-normalize.mjs';
import { normalizeRepoPath, validateTargetName } from './docs-release-paths.mjs';

const SHA256 = /^sha256:[0-9a-f]{64}$/;
const CLAIM_ID = /^CLM-[0-9A-F]{16}$/;

function equal(left, right) {
  return stableJson(left) === stableJson(right);
}

export function createApprovalRequest({ ledger, impactMap, target }) {
  validateLedger(ledger);
  validateImpactMap(impactMap);
  if (impactMap.ledgerDigest !== digest(ledger) || impactMap.channel !== ledger.channel) {
    throw new ReleaseSchemaError('impact map is not bound to this ledger');
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

export function validateApprovalRequest(request) {
  if (!request || request.schemaVersion !== APPROVAL_REQUEST_SCHEMA) throw new ReleaseSchemaError('unsupported approval-request schema');
  const allowed = ['schemaVersion', 'requestId', 'status', 'channel', 'target', 'source', 'ledgerDigest', 'impactMapDigest', 'claimIds', 'blockedClaimIds', 'paths', 'requestDigest'];
  const extras = Object.keys(request).filter((key) => !allowed.includes(key));
  if (extras.length) throw new ReleaseSchemaError(`approval request has unsupported fields: ${extras.sort().join(', ')}`);
  if (!['approval-required', 'no-op', 'blocked'].includes(request.status)) throw new ReleaseSchemaError('approval request status is invalid');
  if (!['beta', 'stable'].includes(request.channel)) throw new ReleaseSchemaError('approval request channel is invalid');
  if (!/^REQ-[0-9A-F]{16}$/.test(request.requestId)) throw new ReleaseSchemaError('approval request ID is invalid');
  validateTargetName(request.target);
  validateProvenanceSummary(request.source?.from, 'approval request source.from');
  validateProvenanceSummary(request.source?.to, 'approval request source.to');
  if (!SHA256.test(request.ledgerDigest) || !SHA256.test(request.impactMapDigest)) throw new ReleaseSchemaError('approval request evidence digest is invalid');
  for (const field of ['claimIds', 'blockedClaimIds', 'paths']) {
    if (!Array.isArray(request[field])) throw new ReleaseSchemaError(`approval request ${field} must be an array`);
    if (!equal(request[field], sortedUnique(request[field]))) throw new ReleaseSchemaError(`approval request ${field} must be sorted and unique`);
  }
  if (![...request.claimIds, ...request.blockedClaimIds].every((id) => CLAIM_ID.test(id))) throw new ReleaseSchemaError('approval request claim ID is invalid');
  if (request.claimIds.some((id) => request.blockedClaimIds.includes(id))) throw new ReleaseSchemaError('approval request claim sets overlap');
  if (request.status === 'approval-required' && request.claimIds.length === 0) throw new ReleaseSchemaError('approval-required request has no actionable claims');
  if (request.status !== 'approval-required' && request.claimIds.length !== 0) throw new ReleaseSchemaError('non-actionable request contains actionable claims');
  if (request.status === 'no-op' && request.blockedClaimIds.length !== 0) throw new ReleaseSchemaError('no-op request contains blocked claims');
  if (request.requestDigest !== digest(withoutKey(request, 'requestDigest'))) throw new ReleaseSchemaError('approval request digest is forged or stale');
  for (const path of request.paths) normalizeRepoPath(path);
  return request;
}

export function createApprovalArtifact(request, fields) {
  validateApprovalRequest(request);
  return {
    schemaVersion: APPROVAL_SCHEMA,
    requestId: request.requestId,
    requestDigest: request.requestDigest,
    source: request.source,
    ledgerDigest: request.ledgerDigest,
    impactMapDigest: request.impactMapDigest,
    claimIds: request.claimIds,
    paths: request.paths,
    approver: fields.approver,
    issueOrPr: fields.issueOrPr,
    issuedAt: fields.issuedAt,
    expiresAt: fields.expiresAt,
    nonce: fields.nonce,
  };
}

export function validateApprovalBinding(request, approval, options = {}) {
  validateApprovalRequest(request);
  if (request.status !== 'approval-required') throw new ReleaseSchemaError(`request status ${request.status} cannot authorize V1`);
  if (request.channel !== 'beta') throw new ReleaseSchemaError('V1 authoring is Beta-only');
  if (!approval || approval.schemaVersion !== APPROVAL_SCHEMA) throw new ReleaseSchemaError('unsupported approval schema');
  const allowed = ['schemaVersion', 'requestId', 'requestDigest', 'source', 'ledgerDigest', 'impactMapDigest', 'claimIds', 'paths', 'approver', 'issueOrPr', 'issuedAt', 'expiresAt', 'nonce'];
  const extras = Object.keys(approval).filter((key) => !allowed.includes(key));
  if (extras.length) throw new ReleaseSchemaError(`approval has unsupported fields: ${extras.sort().join(', ')}`);
  const boundFields = ['requestId', 'requestDigest', 'source', 'ledgerDigest', 'impactMapDigest', 'claimIds', 'paths'];
  for (const field of boundFields) {
    if (!equal(approval[field], request[field])) throw new ReleaseSchemaError(`approval ${field} does not match request`);
  }
  if (typeof approval.approver !== 'string' || approval.approver.trim().length < 3) throw new ReleaseSchemaError('approval approver is required');
  if (typeof approval.issueOrPr !== 'string' || approval.issueOrPr.trim().length < 2) throw new ReleaseSchemaError('approval issueOrPr is required');
  if (typeof approval.nonce !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(approval.nonce)) throw new ReleaseSchemaError('approval nonce is invalid');
  const issuedAt = Date.parse(approval.issuedAt);
  const expiresAt = Date.parse(approval.expiresAt);
  const now = Date.parse(options.now ?? new Date().toISOString());
  if ([issuedAt, expiresAt, now].some(Number.isNaN) || issuedAt >= expiresAt) throw new ReleaseSchemaError('approval validity window is invalid');
  if (now < issuedAt || now >= expiresAt) throw new ReleaseSchemaError('approval is stale or not yet valid');
  if (options.usedNonces?.has(approval.nonce)) throw new ReleaseSchemaError('approval nonce was already used (replay rejected)');
  return approval;
}
