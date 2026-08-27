import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

export const CLASSIFICATIONS = Object.freeze([
  'public',
  'alias',
  'internal',
  'duplicate',
  'unsupported',
  'intentionally-unlisted',
  'collision-blocked',
]);
export const RUNTIMES = Object.freeze(['claude-code', 'codex', 'cursor', 'grok', 'omp', 'pi']);
export const CHANNELS = Object.freeze(['stable', 'beta']);

const ROUTED = new Set(['public', 'intentionally-unlisted', 'collision-blocked']);
const REVIEWED = new Set(['internal', 'duplicate', 'unsupported', 'intentionally-unlisted', 'collision-blocked']);
const ROOT_FIELDS = ['schemaVersion', 'classifications', 'runtimes', 'inventorySnapshots', 'channels'];
const SNAPSHOT_FIELDS = ['kitId', 'identities'];
const IDENTITY_FIELDS = ['sourceIdentity', 'declaredInvocation', 'classification', 'canonicalRoute', 'aliases', 'evidenceRef', 'rationale'];
const CHANNEL_FIELDS = ['tag', 'version', 'sourceCommit', 'releaseUrl', 'kits'];
const KIT_BINDING_FIELDS = ['snapshotDigest', 'artifacts'];
const ARTIFACT_FIELDS = ['archive', 'manifest', 'sidecar'];
const ARCHIVE_FIELDS = ['name', 'sha256', 'size'];
const EVIDENCE_FILE_FIELDS = ['path', 'name', 'sha256', 'size'];
const MANIFEST_FIELDS = [
  'schemaVersion',
  'kitId',
  'tier',
  'runtime',
  'version',
  'channel',
  'adapterSchemaVersion',
  'requiredCliVersion',
  'sourceCommit',
  'createdAt',
  'artifact',
  'resolvedFrom',
  'githubAssets',
];
const MANIFEST_ARTIFACT_FIELDS = ['url', 'sha256', 'size', 'signature', 'signatureAlgorithm', 'keyId', 'expiresAt'];
const RESOLVED_FROM_FIELDS = ['kitId', 'version'];
const GITHUB_ASSET_FIELDS = ['kind', 'name', 'sha256', 'size'];
const HEX_64 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const IDENTITY = /^ak-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const INVOCATION = /^ak:[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const EVIDENCE_PREFIX = 'release-evidence/kit-catalog';

const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const sorted = (values) => [...values].sort(compare);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const sameArray = (left, right) =>
  Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => value === right[index]);

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(sorted(Object.keys(value)).map((key) => [key, canonicalValue(value[key])]));
}

export function canonicalSnapshotJson(snapshot) {
  return JSON.stringify(canonicalValue(snapshot));
}

export function canonicalSnapshotDigest(snapshot) {
  return createHash('sha256').update(canonicalSnapshotJson(snapshot), 'utf8').digest('hex');
}

export function parseJsonStrict(text, label = 'JSON') {
  const parsed = JSON.parse(text);
  const duplicates = [];
  let cursor = 0;
  const whitespace = () => {
    while (/\s/.test(text[cursor] ?? '')) cursor += 1;
  };
  const stringValue = () => {
    const start = cursor;
    cursor += 1;
    while (cursor < text.length) {
      if (text[cursor] === '\\') cursor += 2;
      else if (text[cursor] === '"') {
        cursor += 1;
        return JSON.parse(text.slice(start, cursor));
      } else cursor += 1;
    }
    return '';
  };
  const value = (path) => {
    whitespace();
    if (text[cursor] === '{') {
      cursor += 1;
      whitespace();
      const keys = new Set();
      while (text[cursor] !== '}' && cursor < text.length) {
        const key = stringValue();
        const keyPath = `${path}[${JSON.stringify(key)}]`;
        if (keys.has(key)) duplicates.push(keyPath);
        keys.add(key);
        whitespace();
        cursor += 1; // colon; JSON.parse above already proved the grammar.
        value(keyPath);
        whitespace();
        if (text[cursor] === ',') {
          cursor += 1;
          whitespace();
        } else break;
      }
      cursor += 1;
      return;
    }
    if (text[cursor] === '[') {
      cursor += 1;
      whitespace();
      let index = 0;
      while (text[cursor] !== ']' && cursor < text.length) {
        value(`${path}[${index}]`);
        index += 1;
        whitespace();
        if (text[cursor] === ',') {
          cursor += 1;
          whitespace();
        } else break;
      }
      cursor += 1;
      return;
    }
    if (text[cursor] === '"') {
      stringValue();
      return;
    }
    while (cursor < text.length && !/[\s,\]}]/.test(text[cursor])) cursor += 1;
  };
  value('$');
  if (duplicates.length) throw new SyntaxError(`${label}: duplicate object keys [${sorted(duplicates).join(', ')}]`);
  return parsed;
}

function exactFields(value, expected, label, errors, optional = []) {
  if (!isObject(value)) {
    errors.push(`${label}: must be an object`);
    return false;
  }
  const actual = Object.keys(value);
  const allowed = new Set([...expected, ...optional]);
  const missing = expected.filter((field) => !Object.hasOwn(value, field));
  const unknown = actual.filter((field) => !allowed.has(field));
  if (missing.length || unknown.length) {
    errors.push(`${label}: missing fields [${missing.join(', ')}]; unknown fields [${sorted(unknown).join(', ')}]`);
    return false;
  }
  return true;
}

