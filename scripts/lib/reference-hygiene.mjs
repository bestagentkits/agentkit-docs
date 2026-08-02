// Fail-closed hygiene for the GENERATED public CLI reference. The reference is a
// faithful projection of `ak --help`; when the CLI's help text leaks internal-only
// references, we FAIL the build rather than silently scrub — the fix belongs
// upstream in the CLI's help text, and a stale/leaky projection is a defect, not
// something to paper over. (Private source-repo URLs are the one deterministic
// exception: hygiene.mjs rewrites them to the public support repo. This check is
// still the backstop if that scrub ever misses one.)
//
// Deliberately does NOT match issue numbers like `#123`: `&#123;` / `&#125;` are
// valid MDX escapes for `{` / `}` in JSON examples, so a `#\d+` rule would corrupt
// legitimate content and false-positive.

// Known upstream leaks that are tracked and awaiting a source fix. Kept as an
// explicit, visible list (not a fuzzy scrub) so any NEW leak still fails closed.
export const ALLOWLIST = new Set([
  'docs/specs/ux-contract.md', // tracked upstream: bestagentkits/agentkit#1102
]);

const ADR = /\bADR\s+\d{3,4}\b/g;
const PRIVATE_URL = /github\.com\/bestagentkits\/agentkit(?![-\w])/g;
const PRIVATE_DOCS_PATH = /\bdocs\/(?:specs|adr|operations|proposals)\/[\w./-]+\.mdx?\b/g;

/**
 * @param {string} text
 * @returns {string[]} human-readable leak descriptions (empty = clean)
 */
export function findReferenceLeaks(text) {
  const leaks = [];
  for (const m of text.matchAll(ADR)) leaks.push(`internal ADR reference (${m[0]})`);
  for (const m of text.matchAll(PRIVATE_URL)) leaks.push(`private source-repo URL (${m[0]})`);
  for (const m of text.matchAll(PRIVATE_DOCS_PATH)) {
    if (!ALLOWLIST.has(m[0])) leaks.push(`private repo docs path (${m[0]})`);
  }
  return leaks;
}
