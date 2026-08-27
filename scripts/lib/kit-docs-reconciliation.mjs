import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import {
  access,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
} from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { canonicalSnapshotDigest, RUNTIMES, validateRegistry } from './kit-catalog.mjs';

export const BASE_DOCS_COMMIT = '2ca17fab83097dfe96da28c5407337224f87f688';
export const DEFAULT_MANIFEST_PATH = 'docs-reconciliations/stable-kit-v2.14.0.json';
export const DEFAULT_KIT_IDS = Object.freeze(['engineer', 'marketing']);
const HEX_64 = /^[a-f0-9]{64}$/;
const REGULAR_MODES = new Set(['100644', '100755']);
const CLAIM_SCOPE = 'This tool validates only the finite externalClaims ledger; release-audit is responsible for discovering claims.';

const EXTERNAL_CLAIM_DEFINITIONS = Object.freeze([
  {
    claimId: 'software-delivery-team-capability-en', pairId: 'software-delivery-team-capability', locale: 'en',
    rationale: 'Apply the release-audited Team capability correction while preserving unrelated Stable prose.',
    relativePath: 'kits/workflows/software-delivery.en.mdx',
    oldStart: '| Claude Code team execution |', newStart: '| Live team execution |',
    end: '\n\nDefine the work graph before dispatch:',
  },
  {
    claimId: 'software-delivery-team-capability-vi', pairId: 'software-delivery-team-capability', locale: 'vi',
    rationale: 'Apply the release-audited Team capability correction while preserving unrelated Stable prose.',
    relativePath: 'kits/workflows/software-delivery.vi.mdx',
    oldStart: '| Claude Code team execution |', newStart: '| Live team execution |',
    end: '\n\nĐịnh nghĩa work graph trước dispatch:',
  },
  {
    claimId: 'kit-installation-capability-summary-en', pairId: 'kit-installation-capability-summary', locale: 'en',
    rationale: 'Apply the release-audited capability-summary correction without copying unrelated Beta troubleshooting prose.',
    relativePath: 'troubleshooting/kit-installation.en.mdx',
    oldStart: 'A separate `Capabilities excluded', newStart: 'A separate `Capabilities excluded',
    end: '\n\nWhen the target already contains files,',
  },
  {
    claimId: 'kit-installation-capability-summary-vi', pairId: 'kit-installation-capability-summary', locale: 'vi',
    rationale: 'Apply the release-audited capability-summary correction without copying unrelated Beta troubleshooting prose.',
    relativePath: 'troubleshooting/kit-installation.vi.mdx',
    oldStart: 'Summary riêng `Capabilities excluded', newStart: 'Summary riêng `Capabilities excluded',
    end: '\n\nKhi đích đã có tệp,',
  },
  {
    claimId: 'runtime-team-discovery-en', pairId: 'runtime-team-discovery', locale: 'en',
    rationale: 'Apply the release-audited runtime Team-discovery correction without copying unrelated Beta troubleshooting prose.',
    relativePath: 'troubleshooting/runtime-cannot-find-skill-or-agent.en.mdx',
    oldStart: '## If Codex cannot find ak:team', newStart: '## If Codex cannot find ak:team',
    end: '\n\n## If the install says Hooks were dropped',
  },
  {
    claimId: 'runtime-team-discovery-vi', pairId: 'runtime-team-discovery', locale: 'vi',
    rationale: 'Apply the release-audited runtime Team-discovery correction without copying unrelated Beta troubleshooting prose.',
    relativePath: 'troubleshooting/runtime-cannot-find-skill-or-agent.vi.mdx',
    oldStart: '## Nếu Codex không tìm thấy ak:team', newStart: '## Nếu Codex không tìm thấy ak:team',
    end: '\n\n## Nếu bản cài báo Hooks bị bỏ',
  },
]);

const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const sorted = (values) => [...values].sort(compare);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(sorted(Object.keys(value)).map((key) => [key, canonicalValue(value[key])]));
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function manifestDigest(manifest) {
  const copy = structuredClone(manifest);
  delete copy.manifestDigest;
  return sha256(Buffer.from(canonicalJson(copy)));
}

export function externalClaimsDigest(claims) {
  return sha256(Buffer.from(canonicalJson(claims), 'utf8'));
}

export function closureDigest(postimageInventoryDigest, externalClaimsDigestValue) {
  return sha256(Buffer.from(canonicalJson({ postimageInventoryDigest, externalClaimsDigest: externalClaimsDigestValue }), 'utf8'));
}

function inventoryDigest(rows) {
  return sha256(Buffer.from(canonicalJson(rows)));
}

function fail(message) {
  throw new Error(`Kit docs reconciliation: ${message}`);
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function git(root, args, { encoding } = {}) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding, maxBuffer: 128 * 1024 * 1024 });
  if (result.status !== 0) fail(`git ${args.join(' ')} failed: ${(result.stderr || '').toString().trim()}`);
  return result.stdout;
}