function addDifference(errors, label, expected, actual) {
  const missing = sorted([...expected].filter((value) => !actual.has(value)));
  const extra = sorted([...actual].filter((value) => !expected.has(value)));
  if (missing.length || extra.length) errors.push(`${label}: missing [${missing.join(', ')}]; extra [${extra.join(', ')}]`);
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) (seen.has(value) ? duplicates : seen).add(value);
  return sorted(duplicates);
}

function validateDigestSize(value, label, errors) {
  if (!HEX_64.test(value.sha256)) errors.push(`${label}.sha256: must be a lowercase SHA-256 digest`);
  if (!Number.isSafeInteger(value.size) || value.size <= 0) errors.push(`${label}.size: must be a positive safe integer`);
}

function evidenceNames(channel, version, kitId, runtime) {
  const stem = `agentkit-kit-${kitId}-${runtime}-${version}`;
  const directory = `${EVIDENCE_PREFIX}/${channel}-v${version}`;
  return {
    directory,
    archiveAsset: `${stem}.tar.gz`,
    manifest: `${stem}.manifest.json`,
    manifestPath: `${directory}/${stem}.manifest.json`,
    sidecar: `${stem}.sha256`,
    sidecarPath: `${directory}/${stem}.sha256`,
  };
}

function validateIdentities(snapshot, digest, errors) {
  const label = `inventorySnapshots.${digest}`;
  if (!Array.isArray(snapshot.identities)) {
    errors.push(`${label}.identities: must be an array`);
    return;
  }
  const sources = snapshot.identities.map((entry) => entry?.sourceIdentity ?? '');
  if (!sameArray(sources, sorted(sources))) errors.push(`${label}.identities: must be sorted by sourceIdentity`);
  const duplicateSources = duplicateValues(sources);
  if (duplicateSources.length) errors.push(`${label}.identities: duplicate sourceIdentity [${duplicateSources.join(', ')}]`);

  const bySource = new Map(snapshot.identities.map((entry) => [entry?.sourceIdentity, entry]));
  const routedRoutes = new Map();
  const publicRoutes = new Map();
  const invocationGroups = new Map();
  for (const entry of snapshot.identities) {
    const source = entry?.sourceIdentity ?? '<missing>';
    const entryLabel = `${label}.identities.${source}`;
    if (!exactFields(entry, IDENTITY_FIELDS, entryLabel, errors, ['reviewedException'])) continue;
    if (!IDENTITY.test(entry.sourceIdentity)) errors.push(`${entryLabel}.sourceIdentity: invalid storage identity`);
    if (!INVOCATION.test(entry.declaredInvocation)) errors.push(`${entryLabel}.declaredInvocation: invalid invocation identity`);
    if (!CLASSIFICATIONS.includes(entry.classification)) errors.push(`${entryLabel}.classification: unsupported ${entry.classification}`);
    if (!Array.isArray(entry.aliases)) errors.push(`${entryLabel}.aliases: must be an array`);
    else {
      if (!sameArray(entry.aliases, sorted(entry.aliases))) errors.push(`${entryLabel}.aliases: must be sorted`);
      const duplicateAliases = duplicateValues(entry.aliases);
      if (duplicateAliases.length) errors.push(`${entryLabel}.aliases: duplicate aliases [${duplicateAliases.join(', ')}]`);
    }
    if (typeof entry.rationale !== 'string' || !entry.rationale.trim()) errors.push(`${entryLabel}.rationale: must be a non-empty string`);
    if (REVIEWED.has(entry.classification) && (typeof entry.reviewedException !== 'string' || !entry.reviewedException)) {
      errors.push(`${entryLabel}: non-public classification requires reviewedException`);
    }
    if (!REVIEWED.has(entry.classification) && Object.hasOwn(entry, 'reviewedException')) {
      errors.push(`${entryLabel}.reviewedException: not allowed for ${entry.classification}`);
    }

    const sourceSlug = typeof entry.sourceIdentity === 'string' ? entry.sourceIdentity.replace(/^ak-/, '') : '';
    const invocationSlug = typeof entry.declaredInvocation === 'string' ? entry.declaredInvocation.replace(/^ak:/, '') : '';
    if (entry.classification !== 'alias' && entry.classification !== 'collision-blocked' && sourceSlug !== invocationSlug) {
      errors.push(`${entryLabel}: invocation ${entry.declaredInvocation} does not match storage identity ${entry.sourceIdentity}`);
    }
    if (ROUTED.has(entry.classification)) {
      const expectedRoute = `kits/${snapshot.kitId}/skills/${sourceSlug}`;
      if (entry.canonicalRoute !== expectedRoute) errors.push(`${entryLabel}.canonicalRoute: expected ${expectedRoute}`);
      if (routedRoutes.has(entry.canonicalRoute)) errors.push(`${label}: duplicate routed canonicalRoute ${entry.canonicalRoute}`);
      routedRoutes.set(entry.canonicalRoute, entry);
      if (entry.classification === 'public') publicRoutes.set(entry.canonicalRoute, entry);
    } else if (entry.classification === 'alias') {
      if (typeof entry.canonicalRoute !== 'string') errors.push(`${entryLabel}.canonicalRoute: alias requires a route`);
    } else if (entry.canonicalRoute !== null) {
      errors.push(`${entryLabel}.canonicalRoute: ${entry.classification} identity must use null`);
    }

    const evidence = typeof entry.evidenceRef === 'string'
      ? entry.evidenceRef.match(/^release-asset:sha256:([a-f0-9]{64})#([a-z0-9-]+)\/skills\/(ak-[a-z0-9-]+)\/SKILL\.md$/)
      : null;
    if (!evidence || evidence[2] !== snapshot.kitId || evidence[3] !== entry.sourceIdentity) {
      errors.push(`${entryLabel}.evidenceRef: must identify this Kit and storage identity`);
    }

    const group = invocationGroups.get(entry.declaredInvocation) ?? [];
    group.push(entry);
    invocationGroups.set(entry.declaredInvocation, group);
  }

  for (const entry of snapshot.identities) {
    if (!isObject(entry) || !Array.isArray(entry.aliases)) continue;
    if (entry.classification === 'public') {
      for (const aliasName of entry.aliases) {
        const alias = bySource.get(aliasName);
        if (!alias || alias.classification !== 'alias' || alias.canonicalRoute !== entry.canonicalRoute || alias.declaredInvocation !== entry.declaredInvocation) {
          errors.push(`${label}.${entry.sourceIdentity}: alias ${aliasName} is not a matching alias identity`);
        }
      }
    }
    if (entry.classification === 'alias') {
      const canonical = publicRoutes.get(entry.canonicalRoute);
      if (!canonical || !Array.isArray(canonical.aliases) || !canonical.aliases.includes(entry.sourceIdentity)) {
        errors.push(`${label}.${entry.sourceIdentity}: alias must be named by its public canonical identity`);
      }
    }
  }
  for (const [invocation, group] of invocationGroups) {
    if (group.length < 2) {
      if (group[0]?.classification === 'collision-blocked') errors.push(`${label}: collision-blocked invocation ${invocation} requires at least two identities`);
      continue;
    }
    const classes = new Set(group.map((entry) => entry.classification));
    const aliasPair = group.filter((entry) => entry.classification === 'public').length === 1 &&
      group.some((entry) => entry.classification === 'alias') && [...classes].every((value) => value === 'public' || value === 'alias');
    const collision = classes.size === 1 && classes.has('collision-blocked') && group.length >= 2;
    const exceptions = new Set(group.map((entry) => entry.reviewedException).filter(Boolean));
    if ((!aliasPair && !collision) || (collision && exceptions.size !== 1)) {
      errors.push(`${label}: duplicate declared invocation ${invocation} is not an alias or reviewed collision`);
    }
  }
}

export function validateRegistry(registry, channelsIdentity) {
  const errors = [];
  if (!exactFields(registry, ROOT_FIELDS, 'registry', errors)) return errors;
  if (registry.schemaVersion !== 2) errors.push(`unsupported registry schemaVersion ${registry.schemaVersion}; expected 2`);
  if (!sameArray(registry.classifications, CLASSIFICATIONS)) errors.push('registry classifications must match the exact supported classifications');
  if (!sameArray(registry.runtimes, RUNTIMES)) errors.push(`registry runtimes must be exactly [${RUNTIMES.join(', ')}]`);
  if (!isObject(registry.inventorySnapshots)) errors.push('registry.inventorySnapshots: must be an object');
  if (!isObject(registry.channels)) errors.push('registry.channels: must be an object');
  if (errors.length && (!isObject(registry.inventorySnapshots) || !isObject(registry.channels))) return errors;

  const referenced = new Set();
  for (const [digest, snapshot] of Object.entries(registry.inventorySnapshots)) {
    if (!HEX_64.test(digest)) errors.push(`inventorySnapshots.${digest}: key must be a canonical SHA-256 digest`);
    if (!exactFields(snapshot, SNAPSHOT_FIELDS, `inventorySnapshots.${digest}`, errors)) continue;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(snapshot.kitId)) errors.push(`inventorySnapshots.${digest}.kitId: invalid Kit id`);
    const actualDigest = canonicalSnapshotDigest(snapshot);
    if (digest !== actualDigest) errors.push(`inventorySnapshots.${digest}: canonical digest is ${actualDigest}`);
    validateIdentities(snapshot, digest, errors);
  }

  addDifference(errors, 'registry channels', new Set(CHANNELS), new Set(Object.keys(registry.channels)));
  for (const channel of CHANNELS) {
    const value = registry.channels[channel];
    const label = `channels.${channel}`;
    if (!exactFields(value, CHANNEL_FIELDS, label, errors)) continue;
    const expectedIdentity = channelsIdentity?.[channel];
    if (!expectedIdentity) errors.push(`${label}: missing identity in channels.json`);
    else {
      if (value.tag !== expectedIdentity.tag) errors.push(`${label}.tag: expected ${expectedIdentity.tag}`);
      if (value.version !== expectedIdentity.version) errors.push(`${label}.version: expected ${expectedIdentity.version}`);
      if (value.sourceCommit !== expectedIdentity.sha) errors.push(`${label}.sourceCommit: expected ${expectedIdentity.sha}`);
    }
    if (!COMMIT.test(value.sourceCommit)) errors.push(`${label}.sourceCommit: must be a lowercase 40-character commit`);
    const expectedUrl = `https://github.com/bestagentkits/agentkit/releases/tag/${value.tag}`;
    if (value.releaseUrl !== expectedUrl) errors.push(`${label}.releaseUrl: expected ${expectedUrl}`);
    if (!isObject(value.kits)) {
      errors.push(`${label}.kits: must be an object`);
      continue;
    }
    for (const [kitId, binding] of Object.entries(value.kits)) {
      const bindingLabel = `${label}.kits.${kitId}`;
      if (!exactFields(binding, KIT_BINDING_FIELDS, bindingLabel, errors)) continue;
      referenced.add(binding.snapshotDigest);
      const snapshot = registry.inventorySnapshots[binding.snapshotDigest];
      if (!snapshot) errors.push(`${bindingLabel}.snapshotDigest: unknown snapshot ${binding.snapshotDigest}`);
      else if (snapshot.kitId !== kitId) errors.push(`${bindingLabel}.snapshotDigest: snapshot belongs to ${snapshot.kitId}`);
      if (!isObject(binding.artifacts)) {
        errors.push(`${bindingLabel}.artifacts: must be an object`);
        continue;
      }
      addDifference(errors, `${bindingLabel}.artifacts`, new Set(RUNTIMES), new Set(Object.keys(binding.artifacts)));
      const evidenceHashes = new Set();
      const evidencePaths = new Set();
      for (const runtime of RUNTIMES) {
        const artifact = binding.artifacts[runtime];
        const artifactLabel = `${bindingLabel}.artifacts.${runtime}`;
        if (!exactFields(artifact, ARTIFACT_FIELDS, artifactLabel, errors)) continue;
        const names = evidenceNames(channel, value.version, kitId, runtime);
        if (exactFields(artifact.archive, ARCHIVE_FIELDS, `${artifactLabel}.archive`, errors)) {
          if (artifact.archive.name !== 'kit.tar.gz') errors.push(`${artifactLabel}.archive.name: expected kit.tar.gz`);
          validateDigestSize(artifact.archive, `${artifactLabel}.archive`, errors);
          if (HEX_64.test(artifact.archive.sha256)) evidenceHashes.add(artifact.archive.sha256);
        }
        for (const [kind, expectedName, expectedPath] of [
          ['manifest', names.manifest, names.manifestPath],
          ['sidecar', names.sidecar, names.sidecarPath],
        ]) {
          const record = artifact[kind];
          const recordLabel = `${artifactLabel}.${kind}`;
          if (!exactFields(record, EVIDENCE_FILE_FIELDS, recordLabel, errors)) continue;
          if (record.name !== expectedName || basename(record.name) !== record.name) errors.push(`${recordLabel}.name: expected ${expectedName}`);
          if (record.path !== expectedPath) errors.push(`${recordLabel}.path: expected ${expectedPath}`);
          validateDigestSize(record, recordLabel, errors);
          if (typeof record.path === 'string') {
            if (evidencePaths.has(record.path)) errors.push(`${bindingLabel}: duplicate evidence path ${record.path}`);
            evidencePaths.add(record.path);
          }
        }
      }
      if (snapshot?.identities) {
        for (const identity of snapshot.identities) {
          if (!isObject(identity)) continue;
          const hash = typeof identity.evidenceRef === 'string' ? identity.evidenceRef.match(/^release-asset:sha256:([a-f0-9]{64})#/)?.[1] : null;
          if (hash && !evidenceHashes.has(hash)) errors.push(`${bindingLabel}: ${identity.sourceIdentity} evidence hash is not one of this channel's artifacts`);
        }
      }
    }
  }
  const stableKits = new Set(Object.keys(registry.channels.stable?.kits ?? {}));
  const betaKits = new Set(Object.keys(registry.channels.beta?.kits ?? {}));
  addDifference(errors, 'Stable/Beta Kit bindings', betaKits, stableKits);
  for (const digest of Object.keys(registry.inventorySnapshots)) {
    if (!referenced.has(digest)) errors.push(`inventorySnapshots.${digest}: unreferenced snapshot`);
  }
  return errors;
}

async function readEvidenceBytes({ root, rootReal, record, expectedPath, label, errors }) {
  if (!isObject(record) || record.path !== expectedPath) return null;
  const absolute = resolve(root, record.path);
  const expectedAbsolute = resolve(root, expectedPath);
  const rootRelative = relative(root, absolute);
  if (absolute !== expectedAbsolute || rootRelative !== expectedPath.split('/').join(sep) || rootRelative.startsWith(`..${sep}`) || rootRelative === '..') {
    errors.push(`${label}.path: must be the exact safe repo-relative evidence path ${expectedPath}`);
    return null;
  }
  try {
    const [parentStat, fileStat, actualReal] = await Promise.all([lstat(dirname(absolute)), lstat(absolute), realpath(absolute)]);
    if (!parentStat.isDirectory()) {
      errors.push(`${label}.path: evidence parent must be a regular directory`);
      return null;
    }
    if (!fileStat.isFile()) {
      errors.push(`${label}.path: evidence must be a regular file`);
      return null;
    }
    const expectedReal = resolve(rootReal, expectedPath.split('/').join(sep));
    if (actualReal !== expectedReal) {
      errors.push(`${label}.path: evidence path must not traverse symlinks`);
      return null;
    }
    const bytes = await readFile(absolute);
    const byteHash = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== record.size) errors.push(`${label}.size: expected committed byte size ${record.size}, observed ${bytes.length}`);
    if (byteHash !== record.sha256) errors.push(`${label}.sha256: expected committed byte hash ${record.sha256}, observed ${byteHash}`);
    return bytes;
  } catch (error) {
    errors.push(`${label}.path: cannot read committed evidence: ${error.message}`);
    return null;
  }
}

