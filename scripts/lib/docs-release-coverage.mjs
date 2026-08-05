import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import {
  COVERAGE_IMPACT_SCHEMA,
  COVERAGE_LEDGER_SCHEMA,
  COVERAGE_REQUEST_SCHEMA,
  validateCoverageApprovalRequest,
  validateCoverageAuditSource,
  validateCoverageImpactMap,
  validateCoverageLedger,
} from './docs-release-coverage-schema.mjs';
import { compareText, digest, sortedUnique } from './docs-release-normalize.mjs';
import { normalizeRepoPath } from './docs-release-paths.mjs';

const execFileAsync = promisify(execFile);

async function git(root, args, options = {}) {
  const result = await execFileAsync('git', ['-C', root, ...args], options);
  return typeof result.stdout === 'string' ? result.stdout.trim() : result.stdout;
}

async function repoFile(root, path, label) {
  const realRoot = await realpath(resolve(root));
  const candidate = isAbsolute(path) ? path : resolve(realRoot, path);
  const absolute = await realpath(candidate);
  const repoPath = normalizeRepoPath(relative(realRoot, absolute));
  if (!isAbsolute(path) && repoPath !== normalizeRepoPath(path)) throw new Error(`${label} resolves outside its declared path`);
  return { absolute, repoPath, bytes: await readFile(absolute) };
}

async function containedFile(root, path, label) {
  const realRoot = await realpath(resolve(root));
  const absolute = await realpath(isAbsolute(path) ? path : resolve(realRoot, path));
  const repoPath = normalizeRepoPath(relative(realRoot, absolute));
  return { absolute, repoPath, bytes: await readFile(absolute) };
}

function lineDigest(bytes, lineStart, lineEnd, label) {
  const lines = bytes.toString('utf8').replace(/\r\n?/g, '\n').split('\n');
  if (lineEnd > lines.length || lineStart < 1) throw new Error(`${label} line range is outside the file`);
  return digest(`${lines.slice(lineStart - 1, lineEnd).join('\n')}\n`);
}

function verifyLineAnchors(bytes, anchors, label) {
  for (const [index, anchor] of anchors.entries()) {
    const actual = lineDigest(bytes, anchor.lineStart, anchor.lineEnd, `${label} anchor ${index}`);
    if (actual !== anchor.digest) throw new Error(`${label} anchor ${index} digest mismatch`);
  }
}

