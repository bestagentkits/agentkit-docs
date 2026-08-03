import { compareText, digest, sortedUnique, stableJson, withoutKey } from './docs-release-normalize.mjs';
import { isHumanOwnedBetaFile, normalizeRepoPath, validateTargetName } from './docs-release-paths.mjs';
import { ReleaseSchemaError, validateImmutableRef } from './docs-release-schema.mjs';

export const COVERAGE_SOURCE_SCHEMA = 'ak.docs.coverage-gap-source/v1';
export const COVERAGE_LEDGER_SCHEMA = 'ak.docs.coverage-gap-ledger/v1';
export const COVERAGE_IMPACT_SCHEMA = 'ak.docs.coverage-gap-impact-map/v1';
export const COVERAGE_REQUEST_SCHEMA = 'ak.docs.coverage-gap-approval-request/v1';
export const COVERAGE_AUDIT = Object.freeze({ kind: 'coverage-gap', version: 1 });

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const FULL_SHA = /^[0-9a-f]{40}$/;
const CLAIM_ID = /^CLM-[0-9A-F]{16}$/;
const SOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ASSERTIONS = ['covered', 'partial', 'missing'];

function fail(message) {
  throw new ReleaseSchemaError(message);
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}

function exact(value, allowed, label) {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length) fail(`${label} has unsupported fields: ${extras.sort().join(', ')}`);
}

function string(value, label, pattern) {
  if (typeof value !== 'string' || !value.length || (pattern && !pattern.test(value))) fail(`${label} is invalid`);
  return value;
}

function array(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  return value;
}

function equal(left, right) {
  return stableJson(left) === stableJson(right);
}

function validateAudit(audit, label = 'audit') {
  object(audit, label);
  exact(audit, ['kind', 'version', 'target'], label);
  if (audit.kind !== COVERAGE_AUDIT.kind || audit.version !== COVERAGE_AUDIT.version) fail(`${label} kind/version is unsupported`);
  validateTargetName(audit.target);
  return audit;
}

function validateSource(source, label = 'source') {
  object(source, label);
  exact(source, ['repository', 'tag', 'sha', 'provenance'], label);
  string(source.repository, `${label}.repository`, REPOSITORY);
  validateImmutableRef(source.tag, source.sha, `${label}.tag`);
  if (!['checkout', 'descriptor'].includes(source.provenance)) fail(`${label}.provenance is invalid`);
  return source;
}

function validateDocs(docs, label = 'docs') {
  object(docs, label);
  exact(docs, ['repository', 'baseSha', 'targetBranch'], label);
  string(docs.repository, `${label}.repository`, REPOSITORY);
  string(docs.baseSha, `${label}.baseSha`, FULL_SHA);
  if (docs.targetBranch !== 'dev') fail(`${label}.targetBranch must be dev`);
  return docs;
}

function validateIssue(issue, label = 'issue') {
  object(issue, label);
  exact(issue, ['repository', 'number', 'url', 'bodySnapshot'], label);
  string(issue.repository, `${label}.repository`, REPOSITORY);
  if (!Number.isInteger(issue.number) || issue.number < 1) fail(`${label}.number is invalid`);
  if (issue.url !== `https://github.com/${issue.repository}/issues/${issue.number}`) fail(`${label}.url does not match repository and number`);
  object(issue.bodySnapshot, `${label}.bodySnapshot`);
  exact(issue.bodySnapshot, ['path', 'digest'], `${label}.bodySnapshot`);
  normalizeRepoPath(string(issue.bodySnapshot.path, `${label}.bodySnapshot.path`));
  string(issue.bodySnapshot.digest, `${label}.bodySnapshot.digest`, DIGEST);
  return issue;
}

function validateLineAnchor(anchor, label, withPath = true) {
  object(anchor, label);
  exact(anchor, withPath ? ['path', 'digest', 'lineStart', 'lineEnd', 'type'] : ['digest', 'lineStart', 'lineEnd'], label);
  if (withPath) {
    normalizeRepoPath(string(anchor.path, `${label}.path`));
    if (!['source', 'test'].includes(anchor.type)) fail(`${label}.type is invalid`);
  }
  string(anchor.digest, `${label}.digest`, DIGEST);
  if (!Number.isInteger(anchor.lineStart) || anchor.lineStart < 1) fail(`${label}.lineStart is invalid`);
  if (!Number.isInteger(anchor.lineEnd) || anchor.lineEnd < anchor.lineStart) fail(`${label}.lineEnd is invalid`);
  return anchor;
}

