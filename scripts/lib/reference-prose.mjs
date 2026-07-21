import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Reviewed, human/AI-owned prose leads for CLI reference pages, keyed by command
// slug (the generated page's basename, e.g. `ak_kit_install`). Stored OUTSIDE
// `content/docs` so fumadocs never turns an overlay into a page, and kept
// channel-neutral (same command → same prose) so promotion inherits it for free.
// The ingest pipeline merges an overlay into the generated page when one exists;
// pages without an overlay fall back to the mechanical synopsis projection.
export const PROSE_DIR = 'reference-prose';

/** Command slug from a generated page filename. */
export function slugFromFile(name) {
  return name.replace(/\.mdx?$/, '');
}

/** Load the prose overlay for a slug, or undefined when none is authored yet. */
export async function loadProse(repoRoot, slug) {
  try {
    return await readFile(join(repoRoot, PROSE_DIR, `${slug}.md`), 'utf8');
  } catch {
    return undefined;
  }
}
