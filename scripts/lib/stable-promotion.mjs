import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { link, lstat, mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { parseManifest } from './manifest.mjs';
import { renderReleaseNotesMdx } from './release-notes.mjs';

export const PROMOTION_RECEIPT_SCHEMA_VERSION = 1;
export const PROMOTION_RECEIPT_KIND = 'stable-docs-promotion';
export const PROMOTIONS_PREFIX = 'docs-promotions/';
export const STABLE_PROMOTION_EVIDENCE_PREFIX = 'release-evidence/stable-promotions/';
export const STABLE_RELEASE_NOTES_RELATIVE_PATH = 'reference/release-notes.mdx';

const HEX_40 = /^[a-f0-9]{40}$/;
const HEX_64 = /^[a-f0-9]{64}$/;
const STABLE_TAG = /^v\d+\.\d+\.\d+$/;
const BETA_TAG = /^v\d+\.\d+\.\d+-beta\.\d+$/;
const REGULAR_MODES = new Set(['100644', '100755']);
const RECEIPT_KEYS = [
  'schemaVersion',
  'kind',
  'baseDocsCommit',
  'stableTag',
  'stableVersion',
  'stableSourceSha',
  'generatedAt',
  'promotedFrom',
  'sourceVerification',
  'betaRef',
  'betaCommit',
  'betaChannelsTagProof',
  'evidence',
  'releaseNotesOutputSha256',
  'betaSourceInventory',
  'betaSourceInventoryDigest',
  'stablePostimageInventory',
  'stablePostimageInventoryDigest',
  'channelsPreimageSha256',
  'channelsPostimageSha256',
  'changedStablePaths',
  'receiptDigest',
];
const INVENTORY_KEYS = ['path', 'mode', 'size', 'sha256'];
const EVIDENCE_KEYS = ['manifest', 'releaseNotes'];
const EVIDENCE_BINDING_KEYS = ['path', 'size', 'sha256'];

const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const sorted = (values) => [...values].sort(compare);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function fail(message) {
  throw new Error(`Stable promotion: ${message}`);
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(sorted(Object.keys(value)).map((key) => [key, canonicalValue(value[key])]));
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function inventoryDigest(inventory) {
  return sha256(Buffer.from(canonicalJson(inventory), 'utf8'));
}

export function promotionReceiptDigest(receipt) {
  const body = structuredClone(receipt);
  delete body.receiptDigest;
  return sha256(Buffer.from(`stable-docs-promotion-receipt:v1\n${canonicalJson(body)}`, 'utf8'));
}

function git(root, args, { allowFailure = false } = {}) {
  const result = spawnSync('git', ['-C', root, ...args], {
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.error) fail(`cannot run git ${args.join(' ')}: ${result.error.message}`);
  if (result.status !== 0 && !allowFailure) {
    fail(`git ${args.join(' ')} failed: ${(result.stderr || '').toString().trim()}`);
  }
  return result;
}

export function resolveCommit(root, revision) {
  if (typeof revision !== 'string' || !revision) fail('Git revision is required');
  const result = git(root, ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`], { allowFailure: true });
  if (result.status !== 0) fail(`cannot resolve Git commit ${JSON.stringify(revision)}`);
  const commit = result.stdout.toString('utf8').trim();
  if (!HEX_40.test(commit)) fail(`invalid resolved Git commit for ${JSON.stringify(revision)}`);
  return commit;
}

export function promotionBetaRef(promotedFrom) {
  if (!BETA_TAG.test(promotedFrom ?? '')) fail(`invalid promotedFrom for Beta tag ref: ${JSON.stringify(promotedFrom)}`);
  return `refs/tags/docs/${promotedFrom}`;
}

export function resolvePromotionBetaCommit(root, promotedFrom, suppliedRef = promotionBetaRef(promotedFrom)) {
  const expected = promotionBetaRef(promotedFrom);
  if (suppliedRef !== expected) {
    fail(`Beta source ref must be exactly ${expected}, got ${JSON.stringify(suppliedRef)}`);
  }
  const result = git(root, ['rev-parse', '--verify', '--end-of-options', `${expected}^{commit}`], { allowFailure: true });
  if (result.status !== 0) fail(`cannot resolve exact promotion tag ${JSON.stringify(expected)}`);
  const commit = result.stdout.toString('utf8').trim();
  if (!HEX_40.test(commit)) fail(`invalid peeled commit for promotion tag ${JSON.stringify(expected)}`);
  return commit;
}

function gitBlob(root, oid) {
  if (!HEX_40.test(oid)) fail(`invalid Git object id ${JSON.stringify(oid)}`);
  return git(root, ['cat-file', 'blob', oid]).stdout;
}

function gitPathBytes(root, commit, path) {
  const tree = git(root, ['ls-tree', '-z', commit, '--', path]).stdout;
  const records = splitNul(tree);
  if (records.length !== 1) fail(`Git path is missing or ambiguous at ${commit}: ${path}`);
  const parsed = parseLsTreeRecord(records[0]);
  if (parsed.path !== path || parsed.type !== 'blob' || !REGULAR_MODES.has(parsed.mode)) {
    fail(`Git path is not a regular file at ${commit}: ${path}`);
  }
  return gitBlob(root, parsed.oid);
}

function splitNul(buffer) {
  const records = [];
  let start = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] !== 0) continue;
    if (index > start) records.push(buffer.subarray(start, index));
    start = index + 1;
  }
  if (start !== buffer.length) fail('Git -z output is not NUL terminated');
  return records;
}

function decodePath(bytes) {
  let value;
  try {
    value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail('repository path is not valid UTF-8');
  }
  return value;
}

function assertRelativePath(path, label = 'inventory path') {
  if (typeof path !== 'string' || !path || path.includes('\\') || isAbsolute(path) || posix.normalize(path) !== path) {
    fail(`disallowed ${label}: ${JSON.stringify(path)}`);
  }
  if (path.normalize('NFC') !== path || /[\u0000-\u001f\u007f]/.test(path) || path.split('/').some((part) => !part || part === '.' || part === '..')) {
    fail(`disallowed ${label}: ${JSON.stringify(path)}`);
  }
}

function parseLsTreeRecord(record) {
  const tab = record.indexOf(9);
  if (tab < 0) fail('cannot parse Git tree record');
  const header = record.subarray(0, tab).toString('ascii').split(' ');
  if (header.length !== 3) fail('cannot parse Git tree record header');
  const [mode, type, oid] = header;
  const path = decodePath(record.subarray(tab + 1));
  return { mode, type, oid, path };
}

function publicInventory(rows) {
  return rows.map(({ path, mode, size, sha256: digest }) => ({ path, mode, size, sha256: digest }));
}

function assertNoDuplicatePaths(rows, label) {
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.path)) fail(`${label} contains duplicate path ${row.path}`);
    seen.add(row.path);
  }
}

export function gitChannelInventory(root, commit, channel) {
  if (!['beta', 'stable'].includes(channel)) fail(`unsupported docs channel ${JSON.stringify(channel)}`);
  const resolvedCommit = resolveCommit(root, commit);
  const prefix = `content/docs/${channel}/`;
  const output = git(root, ['ls-tree', '-r', '-z', '--full-tree', resolvedCommit, '--', prefix]).stdout;
  const rows = [];
  for (const record of splitNul(output)) {
    const parsed = parseLsTreeRecord(record);
    if (!parsed.path.startsWith(prefix)) fail(`Git tree path escaped ${prefix}: ${parsed.path}`);
    if (parsed.type !== 'blob' || !REGULAR_MODES.has(parsed.mode)) {
      fail(`non-regular Git entry is not allowed: ${parsed.mode} ${parsed.type} ${parsed.path}`);
    }
    const path = parsed.path.slice(prefix.length);
    assertRelativePath(path);
    const bytes = gitBlob(root, parsed.oid);
    rows.push({ path, mode: parsed.mode, size: bytes.length, sha256: sha256(bytes) });
  }
  rows.sort((left, right) => compare(left.path, right.path));
  assertNoDuplicatePaths(rows, `${channel} inventory`);
  return publicInventory(rows);
}

async function walkWorktreeDirectory(root, absolute, prefix, rows) {
  const directory = await lstat(absolute);
  if (directory.isSymbolicLink() || !directory.isDirectory()) fail(`docs channel root is not a real directory: ${absolute}`);
  const entries = await readdir(absolute, { withFileTypes: true });
  entries.sort((left, right) => compare(left.name, right.name));
  for (const entry of entries) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    assertRelativePath(path);
    const full = join(absolute, entry.name);
    const info = await lstat(full);
    if (info.isSymbolicLink()) fail(`symlink is not allowed in docs inventory: ${path}`);
    if (info.isDirectory()) await walkWorktreeDirectory(root, full, path, rows);
    else if (info.isFile()) {
      const bytes = await readFile(full);
      rows.push({
        path,
        mode: (info.mode & 0o111) === 0 ? '100644' : '100755',
        size: bytes.length,
        sha256: sha256(bytes),
      });
    } else fail(`non-regular entry is not allowed in docs inventory: ${path}`);
  }
}

export async function worktreeChannelInventory(root, channel, sourceDirectory) {
  if (!['beta', 'stable'].includes(channel)) fail(`unsupported docs channel ${JSON.stringify(channel)}`);
  const directory = sourceDirectory ?? join(root, 'content', 'docs', channel);
  const rows = [];
  await walkWorktreeDirectory(root, directory, '', rows);
  rows.sort((left, right) => compare(left.path, right.path));
  assertNoDuplicatePaths(rows, `${channel} worktree inventory`);
  return rows;
}

function changedInventoryPaths(before, after) {
  const beforeByPath = new Map(before.map((row) => [row.path, row]));
  const afterByPath = new Map(after.map((row) => [row.path, row]));
  return sorted(new Set([...beforeByPath.keys(), ...afterByPath.keys()])).filter((path) => {
    const left = beforeByPath.get(path);
    const right = afterByPath.get(path);
    return canonicalJson(left) !== canonicalJson(right);
  }).map((path) => `content/docs/stable/${path}`);
}

function isValidIsoTimestamp(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value ?? '');
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , , , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] &&
    Number(hourText) <= 23 && Number(minuteText) <= 59 && Number(secondText) <= 59 &&
    (offsetHourText === undefined || (Number(offsetHourText) <= 23 && Number(offsetMinuteText) <= 59));
}

function exactKeys(value, expected, label) {
  if (!isObject(value) || canonicalJson(sorted(Object.keys(value))) !== canonicalJson(sorted(expected))) {
    fail(`${label} fields are not exact`);
  }
}

function same(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function receiptFileBytes(receipt) {
  const ordered = Object.fromEntries(RECEIPT_KEYS.map((key) => [key, receipt[key]]));
  if (receipt.evidence !== null) {
    ordered.evidence = Object.fromEntries(EVIDENCE_KEYS.map((key) => [
      key,
      Object.fromEntries(EVIDENCE_BINDING_KEYS.map((field) => [field, receipt.evidence[key][field]])),
    ]));
  }
  for (const key of ['betaSourceInventory', 'stablePostimageInventory']) {
    ordered[key] = receipt[key].map((row) => Object.fromEntries(INVENTORY_KEYS.map((field) => [field, row[field]])));
  }
  return Buffer.from(`${JSON.stringify(ordered, null, 2)}\n`, 'utf8');
}

function validateInventory(inventory, label) {
  if (!Array.isArray(inventory)) fail(`${label} must be an array`);
  let previous = null;
  for (const row of inventory) {
    exactKeys(row, INVENTORY_KEYS, `${label} row`);
    assertRelativePath(row.path, `${label} path`);
    if (!REGULAR_MODES.has(row.mode) || !Number.isSafeInteger(row.size) || row.size < 0 || !HEX_64.test(row.sha256 ?? '')) {
      fail(`invalid ${label} row for ${row.path}`);
    }
    if (previous !== null && compare(previous, row.path) >= 0) fail(`${label} is not strictly path-sorted`);
    previous = row.path;
  }
}

export function validateReceiptShape(receipt, { requireVerified = false } = {}) {
  exactKeys(receipt, RECEIPT_KEYS, 'receipt');
  if (receipt.schemaVersion !== PROMOTION_RECEIPT_SCHEMA_VERSION || receipt.kind !== PROMOTION_RECEIPT_KIND) fail('unsupported receipt');
  if (!HEX_40.test(receipt.baseDocsCommit ?? '') || !STABLE_TAG.test(receipt.stableTag ?? '') ||
      receipt.stableVersion !== receipt.stableTag.slice(1) || !HEX_40.test(receipt.stableSourceSha ?? '') ||
      !BETA_TAG.test(receipt.promotedFrom ?? '') || receipt.promotedFrom.split('-beta.', 1)[0] !== receipt.stableTag ||
      !isValidIsoTimestamp(receipt.generatedAt)) {
    fail('receipt release identity is invalid');
  }
  if (!['git-ref', 'unverified-fixture'].includes(receipt.sourceVerification)) fail('receipt sourceVerification is invalid');
  if (receipt.sourceVerification === 'git-ref') {
    if (receipt.betaRef !== promotionBetaRef(receipt.promotedFrom) ||
        !HEX_40.test(receipt.betaCommit ?? '') || receipt.betaChannelsTagProof !== receipt.promotedFrom) {
      fail('receipt verified Beta binding is invalid');
    }
    exactKeys(receipt.evidence, EVIDENCE_KEYS, 'receipt evidence');
    const expectedEvidence = stablePromotionEvidencePaths(receipt.stableTag);
    for (const key of EVIDENCE_KEYS) {
      const binding = receipt.evidence[key];
      exactKeys(binding, EVIDENCE_BINDING_KEYS, `receipt evidence ${key}`);
      if (binding.path !== expectedEvidence[key] || !Number.isSafeInteger(binding.size) || binding.size < 0 || !HEX_64.test(binding.sha256 ?? '')) {
        fail(`receipt evidence ${key} binding is invalid`);
      }
    }
  } else if (receipt.betaRef !== null || receipt.betaCommit !== null || receipt.betaChannelsTagProof !== null || receipt.evidence !== null) {
    fail('unverified fixture receipt must not claim a Git or committed-evidence binding');
  }
  if (requireVerified && receipt.sourceVerification !== 'git-ref') fail('unverified fixture receipt is not accepted by CI');
  for (const key of [
    'releaseNotesOutputSha256', 'betaSourceInventoryDigest', 'stablePostimageInventoryDigest',
    'channelsPreimageSha256', 'channelsPostimageSha256', 'receiptDigest',
  ]) {
    if (!HEX_64.test(receipt[key] ?? '')) fail(`receipt ${key} is invalid`);
  }
  validateInventory(receipt.betaSourceInventory, 'Beta source inventory');
  validateInventory(receipt.stablePostimageInventory, 'Stable postimage inventory');
  if (inventoryDigest(receipt.betaSourceInventory) !== receipt.betaSourceInventoryDigest) fail('Beta source inventory digest mismatch');
  if (inventoryDigest(receipt.stablePostimageInventory) !== receipt.stablePostimageInventoryDigest) fail('Stable postimage inventory digest mismatch');
  if (!Array.isArray(receipt.changedStablePaths)) fail('changedStablePaths must be an array');
  let previous = null;
  for (const path of receipt.changedStablePaths) {
    if (typeof path !== 'string' || !path.startsWith('content/docs/stable/')) fail(`invalid Stable allowlist path ${JSON.stringify(path)}`);
    assertRelativePath(path.slice('content/docs/stable/'.length), 'Stable allowlist path');
    if (previous !== null && compare(previous, path) >= 0) fail('changedStablePaths is not strictly sorted');
    previous = path;
  }
  if (promotionReceiptDigest(receipt) !== receipt.receiptDigest) fail('receipt canonical digest mismatch');
  return receipt;
}

export async function assertSafeReceiptDestination(root, path) {
  const repoPath = repositoryRelativePath(root, path);
  if (repoPath !== null) {
    const parts = repoPath.split('/');
    let cursor = resolve(root);
    for (const part of parts.slice(0, -1)) {
      cursor = join(cursor, part);
      try {
        const info = await lstat(cursor);
        if (info.isSymbolicLink() || !info.isDirectory()) fail(`unsafe receipt directory component: ${repoPath}`);
      } catch (error) {
        if (error.code === 'ENOENT') break;
        throw error;
      }
    }
  } else {
    const parent = await lstat(dirname(path));
    if (parent.isSymbolicLink() || !parent.isDirectory()) fail(`unsafe temporary receipt directory: ${dirname(path)}`);
  }
  try {
    await lstat(path);
    fail(`receipt target already exists; promotion receipts are add-only: ${path}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function writeAtomic(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${path.split(sep).at(-1)}.promotion-${process.pid}.tmp`);
  let handle;
  try {
    await rm(temporary, { force: true });
    handle = await open(temporary, 'wx', 0o644);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await link(temporary, path);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
  }
}

export function promotionReceiptPath(stableTag) {
  if (!STABLE_TAG.test(stableTag ?? '')) fail(`invalid Stable tag for receipt path: ${JSON.stringify(stableTag)}`);
  return `${PROMOTIONS_PREFIX}${stableTag}.json`;
}

export function stablePromotionEvidencePaths(stableTag) {
  if (!STABLE_TAG.test(stableTag ?? '')) fail(`invalid Stable tag for evidence path: ${JSON.stringify(stableTag)}`);
  const directory = `${STABLE_PROMOTION_EVIDENCE_PREFIX}${stableTag}`;
  return {
    manifest: `${directory}/manifest.json`,
    releaseNotes: `${directory}/release-notes.md`,
  };
}

async function assertRealDirectoryPath(root, directory) {
  const repoPath = repositoryRelativePath(root, directory);
  if (repoPath === null) fail(`evidence directory escapes repository: ${directory}`);
  let cursor = resolve(root);
  for (const part of repoPath.split('/')) {
    cursor = join(cursor, part);
    try {
      const info = await lstat(cursor);
      if (info.isSymbolicLink() || !info.isDirectory()) fail(`unsafe evidence directory component: ${repoPath}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await mkdir(cursor, { mode: 0o755 });
    }
  }
}

async function writeSyncedExclusive(path, bytes) {
  const handle = await open(path, 'wx', 0o644);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function createPromotionEvidence({ root, stableTag, manifestBytes, releaseNotesSourceBytes }) {
  const paths = stablePromotionEvidencePaths(stableTag);
  const targetDirectory = dirname(absoluteReceiptPath(root, paths.manifest));
  const parent = dirname(targetDirectory);
  await assertRealDirectoryPath(root, parent);
  try {
    await lstat(targetDirectory);
    fail(`promotion evidence directory already exists: ${repositoryRelativePath(root, targetDirectory)}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const temporary = join(parent, `.${stableTag}.promotion-${process.pid}.tmp`);
  try {
    await rm(temporary, { recursive: true, force: true });
    await mkdir(temporary, { mode: 0o755 });
    await writeSyncedExclusive(join(temporary, 'manifest.json'), manifestBytes);
    await writeSyncedExclusive(join(temporary, 'release-notes.md'), releaseNotesSourceBytes);
    await rename(temporary, targetDirectory);
  } finally {
    await rm(temporary, { recursive: true, force: true }).catch(() => {});
  }
  return {
    manifest: { path: paths.manifest, size: manifestBytes.length, sha256: sha256(manifestBytes) },
    releaseNotes: { path: paths.releaseNotes, size: releaseNotesSourceBytes.length, sha256: sha256(releaseNotesSourceBytes) },
  };
}

export async function removePromotionEvidence(root, stableTag) {
  const path = dirname(absoluteReceiptPath(root, stablePromotionEvidencePaths(stableTag).manifest));
  await rm(path, { recursive: true, force: true });
}

export async function createPromotionReceipt({
  root,
  baseDocsCommit,
  manifest,
  manifestBytes,
  releaseNotesSourceBytes,
  betaRef = null,
  betaCommit = null,
  betaChannelsTagProof = null,
  unverifiedBetaSourceDir = null,
  receiptPath,
}) {
  const resolvedBase = resolveCommit(root, baseDocsCommit);
  const verified = betaRef !== null;
  if (verified && (!betaCommit || unverifiedBetaSourceDir)) fail('verified receipt requires betaCommit and no unverified source');
  if (!verified && !unverifiedBetaSourceDir) fail('fixture receipt requires an unverified Beta source directory');
  if (verified) {
    const evidencePaths = stablePromotionEvidencePaths(manifest.tag);
    const committedManifest = await readFile(absoluteReceiptPath(root, evidencePaths.manifest));
    const committedNotes = await readFile(absoluteReceiptPath(root, evidencePaths.releaseNotes));
    if (!committedManifest.equals(manifestBytes) || !committedNotes.equals(releaseNotesSourceBytes)) {
      fail('promotion evidence files do not equal the exact bundle input bytes');
    }
  }
  const betaSourceInventory = verified
    ? gitChannelInventory(root, betaCommit, 'beta')
    : await worktreeChannelInventory(root, 'beta', unverifiedBetaSourceDir);
  const stablePostimageInventory = await worktreeChannelInventory(root, 'stable');
  const stableBefore = gitChannelInventory(root, resolvedBase, 'stable');
  const channelsPreimage = gitPathBytes(root, resolvedBase, 'channels.json');
  const channelsPostimage = await readFile(join(root, 'channels.json'));
  const releaseNotesOutput = await readFile(join(root, 'content', 'docs', 'stable', STABLE_RELEASE_NOTES_RELATIVE_PATH));
  const body = {
    schemaVersion: PROMOTION_RECEIPT_SCHEMA_VERSION,
    kind: PROMOTION_RECEIPT_KIND,
    baseDocsCommit: resolvedBase,
    stableTag: manifest.tag,
    stableVersion: manifest.version,
    stableSourceSha: manifest.sha,
    generatedAt: manifest.generatedAt,
    promotedFrom: manifest.promotedFrom,
    sourceVerification: verified ? 'git-ref' : 'unverified-fixture',
    betaRef: verified ? betaRef : null,
    betaCommit: verified ? betaCommit : null,
    betaChannelsTagProof: verified ? betaChannelsTagProof : null,
    evidence: verified ? {
      manifest: {
        path: stablePromotionEvidencePaths(manifest.tag).manifest,
        size: manifestBytes.length,
        sha256: sha256(manifestBytes),
      },
      releaseNotes: {
        path: stablePromotionEvidencePaths(manifest.tag).releaseNotes,
        size: releaseNotesSourceBytes.length,
        sha256: sha256(releaseNotesSourceBytes),
      },
    } : null,
    releaseNotesOutputSha256: sha256(releaseNotesOutput),
    betaSourceInventory,
    betaSourceInventoryDigest: inventoryDigest(betaSourceInventory),
    stablePostimageInventory,
    stablePostimageInventoryDigest: inventoryDigest(stablePostimageInventory),
    channelsPreimageSha256: sha256(channelsPreimage),
    channelsPostimageSha256: sha256(channelsPostimage),
    changedStablePaths: changedInventoryPaths(stableBefore, stablePostimageInventory),
  };
  const receipt = { ...body, receiptDigest: promotionReceiptDigest(body) };
  validateReceiptShape(receipt);
  await assertSafeReceiptDestination(root, receiptPath);
  await writeAtomic(receiptPath, receiptFileBytes(receipt));
  return receipt;
}

function parseNameStatus(output) {
  const tokens = splitNul(output).map((token) => decodePath(token));
  const rows = [];
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++];
    if (!/^[ACDMTUXB]$/.test(status ?? '') && !/^[RC][0-9]{1,3}$/.test(status ?? '')) fail(`unsupported Git diff status ${JSON.stringify(status)}`);
    const first = tokens[index++];
    if (!first) fail(`Git ${status} record has no path`);
    if (status.startsWith('R') || status.startsWith('C')) {
      const path = tokens[index++];
      if (!path) fail(`Git ${status} record has no destination path`);
      rows.push({ status, oldPath: first, path });
    } else rows.push({ status, path: first });
  }
  return rows;
}

function promotionTransactionDiffStatus(root, base, head) {
  return parseNameStatus(git(root, [
    'diff', '--name-status', '-z', '--find-renames', '--find-copies-harder', base, head, '--',
  ]).stdout).filter((row) =>
    row.path.startsWith(PROMOTIONS_PREFIX) || row.oldPath?.startsWith(PROMOTIONS_PREFIX) ||
    row.path.startsWith(STABLE_PROMOTION_EVIDENCE_PREFIX) || row.oldPath?.startsWith(STABLE_PROMOTION_EVIDENCE_PREFIX));
}

function assertDerivedPostimage(receipt, derivedReleaseNotes) {
  const expectedByPath = new Map(receipt.stablePostimageInventory.map((row) => [row.path, row]));
  if (expectedByPath.size !== receipt.betaSourceInventory.length) fail('Stable postimage path set does not equal the Beta source path set');
  for (const beta of receipt.betaSourceInventory) {
    const stable = expectedByPath.get(beta.path);
    if (!stable) fail(`Stable postimage is missing Beta path ${beta.path}`);
    if (beta.path === STABLE_RELEASE_NOTES_RELATIVE_PATH) {
      const derived = { path: beta.path, mode: beta.mode, size: derivedReleaseNotes.length, sha256: sha256(derivedReleaseNotes) };
      if (!same(stable, derived) || stable.sha256 !== receipt.releaseNotesOutputSha256) {
        fail('Stable release-notes postimage is not the deterministically rederived output');
      }
    } else if (!same(beta, stable)) {
      fail(`Stable postimage is not an exact Beta copy: ${beta.path}`);
    }
  }
  if (!expectedByPath.has(STABLE_RELEASE_NOTES_RELATIVE_PATH)) fail('Stable postimage is missing release notes');
}

function decodeUtf8Bytes(bytes, label) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail(`${label} is not valid UTF-8`);
  }
}

function parseJsonBytes(bytes, label) {
  try {
    return JSON.parse(decodeUtf8Bytes(bytes, label));
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
}

function expectedStableChannel(receipt) {
  return {
    version: receipt.stableVersion,
    tag: receipt.stableTag,
    sha: receipt.stableSourceSha,
    syncedAt: receipt.generatedAt,
  };
}

function expectedChannelsPostimage(baseBytes, receipt) {
  const channels = parseJsonBytes(baseBytes, 'base channels.json');
  channels.stable = expectedStableChannel(receipt);
  return Buffer.from(`${JSON.stringify(channels, null, 2)}\n`, 'utf8');
}

function receiptPathFromArgument(receipt, suppliedPath) {
  const expected = promotionReceiptPath(receipt.stableTag);
  if (suppliedPath !== expected) fail(`receipt path must be ${expected}`);
}

function assertEvidenceClosedWorld(root, head, receipt) {
  const paths = stablePromotionEvidencePaths(receipt.stableTag);
  const prefix = dirname(paths.manifest);
  const rows = splitNul(git(root, ['ls-tree', '-r', '-z', '--full-tree', head, '--', `${prefix}/`]).stdout)
    .map(parseLsTreeRecord);
  const expectedPaths = sorted(Object.values(paths));
  const actualPaths = sorted(rows.map((row) => row.path));
  if (!same(actualPaths, expectedPaths)) {
    fail(`promotion evidence directory must contain exactly manifest.json and release-notes.md; found [${actualPaths.join(', ')}]`);
  }
  for (const row of rows) {
    if (row.type !== 'blob' || row.mode !== '100644') fail(`promotion evidence must be regular non-symlink files: ${row.path}`);
  }
}

function readAndValidateEvidence(root, head, receipt) {
  assertEvidenceClosedWorld(root, head, receipt);
  const manifestBytes = gitPathBytes(root, head, receipt.evidence.manifest.path);
  const releaseNotesBytes = gitPathBytes(root, head, receipt.evidence.releaseNotes.path);
  for (const [key, bytes] of [['manifest', manifestBytes], ['releaseNotes', releaseNotesBytes]]) {
    const binding = receipt.evidence[key];
    if (bytes.length !== binding.size || sha256(bytes) !== binding.sha256) {
      fail(`committed promotion evidence ${key} does not match its receipt size/hash`);
    }
  }
  let manifest;
  try {
    manifest = parseManifest(decodeUtf8Bytes(manifestBytes, 'promotion manifest evidence'), { expectedChannel: 'stable' });
  } catch (error) {
    fail(`promotion manifest evidence is invalid: ${error.message}`);
  }
  const identity = {
    tag: receipt.stableTag,
    version: receipt.stableVersion,
    sha: receipt.stableSourceSha,
    generatedAt: receipt.generatedAt,
    promotedFrom: receipt.promotedFrom,
  };
  if (!same(Object.fromEntries(Object.keys(identity).map((key) => [key, manifest[key]])), identity)) {
    fail('promotion manifest evidence identity does not match the receipt');
  }
  const body = decodeUtf8Bytes(releaseNotesBytes, 'promotion release-notes evidence');
  const derivedReleaseNotes = Buffer.from(renderReleaseNotesMdx({ channel: 'stable', tag: receipt.stableTag, body }), 'utf8');
  return { manifestBytes, releaseNotesBytes, derivedReleaseNotes };
}

export async function checkStablePromotion({ root, base, receiptPath = null }) {
  const resolvedBase = resolveCommit(root, base);
  const head = resolveCommit(root, 'HEAD');
  const transactionRows = promotionTransactionDiffStatus(root, resolvedBase, head);
  const receiptRows = transactionRows.filter((row) =>
    row.path.startsWith(PROMOTIONS_PREFIX) || row.oldPath?.startsWith(PROMOTIONS_PREFIX));
  const evidenceRows = transactionRows.filter((row) =>
    row.path.startsWith(STABLE_PROMOTION_EVIDENCE_PREFIX) || row.oldPath?.startsWith(STABLE_PROMOTION_EVIDENCE_PREFIX));
  if (receiptRows.some((row) => row.status !== 'A' || row.oldPath)) {
    fail(`promotion receipt was deleted, renamed, copied, or type-changed; receipts are add-only and require Git status A: ${receiptRows.map((row) => `${row.status} ${row.oldPath ? `${row.oldPath} -> ` : ''}${row.path}`).join(', ')}`);
  }
  if (evidenceRows.some((row) => row.status !== 'A' || row.oldPath)) {
    fail(`promotion evidence is add-only and requires Git status A: ${evidenceRows.map((row) => `${row.status} ${row.oldPath ? `${row.oldPath} -> ` : ''}${row.path}`).join(', ')}`);
  }
  if (receiptRows.length !== 1 || evidenceRows.length !== 2) {
    fail(`one added receipt and two added evidence files are required; found receipts=${receiptRows.length}, evidence=${evidenceRows.length}`);
  }
  const selectedPath = receiptPath ?? receiptRows[0].path;
  if (selectedPath !== receiptRows[0].path) fail(`selected receipt is not the only added receipt: ${selectedPath}`);
  if (!/^docs-promotions\/v\d+\.\d+\.\d+\.json$/.test(selectedPath)) fail(`invalid promotion receipt path ${selectedPath}`);
  const receiptBytes = gitPathBytes(root, head, selectedPath);
  const receipt = parseJsonBytes(receiptBytes, 'promotion receipt');
  validateReceiptShape(receipt, { requireVerified: true });
  receiptPathFromArgument(receipt, selectedPath);
  const expectedEvidencePaths = sorted(Object.values(stablePromotionEvidencePaths(receipt.stableTag)));
  if (!same(sorted(evidenceRows.map((row) => row.path)), expectedEvidencePaths)) {
    fail(`receipt and evidence additions are not the same Stable promotion transaction`);
  }
  const canonicalFile = receiptFileBytes(receipt);
  if (!receiptBytes.equals(canonicalFile)) fail('promotion receipt file bytes are not in canonical pretty-JSON form');
  const receiptBase = resolveCommit(root, receipt.baseDocsCommit);
  const ancestor = git(root, ['merge-base', '--is-ancestor', receiptBase, head], { allowFailure: true });
  if (ancestor.status !== 0) fail(`receipt baseDocsCommit is not an ancestor of HEAD: ${receiptBase}`);

  const { derivedReleaseNotes } = readAndValidateEvidence(root, head, receipt);
  const resolvedBeta = resolvePromotionBetaCommit(root, receipt.promotedFrom, receipt.betaRef);
  if (resolvedBeta !== receipt.betaCommit) fail(`Beta tag ${receipt.betaRef} does not peel to receipt commit ${receipt.betaCommit}`);
  const betaChannels = parseJsonBytes(gitPathBytes(root, resolvedBeta, 'channels.json'), 'historical Beta channels.json');
  if (betaChannels?.beta?.tag !== receipt.promotedFrom || receipt.betaChannelsTagProof !== receipt.promotedFrom) {
    fail(`historical Beta channels tag does not prove promotedFrom ${receipt.promotedFrom}`);
  }
  const betaInventory = gitChannelInventory(root, resolvedBeta, 'beta');
  if (!same(betaInventory, receipt.betaSourceInventory)) fail('Beta source inventory drift from historical Git tree');
  if (inventoryDigest(betaInventory) !== receipt.betaSourceInventoryDigest) fail('historical Beta inventory digest mismatch');
  assertDerivedPostimage(receipt, derivedReleaseNotes);

  const stableInventory = gitChannelInventory(root, head, 'stable');
  const ciBaseStableInventory = gitChannelInventory(root, resolvedBase, 'stable');
  if (changedInventoryPaths(ciBaseStableInventory, stableInventory).length === 0) {
    fail('promotion transaction changed without a Stable change in the CI diff');
  }
  if (!same(stableInventory, receipt.stablePostimageInventory)) fail('current Stable tree does not equal the receipt postimage inventory');
  if (inventoryDigest(stableInventory) !== receipt.stablePostimageInventoryDigest) fail('current Stable postimage digest mismatch');

  const baseChannels = gitPathBytes(root, receiptBase, 'channels.json');
  if (sha256(baseChannels) !== receipt.channelsPreimageSha256) fail('channels.json preimage hash mismatch');
  const derivedChannels = expectedChannelsPostimage(baseChannels, receipt);
  if (sha256(derivedChannels) !== receipt.channelsPostimageSha256) fail('channels.json historical postimage hash mismatch');
  const currentChannels = parseJsonBytes(gitPathBytes(root, head, 'channels.json'), 'current channels.json');
  if (!same(currentChannels?.stable, expectedStableChannel(receipt))) {
    fail('current channels.stable fields do not equal the receipt Stable postimage');
  }

  const releaseNotes = gitPathBytes(root, head, `content/docs/stable/${STABLE_RELEASE_NOTES_RELATIVE_PATH}`);
  if (!releaseNotes.equals(derivedReleaseNotes) || sha256(releaseNotes) !== receipt.releaseNotesOutputSha256) {
    fail('current Stable release notes do not equal the deterministically rederived evidence output');
  }

  const baseStable = gitChannelInventory(root, receiptBase, 'stable');
  const actualChangedStablePaths = changedInventoryPaths(baseStable, stableInventory);
  if (!same(actualChangedStablePaths, receipt.changedStablePaths)) {
    fail(`Stable diff/receipt allowlist mismatch: expected [${receipt.changedStablePaths.join(', ')}], actual [${actualChangedStablePaths.join(', ')}]`);
  }
  return {
    receipt,
    receiptPath: selectedPath,
    base: resolvedBase,
    betaCommit: resolvedBeta,
    stablePaths: stableInventory.length,
    changedStablePaths: actualChangedStablePaths.length,
  };
}

export function absoluteReceiptPath(root, repoPath) {
  assertRelativePath(repoPath, 'receipt path');
  const absolute = resolve(root, ...repoPath.split('/'));
  if (!absolute.startsWith(`${resolve(root)}${sep}`)) fail(`receipt path escapes repository: ${repoPath}`);
  return absolute;
}

export function repositoryRelativePath(root, absolute) {
  const value = relative(resolve(root), resolve(absolute)).split(sep).join('/');
  if (!value || value.startsWith('../')) return null;
  assertRelativePath(value, 'repository-relative path');
  return value;
}
