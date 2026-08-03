import { compareText, sortedUnique } from './docs-release-normalize.mjs';
import { normalizeRepoPath } from './docs-release-paths.mjs';
import { validateManifest } from './manifest.mjs';

export const SOURCE_SCHEMA = 'ak.docs.release-source/v1';
export const LEDGER_SCHEMA = 'ak.docs.release-ledger/v1';
export const IMPACT_SCHEMA = 'ak.docs.release-impact-map/v1';
export const APPROVAL_REQUEST_SCHEMA = 'ak.docs.release-approval-request/v1';
export const APPROVAL_SCHEMA = 'ak.docs.release-approval/v1';

export const CHANNELS = ['beta', 'stable'];
export const ITEM_KINDS = [
  'cli',
  'installer',
  'runtime-adapter',
  'kit',
  'skill',
  'agent',
  'hook',
  'release-manifest',
  'docs-bundle',
];
export const CLASSIFICATIONS = ['no-change', 'update', 'new', 'remove', 'mirror', 'blocked'];

const FULL_SHA = /^[0-9a-f]{40}$/;
const RELEASE_TAG = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,199}$/;

export class ReleaseSchemaError extends Error {}

function fail(message) {
  throw new ReleaseSchemaError(message);
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}

function string(value, label, pattern) {
  if (typeof value !== 'string' || value.length === 0 || (pattern && !pattern.test(value))) {
    fail(`${label} is invalid: ${JSON.stringify(value)}`);
  }
  return value;
}

function array(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  return value;
}

function exactKeys(value, allowed, label) {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length) fail(`${label} has unsupported fields: ${extras.sort(compareText).join(', ')}`);
}

export function validateImmutableRef(ref, resolvedCommit, label = 'ref') {
  string(ref, label);
  string(resolvedCommit, `${label}.resolvedCommit`, FULL_SHA);
  if (!FULL_SHA.test(ref) && !RELEASE_TAG.test(ref)) {
    fail(`${label} must be a full commit SHA or release tag, not a floating ref: ${JSON.stringify(ref)}`);
  }
  if (FULL_SHA.test(ref) && ref !== resolvedCommit) fail(`${label} does not match resolved commit`);
}

function validateAnchor(anchor, source, label) {
  object(anchor, label);
  exactKeys(anchor, ['path', 'digest', 'lineStart', 'lineEnd', 'type'], label);
  const type = anchor.type ?? 'source';
  if (!['source', 'test'].includes(type)) fail(`${label}.type must be source or test`);
  const result = {
    path: normalizeRepoPath(string(anchor.path, `${label}.path`)),
    digest: string(anchor.digest, `${label}.digest`, DIGEST),
    type,
  };
  if (anchor.lineStart !== undefined) {
    if (!Number.isInteger(anchor.lineStart) || anchor.lineStart < 1) fail(`${label}.lineStart must be positive`);
    result.lineStart = anchor.lineStart;
    const end = anchor.lineEnd ?? anchor.lineStart;
    if (!Number.isInteger(end) || end < anchor.lineStart) fail(`${label}.lineEnd is invalid`);
    result.lineEnd = end;
  }
  return result;
}

function validateDoc(doc, label) {
  object(doc, label);
  exactKeys(doc, ['path', 'role'], label);
  const role = doc.role ?? 'primary';
  if (!['primary', 'mirror'].includes(role)) fail(`${label}.role must be primary or mirror`);
  return { path: normalizeRepoPath(string(doc.path, `${label}.path`)), role };
}

function validateItem(item, source, index) {
  const label = `source.items[${index}]`;
  object(item, label);
  exactKeys(item, ['id', 'kind', 'claimType', 'digest', 'anchors', 'docs', 'aliases'], label);
  const kind = string(item.kind, `${label}.kind`);
  if (!ITEM_KINDS.includes(kind)) fail(`${label}.kind is unsupported: ${kind}`);
  const claimType = item.claimType ?? 'fact';
  if (!['fact', 'behavior', 'safety'].includes(claimType)) fail(`${label}.claimType is invalid`);
  const anchors = (item.anchors ?? []).map((anchor, i) => validateAnchor(anchor, source, `${label}.anchors[${i}]`));
  const docs = (item.docs ?? []).map((doc, i) => validateDoc(doc, `${label}.docs[${i}]`));
  return {
    id: string(item.id, `${label}.id`, ID),
    kind,
    claimType,
    ...(item.digest === undefined ? {} : { digest: string(item.digest, `${label}.digest`, DIGEST) }),
    anchors: anchors.sort((a, b) => compareText(a.path, b.path)),
    docs: docs.sort((a, b) => compareText(`${a.path}:${a.role}`, `${b.path}:${b.role}`)),
    aliases: sortedUnique((item.aliases ?? []).map((alias, i) => string(alias, `${label}.aliases[${i}]`, ID))),
  };
}

