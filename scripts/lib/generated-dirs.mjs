import { readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const toPosix = (p) => p.split(sep).join('/');

/**
 * Repo-relative (posix) directory paths that hold a `.generated` marker.
 * These directories are machine-owned; hand edits are rejected.
 */
export async function findGeneratedDirs(repoRoot) {
  const docsDir = join(repoRoot, 'content', 'docs');
  const out = [];
  let entries;
  try {
    entries = await readdir(docsDir, { withFileTypes: true, recursive: true });
  } catch {
    return out; // no content/docs yet
  }
  for (const e of entries) {
    if (e.isFile() && e.name === '.generated') {
      const dirAbs = e.parentPath ?? e.path;
      out.push(toPosix(relative(repoRoot, dirAbs)));
    }
  }
  return out;
}

/** True if `relPath` is the marker itself or lives inside a generated dir. */
export function isInGeneratedDir(relPath, generatedDirs) {
  const p = toPosix(relPath);
  return generatedDirs.some((d) => p === `${d}/.generated` || p.startsWith(`${d}/`));
}