function validateRoute(route, label) {
  object(route, label);
  exact(route, ['path', 'assertion', 'routeDigest', 'anchors'], label);
  const path = normalizeRepoPath(string(route.path, `${label}.path`));
  if (!isHumanOwnedBetaFile(path) || !/\.(?:en|vi)\.mdx$/.test(path)) fail(`${label}.path must be existing Beta prose`);
  if (!ASSERTIONS.includes(route.assertion)) fail(`${label}.assertion is invalid`);
  string(route.routeDigest, `${label}.routeDigest`, DIGEST);
  array(route.anchors, `${label}.anchors`).forEach((anchor, index) => validateLineAnchor(anchor, `${label}.anchors[${index}]`, false));
  return route;
}

function validateClaimSource(claim, label) {
  object(claim, label);
  exact(claim, ['id', 'claimType', 'statement', 'statementDigest', 'anchors', 'coverage'], label);
  string(claim.id, `${label}.id`, SOURCE_ID);
  if (!['fact', 'behavior', 'safety'].includes(claim.claimType)) fail(`${label}.claimType is invalid`);
  string(claim.statement, `${label}.statement`);
  string(claim.statementDigest, `${label}.statementDigest`, DIGEST);
  if (claim.statementDigest !== digest(claim.statement)) fail(`${label}.statementDigest does not match statement`);
  array(claim.anchors, `${label}.anchors`).forEach((anchor, index) => validateLineAnchor(anchor, `${label}.anchors[${index}]`));
  const coverage = array(claim.coverage, `${label}.coverage`);
  if (!coverage.length) fail(`${label}.coverage must not be empty`);
  coverage.forEach((route, index) => validateRoute(route, `${label}.coverage[${index}]`));
  if (new Set(coverage.map((route) => route.path)).size !== coverage.length) fail(`${label}.coverage has duplicate routes`);
  return claim;
}

export function validateCoverageAuditSource(input) {
  const source = object(input, 'coverage source');
  exact(source, ['schemaVersion', 'audit', 'channel', 'capturedAt', 'source', 'docs', 'issue', 'claims'], 'coverage source');
  if (source.schemaVersion !== COVERAGE_SOURCE_SCHEMA) fail('unsupported coverage source schema');
  validateAudit(source.audit);
  if (source.channel !== 'beta') fail('coverage-gap authoring is Beta-only');
  if (Number.isNaN(Date.parse(string(source.capturedAt, 'capturedAt')))) fail('capturedAt is invalid');
  validateSource(source.source);
  validateDocs(source.docs);
  validateIssue(source.issue);
  const claims = array(source.claims, 'claims');
  if (!claims.length) fail('claims must not be empty');
  claims.forEach((claim, index) => validateClaimSource(claim, `claims[${index}]`));
  if (new Set(claims.map((claim) => claim.id)).size !== claims.length) fail('claims contain duplicate IDs');
  return source;
}

function expectedStatus(claims) {
  const actionable = claims.some((claim) => ['new', 'update'].includes(claim.classification));
  const blocked = claims.some((claim) => claim.classification === 'blocked');
  return actionable ? 'changed' : (blocked ? 'blocked' : 'no-op');
}

