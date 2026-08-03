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

// A generated dir whose contents are a pure function of committed sources
// (reference-raw + reference-prose) is proven correct by the reproducibility CI
// step (`generate-reference.mjs` + assert-no-diff) — strictly stronger than the
// actor-based hand-edit check. So the hand-edit guard exempts it, letting a
// generator-change PR update the derived pages without the sync-bot bypass.
// (The agent-PR guard stays strict: agents may never touch the reference.)
export const REPRODUCIBLE_DIRS = ['reference-derived'];

// One-time ownership transfer for the CLI migration: the Beta generated dump
// moves to reference-derived/, while reviewed pages in both channels move from
// the human-owned cli-samples/ tree into the published nested cli/ tree.
const OWNERSHIP_TRANSFERS = [
  {
    from: 'content/docs/beta/reference/cli/',
    to: 'reference-derived/',
  },
  {
    from: 'content/docs/beta/reference/cli-samples/',
    to: 'content/docs/beta/reference/cli/',
  },
  {
    from: 'content/docs/stable/reference/cli-samples/',
    to: 'content/docs/stable/reference/cli/',
  },
];

// Stable's obsolete generated dump has no derived destination. Its exact base
// subtree is retired in the same one-time route migration; additions and edits
// there remain forbidden.
const OWNERSHIP_RETIREMENTS = ['content/docs/stable/reference/cli/'];

/** Generated dirs still covered by the hand-edit guard (reproducible ones removed). */
export function guardedDirs(generatedDirs) {
  return generatedDirs.filter((d) => !REPRODUCIBLE_DIRS.includes(d));
}

/**
 * Generated-dir guard: which changed paths touch machine-owned dirs.
 * @param {string[]} changedPaths repo-relative paths
 * @param {string[]} generatedDirs from findGeneratedDirs()
 * @returns {string[]} violating paths
 */
export function generatedViolations(changedPaths, generatedDirs) {
  return changedPaths.filter((p) => isInGeneratedDir(p, generatedDirs) && !isNavMeta(p));
}

function isOwnershipTransfer(change) {
  if (!/^R\d+$/.test(change.status) || !change.source) return false;
  return OWNERSHIP_TRANSFERS.some(
    ({ from, to }) => change.source.startsWith(from) && change.path.startsWith(to),
  );
}

function isOwnershipRetirement(change) {
  return (
    change.status === 'D' &&
    OWNERSHIP_RETIREMENTS.some((prefix) => change.path.startsWith(prefix))
  );
}

/**
 * Generated-dir guard with rename provenance. Exact ownership-transfer renames
 * are allowed; edits, additions, and deletions in the machine-owned source are
 * still rejected.
 * @param {{status: string, source?: string, path: string}[]} changes
 * @param {string[]} generatedDirs
 */
export function generatedChangeViolations(changes, generatedDirs) {
  const violations = [];
  for (const change of changes) {
    const touchesGenerated = [change.source, change.path].some(
      (path) => path && isInGeneratedDir(path, generatedDirs),
    );
    if (!touchesGenerated || isNavMeta(change.path)) continue;
    if (isOwnershipTransfer(change)) continue;
    if (isOwnershipRetirement(change)) continue;
    violations.push(change.path);
  }
  return violations;
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
