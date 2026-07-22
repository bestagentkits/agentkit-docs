import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  normalizeReferenceMdx,
  splitFrontmatter,
  frontmatterValue,
} from './normalize-reference.mjs';
import { buildIndexBody } from './reference-index.mjs';
import { scrubPrivateLinks } from './hygiene.mjs';
import { loadProse, slugFromFile } from './reference-prose.mjs';

// The derived CLI reference is generated from two in-repo sources:
//   reference-raw/<slug>.mdx    raw `ak --help` projection (machine source of truth)
//   reference-prose/<slug>.md   reviewed prose overlays (channel-neutral)
// → content/docs/<channel>/reference/cli/<slug>.mdx (hygiene-scrubbed, normalized,
//   overlaid). Because the reference is a pure function of committed sources, CI
//   can regenerate it and assert a zero diff — proving no hand edit survived and
//   replacing the actor-based hand-edit guard for this directory.

export const RAW_DIR = 'reference-raw';

// Human-owned nav config co-located in the generated dir (localized sidebar
// labels + ordering); generation preserves it and never treats it as derived.
const isNavMeta = (name) => /^meta(\.[\w-]+)?\.json$/.test(name);

/**
 * Regenerate the derived CLI reference for one channel from reference-raw +
 * reference-prose. Delete-then-write for derived pages (upstream deletions
 * vanish), preserving `meta*.json` nav and the `.generated` marker.
 * @param {{repoRoot: string, channel?: string}} args
 * @returns {Promise<number>} number of derived pages written
 */
export async function generateReference({ repoRoot, channel = 'beta' }) {
  const rawDir = join(repoRoot, RAW_DIR);
  const cliDir = join(repoRoot, 'content', 'docs', channel, 'reference', 'cli');
  await mkdir(cliDir, { recursive: true });

  const rawPages = (await readdir(rawDir, { withFileTypes: true })).filter(
    (e) => e.isFile() && /\.mdx?$/.test(e.name),
  );
  const derived = new Set(rawPages.map((e) => e.name));

  // Drop derived pages no longer backed by a raw source; keep nav + marker.
  for (const e of await readdir(cliDir, { withFileTypes: true })) {
    if (!e.isFile() || isNavMeta(e.name) || e.name === '.generated') continue;
    if (/\.mdx?$/.test(e.name) && !derived.has(e.name)) await rm(join(cliDir, e.name));
  }

  // The index page is compiled last: a grouped table of contents derived from
  // the command pages' frontmatter (title + description), not a raw projection.
  const commandMeta = [];
  let indexRaw = null;

  for (const e of rawPages) {
    const raw = scrubPrivateLinks(await readFile(join(rawDir, e.name), 'utf8'));
    if (e.name.replace(/\.mdx?$/, '') === 'index') {
      indexRaw = raw;
      continue;
    }
    const prose = await loadProse(repoRoot, slugFromFile(e.name));
    await writeFile(join(cliDir, e.name), normalizeReferenceMdx(raw, { prose }));

    const { frontmatter } = splitFrontmatter(raw);
    commandMeta.push({
      slug: slugFromFile(e.name),
      title: frontmatterValue(frontmatter, 'title'),
      description: frontmatterValue(frontmatter, 'description'),
    });
  }

  if (indexRaw) {
    const { frontmatter } = splitFrontmatter(indexRaw);
    await writeFile(join(cliDir, 'index.mdx'), frontmatter + '\n' + buildIndexBody(commandMeta));
  }
  return rawPages.length;
}