export function validateCoverageLedger(ledger) {
  object(ledger, 'coverage ledger');
  exact(ledger, ['schemaVersion', 'audit', 'channel', 'generatedAt', 'auditSourceDigest', 'sourceClaimsDigest', 'source', 'docs', 'issue', 'status', 'claims'], 'coverage ledger');
  if (ledger.schemaVersion !== COVERAGE_LEDGER_SCHEMA) fail('unsupported coverage ledger schema');
  validateAudit(ledger.audit);
  if (ledger.channel !== 'beta') fail('coverage ledger channel must be beta');
  if (Number.isNaN(Date.parse(string(ledger.generatedAt, 'coverage ledger.generatedAt')))) fail('coverage ledger.generatedAt is invalid');
  string(ledger.auditSourceDigest, 'coverage ledger.auditSourceDigest', DIGEST);
  string(ledger.sourceClaimsDigest, 'coverage ledger.sourceClaimsDigest', DIGEST);
  validateSource(ledger.source, 'coverage ledger.source');
  validateDocs(ledger.docs, 'coverage ledger.docs');
  validateIssue(ledger.issue, 'coverage ledger.issue');
  const claims = array(ledger.claims, 'coverage ledger.claims');
  if (new Set(claims.map((claim) => claim.id)).size !== claims.length) fail('coverage ledger has duplicate claim IDs');
  for (const [index, claim] of claims.entries()) {
    const label = `coverage ledger.claims[${index}]`;
    object(claim, label);
    exact(claim, ['id', 'sourceId', 'claimType', 'statementDigest', 'anchors', 'coverage', 'coverageStatus', 'classification', 'confidence', 'blockedReasons', 'impact'], label);
    string(claim.id, `${label}.id`, CLAIM_ID);
    string(claim.sourceId, `${label}.sourceId`, SOURCE_ID);
    if (!['fact', 'behavior', 'safety'].includes(claim.claimType)) fail(`${label}.claimType is invalid`);
    string(claim.statementDigest, `${label}.statementDigest`, DIGEST);
    array(claim.anchors, `${label}.anchors`).forEach((anchor, anchorIndex) => validateLineAnchor(anchor, `${label}.anchors[${anchorIndex}]`));
    array(claim.coverage, `${label}.coverage`).forEach((route, routeIndex) => validateRoute(route, `${label}.coverage[${routeIndex}]`));
    if (!['covered', 'partial', 'missing', 'blocked'].includes(claim.coverageStatus)) fail(`${label}.coverageStatus is invalid`);
    if (!['no-change', 'update', 'new', 'blocked'].includes(claim.classification)) fail(`${label}.classification is invalid`);
    if (!['exact', 'unresolved'].includes(claim.confidence)) fail(`${label}.confidence is invalid`);
    array(claim.blockedReasons, `${label}.blockedReasons`);
    object(claim.impact, `${label}.impact`);
    exact(claim.impact, ['classification', 'paths'], `${label}.impact`);
    if (claim.impact.classification !== claim.classification) fail(`${label}.impact classification mismatch`);
    const paths = sortedUnique(claim.coverage.map((route) => route.path));
    if (!equal(claim.impact.paths, paths)) fail(`${label}.impact paths do not match coverage routes`);
    if (claim.classification === 'blocked' && (claim.confidence !== 'unresolved' || !claim.blockedReasons.length)) fail(`${label} blocked claim lacks reasons`);
    if (claim.classification !== 'blocked' && (claim.confidence !== 'exact' || claim.blockedReasons.length)) fail(`${label} exact claim has blocked reasons`);
    const requiredReasons = [];
    if (!claim.anchors.some((anchor) => anchor.type === 'source')) requiredReasons.push('source anchor missing');
    if (['behavior', 'safety'].includes(claim.claimType) && !claim.anchors.some((anchor) => anchor.type === 'test')) requiredReasons.push('test anchor missing for behavior/safety claim');
    for (const route of claim.coverage) if (!route.anchors.length) requiredReasons.push(`${route.path}: coverage assertion has no current-route anchor`);
    const assertions = new Set(claim.coverage.map((route) => route.assertion));
    const expectedCoverage = requiredReasons.length ? 'blocked' : (assertions.has('missing') ? 'missing' : (assertions.has('partial') ? 'partial' : 'covered'));
    const expectedClassification = expectedCoverage === 'blocked' ? 'blocked' : (expectedCoverage === 'missing' ? 'new' : (expectedCoverage === 'partial' ? 'update' : 'no-change'));
    if (claim.coverageStatus !== expectedCoverage || claim.classification !== expectedClassification) fail(`${label} coverage classification is inconsistent`);
    if (!equal(claim.blockedReasons, sortedUnique(requiredReasons))) fail(`${label} blocked reasons are inconsistent`);
  }
  const claimsDigest = digest(claims.map((claim) => ({
    id: claim.sourceId,
    claimType: claim.claimType,
    statementDigest: claim.statementDigest,
    anchors: claim.anchors,
  })).sort((a, b) => compareText(a.id, b.id)));
  if (claimsDigest !== ledger.sourceClaimsDigest) fail('coverage ledger sourceClaimsDigest is forged or stale');
  if (ledger.status !== expectedStatus(claims)) fail(`coverage ledger status should be ${expectedStatus(claims)}`);
  return ledger;
}