function validateManifestObject(manifest, expected, label, errors) {
  if (!exactFields(manifest, MANIFEST_FIELDS, label, errors)) return null;
  if (manifest.schemaVersion !== 'remote-registry.v1') errors.push(`${label}.schemaVersion: expected remote-registry.v1`);
  if (manifest.channel !== expected.channel) errors.push(`${label}.channel: expected ${expected.channel}`);
  if (manifest.version !== expected.version) errors.push(`${label}.version: expected ${expected.version}`);
  if (manifest.runtime !== expected.runtime) errors.push(`${label}.runtime: expected ${expected.runtime}`);
  if (manifest.kitId !== expected.kitId) errors.push(`${label}.kitId: expected ${expected.kitId}`);
  if (manifest.sourceCommit !== expected.sourceCommit) errors.push(`${label}.sourceCommit: expected ${expected.sourceCommit}`);
  if (manifest.requiredCliVersion !== expected.version) errors.push(`${label}.requiredCliVersion: expected ${expected.version}`);
  if (manifest.adapterSchemaVersion !== 'agentkit-adapter.v1') errors.push(`${label}.adapterSchemaVersion: expected agentkit-adapter.v1`);
  if (typeof manifest.tier !== 'string' || !manifest.tier) errors.push(`${label}.tier: must be a non-empty string`);
  if (manifest.createdAt !== expected.syncedAt) errors.push(`${label}.createdAt: expected channels.json syncedAt ${expected.syncedAt}`);

  let archiveName = null;
  if (exactFields(manifest.artifact, MANIFEST_ARTIFACT_FIELDS, `${label}.artifact`, errors)) {
    // archive.name is the logical registry object named by artifact.url. The
    // separately named GitHub release archive is checked in githubAssets below.
    const expectedUrl = `https://registry.agentkit.best/kits/${expected.kitId}/${expected.runtime}/${expected.version}/kit.tar.gz`;
    if (manifest.artifact.url !== expectedUrl) errors.push(`${label}.artifact.url: expected ${expectedUrl}`);
    try {
      archiveName = basename(new URL(manifest.artifact.url).pathname);
    } catch {
      errors.push(`${label}.artifact.url: must be an absolute URL`);
    }
    if (archiveName !== expected.archive.name) errors.push(`${label}.artifact.name: expected ${expected.archive.name}`);
    if (manifest.artifact.sha256 !== expected.archive.sha256) errors.push(`${label}.artifact.sha256: expected ${expected.archive.sha256}`);
    if (manifest.artifact.size !== expected.archive.size) errors.push(`${label}.artifact.size: expected ${expected.archive.size}`);
    if (typeof manifest.artifact.signature !== 'string' || !manifest.artifact.signature) errors.push(`${label}.artifact.signature: must be a non-empty string`);
    if (manifest.artifact.signatureAlgorithm !== 'ed25519') errors.push(`${label}.artifact.signatureAlgorithm: expected ed25519`);
    if (typeof manifest.artifact.keyId !== 'string' || !manifest.artifact.keyId) errors.push(`${label}.artifact.keyId: must be a non-empty string`);
    if (typeof manifest.artifact.expiresAt !== 'string' || Number.isNaN(Date.parse(manifest.artifact.expiresAt))) errors.push(`${label}.artifact.expiresAt: must be an ISO timestamp`);
  }

  if (!Array.isArray(manifest.resolvedFrom)) errors.push(`${label}.resolvedFrom: must be an array`);
  else {
    const tuples = [];
    for (const [index, entry] of manifest.resolvedFrom.entries()) {
      const entryLabel = `${label}.resolvedFrom.${index}`;
      if (!exactFields(entry, RESOLVED_FROM_FIELDS, entryLabel, errors)) continue;
      if (typeof entry.kitId !== 'string' || !entry.kitId) errors.push(`${entryLabel}.kitId: must be a non-empty string`);
      if (typeof entry.version !== 'string' || !VERSION.test(entry.version)) errors.push(`${entryLabel}.version: must be a semantic version`);
      tuples.push(`${entry.kitId}@${entry.version}`);
    }
    const duplicates = duplicateValues(tuples);
    if (duplicates.length) errors.push(`${label}.resolvedFrom: duplicate tuples [${duplicates.join(', ')}]`);
  }

  const assets = new Map();
  if (!Array.isArray(manifest.githubAssets)) errors.push(`${label}.githubAssets: must be an array`);
  else {
    for (const [index, entry] of manifest.githubAssets.entries()) {
      const entryLabel = `${label}.githubAssets.${index}`;
      if (!exactFields(entry, GITHUB_ASSET_FIELDS, entryLabel, errors)) continue;
      if (!['archive', 'sha256'].includes(entry.kind)) errors.push(`${entryLabel}.kind: unsupported ${entry.kind}`);
      if (assets.has(entry.kind)) errors.push(`${label}.githubAssets: duplicate kind ${entry.kind}`);
      assets.set(entry.kind, entry);
      if (typeof entry.name !== 'string' || basename(entry.name) !== entry.name) errors.push(`${entryLabel}.name: must be a file name`);
      validateDigestSize(entry, entryLabel, errors);
    }
    addDifference(errors, `${label}.githubAssets kinds`, new Set(['archive', 'sha256']), new Set(assets.keys()));
  }
  const archiveAsset = assets.get('archive');
  if (archiveAsset) {
    if (archiveAsset.name !== expected.names.archiveAsset) errors.push(`${label}.githubAssets.archive.name: expected ${expected.names.archiveAsset}`);
    if (archiveAsset.sha256 !== expected.archive.sha256) errors.push(`${label}.githubAssets.archive.sha256: expected ${expected.archive.sha256}`);
    if (archiveAsset.size !== expected.archive.size) errors.push(`${label}.githubAssets.archive.size: expected ${expected.archive.size}`);
  }
  const sidecarAsset = assets.get('sha256');
  if (sidecarAsset) {
    if (sidecarAsset.name !== expected.sidecar.name) errors.push(`${label}.githubAssets.sha256.name: expected ${expected.sidecar.name}`);
    if (sidecarAsset.sha256 !== expected.sidecar.sha256) errors.push(`${label}.githubAssets.sha256.sha256: expected ${expected.sidecar.sha256}`);
    if (sidecarAsset.size !== expected.sidecar.size) errors.push(`${label}.githubAssets.sha256.size: expected ${expected.sidecar.size}`);
  }
  return `${manifest.channel}/${manifest.version}/${manifest.kitId}/${manifest.runtime}`;
}