async function verifySourceIdentity(source, sourceRoot, requireClean = true) {
  if (source.provenance !== 'checkout') return;
  const head = await git(sourceRoot, ['rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (head !== source.sha) throw new Error(`source checkout HEAD ${head} does not match ${source.sha}`);
  const resolved = await git(sourceRoot, ['rev-parse', `${source.tag}^{commit}`], { encoding: 'utf8' });
  if (resolved !== source.sha) throw new Error(`source tag ${source.tag} does not resolve to ${source.sha}`);
  if (requireClean && await git(sourceRoot, ['status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' })) {
    throw new Error('source checkout is dirty');
  }
}

async function verifyDocsIdentity(docs, docsRoot, requireClean) {
  const head = await git(docsRoot, ['rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (head !== docs.baseSha) throw new Error(`docs checkout HEAD ${head} does not match docsBaseSha ${docs.baseSha}`);
  if (requireClean && await git(docsRoot, ['status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' })) {
    throw new Error('docs checkout is dirty');
  }
}

async function verifySourceAnchors(claims, sourceRoot) {
  const cache = new Map();
  for (const claim of claims) {
    for (const anchor of claim.anchors) {
      let file = cache.get(anchor.path);
      if (!file) {
        file = await repoFile(sourceRoot, anchor.path, `source anchor ${anchor.path}`);
        cache.set(anchor.path, file);
      }
      if (digest(file.bytes) !== anchor.digest) throw new Error(`source/test hash mismatch for ${anchor.path}`);
      lineDigest(file.bytes, anchor.lineStart, anchor.lineEnd, `source anchor ${anchor.path}`);
    }
  }
}

async function verifyWorkingRoutes(claims, docsRoot) {
  const cache = new Map();
  for (const claim of claims) {
    for (const route of claim.coverage) {
      let file = cache.get(route.path);
      if (!file) {
        file = await repoFile(docsRoot, route.path, `coverage route ${route.path}`);
        cache.set(route.path, file);
      }
      if (digest(file.bytes) !== route.routeDigest) throw new Error(`current-doc route digest mismatch for ${route.path}`);
      verifyLineAnchors(file.bytes, route.anchors, `coverage route ${route.path}`);
    }
  }
}

function blockedReasons(claim) {
  const reasons = [];
  if (!claim.anchors.some((anchor) => anchor.type === 'source')) reasons.push('source anchor missing');
  if (['behavior', 'safety'].includes(claim.claimType) && !claim.anchors.some((anchor) => anchor.type === 'test')) reasons.push('test anchor missing for behavior/safety claim');
  for (const route of claim.coverage) if (!route.anchors.length) reasons.push(`${route.path}: coverage assertion has no current-route anchor`);
  return sortedUnique(reasons);
}

function coverageState(claim, reasons) {
  if (reasons.length) return ['blocked', 'blocked'];
  const assertions = new Set(claim.coverage.map((route) => route.assertion));
  if (assertions.has('missing')) return ['missing', 'new'];
  if (assertions.has('partial')) return ['partial', 'update'];
  return ['covered', 'no-change'];
}

function createCoverageLedger(source, auditSourceDigest) {
  const claims = source.claims.map((claim) => {
    const reasons = blockedReasons(claim);
    const [coverageStatus, classification] = coverageState(claim, reasons);
    return {
      id: `CLM-${digest({ audit: source.audit, sourceId: claim.id }).slice(7, 23).toUpperCase()}`,
      sourceId: claim.id,
      claimType: claim.claimType,
      statementDigest: claim.statementDigest,
      anchors: claim.anchors,
      coverage: claim.coverage,
      coverageStatus,
      classification,
      confidence: reasons.length ? 'unresolved' : 'exact',
      blockedReasons: reasons,
      impact: { classification, paths: sortedUnique(claim.coverage.map((route) => route.path)) },
    };
  }).sort((a, b) => compareText(a.id, b.id));
  const sourceClaimsDigest = digest(source.claims.map((claim) => ({
    id: claim.id,
    claimType: claim.claimType,
    statementDigest: claim.statementDigest,
    anchors: claim.anchors,
  })).sort((a, b) => compareText(a.id, b.id)));
  const actionable = claims.some((claim) => ['new', 'update'].includes(claim.classification));
  const blocked = claims.some((claim) => claim.classification === 'blocked');
  return validateCoverageLedger({
    schemaVersion: COVERAGE_LEDGER_SCHEMA,
    audit: source.audit,
    channel: source.channel,
    generatedAt: source.capturedAt,
    auditSourceDigest,
    sourceClaimsDigest,
    source: source.source,
    docs: source.docs,
    issue: source.issue,
    status: actionable ? 'changed' : (blocked ? 'blocked' : 'no-op'),
    claims,
  });
}

function createCoverageImpactMap(ledger) {
  const grouped = new Map();
  for (const claim of ledger.claims) {
    for (const route of claim.coverage) {
      const entries = grouped.get(route.path) ?? [];
      entries.push({ claim, route });
      grouped.set(route.path, entries);
    }
  }
  const pages = [...grouped.entries()].map(([path, entries]) => {
    const actionable = entries.some(({ claim, route }) => claim.classification !== 'blocked' && ['partial', 'missing'].includes(route.assertion));
    const blocked = entries.some(({ claim }) => claim.classification === 'blocked');
    const route = entries[0].route;
    if (entries.some((entry) => entry.route.routeDigest !== route.routeDigest)) throw new Error(`${path} has conflicting route digests`);
    return {
      path,
      routeDigest: route.routeDigest,
      anchors: [...new Map(entries.flatMap((entry) => entry.route.anchors).map((anchor) => [stableAnchorKey(anchor), anchor])).values()],
      assertions: sortedUnique(entries.map((entry) => entry.route.assertion)),
      classification: actionable ? 'update' : (blocked ? 'blocked' : 'no-change'),
      claimIds: sortedUnique(entries.map((entry) => entry.claim.id)),
      reasons: sortedUnique(entries.flatMap((entry) => entry.claim.blockedReasons)),
    };
  }).sort((a, b) => compareText(a.path, b.path));
  const status = pages.some((page) => page.classification === 'update') ? 'changed' : (pages.some((page) => page.classification === 'blocked') ? 'blocked' : 'no-op');
  return validateCoverageImpactMap({
    schemaVersion: COVERAGE_IMPACT_SCHEMA,
    audit: ledger.audit,
    channel: ledger.channel,
    generatedAt: ledger.generatedAt,
    ledgerDigest: digest(ledger),
    docs: ledger.docs,
    issueBodyDigest: ledger.issue.bodySnapshot.digest,
    status,
    pages,
  });
}

function stableAnchorKey(anchor) {
  return `${anchor.lineStart}:${anchor.lineEnd}:${anchor.digest}`;
}

function createCoverageRequest(ledger, impactMap) {
  const actionable = ledger.claims.filter((claim) => ['new', 'update'].includes(claim.classification));
  const blocked = ledger.claims.filter((claim) => claim.classification === 'blocked');
  const paths = impactMap.pages.filter((page) => page.classification === 'update').map((page) => page.path);
  const status = actionable.length ? 'approval-required' : (blocked.length ? 'blocked' : 'no-op');
  const base = {
    schemaVersion: COVERAGE_REQUEST_SCHEMA,
    requestId: `REQ-${digest({ audit: ledger.audit, ledger: digest(ledger), impact: digest(impactMap) }).slice(7, 23).toUpperCase()}`,
    status,
    channel: ledger.channel,
    target: ledger.audit.target,
    audit: ledger.audit,
    source: ledger.source,
    docs: ledger.docs,
    issue: ledger.issue,
    auditSourceDigest: ledger.auditSourceDigest,
    sourceClaimsDigest: ledger.sourceClaimsDigest,
    ledgerDigest: digest(ledger),
    impactMapDigest: digest(impactMap),
    routeDigests: impactMap.pages.map((page) => ({ path: page.path, digest: page.routeDigest })),
    claimIds: actionable.map((claim) => claim.id).sort(compareText),
    blockedClaimIds: blocked.map((claim) => claim.id).sort(compareText),
    paths: paths.sort(compareText),
  };
  return validateCoverageApprovalRequest({ ...base, requestDigest: digest(base) });
}

export async function createCoverageGapAudit({ auditSourcePath, sourceRoot, docsRoot, target }) {
  const auditFile = await containedFile(docsRoot, auditSourcePath, 'coverage audit source');
  let parsed;
  try {
    parsed = JSON.parse(auditFile.bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`cannot parse coverage audit source: ${error.message}`);
  }
  const source = validateCoverageAuditSource(parsed);
  if (source.audit.target !== target) throw new Error(`coverage target ${target} does not match ${source.audit.target}`);
  await verifySourceIdentity(source.source, sourceRoot, true);
  await verifyDocsIdentity(source.docs, docsRoot, true);
  const issueFile = await repoFile(docsRoot, source.issue.bodySnapshot.path, 'issue body snapshot');
  if (digest(issueFile.bytes) !== source.issue.bodySnapshot.digest) throw new Error('issue body snapshot digest mismatch');
  await verifySourceAnchors(source.claims, sourceRoot);
  await verifyWorkingRoutes(source.claims, docsRoot);
  const ledger = createCoverageLedger(source, digest(auditFile.bytes));
  const impactMap = createCoverageImpactMap(ledger);
  const request = createCoverageRequest(ledger, impactMap);
  return { ledger, impactMap, request };
}

export async function verifyCoverageV1Physical({ request, ledger, docsRoot, sourceRoot, issueBodyPath }) {
  validateCoverageApprovalRequest(request);
  validateCoverageLedger(ledger);
  await verifySourceIdentity(request.source, sourceRoot, true);
  await verifySourceAnchors(ledger.claims, sourceRoot);
  await verifyDocsIdentity(request.docs, docsRoot, false);
  const issueFile = await repoFile(docsRoot, issueBodyPath, 'issue body snapshot');
  if (issueFile.repoPath !== request.issue.bodySnapshot.path || digest(issueFile.bytes) !== request.issue.bodySnapshot.digest) {
    throw new Error('issue body snapshot path or digest mismatch');
  }
  for (const route of request.routeDigests) {
    const working = await repoFile(docsRoot, route.path, `current coverage route ${route.path}`);
    if (digest(working.bytes) !== route.digest) throw new Error(`current-doc route mutation after V0 for ${route.path}`);
    const bytes = await git(docsRoot, ['show', `${request.docs.baseSha}:${route.path}`]);
    if (digest(bytes) !== route.digest) throw new Error(`base route digest mismatch for ${route.path}`);
  }
}