function resolveCommit(root, revision) {
  const resolved = git(root, ['rev-parse', '--verify', `${revision}^{commit}`], { encoding: 'utf8' }).trim();
  if (!/^[a-f0-9]{40}$/.test(resolved)) fail(`invalid Git commit ${revision}`);
  return resolved;
}

function assertRepoPath(path, channel) {
  if (typeof path !== 'string' || !path || path.includes('\0') || path.includes('\\') || path.startsWith('/') || posix.normalize(path) !== path) {
    fail(`disallowed repository path ${JSON.stringify(path)}`);
  }
  if (path.split('/').some((part) => !part || part === '.' || part === '..')) fail(`disallowed repository path ${path}`);
  const prefix = `content/docs/${channel}/`;
  if (!path.startsWith(prefix)) fail(`${channel} path must start with ${prefix}: ${path}`);
  if (path.split('/').some((part) => ['reference', 'reference-derived', 'cli'].includes(part))) {
    fail(`generated/reference/CLI path is not allowed: ${path}`);
  }
}

function absoluteFromRepo(root, repoPath) {
  const absolute = resolve(root, ...repoPath.split('/'));
  if (!absolute.startsWith(`${resolve(root)}${sep}`)) fail(`path escapes repository: ${repoPath}`);
  return absolute;
}

async function manifestAbsolute(root, manifestPath, { allowMissing = false } = {}) {
  if (typeof manifestPath !== 'string' || !/^docs-reconciliations\/[a-z0-9][a-z0-9.-]*\.json$/.test(manifestPath)) {
    fail(`manifest must be a direct JSON file under docs-reconciliations: ${JSON.stringify(manifestPath)}`);
  }
  const absolute = absoluteFromRepo(root, manifestPath);
  if (await exists(absolute)) {
    const info = await lstat(absolute);
    if (info.isSymbolicLink() || !info.isFile()) fail(`manifest is not a regular file: ${manifestPath}`);
  } else if (!allowMissing) fail(`manifest does not exist: ${manifestPath}`);
  return absolute;
}

async function assertSafeWorktreePath(root, repoPath, { allowMissing = false } = {}) {
  const absolute = absoluteFromRepo(root, repoPath);
  const parts = relative(resolve(root), absolute).split(sep);
  let cursor = resolve(root);
  for (let index = 0; index < parts.length; index += 1) {
    cursor = join(cursor, parts[index]);
    try {
      const info = await lstat(cursor);
      if (info.isSymbolicLink()) fail(`symlink is not allowed: ${repoPath}`);
      if (index < parts.length - 1 && !info.isDirectory()) fail(`non-directory path component: ${repoPath}`);
      if (index === parts.length - 1 && !info.isFile()) fail(`target is not a regular file: ${repoPath}`);
      if (info.isDirectory() && await exists(join(cursor, '.generated'))) fail(`generated directory is not allowed: ${repoPath}`);
    } catch (error) {
      if (error.code === 'ENOENT' && allowMissing) break;
      throw error;
    }
  }
  return absolute;
}

function gitBlobByOid(root, oid) {
  return git(root, ['cat-file', 'blob', oid]);
}

function gitTree(root, commit, prefix, channel) {
  const output = git(root, ['ls-tree', '-r', '-z', commit, '--', prefix]).toString('utf8');
  const rows = [];
  for (const record of output.split('\0').filter(Boolean)) {
    const tab = record.indexOf('\t');
    const header = record.slice(0, tab).split(' ');
    const path = record.slice(tab + 1);
    if (header.length !== 3 || header[1] !== 'blob') continue;
    const [mode, , oid] = header;
    if (!REGULAR_MODES.has(mode)) continue;
    assertRepoPath(path, channel);
    const bytes = gitBlobByOid(root, oid);
    rows.push({ path, mode, sha256: sha256(bytes), size: bytes.length, bytes });
  }
  rows.sort((left, right) => compare(left.path, right.path));
  return rows;
}

function publicInventory(rows) {
  return rows.map(({ path, mode, sha256: digest, size }) => ({ path, mode, sha256: digest, size }));
}