export function validateCoverageImpactMap(map) {
  object(map, 'coverage impact map');
  exact(map, ['schemaVersion', 'audit', 'channel', 'generatedAt', 'ledgerDigest', 'docs', 'issueBodyDigest', 'status', 'pages'], 'coverage impact map');
  if (map.schemaVersion !== COVERAGE_IMPACT_SCHEMA) fail('unsupported coverage impact schema');
  validateAudit(map.audit);
  if (map.channel !== 'beta') fail('coverage impact channel must be beta');
  string(map.ledgerDigest, 'coverage impact ledgerDigest', DIGEST);
  validateDocs(map.docs, 'coverage impact docs');
  string(map.issueBodyDigest, 'coverage impact issueBodyDigest', DIGEST);
  const pages = array(map.pages, 'coverage impact pages');
  if (new Set(pages.map((page) => page.path)).size !== pages.length) fail('coverage impact has duplicate paths');
  for (const [index, page] of pages.entries()) {
    const label = `coverage impact.pages[${index}]`;
    object(page, label);
    exact(page, ['path', 'routeDigest', 'anchors', 'assertions', 'classification', 'claimIds', 'reasons'], label);
    const path = normalizeRepoPath(page.path);
    if (!isHumanOwnedBetaFile(path) || !/\.(?:en|vi)\.mdx$/.test(path)) fail(`${label}.path must be Beta prose`);
    string(page.routeDigest, `${label}.routeDigest`, DIGEST);
    array(page.anchors, `${label}.anchors`).forEach((anchor, anchorIndex) => validateLineAnchor(anchor, `${label}.anchors[${anchorIndex}]`, false));
    if (!array(page.assertions, `${label}.assertions`).every((value) => ASSERTIONS.includes(value))) fail(`${label}.assertions are invalid`);
    if (!['no-change', 'update', 'blocked'].includes(page.classification)) fail(`${label}.classification is invalid`);
    if (!array(page.claimIds, `${label}.claimIds`).every((id) => CLAIM_ID.test(id))) fail(`${label}.claimIds are invalid`);
    array(page.reasons, `${label}.reasons`);
  }
  const pageStatus = pages.some((page) => page.classification === 'update') ? 'changed' : (pages.some((page) => page.classification === 'blocked') ? 'blocked' : 'no-op');
  if (map.status !== pageStatus) fail(`coverage impact status should be ${pageStatus}`);
  return map;
}

export function isCoverageApprovalRequest(request) {
  return request?.schemaVersion === COVERAGE_REQUEST_SCHEMA;
}

export function validateCoverageApprovalRequest(request) {
  object(request, 'coverage approval request');
  exact(request, ['schemaVersion', 'requestId', 'status', 'channel', 'target', 'audit', 'source', 'docs', 'issue', 'auditSourceDigest', 'sourceClaimsDigest', 'ledgerDigest', 'impactMapDigest', 'routeDigests', 'claimIds', 'blockedClaimIds', 'paths', 'requestDigest'], 'coverage approval request');
  if (!isCoverageApprovalRequest(request)) fail('unsupported coverage approval-request schema');
  string(request.requestId, 'coverage request ID', /^REQ-[0-9A-F]{16}$/);
  if (!['approval-required', 'no-op', 'blocked'].includes(request.status)) fail('coverage request status is invalid');
  if (request.channel !== 'beta') fail('coverage request channel must be beta');
  validateTargetName(request.target);
  validateAudit(request.audit, 'coverage request.audit');
  if (request.audit.target !== request.target) fail('coverage request target does not match audit target');
  validateSource(request.source, 'coverage request.source');
  validateDocs(request.docs, 'coverage request.docs');
  validateIssue(request.issue, 'coverage request.issue');
  for (const field of ['auditSourceDigest', 'sourceClaimsDigest', 'ledgerDigest', 'impactMapDigest']) string(request[field], `coverage request.${field}`, DIGEST);
  const routes = array(request.routeDigests, 'coverage request.routeDigests');
  if (!equal(routes, [...routes].sort((a, b) => compareText(a.path, b.path)))) fail('coverage request.routeDigests must be sorted');
  if (new Set(routes.map((route) => route.path)).size !== routes.length) fail('coverage request.routeDigests has duplicate paths');
  for (const route of routes) {
    object(route, 'coverage request route digest');
    exact(route, ['path', 'digest'], 'coverage request route digest');
    if (!isHumanOwnedBetaFile(normalizeRepoPath(route.path))) fail('coverage request route is outside Beta prose');
    string(route.digest, 'coverage request route digest', DIGEST);
  }
  for (const field of ['claimIds', 'blockedClaimIds', 'paths']) {
    const values = array(request[field], `coverage request.${field}`);
    if (!equal(values, sortedUnique(values))) fail(`coverage request.${field} must be sorted and unique`);
  }
  if (![...request.claimIds, ...request.blockedClaimIds].every((id) => CLAIM_ID.test(id))) fail('coverage request claim ID is invalid');
  if (request.claimIds.some((id) => request.blockedClaimIds.includes(id))) fail('coverage request claim sets overlap');
  if (!request.paths.every((path) => isHumanOwnedBetaFile(normalizeRepoPath(path)) && /\.(?:en|vi)\.mdx$/.test(path))) fail('coverage request paths must be Beta prose');
  if (request.status === 'approval-required' && (!request.claimIds.length || !request.paths.length)) fail('coverage approval-required request has no actionable scope');
  if (request.status !== 'approval-required' && (request.claimIds.length || request.paths.length)) fail('non-actionable coverage request contains actionable scope');
  if (request.status === 'no-op' && request.blockedClaimIds.length) fail('coverage no-op request contains blocked claims');
  if (request.requestDigest !== digest(withoutKey(request, 'requestDigest'))) fail('coverage request digest is forged or stale');
  return request;
}