async function enumerateCatalogEvidenceFiles({ root, rootReal, errors }) {
  const files = new Set();
  const catalogRoot = resolve(root, EVIDENCE_PREFIX.split('/').join(sep));
  try {
    const [catalogStat, catalogReal] = await Promise.all([lstat(catalogRoot), realpath(catalogRoot)]);
    if (!catalogStat.isDirectory()) {
      errors.push(`${EVIDENCE_PREFIX}: evidence root must be a regular directory`);
      return files;
    }
    if (catalogReal !== resolve(rootReal, EVIDENCE_PREFIX.split('/').join(sep))) {
      errors.push(`${EVIDENCE_PREFIX}: evidence root must not traverse symlinks`);
      return files;
    }
  } catch (error) {
    errors.push(`${EVIDENCE_PREFIX}: cannot read evidence root: ${error.message}`);
    return files;
  }

  async function walk(repoDirectory) {
    const absoluteDirectory = resolve(root, repoDirectory.split('/').join(sep));
    let entries;
    try {
      entries = await readdir(absoluteDirectory, { withFileTypes: true });
    } catch (error) {
      errors.push(`${repoDirectory}: cannot enumerate evidence directory: ${error.message}`);
      return;
    }
    for (const entry of entries.sort((left, right) => compare(left.name, right.name))) {
      const repoPath = `${repoDirectory}/${entry.name}`;
      const absolute = resolve(root, repoPath.split('/').join(sep));
      try {
        const info = await lstat(absolute);
        if (info.isSymbolicLink()) errors.push(`${repoPath}: catalog evidence must not be a symlink`);
        else if (info.isDirectory()) await walk(repoPath);
        else if (info.isFile()) files.add(repoPath);
        else errors.push(`${repoPath}: catalog evidence must be a regular file or directory`);
      } catch (error) {
        errors.push(`${repoPath}: cannot inspect catalog evidence: ${error.message}`);
      }
    }
  }

  await walk(EVIDENCE_PREFIX);
  return files;
}