function mapBetaToStable(path) {
  assertRepoPath(path, 'beta');
  return path.replace(/^content\/docs\/beta\//, 'content/docs/stable/');
}

function extractFragment(body, start, end, label) {
  const first = body.indexOf(start);
  if (first < 0) fail(`${label}: start marker not found`);
  if (body.indexOf(start, first + start.length) >= 0) fail(`${label}: start marker is not unique`);
  const last = body.indexOf(end, first + start.length);
  if (last < 0) fail(`${label}: end marker not found`);
  return body.slice(first, last);
}

export function countOccurrences(body, fragment) {
  if (!fragment) return 0;
  let count = 0;
  let offset = 0;
  while ((offset = body.indexOf(fragment, offset)) >= 0) {
    count += 1;
    offset += 1;
  }
  return count;
}

function replaceExactlyOnce(body, oldFragment, newFragment, label) {
  const count = countOccurrences(body, oldFragment);
  if (count !== 1) fail(`${label}: expected old fragment once, found ${count}`);
  return body.replace(oldFragment, newFragment);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function readEvidence(root, registryPath, channelsPath) {
  const [registryBytes, channelsBytes] = await Promise.all([
    readFile(resolve(root, registryPath)),
    readFile(resolve(root, channelsPath)),
  ]);
  const registry = JSON.parse(registryBytes);
  const channels = JSON.parse(channelsBytes);
  const errors = validateRegistry(registry, channels);
  if (errors.length) fail(`schema-v2 registry/channels invalid:\n- ${errors.sort().join('\n- ')}`);
  return { registry, channels, registrySha256: sha256(registryBytes), channelsSha256: sha256(channelsBytes) };
}

function channelIdentity(registry, channel) {
  const value = registry.channels[channel];
  return { tag: value.tag, version: value.version, sourceCommit: value.sourceCommit, releaseUrl: value.releaseUrl };
}

function catalogEvidence(evidence, kitIds) {
  const ids = sorted(kitIds);
  const snapshots = [];
  const bindings = [];
  const triadRows = [];
  for (const kitId of ids) {
    const stable = evidence.registry.channels.stable.kits[kitId];
    const beta = evidence.registry.channels.beta.kits[kitId];
    if (!stable || !beta) fail(`missing Stable/Beta binding for Kit ${kitId}`);
    if (stable.snapshotDigest !== beta.snapshotDigest) fail(`${kitId}: Stable/Beta inventory snapshots differ`);
    const snapshot = evidence.registry.inventorySnapshots[stable.snapshotDigest];
    if (!snapshot || snapshot.kitId !== kitId || canonicalSnapshotDigest(snapshot) !== stable.snapshotDigest) {
      fail(`${kitId}: selected inventory snapshot is invalid`);
    }
    snapshots.push({ kitId, snapshotDigest: stable.snapshotDigest, snapshot: structuredClone(snapshot) });
    bindings.push({ kitId, stable: structuredClone(stable), beta: structuredClone(beta) });
    for (const runtime of RUNTIMES) {
      const stableTriad = stable.artifacts[runtime];
      const betaTriad = beta.artifacts[runtime];
      if (!stableTriad || !betaTriad || stableTriad.archive?.sha256 !== betaTriad.archive?.sha256) {
        fail(`${kitId}/${runtime}: Stable/Beta archive SHA-256 mismatch`);
      }
      for (const [channel, triad] of [['stable', stableTriad], ['beta', betaTriad]]) {
        triadRows.push({ channel, kitId, runtime, ...structuredClone(triad) });
      }
    }
  }
  triadRows.sort((left, right) => compare(`${left.channel}/${left.kitId}/${left.runtime}`, `${right.channel}/${right.kitId}/${right.runtime}`));
  const manifestRows = triadRows.map(({ channel, kitId, runtime, manifest }) => ({ channel, kitId, runtime, manifest }));
  return {
    stable: channelIdentity(evidence.registry, 'stable'),
    beta: channelIdentity(evidence.registry, 'beta'),
    kitIds: ids,
    snapshots,
    bindings,
    triadRows,
    digestDefinitions: {
      manifestSetDigest: 'sha256(canonical-json(tuple-sorted triadRows projected to channel,kitId,runtime,manifest))',
      matrixDigest: 'sha256(canonical-json(tuple-sorted exact triadRows including archive,manifest,sidecar))',
      closureDigest: 'sha256(canonical-json({postimageInventoryDigest,externalClaimsDigest}))',
    },
    manifestSetDigest: inventoryDigest(manifestRows),
    matrixDigest: inventoryDigest(triadRows),
  };
}

function embeddedCatalogEvidence(evidence) {
  const fake = {
    registry: {
      inventorySnapshots: Object.fromEntries((evidence.snapshots ?? []).map((row) => [row.snapshotDigest, row.snapshot])),
      channels: {
        stable: { ...evidence.stable, kits: {} },
        beta: { ...evidence.beta, kits: {} },
      },
    },
  };
  for (const binding of evidence.bindings ?? []) {
    if (fake.registry.channels.stable.kits[binding.kitId]) fail(`duplicate embedded binding for Kit ${binding.kitId}`);
    fake.registry.channels.stable.kits[binding.kitId] = binding.stable;
    fake.registry.channels.beta.kits[binding.kitId] = binding.beta;
  }
  return catalogEvidence(fake, evidence.kitIds ?? []);
}

function assertLocalePairs(rows, label) {
  const pairs = new Map();
  for (const row of rows) {
    const locales = pairs.get(row.pairId) ?? new Set();
    locales.add(row.locale);
    pairs.set(row.pairId, locales);
  }
  for (const [pairId, locales] of pairs) {
    if (locales.size !== 2 || !locales.has('en') || !locales.has('vi')) fail(`${label}: incomplete EN/VI pair ${pairId}`);
  }
}

function buildExternalClaims(root, baseCommit, definitions) {
  const claims = [];
  for (const definition of definitions) {
    const sourcePath = `content/docs/beta/${definition.relativePath}`;
    const targetPath = `content/docs/stable/${definition.relativePath}`;
    const source = gitTree(root, baseCommit, sourcePath, 'beta')[0];
    const target = gitTree(root, baseCommit, targetPath, 'stable')[0];
    if (!source || !target) fail(`external claim source/preimage is missing: ${targetPath}`);
    const sourceText = source.bytes.toString('utf8');
    const targetText = target.bytes.toString('utf8');
    const oldFragment = extractFragment(targetText, definition.oldStart, definition.end, `${targetPath} old fragment`);
    const newFragment = extractFragment(sourceText, definition.newStart, definition.end, `${sourcePath} new fragment`);
    if (!oldFragment || !newFragment || oldFragment === newFragment) fail(`${targetPath}: external claim must change bytes`);
    const postimage = Buffer.from(replaceExactlyOnce(targetText, oldFragment, newFragment, targetPath));
    claims.push({
      claimId: definition.claimId,
      rationale: definition.rationale,
      pairId: definition.pairId,
      locale: definition.locale,
      sourcePath,
      targetPath,
      oldFragment,
      newFragment,
      occurrence: 1,
      sourceSha256: source.sha256,
      wholeFilePreimageSha256: target.sha256,
      wholeFilePostimageSha256: sha256(postimage),
    });
  }
  claims.sort((left, right) => compare(left.claimId, right.claimId));
  if (new Set(claims.map((claim) => claim.claimId)).size !== claims.length) fail('duplicate external claimId');
  if (new Set(claims.map((claim) => claim.targetPath)).size !== claims.length) fail('duplicate external claim target');
  assertLocalePairs(claims, 'external claims');
  return claims;
}

function treeEvidence(root, baseCommit, externalClaims) {
  const sourceRows = gitTree(root, baseCommit, 'content/docs/beta/kits', 'beta');
  const preimageRows = gitTree(root, baseCommit, 'content/docs/stable/kits', 'stable');
  if (!sourceRows.length) fail('base Beta Kit tree is empty');
  const sourceInventory = publicInventory(sourceRows);
  const preimageInventory = publicInventory(preimageRows);
  const sourceByTarget = new Map(sourceRows.map((row) => [mapBetaToStable(row.path), row]));
  const preimageByPath = new Map(preimageRows.map((row) => [row.path, row]));
  const extras = preimageRows.filter((row) => !sourceByTarget.has(row.path)).map((row) => row.path);
  if (extras.length) fail(`base Stable Kit tree has extra paths [${extras.join(', ')}]`);
  const postimageInventory = sourceRows.map((row) => ({
    path: mapBetaToStable(row.path), mode: row.mode, sha256: row.sha256, size: row.size,
  })).sort((left, right) => compare(left.path, right.path));
  const claimTargets = new Set(externalClaims.map((claim) => claim.targetPath));
  for (const claim of externalClaims.filter((row) => row.targetPath.startsWith('content/docs/stable/kits/'))) {
    const source = sourceByTarget.get(claim.targetPath);
    if (!source) fail(`Kit-tree external claim is outside the source tree: ${claim.targetPath}`);
    if (claim.wholeFilePostimageSha256 !== source.sha256) fail(`Kit-tree external claim does not close to exact Beta bytes: ${claim.targetPath}`);
  }
  const copyOperations = [];
  for (const [targetPath, source] of [...sourceByTarget].sort(([left], [right]) => compare(left, right))) {
    if (claimTargets.has(targetPath)) continue;
    const preimage = preimageByPath.get(targetPath);
    if (preimage?.sha256 === source.sha256) continue;
    copyOperations.push({
      sourcePath: source.path,
      targetPath,
      sourceSha256: source.sha256,
      targetPreimageSha256: preimage?.sha256 ?? null,
      expectedPostimageSha256: source.sha256,
    });
  }
  return {
    sourceInventory,
    sourceInventoryDigest: inventoryDigest(sourceInventory),
    preimageInventory,
    preimageInventoryDigest: inventoryDigest(preimageInventory),
    postimageInventory,
    postimageInventoryDigest: inventoryDigest(postimageInventory),
    copyOperations,
  };
}

function countsFor(tree, claims) {
  const additions = tree.copyOperations.filter((row) => row.targetPreimageSha256 === null).length;
  return {
    sourceTreeFiles: tree.sourceInventory.length,
    preimageTreeFiles: tree.preimageInventory.length,
    postimageTreeFiles: tree.postimageInventory.length,
    copyOperations: tree.copyOperations.length,
    copyAdditions: additions,
    copyUpdates: tree.copyOperations.length - additions,
    externalClaims: claims.length,
    totalOperations: tree.copyOperations.length + claims.length,
    targetWrites: new Set([...tree.copyOperations, ...claims].map((row) => row.targetPath)).size,
  };
}

function sameCanonical(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function manifestWithoutDigest({ evidence, copyOperations, externalClaims, counts }) {
  const claimsDigest = externalClaimsDigest(externalClaims);
  return {
    schemaVersion: 2,
    kind: 'stable-kit-docs-reconciliation',
    evidence,
    copyOperations,
    externalClaims,
    externalClaimsDigest: claimsDigest,
    closureDigest: closureDigest(evidence.postimageInventoryDigest, claimsDigest),
    counts,
  };
}

async function currentHash(root, targetPath) {
  const absolute = await assertSafeWorktreePath(root, targetPath, { allowMissing: true });
  return await exists(absolute) ? sha256(await readFile(absolute)) : null;
}

async function recursiveWorktreeFiles(root, repoDirectory, rows = []) {
  const absolute = absoluteFromRepo(root, repoDirectory);
  if (!await exists(absolute)) return rows;
  for (const entry of (await readdir(absolute, { withFileTypes: true })).sort((a, b) => compare(a.name, b.name))) {
    const path = `${repoDirectory}/${entry.name}`;
    if (entry.isDirectory()) await recursiveWorktreeFiles(root, path, rows);
    else if (entry.isFile()) {
      const bytes = await readFile(absoluteFromRepo(root, path));
      rows.push({ path, sha256: sha256(bytes), size: bytes.length });
    } else fail(`Stable Kit tree contains a non-regular entry: ${path}`);
  }
  return rows;
}

async function assertTargetTree(root, postimageInventory, { exact }) {
  const actual = await recursiveWorktreeFiles(root, 'content/docs/stable/kits');
  const expectedByPath = new Map(postimageInventory.map((row) => [row.path, row]));
  const actualByPath = new Map(actual.map((row) => [row.path, row]));
  const extra = sorted([...actualByPath.keys()].filter((path) => !expectedByPath.has(path)));
  if (extra.length) fail(`Stable Kit tree has extra paths [${extra.join(', ')}]`);
  if (!exact) return;
  const missing = sorted([...expectedByPath.keys()].filter((path) => !actualByPath.has(path)));
  if (missing.length) fail(`Stable Kit tree is missing paths [${missing.join(', ')}]`);
  for (const [path, expected] of expectedByPath) {
    if (actualByPath.get(path).sha256 !== expected.sha256) fail(`Stable Kit tree postimage mismatch: ${path}`);
  }
}

function operationRows(manifest) {
  return [
    ...manifest.copyOperations.map((row) => ({
      ...row,
      preimageSha256: row.targetPreimageSha256,
      postimageSha256: row.expectedPostimageSha256,
      kind: 'copy',
    })),
    ...manifest.externalClaims.map((row) => ({
      ...row,
      preimageSha256: row.wholeFilePreimageSha256,
      postimageSha256: row.wholeFilePostimageSha256,
      kind: 'claim',
    })),
  ].sort((left, right) => compare(left.targetPath, right.targetPath));
}

async function operationPostimage(root, manifest, row) {
  if (row.kind === 'copy') {
    const source = gitTree(root, manifest.evidence.baseDocsCommit, row.sourcePath, 'beta')[0];
    if (!source || source.path !== row.sourcePath) fail(`historical source is missing: ${row.sourcePath}`);
    return source.bytes;
  }
  const baseTargets = gitTree(root, manifest.evidence.baseDocsCommit, row.targetPath, 'stable');
  const base = baseTargets[0];
  if (!base || base.path !== row.targetPath) fail(`historical claim preimage is missing: ${row.targetPath}`);
  return Buffer.from(replaceExactlyOnce(base.bytes.toString('utf8'), row.oldFragment, row.newFragment, row.targetPath));
}

async function classifyState(root, manifest) {
  const operations = operationRows(manifest);
  const operationTargets = new Set(operations.map((row) => row.targetPath));
  for (const row of manifest.evidence.postimageInventory) {
    if (!operationTargets.has(row.path) && await currentHash(root, row.path) !== row.sha256) {
      fail(`non-operation Kit target is not the exact postimage: ${row.path}`);
    }
  }
  const classified = [];
  for (const row of operations) {
    const hash = await currentHash(root, row.targetPath);
    const state = hash === row.postimageSha256 ? 'post' : hash === row.preimageSha256 ? 'pre' : 'third';
    if (state === 'third') fail(`target is neither exact preimage nor postimage: ${row.targetPath}`);
    classified.push({ row, state });
  }
  return classified;
}

function exactKeys(value, expected, label) {
  if (!isObject(value) || !sameCanonical(sorted(Object.keys(value)), sorted(expected))) fail(`${label} fields are not exact`);
}

function validateShape(manifest) {
  if (!isObject(manifest) || manifest.schemaVersion !== 2 || manifest.kind !== 'stable-kit-docs-reconciliation') fail('unsupported manifest');
  if (!Array.isArray(manifest.copyOperations) || !Array.isArray(manifest.externalClaims) || !isObject(manifest.evidence) || !isObject(manifest.counts)) {
    fail('manifest shape is incomplete');
  }
  exactKeys(manifest, ['schemaVersion', 'kind', 'evidence', 'copyOperations', 'externalClaims', 'externalClaimsDigest', 'closureDigest', 'counts', 'manifestDigest'], 'manifest');
  exactKeys(manifest.evidence, [
    'baseDocsCommit', 'registrySha256', 'channelsSha256', 'stable', 'beta', 'kitIds', 'snapshots', 'bindings',
    'triadRows', 'digestDefinitions', 'manifestSetDigest', 'matrixDigest',
    'sourceInventory', 'sourceInventoryDigest', 'preimageInventory', 'preimageInventoryDigest',
    'postimageInventory', 'postimageInventoryDigest', 'externalClaimsPolicy',
  ], 'manifest evidence');
  exactKeys(manifest.counts, [
    'sourceTreeFiles', 'preimageTreeFiles', 'postimageTreeFiles', 'copyOperations', 'copyAdditions',
    'copyUpdates', 'externalClaims', 'totalOperations', 'targetWrites',
  ], 'manifest counts');
  for (const row of manifest.copyOperations) exactKeys(row, [
    'sourcePath', 'targetPath', 'sourceSha256', 'targetPreimageSha256', 'expectedPostimageSha256',
  ], `copy operation ${row?.targetPath ?? '<unknown>'}`);
  for (const row of manifest.externalClaims) exactKeys(row, [
    'claimId', 'rationale', 'pairId', 'locale', 'sourcePath', 'targetPath', 'oldFragment', 'newFragment',
    'occurrence', 'sourceSha256', 'wholeFilePreimageSha256', 'wholeFilePostimageSha256',
  ], `external claim ${row?.claimId ?? '<unknown>'}`);
  for (const inventory of ['sourceInventory', 'preimageInventory', 'postimageInventory']) {
    if (!Array.isArray(manifest.evidence[inventory])) fail(`${inventory} must be an array`);
    for (const row of manifest.evidence[inventory]) exactKeys(row, ['path', 'mode', 'sha256', 'size'], `${inventory} row`);
  }
  if (!HEX_64.test(manifest.manifestDigest ?? '') || manifestDigest(manifest) !== manifest.manifestDigest) fail('manifest canonical digest mismatch');
  if (!HEX_64.test(manifest.externalClaimsDigest ?? '') || externalClaimsDigest(manifest.externalClaims) !== manifest.externalClaimsDigest) {
    fail('externalClaims canonical digest mismatch');
  }
  if (!HEX_64.test(manifest.closureDigest ?? '') ||
      closureDigest(manifest.evidence.postimageInventoryDigest, manifest.externalClaimsDigest) !== manifest.closureDigest) {
    fail('closure canonical digest mismatch');
  }
  const targets = new Set();
  for (const row of operationRows(manifest)) {
    assertRepoPath(row.targetPath, 'stable');
    assertRepoPath(row.sourcePath, 'beta');
    if (targets.has(row.targetPath)) fail(`overlapping operation target: ${row.targetPath}`);
    targets.add(row.targetPath);
    if (row.preimageSha256 !== null && !HEX_64.test(row.preimageSha256 ?? '')) fail(`invalid preimage hash: ${row.targetPath}`);
    if (!HEX_64.test(row.postimageSha256 ?? '')) fail(`invalid postimage hash: ${row.targetPath}`);
  }
  for (const claim of manifest.externalClaims) {
    if (claim.occurrence !== 1 || !claim.claimId || !claim.rationale || !claim.pairId || !['en', 'vi'].includes(claim.locale) ||
        typeof claim.oldFragment !== 'string' || typeof claim.newFragment !== 'string' || !claim.oldFragment || claim.oldFragment === claim.newFragment) {
      fail(`invalid external claim: ${claim.claimId ?? '<unknown>'}`);
    }
  }
  assertLocalePairs(manifest.externalClaims, 'manifest external claims');
}

export async function validateReconciliation({
  root,
  manifest,
  registryPath = 'kit-catalog-identities.json',
  channelsPath = 'channels.json',
  baseCommit = BASE_DOCS_COMMIT,
  kitIds = DEFAULT_KIT_IDS,
  claimDefinitions = EXTERNAL_CLAIM_DEFINITIONS,
  requireLiveEvidence = false,
} = {}) {
  validateShape(manifest);
  const resolvedBase = resolveCommit(root, baseCommit);
  if (manifest.evidence.baseDocsCommit !== resolvedBase) fail(`manifest base commit must be ${resolvedBase}`);
  if (manifest.evidence.externalClaimsPolicy !== CLAIM_SCOPE) fail('external claim validation scope is missing or changed');
  const expectedClaims = buildExternalClaims(root, resolvedBase, claimDefinitions);
  if (!sameCanonical(expectedClaims, manifest.externalClaims)) fail('external claims drift from the finite approved ledger');
  const expectedTree = treeEvidence(root, resolvedBase, expectedClaims);
  for (const key of ['sourceInventory', 'sourceInventoryDigest', 'preimageInventory', 'preimageInventoryDigest', 'postimageInventory', 'postimageInventoryDigest']) {
    if (!sameCanonical(expectedTree[key], manifest.evidence[key])) fail(`${key} drift from the base Kit trees`);
  }
  if (!sameCanonical(expectedTree.copyOperations, manifest.copyOperations)) fail('copy operation closure drift from the full base Kit tree');
  const expectedCounts = countsFor(expectedTree, expectedClaims);
  if (!sameCanonical(expectedCounts, manifest.counts)) fail('manifest operation counts are inconsistent');
  if (manifest.counts.totalOperations !== manifest.counts.targetWrites) fail('operation targets are not unique');

  const embedded = embeddedCatalogEvidence(manifest.evidence);
  for (const key of ['stable', 'beta', 'kitIds', 'snapshots', 'bindings', 'triadRows', 'digestDefinitions', 'manifestSetDigest', 'matrixDigest']) {
    if (!sameCanonical(embedded[key], manifest.evidence[key])) fail(`embedded catalog ${key} drift`);
  }
  if (!sameCanonical(manifest.evidence.kitIds, sorted(kitIds))) fail('manifest selected Kit set is unauthorized');

  let liveEvidence = null;
  if (requireLiveEvidence) {
    liveEvidence = await readEvidence(root, registryPath, channelsPath);
    if (manifest.evidence.registrySha256 !== liveEvidence.registrySha256 || manifest.evidence.channelsSha256 !== liveEvidence.channelsSha256) {
      fail('registry/channels drift from manifest evidence');
    }
    const liveCatalog = catalogEvidence(liveEvidence, kitIds);
    for (const key of Object.keys(liveCatalog)) {
      if (!sameCanonical(liveCatalog[key], manifest.evidence[key])) fail(`live catalog ${key} drift from manifest evidence`);
    }
  }
  await assertTargetTree(root, manifest.evidence.postimageInventory, { exact: false });
  return { liveEvidence, expectedTree, embedded };
}

async function writeAtomic(path, bytes, renameImpl = rename, suffix = process.pid, temporaryDirectory = dirname(path)) {
  await mkdir(dirname(path), { recursive: true });
  await mkdir(temporaryDirectory, { recursive: true });
  const temporary = join(temporaryDirectory, `.${path.split(sep).at(-1)}.reconcile-${suffix}.tmp`);
  let handle;
  try {
    await rm(temporary, { force: true });
    handle = await open(temporary, 'wx', 0o644);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await renameImpl(temporary, path);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
  }
}

export async function createReconciliation({
  root,
  manifestPath = DEFAULT_MANIFEST_PATH,
  registryPath = 'kit-catalog-identities.json',
  channelsPath = 'channels.json',
  baseCommit = BASE_DOCS_COMMIT,
  kitIds = DEFAULT_KIT_IDS,
  claimDefinitions = EXTERNAL_CLAIM_DEFINITIONS,
} = {}) {
  if (!root) fail('root is required');
  const absoluteManifest = await manifestAbsolute(root, manifestPath, { allowMissing: true });
  if (await exists(absoluteManifest)) {
    const manifest = await readJson(absoluteManifest);
    await validateReconciliation({ root, manifest, registryPath, channelsPath, baseCommit, kitIds, claimDefinitions, requireLiveEvidence: true });
    await classifyState(root, manifest);
    return { manifest, created: false };
  }
  const resolvedBase = resolveCommit(root, baseCommit);
  const liveEvidence = await readEvidence(root, registryPath, channelsPath);
  const catalog = catalogEvidence(liveEvidence, kitIds);
  const claims = buildExternalClaims(root, resolvedBase, claimDefinitions);
  const tree = treeEvidence(root, resolvedBase, claims);
  const evidence = {
    baseDocsCommit: resolvedBase,
    registrySha256: liveEvidence.registrySha256,
    channelsSha256: liveEvidence.channelsSha256,
    ...catalog,
    sourceInventory: tree.sourceInventory,
    sourceInventoryDigest: tree.sourceInventoryDigest,
    preimageInventory: tree.preimageInventory,
    preimageInventoryDigest: tree.preimageInventoryDigest,
    postimageInventory: tree.postimageInventory,
    postimageInventoryDigest: tree.postimageInventoryDigest,
    externalClaimsPolicy: CLAIM_SCOPE,
  };
  const body = manifestWithoutDigest({ evidence, copyOperations: tree.copyOperations, externalClaims: claims, counts: countsFor(tree, claims) });
  const manifest = { ...body, manifestDigest: manifestDigest(body) };
  await validateReconciliation({ root, manifest, registryPath, channelsPath, baseCommit, kitIds, claimDefinitions, requireLiveEvidence: true });
  await classifyState(root, manifest);
  await mkdir(dirname(absoluteManifest), { recursive: true });
  await writeAtomic(absoluteManifest, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
  return { manifest, created: true };
}

export async function checkReconciliation({ root, manifestPath = DEFAULT_MANIFEST_PATH, diffBase, ...options } = {}) {
  const manifest = await readJson(await manifestAbsolute(root, manifestPath));
  await validateReconciliation({ root, manifest, ...options });
  const states = await classifyState(root, manifest);
  const pending = states.filter(({ state }) => state === 'pre');
  if (pending.length) fail(`reconciliation has ${pending.length} unapplied target(s), first: ${pending[0].row.targetPath}`);
  await assertTargetTree(root, manifest.evidence.postimageInventory, { exact: true });
  if (diffBase) await checkDiffAllowlist({ root, manifest, manifestPath, base: diffBase });
  return { manifest, checked: manifest.counts.totalOperations, diffChecked: Boolean(diffBase) };
}

export async function applyReconciliation({ root, manifestPath = DEFAULT_MANIFEST_PATH, renameImpl = rename, ...options } = {}) {
  const manifest = await readJson(await manifestAbsolute(root, manifestPath));
  const temporaryDirectory = absoluteFromRepo(root, 'content/docs/stable/.kit-docs-reconciliation-tmp');
  // A hard crash can leave only files owned by this exact tool directory. It is
  // outside kits/**, on the same filesystem as every target, and safe to clear
  // before resuming the manifest-bound preflight.
  await rm(temporaryDirectory, { recursive: true, force: true });
  await validateReconciliation({ root, manifest, ...options, requireLiveEvidence: true });
  const classified = await classifyState(root, manifest); // Entire preflight occurs before the first write.
  const pending = classified.filter(({ state }) => state === 'pre');
  const prepared = [];
  for (const { row } of pending) {
    const bytes = await operationPostimage(root, manifest, row);
    if (sha256(bytes) !== row.postimageSha256) fail(`computed postimage mismatch: ${row.targetPath}`);
    prepared.push({ row, bytes, absolute: await assertSafeWorktreePath(root, row.targetPath, { allowMissing: true }) });
  }
  for (let index = 0; index < prepared.length; index += 1) {
    const item = prepared[index];
    const hash = await currentHash(root, item.row.targetPath);
    if (hash !== item.row.preimageSha256) fail(`target changed after preflight: ${item.row.targetPath}`);
    await writeAtomic(item.absolute, item.bytes, renameImpl, `${process.pid}-${index}`, temporaryDirectory);
  }
  await rm(temporaryDirectory, { recursive: true, force: true });
  await checkReconciliation({ root, manifestPath, ...options });
  return { manifest, writes: prepared.length, skipped: classified.length - prepared.length, state: 'post' };
}

function parseNameStatus(output) {
  const tokens = output.toString('utf8').split('\0').filter(Boolean);
  const rows = [];
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++];
    const path = tokens[index++];
    if (!status || !path) fail('cannot parse Git diff status');
    if (status.startsWith('R') || status.startsWith('C')) rows.push({ status, oldPath: path, path: tokens[index++] });
    else rows.push({ status, path });
  }
  return rows;
}

export async function checkDiffAllowlist({ root, manifest, manifestPath = DEFAULT_MANIFEST_PATH, base }) {
  const resolvedBase = resolveCommit(root, base);
  // Rename detection must see the whole repository so a move across the Stable
  // boundary cannot be disguised as a scoped addition or deletion.
  const allRows = parseNameStatus(git(root, ['diff', '--name-status', '-z', '--find-renames', resolvedBase]));
  for (const row of allRows) {
    if ((row.status.startsWith('R') || row.status.startsWith('C')) &&
        (row.oldPath.startsWith('content/docs/stable/') || row.path.startsWith('content/docs/stable/'))) {
      fail(`Stable reconciliation diff contains a rename/copy: ${row.oldPath} -> ${row.path}`);
    }
  }
  const rows = allRows.filter((row) => row.path.startsWith('content/docs/stable/') || row.path === manifestPath);
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '-z', '--', 'content/docs/stable', manifestPath])
    .toString('utf8').split('\0').filter(Boolean).map((path) => ({ status: 'A', path, untracked: true }));
  const byPath = new Map([...rows, ...untracked].map((row) => [row.path, row]));
  const stableRows = [...byPath.values()].filter((row) => row.path.startsWith('content/docs/stable/'));
  const invalid = stableRows.filter((row) => !['A', 'M'].includes(row.status));
  if (invalid.length) fail(`Stable reconciliation diff contains deletion or unsupported status: ${invalid.map((row) => `${row.status} ${row.path}`).join(', ')}`);
  if (!stableRows.length) return { base: resolvedBase, stablePaths: 0 };

  const expected = new Set(operationRows(manifest).map((row) => row.targetPath));
  const actual = new Set(stableRows.map((row) => row.path));
  const missing = sorted([...expected].filter((path) => !actual.has(path)));
  const extra = sorted([...actual].filter((path) => !expected.has(path)));
  if (missing.length || extra.length) fail(`Stable diff/manifest target mismatch: missing [${missing.join(', ')}]; extra [${extra.join(', ')}]`);
  const manifestRow = byPath.get(manifestPath);
  if (!manifestRow || !['A', 'M'].includes(manifestRow.status)) fail(`manifest must be added or changed in the same diff: ${manifestPath}`);
  return { base: resolvedBase, stablePaths: actual.size };
}
