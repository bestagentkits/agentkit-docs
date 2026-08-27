import { lstatSync } from 'node:fs';
import { lstat, mkdir, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export class ReleasePathError extends Error {}

const ENCODED_SEPARATOR_OR_DOT = /%(?:2e|2f|5c)/i;
const TARGET = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function normalizeRepoPath(input) {
  if (typeof input !== 'string' || input.length === 0 || input.includes('\0')) {
    throw new ReleasePathError('path must be a non-empty string without NUL bytes');
  }
  if (isAbsolute(input) || input.includes('\\') || ENCODED_SEPARATOR_OR_DOT.test(input)) {
    throw new ReleasePathError(`unsafe path ${JSON.stringify(input)}`);
  }
  const parts = input.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new ReleasePathError(`unsafe path ${JSON.stringify(input)}`);
  }
  return parts.join('/');
}

export function validateTargetName(target) {
  if (typeof target !== 'string' || !TARGET.test(target) || target === '.' || target === '..') {
    throw new ReleasePathError(`unsafe release target ${JSON.stringify(target)}`);
  }
  return target;
}

export function resolveWithin(root, ...segments) {
  const absoluteRoot = resolve(root);
  const destination = resolve(absoluteRoot, ...segments);
  const rel = relative(absoluteRoot, destination);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new ReleasePathError(`output escapes approved root: ${destination}`);
  }
  return destination;
}

export function releaseOutputDir(outputRoot, target) {
  const absoluteRoot = resolve(outputRoot);
  if (basename(absoluteRoot) !== 'releases' || basename(dirname(absoluteRoot)) !== 'plans') {
    throw new ReleasePathError('V0 output root must be an explicit plans/releases directory');
  }
  return resolveWithin(absoluteRoot, validateTargetName(target));
}

export function assertV0WriteScope(changes, outputPrefix) {
  const prefix = normalizeRepoPath(outputPrefix).replace(/\/$/, '');
  const violations = [];
  for (const change of changes) {
    let path;
    try {
      path = normalizeRepoPath(change.path);
    } catch (error) {
      violations.push(`${change.path}: ${error.message}`);
      continue;
    }
    if (path !== prefix && !path.startsWith(`${prefix}/`)) {
      violations.push(`${path}: V0 may write only ${prefix}/`);
    }
  }
  return violations;
}

const BETA_PREFIX = 'content/docs/beta/';
const BETA_REFERENCE_PREFIX = `${BETA_PREFIX}reference/`;
const HUMAN_OWNED_CLI_PREFIX = `${BETA_REFERENCE_PREFIX}cli/`;

// Human-owned shared reference pages whose English file carries the bare
// default-locale name instead of the `.en.mdx` suffix used everywhere else.
// Enumerated rather than pattern-matched so generated siblings such as
// reference/release-notes.mdx keep failing closed.
const DEFAULT_LOCALE_ENGLISH_PAGES = new Set([`${BETA_REFERENCE_PREFIX}cli-conventions.mdx`]);

function viSiblingOf(englishPath) {
  return `${englishPath.slice(0, -'.mdx'.length)}.vi.mdx`;
}

/** Resolve either half of a bare-default-locale page family to its English path. */
function defaultLocaleEnglishPage(path) {
  if (DEFAULT_LOCALE_ENGLISH_PAGES.has(path)) return path;
  for (const englishPath of DEFAULT_LOCALE_ENGLISH_PAGES) {
    if (path === viSiblingOf(englishPath)) return englishPath;
  }
  return null;
}

export function isHumanOwnedBetaFile(path) {
  if (!path.startsWith(BETA_PREFIX)) return false;
  if (path.split('/').includes('reference-derived')) return false;
  if (defaultLocaleEnglishPage(path)) return true;
  if (path.startsWith(BETA_REFERENCE_PREFIX) && !path.startsWith(HUMAN_OWNED_CLI_PREFIX)) return false;
  return /\.(?:en|vi)\.mdx$/.test(path) || /(^|\/)meta(?:\.[\w-]+)?\.json$/.test(path);
}