export function validateReleaseSource(input, expected = {}) {
  const source = object(input, 'source');
  exactKeys(source, ['schemaVersion', 'channel', 'ref', 'resolvedCommit', 'version', 'generatedAt', 'dirty', 'provenance', 'items'], 'source');
  if (source.schemaVersion !== SOURCE_SCHEMA) fail(`unsupported source schema ${JSON.stringify(source.schemaVersion)}`);
  if (!CHANNELS.includes(source.channel)) fail(`source.channel must be beta or stable`);
  if (expected.channel && source.channel !== expected.channel) fail(`source channel mismatch: expected ${expected.channel}, got ${source.channel}`);
  validateImmutableRef(source.ref, source.resolvedCommit, 'source.ref');
  if (expected.ref && ![source.ref, source.resolvedCommit].includes(expected.ref)) fail(`source ref mismatch: expected ${expected.ref}`);
  if (source.dirty !== false) fail('source must be clean; dirty or unknown state is rejected');
  string(source.version, 'source.version');
  const generatedAt = string(source.generatedAt, 'source.generatedAt');
  if (Number.isNaN(Date.parse(generatedAt))) fail('source.generatedAt must be an ISO timestamp');
  const provenance = object(source.provenance, 'source.provenance');
  exactKeys(provenance, ['type', 'digest', 'manifestDigest', 'manifest'], 'source.provenance');
  if (!['descriptor', 'checkout', 'bundle'].includes(provenance.type)) fail('source.provenance.type is unsupported');
  string(provenance.digest, 'source.provenance.digest', DIGEST);
  if (provenance.type === 'bundle') {
    string(provenance.manifestDigest, 'source.provenance.manifestDigest', DIGEST);
    const manifest = object(provenance.manifest, 'source.provenance.manifest');
    validateManifest(manifest, { expectedChannel: source.channel });
    if (manifest.channel !== source.channel || manifest.tag !== source.ref || manifest.sha !== source.resolvedCommit || manifest.version !== source.version || manifest.generatedAt !== source.generatedAt) {
      fail('bundle manifest provenance does not match source identity');
    }
  } else if (provenance.manifestDigest !== undefined || provenance.manifest !== undefined) {
    fail('manifest provenance is allowed only for bundle sources');
  }
  const items = array(source.items, 'source.items').map((item, i) => validateItem(item, source, i));
  const keys = items.map((item) => `${item.kind}:${item.id}`);
  if (new Set(keys).size !== keys.length) fail('source.items contains duplicate kind/id pairs');
  return {
    schemaVersion: SOURCE_SCHEMA,
    channel: source.channel,
    ref: source.ref,
    resolvedCommit: source.resolvedCommit,
    version: source.version,
    generatedAt,
    dirty: false,
    provenance,
    items: items.sort((a, b) => compareText(`${a.kind}:${a.id}`, `${b.kind}:${b.id}`)),
  };
}

