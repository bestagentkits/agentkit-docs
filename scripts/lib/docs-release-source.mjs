import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { parseManifest } from './manifest.mjs';
import { compareText, digest, stableValue } from './docs-release-normalize.mjs';
import { SOURCE_SCHEMA, validateImmutableRef, validateReleaseSource } from './docs-release-schema.mjs';
import { normalizeRepoPath } from './docs-release-paths.mjs';
import { readTarGzipEntries } from './docs-release-tar.mjs';

const execFileAsync = promisify(execFile);
const IGNORED_DIRS = new Set(['.git', 'node_modules', '.next', 'out', 'dist', 'coverage']);

async function filesUnder(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => compareText(a.name, b.name))) {
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
    const full = join(current, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(root, full));
    else if (entry.isFile()) files.push(normalizeRepoPath(relative(root, full)));
  }
  return files;
}

function bufferItem(path, bytes, kind, id, docs = []) {
  const fileDigest = digest(bytes);
  return {
    id,
    kind,
    claimType: 'fact',
    digest: fileDigest,
    anchors: [{ path, digest: fileDigest }],
    docs,
    aliases: [],
  };
}

async function fileItem(root, path, kind, id, docs = []) {
  return bufferItem(path, await readFile(join(root, path)), kind, id, docs);
}

function descriptorDigest(source) {
  const copy = structuredClone(source);
  copy.provenance ??= { type: 'descriptor' };
  delete copy.provenance.digest;
  return digest(copy);
}

async function loadDescriptor(path, expected) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new Error(`cannot parse release source descriptor ${path}: ${error.message}`);
  }
  parsed.provenance = { ...parsed.provenance, type: 'descriptor', digest: descriptorDigest(parsed) };
  return validateReleaseSource(parsed, expected);
}

function bundleSourceFromEntries(entries, expected) {
  const manifestBytes = entries.get('manifest.json');
  if (!manifestBytes) throw new Error('docs bundle is missing manifest.json');
  const manifestRaw = manifestBytes.toString('utf8');
  const manifest = parseManifest(manifestRaw, { expectedChannel: expected.channel });
  validateImmutableRef(manifest.tag, manifest.sha, 'bundle manifest ref');
  if (expected.ref && ![manifest.tag, manifest.sha].includes(expected.ref)) {
    throw new Error(`bundle provenance mismatch: expected ${expected.ref}, manifest carries ${manifest.tag} / ${manifest.sha}`);
  }
  const paths = [...entries.keys()].sort(compareText);
  const inventory = [];
  for (const path of paths) {
    if (path === 'manifest.json') {
      inventory.push(bufferItem(path, entries.get(path), 'release-manifest', manifest.tag));
    } else if (path === 'release-notes.md') {
      inventory.push(bufferItem(path, entries.get(path), 'docs-bundle', 'release-notes'));
    } else if (path.startsWith('reference/cli/') && path.endsWith('.mdx')) {
      inventory.push(bufferItem(path, entries.get(path), 'cli', basename(path, '.mdx')));
    }
  }
  const contentDigest = digest(paths.map((path) => ({ path, digest: digest(entries.get(path)) })));
  return validateReleaseSource({
    schemaVersion: SOURCE_SCHEMA,
    channel: manifest.channel,
    ref: manifest.tag,
    resolvedCommit: manifest.sha,
    version: manifest.version,
    generatedAt: manifest.generatedAt,
    dirty: false,
    provenance: {
      type: 'bundle',
      digest: contentDigest,
      manifestDigest: digest(Buffer.from(manifestRaw)),
      manifest: stableValue(manifest),
    },
    items: inventory,
  }, expected);
}

async function directoryBundleSource(root, expected) {
  const paths = await filesUnder(root);
  const entries = new Map(await Promise.all(paths.map(async (path) => [path, await readFile(join(root, path))])));
  return bundleSourceFromEntries(entries, expected);
}

async function tarBundleSource(path, expected) {
  return bundleSourceFromEntries(await readTarGzipEntries(path), expected);
}

function classifyCheckoutPath(path) {
  const lower = path.toLowerCase();
  const stem = path.replace(/\.[^/.]+$/, '');
  if (/(^|\/)install(?:er|ers|ation)?(\/|[-_.])/.test(lower)) return ['installer', stem];
  if (/(^|\/)runtime[-_]?adapters?(\/|[-_.])/.test(lower)) return ['runtime-adapter', stem];
  for (const kind of ['kits', 'skills', 'agents', 'hooks']) {
    const marker = `/${kind}/`;
    const wrapped = `/${lower}`;
    if (wrapped.includes(marker)) return [kind.slice(0, -1), stem];
  }
  if (/(^|\/)manifest\.json$/.test(lower)) return ['release-manifest', stem];
  return null;
}

async function git(root, args) {
  const { stdout } = await execFileAsync('git', ['-C', root, ...args], { encoding: 'utf8' });
  return stdout.trim();
}

async function checkoutSource(root, expected) {
  if (!expected.ref) throw new Error('local checkout sources require an explicit immutable ref');
  const commit = await git(root, ['rev-parse', 'HEAD']);
  validateImmutableRef(expected.ref, commit, 'checkout ref');
  const resolved = await git(root, ['rev-parse', `${expected.ref}^{commit}`]);
  if (resolved !== commit) throw new Error(`checkout HEAD ${commit} does not match ${expected.ref} (${resolved})`);
  if (await git(root, ['status', '--porcelain'])) throw new Error('local checkout is dirty; refusing mixed evidence');
  const generatedAt = await git(root, ['show', '-s', '--format=%cI', commit]);
  const paths = await filesUnder(root);
  const items = [];
  for (const path of paths) {
    const classification = classifyCheckoutPath(path);
    if (classification) items.push(await fileItem(root, path, classification[0], classification[1]));
  }
  let version = expected.ref;
  try {
    version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version ?? version;
  } catch {}
  return validateReleaseSource({
    schemaVersion: SOURCE_SCHEMA,
    channel: expected.channel,
    ref: expected.ref,
    resolvedCommit: commit,
    version,
    generatedAt,
    dirty: false,
    provenance: { type: 'checkout', digest: digest({ commit, items }) },
    items,
  }, expected);
}

export async function loadReleaseSource(input, expected = {}) {
  const path = resolve(input);
  const info = await stat(path);
  if (info.isFile()) {
    if (/\.(?:tar\.gz|tgz)$/i.test(path)) return tarBundleSource(path, expected);
    return loadDescriptor(path, expected);
  }
  if (!info.isDirectory()) throw new Error(`release source is not a file or directory: ${input}`);
  try {
    const descriptor = join(path, 'docs-release-source.json');
    if ((await stat(descriptor)).isFile()) return loadDescriptor(descriptor, expected);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  try {
    if ((await stat(join(path, 'manifest.json'))).isFile()) return directoryBundleSource(path, expected);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return checkoutSource(path, expected);
}
