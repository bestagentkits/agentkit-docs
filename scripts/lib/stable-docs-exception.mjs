import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { canonicalJson, sha256 } from './stable-promotion.mjs';

export const STABLE_DOCS_EXCEPTION_SCHEMA_VERSION = 1;
export const STABLE_DOCS_EXCEPTION_KIND = 'stable-docs-exception';
export const STABLE_DOCS_EXCEPTIONS_PREFIX = 'stable-docs-exceptions/';

const HEX_40 = /^[a-f0-9]{40}$/;
const HEX_64 = /^[a-f0-9]{64}$/;
const STABLE_TAG = /^v\d+\.\d+\.\d+$/;
const ROUTE = /^(concepts|guides|getting-started|troubleshooting)(?:\/[a-z0-9][a-z0-9-]*)+$/;
const RECEIPT_KEYS = [
  'schemaVersion',
  'kind',
  'baseDocsCommit',
  'stableTag',
  'routes',
  'betaPostimages',
  'stablePostimages',
  'stableNavPostimages',
  'channelsPreimageSha256',
  'channelsPostimageSha256',
  'receiptDigest',
];
const INVENTORY_KEYS = ['path', 'mode', 'size', 'sha256'];
const REGULAR_MODES = new Set(['100644', '100755']);

const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const sorted = (values) => [...values].sort(compare);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function fail(message) {
  throw new Error(`Stable docs exception: ${message}`);
}

function exactKeys(value, expected, label) {
  if (!isObject(value) || JSON.stringify(sorted(Object.keys(value))) !== JSON.stringify(sorted(expected))) {
    fail(`${label} must contain exactly: ${expected.join(', ')}`);
  }
}

function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { maxBuffer: 128 * 1024 * 1024 });
  if (result.error) fail(`cannot run git ${args.join(' ')}: ${result.error.message}`);
  if (result.status !== 0) fail(`git ${args.join(' ')} failed: ${(result.stderr || '').toString().trim()}`);
  return result.stdout;
}

function resolveCommit(root, revision) {
  const commit = git(root, ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`]).toString('utf8').trim();
  if (!HEX_40.test(commit)) fail(`invalid resolved commit for ${JSON.stringify(revision)}`);
  return commit;
}

function splitNul(bytes) {
  const values = bytes.toString('utf8').split('\0');
  if (values.at(-1) !== '') fail('Git output is not NUL terminated');
  values.pop();
  return values;
}

function gitPath(root, commit, path) {
  const records = splitNul(git(root, ['ls-tree', '-z', commit, '--', path]));
  if (records.length !== 1) fail(`path is missing or ambiguous at ${commit}: ${path}`);
  const match = /^(\d{6}) blob ([a-f0-9]{40})\t(.+)$/.exec(records[0]);
  if (!match || match[3] !== path || !REGULAR_MODES.has(match[1])) {
    fail(`path is not a regular file at ${commit}: ${path}`);
  }
  const bytes = git(root, ['cat-file', 'blob', match[2]]);
  return { path, mode: match[1], size: bytes.length, sha256: sha256(bytes), bytes };
}

function inventory(root, commit, paths) {
  return sorted(paths).map((path) => {
    const { bytes: _bytes, ...row } = gitPath(root, commit, path);
    return row;
  });
}

function validateRoutes(routes) {
  if (!Array.isArray(routes) || routes.length === 0) fail('routes must be a non-empty array');
  let previous = null;
  for (const route of routes) {
    if (typeof route !== 'string' || !ROUTE.test(route)) fail(`invalid approved route ${JSON.stringify(route)}`);
    if (previous !== null && compare(previous, route) >= 0) fail('routes must be unique and strictly sorted');
    previous = route;
  }
}

function pagePaths(routes, channel) {
  return routes.flatMap((route) => ['en', 'vi'].map((locale) => `content/docs/${channel}/${route}.${locale}.mdx`));
}

function allowedNavPaths(routes) {
  const paths = new Set();
  for (const route of routes) {
    const parts = route.split('/');
    for (let length = 1; length < parts.length; length += 1) {
      const directory = parts.slice(0, length).join('/');
      paths.add(`content/docs/stable/${directory}/meta.json`);
      paths.add(`content/docs/stable/${directory}/meta.vi.json`);
    }
  }
  return paths;
}

function validateInventory(rows, expectedPaths, label) {
  if (!Array.isArray(rows) || rows.length !== expectedPaths.length) fail(`${label} does not match its exact path inventory`);
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    exactKeys(row, INVENTORY_KEYS, `${label} row`);
    if (row.path !== expectedPaths[index] || !REGULAR_MODES.has(row.mode) ||
        !Number.isSafeInteger(row.size) || row.size < 0 || !HEX_64.test(row.sha256 ?? '')) {
      fail(`invalid ${label} row for ${row.path}`);
    }
  }
}

function assertInventoryMatches(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${label} does not match committed postimages`);
}