export function validateLedger(ledger) {
  object(ledger, 'ledger');
  if (ledger.schemaVersion !== LEDGER_SCHEMA) fail(`unsupported ledger schema`);
  if (!CHANNELS.includes(ledger.channel)) fail('ledger.channel is invalid');
  if (!['changed', 'no-op', 'blocked'].includes(ledger.status)) fail('ledger.status is invalid');
  string(ledger.generatedAt, 'ledger.generatedAt');
  validateProvenanceSummary(ledger.from, 'ledger.from');
  validateProvenanceSummary(ledger.to, 'ledger.to');
  array(ledger.claims, 'ledger.claims');
  const ids = ledger.claims.map((claim) => string(claim.id, 'claim.id', /^CLM-[0-9A-F]{16}$/));
  if (new Set(ids).size !== ids.length) fail('ledger has duplicate claim IDs');
  for (const claim of ledger.claims) {
    if (!CLASSIFICATIONS.includes(claim.classification)) fail(`${claim.id} has invalid classification`);
    if (!ITEM_KINDS.includes(claim.kind)) fail(`${claim.id} has invalid kind`);
    string(claim.entityId, `${claim.id}.entityId`, ID);
    if (!['fact', 'behavior', 'safety'].includes(claim.claimType)) fail(`${claim.id} has invalid claimType`);
    if (!['exact', 'unresolved'].includes(claim.confidence)) fail(`${claim.id} has invalid confidence`);
    for (const value of [claim.beforeDigest, claim.afterDigest]) if (value !== null) string(value, `${claim.id}.digest`, DIGEST);
    array(claim.anchors, `${claim.id}.anchors`);
    for (const anchor of claim.anchors) {
      if (!['from', 'to'].includes(anchor.side)) fail(`${claim.id} anchor side is invalid`);
      const source = ledger[anchor.side];
      if (anchor.ref !== source.ref || anchor.resolvedCommit !== source.resolvedCommit) fail(`${claim.id} anchor ref is not bound to ledger source`);
      normalizeRepoPath(string(anchor.path, `${claim.id}.anchor.path`));
      string(anchor.digest, `${claim.id}.anchor.digest`, DIGEST);
      if (!['source', 'test'].includes(anchor.type)) fail(`${claim.id} anchor type is invalid`);
    }
    array(claim.docs, `${claim.id}.docs`);
    for (const doc of claim.docs) {
      normalizeRepoPath(string(doc.path, `${claim.id}.docs.path`));
      if (!['primary', 'mirror'].includes(doc.role)) fail(`${claim.id} docs role is invalid`);
    }
    array(claim.blockedReasons, `${claim.id}.blockedReasons`);
    if (claim.blockedReasons.some((reason) => typeof reason !== 'string' || reason.length === 0)) fail(`${claim.id} blocked reason is invalid`);
    if (claim.classification === 'blocked' && (claim.confidence !== 'unresolved' || claim.blockedReasons.length === 0)) fail(`${claim.id} blocked claim lacks unresolved evidence`);
    if (!['blocked', 'no-change'].includes(claim.classification) && (claim.confidence !== 'exact' || claim.blockedReasons.length !== 0)) fail(`${claim.id} actionable claim is not exact`);
    object(claim.impact, `${claim.id}.impact`);
    if (claim.impact.classification !== claim.classification) fail(`${claim.id} impact classification mismatch`);
    const impactPaths = sortedUnique(array(claim.impact.paths, `${claim.id}.impact.paths`).map((path) => normalizeRepoPath(path)));
    const docPaths = sortedUnique(claim.docs.map((doc) => doc.path));
    if (JSON.stringify(impactPaths) !== JSON.stringify(docPaths)) fail(`${claim.id} impact paths do not match docs evidence`);
  }
  const actionable = ledger.claims.some((claim) => !['no-change', 'blocked'].includes(claim.classification));
  const blocked = ledger.claims.some((claim) => claim.classification === 'blocked');
  const expectedStatus = actionable ? 'changed' : (blocked ? 'blocked' : 'no-op');
  if (ledger.status !== expectedStatus) fail(`ledger status should be ${expectedStatus}`);
  return ledger;
}

export function validateImpactMap(map) {
  object(map, 'impact map');
  if (map.schemaVersion !== IMPACT_SCHEMA) fail('unsupported impact-map schema');
  if (!CHANNELS.includes(map.channel)) fail('impact-map channel is invalid');
  string(map.ledgerDigest, 'impact map.ledgerDigest', DIGEST);
  if (!['changed', 'no-op', 'blocked'].includes(map.status)) fail('impact-map status is invalid');
  array(map.pages, 'impact map.pages');
  const pageKeys = [];
  for (const page of map.pages) {
    if (!CLASSIFICATIONS.includes(page.classification)) fail('impact page has invalid classification');
    if (page.path !== null) normalizeRepoPath(page.path);
    string(page.family, 'impact page.family');
    const claimIds = array(page.claimIds, 'impact page.claimIds');
    if (!claimIds.every((id) => /^CLM-[0-9A-F]{16}$/.test(id)) || new Set(claimIds).size !== claimIds.length) fail('impact page claim IDs are invalid');
    const reasons = array(page.reasons, 'impact page.reasons');
    if (reasons.some((reason) => typeof reason !== 'string' || reason.length === 0)) fail('impact page reason is invalid');
    if (page.classification === 'blocked' && reasons.length === 0) fail('blocked impact page has no reason');
    pageKeys.push(page.path ?? `family:${page.family}`);
  }
  if (new Set(pageKeys).size !== pageKeys.length) fail('impact map has duplicate page identities');
  const actionable = map.pages.some((page) => !['no-change', 'blocked'].includes(page.classification));
  const blocked = map.pages.some((page) => page.classification === 'blocked');
  const expectedStatus = actionable ? 'changed' : (blocked ? 'blocked' : 'no-op');
  if (map.status !== expectedStatus) fail(`impact-map status should be ${expectedStatus}`);
  return map;
}

export function validateProvenanceSummary(summary, label = 'source summary') {
  object(summary, label);
  validateImmutableRef(summary.ref, summary.resolvedCommit, `${label}.ref`);
  string(summary.version, `${label}.version`);
  if (Number.isNaN(Date.parse(string(summary.generatedAt, `${label}.generatedAt`)))) fail(`${label}.generatedAt is invalid`);
  if (!['descriptor', 'checkout', 'bundle'].includes(summary.provenanceType)) fail(`${label}.provenanceType is invalid`);
  string(summary.provenanceDigest, `${label}.provenanceDigest`, DIGEST);
  if (summary.manifestDigest !== undefined) string(summary.manifestDigest, `${label}.manifestDigest`, DIGEST);
  if (summary.provenanceType === 'bundle' && summary.manifestDigest === undefined) fail(`${label}.manifestDigest is required for bundles`);
  return summary;
}
