import { isInGeneratedDir } from './generated-dirs.mjs';

// Human-owned nav config that happens to live inside a generated dir (localized
// sidebar labels + ordering). Sync preserves these; humans may edit them.
const isNavMeta = (p) => /(^|\/)meta(\.[\w-]+)?\.json$/.test(p);

// The docs agent may only touch beta prose subtrees — never reference/ (which
// holds machine-generated pages + the machine-written release notes).
const AGENT_ALLOW_PREFIXES = [
  'content/docs/beta/getting-started/',
  'content/docs/beta/guides/',
];

// Pure guard logic shared by the CI generated-dir guard and the agent-PR guard.
// Inputs are plain data (changed paths / statuses + the known generated dirs) so
// they are trivially unit-testable; the CLI wrappers supply the git diff.

/**
 * Generated-dir guard: which changed paths touch machine-owned dirs.
 * @param {string[]} changedPaths repo-relative paths
 * @param {string[]} generatedDirs from findGeneratedDirs()
 * @returns {string[]} violating paths
 */
export function generatedViolations(changedPaths, generatedDirs) {
  return changedPaths.filter((p) => isInGeneratedDir(p, generatedDirs) && !isNavMeta(p));
}

/**
 * Agent-PR scope guard. Agent PRs may only MODIFY existing files inside the beta
 * prose subtrees (getting-started / guides). Adds/deletes/renames, anything
 * outside those subtrees, and anything in a generated dir all fail — an allowlist
 * is safer than a denylist (a new sensitive path can't slip through).
 * @param {{status: string, path: string}[]} changes  git name-status entries
 * @param {string[]} generatedDirs from findGeneratedDirs()
 * @returns {string[]} human-readable violation messages (empty = allowed)
 */
export function agentPrViolations(changes, generatedDirs) {
  const violations = [];
  for (const { status, path } of changes) {
    const s = (status || '').charAt(0).toUpperCase();
    if (s !== 'M') {
      violations.push(`${path}: status ${status} not allowed (agent may only modify existing files)`);
      continue;
    }
    if (!AGENT_ALLOW_PREFIXES.some((p) => path.startsWith(p))) {
      violations.push(`${path}: outside agent scope (content/docs/beta/{getting-started,guides})`);
      continue;
    }
    // Defense in depth — a generated dir should never appear under the allowed
    // prose subtrees, but reject it explicitly if it ever does.
    if (isInGeneratedDir(path, generatedDirs)) {
      violations.push(`${path}: inside a generated dir (machine-owned)`);
    }
  }
  return violations;
}
