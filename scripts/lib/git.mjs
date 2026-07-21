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
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter((p) => p.endsWith('/.generated'))
    .map((p) => p.slice(0, -'/.generated'.length));
}

/** Changed entries with git status letter; rename/copy resolve to the dest path. */
export function changedNameStatus(base, { head = 'HEAD', cwd } = {}) {
  const range = base ? [`${base}...${head}`] : [head];
  return git(['diff', '--name-status', ...range], cwd)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const parts = l.split('\t');
      return { status: parts[0], path: parts[parts.length - 1] };
    });
}
