import { digest, compareText, sortedUnique } from './docs-release-normalize.mjs';
import { LEDGER_SCHEMA, validateLedger, validateReleaseSource } from './docs-release-schema.mjs';

function sourceProvenance(source) {
  return {
    ref: source.ref,
    resolvedCommit: source.resolvedCommit,
    version: source.version,
    generatedAt: source.generatedAt,
    provenanceType: source.provenance.type,
    provenanceDigest: source.provenance.digest,
    ...(source.provenance.manifestDigest ? { manifestDigest: source.provenance.manifestDigest } : {}),
  };
}

function aliasCollisions(source) {
  const owners = new Map();
  for (const item of source.items) {
    for (const alias of item.aliases) {
      const key = `${item.kind}:${alias}`;
      const list = owners.get(key) ?? [];
      list.push(item.id);
      owners.set(key, list);
    }
  }
  return new Set([...owners.entries()].filter(([, ids]) => new Set(ids).size > 1).flatMap(([key, ids]) => ids.map((id) => `${key.split(':')[0]}:${id}`)));
}

function evidence(side, source, item) {
  return item.anchors.map((anchor) => ({ side, ref: source.ref, resolvedCommit: source.resolvedCommit, ...anchor }));
}

function makeClaim(channel, beforeSource, afterSource, before, after, collisions) {
  const item = after ?? before;
  let classification = before ? (after ? (before.digest === after.digest ? 'no-change' : 'update') : 'remove') : 'new';
  const blockedReasons = [];
  for (const [label, candidate] of [['before', before], ['after', after]]) {
    if (!candidate) continue;
    if (!candidate.digest) blockedReasons.push(`${label} digest missing`);
    if (candidate.anchors.length === 0) blockedReasons.push(`${label} source anchor missing`);
    if (['behavior', 'safety'].includes(candidate.claimType) && !candidate.anchors.some((anchor) => anchor.type === 'test')) {
      blockedReasons.push(`${label} test evidence missing for ${candidate.claimType} claim`);
    }
  }
  if (collisions.has(`${item.kind}:${item.id}`)) blockedReasons.push('alias resolves to multiple entities');
  if (classification !== 'no-change' && blockedReasons.length) classification = 'blocked';
  const identity = {
    channel,
    kind: item.kind,
    entityId: item.id,
    claimType: item.claimType,
    beforeDigest: before?.digest ?? null,
    afterDigest: after?.digest ?? null,
  };
  return {
    id: `CLM-${digest(identity).slice(7, 23).toUpperCase()}`,
    kind: item.kind,
    entityId: item.id,
    claimType: item.claimType,
    classification,
    beforeDigest: before?.digest ?? null,
    afterDigest: after?.digest ?? null,
    aliases: sortedUnique([...(before?.aliases ?? []), ...(after?.aliases ?? [])]),
    anchors: [
      ...(before ? evidence('from', beforeSource, before) : []),
      ...(after ? evidence('to', afterSource, after) : []),
    ],
    docs: [...new Map([...(before?.docs ?? []), ...(after?.docs ?? [])].map((doc) => [`${doc.path}:${doc.role}`, doc])).values()]
      .sort((a, b) => compareText(`${a.path}:${a.role}`, `${b.path}:${b.role}`)),
    impact: {
      classification,
      paths: sortedUnique([...(before?.docs ?? []), ...(after?.docs ?? [])].map((doc) => doc.path)),
    },
    confidence: blockedReasons.length ? 'unresolved' : 'exact',
    blockedReasons: sortedUnique(blockedReasons),
  };
}

export function createReleaseLedger(fromInput, toInput, channel) {
  const from = validateReleaseSource(fromInput, { channel });
  const to = validateReleaseSource(toInput, { channel });
  const before = new Map(from.items.map((item) => [`${item.kind}:${item.id}`, item]));
  const after = new Map(to.items.map((item) => [`${item.kind}:${item.id}`, item]));
  const collisions = new Set([...aliasCollisions(from), ...aliasCollisions(to)]);
  const keys = sortedUnique([...before.keys(), ...after.keys()]);
  const claims = keys.map((key) => makeClaim(channel, from, to, before.get(key), after.get(key), collisions));
  const actionable = claims.some((claim) => !['no-change', 'blocked'].includes(claim.classification));
  const blocked = claims.some((claim) => claim.classification === 'blocked');
  return validateLedger({
    schemaVersion: LEDGER_SCHEMA,
    channel,
    generatedAt: to.generatedAt,
    from: sourceProvenance(from),
    to: sourceProvenance(to),
    status: actionable ? 'changed' : (blocked ? 'blocked' : 'no-op'),
    claims,
  });
}