// Offline scope only: this verifies committed manifest/sidecar bytes and the
// archive digest metadata they bind. It does not prove remote availability or
// verify the manifest's embedded signature.
export async function validateCatalogEvidence({ registry, channelsIdentity, root }) {
  const errors = [];
  const tuples = new Set();
  const paths = new Set();
  let rootReal;
  try {
    rootReal = await realpath(root);
  } catch (error) {
    return [`evidence root: cannot resolve repository root: ${error.message}`];
  }
  const actualPaths = await enumerateCatalogEvidenceFiles({ root, rootReal, errors });

  for (const channel of CHANNELS) {
    const channelValue = registry.channels?.[channel];
    const channelIdentity = channelsIdentity?.[channel];
    if (!isObject(channelValue) || !isObject(channelIdentity)) continue;
    for (const [kitId, binding] of Object.entries(channelValue.kits ?? {})) {
      for (const runtime of RUNTIMES) {
        const triad = binding.artifacts?.[runtime];
        if (!isObject(triad) || !isObject(triad.archive) || !isObject(triad.manifest) || !isObject(triad.sidecar)) continue;
        const label = `channels.${channel}.kits.${kitId}.artifacts.${runtime}`;
        const names = evidenceNames(channel, channelValue.version, kitId, runtime);
        for (const record of [triad.manifest, triad.sidecar]) {
          if (typeof record.path === 'string') {
            if (paths.has(record.path)) errors.push(`${label}: duplicate evidence path ${record.path}`);
            paths.add(record.path);
          }
        }
        const [manifestBytes, sidecarBytes] = await Promise.all([
          readEvidenceBytes({ root, rootReal, record: triad.manifest, expectedPath: names.manifestPath, label: `${label}.manifest`, errors }),
          readEvidenceBytes({ root, rootReal, record: triad.sidecar, expectedPath: names.sidecarPath, label: `${label}.sidecar`, errors }),
        ]);
        if (sidecarBytes) {
          const expectedSidecar = Buffer.from(`${triad.archive.sha256}  ${triad.archive.name}\n`, 'utf8');
          if (!sidecarBytes.equals(expectedSidecar)) errors.push(`${label}.sidecar: bytes must be exactly "<archive sha256>  <archive name>\\n"`);
        }
        if (manifestBytes) {
          let manifest;
          try {
            manifest = parseJsonStrict(manifestBytes.toString('utf8'), `${label}.manifest`);
          } catch (error) {
            errors.push(`${label}.manifest: invalid JSON: ${error.message}`);
            continue;
          }
          const tuple = validateManifestObject(manifest, {
            channel,
            version: channelValue.version,
            runtime,
            kitId,
            sourceCommit: channelValue.sourceCommit,
            syncedAt: channelIdentity.syncedAt,
            archive: triad.archive,
            sidecar: triad.sidecar,
            names,
          }, `${label}.manifest.parsed`, errors);
          if (tuple) {
            if (tuples.has(tuple)) errors.push(`${label}.manifest.parsed: duplicate channel/version/Kit/runtime tuple ${tuple}`);
            tuples.add(tuple);
          }
        }
      }
    }
  }
  addDifference(errors, 'catalog evidence files', paths, actualPaths);
  return errors;
}