function parseChangedRows(root, base, head) {
  const tokens = splitNul(git(root, ['diff', '--name-status', '-z', '--find-renames', base, head, '--']));
  const rows = [];
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++];
    const oldPath = tokens[index++];
    if (!status || !oldPath) fail('malformed Git name-status output');
    if (status.startsWith('R') || status.startsWith('C')) {
      const path = tokens[index++];
      if (!path) fail(`Git ${status} record is missing its destination path`);
      rows.push({ status, oldPath, path });
    } else {
      rows.push({ status, path: oldPath });
    }
  }
  return rows;
}

function stableChangedPaths(rows) {
  const paths = [];
  for (const row of rows) {
    const touchesStable = row.path?.startsWith('content/docs/stable/') || row.oldPath?.startsWith('content/docs/stable/');
    if (!touchesStable) continue;
    if (!['A', 'M'].includes(row.status) || row.oldPath) fail(`unsupported Stable change ${row.status} ${row.oldPath ?? row.path}`);
    paths.push(row.path);
  }
  return sorted(paths);
}

function channelsIdentity(bytes) {
  let channels;
  try {
    channels = JSON.parse(bytes.toString('utf8'));
  } catch {
    fail('channels.json is not valid JSON');
  }
  if (!STABLE_TAG.test(channels?.stable?.tag ?? '')) fail('channels.json does not contain a stable release tag');
  return channels.stable.tag;
}

export function stableDocsExceptionReceiptDigest(receipt) {
  const body = structuredClone(receipt);
  delete body.receiptDigest;
  return sha256(Buffer.from(`stable-docs-exception-receipt:v1\n${canonicalJson(body)}`, 'utf8'));
}

export function validateStableDocsExceptionReceiptShape(receipt) {
  exactKeys(receipt, RECEIPT_KEYS, 'receipt');
  if (receipt.schemaVersion !== STABLE_DOCS_EXCEPTION_SCHEMA_VERSION || receipt.kind !== STABLE_DOCS_EXCEPTION_KIND) {
    fail('unsupported receipt');
  }
  if (!HEX_40.test(receipt.baseDocsCommit ?? '') || !STABLE_TAG.test(receipt.stableTag ?? '')) fail('invalid receipt release identity');
  validateRoutes(receipt.routes);
  const betaPaths = sorted(pagePaths(receipt.routes, 'beta'));
  const stablePaths = sorted(pagePaths(receipt.routes, 'stable'));
  validateInventory(receipt.betaPostimages, betaPaths, 'Beta postimages');
  validateInventory(receipt.stablePostimages, stablePaths, 'Stable postimages');
  const navPaths = receipt.stableNavPostimages?.map((row) => row.path) ?? [];
  if (JSON.stringify(navPaths) !== JSON.stringify(sorted(navPaths))) fail('Stable nav postimages must be strictly path-sorted');
  const allowedNav = allowedNavPaths(receipt.routes);
  if (navPaths.some((path) => !allowedNav.has(path))) fail('Stable nav postimages escape approved route ancestors');
  validateInventory(receipt.stableNavPostimages, navPaths, 'Stable nav postimages');
  for (const key of ['channelsPreimageSha256', 'channelsPostimageSha256', 'receiptDigest']) {
    if (!HEX_64.test(receipt[key] ?? '')) fail(`invalid ${key}`);
  }
  if (stableDocsExceptionReceiptDigest(receipt) !== receipt.receiptDigest) fail('receipt canonical digest mismatch');
  return receipt;
}

