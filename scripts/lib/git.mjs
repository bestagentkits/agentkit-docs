import { execFileSync } from 'node:child_process';

function git(args, cwd) {
  return execFileSync('git', args, { encoding: 'utf8', cwd });
}

/** Changed file paths for a diff range (default: base...HEAD). */
export function changedFiles(base, { head = 'HEAD', cwd } = {}) {
  const range = base ? [`${base}...${head}`] : [head];
  return git(['diff', '--name-only', ...range], cwd)
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Repo-relative dirs that held a `.generated` marker AT a given ref. Using the
 * base ref (not the working tree) means bootstrapping a generated dir — adding
 * its marker + initial files in one PR — is allowed, while editing a dir that
 * was already machine-owned is caught.
 */
export function generatedDirsAt(ref, { cwd } = {}) {
  const out = git(['ls-tree', '-r', '--name-only', ref], cwd);
  const markers = out
    .split('\n')
    .map((s) => s.trim())
    .filter((p) => p.endsWith('/.generated'));
  const dirs = [];
  for (const marker of markers) {
    // A generated dir is machine-owned only once it has actually been synced —
    // i.e. its marker carries a real tag. A null-placeholder marker (the Phase-3
    // bootstrap slot, `tag: null`) is not yet owned, so the first real population
    // (manual or bot) is allowed; every edit after that is guarded.
    let tag = null;
    try {
      tag = JSON.parse(git(['show', `${ref}:${marker}`], cwd)).tag ?? null;
    } catch {
      tag = null;
    }
    if (tag) dirs.push(marker.slice(0, -'/.generated'.length));
  }
  return dirs;
}

/** Changed entries with git status letter; renames/copies retain source and destination. */
export function changedNameStatus(base, { head = 'HEAD', cwd } = {}) {
  const range = base ? [`${base}...${head}`] : [head];
  return git(['diff', '--name-status', '--find-renames', ...range], cwd)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const parts = l.split('\t');
      return {
        status: parts[0],
        source: parts.length === 3 ? parts[1] : undefined,
        path: parts[parts.length - 1],
      };
    });
}