async function readJson(path) {
  return parseJsonStrict(await readFile(path, 'utf8'), path);
}

async function detailSlugs(skillsDir, locale) {
  if (!existsSync(skillsDir)) return new Set();
  const suffix = `.${locale}.mdx`;
  return new Set((await readdir(skillsDir))
    .filter((name) => name.endsWith(suffix) && name !== `index${suffix}`)
    .map((name) => name.slice(0, -suffix.length)));
}

async function navPages(path, label, errors) {
  if (!existsSync(path)) {
    errors.push(`${label}: missing file`);
    return [];
  }
  const value = await readJson(path);
  if (!Array.isArray(value.pages) || value.pages.some((page) => typeof page !== 'string')) {
    errors.push(`${label}: pages must be an array of strings`);
    return [];
  }
  const duplicates = duplicateValues(value.pages);
  if (duplicates.length) errors.push(`${label}: duplicate pages [${duplicates.join(', ')}]`);
  return value.pages;
}

async function indexSlugs(path, label, errors) {
  if (!existsSync(path)) {
    errors.push(`${label}: missing file`);
    return new Set();
  }
  const body = await readFile(path, 'utf8');
  return new Set([...body.matchAll(/\]\(\.\/([a-z0-9][a-z0-9-]*)\)/g)].map((match) => match[1]));
}