export function createStableDocsExceptionReceipt({ root, base, routes, stableNavPaths = [] }) {
  const baseCommit = resolveCommit(root, base);
  const headCommit = resolveCommit(root, 'HEAD');
  const approvedRoutes = sorted(routes);
  validateRoutes(approvedRoutes);
  const betaPaths = sorted(pagePaths(approvedRoutes, 'beta'));
  const stablePaths = sorted(pagePaths(approvedRoutes, 'stable'));
  const navPaths = sorted(stableNavPaths);
  const betaPostimages = inventory(root, headCommit, betaPaths);
  const stablePostimages = inventory(root, headCommit, stablePaths);
  const stableNavPostimages = inventory(root, headCommit, navPaths);
  for (let index = 0; index < betaPaths.length; index += 1) {
    const beta = gitPath(root, headCommit, betaPaths[index]);
    const stable = gitPath(root, headCommit, stablePaths[index]);
    if (!beta.bytes.equals(stable.bytes)) fail(`Stable page is not byte-identical to Beta: ${stable.path}`);
  }
  const channelsPreimage = gitPath(root, baseCommit, 'channels.json').bytes;
  const channelsPostimage = gitPath(root, headCommit, 'channels.json').bytes;
  if (!channelsPreimage.equals(channelsPostimage)) fail('channels.json changed during a Stable docs exception');
  const receipt = {
    schemaVersion: STABLE_DOCS_EXCEPTION_SCHEMA_VERSION,
    kind: STABLE_DOCS_EXCEPTION_KIND,
    baseDocsCommit: baseCommit,
    stableTag: channelsIdentity(channelsPostimage),
    routes: approvedRoutes,
    betaPostimages,
    stablePostimages,
    stableNavPostimages,
    channelsPreimageSha256: sha256(channelsPreimage),
    channelsPostimageSha256: sha256(channelsPostimage),
    receiptDigest: '',
  };
  receipt.receiptDigest = stableDocsExceptionReceiptDigest(receipt);
  return receipt;
}

export async function checkStableDocsException({ root, base, receiptPath }) {
  if (typeof receiptPath !== 'string' || !/^stable-docs-exceptions\/[a-z0-9][a-z0-9-]*\.json$/.test(receiptPath)) {
    fail(`invalid receipt path ${JSON.stringify(receiptPath)}`);
  }
  const baseCommit = resolveCommit(root, base);
  const headCommit = resolveCommit(root, 'HEAD');
  let receipt;
  try {
    receipt = JSON.parse(await readFile(join(root, receiptPath), 'utf8'));
  } catch (error) {
    fail(`cannot read receipt ${receiptPath}: ${error.message}`);
  }
  validateStableDocsExceptionReceiptShape(receipt);
  if (receipt.baseDocsCommit !== baseCommit) fail(`receipt base ${receipt.baseDocsCommit} does not match ${baseCommit}`);
  const betaPaths = sorted(pagePaths(receipt.routes, 'beta'));
  const stablePaths = sorted(pagePaths(receipt.routes, 'stable'));
  const navPaths = receipt.stableNavPostimages.map((row) => row.path);
  assertInventoryMatches(inventory(root, headCommit, betaPaths), receipt.betaPostimages, 'Beta postimages');
  assertInventoryMatches(inventory(root, headCommit, stablePaths), receipt.stablePostimages, 'Stable postimages');
  assertInventoryMatches(inventory(root, headCommit, navPaths), receipt.stableNavPostimages, 'Stable nav postimages');
  for (let index = 0; index < betaPaths.length; index += 1) {
    const beta = gitPath(root, headCommit, betaPaths[index]);
    const stable = gitPath(root, headCommit, stablePaths[index]);
    if (!beta.bytes.equals(stable.bytes)) fail(`Stable page is not byte-identical to Beta: ${stable.path}`);
  }
  const channelsPreimage = gitPath(root, baseCommit, 'channels.json').bytes;
  const channelsPostimage = gitPath(root, headCommit, 'channels.json').bytes;
  if (!channelsPreimage.equals(channelsPostimage) ||
      sha256(channelsPreimage) !== receipt.channelsPreimageSha256 ||
      sha256(channelsPostimage) !== receipt.channelsPostimageSha256) {
    fail('channels.json preimage/postimage binding mismatch');
  }
  if (channelsIdentity(channelsPostimage) !== receipt.stableTag) fail('receipt stable tag does not match channels.json');
  const expectedStableChanges = sorted([...stablePaths, ...navPaths]);
  const actualStableChanges = stableChangedPaths(parseChangedRows(root, baseCommit, headCommit));
  if (JSON.stringify(actualStableChanges) !== JSON.stringify(expectedStableChanges)) {
    fail(`Stable diff does not match receipt allowlist: expected ${expectedStableChanges.join(', ')}, observed ${actualStableChanges.join(', ')}`);
  }
  return { receipt, receiptPath, base: baseCommit, head: headCommit, changedStablePaths: actualStableChanges };
}