export function localizedBetaPair(path) {
  const englishPath = defaultLocaleEnglishPage(path);
  if (englishPath) return path === englishPath ? viSiblingOf(englishPath) : englishPath;
  if (path.endsWith('.en.mdx')) return `${path.slice(0, -'.en.mdx'.length)}.vi.mdx`;
  if (path.endsWith('.vi.mdx')) return `${path.slice(0, -'.vi.mdx'.length)}.en.mdx`;
  if (path.endsWith('/meta.json')) return `${path.slice(0, -'/meta.json'.length)}/meta.vi.json`;
  if (path.endsWith('/meta.vi.json')) return `${path.slice(0, -'/meta.vi.json'.length)}/meta.json`;
  return null;
}

export function localizedBetaPairViolations(paths, label = 'localized path') {
  const normalized = [...new Set(paths.map(normalizeRepoPath))].sort();
  const included = new Set(normalized);
  return normalized.flatMap((path) => {
    const pair = localizedBetaPair(path);
    return pair && !included.has(pair) ? [`${label} ${path} requires paired path ${pair}`] : [];
  });
}

export function validateOwnerDirectedPaths(paths, repoRoot) {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new ReleasePathError('owner paths must be a non-empty JSON array');
  }
  const normalized = [...new Set(paths.map(normalizeRepoPath))].sort();
  for (const path of normalized) {
    if (!isHumanOwnedBetaFile(path)) {
      throw new ReleasePathError(`${path}: owner-directed path is outside human-owned Beta prose/metadata scope`);
    }
    resolveWithin(repoRoot, path);
    let cursor = resolve(repoRoot);
    let stat;
    for (const part of path.split('/')) {
      cursor = resolve(cursor, part);
      try {
        stat = lstatSync(cursor);
      } catch (error) {
        if (error.code === 'ENOENT') {
          throw new ReleasePathError(`${path}: owner-directed path does not exist; V1 is modify-only`);
        }
        throw error;
      }
      if (stat.isSymbolicLink()) {
        throw new ReleasePathError(`${path}: owner-directed path must not traverse a symlink`);
      }
    }
    if (!stat.isFile()) {
      throw new ReleasePathError(`${path}: owner-directed path must be an existing regular file`);
    }
  }
  const pairViolations = localizedBetaPairViolations(normalized, 'owner-directed path');
  if (pairViolations.length) throw new ReleasePathError(pairViolations[0]);
  return normalized;
}

export function v1WriteViolations(changes, approvedPaths) {
  const approved = new Set(approvedPaths.map(normalizeRepoPath));
  const modified = new Set();
  const violations = [];
  for (const change of changes) {
    let path;
    try {
      path = normalizeRepoPath(change.path);
    } catch (error) {
      violations.push(`${change.path}: ${error.message}`);
      continue;
    }
    if (String(change.status).toUpperCase() !== 'M') {
      violations.push(`${path}: V1 may only modify existing files`);
    } else if (!isHumanOwnedBetaFile(path)) {
      violations.push(`${path}: outside human-owned Beta prose/metadata scope`);
    } else if (!approved.has(path)) {
      violations.push(`${path}: not bound by approval`);
    } else {
      modified.add(path);
    }
  }
  for (const path of modified) {
    const pair = localizedBetaPair(path);
    if (pair && approved.has(pair) && !modified.has(pair)) {
      violations.push(`V1 change ${path} requires paired path ${pair}`);
    }
  }
  return violations;
}

export async function atomicWrite(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, contents, { encoding: 'utf8', flag: 'wx' });
  await rename(temporary, path);
}

export async function assertNoSymlinkPath(root, destination) {
  const absoluteRoot = resolve(root);
  const rel = relative(absoluteRoot, resolve(destination));
  let rootStat;
  try {
    rootStat = await lstat(absoluteRoot);
  } catch (error) {
    if (error.code === 'ENOENT') throw new ReleasePathError(`approved output root must already exist: ${absoluteRoot}`);
    throw error;
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new ReleasePathError(`output root must be a real directory: ${absoluteRoot}`);
  }
  let cursor = absoluteRoot;
  for (const part of rel.split(sep).filter(Boolean)) {
    cursor = resolve(cursor, part);
    try {
      const stat = await lstat(cursor);
      if (stat.isSymbolicLink()) throw new ReleasePathError(`symlink output path rejected: ${cursor}`);
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
  }
}