async function overviewCount(path, label, errors) {
  if (!existsSync(path)) {
    errors.push(`${label}: missing file`);
    return null;
  }
  const body = await readFile(path, 'utf8');
  const match = body.match(/^\|\s*Skills\s*\|\s*(\d+)\s*\|/mi);
  if (!match) errors.push(`${label}: Skills count is missing`);
  return match ? Number(match[1]) : null;
}

async function closureFile(path, key, closure, errors, root) {
  if (!existsSync(path)) return;
  try {
    closure.set(key, await readFile(path));
  } catch (error) {
    errors.push(`${relative(root, path)}: cannot read closure file: ${error.message}`);
  }
}

export async function observeKitDocs({ docsRoot, channel, kitId, snapshot, errors }) {
  const prefix = `${channel}/${kitId}`;
  const skillsDir = join(docsRoot, channel, 'kits', kitId, 'skills');
  const overviewEnPath = join(docsRoot, channel, 'kits', `${kitId}.en.mdx`);
  const overviewViPath = join(docsRoot, channel, 'kits', `${kitId}.vi.mdx`);
  const metaEnPath = join(skillsDir, 'meta.json');
  const metaViPath = join(skillsDir, 'meta.vi.json');
  const indexEnPath = join(skillsDir, 'index.en.mdx');
  const indexViPath = join(skillsDir, 'index.vi.mdx');
  const en = await detailSlugs(skillsDir, 'en');
  const vi = await detailSlugs(skillsDir, 'vi');
  const nav = await navPages(metaEnPath, `${prefix} public nav EN`, errors);
  const navVi = await navPages(metaViPath, `${prefix} public nav VI`, errors);
  const indexEn = await indexSlugs(indexEnPath, `${prefix} public index EN`, errors);
  const indexVi = await indexSlugs(indexViPath, `${prefix} public index VI`, errors);
  const routed = new Set(snapshot.identities.filter((entry) => ROUTED.has(entry.classification)).map((entry) => entry.canonicalRoute.split('/').at(-1)));
  const publicRoutes = new Set(snapshot.identities.filter((entry) => entry.classification === 'public').map((entry) => entry.canonicalRoute.split('/').at(-1)));

  addDifference(errors, `${prefix} EN/VI details`, en, vi);
  addDifference(errors, `${prefix} exact routed details EN`, routed, en);
  addDifference(errors, `${prefix} exact routed details VI`, routed, vi);
  addDifference(errors, `${prefix} EN/VI public nav`, new Set(nav), new Set(navVi));
  addDifference(errors, `${prefix} exact public nav EN`, publicRoutes, new Set(nav));
  addDifference(errors, `${prefix} exact public nav VI`, publicRoutes, new Set(navVi));
  addDifference(errors, `${prefix} exact public index EN`, publicRoutes, indexEn);
  addDifference(errors, `${prefix} exact public index VI`, publicRoutes, indexVi);
  const expectedCount = snapshot.identities.length;
  const overviewEn = await overviewCount(overviewEnPath, `${prefix} overview EN`, errors);
  const overviewVi = await overviewCount(overviewViPath, `${prefix} overview VI`, errors);
  if (overviewEn !== expectedCount) errors.push(`${prefix} overview EN: Skills count ${overviewEn ?? 'missing'} does not match snapshot total ${expectedCount}`);
  if (overviewVi !== expectedCount) errors.push(`${prefix} overview VI: Skills count ${overviewVi ?? 'missing'} does not match snapshot total ${expectedCount}`);
  if (overviewEn !== overviewVi) errors.push(`${prefix} EN/VI overview: Skills counts ${overviewEn ?? 'missing'} and ${overviewVi ?? 'missing'} must match`);

  const closure = new Map();
  await Promise.all([
    closureFile(overviewEnPath, 'overview:en', closure, errors, docsRoot),
    closureFile(overviewViPath, 'overview:vi', closure, errors, docsRoot),
    closureFile(indexEnPath, 'index:en', closure, errors, docsRoot),
    closureFile(indexViPath, 'index:vi', closure, errors, docsRoot),
    closureFile(metaEnPath, 'meta:en', closure, errors, docsRoot),
    closureFile(metaViPath, 'meta:vi', closure, errors, docsRoot),
    ...[...new Set([...en, ...vi])].flatMap((slug) => [
      closureFile(join(skillsDir, `${slug}.en.mdx`), `skill:${slug}:en`, closure, errors, docsRoot),
      closureFile(join(skillsDir, `${slug}.vi.mdx`), `skill:${slug}:vi`, closure, errors, docsRoot),
    ]),
  ]);
  return { en, vi, nav: new Set(nav), closure, routed, publicRoutes };
}

