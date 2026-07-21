// The CLI's `--help` text (and thus the generated reference) links to the private
// source repo `github.com/bestagentkits/agentkit`. That repo is not readable by
// docs users, so every synced reference is rewritten to the public support repo.
// Keeps the public site clean regardless of the CLI's help text. The proper
// upstream fix is for `ak`'s help to use public URLs; until then this guarantees it.
const PRIVATE_REPO = /github\.com\/bestagentkits\/agentkit(?![-\w])/g;
const SUPPORT_REPO = 'github.com/bestagentkits/agentkit-support';

/** Rewrite links to the private source repo → the public support repo. */
export function scrubPrivateLinks(text) {
  return text.replace(PRIVATE_REPO, SUPPORT_REPO);
}
