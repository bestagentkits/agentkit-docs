import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { parseManifest } from './manifest.mjs';

export const RELEASE_ASSET_NAMES = Object.freeze([
  'docs-bundle.tar.gz',
  'docs-bundle.tar.gz.sha256',
  'release-provenance.json',
]);

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const GITHUB_DIGEST = /^sha256:([0-9a-f]{64})$/;
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 256 * 1024 * 1024;
const MAX_ENTRIES = 10_000;

export class ReleaseEvidenceError extends Error {}

function fail(message) {
  throw new ReleaseEvidenceError(message);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function git(repoRoot, args) {
  try {
    return execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' }).trim();
  } catch (error) {
    fail(error.stderr?.trim() || `git ${args.join(' ')} failed`);
  }
}

function gitSucceeds(repoRoot, args) {
  return spawnSync('git', ['-C', repoRoot, ...args], { stdio: 'ignore' }).status === 0;
}

function parseJson(raw, label) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
}

function requireObject(value, label) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be a JSON object`);
  }
  return value;
}

export function validateDispatchPayload(payload) {
  const value = requireObject(payload, 'release-docs payload');
  if (!['beta', 'stable'].includes(value.channel)) {
    fail(`payload channel must be beta or stable, got ${JSON.stringify(value.channel)}`);
  }
  const tagPattern = value.channel === 'beta'
    ? /^v\d+\.\d+\.\d+-beta\.\d+$/
    : /^v\d+\.\d+\.\d+$/;
  if (typeof value.tag !== 'string' || !tagPattern.test(value.tag)) {
    fail(`payload tag does not match channel ${value.channel}: ${JSON.stringify(value.tag)}`);
  }
  if (typeof value.sha !== 'string' || !SHA40.test(value.sha)) {
    fail('payload sha must be exactly 40 lowercase hexadecimal characters');
  }
  return { channel: value.channel, tag: value.tag, sha: value.sha };
}

function releaseOrder(tag) {
  const match = /^v(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/.exec(tag ?? '');
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] == null ? Number.MAX_SAFE_INTEGER : Number(match[4])];
}

export function validateChannelAdvance(payload, channels) {
  const dispatch = validateDispatchPayload(payload);
  const state = requireObject(channels, 'channels.json');
  const current = state[dispatch.channel];
  if (current == null) return dispatch;
  requireObject(current, `channels.json ${dispatch.channel}`);
  if (current.version == null || current.tag == null) return dispatch;
  const previous = releaseOrder(current.tag);
  const candidate = releaseOrder(dispatch.tag);
  if (!previous || !candidate) fail(`current ${dispatch.channel} tag is invalid: ${JSON.stringify(current.tag)}`);
  const comparison = candidate.findIndex((value, index) => value !== previous[index]);
  if (comparison < 0 || candidate[comparison] < previous[comparison]) {
    fail(`stale ${dispatch.channel} release ${dispatch.tag} does not advance current tag ${current.tag}`);
  }
  return dispatch;
}

function validateAsset(asset, name) {
  requireObject(asset, `release asset ${name}`);
  if (!Number.isSafeInteger(asset.id) || asset.id <= 0) {
    fail(`release asset ${name} has an invalid immutable asset id`);
  }
  if (!Number.isSafeInteger(asset.size) || asset.size <= 0) {
    fail(`release asset ${name} has an invalid size`);
  }
  const digest = GITHUB_DIGEST.exec(asset.digest ?? '');
  if (!digest) fail(`release asset ${name} lacks a lowercase sha256 GitHub digest`);
  return { id: asset.id, name, size: asset.size, sha256: digest[1] };
}

export function selectReleaseAssets(release, payload) {
  const dispatch = validateDispatchPayload(payload);
  const value = requireObject(release, 'GitHub release');
  if (value.tag_name !== dispatch.tag) {
    fail(`GitHub release tag mismatch: expected ${dispatch.tag}, got ${JSON.stringify(value.tag_name)}`);
  }
  if (!Number.isSafeInteger(value.id) || value.id <= 0) fail('GitHub release has an invalid id');
  if (!Array.isArray(value.assets)) fail('GitHub release assets must be an array');

  const selected = RELEASE_ASSET_NAMES.map((name) => {
    const matches = value.assets.filter((asset) => asset?.name === name);
    if (matches.length !== 1) {
      fail(`GitHub release must contain exactly one ${name}; found ${matches.length}`);
    }
    return validateAsset(matches[0], name);
  });
  const ids = new Set(selected.map((asset) => asset.id));
  if (ids.size !== selected.length) fail('release evidence assets do not have unique asset ids');
  return { releaseId: value.id, payload: dispatch, assets: selected };
}

async function readRegularFile(path, label) {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    fail(`cannot inspect downloaded ${label}: ${error.message}`);
  }
  if (!info.isFile() || info.isSymbolicLink()) fail(`downloaded ${label} must be a regular file`);
  return readFile(path);
}

async function verifyDownloadedAssets(selection, assetsDir) {
  const verified = new Map();
  for (const asset of selection.assets) {
    const bytes = await readRegularFile(join(assetsDir, asset.name), asset.name);
    if (bytes.length !== asset.size) {
      fail(`${asset.name} size mismatch: GitHub says ${asset.size}, downloaded ${bytes.length}`);
    }
    const actual = sha256(bytes);
    if (actual !== asset.sha256) {
      fail(`${asset.name} digest mismatch: GitHub says ${asset.sha256}, downloaded ${actual}`);
    }
    verified.set(asset.name, { ...asset, bytes });
  }
  return verified;
}

function validateProvenance(raw, selection) {
  const provenance = requireObject(parseJson(raw, 'release-provenance.json'), 'release provenance');
  const { payload } = selection;
  if (provenance.schemaVersion !== 'agentkit-release-provenance.v1') {
    fail(`unsupported release provenance schema ${JSON.stringify(provenance.schemaVersion)}`);
  }
  if (provenance.releaseTag !== payload.tag || provenance.channel !== payload.channel) {
    fail('release provenance tag/channel does not match the dispatch payload');
  }
  if (!SHA40.test(provenance.promotedSourceSha ?? '') || provenance.promotedSourceSha !== payload.sha) {
    fail('release provenance promotedSourceSha does not match the dispatch payload');
  }
  if (!SHA40.test(provenance.snapshotSha ?? '')) fail('release provenance snapshotSha is invalid');
  if (payload.channel === 'beta' && provenance.snapshotSha !== payload.sha) {
    fail('beta release provenance snapshotSha must equal the dispatched source sha');
  }
  if (!Array.isArray(provenance.artifacts)) fail('release provenance artifacts must be an array');

  for (const name of RELEASE_ASSET_NAMES.slice(0, 2)) {
    const matches = provenance.artifacts.filter((artifact) => artifact?.name === name);
    if (matches.length !== 1) fail(`release provenance must contain exactly one ${name} record`);
    const record = matches[0];
    const asset = selection.assets.find((candidate) => candidate.name === name);
    if (!SHA256.test(record.sha256 ?? '') || record.sha256 !== asset.sha256) {
      fail(`release provenance sha256 mismatch for ${name}`);
    }
    if (record.size !== asset.size || record.githubAssetId !== asset.id) {
      fail(`release provenance identity mismatch for ${name}`);
    }
    if (record.githubDigest !== `sha256:${asset.sha256}`) {
      fail(`release provenance GitHub digest mismatch for ${name}`);
    }
  }
  return provenance;
}

function parseOctal(header, offset, length, label) {
  const field = header.subarray(offset, offset + length).toString('ascii').replace(/\0.*$/, '').trim();
  if (!/^[0-7]+$/.test(field)) fail(`archive ${label} is not a valid octal field`);
  return Number.parseInt(field, 8);
}

function tarString(header, offset, length) {
  return header.subarray(offset, offset + length).toString('utf8').replace(/\0.*$/, '');
}

function safeArchivePath(name) {
  if (!name || name.includes('\\') || name.startsWith('/') || name.includes('\0')) {
    fail(`unsafe archive path ${JSON.stringify(name)}`);
  }
  const normalized = posix.normalize(name);
  if (normalized !== name || normalized === '..' || normalized.startsWith('../')) {
    fail(`unsafe archive path ${JSON.stringify(name)}`);
  }
  return normalized.replace(/\/$/, '');
}

function validateTarChecksum(header, name) {
  const expected = parseOctal(header, 148, 8, `checksum for ${name}`);
  let actual = 0;
  for (let index = 0; index < header.length; index += 1) {
    actual += index >= 148 && index < 156 ? 32 : header[index];
  }
  if (actual !== expected) fail(`archive header checksum mismatch for ${name}`);
}

export function inspectTarGz(bytes) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  if (bytes.length === 0 || bytes.length > MAX_ARCHIVE_BYTES) fail('docs bundle archive size is outside allowed bounds');
  let tar;
  try {
    tar = gunzipSync(bytes, { maxOutputLength: MAX_EXPANDED_BYTES });
  } catch (error) {
    fail(`docs bundle is not a bounded valid gzip archive: ${error.message}`);
  }

  const entries = [];
  const names = new Set();
  let offset = 0;
  let terminated = false;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      terminated = true;
      break;
    }
    const rawName = tarString(header, 0, 100);
    const prefix = tarString(header, 345, 155);
    const name = safeArchivePath(prefix ? `${prefix}/${rawName}` : rawName);
    if (tarString(header, 257, 6) !== 'ustar') fail(`archive entry is not USTAR: ${name}`);
    validateTarChecksum(header, name);
    if (names.has(name)) fail(`duplicate archive entry ${name}`);
    names.add(name);
    if (names.size > MAX_ENTRIES) fail('docs bundle contains too many archive entries');

    const type = String.fromCharCode(header[156] || 48);
    if (type !== '0' && type !== '5') fail(`archive entry ${name} is a link or special file`);
    const size = parseOctal(header, 124, 12, `size for ${name}`);
    if (type === '5' && size !== 0) fail(`archive directory ${name} has non-zero size`);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (!Number.isSafeInteger(size) || dataEnd > tar.length) fail(`archive entry ${name} is truncated`);
    const nextOffset = dataStart + Math.ceil(size / 512) * 512;
    if (!tar.subarray(dataEnd, nextOffset).every((byte) => byte === 0)) {
      fail(`archive entry ${name} has non-zero padding`);
    }
    entries.push({ name, type, bytes: tar.subarray(dataStart, dataEnd) });
    offset = nextOffset;
  }
  if (!terminated) fail('docs bundle is missing the tar end marker');
  if (offset + 1024 > tar.length || !tar.subarray(offset, offset + 1024).every((byte) => byte === 0)) {
    fail('docs bundle must end with two zero tar blocks');
  }
  if (!tar.subarray(offset + 1024).every((byte) => byte === 0)) {
    fail('docs bundle contains trailing data after the tar end marker');
  }

  const allowed = /^(manifest\.json|release-notes\.md|reference|reference\/cli|reference\/cli\/[a-z0-9][a-z0-9_-]*\.mdx)$/;
  for (const entry of entries) {
    if (!allowed.test(entry.name)) fail(`unexpected docs bundle entry ${entry.name}`);
    const shouldBeDirectory = entry.name === 'reference' || entry.name === 'reference/cli';
    if ((entry.type === '5') !== shouldBeDirectory) fail(`archive entry has wrong type: ${entry.name}`);
  }
  for (const required of ['manifest.json', 'release-notes.md', 'reference', 'reference/cli', 'reference/cli/ak.mdx', 'reference/cli/index.mdx']) {
    if (!names.has(required)) fail(`docs bundle is missing required entry ${required}`);
  }
  for (const entry of entries.filter((candidate) => candidate.type === '0')) {
    if (entry.bytes.length === 0) fail(`docs bundle file is empty: ${entry.name}`);
    if (entry.name.endsWith('.mdx') && (!entry.bytes.toString('utf8').startsWith('---\n') || !entry.bytes.includes(Buffer.from('\ngenerated: true\n')))) {
      fail(`reference page lacks generated frontmatter: ${entry.name}`);
    }
  }
  return entries;
}

async function extractEntries(entries, destination) {
  try {
    await lstat(destination);
    fail(`validated bundle destination already exists: ${destination}`);
  } catch (error) {
    if (error instanceof ReleaseEvidenceError) throw error;
    if (error.code !== 'ENOENT') throw error;
  }
  await mkdir(destination, { recursive: false });
  for (const entry of entries.filter((candidate) => candidate.type === '5')) {
    await mkdir(join(destination, entry.name), { recursive: true });
  }
  for (const entry of entries.filter((candidate) => candidate.type === '0')) {
    const target = join(destination, entry.name);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, entry.bytes, { flag: 'wx', mode: 0o600 });
  }
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function validateCanonicalReceiptText(text, label) {
  const value = parseJson(text, label);
  if (canonicalJson(value) !== text) fail(`${label} is not canonical`);
  return text;
}

export function validateBetaReplay({ repoRoot, tag, receiptPath, candidateText, currentRef = 'HEAD' }) {
  const dispatch = validateDispatchPayload({ channel: 'beta', tag, sha: '0'.repeat(40) });
  const ref = `refs/tags/docs/${dispatch.tag}`;
  const commit = git(repoRoot, ['rev-parse', `${ref}^{commit}`]);
  const parents = git(repoRoot, ['show', '-s', '--format=%P', commit]).split(/\s+/).filter(Boolean);
  if (parents.length !== 1) fail(`beta docs tag must point to a single-parent sync commit: ${ref}`);
  if (!gitSucceeds(repoRoot, ['merge-base', '--is-ancestor', commit, currentRef])) {
    fail(`beta docs tag is not in current dev history: ${ref}`);
  }
  if (gitSucceeds(repoRoot, ['cat-file', '-e', `${parents[0]}:${receiptPath}`])) {
    fail(`beta docs tag does not point to the receipt-introducing commit: ${ref}`);
  }
  const receiptChange = git(repoRoot, [
    'diff-tree', '--no-commit-id', '--name-status', '-r', parents[0], commit, '--', receiptPath,
  ]);
  if (receiptChange !== `A\t${receiptPath}`) {
    fail(`beta docs tag does not add the expected release receipt: ${ref}`);
  }
  const taggedReceipt = `${git(repoRoot, ['show', `${commit}:${receiptPath}`])}\n`;
  validateCanonicalReceiptText(candidateText, 'candidate release receipt');
  validateCanonicalReceiptText(taggedReceipt, 'tagged release receipt');
  if (taggedReceipt !== candidateText) fail(`beta docs tag receipt conflicts with the release evidence: ${ref}`);
  return commit;
}

export function inspectStableReplay({ repoRoot, branchRef, receiptPath, candidateText, currentRef = 'HEAD' }) {
  const commit = git(repoRoot, ['rev-parse', `${branchRef}^{commit}`]);
  const parents = git(repoRoot, ['show', '-s', '--format=%P', commit]).split(/\s+/).filter(Boolean);
  if (parents.length !== 1) fail(`stable promotion branch must have exactly one parent: ${branchRef}`);
  if (!gitSucceeds(repoRoot, ['merge-base', '--is-ancestor', parents[0], currentRef])) {
    fail(`stable promotion base is not in current dev history: ${parents[0]}`);
  }
  const branchReceipt = `${git(repoRoot, ['show', `${commit}:${receiptPath}`])}\n`;
  validateCanonicalReceiptText(candidateText, 'candidate release receipt');
  validateCanonicalReceiptText(branchReceipt, 'stable branch release receipt');
  if (branchReceipt !== candidateText) fail(`stable promotion branch receipt conflicts: ${branchRef}`);
  return { commit, parent: parents[0], tree: git(repoRoot, ['rev-parse', `${commit}^{tree}`]) };
}

export function validateStableReplayTree({ repoRoot, branchRef, expectedTree }) {
  if (!SHA40.test(expectedTree)) fail('expected stable promotion tree must be a 40-character lowercase SHA');
  const actualTree = git(repoRoot, ['rev-parse', `${branchRef}^{tree}`]);
  if (actualTree !== expectedTree) fail(`stable promotion branch conflicts with deterministic original-base tree: ${branchRef}`);
  return actualTree;
}

export async function verifyReleaseEvidence({ payload, release, assetsDir, bundleDir }) {
  const selection = selectReleaseAssets(release, payload);
  const downloaded = await verifyDownloadedAssets(selection, assetsDir);
  const provenance = validateProvenance(
    downloaded.get('release-provenance.json').bytes.toString('utf8'),
    selection,
  );
  const archive = downloaded.get('docs-bundle.tar.gz');
  const sidecar = downloaded.get('docs-bundle.tar.gz.sha256').bytes.toString('utf8');
  const expectedSidecar = `${archive.sha256}  docs-bundle.tar.gz\n`;
  if (sidecar !== expectedSidecar) fail('docs bundle checksum sidecar is not the strict canonical checksum line');

  const entries = inspectTarGz(archive.bytes);
  const manifestEntry = entries.find((entry) => entry.name === 'manifest.json');
  const manifest = parseManifest(manifestEntry.bytes.toString('utf8'), {
    expectedChannel: selection.payload.channel,
  });
  if (manifest.tag !== selection.payload.tag || manifest.sha !== selection.payload.sha) {
    fail('docs bundle manifest tag/sha does not match the dispatch payload');
  }
  if (manifest.tag !== provenance.releaseTag || manifest.sha !== provenance.promotedSourceSha) {
    fail('docs bundle manifest does not match release provenance');
  }
  await extractEntries(entries, bundleDir);

  const receipt = {
    schemaVersion: 'agentkit-docs-release-receipt.v1',
    channel: selection.payload.channel,
    tag: selection.payload.tag,
    sha: selection.payload.sha,
    snapshotSha: provenance.snapshotSha,
    releaseId: selection.releaseId,
    assets: selection.assets.map(({ id, name, size, sha256: digest }) => ({ id, name, size, sha256: digest })),
    manifestSha256: sha256(manifestEntry.bytes),
  };
  return { selection, manifest, provenance, receipt, receiptText: canonicalJson(receipt) };
}

export async function classifyReceipt(existingPath, candidateText) {
  validateCanonicalReceiptText(candidateText, 'candidate release receipt');
  let existing;
  try {
    existing = await readFile(existingPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return 'new';
    throw error;
  }
  try {
    validateCanonicalReceiptText(existing, 'existing release receipt');
  } catch (error) {
    if (error instanceof ReleaseEvidenceError && /not canonical/.test(error.message)) {
      fail(`existing release receipt is not canonical: ${existingPath}`);
    }
    throw error;
  }
  if (existing !== candidateText) fail(`conflicting release receipt already exists: ${existingPath}`);
  return 'replay';
}