function trackedKitPaths(root, errors) {
  const result = spawnSync('git', [
    '-C', root, 'ls-files', '--stage', '-z', '--',
    'content/docs/stable/kits', 'content/docs/beta/kits',
  ], { maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) {
    errors.push(`Stable/Beta full kits tree: cannot enumerate tracked files: ${result.stderr.toString().trim()}`);
    return new Set();
  }
  const paths = new Set();
  for (const record of result.stdout.toString('utf8').split('\0').filter(Boolean)) {
    const tab = record.indexOf('\t');
    const mode = record.slice(0, tab).split(' ')[0];
    const path = record.slice(tab + 1);
    if (!['100644', '100755'].includes(mode)) continue;
    const relativePath = path.replace(/^content\/docs\/(stable|beta)\/kits\//, '');
    if (relativePath === path) errors.push(`Stable/Beta full kits tree: invalid tracked path ${path}`);
    else paths.add(relativePath);
  }
  return paths;
}

async function readTrackedTree(docsRoot, channel, relativePaths, errors) {
  const files = new Map();
  for (const relativePath of sorted(relativePaths)) {
    const path = join(docsRoot, channel, 'kits', ...relativePath.split('/'));
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink()) errors.push(`${channel} kits tree: tracked path is not a regular file: ${relativePath}`);
      else files.set(relativePath, await readFile(path));
    } catch (error) {
      errors.push(`${channel} kits tree: cannot read tracked path ${relativePath}: ${error.message}`);
    }
  }
  return files;
}

// Full-tree semantics are intentionally all-or-nothing. Once every configured
// Kit/runtime archive hash matches, no Kit-scoped subset can hide drift in
// hooks, workflows, metadata, or another tracked regular file under kits/**.
// The union lets a pre-commit untracked mirror satisfy a path already tracked
// by the opposite channel; unrelated untracked files are outside this guard.
export async function validateMirrorClosure(registry, root, docsRoot, errors) {
  const kitIds = sorted(Object.keys(registry.channels.stable.kits));
  const mirrorRequired = kitIds.every((kitId) => {
    const stable = registry.channels.stable.kits[kitId];
    const beta = registry.channels.beta.kits[kitId];
    return beta && RUNTIMES.every((runtime) =>
      stable.artifacts[runtime]?.archive?.sha256 === beta.artifacts[runtime]?.archive?.sha256);
  });
  if (!mirrorRequired) return;

  for (const kitId of kitIds) {
    if (registry.channels.stable.kits[kitId].snapshotDigest !== registry.channels.beta.kits[kitId].snapshotDigest) {
      errors.push(`Stable/Beta ${kitId} byte mirror: all runtime artifact hashes match but snapshots differ`);
    }
  }

  const trackedPaths = trackedKitPaths(root, errors);
  const [stableTree, betaTree] = await Promise.all([
    readTrackedTree(docsRoot, 'stable', trackedPaths, errors),
    readTrackedTree(docsRoot, 'beta', trackedPaths, errors),
  ]);
  for (const path of trackedPaths) {
    if (stableTree.has(path) && betaTree.has(path) && !stableTree.get(path).equals(betaTree.get(path))) {
      errors.push(`Stable/Beta full kits tree: divergent bytes at ${path}`);
    }
  }
}

export async function validateInventory(snapshot, path, label, errors) {
  if (!path) return false;
  const raw = await readJson(path);
  const entries = Array.isArray(raw) ? raw : raw.identities;
  if (!Array.isArray(entries)) {
    errors.push(`${label}: inventory must be an array or an object with identities`);
    return true;
  }
  const expected = new Map(snapshot.identities.map((entry) => [entry.sourceIdentity, entry.declaredInvocation]));
  const actual = new Map(entries.map((entry) => [entry.sourceIdentity, entry.declaredInvocation]));
  addDifference(errors, `${label} source inventory`, new Set(expected.keys()), new Set(actual.keys()));
  for (const [source, invocation] of expected) {
    if (actual.has(source) && actual.get(source) !== invocation) errors.push(`${label}/${source}: inventory invocation ${actual.get(source)} does not match ${invocation}`);
  }
  return true;
}

export function formatReport(report) {
  return `${report.channel}/${report.kitId}: total=${report.total}, public=${report.public}, internal=${report.internal}, details=${report.details}, nav=${report.nav}, artifacts=${report.artifacts}`;
}
